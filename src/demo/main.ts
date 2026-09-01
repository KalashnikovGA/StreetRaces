/**
 * Единая демонстрационная страница: заезд и песочница на одном экране.
 * Собирается в один файл без внешних зависимостей, чтобы её можно было
 * открыть по ссылке и покликать, не поднимая проект локально.
 *
 * Игровой логики здесь нет — только разводка интерфейса поверх src/core.
 */

import {
  CAR_MODELS, MAX_SPEC_LEVEL, bestConfigFor, botCharacter, botConfig,
  favouriteStakeMultiplier, getModel, horsepower, makeRng, race, randomSeed, resolve,
  strength, underdogExpectedValue,
  type Car, type Conditions, type Gearing, type Nitro, type Pressure, type RaceConfig,
  type Racer, type Side, type SpecKey, type Tires, type WeightCut,
} from '../core/index.ts';
import type { RaceInput, RaceResult } from '../core/race.ts';
import { decodeRace, encodeRace } from '../replay/codec.ts';
import { RaceScene, type SideVisual } from '../render/scene.ts';
import { RaceAudio } from '../audio/engine.ts';
import { PAINTS } from '../render/palette.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const WORDS: Record<string, string> = {
  short: '402 метра', medium: '800 метров', long: '1600 метров',
  dry: 'сухо', wet: 'мокро', flat: 'ровно', uphill: 'в подъём',
  slick: 'слик', sport: 'спорт', rain: 'дождевая',
  low: 'спущено', normal: 'штатное', high: 'подкачано',
  none: 'не жать', early: 'на старте', mid: 'в середине', late: 'под конец',
};

const GEAR_WORDS: Record<string, string> = { short: 'короткие', medium: 'средние', long: 'длинные' };

const EVENT_WORDS: Record<string, string> = {
  start: 'зелёный',
  wheelspin: 'сорвал колёса',
  bog: 'не поехал с места',
  nitro: 'нитро',
  nitroWasted: 'нитро мимо момента',
  noNitro: 'без нитро',
  fade: 'встал на второй половине',
  unstable: 'машину таскает',
  overheat: 'перегрев',
  lead: 'вышел вперёд',
  finish: 'финиш',
};

// ─── Вкладки ─────────────────────────────────────────────────────────────────

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  button.addEventListener('click', () => {
    const target = button.dataset.tab!;
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    $('view-race').hidden = target !== 'race';
    $('view-sandbox').hidden = target !== 'sandbox';
    if (target === 'race') scene?.resize();
  });
}

// ─── Заезд ───────────────────────────────────────────────────────────────────

const audio = new RaceAudio();
let scene: RaceScene | null = null;
let current: RaceInput;

const PAINT_KEYS = Object.keys(PAINTS);

function visualFor(input: RaceInput, side: Side): SideVisual {
  const rng = makeRng(`${input.seed}/paint/${side}`);
  return {
    name: input[side].name,
    pimp: {
      paint: PAINT_KEYS[Math.floor(rng() * PAINT_KEYS.length)]!,
      neon: rng() < 0.35 ? '#6fd3ff' : null,
      drop: rng(),
    },
  };
}

function randomOpponent(): RaceInput {
  const seed = randomSeed(Math.random);
  const rng = makeRng(`${seed}/setup`);
  const conditions: Conditions = {
    distance: (['short', 'medium', 'long'] as const)[Math.floor(rng() * 3)]!,
    surface: rng() < 0.35 ? 'wet' : 'dry',
    profile: rng() < 0.3 ? 'uphill' : 'flat',
  };
  const rival = CAR_MODELS[Math.floor(rng() * CAR_MODELS.length)]!;
  const level = () => Math.floor(rng() * 11);
  const a: Racer = {
    name: 'Ты',
    car: {
      modelId: 'zarya965',
      specs: { tires: 6, ignition: 5, clutch: 5, suspension: 4, boost: 7, intake: 5, radiator: 4 },
    },
    config: bestConfigFor(conditions),
  };
  const b: Racer = {
    name: 'Сосед по двору',
    car: {
      modelId: rival.id,
      specs: {
        tires: level(), ignition: level(), clutch: level(), suspension: level(),
        boost: level(), intake: level(), radiator: level(),
      },
    },
    config: botConfig(conditions, 'regular', botCharacter(rng), rng),
  };
  return { a, b, conditions, seed };
}

function configLine(config: RaceConfig): string {
  return [
    `резина ${WORDS[config.tires]}`,
    `передаточные ${GEAR_WORDS[config.gearing]}`,
    `давление ${WORDS[config.pressure]}`,
    `нитро ${WORDS[config.nitro]}`,
    `вес −${config.weightCut}`,
  ].join(' · ');
}

function renderCard(input: RaceInput, result: RaceResult, side: Side): string {
  const racer = input[side];
  const model = getModel(racer.car.modelId);
  const odds = result[side];
  const chance = side === 'a' ? result.pWinA : 1 - result.pWinA;
  const flags = Object.entries(odds.tuning.flags).filter(([, on]) => on).map(([key]) => key);
  return `
    <article class="racer">
      <div class="racer-head">
        <h3>${racer.name}</h3>
        <span class="klass">класс ${model.klass}</span>
      </div>
      <p class="nick">${model.nick} <span class="dim">${model.name}</span></p>
      <dl class="figures">
        <div><dt>Мощность</dt><dd>${horsepower(racer.car)} <span class="unit">л.с.</span></dd></div>
        <div><dt>Сила</dt><dd>${strength(racer.car).toFixed(0)}</dd></div>
        <div><dt>Шанс</dt><dd class="chance">${(chance * 100).toFixed(1)}<span class="unit">%</span></dd></div>
      </dl>
      <p class="meter-label">Настройка под условия <b>${(odds.tuning.quality * 100).toFixed(0)}%</b></p>
      <div class="meter"><i style="width:${(odds.tuning.quality * 100).toFixed(0)}%"></i></div>
      <p class="setup">${configLine(racer.config)}</p>
      ${flags.length ? `<p class="flags">${flags.map((f) => `<span>${EVENT_WORDS[f] ?? f}</span>`).join('')}</p>` : ''}
    </article>`;
}

function renderBrief(input: RaceInput, result: RaceResult): void {
  $('conditions').textContent = [
    WORDS[input.conditions.distance], WORDS[input.conditions.surface], WORDS[input.conditions.profile],
  ].join(' · ');
  $('brief').innerHTML = renderCard(input, result, 'a') + renderCard(input, result, 'b');

  const underdog = Math.min(result.pWinA, 1 - result.pWinA);
  $('stake').innerHTML = `
    <div><dt>Разница в силе</dt><dd>×${result.strengthRatio.toFixed(2)}</dd></div>
    <div><dt>Фаворит ставит</dt><dd>×${favouriteStakeMultiplier(underdog).toFixed(1)}</dd></div>
    <div><dt>Ожидание аутсайдера</dt><dd>${underdogExpectedValue(underdog).toFixed(2)}</dd></div>`;
}

function renderTimeline(input: RaceInput, result: RaceResult): void {
  const rows = result.events
    .filter((event) => event.kind !== 'shift' && event.kind !== 'noNitro')
    .map((event) => {
      const who = event.side ? input[event.side].name : '—';
      return `<tr><td>${event.t.toFixed(2)}</td><td>${who}</td><td>${EVENT_WORDS[event.kind] ?? event.kind}</td></tr>`;
    })
    .join('');
  $('timeline').innerHTML = `<table><tbody>${rows}</tbody></table>`;

  const winnerChance = result.winner === 'a' ? result.pWinA : 1 - result.pWinA;
  $('outcome').innerHTML = `
    <div><dt>Победитель</dt><dd>${input[result.winner].name}</dd></div>
    <div><dt>Шанс до старта</dt><dd>${(winnerChance * 100).toFixed(1)}%</dd></div>
    <div><dt>Разрыв</dt><dd>${Math.abs(result.finishTime.a - result.finishTime.b).toFixed(2)} с</dd></div>
    <div><dt>Заезд / на экране</dt><dd>${result.winnerTime.toFixed(1)} с / ${result.screenDuration} с</dd></div>
    <div><dt>Бросок</dt><dd>${result.roll.toFixed(4)}</dd></div>`;
}

function loadRace(input: RaceInput): void {
  current = input;
  scene?.stop();
  audio.stop();
  $('verdict').textContent = '';
  $('verdict').className = 'verdict';

  const result = race(input);
  const topSpeed = Math.max(...result.frames.map((f) => Math.max(f.a.speed, f.b.speed)));

  scene = new RaceScene({
    canvas: $('track') as unknown as HTMLCanvasElement,
    input,
    result,
    visuals: { a: visualFor(input, 'a'), b: visualFor(input, 'b') },
    onLights: (step) => audio.light(step),
    onFrame: (frame, t) => {
      audio.frame(frame, topSpeed);
      if (t >= 0 && t < 0.15) {
        for (const side of ['a', 'b'] as const) {
          if (result[side].tuning.flags.wheelspin) audio.wheelspin(side === 'a' ? 1 : 0.6);
        }
      }
    },
    onFinish: () => {
      audio.finish();
      $<HTMLButtonElement>('run').disabled = false;
      const tail = result.miracle ? 'чудо'
        : result.photoFinish ? 'фотофиниш'
        : result.upset ? 'апсет' : '';
      $('verdict').textContent = `${input[result.winner].name} забрал${tail ? ` — ${tail}` : ''}`;
      $('verdict').className = `verdict ${result.winner === 'a' ? 'is-win' : 'is-loss'}`;
    },
  });

  scene.renderAt(-1);
  renderBrief(input, result);
  renderTimeline(input, result);
  // В поле лежит сам код, а не адрес: 24 символа читаются, длинный URL — нет.
  $<HTMLInputElement>('replay').value = encodeRace(input);
}

$('run').addEventListener('click', async () => {
  $<HTMLButtonElement>('run').disabled = true;
  try {
    await audio.start();
  } catch {
    // Звук могли не разрешить — заезд всё равно едет.
  }
  loadRace(current);
  scene?.play();
});

$('again').addEventListener('click', () => loadRace(randomOpponent()));

$('sound').addEventListener('click', () => {
  audio.setMuted(!audio.isMuted());
  $('sound').textContent = audio.isMuted() ? 'Звук выключен' : 'Звук включён';
});

$('copy').addEventListener('click', async () => {
  const field = $<HTMLInputElement>('replay');
  try {
    await navigator.clipboard.writeText(field.value);
    $('copy').textContent = 'Скопировано';
  } catch {
    field.select();
    $('copy').textContent = 'Выделено — Ctrl+C';
  }
  setTimeout(() => { $('copy').textContent = 'Скопировать'; }, 1800);
});

$('replay').addEventListener('input', () => {
  const value = $<HTMLInputElement>('replay').value;
  const code = value.includes('#r=') ? value.split('#r=')[1]! : value;
  try {
    loadRace(decodeRace(code, { a: 'Ты', b: 'Соперник' }));
    $('replay-note').textContent = 'Повтор распакован. Нажмите «Старт».';
  } catch {
    $('replay-note').textContent = 'Это не похоже на код повтора.';
  }
});

window.addEventListener('resize', () => {
  scene?.resize();
  scene?.renderAt(-1);
});

// ─── Песочница ───────────────────────────────────────────────────────────────

const SPEC_LABELS: Record<SpecKey, string> = {
  tires: 'Шины', ignition: 'Зажигание', clutch: 'Сцепление', suspension: 'Подвеска',
  boost: 'Наддув', intake: 'Впуск', radiator: 'Радиатор',
};

const CONFIG_FIELDS = [
  { key: 'tires', label: 'Резина', options: ['slick', 'sport', 'rain'] },
  { key: 'gearing', label: 'Передаточные', options: ['short', 'medium', 'long'] },
  { key: 'pressure', label: 'Давление', options: ['low', 'normal', 'high'] },
  { key: 'nitro', label: 'Нитро', options: ['none', 'early', 'mid', 'late'] },
] as const;

interface SideState { car: Car; config: RaceConfig }

const lab: Record<Side, SideState> = {
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
  return {
    tires: level, ignition: level, clutch: level, suspension: level,
    boost: level, intake: level, radiator: level,
  };
}

function labConditions(): Conditions {
  return {
    distance: $<HTMLSelectElement>('lab-distance').value as Conditions['distance'],
    surface: $<HTMLSelectElement>('lab-surface').value as Conditions['surface'],
    profile: $<HTMLSelectElement>('lab-profile').value as Conditions['profile'],
  };
}

function labInput(seed = $<HTMLInputElement>('lab-seed').value): RaceInput {
  return {
    a: { name: 'A', car: lab.a.car, config: lab.a.config },
    b: { name: 'B', car: lab.b.car, config: lab.b.config },
    conditions: labConditions(),
    seed: seed || 'seed',
  };
}

function buildLabSide(side: Side): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel lab-car';
  panel.innerHTML = `<h2 class="eyebrow">Машина ${side.toUpperCase()}</h2>`;

  const model = document.createElement('select');
  model.className = 'wide';
  for (const item of CAR_MODELS) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.klass} · ${item.nick}`;
    model.append(option);
  }
  model.value = lab[side].car.modelId;
  model.addEventListener('change', () => {
    lab[side].car = { ...lab[side].car, modelId: model.value };
    refreshLab();
  });
  panel.append(model);

  for (const key of Object.keys(SPEC_LABELS) as SpecKey[]) {
    const row = document.createElement('div');
    row.className = 'slider';
    const label = document.createElement('label');
    label.textContent = SPEC_LABELS[key];
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = String(MAX_SPEC_LEVEL);
    range.value = String(lab[side].car.specs[key]);
    const value = document.createElement('output');
    value.textContent = range.value;
    range.addEventListener('input', () => {
      lab[side].car.specs[key] = Number(range.value);
      value.textContent = range.value;
      refreshLab();
    });
    row.append(label, range, value);
    panel.append(row);
  }

  const grid = document.createElement('div');
  grid.className = 'lab-config';
  for (const field of CONFIG_FIELDS) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = field.label;
    const select = document.createElement('select');
    for (const option of field.options) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = field.key === 'gearing' ? GEAR_WORDS[option]! : WORDS[option]!;
      select.append(node);
    }
    select.value = String(lab[side].config[field.key]);
    select.addEventListener('change', () => {
      const config = lab[side].config;
      if (field.key === 'tires') config.tires = select.value as Tires;
      else if (field.key === 'gearing') config.gearing = select.value as Gearing;
      else if (field.key === 'pressure') config.pressure = select.value as Pressure;
      else config.nitro = select.value as Nitro;
      refreshLab();
    });
    wrap.append(label, select);
    grid.append(wrap);
  }

  const weight = document.createElement('div');
  const weightLabel = document.createElement('label');
  weightLabel.textContent = 'Снятие веса';
  const weightSelect = document.createElement('select');
  for (const [value, text] of [['0', 'нет'], ['1', 'частично'], ['2', 'полностью']] as const) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = text;
    weightSelect.append(node);
  }
  weightSelect.value = String(lab[side].config.weightCut);
  weightSelect.addEventListener('change', () => {
    lab[side].config.weightCut = Number(weightSelect.value) as WeightCut;
    refreshLab();
  });
  weight.append(weightLabel, weightSelect);
  grid.append(weight);
  panel.append(grid);

  const tune = document.createElement('button');
  tune.className = 'ghost';
  tune.textContent = 'Настроить идеально под условия';
  tune.addEventListener('click', () => {
    lab[side].config = bestConfigFor(labConditions());
    renderLab();
  });
  panel.append(tune);
  return panel;
}

function renderLab(): void {
  $('lab-cars').replaceChildren(buildLabSide('a'), buildLabSide('b'));
  refreshLab();
}

function refreshLab(): void {
  const outcome = resolve(labInput());
  const rows: string[] = [];
  for (const side of ['a', 'b'] as const) {
    const odds = outcome[side];
    const chance = side === 'a' ? outcome.pWinA : 1 - outcome.pWinA;
    rows.push(`
      <div class="lab-side">
        <h4>Машина ${side.toUpperCase()} <b>${(chance * 100).toFixed(2)}%</b></h4>
        <dl class="figures compact">
          <div><dt>Сила</dt><dd>${odds.strength.toFixed(1)}</dd></div>
          <div><dt>Настройка</dt><dd>${(odds.tuning.quality * 100).toFixed(1)}%</dd></div>
          <div><dt>Эффективная</dt><dd>${odds.eff.toFixed(1)}</dd></div>
        </dl>
        <div class="axes">${
          Object.entries(odds.tuning.axes).map(([axis, score]) =>
            `<span><i style="height:${Math.max(4, score * 100).toFixed(0)}%"></i><em>${axis}</em></span>`).join('')
        }</div>
      </div>`);
  }
  $('lab-odds').innerHTML = rows.join('');
  $('lab-formula').textContent =
    `eff_A ${outcome.a.eff.toFixed(1)} · eff_B ${outcome.b.eff.toFixed(1)} → ` +
    `p = ${outcome.a.eff.toFixed(1)}⁴ / (${outcome.a.eff.toFixed(1)}⁴ + ${outcome.b.eff.toFixed(1)}⁴) = ` +
    `${(outcome.pWinA * 100).toFixed(2)}%`;
}

function runBatch(n: number): void {
  const base = labInput();
  const started = performance.now();
  let winsA = 0;
  for (let i = 0; i < n; i++) {
    if (resolve({ ...base, seed: `${base.seed}/${i}` }).winner === 'a') winsA++;
  }
  const expected = resolve(base).pWinA;
  const empirical = winsA / n;
  const delta = (empirical - expected) * 100;
  $('lab-batch').innerHTML = `
    <div><dt>Заездов</dt><dd>${n.toLocaleString('ru')}</dd></div>
    <div><dt>Формула</dt><dd>${(expected * 100).toFixed(2)}%</dd></div>
    <div><dt>Эмпирика</dt><dd>${(empirical * 100).toFixed(2)}%</dd></div>
    <div><dt>Расхождение</dt><dd class="${Math.abs(delta) < 1 ? 'ok' : 'warn'}">${
      delta >= 0 ? '+' : ''}${delta.toFixed(2)} п.п.</dd></div>
    <div><dt>Время</dt><dd>${(performance.now() - started).toFixed(0)} мс</dd></div>`;
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-batch]')) {
  button.addEventListener('click', () => runBatch(Number(button.dataset.batch)));
}

for (const id of ['lab-distance', 'lab-surface', 'lab-profile', 'lab-seed']) {
  $(id).addEventListener('change', refreshLab);
}
$('lab-seed').addEventListener('input', refreshLab);
$('lab-reseed').addEventListener('click', () => {
  $<HTMLInputElement>('lab-seed').value = randomSeed(Math.random);
  refreshLab();
});

// ─── Запуск ──────────────────────────────────────────────────────────────────

const fromHash = (() => {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const code = params.get('r');
  if (!code) return null;
  try {
    return decodeRace(code, { a: params.get('a') ?? 'Ты', b: params.get('b') ?? 'Соперник' });
  } catch {
    return null;
  }
})();

loadRace(fromHash ?? randomOpponent());
renderLab();
