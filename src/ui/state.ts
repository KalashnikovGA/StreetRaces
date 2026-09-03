/**
 * Витрина гаража до шага 4. Держится в памяти вкладки и обнуляется при
 * перезагрузке — намеренно.
 *
 * Источником истины для всего, что стоит денег, будет сервер (правило 3
 * CLAUDE.md). Здесь лежат только те данные, без которых экран нечем наполнить:
 * набор машин, кошелёк и лента последних заездов.
 */

import { getModel, strength, type Car, type CarClass } from '../core/index.ts';

export interface Owned {
  car: Car;
  /** Ключ окраски из PAINTS. Косметика на заезд не влияет (§4). */
  paint: string;
  /** Номер свободным текстом (§4). */
  plate: string;
  wins: number;
  losses: number;
}

export interface RaceLogEntry {
  /** Кто вызвал. Двор против двора: важен человек, а не рекорд (§9). */
  rival: string;
  won: boolean;
  stake: number;
  /** Сила соперника — по ней видно, чудо это было или ровный заезд. */
  rivalStrength: number;
}

export interface Purse {
  coins: number;
  gold: number;
}

const START_PURSE: Purse = { coins: 148_200, gold: 36 };

const START_OWNED: Owned[] = [
  {
    car: { modelId: 'habicht_t3', specs: { tires: 6, ignition: 5, clutch: 5, suspension: 6, boost: 4, intake: 5, radiator: 4 } },
    paint: 'silver', plate: 'К 348 ЕЕ', wins: 47, losses: 19,
  },
];

/**
 * Витрина переживает переход между вкладками через sessionStorage: купил
 * машину в салоне — она стоит в гараже. Вкладку закрыли — всё вернулось
 * к началу, и это правильно: настоящее состояние будет на сервере (шаг 4).
 */
const KEY = 'na-slabo/demo/v1';

interface Saved { purse: Purse; owned: Owned[] }

function restore(): Saved {
  const fallback: Saved = { purse: { ...START_PURSE }, owned: structuredClone(START_OWNED) };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Saved;
    if (!Array.isArray(saved.owned) || saved.owned.length === 0) return fallback;
    return saved;
  } catch {
    return fallback;
  }
}

const saved = restore();

export const purse: Purse = saved.purse;
export const owned: Owned[] = saved.owned;

/** Сохранять после каждой покупки не нужно — хватает выхода со страницы. */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ purse, owned }));
    } catch {
      // Приватный режим и переполнение — не повод ронять экран.
    }
  });
}

/** Лента вызовов. В оригинале ровно этот блок стоял под машиной. */
export const lastRaces: RaceLogEntry[] = [
  { rival: 'Егор', won: false, stake: 5_000, rivalStrength: 214 },
  { rival: 'Егор', won: false, stake: 5_000, rivalStrength: 214 },
  { rival: 'Тимур', won: true, stake: 12_000, rivalStrength: 198 },
  { rival: 'Егор', won: false, stake: 3_000, rivalStrength: 214 },
  { rival: 'Сосед по двору', won: true, stake: 900, rivalStrength: 121 },
];

/** Сводка внизу гаража. Числа те же, что в оригинале, в наших терминах. */
export const career = {
  races: 2_842,
  wins: 2_462,
  losses: 380,
  slots: 4,
  spent: 2_615_705,
  earned: 1_212_500,
  challenged: 403,
};

/** Индекс выбранной машины. Экраны переживают переход по вкладкам через адрес. */
export function currentIndex(): number {
  const raw = Number(new URLSearchParams(location.search).get('car'));
  return Number.isInteger(raw) && raw >= 0 && raw < owned.length ? raw : 0;
}

export function currentClass(): CarClass {
  return getModel(owned[currentIndex()]!.car.modelId).klass;
}

/** Сумма за машину при продаже — половина силы в монетах. Заглушка до шага 4. */
export function resaleValue(car: Car): number {
  return Math.round(strength(car) * 120);
}

export function formatCoins(value: number): string {
  return value.toLocaleString('ru-RU').replace(/ /g, ' ');
}

/**
 * Цена следующего уровня запчасти. Заглушка до шага 7: важно, что цена растёт
 * с уровнем и с классом машины, а не конкретные числа — они придут с балансом
 * магазина.
 */
export function partPrice(car: Car, level: number): number {
  const model = getModel(car.modelId);
  const base = 400 + Math.round(model.priceCoins * 0.02);
  return base * (level + 1);
}
