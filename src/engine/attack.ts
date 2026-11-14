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
 * Which armour reduces each damage type. Spiritual damage goes through both
 * physical and magic armour, so nothing reduces it.
 */
export const ARMOUR_AGAINST: Record<DamageType, ArmourType | null> = {
  physical: 'physical',
  magic: 'magic',
  spiritual: null,
};

/** The armour that applies to a damage type: 0 for spiritual damage. */
export function armourAgainst(armour: Armour, damageType: DamageType): number {
  const type = ARMOUR_AGAINST[damageType];
  return type ? armour[type] : 0;
}

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
  /**
   * Flat damage of a second type added on any graze or hit (doubled on a crit),
   * for example fire arrows. It is reduced by its own armour, separately.
   */
  extra?: { damageType: DamageType; amount: number };
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

/** Extra damage of a second type: none on a miss, doubled on a crit, then its own armour. */
export function extraDamageDealt(outcome: AttackOutcome, amount: number, armour: number): number {
  if (outcome === 'miss') return 0;
  const raw = outcome === 'crit' ? amount * 2 : amount;
  return Math.max(0, raw - armour);
}

export interface AttackResult {
  roll: D20Roll;
  modifier: number;
  total: number;
  defense: number;
  outcome: AttackOutcome;
  /** Total damage dealt, including any extra damage. */
  damage: number;
  /** The part of `damage` that came from the attack's extra damage. */
  extraDamage: number;
  /** Graze and hit dice as rolled (0 when the outcome did not need them), for showing the working. */
  grazeRoll: number;
  hitRoll: number;
  /** Armour subtracted from the main damage. */
  armour: number;
  critThreshold: number;
  /** Flat bonus damage added to the main damage before armour (talents, ability bonuses). */
  bonusDamage: number;
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
  /** Added to the main damage of a graze, hit or crit, before armour. Not doubled on a crit. */
  bonusDamage?: number;
  /** Added to the attack roll only, not the damage: the off hand's -3, for instance. */
  rollBonus?: number;
}

/** Rolls a full attack: the d20, then only the damage dice the outcome needs. */
export function resolveAttack(seed: number, input: AttackInput): Rolled<AttackResult> {
  const { profile, modifier, targetDefense, targetArmour, mode = 'normal' } = input;
  const critThreshold = input.critThreshold ?? profile.critThreshold ?? DEFAULT_CRIT_THRESHOLD;

  const d20 = rollD20(seed, mode);
  let next = d20.seed;
  const rollBonus = input.rollBonus ?? 0;
  const outcome = attackOutcome(d20.value.natural, modifier + rollBonus, targetDefense, critThreshold);

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

  const armour = armourAgainst(targetArmour, profile.damageType);
  const bonusDamage = outcome === 'miss' ? 0 : Math.max(0, input.bonusDamage ?? 0);
  const damage = outcome === 'miss' ? 0 : Math.max(0, damageDealt(outcome, grazeRoll, hitRoll, modifier, 0) + bonusDamage - armour);
  const extraDamage = profile.extra
    ? extraDamageDealt(outcome, profile.extra.amount, armourAgainst(targetArmour, profile.extra.damageType))
    : 0;
  return {
    value: {
      roll: d20.value,
      modifier,
      total: d20.value.natural + modifier + rollBonus,
      defense: targetDefense,
      outcome,
      damage: damage + extraDamage,
      extraDamage,
      grazeRoll,
      hitRoll,
      armour,
      critThreshold,
      bonusDamage,
    },
    seed: next,
  };
}
