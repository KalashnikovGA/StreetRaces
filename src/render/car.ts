/**
 * Отрисовка машины. §11.
 *
 * Два пути отрисовки, один и тот же порядок слоёв.
 *
 * Если для машины отрендерены спрайты (public/sprites/<id>), рисуются они:
 * тень → неон → кузов, умноженный на цвет → блики → стёкла → фары → фонари →
 * колёса с поворотом. Если спрайтов нет — тот же порядок рисуется вектором
 * по контуру из SILHOUETTES. Второй путь остаётся, пока пайплайн прошли не все
 * машины (§14, шаг 8), и работает как запасной при неудачной загрузке.
 *
 * Слой винила принимает произвольную текстуру, а не набор пресетов. Это
 * единственное требование Sponsored Car к пайплайну, которое надо заложить
 * сейчас, иначе потом переделывать все рендеры (§8).
 */

import { PALETTE, PAINTS } from './palette.ts';
import { carSprites, tintedBody, type CarSprites } from './sprites.ts';

/** Силуэт в долях габаритного прямоугольника. Те же якоря, что у художника (§11). */
export interface Silhouette {
  /** Контур кузова, доли ширины и высоты. */
  body: [number, number][];
  /** Остекление. */
  glass: [number, number][];
  /** Центры колёс и радиус, доли ширины. */
  wheels: { x: number; y: number; r: number }[];
  /** Есть ли антикрыло по умолчанию. */
  spoiler: boolean;
  /** Высота кузова над землёй — по ней сажается машина при заниженной подвеске. */
  ride: number;
}

export const SILHOUETTES: Record<string, Silhouette> = {
  // Современное купе: длинный капот, прижатая крыша, высокая корма.
  // Контур снят с ортографического рендера самой модели (docs/RENDER.md):
  // силуэт на трассе и модель в гараже — один объект, а не две картинки,
  // которые разъедутся при первой правке. Остекление достроено по линии крыши.
  bavar_c40: {
    body: [
      [0.02, 0.73], [0.02, 0.60], [0.03, 0.55], [0.04, 0.41], [0.15, 0.40],
      [0.25, 0.35], [0.29, 0.30], [0.41, 0.30], [0.55, 0.32], [0.60, 0.37],
      [0.66, 0.43], [0.89, 0.47], [0.97, 0.52], [0.98, 0.56], [0.98, 0.73],
    ],
    glass: [[0.26, 0.47], [0.30, 0.32], [0.55, 0.32], [0.62, 0.45]],
    wheels: [{ x: 0.235, y: 0.755, r: 0.070 }, { x: 0.807, y: 0.755, r: 0.070 }],
    spoiler: true,
    ride: 0.03,
  },
  // Седан 80-х: длинный багажник, прямая крыша, широкие арки.
  // Контур снят с той же модели, что и спрайты (docs/RENDER.md).
  vogel190: {
    body: [
      [0.02, 0.73], [0.02, 0.59], [0.03, 0.43], [0.18, 0.43], [0.26, 0.35],
      [0.27, 0.32], [0.39, 0.30], [0.58, 0.31], [0.58, 0.34], [0.69, 0.44],
      [0.94, 0.47], [0.97, 0.59], [0.98, 0.73],
    ],
    glass: [[0.25, 0.44], [0.30, 0.32], [0.56, 0.32], [0.63, 0.44]],
    wheels: [{ x: 0.244, y: 0.755, r: 0.061 }, { x: 0.817, y: 0.755, r: 0.061 }],
    spoiler: true,
    ride: 0.035,
  },
};

export function silhouetteOf(modelId: string): Silhouette {
  return SILHOUETTES[modelId] ?? SILHOUETTES.vogel190!;
}

/** Косметика. На заезд не влияет — §4. */
export interface Pimp {
  paint: string;
  /** Произвольная текстура винила. Не пресет — требование §8. */
  vinyl?: CanvasImageSource | null;
  vinylOpacity?: number;
  spoiler?: boolean;
  neon?: string | null;
  /** Занижение подвески, 0..1. */
  drop?: number;
  rim?: string;
  plate?: string;
}

export interface DrawCarOptions {
  modelId: string;
  pimp: Pimp;
  /** Габаритная ширина машины на канве, пиксели. */
  width: number;
  /** Угол поворота колёс, радианы. Крутится от скорости. */
  wheelAngle: number;
  /** Приседание кузова при разгоне, доли высоты. */
  squat: number;
  /** Мигает ли стоп-сигнал (финиш). */
  braking?: boolean;
}

function path(ctx: CanvasRenderingContext2D, points: [number, number][], w: number, h: number, closed = true): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const px = x * w;
    const py = y * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  if (closed) ctx.closePath();
}

/**
 * Линия земли в габарите машины. Совпадает с низом колеса векторного
 * силуэта, поэтому спрайтовые и векторные машины стоят на одной дороге.
 */
const GROUND = 0.92;

/** Отрисовка слоями из пайплайна. Порядок тот же, что и у вектора. */
function drawSpriteCar(
  ctx: CanvasRenderingContext2D,
  sprites: CarSprites,
  options: DrawCarOptions,
): void {
  const { pimp, width } = options;
  const { meta, images } = sprites;
  const w = width;
  const h = w * 0.42;
  const paint = PAINTS[pimp.paint] ?? pimp.paint ?? PAINTS.white!;

  // Кадр спрайта шире машины: масштаб считается по её собственному габариту,
  // иначе поля кадра съедят ширину и машины разъедутся по размеру.
  const scale = w / (meta.box.x1 - meta.box.x0 + 1);
  const dx = -meta.box.x0 * scale;
  const dy = h * GROUND - meta.ground * scale;
  const frameW = meta.frame[0] * scale;
  const frameH = meta.frame[1] * scale;

  // Занижение опускает кузов к колёсам; колёса и тень остаются на земле.
  const drop = (pimp.drop ?? 0) * 0.03 * h;

  ctx.save();
  ctx.translate(0, options.squat * h * 0.02);

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * GROUND, w * 0.44, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (pimp.neon) {
    ctx.save();
    ctx.shadowColor = pimp.neon;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = pimp.neon;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.18, h * (GROUND - 0.06));
    ctx.lineTo(w * 0.82, h * (GROUND - 0.06));
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(0, drop);
  ctx.drawImage(tintedBody(sprites, paint, pimp.vinyl, pimp.vinylOpacity), dx, dy, frameW, frameH);

  // Блики сняты на чёрном, поэтому кладутся сложением: тёмная окраска
  // перестаёт быть плоской заливкой, светлая не выгорает.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.22;
  ctx.drawImage(images.shade, dx, dy, frameW, frameH);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // Детали со своим цветом: чёрные окантовки, решётки, зеркало, бампера —
  // и хром поверх них. Красится только кузов, поэтому они не уплывают
  // вслед за окраской.
  ctx.drawImage(images.trim, dx, dy, frameW, frameH);
  ctx.drawImage(images.chrome, dx, dy, frameW, frameH);

  ctx.drawImage(images.glass, dx, dy, frameW, frameH);
  ctx.drawImage(images.light, dx, dy, frameW, frameH);
  ctx.drawImage(images.tail, dx, dy, frameW, frameH);

  // Стоп-сигнал: тот же слой фонарей, добавленный сложением.
  if (options.braking) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(images.tail, dx, dy, frameW, frameH);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  for (const wheel of meta.wheels) {
    const size = (wheel.r * 2 + 1) * scale;
    ctx.save();
    ctx.translate(dx + wheel.cx * scale, dy + wheel.cy * scale);
    ctx.rotate(options.wheelAngle);
    ctx.drawImage(images.wheel, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Рисует машину в точке (0,0) — левый нижний угол габарита.
 * Вызывающий сам ставит трансформацию.
 */
export function drawCar(ctx: CanvasRenderingContext2D, options: DrawCarOptions): void {
  const sprites = carSprites(options.modelId);
  if (sprites) {
    drawSpriteCar(ctx, sprites, options);
    return;
  }

  const { modelId, pimp, width } = options;
  const shape = silhouetteOf(modelId);
  const h = width * 0.42;
  const w = width;
  const drop = (pimp.drop ?? 0) * shape.ride * h;
  const paint = PAINTS[pimp.paint] ?? pimp.paint ?? PAINTS.white!;

  // Занижение опускает кузов К колёсам, а не поднимает над ними: колёса и тень
  // остаются на земле, поэтому компенсируют сдвиг обратно.
  ctx.save();
  ctx.translate(0, drop + options.squat * h * 0.02);

  // Слой 1: тень под машиной.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.86 - drop, w * 0.44, h * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Слой 2: неон под порогами. Рисуется до кузова, чтобы светил из-под машины.
  if (pimp.neon) {
    ctx.save();
    ctx.shadowColor = pimp.neon;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = pimp.neon;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.16, h * 0.8);
    ctx.lineTo(w * 0.84, h * 0.8);
    ctx.stroke();
    ctx.restore();
  }

  // Слой 3: кузов. В пайплайне сюда ляжет белый PNG, умноженный на цвет.
  path(ctx, shape.body, w, h);
  ctx.fillStyle = paint;
  ctx.fill();

  // Слой 4: винил. Произвольная текстура, обрезанная по кузову (§8).
  if (pimp.vinyl) {
    ctx.save();
    path(ctx, shape.body, w, h);
    ctx.clip();
    ctx.globalAlpha = pimp.vinylOpacity ?? 1;
    ctx.drawImage(pimp.vinyl, 0, 0, w, h);
    ctx.restore();
  }

  // Слой 5: стёкла.
  path(ctx, shape.glass, w, h);
  ctx.fillStyle = PALETTE.glass;
  ctx.fill();
  ctx.save();
  path(ctx, shape.glass, w, h);
  ctx.clip();
  ctx.fillStyle = PALETTE.glassShine;
  ctx.fillRect(0, 0, w * 0.55, h);
  ctx.restore();

  // Слой 6: антикрыло.
  if (pimp.spoiler ?? shape.spoiler) {
    ctx.fillStyle = paint;
    ctx.fillRect(w * 0.02, h * 0.44, w * 0.1, h * 0.035);
    ctx.fillRect(w * 0.05, h * 0.46, w * 0.02, h * 0.08);
  }

  // Слой 7: фары и фонари.
  ctx.fillStyle = PALETTE.taillight;
  ctx.fillRect(w * 0.03, h * 0.58, w * 0.035, h * 0.06);
  if (options.braking) {
    ctx.save();
    ctx.shadowColor = PALETTE.taillight;
    ctx.shadowBlur = 16;
    ctx.fillRect(w * 0.03, h * 0.58, w * 0.035, h * 0.06);
    ctx.restore();
  }
  ctx.fillStyle = PALETTE.headlight;
  ctx.fillRect(w * 0.94, h * 0.56, w * 0.035, h * 0.055);

  // Слой 8: колёса поверх кузова — так видно диски и вращение.
  for (const wheel of shape.wheels) {
    const cx = wheel.x * w;
    const cy = wheel.y * h - drop;
    const r = wheel.r * w;
    ctx.fillStyle = PALETTE.rubber;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(options.wheelAngle);
    ctx.strokeStyle = pimp.rim ?? PALETTE.rim;
    ctx.lineWidth = Math.max(1, r * 0.14);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * r * 0.6, Math.sin(angle) * r * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}
