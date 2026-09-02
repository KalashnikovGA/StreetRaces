/**
 * Гараж. Порядок блоков взят из макета и не переставляется:
 * витрина → ряд запчастей → места в гараже → полоса уровня →
 * последние гонки → сводка за карьеру → финишная лента.
 *
 * Отделка — по разделу «Дизайн» в CLAUDE.md: характеристики числами,
 * нулевые скругления, натриевый акцент один на экран и стоит на главном
 * действии.
 */

import '../ui/theme.css';
import './garage.css';
import {
  CLASS_RANGES, MAX_SPEC_LEVEL, getModel, horsepower, strength,
  type SpecKey,
} from '../core/index.ts';
import { mountChrome, mountFooter } from '../ui/chrome.ts';
import {
  career, currentIndex, formatCoins, lastRaces, owned, partPrice, purse, resaleValue,
} from '../ui/state.ts';
import { drawThumb } from '../ui/thumb.ts';
import { Stage } from './stage.ts';

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
let stage: Stage | null = null;

// ── витрина ──────────────────────────────────────────────────────────────────

function renderCard(): void {
  const entry = owned[index]!;
  const model = getModel(entry.car.modelId);
  const rating = strength(entry.car);
  const range = CLASS_RANGES[model.klass];

  $('car-nick').textContent = model.nick;
  $('car-model').textContent = model.name;

  const facts: [string, string][] = [
    ['Мощность', `${horsepower(entry.car)} л.с.`],
    ['Стоимость', formatCoins(resaleValue(entry.car))],
    ['Рейтинг', rating.toFixed(0)],
    ['Класс', model.klass],
  ];
  $('car-facts').replaceChildren(...facts.map(([label, value]) => {
    const row = document.createElement('div');
    row.append(`${label}:`);
    const strong = document.createElement('b');
    strong.textContent = value;
    row.append(strong);
    return row;
  }));

  const left = range.max - rating;
  $('ceiling').textContent = left < 0.5
    ? `Класс ${model.klass} выбран до потолка`
    : `До потолка класса ${model.klass} ещё ${left.toFixed(0)} баллов`;

  ($('race') as HTMLAnchorElement).href = `/?car=${index}`;

  // Полоса уровня показывает прокачку внутри класса — ту же цифру, что и рейтинг.
  const done = (rating - range.min) / (range.max - range.min);
  $('level-label').textContent = `Класс ${model.klass}`;
  ($('level-fill') as HTMLElement).style.width = `${Math.round(done * 100)}%`;
  $('level-left').textContent = left < 0.5 ? 'потолок' : `${left.toFixed(0)} до потолка`;

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
    note.textContent = full ? 'некуда' : maxed ? 'потолок' : formatCoins(price);

    button.append(name, value, note);
    button.addEventListener('click', () => {
      purse.coins -= price;
      entry.car.specs[key] = level + 1;
      renderCard();
      renderParts();
      renderSlots();
      mountChrome('garage');
    });
    return button;
  }));
}

// ── места в гараже ───────────────────────────────────────────────────────────

function renderSlots(): void {
  const cells: HTMLElement[] = owned.map((entry, i) => {
    const model = getModel(entry.car.modelId);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'slot';
    cell.setAttribute('aria-current', String(i === index));

    const canvas = document.createElement('canvas');
    const nick = document.createElement('span');
    nick.className = 'nick';
    nick.textContent = model.nick;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = `${horsepower(entry.car)} л.с., рейтинг ${strength(entry.car).toFixed(0)}`;

    cell.append(canvas, nick, num);
    cell.addEventListener('click', () => select(i));
    // Канва обмеряется по месту, поэтому рисуем после вставки в документ.
    queueMicrotask(() => drawThumb(canvas, entry.car.modelId, entry.paint));
    return cell;
  });

  for (let i = owned.length; i < career.slots; i++) {
    const cell = document.createElement('div');
    cell.className = 'slot empty';
    const plate = document.createElement('span');
    plate.className = 'plate';
    plate.textContent = 'место свободно';
    cell.append(plate);
    cells.push(cell);
  }

  $('slots').replaceChildren(...cells);
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
    tail.textContent = entry.won ? ' вызвал на гонку и слил' : ' вызвал на гонку и забрал';
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
  renderSlots();
  renderLog();

  stage ??= new Stage({ canvas: $('scene') as unknown as HTMLCanvasElement });
  stage.setCar(entry.car.modelId, entry.paint);
  stage.start();
}

window.addEventListener('resize', () => stage?.resize());

/** Точка входа. */
export function mountGarage(): void {
  mountChrome('garage');
  mountFooter();
  renderCareer();
  select(index);
}
