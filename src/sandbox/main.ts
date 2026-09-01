/**
 * Песочница баланса — Шаг 1 из §14: ползунки, сид, вывод в консоль.
 *
 * Здесь баланс проверяется руками: крутишь характеристики и настройку, смотришь,
 * как ведёт себя формула, и прогоняешь пачку заездов, чтобы эмпирика сошлась
 * с расчётом. Скрипт scripts/balance.ts делает то же самое автоматически.
 */

import '../styles.css';
import {
  CAR_MODELS, MAX_SPEC_LEVEL, bestConfigFor, favouriteStakeMultiplier, getModel,
  horsepower, randomSeed, resolve, underdogExpectedValue,
  type Car, type Conditions, type Gearing, type Nitro, type Pressure, type RaceConfig,
  type Side, type SpecKey, type Tires, type WeightCut,
} from '../core/index.ts';
import type { RaceInput } from '../core/race.ts';

const SPEC_LABELS: Record<SpecKey, string> = {
  tires: 'Шины',
  ignition: 'Зажигание',
  clutch: 'Сцепление',
  suspension: 'Подвеска',
  boost: 'Наддув',
  intake: 'Впуск',
  radiator: 'Радиатор',
};

const CONFIG_FIELDS = [
  { key: 'tires', label: 'Резина', options: [['slick', 'слик'], ['sport', 'спорт'], ['rain', 'дождевая']] },
  { key: 'gearing', label: 'Передаточные', options: [['short', 'короткие'], ['medium', 'средние'], ['long', 'длинные']] },
  { key: 'pressure', label: 'Давление', options: [['low', 'спущено'], ['normal', 'штатное'], ['high', 'подкачано']] },
  { key: 'nitro', label: 'Нитро', options: [['none', 'не жать'], ['early', 'на старте'], ['mid', 'в середине'], ['late', 'под конец']] },
  { key: 'weightCut', label: 'Снятие веса', options: [['0', 'нет'], ['1', 'частично'], ['2', 'полностью']] },
] as const;

interface SideState {
  car: Car;
  config: RaceConfig;
}

const state: Record<Side, SideState> = {
  a: {
    car: { modelId: 'zarya965', specs: fill(5) },
    config: { tires: 'slick', gearing: 'medium', pressure: 'low', nitro: 'mid', weightCut: 1 },
  },
  b: {
    car: { modelId: 'lada6', specs: fill(5) },
    config: { tires: 'sport', gearing: 'medium', pressure: 'normal', nitro: 'none', weightCut: 1 },
  },
};

function fill(level: number): Record<SpecKey, number> {
  return { tires: level, ignition: level, clutch: level, suspension: level, boost: level, intake: level, radiator: level };
}

const sidesBox = document.getElementById('sides') as HTMLElement;
const oddsBox = document.getElementById('odds') as HTMLElement;
const outBox = document.getElementById('out') as HTMLElement;
const seedInput = document.getElementById('seed') as HTMLInputElement;

function conditions(): Conditions {
  return {
    distance: (document.getElementById('distance') as HTMLSelectElement).value as Conditions['distance'],
    surface: (document.getElementById('surface') as HTMLSelectElement).value as Conditions['surface'],
    profile: (document.getElementById('profile') as HTMLSelectElement).value as Conditions['profile'],
  };
}

function input(seed = seedInput.value): RaceInput {
  return {
    a: { name: 'A', car: state.a.car, config: state.a.config },
    b: { name: 'B', car: state.b.car, config: state.b.config },
    conditions: conditions(),
    seed,
  };
}

function buildSide(side: Side): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `<h2>Машина ${side.toUpperCase()}</h2>`;

  const model = document.createElement('select');
  for (const item of CAR_MODELS) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.klass} · ${item.nick} — ${item.name}`;
    model.append(option);
  }
  model.value = state[side].car.modelId;
  model.addEventListener('change', () => {
    state[side].car = { ...state[side].car, modelId: model.value };
    refresh();
  });
  const modelField = document.createElement('div');
  modelField.className = 'field';
  modelField.innerHTML = '<label>Модель</label>';
  modelField.append(model);
  panel.append(modelField);

  for (const key of Object.keys(SPEC_LABELS) as SpecKey[]) {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${SPEC_LABELS[key]}</label>`;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = String(MAX_SPEC_LEVEL);
    range.value = String(state[side].car.specs[key]);
    const value = document.createElement('div');
    value.className = 'val';
    value.textContent = range.value;
    range.addEventListener('input', () => {
      state[side].car.specs[key] = Number(range.value);
      value.textContent = range.value;
      refresh();
    });
    field.append(range, value);
    panel.append(field);
  }

  for (const item of CONFIG_FIELDS) {
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `<label>${item.label}</label>`;
    const select = document.createElement('select');
    for (const [optionValue, optionLabel] of item.options) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionLabel;
      select.append(option);
    }
    select.value = String(state[side].config[item.key]);
    select.addEventListener('change', () => {
      const config = state[side].config;
      if (item.key === 'weightCut') config.weightCut = Number(select.value) as WeightCut;
      else if (item.key === 'tires') config.tires = select.value as Tires;
      else if (item.key === 'gearing') config.gearing = select.value as Gearing;
      else if (item.key === 'pressure') config.pressure = select.value as Pressure;
      else config.nitro = select.value as Nitro;
      refresh();
    });
    field.append(select);
    panel.append(field);
  }

  const best = document.createElement('button');
  best.textContent = 'Настроить идеально под условия';
  best.addEventListener('click', () => {
    state[side].config = bestConfigFor(conditions());
    render();
  });
  panel.append(best);
  return panel;
}

function render(): void {
  sidesBox.replaceChildren(buildSide('a'), buildSide('b'));
  refresh();
}

function refresh(): void {
  const current = input();
  const outcome = resolve(current);
  const rows: string[] = [];

  for (const side of ['a', 'b'] as const) {
    const odds = outcome[side];
    const model = getModel(current[side].car.modelId);
    rows.push(`
      <div class="stat" style="margin-top:8px"><span>Машина ${side.toUpperCase()}</span>
        <b>${model.nick} · класс ${model.klass} · ${horsepower(current[side].car)} л.с.</b></div>
      <div class="stat"><span>Сила</span><b>${odds.strength.toFixed(1)}</b></div>
      <div class="stat"><span>Качество настройки</span><b>${(odds.tuning.quality * 100).toFixed(1)}%</b></div>
      <div class="bar"><i style="width:${(odds.tuning.quality * 100).toFixed(0)}%"></i></div>
      <div class="stat"><span>Эффективная сила</span><b>${odds.eff.toFixed(1)}</b></div>
      <div class="muted">${
        Object.entries(odds.tuning.axes)
          .map(([axis, score]) => `${axis} ${(score * 100).toFixed(0)}%`).join(' · ')
      }</div>
      <div class="muted">маркеры: ${
        Object.entries(odds.tuning.flags).filter(([, on]) => on).map(([flag]) => flag).join(', ') || '—'
      }</div>`);
  }

  const p = outcome.pWinA;
  const underdog = Math.min(p, 1 - p);
  rows.push(`
    <div class="stat" style="margin-top:14px"><span>Шанс A</span><b>${(p * 100).toFixed(2)}%</b></div>
    <div class="stat"><span>Шанс B</span><b>${((1 - p) * 100).toFixed(2)}%</b></div>
    <div class="stat"><span>Разница в силе</span><b>x${outcome.strengthRatio.toFixed(3)}</b></div>
    <div class="stat"><span>Ставка фаворита в вызове</span><b>x${favouriteStakeMultiplier(underdog).toFixed(2)}</b></div>
    <div class="stat"><span>Ожидание аутсайдера</span><b>${underdogExpectedValue(underdog).toFixed(3)}</b></div>
    <div class="stat"><span>На этом сиде побеждает</span><b>${outcome.winner.toUpperCase()}</b></div>`);

  oddsBox.innerHTML = rows.join('');
  console.log('расклад', outcome);
}

function batch(n: number): void {
  const base = input();
  const start = performance.now();
  let winsA = 0;
  for (let i = 0; i < n; i++) {
    if (resolve({ ...base, seed: `${base.seed}/${i}` }).winner === 'a') winsA++;
  }
  const expected = resolve(base).pWinA;
  const empirical = winsA / n;
  const delta = (empirical - expected) * 100;
  outBox.textContent = [
    `заездов:        ${n.toLocaleString('ru')}`,
    `формула:        ${(expected * 100).toFixed(2)}%`,
    `эмпирика:       ${(empirical * 100).toFixed(2)}%`,
    `расхождение:    ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} п.п.`,
    `время:          ${(performance.now() - start).toFixed(0)} мс`,
    '',
    delta > 1 || delta < -1
      ? 'Расхождение больше процентного пункта — либо мало заездов, либо ошибка в броске.'
      : 'Сходится.',
  ].join('\n');
}

document.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((button) => {
  button.addEventListener('click', () => batch(Number(button.dataset.n)));
});

document.getElementById('reseed')!.addEventListener('click', () => {
  seedInput.value = randomSeed(Math.random);
  refresh();
});

for (const id of ['distance', 'surface', 'profile']) {
  document.getElementById(id)!.addEventListener('change', refresh);
}
seedInput.addEventListener('input', refresh);

// Сид из адреса, чтобы можно было прислать коллеге конкретный спорный случай.
const fromUrl = new URLSearchParams(location.search).get('seed');
if (fromUrl) seedInput.value = fromUrl;

render();
