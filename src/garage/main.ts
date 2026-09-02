/**
 * Гараж. Порядок блоков взят из оригинала и не переставляется (§9):
 * машина с цифрами и действиями → ряд запчастей → места в гараже →
 * последние гонки → сводка за карьеру.
 *
 * Косметика живёт отдельной вкладкой Pimp (§2), характеристики показаны
 * числами, а не полосками — числа в этой игре сравнивают.
 */

import '../ui/theme.css';
import './garage.css';
import {
  CLASS_RANGES, MAX_SPEC_LEVEL, getModel, horsepower, strength,
  type SpecKey,
} from '../core/index.ts';
import { PAINTS } from '../render/palette.ts';
import { mountChrome, mountFooter } from '../ui/chrome.ts';
import {
  career, currentIndex, formatCoins, lastRaces, owned, partPrice, purse, resaleValue,
} from '../ui/state.ts';
import { Garage } from './scene.ts';

const SPEC_LABELS: Record<SpecKey, string> = {
  tires: 'Шины',
  ignition: 'Зажигание',
  clutch: 'Сцепление',
  suspension: 'Подвеска',
  boost: 'Наддув',
  intake: 'Впуск',
  radiator: 'Радиатор',
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let index = currentIndex();
let garage: Garage | null = null;
/** Откуда брать GLB. В самодостаточной странице подменяется на data-URI. */
let resolveModelUrl: (modelId: string) => string = (id) => `/models/${id}.glb`;

// ── машина ───────────────────────────────────────────────────────────────────

function renderCard(): void {
  const entry = owned[index]!;
  const model = getModel(entry.car.modelId);
  const rating = strength(entry.car);
  const range = CLASS_RANGES[model.klass];

  $('car-nick').textContent = model.nick;
  $('car-model').textContent = model.name;

  const rows: [string, string][] = [
    ['Мощность', `${horsepower(entry.car)} л.с.`],
    ['Рейтинг', rating.toFixed(0)],
    ['Класс', `${model.klass} (${range.min}–${range.max})`],
    ['В цене', `${formatCoins(resaleValue(entry.car))} монет`],
    ['Побед', String(entry.wins)],
    ['Слил', String(entry.losses)],
  ];
  const sheet = $('car-sheet');
  sheet.replaceChildren(...rows.map(([label, value], i) => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = label;
    const val = document.createElement('td');
    val.textContent = value;
    // Рейтинг — та самая цифра, которую в оригинале сравнивали в первую очередь.
    if (i === 1) val.className = 'big';
    tr.append(td, val);
    return tr;
  }));

  const left = range.max - rating;
  $('ceiling').textContent = left < 0.5
    ? `Класс ${model.klass} выбран до потолка. Дальше — только следующая машина.`
    : `До потолка класса ${model.klass} ещё ${left.toFixed(0)} баллов рейтинга.`;

  ($('race') as HTMLAnchorElement).href = `/?car=${index}`;
  resetSell();
}

/** Продажа стирает историю машины (§6). Поэтому подтверждение, а не сразу. */
function resetSell(): void {
  const button = $('sell') as HTMLButtonElement;
  const entry = owned[index]!;
  button.textContent = 'Продать';
  button.dataset.armed = '';
  button.disabled = owned.length < 2;
  button.title = owned.length < 2
    ? 'Последнюю машину не продать: без машины не на чем ехать'
    : `${formatCoins(resaleValue(entry.car))} монет и минус ${entry.wins} побед в истории`;
}

$('sell').addEventListener('click', () => {
  const button = $('sell') as HTMLButtonElement;
  const entry = owned[index]!;
  if (button.dataset.armed !== 'yes') {
    button.dataset.armed = 'yes';
    button.textContent = `Точно? Сотрутся ${entry.wins} побед`;
    return;
  }
  purse.coins += resaleValue(entry.car);
  owned.splice(index, 1);
  index = Math.max(0, index - 1);
  select(index);
  mountChrome('garage');
});

// ── запчасти ─────────────────────────────────────────────────────────────────

function renderParts(): void {
  const entry = owned[index]!;
  const maxed = strength(entry.car) >= CLASS_RANGES[getModel(entry.car.modelId).klass].max - 1e-9;

  $('parts').replaceChildren(...(Object.keys(SPEC_LABELS) as SpecKey[]).map((key) => {
    const level = entry.car.specs[key];
    const price = partPrice(entry.car, level);
    const full = level >= MAX_SPEC_LEVEL;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'part';
    button.disabled = full || maxed || price > purse.coins;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = SPEC_LABELS[key];

    const value = document.createElement('span');
    value.className = 'level';
    value.append(String(level));
    const of = document.createElement('small');
    of.textContent = ` / ${MAX_SPEC_LEVEL}`;
    value.append(of);

    const note = document.createElement('span');
    note.className = 'price';
    note.textContent = full ? 'некуда' : maxed ? 'потолок класса' : `${formatCoins(price)} монет`;

    button.append(name, value, note);
    button.addEventListener('click', () => {
      purse.coins -= price;
      entry.car.specs[key] = level + 1;
      renderCard();
      renderParts();
      renderCarList();
      mountChrome('garage');
    });
    return button;
  }));

  $('parts-note').textContent = maxed
    ? 'Потолок класса взят: следующие баллы только с новой машиной'
    : 'Уровень цифрой. Цена растёт с каждым следующим';
}

// ── места в гараже ───────────────────────────────────────────────────────────

function renderCarList(): void {
  const header = document.createElement('li');
  const headLine = document.createElement('div');
  headLine.className = 'line head';
  headLine.append(
    cell('', ''), cell('', 'Машина'), cell('num', 'мощность'),
    cell('num', 'рейтинг'), cell('num hide-narrow', 'побед'),
  );
  header.append(headLine);

  $('car-list').replaceChildren(header, ...owned.map((entry, i) => {
    const model = getModel(entry.car.modelId);
    const item = document.createElement('li');
    const line = document.createElement('button');
    line.type = 'button';
    line.className = 'line';
    line.setAttribute('aria-current', String(i === index));

    line.append(
      cell('klass', model.klass),
      stack(model.nick, model.name),
      cell('num', `${horsepower(entry.car)} л.с.`),
      cell('num', strength(entry.car).toFixed(0)),
      cell('num hide-narrow', `${entry.wins} побед`),
    );
    line.addEventListener('click', () => select(i));
    item.append(line);
    return item;
  }));

  $('slots-note').textContent = `Занято ${owned.length} из ${career.slots}`;
}

function cell(className: string, text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function stack(title: string, sub: string): HTMLElement {
  const box = document.createElement('span');
  const top = document.createElement('span');
  top.className = 'title';
  top.textContent = title;
  const bottom = document.createElement('span');
  bottom.className = 'sub';
  bottom.textContent = sub;
  box.append(top, document.createElement('br'), bottom);
  return box;
}

// ── лента и сводка ───────────────────────────────────────────────────────────

function renderLog(): void {
  $('log').replaceChildren(...lastRaces.map((entry) => {
    const item = document.createElement('li');
    const line = document.createElement('div');
    line.className = 'line';

    const text = document.createElement('span');
    const who = document.createElement('b');
    who.className = 'who';
    who.textContent = entry.rival;
    const tail = document.createElement('span');
    tail.className = entry.won ? 'won' : 'lost';
    tail.textContent = entry.won
      ? ' вызвал на гонку и слил'
      : ' вызвал на гонку и забрал';
    text.append(who, tail);

    const stake = document.createElement('span');
    stake.className = 'num stake faint';
    stake.textContent = `${formatCoins(entry.stake)} монет`;

    const answer = document.createElement('div');
    answer.className = 'answer';
    const button = document.createElement('a');
    button.className = 'linkish';
    button.href = `/?car=${index}`;
    button.textContent = 'Вызвать в ответ';
    answer.append(button);

    line.append(text, stake, answer);
    item.append(line);
    return item;
  }));
}

function renderCareer(): void {
  const left: [string, string][] = [
    ['Всего заездов', formatCoins(career.races)],
    ['Выиграно гонок', formatCoins(career.wins)],
    ['Слил', formatCoins(career.losses)],
    ['Мест в гараже', String(career.slots)],
  ];
  const right: [string, string][] = [
    ['Потрачено монет', formatCoins(career.spent)],
    ['Выиграно монет', formatCoins(career.earned)],
    ['Заездов в классе', formatCoins(370)],
    ['Вас вызывали', formatCoins(career.challenged)],
  ];
  $('career').replaceChildren(table(left), table(right));
}

function table(rows: [string, string][]): HTMLTableElement {
  const node = document.createElement('table');
  node.className = 'sheet';
  for (const [label, value] of rows) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = label;
    const val = document.createElement('td');
    val.textContent = value;
    tr.append(td, val);
    node.append(tr);
  }
  return node;
}

// ── выбор машины ─────────────────────────────────────────────────────────────

function select(next: number): void {
  index = Math.min(next, owned.length - 1);
  const entry = owned[index]!;

  const params = new URLSearchParams(location.search);
  params.set('car', String(index));
  history.replaceState(null, '', `?${params.toString()}`);

  renderCard();
  renderParts();
  renderCarList();
  renderLog();

  $('loading').hidden = false;
  $('loading').textContent = 'Загружаю модель';
  garage?.dispose();
  garage = new Garage({
    canvas: $('scene') as unknown as HTMLCanvasElement,
    modelUrl: resolveModelUrl(entry.car.modelId),
    onReady: () => {
      garage?.setBodyColor(PAINTS[entry.paint] ?? '#d8d5ce');
      $('loading').hidden = true;
    },
    onError: (error) => {
      console.error(error);
      $('loading').textContent = 'Модель не загрузилась: собери public/models';
    },
  });
  garage.setBodyColor(PAINTS[entry.paint] ?? '#d8d5ce');
  garage.start();
  $('toggle-spin').setAttribute('aria-pressed', 'true');
}

$('toggle-spin').addEventListener('click', () => {
  if (!garage) return;
  const spinning = !garage.isSpinning();
  garage.setSpinning(spinning);
  $('toggle-spin').setAttribute('aria-pressed', String(spinning));
});

window.addEventListener('resize', () => garage?.resize());

// Вкладку свернули — не жжём батарею на вращающемся подиуме.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) garage?.stop();
  else garage?.start();
});

/** Точка входа. `resolve` подменяется в сборке страницы-артефакта. */
export function mountGarage(resolve?: (modelId: string) => string): void {
  if (resolve) resolveModelUrl = resolve;
  mountChrome('garage');
  mountFooter();
  renderCareer();
  select(index);
}
