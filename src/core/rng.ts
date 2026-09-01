/**
 * Детерминированный ГПСЧ. Источник случайности в ядре заезда только один — сид (§3).
 * xmur3 (строка → 32-битный сид) + mulberry32 (сид → поток [0,1)).
 */

export type Rng = () => number;

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Один и тот же сид всегда даёт один и тот же поток. */
export function makeRng(seed: string): Rng {
  return mulberry32(xmur3(seed)());
}

/**
 * Короткий читаемый сид для ссылки-повтора.
 * Источник энтропии передаётся снаружи: внутри ядра его быть не должно.
 */
export function randomSeed(source: () => number): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(source() * alphabet.length)] ?? '2';
  }
  return out;
}
