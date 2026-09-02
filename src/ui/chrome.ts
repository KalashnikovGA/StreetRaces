/**
 * Общая обвязка экранов: строка вкладок и счётчики.
 *
 * Порядок вкладок взят из оригинала (§9) и не переставляется: гараж, автосалон,
 * гонки, Pimp. Счётчики стоят справа, как там же, и показывают ровно две
 * валюты (§5) плюс класс текущей машины — в нашей игре класс занимает место
 * уровня из оригинала (§4).
 */

import { CLASS_RANGES } from '../core/index.ts';
import { currentClass, formatCoins, purse } from './state.ts';

/** `none` — экран вне вкладок (песочница): подсвечивать нечего. */
type Tab = 'garage' | 'shop' | 'race' | 'pimp' | 'none';

const TABS: { id: Exclude<Tab, 'none'>; label: string; href: string }[] = [
  { id: 'garage', label: 'Гараж', href: '/garage.html' },
  { id: 'shop', label: 'Автосалон', href: '/shop.html' },
  { id: 'race', label: 'Гонки', href: '/' },
  { id: 'pimp', label: 'Pimp', href: '/pimp.html' },
];

declare global {
  interface Window {
    /** Карта «вкладка → адрес». Заполняется только самодостаточной раздачей,
     *  где страницы лежат по отдельным ссылкам, а не рядом на сервере. */
    __nav?: Record<string, string>;
  }
}

/** Ссылка на вкладку с сохранением выбранной машины. */
function href(base: string): string {
  const car = new URLSearchParams(location.search).get('car');
  return car ? `${base}${base.includes('?') ? '&' : '?'}car=${car}` : base;
}

export function mountChrome(active: Tab, options: { withPurse?: boolean } = {}): void {
  const host = document.getElementById('chrome');
  if (!host) return;

  const nav = document.createElement('nav');
  const map = window.__nav;
  for (const tab of TABS) {
    const link = document.createElement('a');
    link.textContent = tab.label;
    if (tab.id === active) link.setAttribute('aria-current', 'page');

    if (!map) {
      link.href = href(tab.href);
    } else if (map[tab.id]) {
      // В раздаче по ссылкам вкладки ведут на соседние страницы.
      link.href = map[tab.id]!;
    } else if (tab.id !== active) {
      // Страницы нет в раздаче — вкладка видна, но не ведёт в никуда.
      link.setAttribute('aria-disabled', 'true');
      link.title = 'В этой раздаче страницы нет';
    }
    nav.append(link);
  }
  host.replaceChildren(nav);

  if (options.withPurse === false) return;

  const klass = currentClass();
  const box = document.createElement('div');
  box.className = 'purse';
  box.append(
    cell('coin', formatCoins(purse.coins), 'Монеты'),
    cell('gold', String(purse.gold), 'Золотые монеты'),
    cell('klass', `класс ${klass}`, `Ставки внутри класса ${klass}: ${CLASS_RANGES[klass].min}–${CLASS_RANGES[klass].max}`),
  );
  host.append(box);
}

function cell(mark: string, value: string, title: string): HTMLElement {
  const node = document.createElement('div');
  node.className = 'cell';
  node.title = title;
  const dot = document.createElement('i');
  dot.className = `mark ${mark}`;
  const text = document.createElement('b');
  text.textContent = value;
  node.append(dot, text);
  return node;
}

/** Подвал: служебные ссылки, которым не место в строке вкладок. */
export function mountFooter(): void {
  const host = document.getElementById('footer');
  if (!host) return;
  host.className = 'underline-bar';
  host.replaceChildren();
  const mark = document.createElement('b');
  mark.textContent = 'На слабо';
  const note = document.createElement('span');
  note.textContent = 'Заезд считается на клиенте и на сервере одной функцией. Ставка проверяется сервером.';
  const sandbox = document.createElement('a');
  sandbox.href = '/sandbox.html';
  sandbox.textContent = 'Песочница баланса';
  host.append(mark, note, sandbox);
}
