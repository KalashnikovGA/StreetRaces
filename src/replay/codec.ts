/**
 * Повтор по ссылке — §7.2.
 *
 * Заезд детерминирован, поэтому повтор это не видео, а параметры и сид.
 * Кодируем плотно: две машины с характеристиками, две конфигурации, условия
 * и сид укладываются в ~16 байт плюс длина сида — в base64url это короткая строка,
 * которая целиком живёт в адресе и открывается у кого угодно без регистрации.
 */

import { CAR_MODELS, MAX_SPEC_LEVEL } from '../core/cars.ts';
import { GEARINGS, NITROS, PRESSURES, TIRES, WEIGHT_CUTS } from '../core/tuning.ts';
import type {
  Car, Conditions, Distance, Profile, RaceConfig, Racer, Specs, Surface,
} from '../core/types.ts';
import type { RaceInput } from '../core/race.ts';

const VERSION = 1;
const SPEC_ORDER = ['tires', 'ignition', 'clutch', 'suspension', 'boost', 'intake', 'radiator'] as const;
const DISTANCES: Distance[] = ['short', 'medium', 'long'];
const SURFACES: Surface[] = ['dry', 'wet'];
const PROFILES: Profile[] = ['flat', 'uphill'];

class BitWriter {
  private bits: number[] = [];

  write(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => {
      if (bit) out[i >> 3]! |= 0x80 >> (i & 7);
    });
    return out;
  }
}

class BitReader {
  private offset = 0;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  read(width: number): number {
    let value = 0;
    for (let i = 0; i < width; i++) {
      const bit = (this.data[this.offset >> 3]! >> (7 - (this.offset & 7))) & 1;
      value = (value << 1) | bit;
      this.offset++;
    }
    return value;
  }
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** Сид пишем как ASCII: он короткий и его удобно читать в адресе. */
const SEED_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

function writeCar(writer: BitWriter, car: Car, config: RaceConfig): void {
  const modelIndex = CAR_MODELS.findIndex((m) => m.id === car.modelId);
  if (modelIndex < 0) throw new Error(`Модель вне каталога: ${car.modelId}`);
  writer.write(modelIndex, 6);
  for (const key of SPEC_ORDER) {
    writer.write(Math.min(MAX_SPEC_LEVEL, Math.max(0, Math.round(car.specs[key]))), 4);
  }
  writer.write(TIRES.indexOf(config.tires), 2);
  writer.write(GEARINGS.indexOf(config.gearing), 2);
  writer.write(PRESSURES.indexOf(config.pressure), 2);
  writer.write(NITROS.indexOf(config.nitro), 2);
  writer.write(WEIGHT_CUTS.indexOf(config.weightCut), 2);
}

function readCar(reader: BitReader): { car: Car; config: RaceConfig } {
  const model = CAR_MODELS[reader.read(6)];
  if (!model) throw new Error('Повтор ссылается на неизвестную машину');
  const specs = {} as Specs;
  for (const key of SPEC_ORDER) specs[key] = reader.read(4);
  return {
    car: { modelId: model.id, specs },
    config: {
      tires: TIRES[reader.read(2)]!,
      gearing: GEARINGS[reader.read(2)]!,
      pressure: PRESSURES[reader.read(2)]!,
      nitro: NITROS[reader.read(2)]!,
      weightCut: WEIGHT_CUTS[reader.read(2)]!,
    },
  };
}

/** Заезд → строка для адреса. */
export function encodeRace(input: RaceInput): string {
  const writer = new BitWriter();
  writer.write(VERSION, 4);
  writeCar(writer, input.a.car, input.a.config);
  writeCar(writer, input.b.car, input.b.config);
  writer.write(DISTANCES.indexOf(input.conditions.distance), 2);
  writer.write(SURFACES.indexOf(input.conditions.surface), 1);
  writer.write(PROFILES.indexOf(input.conditions.profile), 1);
  const seed = input.seed.toLowerCase();
  writer.write(seed.length, 5);
  for (const ch of seed) {
    const index = SEED_ALPHABET.indexOf(ch);
    if (index < 0) throw new Error(`Сид содержит недопустимый символ: ${ch}`);
    writer.write(index, 5);
  }
  return base64urlEncode(writer.bytes());
}

export interface DecodedRace extends RaceInput {}

/** Строка из адреса → заезд. Имена игроков едут отдельными параметрами. */
export function decodeRace(code: string, names: { a?: string; b?: string } = {}): DecodedRace {
  const reader = new BitReader(base64urlDecode(code));
  const version = reader.read(4);
  if (version !== VERSION) throw new Error(`Неизвестная версия повтора: ${version}`);
  const a = readCar(reader);
  const b = readCar(reader);
  const conditions: Conditions = {
    distance: DISTANCES[reader.read(2)]!,
    surface: SURFACES[reader.read(1)]!,
    profile: PROFILES[reader.read(1)]!,
  };
  const length = reader.read(5);
  let seed = '';
  for (let i = 0; i < length; i++) seed += SEED_ALPHABET[reader.read(5)];
  const racerA: Racer = { name: names.a ?? 'Гонщик', car: a.car, config: a.config };
  const racerB: Racer = { name: names.b ?? 'Соперник', car: b.car, config: b.config };
  return { a: racerA, b: racerB, conditions, seed };
}

/** Полная ссылка на повтор. Открывается без регистрации — §7.2. */
export function replayUrl(input: RaceInput, origin: string): string {
  const params = new URLSearchParams({ r: encodeRace(input) });
  if (input.a.name) params.set('a', input.a.name);
  if (input.b.name) params.set('b', input.b.name);
  return `${origin}/#${params.toString()}`;
}
