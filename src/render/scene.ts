/**
 * Сцена заезда. §2 шага разработки: Canvas, вид сбоку, светофор, финиш.
 *
 * Сцена ничего не решает. Она проигрывает готовую раскадровку из race():
 * кадр за кадром, без собственной физики и без собственной случайности.
 * Причину проигрыша показывает картинкой — дымом из-под колёс, вялым съездом
 * с места, паром из-под капота. Текстовых объяснений нет по §3.
 */

import type { Frame, RaceInput, RaceResult } from '../core/race.ts';
import { FPS } from '../core/race.ts';
import { getModel, horsepower } from '../core/cars.ts';
import type { Nitro, Side } from '../core/types.ts';
import { PALETTE } from './palette.ts';
import { drawCar, type Pimp } from './car.ts';
import { loadCarSprites, loadSceneSprites, sceneSprites, tileMirrored } from './sprites.ts';

export interface SideVisual {
  name: string;
  pimp: Pimp;
}

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  /** Исходные данные заезда: из них берётся всё, что нужно нарисовать. */
  input: RaceInput;
  result: RaceResult;
  visuals: Record<Side, SideVisual>;
  /** Секунд обратного отсчёта до старта. */
  countdown?: number;
  onFinish?: () => void;
  /** Кадр заезда, для звука. */
  onFrame?: (frame: Frame, t: number) => void;
  onLights?: (step: number) => void;
}

const CAR_WIDTH_PX = 156;
/** Сколько метров трассы влезает в экран. Камера едет за лидером. */
const METERS_ON_SCREEN = 90;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

export class RaceScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly options: SceneOptions;
  private readonly particles: Particle[] = [];
  private readonly wheelAngle: Record<Side, number> = { a: 0, b: 0 };
  private raf = 0;
  private startedAt = 0;
  private countdownLeft: number;
  private lastLightStep = -1;
  private finished = false;
  private cityOffset = 0;

  constructor(options: SceneOptions) {
    this.options = options;
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');
    this.ctx = ctx;
    this.countdownLeft = options.countdown ?? 3.2;
    this.resize();

    // Спрайты подтягиваются в фоне: пока их нет, заезд идёт на векторе.
    // Ждать сеть перед стартом нельзя — §3 обещает результат за 15 секунд.
    void Promise.all([
      loadSceneSprites(),
      loadCarSprites(this.modelOf('a')),
      loadCarSprites(this.modelOf('b')),
    ]).then(() => {
      if (!this.raf) this.renderAt(-1);
    });
  }

  resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  play(): void {
    this.startedAt = performance.now();
    this.finished = false;
    const rate = this.options.result.playbackRate;
    const loop = (now: number) => {
      const elapsed = (now - this.startedAt) / 1000;
      // Экранное время множится на playbackRate: сам заезд идёт в своём времени,
      // а зритель смотрит его за 10–15 секунд (§3).
      // Обратный отсчёт идёт в обычном времени, сам заезд — в ускоренном.
      const beforeStart = elapsed - this.countdownLeft;
      const t = beforeStart * rate;
      this.step(t, Math.min(0.05, 1 / 60) * rate, beforeStart);
      // Хвост: машины докатываются за черту, потом сцена останавливается.
      if (t >= this.options.result.duration + 2) {
        if (!this.finished) {
          this.finished = true;
          this.options.onFinish?.();
        }
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Одиночный кадр в произвольный момент — для перемотки и статичного превью. */
  renderAt(t: number): void {
    this.step(t, 1 / FPS, t);
  }

  private frameAt(t: number): Frame {
    const { frames } = this.options.result;
    const index = Math.min(frames.length - 1, Math.max(0, Math.round(t * FPS)));
    return frames[index]!;
  }

  private step(t: number, dt: number, beforeStart: number): void {
    const { result } = this.options;
    const frame = this.frameAt(Math.max(0, t));
    const leader = Math.max(frame.a.distance, frame.b.distance);

    this.drawBackground(leader);
    this.drawRoad(leader, result.trackLength);

    for (const side of ['b', 'a'] as const) {
      this.drawSide(side, frame, leader, t, dt);
    }

    this.drawHud(frame, t);
    if (beforeStart < 0) this.drawLights(beforeStart);
    if (t >= result.duration) this.drawFinishBanner();

    this.updateParticles(dt);
    this.options.onFrame?.(frame, t);
  }

  private get width(): number {
    return this.canvas.width / (window.devicePixelRatio || 1);
  }

  private get height(): number {
    return this.canvas.height / (window.devicePixelRatio || 1);
  }

  private pixelsPerMeter(): number {
    return this.width / METERS_ON_SCREEN;
  }

  /** Камера держит лидера в правой трети экрана. */
  private cameraOffset(leader: number): number {
    return Math.max(0, leader - METERS_ON_SCREEN * 0.55);
  }

  private drawBackground(leader: number): void {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Два плана: дальний почти стоит, ближний уезжает. Ощущение скорости
    // держится на этой разнице, а не на скорости самой машины.
    this.cityOffset = this.cameraOffset(leader) * this.pixelsPerMeter();
    const { wall } = sceneSprites();
    if (wall) {
      // Стена снята днём, а заезд идёт ночью: бетон сажается в темноту
      // прозрачностью, иначе фон ярче машин и тянет взгляд на себя.
      const farTop = h * 0.315;
      const nearTop = h * 0.40;
      ctx.save();
      ctx.globalAlpha = 0.16;
      tileMirrored(ctx, wall, 0, farTop, w, h * 0.15, this.cityOffset * 0.10);
      ctx.globalAlpha = 0.30;
      tileMirrored(ctx, wall, 0, nearTop, w, h * 0.15, this.cityOffset * 0.28);
      ctx.restore();

      // Пятно натриевого фонаря над дальним планом. Единственный тёплый
      // источник в кадре — тот же, что светит в шапке гаража.
      const lamp = ctx.createRadialGradient(w * 0.72, h * 0.30, 0, w * 0.72, h * 0.30, h * 0.45);
      lamp.addColorStop(0, 'rgba(224,123,57,0.16)');
      lamp.addColorStop(1, 'rgba(224,123,57,0)');
      ctx.fillStyle = lamp;
      ctx.fillRect(0, h * 0.10, w, h * 0.45);

      // Низ стены тонет у обочины — иначе она висит в воздухе.
      const foot = ctx.createLinearGradient(0, h * 0.46, 0, h * 0.55);
      foot.addColorStop(0, 'rgba(14,16,18,0)');
      foot.addColorStop(1, PALETTE.skyTop);
      ctx.fillStyle = foot;
      ctx.fillRect(0, h * 0.46, w, h * 0.09);
    } else {
      this.drawCity(h * 0.42, 220, this.cityOffset * 0.12, PALETTE.cityFar, 0.5);
      this.drawCity(h * 0.52, 150, this.cityOffset * 0.32, PALETTE.cityNear, 0.9);
    }
  }

  private drawCity(baseY: number, spacing: number, offset: number, color: string, windowChance: number): void {
    const { ctx } = this;
    const w = this.width;
    ctx.fillStyle = color;
    const start = Math.floor(offset / spacing) - 1;
    for (let i = start; i < start + w / spacing + 3; i++) {
      const x = i * spacing - offset;
      // Высота дома детерминирована его индексом: город не мерцает между кадрами.
      const noise = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      const bh = 60 + noise * 120;
      ctx.fillRect(x, baseY - bh, spacing * 0.72, bh);
      ctx.fillStyle = PALETTE.window;
      for (let row = 0; row < Math.floor(bh / 26); row++) {
        for (let col = 0; col < 3; col++) {
          const lit = Math.abs(Math.sin((i * 31 + row * 7 + col * 3) * 12.9898) * 43758.5453) % 1;
          if (lit < 0.35 * windowChance) {
            ctx.fillRect(x + 8 + col * spacing * 0.2, baseY - bh + 10 + row * 26, 7, 10);
          }
        }
      }
      ctx.fillStyle = color;
    }
  }

  private drawRoad(leader: number, trackLength: number): void {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;
    const ppm = this.pixelsPerMeter();
    const offset = this.cameraOffset(leader);

    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(0, h * 0.50, w, h * 0.50);

    const { road } = sceneSprites();
    if (road) {
      // Полотно снято сверху и тайлится вдоль экрана. Кромки и прерывистая
      // между полосами приходят с самой дороги, рисовать их не нужно.
      tileMirrored(ctx, road, 0, h * 0.54, w, h * 0.44, offset * ppm);
      // Тот же ночной прижим, что и на стене: днёвный асфальт слишком светлый.
      ctx.fillStyle = 'rgba(16,18,20,0.42)';
      ctx.fillRect(0, h * 0.54, w, h * 0.44);
    } else {
      ctx.fillStyle = PALETTE.road;
      ctx.fillRect(0, h * 0.54, w, h * 0.44);
      ctx.fillStyle = PALETTE.roadEdge;
      ctx.fillRect(0, h * 0.54, w, 3);
      ctx.fillRect(0, h * 0.975, w, 3);
      ctx.fillStyle = PALETTE.lane;
      ctx.fillRect(0, h * 0.775, w, 2);

      // Разметка: штрих каждые 10 метров. По ней читается скорость.
      ctx.fillStyle = PALETTE.marking;
      const step = 10;
      const first = Math.floor(offset / step) * step;
      for (let m = first; m < offset + METERS_ON_SCREEN + step; m += step) {
        const x = (m - offset) * ppm;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, h * 0.775, ppm * 3.2, 2);
        ctx.globalAlpha = 1;
      }
    }

    // Финишная черта.
    const finishX = (trackLength - offset) * ppm;
    if (finishX > -40 && finishX < w + 40) {
      const cell = 9;
      for (let row = 0; row * cell < h * 0.44; row++) {
        for (let col = 0; col < 2; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? PALETTE.marking : PALETTE.skyTop;
          ctx.fillRect(finishX + col * cell, h * 0.54 + row * cell, cell, cell);
        }
      }
    }
  }

  private drawSide(side: Side, frame: Frame, leader: number, t: number, dt: number): void {
    const { ctx } = this;
    const h = this.height;
    const ppm = this.pixelsPerMeter();
    const state = frame[side];
    const x = (state.distance - this.cameraOffset(leader)) * ppm;
    // Дальняя полоса выше и чуть мельче — вид сбоку с лёгкой глубиной.
    const near = side === 'a';
    const y = near ? h * 0.945 : h * 0.735;
    const scale = near ? 1 : 0.86;
    const width = CAR_WIDTH_PX * scale;

    this.wheelAngle[side] += (state.speed / 12) * dt * (near ? 1 : 0.86);

    const visual = this.options.visuals[side];
    const odds = this.options.result[side];
    const flags = odds.tuning.flags;

    // Пробуксовка: дым из-под задних колёс, пока машина не зацепилась.
    const u = t / this.options.result.finishTime[side];
    if (t > 0 && u < 0.15 && flags.wheelspin) {
      this.emit(x + width * 0.22, y - 4, PALETTE.smoke, 3, -1);
    }
    // Перегрев: пар из-под капота на последней трети.
    if (u > 0.7 && u < 1 && flags.overheat) {
      this.emit(x + width * 0.8, y - width * 0.30, PALETTE.steam, 1, -1, 0.4);
    }
    // Нитро: синий выхлоп в момент подхвата. Пустой баллон — короткий бледный пшик.
    const nitroU = { none: -1, early: 0.22, mid: 0.48, late: 0.76 }[this.nitroKey(side)];
    if (nitroU > 0 && Math.abs(u - nitroU) < 0.02) {
      this.emit(x + width * 0.03, y - width * 0.16, PALETTE.nitro, flags.nitroWasted ? 1 : 3, -1, 0.6);
    }

    ctx.save();
    ctx.translate(x, y - width * 0.42);
    // Рыскание при плохом давлении или срезанном весе: машину видно ведёт.
    if (flags.unstable && t > 0 && u < 1) {
      ctx.translate(0, Math.sin(t * 11) * 1.6);
      ctx.rotate(Math.sin(t * 9) * 0.006);
    }
    drawCar(ctx, {
      modelId: this.modelOf(side),
      pimp: visual.pimp,
      width,
      wheelAngle: this.wheelAngle[side],
      squat: state.speed > 0 ? 1 : 0,
      braking: state.finished,
    });
    ctx.restore();
  }

  private modelOf(side: Side): string {
    return this.options.input[side].car.modelId;
  }

  private nitroKey(side: Side): Nitro {
    return this.options.input[side].config.nitro;
  }

  private emit(x: number, y: number, color: string, count: number, direction: number, spread = 1): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x,
        y,
        vx: direction * (10 + Math.random() * 26) * spread,
        vy: -6 - Math.random() * 14,
        life: 0.22 + Math.random() * 0.26,
        size: 1.5 + Math.random() * 2.5,
        color,
      });
    }
  }

  private updateParticles(dt: number): void {
    const { ctx } = this;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += dt * 18;
      ctx.save();
      // Частица гаснет вместе с жизнью и никогда не бывает плотной:
      // на спрайтовых машинах плотный кружок читается как шарик, а не как дым.
      ctx.globalAlpha = Math.max(0, p.life) * 0.55;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawLights(t: number): void {
    const { ctx } = this;
    const w = this.width;
    // Три жёлтых, потом зелёный — как на дереве в дрэге.
    const step = Math.min(3, Math.floor((this.countdownLeft + t) / (this.countdownLeft / 4)));
    if (step !== this.lastLightStep) {
      this.lastLightStep = step;
      this.options.onLights?.(step);
    }
    // Дерево лежит горизонтально между панелью гонщиков и дорогой: вертикальное
    // на этой ширине налезает на имя соперника. На узком экране ужимается
    // тем же коэффициентом, что и панель.
    const lamp = 15 * Math.max(0.66, Math.min(1, w / 900));
    const spacing = lamp * 3.1;
    const total = spacing * 3;
    const cx = w / 2 - total / 2;
    const cy = this.height * 0.40;
    ctx.save();
    ctx.fillStyle = 'rgba(16,18,20,0.84)';
    ctx.fillRect(cx - lamp * 2, cy - lamp * 1.9, total + lamp * 4, lamp * 3.8);
    for (let i = 0; i < 4; i++) {
      const on = this.lastLightStep >= i;
      const green = i === 3;
      ctx.beginPath();
      ctx.arc(cx + i * spacing, cy, lamp, 0, Math.PI * 2);
      ctx.fillStyle = on ? (green ? PALETTE.gateLight : PALETTE.accent) : '#2a2e31';
      if (on) {
        ctx.shadowColor = green ? PALETTE.gateLight : PALETTE.accent;
        ctx.shadowBlur = 14;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  private drawHud(frame: Frame, t: number): void {
    const { ctx, options } = this;
    const w = this.width;
    // На узком экране панель гонщиков едет по той же сетке, только мельче:
    // иначе имя соперника налезает на светофор.
    const k = Math.max(0.66, Math.min(1, w / 900));
    ctx.save();
    for (const side of ['a', 'b'] as const) {
      const visual = options.visuals[side];
      const state = frame[side];
      const x = side === 'a' ? 14 * k : w / 2 + 14 * k;
      ctx.fillStyle = PALETTE.text;
      ctx.font = `500 ${(17 * k).toFixed(0)}px 'Fira Sans Condensed', sans-serif`;
      ctx.fillText(visual.name, x, 30 * k);
      ctx.font = `400 ${(13 * k).toFixed(0)}px 'Fira Sans Condensed', system-ui, sans-serif`;
      ctx.fillStyle = PALETTE.textDim;
      const model = getModel(this.modelOf(side));
      // Точек-разделителей в мета-строках нет нигде в игре — только слова.
      ctx.fillText(`${model.nick}, ${horsepower(options.input[side].car)} л.с.`, x, 50 * k);
      ctx.fillStyle = PALETTE.accent;
      ctx.font = `500 ${(26 * k).toFixed(0)}px 'Fira Sans Condensed', sans-serif`;
      ctx.fillText(`${Math.round(state.speed * 3.6)}`, x, 80 * k);
      ctx.font = `400 ${(12 * k).toFixed(0)}px 'Fira Sans Condensed', system-ui, sans-serif`;
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText('км/ч', x + 48 * k, 80 * k);
      ctx.fillText(`передача ${state.gear}`, x, 100 * k);
    }
    // Пройденная дистанция по центру.
    if (t >= 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = "400 13px 'Fira Sans Condensed', system-ui, sans-serif";
      const done = Math.round(Math.max(frame.a.distance, frame.b.distance));
      ctx.fillText(`${done} / ${options.result.trackLength} м`, w / 2, this.height - 14);
    }
    ctx.restore();
  }

  private drawFinishBanner(): void {
    const { ctx, options } = this;
    const w = this.width;
    const winner = options.visuals[options.result.winner];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(16,18,20,0.76)';
    ctx.fillRect(w / 2 - 210, this.height * 0.30, 420, 92);
    ctx.fillStyle = PALETTE.accent;
    ctx.font = "600 38px 'Fira Sans Condensed', sans-serif";
    ctx.fillText(winner.name, w / 2, this.height * 0.30 + 44);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "400 15px 'Fira Sans Condensed', system-ui, sans-serif";
    const gap = Math.abs(options.result.finishTime.a - options.result.finishTime.b);
    ctx.fillText(
      options.result.photoFinish ? 'фотофиниш' : `+${gap.toFixed(2)} с`,
      w / 2, this.height * 0.30 + 72,
    );
    ctx.restore();
  }
}
