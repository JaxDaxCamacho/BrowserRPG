import { DEFAULT_CRIT_THRESHOLD, type ArmourType } from './attack';
import type { StatChanges } from './stats';

export const WEAPON_TYPES = [
  'sword',
  'dagger',
  'axe',
  'mace',
  'hammer',
  'club',
  'spear',
  'bow',
  'crossbow',
  'staff',
  'wand',
  'focus',
] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

/** A race's always-on ability. Each kind is read by the system it affects. */
export type RacePassive =
  /** Earns XP faster: 0.03 means +3%. */
  | { type: 'xpRate'; bonus: number }
  /** Armour the merc has before any gear. */
  | { type: 'baseArmour'; armour: ArmourType; amount: number }
  /** Crits on a lower natural roll with certain weapon types. */
  | { type: 'critThreshold'; threshold: number; weaponTypes: WeaponType[] }
  /** Flat extra hit points. */
  | { type: 'bonusHp'; amount: number }
  /** Wields two-handed weapons in one hand, but cannot use one-handed weapons. */
  | { type: 'giantGrip' }
  /** When going down, rolls a d20: at or above `difficulty` they are knocked down instead of dead. */
  | { type: 'deathSave'; difficulty: number };

export interface RaceDefinition {
  id: string;
  name: string;
  icon?: string;
  statChanges: StatChanges;
  /** For races that let the player pick: `count` different stats each get `amount`. */
  statChoices?: { count: number; amount: number };
  passives: RacePassive[];
}

function passivesOfType<T extends RacePassive['type']>(
  race: RaceDefinition,
  type: T,
): Extract<RacePassive, { type: T }>[] {
  return race.passives.filter((p): p is Extract<RacePassive, { type: T }> => p.type === type);
}

export function raceXpMultiplier(race: RaceDefinition): number {
  return 1 + passivesOfType(race, 'xpRate').reduce((sum, p) => sum + p.bonus, 0);
}

export function raceBaseArmour(race: RaceDefinition, armour: ArmourType): number {
  return passivesOfType(race, 'baseArmour')
    .filter((p) => p.armour === armour)
    .reduce((sum, p) => sum + p.amount, 0);
}

export function raceBonusHp(race: RaceDefinition): number {
  return passivesOfType(race, 'bonusHp').reduce((sum, p) => sum + p.amount, 0);
}

/** The crit threshold for this race with this weapon: the lowest of the weapon's own and any racial one. */
export function raceCritThreshold(
  race: RaceDefinition,
  weaponType: WeaponType,
  weaponThreshold: number = DEFAULT_CRIT_THRESHOLD,
): number {
  const racial = passivesOfType(race, 'critThreshold')
    .filter((p) => p.weaponTypes.includes(weaponType))
    .map((p) => p.threshold);
  return Math.min(weaponThreshold, ...racial);
}

/** Whether this race can wield a weapon that needs this many hands. */
export function raceCanWield(race: RaceDefinition, weaponHands: 1 | 2): boolean {
  const giant = passivesOfType(race, 'giantGrip').length > 0;
  return giant ? weaponHands === 2 : true;
}

/** How many hands the weapon takes up for this race. */
export function raceHandsUsed(race: RaceDefinition, weaponHands: 1 | 2): 1 | 2 {
  const giant = passivesOfType(race, 'giantGrip').length > 0;
  return giant ? 1 : weaponHands;
}

/** The d20 result needed to be knocked down instead of dead, or null if the race has no such save. */
export function raceDeathSaveDifficulty(race: RaceDefinition): number | null {
  const saves = passivesOfType(race, 'deathSave').map((p) => p.difficulty);
  return saves.length > 0 ? Math.min(...saves) : null;
}
