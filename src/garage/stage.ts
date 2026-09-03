/**
 * Витрина машины в гараже: тот же вид строго сбоку, что и в заезде.
 *
 * Рисуется теми же спрайтами и той же функцией drawCar, что и машина на
 * трассе. Это не экономия, а требование §11: витрина и трасса обязаны
 * показывать один объект, иначе тюнинг в гараже и машина в заезде разъедутся.
 *
 * Движение на экране одно — машина закатывается в бокс и оседает на
 * подвеске. Дальше картинка стоит: одно оркестрованное движение на экран.
 */

import { drawCar } from '../render/car.ts';
import { PALETTE, PAINTS } from '../render/palette.ts';
import {
  loadCarSprites, loadSceneSprites, sceneSprites, tileMirrored, type CarView,
} from '../render/sprites.ts';

/**
 * Ракурс витрины. Три четверти сняты и лежат в public/sprites/<id>/garage,
 * но у нынешней модели внутри кузова лежат запасные колёса: сбоку они
 * прятались за настоящими, а в три четверти торчат из двери. Отбор
 * по положению задевает и настоящие, поэтому витрина пока показывает
 * профиль. Переключается одной строкой, как только исходник вычистят.
 */
const VIEW: CarView = 'race';

export interface StageOptions {
  canvas: HTMLCanvasElement;
  onReady?: () => void;
}

/**
 * Сколько ширины бокса занимает машина. В «Уличных гонках» витрина была
 * крупной: машина почти во весь бокс, а не фигурка посреди пустого гаража.
 */
const CAR_SHARE = 0.99;
/** Линия пола в долях высоты. */
const FLOOR = 0.86;
/** Где стена встречается с полом. */
const SKIRTING = 0.76;

const ROLL_IN = 0.85;
const SETTLE = 1.1;

export class Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly options: StageOptions;

  private modelId = '';
  private paint = '#d8d5ce';
  private raf = 0;
  private last = 0;
  /** Секунды с начала заезда машины в бокс. */
  private age = 0;
  private reducedMotion = false;

  constructor(options: StageOptions) {
    this.options = options;
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');
    this.ctx = ctx;
    // Витрина показывает машину крупно: масштабирование спрайта должно быть
    // хорошим, а не быстрым.
    ctx.imageSmoothingQuality = 'high';
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    void loadSceneSprites().then(() => this.draw());
    this.resize();
  }

  /** Новая машина закатывается в бокс заново. */
  setCar(modelId: string, paint: string): void {
    this.modelId = modelId;
    this.paint = PAINTS[paint] ?? paint;
    this.age = this.reducedMotion ? ROLL_IN + SETTLE : 0;
    void loadCarSprites(modelId, VIEW).then(() => {
      this.options.onReady?.();
      this.draw();
    });
    this.draw();
  }

  setPaint(paint: string): void {
    this.paint = PAINTS[paint] ?? paint;
    this.draw();
  }

  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.age += dt;
      this.draw();
      // Машина заехала и успокоилась — гонять кадры дальше незачем.
      if (this.age > ROLL_IN + SETTLE) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.stop();
  }

  private get width(): number {
    return this.canvas.width / (window.devicePixelRatio || 1);
  }

  private get height(): number {
    return this.canvas.height / (window.devicePixelRatio || 1);
  }

  private draw(): void {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;
    if (w === 0 || h === 0) return;

    ctx.clearRect(0, 0, w, h);
    this.drawBox(w, h);

    if (!this.modelId) return;

    const carWidth = Math.min(w * CAR_SHARE, (h * 0.84) / 0.42);
    const carHeight = carWidth * 0.42;

    // Витрина — фиксированный ракурс три четверти, статичная съёмка. Машина
    // не закатывается в бокс: в три четверти это читалось бы как полёт боком.
    // Вместо заезда — проявление и лёгкая осадка на подвеске.
    const roll = Math.min(1, this.age / ROLL_IN);
    const eased = 1 - Math.pow(1 - roll, 3);
    const x = (w - carWidth) / 2;

    // Оседание на подвеске после остановки. Затухающие колебания, полсекунды.
    const settle = Math.max(0, this.age - ROLL_IN);
    const bob = settle < SETTLE
      ? Math.exp(-4.5 * settle) * Math.sin(settle * 13) * carHeight * 0.035
      : 0;

    const y = h * FLOOR - carHeight * 0.92 + bob + (1 - eased) * carHeight * 0.06;

    ctx.save();
    ctx.globalAlpha = eased;
    ctx.translate(x, y);
    drawCar(ctx, {
      modelId: this.modelId,
      pimp: { paint: this.paint },
      width: carWidth,
      wheelAngle: 0,
      squat: 0,
      view: VIEW,
    });
    ctx.restore();
  }

  /** Бокс: бетонная стена, пятно натриевого фонаря, пол. */
  private drawBox(w: number, h: number): void {
    const { ctx } = this;

    ctx.fillStyle = PALETTE.skyTop;
    ctx.fillRect(0, 0, w, h);

    const { wall } = sceneSprites();
    if (wall) {
      // Стена набирается тремя рядами панелей со сдвигом: одна лента на всю
      // высоту растянула бы бетон до неузнаваемости.
      const rows = 3;
      const rowHeight = (h * SKIRTING) / rows;
      ctx.save();
      ctx.globalAlpha = 0.26;
      // Бетон в исходнике снят тёплым, а бокс теперь серый: сбавляем
      // насыщенность, иначе стена уводит весь экран в коричневое.
      ctx.filter = 'saturate(0.45)';
      for (let row = 0; row < rows; row++) {
        tileMirrored(ctx, wall, 0, row * rowHeight, w, rowHeight, row * 173);
      }
      ctx.restore();

      // Верх бокса уходит в темноту: потолка мы не рисуем, но он там есть.
      const roof = ctx.createLinearGradient(0, 0, 0, h * 0.34);
      roof.addColorStop(0, PALETTE.skyTop);
      roof.addColorStop(1, 'rgba(14,16,18,0)');
      ctx.fillStyle = roof;
      ctx.fillRect(0, 0, w, h * 0.34);
    }

    // Единственный тёплый источник: лампа под потолком бокса.
    const lamp = ctx.createRadialGradient(w * 0.5, -h * 0.1, 0, w * 0.5, -h * 0.1, h * 1.15);
    lamp.addColorStop(0, 'rgba(192,143,78,0.14)');
    lamp.addColorStop(1, 'rgba(192,143,78,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, w, h);

    // Пол и линия примыкания к стене.
    const floor = h * SKIRTING;
    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(0, floor, w, h - floor);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, floor, w, 2);

    const floorLight = ctx.createLinearGradient(0, floor, 0, h);
    floorLight.addColorStop(0, 'rgba(224,123,57,0.06)');
    floorLight.addColorStop(1, 'rgba(224,123,57,0)');
    ctx.fillStyle = floorLight;
    ctx.fillRect(0, floor, w, h - floor);
  }
}
