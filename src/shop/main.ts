/**
 * Автосалон. Сетка карточек и их состав взяты из макета: снимок машины,
 * марка крупно, модель акцентом, характеристики строками, действие внизу.
 *
 * Фильтров по классам нет намеренно: в игре две машины, и фильтр был бы
 * мёртвой кнопкой. Вернётся вместе с третьей.
 */

import '../ui/theme.css';
import './shop.css';
import {
  CAR_MODELS, CLASS_ORDER, CLASS_RANGES, getModel, horsepower, stockCar,
  type CarClass, type CarModel,
} from '../core/index.ts';
import { mountChrome, mountFooter } from '../ui/chrome.ts';
import { formatCoins, owned, purse } from '../ui/state.ts';
import { drawThumb } from '../ui/thumb.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

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

function buy(model: CarModel): void {
  if (locked(model) || model.priceCoins > purse.coins) return;
  purse.coins -= model.priceCoins;
  owned.push({ car: stockCar(model.id), paint: 'white', plate: 'Б 000 ЕЗ', wins: 0, losses: 0 });
  // Купил — смотришь на неё в гараже. Так же вёл себя оригинал.
  location.href = `/garage.html?car=${owned.length - 1}`;
}

function card(model: CarModel): HTMLElement {
  const car = stockCar(model.id);
  const range = CLASS_RANGES[model.klass];
  const mine = ownedCount(model) > 0;

  const box = document.createElement('article');
  box.className = mine ? 'card-car owned' : 'card-car';

  const shot = document.createElement('div');
  shot.className = 'shot';
  const canvas = document.createElement('canvas');
  shot.append(canvas);

  const name = document.createElement('h2');
  name.textContent = model.nick;
  const label = document.createElement('p');
  label.className = 'model';
  label.textContent = model.name;

  const rows: [string, string][] = [
    ['Мощность', `${horsepower(car)} л.с.`],
    ['Класс', `${model.klass} (${range.min}–${range.max})`],
    ['Рейтинг', String(model.baseStrength)],
    ['Стоимость', model.priceCoins === 0 ? 'даром' : `${formatCoins(model.priceCoins)} монет`],
  ];
  const sheet = document.createElement('table');
  sheet.className = 'sheet';
  for (const [key, value] of rows) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = key;
    const val = document.createElement('td');
    val.textContent = value;
    tr.append(td, val);
    sheet.append(tr);
  }

  const note = document.createElement('p');
  note.className = 'note';
  const short = model.priceCoins - purse.coins;
  note.textContent = locked(model)
    ? `Класс ${model.klass} закрыт: сначала машина класса ${CLASS_ORDER[openLimit()]}`
    : mine
      ? 'Уже стоит в гараже. Вторая займёт ещё одно место'
      : short > 0
        ? `Не хватает ${formatCoins(short)} монет`
        : 'Сток. Прокачка добьёт до потолка класса';

  const actions = document.createElement('div');
  actions.className = 'actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = mine ? 'btn' : 'btn primary';
  button.textContent = 'Купить';
  button.disabled = locked(model) || short > 0;
  button.addEventListener('click', () => buy(model));
  actions.append(button);

  box.append(shot, name, label, sheet, note, actions);
  queueMicrotask(() => drawThumb(canvas, model.id, 'white'));
  return box;
}

function render(): void {
  $('models').replaceChildren(...CAR_MODELS.map(card));
  $('shop-note').textContent = `Открыты классы до ${CLASS_ORDER[openLimit()]}`;
  $('purse-note').textContent = `В банке ${formatCoins(purse.coins)} монет`;
}

mountChrome('shop');
mountFooter();
render();
