/**
 * Ядро заезда. §3.
 *
 *   race(carA, configA, carB, configB, conditions, seed) → полная раскадровка
 *
 * Функция чистая и детерминированная: источник случайности только сид, обращения
 * к ГПСЧ платформы внутри ядра запрещены и проверяются тестом. От этого зависят
 * повторы по ссылке, серверная валидация и воспроизводимость отладки баланса.
 */

import type { Conditions, Distance, Racer, Side } from './types.ts';
import { makeRng } from './rng.ts';
import { MIRACLE_RATIO, sideOdds, winProbability, type SideOdds } from './odds.ts';
import type { TuningFlags } from './tuning.ts';

/** Реальная длина дистанции, метры. */
export const TRACK_LENGTH: Record<Distance, number> = { short: 402, medium: 800, long: 1600 };

/**
 * Сколько заезд идёт на экране. Спецификация требует 10–15 секунд (§3),
 * поэтому длинная дистанция сжимается по времени, а не растягивается.
 */
const NOMINAL_DURATION: Record<Distance, number> = { short: 10.5, medium: 12.5, long: 14.5 };

export const FPS = 30;

/** Разрыв на финише, секунды. Уверенная победа — большой, чудо — фотофиниш. */
const GAP_MIN = 0.08;
const GAP_MAX = 2.4;
const PHOTO_FINISH = 0.15;

/** Автоматические переключения: 3–4 за заезд, под них пишется звук (§10). */
const SHIFT_POINTS = [0.11, 0.27, 0.48, 0.73];

export interface RaceOutcome {
  winner: Side;
  /** Вероятность победы A до броска. */
  pWinA: number;
  /** Бросок [0,1). Сохраняется ради отладки и серверной сверки. */
  roll: number;
  a: SideOdds;
  b: SideOdds;
  /** Сила сильнейшего, делённая на силу слабейшего. */
  strengthRatio: number;
  /** Победил тот, у кого было меньше 50%. */
  upset: boolean;
  /** Победила машина, которая слабее втрое и больше (§3). Порождает ссылку. */
  miracle: boolean;
}

export interface SideFrame {
  /** Пройдено метров. */
  distance: number;
  /** Доля дистанции 0..1. */
  progress: number;
  /** Метры в секунду — по этой кривой питчится двигатель (§10). */
  speed: number;
  /** Текущая передача 1..5. */
  gear: number;
  finished: boolean;
}

export interface Frame {
  t: number;
  a: SideFrame;
  b: SideFrame;
}

export type RaceEventKind =
  | 'start' | 'wheelspin' | 'bog' | 'shift' | 'nitro' | 'nitroWasted' | 'noNitro'
  | 'fade' | 'unstable' | 'overheat' | 'lead' | 'finish';

export interface RaceEvent {
  t: number;
  kind: RaceEventKind;
  side: Side | null;
  /** Номер передачи для 'shift'. */
  gear?: number;
}

export interface RaceResult extends RaceOutcome {
  seed: string;
  conditions: Conditions;
  trackLength: number;
  /** Время каждого по секундам. */
  finishTime: Record<Side, number>;
  /** За сколько секунд заезд решился. Именно это §3 держит в 10–15 секундах. */
  winnerTime: number;
  /** Полная длина раскадровки: отстающий доезжает после победителя. */
  duration: number;
  photoFinish: boolean;
  frames: Frame[];
  events: RaceEvent[];
}

export interface RaceInput {
  a: Racer;
  b: Racer;
  conditions: Conditions;
  seed: string;
}

/**
 * Только исход, без раскадровки. Этим считает сервер при валидации ставки
 * и этим гоняются сотни тысяч заездов в scripts/balance.ts.
 */
export function resolve(input: RaceInput): RaceOutcome {
  const a = sideOdds(input.a.car, input.a.config, input.conditions);
  const b = sideOdds(input.b.car, input.b.config, input.conditions);
  const pWinA = winProbability(a.eff, b.eff);
  const rng = makeRng(input.seed);
  const roll = rng();
  const winner: Side = roll < pWinA ? 'a' : 'b';

  const strengthRatio = Math.max(a.strength, b.strength) / Math.min(a.strength, b.strength);
  const winnerStrength = winner === 'a' ? a.strength : b.strength;
  const loserStrength = winner === 'a' ? b.strength : a.strength;
  const pWinner = winner === 'a' ? pWinA : 1 - pWinA;

  return {
    winner,
    pWinA,
    roll,
    a,
    b,
    strengthRatio,
    upset: pWinner < 0.5,
    miracle: loserStrength / winnerStrength >= MIRACLE_RATIO,
  };
}

/** Относительная скорость 0..1 по нормированному времени u. Форма кривой, не абсолют. */
function speedShape(u: number, flags: TuningFlags, nitroAt: number | null): number {
  // Разгон: экспоненциальный выход на максимум.
  let v = 1 - Math.exp(-u / 0.26);

  // Провалы на автоматических переключениях — их слышно, они же дают ритм заезду.
  for (const point of SHIFT_POINTS) {
    v *= 1 - 0.07 * Math.exp(-(((u - point) / 0.022) ** 2));
  }

  // Пробуксовка: старт провален, дальше машина едет как ехала. Разрыв не отыгрывается сам.
  if (flags.wheelspin && u < 0.15) {
    v *= 0.42 + 0.58 * (u / 0.15);
  }

  // Длинные передачи на короткой: вялый съезд с места, но ровный.
  if (flags.bog && u < 0.3) {
    v *= 0.62 + 0.38 * (u / 0.3);
  }

  // Машину таскает: скорость рваная всю дистанцию. Слышно и видно.
  if (flags.unstable) {
    v *= 1 - 0.05 * Math.abs(Math.sin(u * 17));
  }

  // Нитро — короткий подхват в выбранный момент. Мимо момента подхват уходит в пустоту.
  if (nitroAt !== null) {
    const punch = flags.nitroWasted ? 0.04 : 0.11;
    v *= 1 + punch * Math.exp(-(((u - nitroAt) / 0.07) ** 2));
  }

  // Провал на второй половине: не те передаточные. Видно, что соперник уезжает.
  if (flags.fade && u > 0.55) v *= 1 - 0.09 * ((u - 0.55) / 0.45);

  // Перегрев на длинной при слабом радиаторе.
  if (flags.overheat && u > 0.7) v *= 1 - 0.08 * ((u - 0.7) / 0.3);

  return Math.max(0.02, v);
}

const NITRO_POINT: Record<string, number | null> = {
  none: null, early: 0.22, mid: 0.48, late: 0.76,
};

function gearAt(u: number): number {
  let gear = 1;
  for (const point of SHIFT_POINTS) if (u >= point) gear++;
  return gear;
}

interface Profile {
  finishTime: number;
  /** Кумулятивная доля дистанции по нормированному времени, длина RESOLUTION + 1. */
  table: Float64Array;
  flags: TuningFlags;
  nitroAt: number | null;
}

const RESOLUTION = 512;

function buildProfile(racer: Racer, odds: SideOdds, finishTime: number): Profile {
  const flags = odds.tuning.flags;
  const nitroAt = NITRO_POINT[racer.config.nitro] ?? null;
  const table = new Float64Array(RESOLUTION + 1);
  let sum = 0;
  for (let i = 1; i <= RESOLUTION; i++) {
    const u = (i - 0.5) / RESOLUTION;
    sum += speedShape(u, flags, nitroAt);
    table[i] = sum;
  }
  // Нормируем так, чтобы машина прошла ровно дистанцию ровно к своему времени финиша.
  for (let i = 0; i <= RESOLUTION; i++) table[i] = table[i]! / sum;
  return { finishTime, table, flags, nitroAt };
}

function progressAt(profile: Profile, t: number): number {
  if (t >= profile.finishTime) return 1;
  const x = (t / profile.finishTime) * RESOLUTION;
  const i = Math.floor(x);
  const lo = profile.table[i] ?? 0;
  const hi = profile.table[Math.min(RESOLUTION, i + 1)] ?? 1;
  return lo + (hi - lo) * (x - i);
}

/** Полный заезд: исход плюс раскадровка для Canvas и звука. */
export function race(input: RaceInput): RaceResult {
  const outcome = resolve(input);
  const { conditions } = input;
  const trackLength = TRACK_LENGTH[conditions.distance];

  // Свой поток чисел для раскадровки: подрутка картинки не должна двигать баланс.
  const rng = makeRng(`${input.seed}#storyboard`);

  const winnerOdds = outcome.winner === 'a' ? outcome.a : outcome.b;
  const loserOdds = outcome.winner === 'a' ? outcome.b : outcome.a;
  const pWinner = outcome.winner === 'a' ? outcome.pWinA : 1 - outcome.pWinA;

  // Время победителя: сильная и хорошо настроенная машина проезжает заметно быстрее,
  // но экранное время остаётся в требуемых 10–15 секундах.
  const reference = 200;
  const paceFactor = (reference / Math.max(40, winnerOdds.eff)) ** 0.16;
  const winnerTime = clamp(NOMINAL_DURATION[conditions.distance] * paceFactor, 9.5, 15);

  // Разрыв: чем увереннее был фаворит, тем шире. Чем неожиданнее победа, тем ближе фотофиниш.
  const confidence = clamp((pWinner - 0.5) * 2, 0, 1);
  const jitter = 0.8 + 0.4 * rng();
  const gap = (GAP_MIN + (GAP_MAX - GAP_MIN) * confidence ** 1.4) * jitter;
  const loserTime = winnerTime + gap;

  const aTime = outcome.winner === 'a' ? winnerTime : loserTime;
  const bTime = outcome.winner === 'a' ? loserTime : winnerTime;
  const aProfile = buildProfile(input.a, outcome.a, aTime);
  const bProfile = buildProfile(input.b, outcome.b, bTime);
  void loserOdds;

  const duration = Math.max(aTime, bTime);
  const frameCount = Math.ceil(duration * FPS) + 1;
  const dt = 1 / FPS;
  const frames: Frame[] = [];
  const events: RaceEvent[] = [{ t: 0, kind: 'start', side: null }];

  let prevA = 0;
  let prevB = 0;
  let prevGearA = 1;
  let prevGearB = 1;
  let lead: Side | null = null;
  let finishedA = false;
  let finishedB = false;

  for (let i = 0; i < frameCount; i++) {
    const t = i * dt;
    const pa = progressAt(aProfile, t);
    const pb = progressAt(bProfile, t);
    const da = pa * trackLength;
    const db = pb * trackLength;
    const ua = Math.min(1, t / aTime);
    const ub = Math.min(1, t / bTime);
    const gearA = gearAt(ua);
    const gearB = gearAt(ub);

    frames.push({
      t,
      a: { distance: da, progress: pa, speed: (da - prevA) / dt, gear: gearA, finished: pa >= 1 },
      b: { distance: db, progress: pb, speed: (db - prevB) / dt, gear: gearB, finished: pb >= 1 },
    });

    if (gearA > prevGearA) events.push({ t, kind: 'shift', side: 'a', gear: gearA });
    if (gearB > prevGearB) events.push({ t, kind: 'shift', side: 'b', gear: gearB });

    const nowLead: Side | null = da > db + 0.5 ? 'a' : db > da + 0.5 ? 'b' : lead;
    if (nowLead && nowLead !== lead) events.push({ t, kind: 'lead', side: nowLead });
    lead = nowLead;

    if (!finishedA && pa >= 1) { events.push({ t: aTime, kind: 'finish', side: 'a' }); finishedA = true; }
    if (!finishedB && pb >= 1) { events.push({ t: bTime, kind: 'finish', side: 'b' }); finishedB = true; }

    prevA = da;
    prevB = db;
    prevGearA = gearA;
    prevGearB = gearB;
  }

  // Маркеры причины проигрыша. Игра их показывает, а не объясняет словами (§3).
  for (const [side, profile] of [['a', aProfile], ['b', bProfile]] as const) {
    if (profile.flags.wheelspin) events.push({ t: 0.05, kind: 'wheelspin', side });
    if (profile.flags.bog) events.push({ t: 0.05, kind: 'bog', side });
    if (profile.flags.unstable) events.push({ t: 0.2 * profile.finishTime, kind: 'unstable', side });
    if (profile.nitroAt !== null) {
      events.push({
        t: profile.nitroAt * profile.finishTime,
        kind: profile.flags.nitroWasted ? 'nitroWasted' : 'nitro',
        side,
      });
    } else {
      // Баллона нет — момент, в который соперник уедет, а эта машина нет.
      events.push({ t: 0.5 * profile.finishTime, kind: 'noNitro', side });
    }
    if (profile.flags.fade) events.push({ t: 0.55 * profile.finishTime, kind: 'fade', side });
    if (profile.flags.overheat) events.push({ t: 0.7 * profile.finishTime, kind: 'overheat', side });
  }
  events.sort((x, y) => x.t - y.t);

  return {
    ...outcome,
    seed: input.seed,
    conditions,
    trackLength,
    finishTime: { a: aTime, b: bTime },
    winnerTime,
    duration,
    photoFinish: Math.abs(aTime - bTime) < PHOTO_FINISH,
    frames,
    events,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
