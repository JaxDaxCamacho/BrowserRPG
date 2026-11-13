import { rollD20, rollDice, type D20Roll, type RollMode } from './dice';
import type { Rolled } from './rng';
import type { StatName } from './stats';

/** How an attack is delivered. Decides which stat drives it. */
export type AttackKind = 'melee' | 'ranged' | 'magic' | 'spiritual';
/** What the damage is made of. Decides which armour reduces it. */
export type DamageType = 'physical' | 'magic' | 'spiritual';
export type ArmourType = 'physical' | 'magic';

export const ATTACK_STAT: Record<AttackKind, StatName> = {
  melee: 'strength',
  ranged: 'agility',
  magic: 'intellect',
  spiritual: 'spirit',
};

/**
 * Which armour reduces each damage type.
 * Spiritual damage against magic armour is a proposed default, not yet confirmed.
 */
export const ARMOUR_AGAINST: Record<DamageType, ArmourType> = {
  physical: 'physical',
  magic: 'magic',
  spiritual: 'magic',
};

export const DEFAULT_CRIT_THRESHOLD = 20;

export interface AttackProfile {
  kind: AttackKind;
  damageType: DamageType;
  /** Dice notation for damage on a graze, e.g. "2" or "1d4". */
  graze: string;
  /** Dice notation for damage on a hit, e.g. "1d8". */
  hit: string;
  /** Natural d20 value at or above which the attack crits. Defaults to 20. */
  critThreshold?: number;
}

export type Armour = Record<ArmourType, number>;

export type AttackOutcome = 'miss' | 'graze' | 'hit' | 'crit';

/**
 * Reads the outcome off the die:
 * - natural 1 always misses
 * - natural 20, or the attack's crit threshold, always crits whatever the Defense
 * - total above Defense is a hit
 * - total equal to or below Defense is a graze
 */
export function attackOutcome(
  natural: number,
  modifier: number,
  defense: number,
  critThreshold: number = DEFAULT_CRIT_THRESHOLD,
): AttackOutcome {
  if (natural === 1) return 'miss';
  if (natural === 20 || natural >= critThreshold) return 'crit';
  return natural + modifier > defense ? 'hit' : 'graze';
}

/**
 * Turns rolled damage dice into damage dealt.
 * The stat modifier is added to the dice; on a crit graze, hit and modifier are
 * all doubled. Armour is subtracted once, last, and can reduce damage to 0.
 */
export function damageDealt(
  outcome: AttackOutcome,
  grazeRoll: number,
  hitRoll: number,
  modifier: number,
  armour: number,
): number {
  let raw: number;
  switch (outcome) {
    case 'miss':
      return 0;
    case 'graze':
      raw = grazeRoll + modifier;
      break;
    case 'hit':
      raw = hitRoll + modifier;
      break;
    case 'crit':
      raw = (grazeRoll + hitRoll + modifier) * 2;
      break;
  }
  return Math.max(0, raw - armour);
}

export interface AttackResult {
  roll: D20Roll;
  modifier: number;
  total: number;
  defense: number;
  outcome: AttackOutcome;
  damage: number;
}

export interface AttackInput {
  profile: AttackProfile;
  /** The attacker's modifier for the stat that drives this attack. */
  modifier: number;
  targetDefense: number;
  targetArmour: Armour;
  mode?: RollMode;
  /** Overrides the profile's crit threshold, e.g. from a race passive or talent. */
  critThreshold?: number;
}

/** Rolls a full attack: the d20, then only the damage dice the outcome needs. */
export function resolveAttack(seed: number, input: AttackInput): Rolled<AttackResult> {
  const { profile, modifier, targetDefense, targetArmour, mode = 'normal' } = input;
  const critThreshold = input.critThreshold ?? profile.critThreshold ?? DEFAULT_CRIT_THRESHOLD;

  const d20 = rollD20(seed, mode);
  let next = d20.seed;
  const outcome = attackOutcome(d20.value.natural, modifier, targetDefense, critThreshold);

  let grazeRoll = 0;
  let hitRoll = 0;
  if (outcome === 'graze' || outcome === 'crit') {
    const r = rollDice(next, profile.graze);
    grazeRoll = r.value;
    next = r.seed;
  }
  if (outcome === 'hit' || outcome === 'crit') {
    const r = rollDice(next, profile.hit);
    hitRoll = r.value;
    next = r.seed;
  }

  const armour = targetArmour[ARMOUR_AGAINST[profile.damageType]];
  return {
    value: {
      roll: d20.value,
      modifier,
      total: d20.value.natural + modifier,
      defense: targetDefense,
      outcome,
      damage: damageDealt(outcome, grazeRoll, hitRoll, modifier, armour),
    },
    seed: next,
  };
}
