import type { Armour } from './attack';
import { STARTING_PURSE } from './currency';
import { defenseOf, maxHitPoints, type ClassNumbers } from './derived';
import {
  gearTotals,
  missingAmmo,
  STARTING_AMMO,
  validateEquipment,
  type ArmourProficiency,
  type Equipment,
  type InventoryStack,
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
  /** Abilities granted by gear. */
  gearAbilityIds: string[];
}

type SheetSource = Pick<MercDraft, 'baseStats' | 'raceChoices'> & {
  injuries?: Injury[];
  level?: number;
  equipment?: Equipment;
  loadout?: Loadout;
};

/** Everything the character sheet shows that is worked out rather than stored. */
export function mercSheet(merc: SheetSource, race: RaceDefinition, cls: ClassNumbers, getItem: ItemLookup): MercSheet {
  const gear = gearTotals(merc.equipment ?? merc.loadout ?? {}, getItem);
  const stats = applyStatChanges(finalStats(merc, race), gear.stats);
  return {
    stats,
    maxHp: maxHitPoints(cls, stats, merc.level ?? 1, raceBonusHp(race) + gear.maxHp),
    defense: defenseOf(cls, stats, gear.defense),
    armour: {
      physical: raceBaseArmour(race, 'physical') + gear.armour.physical,
      magic: raceBaseArmour(race, 'magic') + gear.armour.magic,
    },
    gearAbilityIds: gear.abilityIds,
  };
}
