/** Тесты ядра заезда: node --test scripts/core.test.ts (npm test). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASS_RANGES, MIRACLE_RATIO, allConfigs, bestConfigFor, effective, emptySpecs,
  evaluateTuning, favouriteStakeMultiplier, getModel, makeRng, maxedCar, race, resolve,
  stockCar, strength, underdogExpectedValue, winProbability,
  type Conditions, type RaceConfig, type RaceInput,
} from '../src/core/index.ts';

const DRY: Conditions = { distance: 'medium', surface: 'dry', profile: 'flat' };
const SLOPPY: RaceConfig = { tires: 'rain', gearing: 'long', pressure: 'high', nitro: 'none', weightCut: 2 };

function input(overrides: Partial<RaceInput> = {}): RaceInput {
  return {
    a: { name: 'A', car: stockCar('zarya965'), config: bestConfigFor(DRY) },
    b: { name: 'B', car: maxedCar('zarya965'), config: SLOPPY },
    conditions: DRY,
    seed: 'test-seed',
    ...overrides,
  };
}

test('сид полностью определяет заезд', () => {
  assert.deepEqual(race(input()), race(input()));
});

test('разные сиды дают разные исходы', () => {
  const winners = new Set<string>();
  for (let i = 0; i < 200; i++) winners.add(resolve(input({ seed: `s${i}` })).winner);
  assert.equal(winners.size, 2, 'при близких машинах должны встречаться обе стороны');
});

test('в ядре нет Math.random', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  for (const file of readdirSync('src/core')) {
    const source = readFileSync(`src/core/${file}`, 'utf8');
    assert.equal(source.includes('Math.random'), false, `${file} использует Math.random`);
  }
});

test('формула воспроизводит таблицу §3', () => {
  const table: [number, number][] = [[1, 0.5], [1.2, 0.325], [1.35, 0.231], [1.5, 0.165], [2, 0.059], [3, 0.012]];
  for (const [ratio, expected] of table) {
    assert.ok(Math.abs(winProbability(1, ratio) - expected) < 0.001, `x${ratio}`);
  }
});

test('настройка даёт ровно +33% эффективной силы', () => {
  assert.equal(effective(100, 0), 75);
  assert.equal(effective(100, 1), 100);
  assert.ok(Math.abs(effective(100, 1) / effective(100, 0) - 4 / 3) < 1e-9);
});

test('победитель раскадровки — победитель броска', () => {
  for (let i = 0; i < 500; i++) {
    const result = race(input({ seed: `frames-${i}` }));
    const firstToFinish = result.finishTime.a < result.finishTime.b ? 'a' : 'b';
    assert.equal(firstToFinish, result.winner);
    const last = result.frames.at(-1)!;
    assert.ok(Math.abs(last.a.distance - result.trackLength) < 1);
    assert.ok(Math.abs(last.b.distance - result.trackLength) < 1);
  }
});

test('заезд решается за 10–15 секунд', () => {
  for (const distance of ['short', 'medium', 'long'] as const)
    for (let i = 0; i < 200; i++) {
      const result = race(input({ conditions: { ...DRY, distance }, seed: `dur-${distance}-${i}` }));
      assert.ok(result.winnerTime >= 9.5 && result.winnerTime <= 15.01, `${distance}: ${result.winnerTime}`);
      assert.ok(result.duration <= 18, `хвост слишком длинный: ${result.duration}`);
    }
});

test('дистанция проходится монотонно', () => {
  const result = race(input({ seed: 'monotonic' }));
  for (let i = 1; i < result.frames.length; i++) {
    assert.ok(result.frames[i]!.a.distance >= result.frames[i - 1]!.a.distance - 1e-9);
    assert.ok(result.frames[i]!.b.distance >= result.frames[i - 1]!.b.distance - 1e-9);
  }
});

test('прокачка упирается ровно в потолок класса', () => {
  for (const modelId of ['zarya965', 'lada6', 'ronin_gx', 'bavar320', 'corsa_f40']) {
    const klass = getModel(modelId).klass;
    assert.ok(Math.abs(strength(maxedCar(modelId)) - CLASS_RANGES[klass].max) < 1e-6, modelId);
    assert.ok(strength(stockCar(modelId)) >= CLASS_RANGES[klass].min);
  }
});

test('идеальная настройка под условия даёт качество 1.0', () => {
  for (const distance of ['short', 'medium', 'long'] as const)
    for (const surface of ['dry', 'wet'] as const)
      for (const profile of ['flat', 'uphill'] as const) {
        const conditions = { distance, surface, profile };
        const quality = evaluateTuning(bestConfigFor(conditions), conditions).quality;
        assert.ok(Math.abs(quality - 1) < 1e-9, `${distance}/${surface}/${profile}: ${quality}`);
      }
});

test('качество настройки всегда в [0,1]', () => {
  for (const config of allConfigs()) {
    const quality = evaluateTuning(config, DRY).quality;
    assert.ok(quality >= 0 && quality <= 1);
  }
});

test('грубая ошибка настройки всегда видна в заезде', () => {
  let mistakes = 0;
  let visible = 0;
  for (const config of allConfigs())
    for (const distance of ['short', 'medium', 'long'] as const)
      for (const surface of ['dry', 'wet'] as const) {
        const conditions: Conditions = { distance, surface, profile: 'flat' };
        const tuning = evaluateTuning(config, conditions);
        if (tuning.quality >= 0.7) continue;
        mistakes++;
        if (Object.values(tuning.flags).some(Boolean)) visible++;
      }
  assert.ok(visible / mistakes > 0.95, `видно ${visible}/${mistakes}`);
});

test('ставка вызова ограничена x10 и не даёт фармить', () => {
  assert.ok(Math.abs(favouriteStakeMultiplier(winProbability(1, 1.2)) - 2.1) < 0.05);
  assert.equal(favouriteStakeMultiplier(winProbability(1, 3)), 10);
  for (const ratio of [1.2, 1.5, 2, 3, 5]) {
    assert.ok(underdogExpectedValue(winProbability(1, ratio)) <= 1e-9, `x${ratio} должен быть невыгоден`);
  }
});

test('чудо помечается только при разнице втрое', () => {
  const outcome = resolve({
    a: { name: 'A', car: stockCar('zarya965'), config: bestConfigFor(DRY) },
    b: { name: 'B', car: maxedCar('corsa_f40'), config: bestConfigFor(DRY) },
    conditions: DRY,
    seed: 'miracle',
  });
  assert.ok(outcome.strengthRatio >= MIRACLE_RATIO);
  assert.equal(outcome.miracle, outcome.winner === 'a');
});

test('поток случайных чисел равномерен', () => {
  const rng = makeRng('uniformity');
  const buckets = new Array(10).fill(0);
  const n = 200_000;
  for (let i = 0; i < n; i++) buckets[Math.floor(rng() * 10)]!++;
  for (const count of buckets) assert.ok(Math.abs(count - n / 10) < n / 100, `перекос: ${count}`);
});

test('пустые характеристики — это сток', () => {
  assert.deepEqual(stockCar('zarya965').specs, emptySpecs());
  assert.equal(strength(stockCar('zarya965')), 100);
});
