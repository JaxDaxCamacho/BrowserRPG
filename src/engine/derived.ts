import { rollD20, type D20Roll } from './dice';
import type { Rolled } from './rng';
import { statModifier, type Stats } from './stats';

/** The class numbers the derived values need. Class data files supply these. */
export interface ClassNumbers {
  baseHp: number;
  hpPerLevel: number;
  baseDefense: number;
}

/**
 * HP = class base + Toughness modifier at level 1, then the class growth +
 * Toughness modifier for each level after that, plus flat bonuses (race, gear).
 * Never less than 1.
 */
export function maxHitPoints(cls: ClassNumbers, stats: Stats, level: number, flatBonus: number = 0): number {
  const tough = statModifier(stats.toughness);
  const hp = cls.baseHp + tough + (level - 1) * (cls.hpPerLevel + tough) + flatBonus;
  return Math.max(1, hp);
}

/** Defense = class base Defense + Agility modifier. Armour is separate and reduces damage. */
export function defenseOf(cls: ClassNumbers, stats: Stats, bonus: number = 0): number {
  return cls.baseDefense + statModifier(stats.agility) + bonus;
}

export interface InitiativeRoll {
  roll: D20Roll;
  total: number;
}

/** Initiative = d20 + Agility modifier, rolled once when combat starts. */
export function rollInitiative(seed: number, stats: Stats): Rolled<InitiativeRoll> {
  const rolled = rollD20(seed);
  return {
    value: { roll: rolled.value, total: rolled.value.natural + statModifier(stats.agility) },
    seed: rolled.seed,
  };
}
