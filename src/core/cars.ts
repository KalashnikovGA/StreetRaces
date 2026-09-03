/**
 * Машины и расчёт силы. §4, §21.
 * Реальные марки не используются: вымышленное имя + узнаваемый силуэт.
 */

import type { Car, CarClass, CarModel, SpecKey, Specs } from './types.ts';

export const MAX_SPEC_LEVEL = 10;

/**
 * Вклад характеристик в силу. Сумма = 1.
 * Прокачка от стока до максимума даёт ровно UPGRADE_HEADROOM — ширину класса.
 */
export const SPEC_WEIGHTS: Record<SpecKey, number> = {
  boost: 0.22,
  intake: 0.15,
  ignition: 0.15,
  clutch: 0.13,
  tires: 0.13,
  suspension: 0.12,
  radiator: 0.10,
};

/**
 * Разброс сил внутри класса — §4: не больше x1.35, иначе класс расслаивается.
 * Слабейший против сильнейшего имеет 23.1%.
 */
export const CLASS_SPREAD = 1.35;

/** Границы классов — §4. Каждый следующий начинается там, где кончается предыдущий. */
export const CLASS_RANGES: Record<CarClass, { min: number; max: number }> = {
  D: { min: 100, max: 135 },
  C: { min: 135, max: 182 },
  B: { min: 182, max: 246 },
  A: { min: 246, max: 332 },
};

export const CLASS_ORDER: CarClass[] = ['D', 'C', 'B', 'A'];

/**
 * Коэффициент «сила → лошадиные силы» для витрины.
 * Подобран по двум примерам из спецификации: сток D ≈ 183 л.с. (§6),
 * потолок класса A ≈ 612 л.с. (§6, «лучшая победа»).
 */
export const HP_PER_STRENGTH = 1.85;

/**
 * Машины, которые есть в игре. Каждая прошла пайплайн: в гараже, салоне
 * и заезде она показана отрендеренными спрайтами, а не заливкой контура.
 *
 * Список короткий сознательно. Машина попадает сюда только вместе с моделью,
 * из которой отрендерены спрайты, — §11 не допускает плейсхолдеров в витрине.
 */
export const CAR_MODELS: CarModel[] = [
  { id: 'falke_t9', name: '«Falke T9»',     nick: 'Жаба',     klass: 'A', baseStrength: 268, silhouette: 'заднемоторное купе 70-х с широкими арками', priceCoins: 430_000 },
];

/**
 * Опорные точки лестницы классов. В игре этих машин нет: ни в гараже, ни
 * в салоне, ни в заезде — у них нет моделей, а значит и рендера.
 *
 * Числа остаются, потому что на них стоит балансовый прогон и тесты ядра:
 * без машин классов D, C и B нечем проверить ни таблицу вероятностей §3,
 * ни чудо при разнице втрое, ни то, что прокачка упирается ровно в потолок
 * класса. Это главный гейт проекта (§14), терять его вместе с плейсхолдерами
 * нельзя.
 *
 * Как только для класса появится настоящая модель, машина переезжает
 * в CAR_MODELS и попадает в игру.
 */
export const LADDER_MODELS: CarModel[] = [
  { id: 'zarya965',  name: '«Заря-965»',     nick: 'Корытце',  klass: 'D', baseStrength: 100, silhouette: 'ЗАЗ-965',        priceCoins: 0 },
  { id: 'vogel190',  name: '«Vogel 190»',    nick: 'Малыш',    klass: 'A', baseStrength: 254, silhouette: 'седан 80-х',     priceCoins: 380_000 },
  { id: 'bavar_c40', name: '«Bavar C40»',    nick: 'Эмка',     klass: 'A', baseStrength: 276, silhouette: 'купе 2010-х',    priceCoins: 470_000 },
  { id: 'lada6',     name: '«Лада-Шесть»',   nick: 'Шоха',     klass: 'D', baseStrength: 108, silhouette: 'ВАЗ-2106',       priceCoins: 4_000 },
  { id: 'ronin_gx',  name: '«Ronin GX»',     nick: 'Японец',   klass: 'C', baseStrength: 135, silhouette: 'Honda Civic 90-х', priceCoins: 22_000 },
  { id: 'lada_sport',name: '«Лада-Спорт»',   nick: 'Четырка',  klass: 'C', baseStrength: 142, silhouette: 'ВАЗ-2114',       priceCoins: 28_000 },
  { id: 'bavar320',  name: '«Bavar 320»',    nick: 'Бэха',     klass: 'B', baseStrength: 182, silhouette: 'BMW E36',        priceCoins: 90_000 },
  { id: 'ronin_ss',  name: '«Ronin Supra-S»',nick: 'Супра',    klass: 'B', baseStrength: 194, silhouette: 'Toyota Supra',   priceCoins: 115_000 },
  { id: 'kaiser_r34',name: '«Kaiser R34»',   nick: 'Скай',     klass: 'A', baseStrength: 246, silhouette: 'Nissan Skyline', priceCoins: 340_000 },
  { id: 'corsa_f40', name: '«Corsa F40»',    nick: 'Итальянец',klass: 'A', baseStrength: 262, silhouette: 'Ferrari F40',    priceCoins: 420_000 },
];

/** Всё, что умеет считать ядро: игра плюс опорная лестница. */
export const ALL_MODELS: CarModel[] = [...LADDER_MODELS, ...CAR_MODELS]
  .sort((a, b) => a.baseStrength - b.baseStrength);

/**
 * Порядок машин для повтора по ссылке (§7.2). Дописывается только в конец
 * и никогда не переставляется.
 *
 * В ссылке машина едет шестибитным индексом в этом списке. Если список
 * переставить или укоротить, все уже разосланные повторы молча превратятся
 * в заезд других машин — а ссылка живёт в чужих чатах вечно и переиздать
 * её нельзя.
 */
export const REPLAY_ORDER: readonly string[] = [
  'zarya965', 'lada6', 'ronin_gx', 'lada_sport', 'bavar320',
  'ronin_ss', 'kaiser_r34', 'corsa_f40', 'vogel190', 'bavar_c40', 'falke_t9',
];

const MODELS_BY_ID = new Map(ALL_MODELS.map((m) => [m.id, m]));

export function getModel(modelId: string): CarModel {
  const model = MODELS_BY_ID.get(modelId);
  if (!model) throw new Error(`Неизвестная модель: ${modelId}`);
  return model;
}

export function emptySpecs(): Specs {
  return { tires: 0, ignition: 0, clutch: 0, suspension: 0, boost: 0, intake: 0, radiator: 0 };
}

export function stockCar(modelId: string): Car {
  return { modelId, specs: emptySpecs() };
}

/**
 * Запас прокачки конкретной модели: от стока ровно до верхней границы класса (§4).
 * Стартовое «Корытце» имеет полные +35%; более дорогая база того же класса
 * доезжает до того же потолка меньшим числом апгрейдов — деньги покупают
 * скорость прогресса, а не превосходство (§5).
 */
export function modelHeadroom(model: CarModel): number {
  return CLASS_RANGES[model.klass].max / model.baseStrength - 1;
}

/** Доля прокачки: 0 — сток, 1 — потолок класса. */
export function upgradeFraction(specs: Specs): number {
  let sum = 0;
  for (const key of Object.keys(SPEC_WEIGHTS) as SpecKey[]) {
    const level = Math.min(MAX_SPEC_LEVEL, Math.max(0, specs[key]));
    sum += SPEC_WEIGHTS[key] * (level / MAX_SPEC_LEVEL);
  }
  return sum;
}

/** Сила машины в баллах — тот самый «рейтинг машины» из оригинала. */
export function strength(car: Car): number {
  const model = getModel(car.modelId);
  return model.baseStrength * (1 + modelHeadroom(model) * upgradeFraction(car.specs));
}

export function horsepower(car: Car): number {
  return Math.round(strength(car) * HP_PER_STRENGTH);
}

export function classOfStrength(value: number): CarClass {
  for (const klass of CLASS_ORDER) {
    if (value < CLASS_RANGES[klass].max) return klass;
  }
  return 'A';
}

/** Потолок прокачки — верхняя граница класса. Упёрся — покупай следующую машину (§4). */
export function isMaxedForClass(car: Car): boolean {
  const model = getModel(car.modelId);
  return strength(car) >= CLASS_RANGES[model.klass].max - 1e-9;
}

export function maxedCar(modelId: string): Car {
  const specs = emptySpecs();
  for (const key of Object.keys(specs) as SpecKey[]) specs[key] = MAX_SPEC_LEVEL;
  return { modelId, specs };
}
