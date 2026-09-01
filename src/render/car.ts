/**
 * Отрисовка машины. §11.
 *
 * Пока это векторный плейсхолдер, но порядок и состав слоёв уже те, что придут
 * из блендеровского пайплайна на шаге 8: тень → кузов → стёкла → колёса → пимп →
 * винил → блики. Кузов рисуется светлым и умножается на цвет, поэтому любая
 * окраска — строка кода, а не новый файл (§11).
 *
 * Слой винила принимает произвольную текстуру, а не набор пресетов. Это
 * единственное требование Sponsored Car к пайплайну, которое надо заложить
 * сейчас, иначе потом переделывать все рендеры (§8).
 */

import { PALETTE, PAINTS } from './palette.ts';

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

const SILHOUETTES: Record<string, Silhouette> = {
  // «Корытце»: короткий пузырь, колёса по краям, крыша высокая.
  zarya965: {
    body: [[0.04, 0.78], [0.06, 0.52], [0.22, 0.48], [0.34, 0.20], [0.62, 0.18], [0.74, 0.47], [0.94, 0.52], [0.96, 0.78]],
    glass: [[0.26, 0.46], [0.36, 0.25], [0.60, 0.24], [0.70, 0.46]],
    wheels: [{ x: 0.22, y: 0.80, r: 0.075 }, { x: 0.78, y: 0.80, r: 0.075 }],
    spoiler: false,
    ride: 0.06,
  },
  // «Шоха»: коробка с прямой крышей и длинным багажником.
  lada6: {
    body: [[0.03, 0.78], [0.04, 0.54], [0.16, 0.50], [0.26, 0.26], [0.70, 0.25], [0.80, 0.50], [0.97, 0.54], [0.98, 0.78]],
    glass: [[0.20, 0.48], [0.28, 0.30], [0.66, 0.29], [0.74, 0.48]],
    wheels: [{ x: 0.21, y: 0.80, r: 0.079 }, { x: 0.79, y: 0.80, r: 0.079 }],
    spoiler: false,
    ride: 0.05,
  },
  // Хэтч 90-х: покатая корма.
  ronin_gx: {
    body: [[0.03, 0.76], [0.05, 0.55], [0.20, 0.49], [0.33, 0.28], [0.62, 0.27], [0.80, 0.44], [0.96, 0.56], [0.97, 0.76]],
    glass: [[0.25, 0.47], [0.35, 0.31], [0.58, 0.30], [0.70, 0.45]],
    wheels: [{ x: 0.22, y: 0.78, r: 0.076 }, { x: 0.77, y: 0.78, r: 0.076 }],
    spoiler: false,
    ride: 0.045,
  },
  lada_sport: {
    body: [[0.03, 0.77], [0.05, 0.54], [0.18, 0.50], [0.29, 0.28], [0.63, 0.27], [0.78, 0.47], [0.96, 0.55], [0.97, 0.77]],
    glass: [[0.23, 0.48], [0.31, 0.31], [0.59, 0.30], [0.69, 0.46]],
    wheels: [{ x: 0.22, y: 0.79, r: 0.077 }, { x: 0.78, y: 0.79, r: 0.077 }],
    spoiler: true,
    ride: 0.04,
  },
  // Седан: длинный капот, три объёма.
  bavar320: {
    body: [[0.02, 0.75], [0.04, 0.55], [0.22, 0.50], [0.34, 0.29], [0.64, 0.28], [0.76, 0.48], [0.97, 0.53], [0.98, 0.75]],
    glass: [[0.28, 0.48], [0.37, 0.32], [0.60, 0.31], [0.69, 0.47]],
    wheels: [{ x: 0.23, y: 0.77, r: 0.080 }, { x: 0.78, y: 0.77, r: 0.080 }],
    spoiler: false,
    ride: 0.04,
  },
  // Купе: длинный нос, низкая крыша, покатая корма.
  ronin_ss: {
    body: [[0.02, 0.74], [0.04, 0.56], [0.26, 0.50], [0.40, 0.32], [0.62, 0.31], [0.82, 0.45], [0.97, 0.54], [0.98, 0.74]],
    glass: [[0.34, 0.49], [0.43, 0.35], [0.60, 0.34], [0.72, 0.46]],
    wheels: [{ x: 0.24, y: 0.76, r: 0.081 }, { x: 0.79, y: 0.76, r: 0.081 }],
    spoiler: true,
    ride: 0.035,
  },
  kaiser_r34: {
    body: [[0.02, 0.74], [0.04, 0.55], [0.24, 0.49], [0.37, 0.30], [0.63, 0.29], [0.79, 0.44], [0.97, 0.53], [0.98, 0.74]],
    glass: [[0.31, 0.48], [0.40, 0.33], [0.60, 0.32], [0.71, 0.45]],
    wheels: [{ x: 0.23, y: 0.76, r: 0.082 }, { x: 0.79, y: 0.76, r: 0.082 }],
    spoiler: true,
    ride: 0.035,
  },
  // Клин: почти без капота, крыша прижата, огромное антикрыло.
  corsa_f40: {
    body: [[0.02, 0.73], [0.06, 0.60], [0.30, 0.52], [0.44, 0.36], [0.66, 0.35], [0.84, 0.50], [0.97, 0.56], [0.98, 0.73]],
    glass: [[0.38, 0.51], [0.47, 0.38], [0.63, 0.38], [0.73, 0.49]],
    wheels: [{ x: 0.24, y: 0.75, r: 0.083 }, { x: 0.79, y: 0.75, r: 0.083 }],
    spoiler: true,
    ride: 0.03,
  },
};

export function silhouetteOf(modelId: string): Silhouette {
  return SILHOUETTES[modelId] ?? SILHOUETTES.lada6!;
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
 * Рисует машину в точке (0,0) — левый нижний угол габарита.
 * Вызывающий сам ставит трансформацию.
 */
export function drawCar(ctx: CanvasRenderingContext2D, options: DrawCarOptions): void {
  const { modelId, pimp, width } = options;
  const shape = silhouetteOf(modelId);
  const h = width * 0.42;
  const w = width;
  const drop = (pimp.drop ?? 0) * shape.ride * h;
  const paint = PAINTS[pimp.paint] ?? pimp.paint ?? PAINTS.white!;

  ctx.save();
  ctx.translate(0, -drop + options.squat * h * 0.02);

  // Слой 1: тень под машиной.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.86 + drop, w * 0.44, h * 0.06, 0, 0, Math.PI * 2);
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
    ctx.moveTo(w * 0.16, h * 0.8 + drop);
    ctx.lineTo(w * 0.84, h * 0.8 + drop);
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
    const cy = wheel.y * h + drop;
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
