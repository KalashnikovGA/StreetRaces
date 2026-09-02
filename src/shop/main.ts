/**
 * Автосалон. Структура из оригинала: сверху выбранная модель крупно с ценой
 * и кнопкой покупки, ниже — плотный список всей площадки со строкой о том,
 * при каком условии откроются машины помощнее.
 *
 * Условие у нас классовое, а не уровневое (§4): доступ покупается классом,
 * и это же место, где деньги дают доступ к высоким ставкам, а не превосходство.
 */

import '../ui/theme.css';
import '../garage/garage.css';
import './shop.css';
import {
  CAR_MODELS, CLASS_ORDER, CLASS_RANGES, getModel, horsepower, stockCar,
  type CarClass, type CarModel,
} from '../core/index.ts';
import { Stage } from '../garage/stage.ts';
import { mountChrome, mountFooter } from '../ui/chrome.ts';
import { formatCoins, owned, purse } from '../ui/state.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let picked = 0;
let stage: Stage | null = null;

/** Лучший класс в гараже. От него зависит, что уже можно взять. */
function bestClass(): CarClass {
  let best: CarClass = 'D';
  for (const entry of owned) {
    const klass = getModel(entry.car.modelId).klass;
    if (CLASS_ORDER.indexOf(klass) > CLASS_ORDER.indexOf(best)) best = klass;
  }
  return best;
}

/** Открыт свой класс и один следующий: ступенька вверх видна, лестница — нет. */
function openLimit(): number {
  return Math.min(CLASS_ORDER.length - 1, CLASS_ORDER.indexOf(bestClass()) + 1);
}

function locked(model: CarModel): boolean {
  return CLASS_ORDER.indexOf(model.klass) > openLimit();
}

function ownedCount(model: CarModel): number {
  return owned.filter((entry) => entry.car.modelId === model.id).length;
}

// ── витрина ──────────────────────────────────────────────────────────────────

function renderPick(): void {
  const model = CAR_MODELS[picked]!;
  const car = stockCar(model.id);
  const range = CLASS_RANGES[model.klass];

  $('pick-nick').textContent = model.nick;
  $('pick-model').textContent = model.name;

  const rows: [string, string][] = [
    ['Мощность', `${horsepower(car)} л.с.`],
    ['Рейтинг', String(model.baseStrength)],
    ['Класс', `${model.klass} (${range.min}–${range.max})`],
    ['Потолок класса', String(range.max)],
    ['Цена', model.priceCoins === 0 ? 'даром' : `${formatCoins(model.priceCoins)} монет`],
  ];

  $('pick-sheet').replaceChildren(...rows.map(([label, value], i) => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = label;
    const val = document.createElement('td');
    val.textContent = value;
    if (i === 4) val.className = 'big';
    tr.append(td, val);
    return tr;
  }));

  const buy = $('buy') as HTMLButtonElement;
  const short = model.priceCoins - purse.coins;
  buy.disabled = locked(model) || short > 0;
  buy.textContent = 'Купить';

  $('pick-note').textContent = locked(model)
    ? `Класс ${model.klass} закрыт: сначала машина класса ${CLASS_ORDER[openLimit()]}`
    : short > 0
      ? `Не хватает ${formatCoins(short)} монет`
      : ownedCount(model) > 0
        ? 'Такая уже стоит в гараже. Вторая займёт ещё одно место'
        : 'Сток. Прокачка добьёт до потолка класса';

  loadStage(model);
}

function loadStage(model: CarModel): void {
  stage ??= new Stage({ canvas: $('scene') as unknown as HTMLCanvasElement });
  // Машина на площадке стоит в заводском белом: окраска — это уже Pimp.
  stage.setCar(model.id, 'white');
  stage.start();
}

// ── список площадки ──────────────────────────────────────────────────────────

function renderList(): void {
  const list = $('models');
  const items: HTMLElement[] = [];
  let gateShown = false;

  const header = document.createElement('li');
  const headLine = document.createElement('div');
  headLine.className = 'line head';
  for (const [className, text] of [['', ''], ['', 'Машина'], ['num', 'мощность'],
    ['num hide-narrow', 'рейтинг'], ['num', 'цена']] as [string, string][]) {
    const node = document.createElement('span');
    node.className = className;
    node.textContent = text;
    headLine.append(node);
  }
  header.append(headLine);
  items.push(header);

  CAR_MODELS.forEach((model, i) => {
    if (locked(model) && !gateShown) {
      gateShown = true;
      const gate = document.createElement('li');
      const note = document.createElement('div');
      note.className = 'gate-row';
      note.textContent =
        `Машины класса ${model.klass} и выше откроются, когда в гараже появится класс ${CLASS_ORDER[openLimit()]}.`;
      gate.append(note);
      items.push(gate);
    }

    const car = stockCar(model.id);
    const item = document.createElement('li');
    const line = document.createElement('button');
    line.type = 'button';
    line.className = 'line';
    line.disabled = locked(model);
    line.setAttribute('aria-current', String(i === picked));

    const klass = document.createElement('span');
    klass.className = 'klass';
    klass.textContent = model.klass;

    const name = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = model.nick;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = model.name;
    name.append(title, document.createElement('br'), sub);

    const power = document.createElement('span');
    power.className = 'num';
    power.textContent = `${horsepower(car)} л.с.`;

    const rating = document.createElement('span');
    rating.className = 'num hide-narrow';
    rating.textContent = String(model.baseStrength);

    const price = document.createElement('span');
    price.className = ownedCount(model) > 0 ? 'num owned' : 'num';
    price.textContent = ownedCount(model) > 0
      ? 'уже в гараже'
      : model.priceCoins === 0 ? 'даром' : `${formatCoins(model.priceCoins)} монет`;

    line.append(klass, name, power, rating, price);
    line.addEventListener('click', () => {
      picked = i;
      renderPick();
      renderList();
    });
    item.append(line);
    items.push(item);
  });

  list.replaceChildren(...items);
  $('shop-note').textContent = `Открыты классы до ${CLASS_ORDER[openLimit()]}`;
}

// ── покупка ──────────────────────────────────────────────────────────────────

$('buy').addEventListener('click', () => {
  const model = CAR_MODELS[picked]!;
  if (locked(model) || model.priceCoins > purse.coins) return;
  purse.coins -= model.priceCoins;
  owned.push({
    car: stockCar(model.id),
    paint: 'white',
    plate: 'Б 000 ЕЗ',
    wins: 0,
    losses: 0,
  });
  // Купил — смотришь на неё в гараже. Так же вёл себя оригинал.
  location.href = `/garage.html?car=${owned.length - 1}`;
});

window.addEventListener('resize', () => stage?.resize());

mountChrome('shop');
mountFooter();
renderPick();
renderList();
