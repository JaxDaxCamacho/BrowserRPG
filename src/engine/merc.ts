import type { Armour } from './attack';
import { STARTING_PURSE } from './currency';
import { defenseOf, maxHitPoints, type ClassNumbers } from './derived';
import {
  addEffects,
  gearTotals,
  missingAmmo,
  STARTING_AMMO,
  validateEquipment,
  type ArmourProficiency,
  type Equipment,
  type InventoryStack,
  type ItemEffect,
  type ItemLookup,
  type Loadout,
} from './items';
import { injuryStatChanges, type Injury } from './injuries';
import { raceBaseArmour, raceBonusHp, type RaceDefinition } from './race';
import {
  applyStatChanges,
  CREATION_POINTS,
  creationPointsSpent,
  isValidCreationSpread,
  type StatChanges,
  type StatName,
  type Stats,
} from './stats';

export const MAX_NAME_LENGTH = 24;

/** What the player fills in when building a merc, or what a pre-built merc supplies. */
export interface MercDraft {
  name: string;
  raceId: string;
  classId: string;
  gender?: 'female' | 'male';
  /** Asset id of the portrait shown on the merc's token. */
  portrait?: string;
  /** Stats after spending creation points, before race changes. */
  baseStats: Stats;
  /** Stats picked for a race that lets the player choose its bonus (Human). */
  raceChoices: StatName[];
  /** Starting gear picked at creation. */
  loadout: Loadout;
  /** Set when the merc came from the pre-built roster. */
  premadeId?: string;
  /** Talents taken at creation, with the starting talent point: tier 1 talents of the class. */
  startingTalents?: string[];
}

export interface Merc extends Omit<MercDraft, 'loadout'> {
  id: string;
  level: number;
  xp: number;
  equipment: Equipment;
  inventory: InventoryStack[];
  /** Money in copper. */
  purse: number;
  /** Damage taken; current HP is max HP minus this. */
  wounds: number;
  /** At 0 HP: out of action until healed. */
  down: boolean;
  /** Potions still working, and for how many more encounters. */
  potionEffects: { itemId: string; encounters: number }[];
  /** Lasting injuries from being knocked down; each lowers stats until healed. */
  injuries: Injury[];
  /** Killed by a fourth injury. Dead mercs stay on the roster but take no part. */
  dead: boolean;
  /** Stat points spent from levelling, added on top of the base stats. */
  levelStats: StatChanges;
  /** Talent id to ranks taken. */
  talents: Record<string, number>;
}

/** Base stats with the race's fixed changes, chosen bonuses and any injuries applied (no gear). */
export function finalStats(
  merc: Pick<MercDraft, 'baseStats' | 'raceChoices'> & { injuries?: Injury[]; levelStats?: StatChanges },
  race: RaceDefinition,
): Stats {
  const chosen: StatChanges = {};
  for (const name of merc.raceChoices) {
    chosen[name] = (chosen[name] ?? 0) + (race.statChoices?.amount ?? 0);
  }
  const trained = merc.levelStats ? applyStatChanges(merc.baseStats, merc.levelStats) : merc.baseStats;
  const withRace = applyStatChanges(applyStatChanges(trained, race.statChanges), chosen);
  return merc.injuries?.length ? applyStatChanges(withRace, injuryStatChanges(merc.injuries)) : withRace;
}

export interface GearContext {
  armourProficiency: ArmourProficiency;
  getItem: ItemLookup;
}

/** Problems that stop a draft from joining the party. Empty means it is ready. */
export function validateDraft(draft: MercDraft, race: RaceDefinition, gear: GearContext): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (name.length === 0) problems.push('Give your mercenary a name.');
  if (name.length > MAX_NAME_LENGTH) problems.push(`Names can be at most ${MAX_NAME_LENGTH} characters.`);

  if (!isValidCreationSpread(draft.baseStats)) {
    problems.push('Stats cannot go below their starting value or use more points than you have.');
  } else {
    const left = CREATION_POINTS - creationPointsSpent(draft.baseStats);
    if (left > 0) problems.push(`Spend your remaining ${left} stat point${left === 1 ? '' : 's'}.`);
  }

  const needed = race.statChoices?.count ?? 0;
  const distinct = new Set(draft.raceChoices).size;
  if (distinct !== draft.raceChoices.length || draft.raceChoices.length !== needed) {
    problems.push(
      needed === 0
        ? `${race.name} has no stat bonus to choose.`
        : `Choose ${needed} different stats for the ${race.name} bonus.`,
    );
  }

  if (!draft.loadout.mainHand) problems.push('Choose a weapon.');
  problems.push(...validateEquipment(draft.loadout, { ...gear, race, startersOnly: true }));
  const unfed = missingAmmo(draft.loadout, gear.getItem);
  if (unfed) problems.push(`The ${unfed.name} needs ammunition.`);
  return problems;
}

/** Turns a validated draft into the starting equipment, inventory and purse of a new merc. */
export function startingKit(
  draft: MercDraft,
): Pick<Merc, 'equipment' | 'inventory' | 'purse' | 'wounds' | 'down' | 'potionEffects' | 'injuries' | 'dead' | 'levelStats' | 'talents'> {
  const equipment: Equipment = { ...draft.loadout };
  const inventory: InventoryStack[] = draft.loadout.ammo ? [{ itemId: draft.loadout.ammo, quantity: STARTING_AMMO }] : [];
  return { equipment, inventory, purse: STARTING_PURSE, wounds: 0, down: false, potionEffects: [], injuries: [], dead: false, levelStats: {}, talents: {} };
}

export interface MercSheet {
  /** Final stats including race and gear. */
  stats: Stats;
  maxHp: number;
  defense: number;
  armour: Armour;
  /** Abilities granted by gear and talents. */
  abilityIds: string[];
  /** Combat extras from gear and talents. */
  movementBonus: number;
  /** Flat damage on every weapon attack that lands. */
  damageBonus: number;
  /** Extra flat damage while the main weapon needs both hands. */
  twoHandedDamageBonus: number;
  /** How many numbers lower the weapon crits. */
  critRange: number;
  /** Damage dealt back to melee attackers who land a blow. */
  retaliate: number;
  /** Strength and movement per quarter of max HP missing. */
  bloodrage: number;
  /** Turns taken off hostile conditions. */
  statusResist: number;
  /** Extra damage and mana drained on weapon hits against casters. */
  manaBurn: number;
  /** Taken off the off-hand weapon's attack penalty. */
  twinWeapons: number;
  /** Added to weapon attack rolls; the two-handed part only counts with a two-handed weapon. */
  attackBonus: number;
  twoHandedAttackBonus: number;
  /** Extra crit range with a two-handed weapon. */
  twoHandedCritRange: number;
  /** Percentage of a critical hit's damage healed back. */
  critHeal: number;
  /** Defense for 2 rounds after being healed by an ability or talent. */
  healedDefense: number;
  /** What the shield adds to Defense, after talents scale it (0 without a shield). */
  shieldDefense: number;
  riposte: number;
  intervene: number;
  auras: { bonus: 'attack' | 'defense'; amount: number; radius: number }[];
  leadDamage: number;
}

type SheetSource = Pick<MercDraft, 'baseStats' | 'raceChoices'> & {
  injuries?: Injury[];
  level?: number;
  equipment?: Equipment;
  loadout?: Loadout;
};

/** Everything the character sheet shows that is worked out rather than stored. */
export function mercSheet(
  merc: SheetSource,
  race: RaceDefinition,
  cls: ClassNumbers,
  getItem: ItemLookup,
  /** Passive effects and abilities from talents. */
  talentEffects: ItemEffect[] = [],
): MercSheet {
  const gear = gearTotals(merc.equipment ?? merc.loadout ?? {}, getItem);
  addEffects(gear, talentEffects);
  const stats = applyStatChanges(finalStats(merc, race), gear.stats);
  // Talents can scale the shield's Defense (rounded up) and lift heavy armour's penalty.
  const shieldDefense = gear.shieldDefense > 0 ? Math.ceil(gear.shieldDefense * (1 + gear.shieldBoost)) : 0;
  const gearDefense = gear.defense + (shieldDefense - gear.shieldDefense) - (gear.ignoreArmourPenalty ? gear.heavyPenalty : 0);
  return {
    stats,
    maxHp: maxHitPoints(cls, stats, merc.level ?? 1, raceBonusHp(race) + gear.maxHp),
    defense: defenseOf(cls, stats, gearDefense),
    armour: {
      physical: raceBaseArmour(race, 'physical') + gear.armour.physical,
      magic: raceBaseArmour(race, 'magic') + gear.armour.magic,
    },
    abilityIds: gear.abilityIds,
    movementBonus: gear.movement,
    damageBonus: gear.damage,
    twoHandedDamageBonus: gear.twoHandedDamage,
    critRange: gear.critRange,
    retaliate: gear.retaliate,
    bloodrage: gear.bloodrage,
    statusResist: gear.statusResist,
    manaBurn: gear.manaBurn,
    twinWeapons: gear.twinWeapons,
    attackBonus: gear.attackBonus,
    twoHandedAttackBonus: gear.twoHandedAttackBonus,
    twoHandedCritRange: gear.twoHandedCritRange,
    critHeal: gear.critHeal,
    healedDefense: gear.healedDefense,
    shieldDefense,
    riposte: gear.riposte,
    intervene: gear.intervene,
    auras: gear.auras,
    leadDamage: gear.leadDamage,
  };
}
