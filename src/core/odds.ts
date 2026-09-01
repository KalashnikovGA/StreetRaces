/**
 * Формула заезда — §3. Параметры подобраны симуляцией: K = 4, BASE = 0.75.
 * Меняются только здесь и только вместе с прогоном scripts/balance.ts.
 */

import type { Conditions, RaceConfig, Racer } from './types.ts';
import { strength } from './cars.ts';
import { evaluateTuning, type TuningBreakdown } from './tuning.ts';

/** Показатель взвешенного броска. Чем выше, тем реже слабый выносит сильного. */
export const K = 4;
/** Доля силы, которая работает даже при нулевой настройке. Настройка даёт до +33%. */
export const BASE = 0.75;

/** Порог, с которого победа считается чудом и просится в ссылку (§3, §6). */
export const MIRACLE_RATIO = 3;

/** Потолок асимметричной ставки в вызове по ссылке (§4). */
export const STAKE_CAP = 10;

/** eff = сила * (0.75 + 0.25 * качество_настройки) */
export function effective(carStrength: number, quality: number): number {
  return carStrength * (BASE + (1 - BASE) * quality);
}

/** p_win_A = effA^K / (effA^K + effB^K) */
export function winProbability(effA: number, effB: number): number {
  const a = effA ** K;
  const b = effB ** K;
  return a / (a + b);
}

export interface SideOdds {
  strength: number;
  tuning: TuningBreakdown;
  eff: number;
}

export function sideOdds(car: Racer['car'], config: RaceConfig, conditions: Conditions): SideOdds {
  const carStrength = strength(car);
  const tuning = evaluateTuning(config, conditions, car);
  return { strength: carStrength, tuning, eff: effective(carStrength, tuning.quality) };
}

/**
 * Асимметричная ставка вызова по ссылке (§4).
 * k = (1 - p_слабого) / p_слабого, сверху ограничено STAKE_CAP.
 * Фаворит ставит в k раз больше аутсайдера.
 */
export function favouriteStakeMultiplier(underdogWinProbability: number): number {
  const p = Math.min(Math.max(underdogWinProbability, 1e-6), 1 - 1e-6);
  return Math.min(STAKE_CAP, (1 - p) / p);
}

/** Ожидание аутсайдера на единицу его ставки. Отрицательное — вызов остаётся лотерейным билетом. */
export function underdogExpectedValue(underdogWinProbability: number): number {
  const k = favouriteStakeMultiplier(underdogWinProbability);
  return underdogWinProbability * k - (1 - underdogWinProbability);
}
