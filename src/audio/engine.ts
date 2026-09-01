/**
 * Звук заезда. §10.
 *
 * Управления нет, поэтому звук — единственное, что превращает просчитанный
 * результат в событие. Питч двигателя ведётся по расчётной кривой скорости,
 * провалы приходятся на автоматические переключения, пробуксовка объясняет
 * проигрыш без слов.
 *
 * Пока всё синтезируется в Web Audio: ноль ассетов, ноль вопросов по лицензиям
 * и звук доступен сразу. Замена на сэмплы CC0 с Freesound — точечная,
 * интерфейс этого модуля не меняется.
 */

import type { Frame } from '../core/race.ts';
import type { Side } from '../core/types.ts';

export class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engines: Record<Side, EngineVoice | null> = { a: null, b: null };
  private muted = false;

  /** Web Audio можно запускать только из жеста пользователя. */
  async start(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    await ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.engines.a = new EngineVoice(ctx, master, 1);
    this.engines.b = new EngineVoice(ctx, master, 0.55);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Сигнал светофора: три коротких, четвёртый выше и длиннее — зелёный. */
  light(step: number): void {
    if (!this.ctx || !this.master) return;
    const green = step >= 3;
    this.beep(green ? 880 : 440, green ? 0.35 : 0.12, green ? 0.3 : 0.18);
  }

  /** Кадр раскадровки → питч и громкость двигателей. */
  frame(frame: Frame, maxSpeed: number): void {
    for (const side of ['a', 'b'] as const) {
      this.engines[side]?.update(frame[side].speed, frame[side].gear, maxSpeed);
    }
  }

  /** Визг резины: играется, когда конфигурация не подошла под покрытие. */
  wheelspin(intensity = 1): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    const length = Math.floor(ctx.sampleRate * 0.7);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 3.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.22 * intensity;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start();
    noise.stop(ctx.currentTime + 0.7);
  }

  finish(): void {
    this.beep(660, 0.5, 0.22);
    for (const side of ['a', 'b'] as const) this.engines[side]?.release();
  }

  stop(): void {
    for (const side of ['a', 'b'] as const) this.engines[side]?.release();
  }

  private beep(frequency: number, duration: number, volume: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }
}

/**
 * Один двигатель. Пила плюс подпил на октаву ниже — узнаваемый рык.
 * Питч ведётся по скорости внутри передачи: при переключении обороты падают,
 * потом снова растут. Это и есть те 3–4 провала за заезд из §10.
 */
class EngineVoice {
  private readonly ctx: AudioContext;
  private readonly osc: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly gain: GainNode;
  private readonly filter: BiquadFilterNode;

  constructor(ctx: AudioContext, destination: AudioNode, volume: number) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2200;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35 * volume;
    const mainGain = ctx.createGain();
    mainGain.gain.value = 0.5 * volume;
    this.osc.connect(mainGain).connect(this.filter);
    this.sub.connect(subGain).connect(this.filter);
    this.filter.connect(this.gain).connect(destination);
    this.osc.start();
    this.sub.start();
  }

  update(speed: number, gear: number, maxSpeed: number): void {
    const now = this.ctx.currentTime;
    // Обороты внутри передачи: скорость, поделённая на диапазон этой передачи.
    const band = Math.max(0.001, maxSpeed / 5);
    const withinGear = Math.min(1, Math.max(0, (speed - (gear - 1) * band) / band));
    const rpm = 0.25 + withinGear * 0.75;
    const frequency = 55 + rpm * 190;
    this.osc.frequency.setTargetAtTime(frequency, now, 0.03);
    this.sub.frequency.setTargetAtTime(frequency / 2, now, 0.03);
    this.filter.frequency.setTargetAtTime(700 + rpm * 2600, now, 0.05);
    const loudness = speed <= 0 ? 0 : 0.05 + Math.min(0.22, (speed / maxSpeed) * 0.22);
    this.gain.gain.setTargetAtTime(loudness, now, 0.05);
  }

  release(): void {
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
  }
}
