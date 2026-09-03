/**
 * Слоёные спрайты машин и декораций. §11.
 *
 * Спрайты приходят из пайплайна (scripts/render-sprites.mjs): ортографический
 * вид строго сбоку, один и тот же кадр 1024x512 для всех слоёв, поэтому слои
 * накладываются в 0,0 и совпадают по пикселям без единого «на глаз».
 *
 * Загрузка асинхронная и необязательная: пока картинки едут, машина рисуется
 * вектором, а как приехали — подменяется. Заезд из-за этого не ждёт сети.
 */

export type CarLayer =
  | 'body' | 'shade' | 'trim' | 'chrome' | 'glass' | 'light' | 'tail' | 'wheel';

export interface WheelAnchor {
  cx: number;
  cy: number;
  r: number;
}

export interface CarSpriteMeta {
  id: string;
  frame: [number, number];
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Нижняя точка машины в кадре: по ней машина ставится на дорогу. */
  ground: number;
  wheels: WheelAnchor[];
  order: CarLayer[];
}

export interface CarSprites {
  meta: CarSpriteMeta;
  images: Record<CarLayer, HTMLImageElement>;
}

const LAYERS: CarLayer[] = [
  'body', 'shade', 'trim', 'chrome', 'glass', 'light', 'tail', 'wheel',
];

/**
 * Машины, прошедшие пайплайн. Это ровно те, что есть в игре: без спрайтов
 * машина в CAR_MODELS не попадает.
 *
 * Векторная отрисовка осталась запасным путём на те секунды, пока картинки
 * ещё грузятся.
 */
export const SPRITE_READY = new Set(['falke_t9']);

const cars = new Map<string, CarSprites | null>();
const pending = new Map<string, Promise<CarSprites | null>>();

declare global {
  interface Window {
    /** Карта «путь спрайта → data-URI». Заполняется только самодостаточной
     *  сборкой (scripts/build-standalone.mjs), где сети нет вообще. */
    __sprites?: Record<string, string>;
  }
}

/** Путь к спрайту: обычно свой, в самодостаточной странице — вшитый. */
function asset(path: string): string {
  return window.__sprites?.[path] ?? path;
}

/**
 * Манифест слоёв. В самодостаточной странице он приезжает data-URI, и читать
 * его через fetch нельзя: CSP хостинга запрещает connect-src к data:, запрос
 * падает, и машина молча откатывается на векторную отрисовку.
 */
async function loadManifest(url: string): Promise<CarSpriteMeta> {
  if (url.startsWith('data:')) {
    const payload = url.slice(url.indexOf(',') + 1);
    return JSON.parse(url.includes(';base64,') ? atob(payload) : decodeURIComponent(payload)) as CarSpriteMeta;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('нет манифеста');
  return (await response.json()) as CarSpriteMeta;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((done, fail) => {
    const image = new Image();
    image.onload = () => done(image);
    image.onerror = () => fail(new Error(`не загрузилось: ${src}`));
    image.src = src;
  });
}

/**
 * Спрайты машины, если они уже загружены. Синхронно — вызывается из кадра
 * отрисовки, где ждать нельзя.
 */
export function carSprites(modelId: string): CarSprites | null {
  return cars.get(modelId) ?? null;
}

/** Есть ли у машины отрендеренные спрайты. Отсутствие — не ошибка (§11, шаг 8). */
export function loadCarSprites(modelId: string): Promise<CarSprites | null> {
  const known = pending.get(modelId);
  if (known) return known;

  const job = (async () => {
    try {
      const meta = await loadManifest(asset(`/sprites/${modelId}/layers.json`));
      const images = Object.fromEntries(
        await Promise.all(
          LAYERS.map(async (layer) => [layer, await loadImage(asset(`/sprites/${modelId}/${layer}.png`))]),
        ),
      ) as Record<CarLayer, HTMLImageElement>;
      const sprites: CarSprites = { meta, images };
      cars.set(modelId, sprites);
      return sprites;
    } catch {
      // Машины без спрайтов рисуются вектором — это штатный путь, не сбой.
      cars.set(modelId, null);
      return null;
    }
  })();

  pending.set(modelId, job);
  return job;
}

// ── окраска ──────────────────────────────────────────────────────────────────

const tinted = new Map<string, HTMLCanvasElement>();

/**
 * Кузов, помноженный на цвет окраски. §11: любая окраска — строка кода,
 * а не отдельный файл рендера.
 *
 * Результат кэшируется: перекрашивать 1024x512 каждый кадр незачем, цвет
 * машины за заезд не меняется.
 */
export function tintedBody(
  sprites: CarSprites,
  paint: string,
  vinyl?: CanvasImageSource | null,
  vinylOpacity = 1,
): HTMLCanvasElement {
  const key = `${sprites.meta.id}/${paint}/${vinyl ? 'v' : ''}${vinylOpacity}`;
  const known = tinted.get(key);
  if (known && !vinyl) return known;

  const body = sprites.images.body;
  const canvas = document.createElement('canvas');
  canvas.width = body.naturalWidth;
  canvas.height = body.naturalHeight;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(body, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = paint;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Умножение залило весь кадр — возвращаем альфу кузова.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(body, 0, 0);

  // Винил принимает произвольную текстуру, а не набор пресетов — §8.
  if (vinyl) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = vinylOpacity;
    ctx.drawImage(vinyl, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  ctx.globalCompositeOperation = 'source-over';
  if (!vinyl) tinted.set(key, canvas);
  return canvas;
}

// ── декорации ────────────────────────────────────────────────────────────────

export interface SceneSprites {
  wall: HTMLImageElement | null;
  road: HTMLImageElement | null;
}

const scene: SceneSprites = { wall: null, road: null };
let scenePending: Promise<SceneSprites> | null = null;

export function sceneSprites(): SceneSprites {
  return scene;
}

export function loadSceneSprites(): Promise<SceneSprites> {
  if (scenePending) return scenePending;
  scenePending = (async () => {
    for (const name of ['wall', 'road'] as const) {
      try {
        scene[name] = await loadImage(asset(`/sprites/scene/${name}.png`));
      } catch {
        scene[name] = null;
      }
    }
    return scene;
  })();
  return scenePending;
}

/**
 * Тайлинг с зеркалом. Куски стены и дороги сняты с реальных моделей, их края
 * не стыкуются сами с собой — но стыкуются со своим отражением. Каждый второй
 * тайл рисуется зеркально, и шва не видно.
 */
export function tileMirrored(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  offset: number,
): void {
  const source = image as HTMLImageElement;
  const tile = height * (source.naturalWidth / source.naturalHeight);
  if (!(tile > 0)) return;

  const period = tile * 2;
  const shift = ((offset % period) + period) % period;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  for (let left = x - shift; left < x + width; left += tile) {
    const index = Math.round((left - x + shift) / tile);
    ctx.save();
    if (index % 2 === 1) {
      ctx.translate(left + tile, y);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(left, y);
    }
    ctx.drawImage(image, 0, 0, tile, height);
    ctx.restore();
  }
  ctx.restore();
}
