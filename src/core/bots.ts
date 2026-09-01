/**
 * Боты. §12: холодный старт и асинхронность вызова. Обычная математика,
 * никакого генеративного ИИ. Детерминированы от сида, как и всё остальное.
 */

import type { Conditions, RaceConfig, Tires } from './types.ts';
import type { Rng } from './rng.ts';
import { GEARINGS, NITROS, PRESSURES, TIRES, WEIGHT_CUTS, bestConfigFor } from './tuning.ts';

/** Три уровня сложности — §12. */
export type BotSkill = 'rookie' | 'regular' | 'ace';

/** «Характер»: чем бот злоупотребляет, когда ошибается. */
export type BotCharacter = 'careful' | 'greedy' | 'stubborn';

export const BOT_SKILLS: BotSkill[] = ['rookie', 'regular', 'ace'];

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] ?? items[0]!;
}

/** Сколько осей бот путает. Ace ошибается максимум в одной. */
const MISTAKES: Record<BotSkill, number> = { rookie: 3, regular: 2, ace: 1 };

export function botConfig(
  conditions: Conditions,
  skill: BotSkill,
  character: BotCharacter,
  rng: Rng,
): RaceConfig {
  const config: RaceConfig = { ...bestConfigFor(conditions) };
  const axes: (keyof RaceConfig)[] = ['tires', 'gearing', 'pressure', 'nitro', 'weightCut'];

  // Новичок вообще не думает про резину примерно в половине случаев — отсюда пробуксовка на старте.
  let budget = MISTAKES[skill];
  if (skill === 'ace' && rng() < 0.35) budget = 0;

  const shuffled = [...axes].sort(() => rng() - 0.5);
  for (const axis of shuffled) {
    if (budget <= 0) break;
    if (axis === 'tires' && skill === 'ace') continue;
    if (axis === 'tires' && skill === 'regular' && rng() < 0.7) continue;
    budget--;
    switch (axis) {
      case 'tires': config.tires = pick(rng, TIRES) as Tires; break;
      case 'gearing': config.gearing = pick(rng, GEARINGS); break;
      case 'pressure': config.pressure = pick(rng, PRESSURES); break;
      case 'nitro': config.nitro = character === 'careful' ? 'none' : pick(rng, NITROS); break;
      case 'weightCut':
        config.weightCut = character === 'greedy' ? 2 : character === 'stubborn' ? 0 : pick(rng, WEIGHT_CUTS);
        break;
    }
  }
  return config;
}

export function botCharacter(rng: Rng): BotCharacter {
  return pick(rng, ['careful', 'greedy', 'stubborn'] as const);
}
