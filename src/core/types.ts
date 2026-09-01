/** Общие типы ядра. §3, §4 спецификации. */

export type CarClass = 'D' | 'C' | 'B' | 'A';

/** Терминология оригинала — §4. */
export type SpecKey =
  | 'tires'       // шины
  | 'ignition'    // зажигание
  | 'clutch'      // сцепление
  | 'suspension'  // подвеска
  | 'boost'       // наддув
  | 'intake'      // впуск
  | 'radiator';   // радиатор

/** Уровень каждой характеристики: 0..MAX_SPEC_LEVEL. */
export type Specs = Record<SpecKey, number>;

export interface CarModel {
  id: string;
  /** Официальное вымышленное имя — §21. */
  name: string;
  /** Дворовое прозвище. Оно и вызывает узнавание — §21. */
  nick: string;
  klass: CarClass;
  /** Сила стоковой машины, нижняя граница класса. */
  baseStrength: number;
  /** Силуэт-прототип. Только для художника, в игре не показывается. */
  silhouette: string;
  priceCoins: number;
}

export interface Car {
  modelId: string;
  specs: Specs;
}

/** Условия заезда, видны игроку до старта — §3. */
export type Distance = 'short' | 'medium' | 'long';
export type Surface = 'dry' | 'wet';
export type Profile = 'flat' | 'uphill';

export interface Conditions {
  distance: Distance;
  surface: Surface;
  profile: Profile;
}

/** Решения игрока до старта — §3. */
export type Tires = 'slick' | 'sport' | 'rain';
export type Gearing = 'short' | 'medium' | 'long';
export type Pressure = 'low' | 'normal' | 'high';
export type Nitro = 'none' | 'early' | 'mid' | 'late';
export type WeightCut = 0 | 1 | 2;

export interface RaceConfig {
  tires: Tires;
  gearing: Gearing;
  pressure: Pressure;
  nitro: Nitro;
  weightCut: WeightCut;
}

export interface Racer {
  /** Ник игрока или бота. */
  name: string;
  car: Car;
  config: RaceConfig;
}

export type Side = 'a' | 'b';
