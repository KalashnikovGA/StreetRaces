/**
 * Качество настройки: насколько конфигурация подходит условиям — §3.
 * Настройка не добавляет мощности напрямую, она сужает или расширяет разброс.
 * Всё чисто и детерминированно, никакого состояния.
 */

import type {
  Car, Conditions, Distance, Gearing, Nitro, Pressure, RaceConfig, Tires, WeightCut,
} from './types.ts';

export const TIRES: Tires[] = ['slick', 'sport', 'rain'];
export const GEARINGS: Gearing[] = ['short', 'medium', 'long'];
export const PRESSURES: Pressure[] = ['low', 'normal', 'high'];
export const NITROS: Nitro[] = ['none', 'early', 'mid', 'late'];
export const WEIGHT_CUTS: WeightCut[] = [0, 1, 2];

/** Вес осей настройки. Сумма = 1. Резина решает больше всего — она же и объясняет проигрыш. */
export const AXIS_WEIGHTS = {
  tires: 0.30,
  gearing: 0.25,
  pressure: 0.15,
  nitro: 0.15,
  weightCut: 0.15,
} as const;

export type TuningAxis = keyof typeof AXIS_WEIGHTS;

export interface TuningBreakdown {
  /** Оценка по каждой оси, 0..1 — сырая, до нормировки. */
  axes: Record<TuningAxis, number>;
  /** Итоговое качество 0..1, нормированное на лучшую возможную настройку под эти условия. */
  quality: number;
  /** Сырое, ненормированное качество. Для отладки. */
  raw: number;
  /** Маркеры, которые заезд обязан показать глазами, без слов (§3). */
  flags: TuningFlags;
}

/**
 * Маркеры ошибки, которые заезд показывает глазами и ушами, без текста (§3, §10).
 * Каждая ось настройки обязана иметь свой маркер: иначе игрок проигрывает,
 * не понимая, где ошибся, и проигрыш читается как невезение.
 */
export interface TuningFlags {
  /** Резина не под покрытие: буксует со старта и не отыгрывает разрыв. */
  wheelspin: boolean;
  /** Слишком длинные передачи на короткой: не едет с места. */
  bog: boolean;
  /** Передаточные не под дистанцию: провал на второй половине. */
  fade: boolean;
  /** Давление или снятый вес мимо: машину таскает, скорость рваная. */
  unstable: boolean;
  /** Нитро нажато не в тот момент: подхват в пустоту. */
  nitroWasted: boolean;
  /** Нитро не нажато вообще: соперник подхватил, ты нет. Видно по разрыву. */
  noNitro: boolean;
  /** Слабый радиатор на длинной дистанции: перегрев к финишу. */
  overheat: boolean;
}

const DISTANCE_INDEX: Record<Distance, number> = { short: 0, medium: 1, long: 2 };

/** Линейный штраф за отклонение от идеала: 0 отклонения → 1, дальше вниз до нуля. */
function proximity(choice: number, ideal: number, penalty: number): number {
  return Math.max(0, 1 - penalty * Math.abs(choice - ideal));
}

function tiresScore(tires: Tires, c: Conditions): number {
  if (c.surface === 'dry') {
    return tires === 'slick' ? 1 : tires === 'sport' ? 0.75 : 0.15;
  }
  return tires === 'rain' ? 1 : tires === 'sport' ? 0.7 : 0.1;
}

function gearingScore(gearing: Gearing, c: Conditions): number {
  // Короткая дистанция и подъём просят коротких передач, длинная и ровная — длинных.
  const ideal = DISTANCE_INDEX[c.distance] - (c.profile === 'uphill' ? 0.6 : 0);
  return proximity(GEARINGS.indexOf(gearing), ideal, 0.5);
}

function pressureScore(pressure: Pressure, c: Conditions): number {
  // По сухому спускают — больше пятно контакта. По мокрому подкачивают — меньше аквапланирования.
  const ideal = (c.surface === 'dry' ? 0.4 : 1.6) + (c.profile === 'uphill' ? 0.2 : 0);
  return proximity(PRESSURES.indexOf(pressure), ideal, 0.5);
}

function nitroScore(nitro: Nitro, c: Conditions): number {
  // «Не жать» — не ошибка, но и не решение. Всегда посредственно.
  if (nitro === 'none') return 0.3;
  const ideal = DISTANCE_INDEX[c.distance] + (c.profile === 'uphill' ? 0.3 : 0);
  return proximity(NITROS.indexOf(nitro) - 1, ideal, 0.45);
}

function weightCutScore(weightCut: WeightCut, c: Conditions): number {
  // Снятый вес тянет в подъём, но по мокрому лишает сцепления.
  let ideal = 1;
  if (c.profile === 'uphill') ideal += 0.7;
  if (c.surface === 'wet') ideal -= 0.7;
  ideal += c.distance === 'short' ? 0.2 : c.distance === 'long' ? -0.2 : 0;
  return proximity(weightCut, ideal, 0.5);
}

function rawQuality(axes: Record<TuningAxis, number>): number {
  let sum = 0;
  for (const axis of Object.keys(AXIS_WEIGHTS) as TuningAxis[]) {
    sum += AXIS_WEIGHTS[axis] * axes[axis];
  }
  return sum;
}

function scoreAxes(config: RaceConfig, c: Conditions): Record<TuningAxis, number> {
  return {
    tires: tiresScore(config.tires, c),
    gearing: gearingScore(config.gearing, c),
    pressure: pressureScore(config.pressure, c),
    nitro: nitroScore(config.nitro, c),
    weightCut: weightCutScore(config.weightCut, c),
  };
}

/** Все 324 конфигурации. Пространство решений игрока целиком. */
export function allConfigs(): RaceConfig[] {
  const out: RaceConfig[] = [];
  for (const tires of TIRES)
    for (const gearing of GEARINGS)
      for (const pressure of PRESSURES)
        for (const nitro of NITROS)
          for (const weightCut of WEIGHT_CUTS)
            out.push({ tires, gearing, pressure, nitro, weightCut });
  return out;
}

const bestRawCache = new Map<string, number>();

export function conditionsKey(c: Conditions): string {
  return `${c.distance}/${c.surface}/${c.profile}`;
}

/**
 * Лучшее сырое качество, достижимое в этих условиях. Нужно для нормировки:
 * «идеально угадал» обязано давать ровно 1.0, каких бы условий это ни касалось.
 */
export function bestRawQuality(c: Conditions): number {
  const key = conditionsKey(c);
  const cached = bestRawCache.get(key);
  if (cached !== undefined) return cached;
  let best = 0;
  for (const config of allConfigs()) {
    const value = rawQuality(scoreAxes(config, c));
    if (value > best) best = value;
  }
  bestRawCache.set(key, best);
  return best;
}

export function evaluateTuning(config: RaceConfig, c: Conditions, car?: Car): TuningBreakdown {
  const axes = scoreAxes(config, c);
  const raw = rawQuality(axes);
  const quality = Math.min(1, raw / bestRawQuality(c));
  const radiator = car?.specs.radiator ?? 10;
  return {
    axes,
    raw,
    quality,
    flags: {
      wheelspin: axes.tires < 0.4 || (c.surface === 'wet' && config.weightCut === 2),
      bog: c.distance === 'short' && config.gearing === 'long',
      fade: c.distance !== 'short' && axes.gearing < 0.5,
      unstable: axes.pressure < 0.45 || axes.weightCut < 0.45,
      nitroWasted: config.nitro !== 'none' && axes.nitro < 0.45,
      noNitro: config.nitro === 'none',
      overheat: c.distance === 'long' && radiator <= 3,
    },
  };
}

/** Конфигурация, идеально подходящая под условия. Ориентир для ботов и для проверки баланса. */
export function bestConfigFor(c: Conditions): RaceConfig {
  let best = allConfigs()[0]!;
  let bestValue = -1;
  for (const config of allConfigs()) {
    const value = rawQuality(scoreAxes(config, c));
    if (value > bestValue) {
      bestValue = value;
      best = config;
    }
  }
  return best;
}

export const DEFAULT_CONFIG: RaceConfig = {
  tires: 'sport',
  gearing: 'medium',
  pressure: 'normal',
  nitro: 'mid',
  weightCut: 1,
};
