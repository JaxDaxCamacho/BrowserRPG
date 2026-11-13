import type { ArmourType, AttackProfile, DamageType } from './attack';
import type { RaceDefinition, WeaponType } from './race';
import { raceCanWield } from './race';
import type { StatName } from './stats';

/**
 * Gear is data. These types describe every kind of item the game knows;
 * the content schema checks the JSON files against the same shapes.
 */

export const EQUIP_SLOTS = ['mainHand', 'offHand', 'body', 'head', 'hands', 'feet', 'neck', 'ring1', 'ring2', 'ammo'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Slots chosen at character creation. */
export const STARTING_SLOTS = ['mainHand', 'offHand', 'body', 'ammo'] as const;
export type StartingSlot = (typeof STARTING_SLOTS)[number];

export type Equipment = Partial<Record<EquipSlot, string>>;
export type Loadout = Partial<Record<StartingSlot, string>>;

export interface InventoryStack {
  itemId: string;
  quantity: number;
  /** Top-left cell in the merc's pack grid. Set when the item is placed. */
  x?: number;
  y?: number;
}

/** Arrows or bolts given with a starting ranged weapon. */
export const STARTING_AMMO = 20;

/** How heavy a piece of armour is, from none at all to plate. */
export const ARMOUR_WEIGHTS = ['clothing', 'light', 'medium', 'heavy'] as const;
export type ArmourWeight = (typeof ARMOUR_WEIGHTS)[number];

/** What a class may wear, as stored in the class data. */
export type ArmourProficiency = 'none' | 'light' | 'medium' | 'heavy';

export const DAMAGE_STYLES = ['slash', 'blunt', 'pierce', 'arcane'] as const;
export type DamageStyle = (typeof DAMAGE_STYLES)[number];

export const AMMO_TYPES = ['arrow', 'bolt'] as const;
export type AmmoType = (typeof AMMO_TYPES)[number];

/** Something an item grants while equipped (or, for a potion, while it lasts). */
export type ItemEffect =
  | { type: 'stat'; stat: StatName; amount: number }
  | { type: 'armour'; armour: ArmourType; amount: number }
  | { type: 'defense'; amount: number }
  | { type: 'maxHp'; amount: number }
  | { type: 'ability'; abilityId: string }
  /** Potions only: restores hit points once, when drunk. */
  | { type: 'heal'; amount: number }
  /** Extra tiles of movement in a fight. */
  | { type: 'movement'; amount: number }
  /** Flat damage added to every weapon attack that lands; with `twoHandedOnly`, only while wielding a two-handed weapon. */
  | { type: 'damage'; amount: number; twoHandedOnly?: boolean }
  /** Widens the weapon's critical range: 1 means it crits on one number lower. */
  | { type: 'critRange'; amount: number }
  /** Melee attackers that land a blow take this much damage back. */
  | { type: 'retaliate'; amount: number }
  /** For every quarter of max HP missing: +amount Strength and +amount movement. */
  | { type: 'bloodrage'; amount: number }
  /** Hostile conditions last this many fewer turns; cut to nothing, they do not take hold. */
  | { type: 'statusResist'; amount: number }
  /** Weapon hits on a caster deal this much extra damage and drain as much mana. */
  | { type: 'manaBurn'; amount: number };

interface ItemBase {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  /** Price in copper. */
  value: number;
  /** Can be picked as starting gear at character creation. */
  starter: boolean;
}

export interface WeaponItem extends ItemBase {
  kind: 'weapon';
  weaponType: WeaponType;
  style: DamageStyle;
  hands: 1 | 2;
  /** Reach in tiles; 0 means melee, the eight tiles around the wielder. */
  range: number;
  attack: AttackProfile;
  /** Ranged weapons that shoot need this ammunition. */
  ammo?: AmmoType;
  /** Sprite-sheet animation for its attacks; a default by style is used when missing. */
  animation?: string;
  effects: ItemEffect[];
}

export interface ArmourItem extends ItemBase {
  kind: 'armour';
  slot: 'body' | 'head' | 'hands' | 'feet';
  weight: ArmourWeight;
  /** Zero or less: heavier armour makes a merc easier to hit. */
  defense: number;
  physicalArmour: number;
  magicArmour: number;
  effects: ItemEffect[];
}

export interface ShieldItem extends ItemBase {
  kind: 'shield';
  /** Shields raise Defense but give no armour. */
  defense: number;
  effects: ItemEffect[];
}

export interface TrinketItem extends ItemBase {
  kind: 'trinket';
  slot: 'neck' | 'ring';
  effects: ItemEffect[];
}

export interface PotionItem extends ItemBase {
  kind: 'potion';
  effects: ItemEffect[];
  /** How many encounters the lasting effects stay active. Healing is instant. */
  encounters?: number;
}

export interface AmmoItem extends ItemBase {
  kind: 'ammo';
  ammoType: AmmoType;
  /** Added to the weapon's graze and hit damage. */
  bonusGraze: number;
  bonusHit: number;
  /** Damage of another type added on top, reduced by its own armour. */
  extraDamage?: { damageType: DamageType; amount: number };
}

/** Supplies used outside fights. A healing kit cures one injury during a long rest. */
export interface KitItem extends ItemBase {
  kind: 'kit';
  use: 'healInjury';
}

export type ItemDefinition = WeaponItem | ArmourItem | ShieldItem | TrinketItem | PotionItem | AmmoItem | KitItem;
export type ItemKind = ItemDefinition['kind'];

export type ItemLookup = (id: string) => ItemDefinition;

/** Which item kinds each slot takes. */
export function slotAccepts(slot: EquipSlot, item: ItemDefinition): boolean {
  switch (slot) {
    case 'mainHand':
      return item.kind === 'weapon';
    case 'offHand':
      return item.kind === 'shield' || (item.kind === 'weapon' && item.hands === 1);
    case 'body':
    case 'head':
    case 'hands':
    case 'feet':
      return item.kind === 'armour' && item.slot === slot;
    case 'neck':
      return item.kind === 'trinket' && item.slot === 'neck';
    case 'ring1':
    case 'ring2':
      return item.kind === 'trinket' && item.slot === 'ring';
    case 'ammo':
      return item.kind === 'ammo';
  }
}

const WEIGHT_ORDER: Record<ArmourWeight, number> = { clothing: 0, light: 1, medium: 2, heavy: 3 };
const PROFICIENCY_ORDER: Record<ArmourProficiency, number> = { none: 0, light: 1, medium: 2, heavy: 3 };

export function canWearArmour(proficiency: ArmourProficiency, weight: ArmourWeight): boolean {
  return WEIGHT_ORDER[weight] <= PROFICIENCY_ORDER[proficiency];
}

/** Hands the weapon takes for this race: a Goliath carries a two-hander in one. */
function handsUsed(race: RaceDefinition, weapon: WeaponItem): 1 | 2 {
  return race.passives.some((p) => p.type === 'giantGrip') ? 1 : weapon.hands;
}

export interface LoadoutContext {
  race: RaceDefinition;
  armourProficiency: ArmourProficiency;
  getItem: ItemLookup;
  /** At character creation only starter gear may be picked. */
  startersOnly: boolean;
}

/** Problems with a set of equipped items. Empty means it is allowed. */
export function validateEquipment(equipment: Equipment, ctx: LoadoutContext): string[] {
  const problems: string[] = [];
  const items: Partial<Record<EquipSlot, ItemDefinition>> = {};

  for (const slot of EQUIP_SLOTS) {
    const id = equipment[slot];
    if (!id) continue;
    let item: ItemDefinition;
    try {
      item = ctx.getItem(id);
    } catch {
      problems.push(`Unknown item "${id}".`);
      continue;
    }
    if (!slotAccepts(slot, item)) {
      problems.push(`${item.name} cannot go in that slot.`);
      continue;
    }
    if (ctx.startersOnly && !item.starter) problems.push(`${item.name} is not starting gear.`);
    items[slot] = item;
  }

  const main = items.mainHand;
  const off = items.offHand;
  for (const weapon of [main, off]) {
    if (weapon?.kind === 'weapon' && !raceCanWield(ctx.race, weapon.hands)) {
      problems.push(`A ${ctx.race.name} cannot use one-handed weapons like the ${weapon.name}.`);
    }
  }
  if (main?.kind === 'weapon' && off && handsUsed(ctx.race, main) === 2) {
    problems.push(`The ${main.name} needs both hands, so the off hand must stay empty.`);
  }

  const body = items.body;
  for (const piece of [body, items.head, items.hands, items.feet]) {
    if (piece?.kind === 'armour' && !canWearArmour(ctx.armourProficiency, piece.weight)) {
      problems.push(`This class cannot wear ${piece.weight} armour like the ${piece.name}.`);
    }
  }

  const ammo = items.ammo;
  if (ammo?.kind === 'ammo') {
    const launcher = [main, off].find((w) => w?.kind === 'weapon' && w.ammo);
    if (!launcher || launcher.kind !== 'weapon' || launcher.ammo !== ammo.ammoType) {
      problems.push(`The ${ammo.name} do not fit any equipped weapon.`);
    }
  }
  return problems;
}

/** A ranged weapon that is missing its ammunition. */
export function missingAmmo(equipment: Equipment, getItem: ItemLookup): WeaponItem | null {
  const main = equipment.mainHand ? getItem(equipment.mainHand) : null;
  if (main?.kind !== 'weapon' || !main.ammo) return null;
  return equipment.ammo ? null : main;
}

export interface GearTotals {
  stats: Partial<Record<StatName, number>>;
  defense: number;
  armour: Record<ArmourType, number>;
  maxHp: number;
  abilityIds: string[];
  movement: number;
  damage: number;
  twoHandedDamage: number;
  critRange: number;
  retaliate: number;
  bloodrage: number;
  statusResist: number;
  manaBurn: number;
}

export function emptyTotals(): GearTotals {
  return {
    stats: {},
    defense: 0,
    armour: { physical: 0, magic: 0 },
    maxHp: 0,
    abilityIds: [],
    movement: 0,
    damage: 0,
    twoHandedDamage: 0,
    critRange: 0,
    retaliate: 0,
    bloodrage: 0,
    statusResist: 0,
    manaBurn: 0,
  };
}

/** Adds a list of effects (from gear or talents) into running totals. */
export function addEffects(totals: GearTotals, effects: ItemEffect[]) {
  for (const effect of effects) {
    switch (effect.type) {
      case 'stat':
        totals.stats[effect.stat] = (totals.stats[effect.stat] ?? 0) + effect.amount;
        break;
      case 'armour':
        totals.armour[effect.armour] += effect.amount;
        break;
      case 'defense':
        totals.defense += effect.amount;
        break;
      case 'maxHp':
        totals.maxHp += effect.amount;
        break;
      case 'ability':
        if (!totals.abilityIds.includes(effect.abilityId)) totals.abilityIds.push(effect.abilityId);
        break;
      case 'movement':
        totals.movement += effect.amount;
        break;
      case 'damage':
        if (effect.twoHandedOnly) totals.twoHandedDamage += effect.amount;
        else totals.damage += effect.amount;
        break;
      case 'critRange':
        totals.critRange += effect.amount;
        break;
      case 'retaliate':
        totals.retaliate += effect.amount;
        break;
      case 'bloodrage':
        totals.bloodrage += effect.amount;
        break;
      case 'statusResist':
        totals.statusResist += effect.amount;
        break;
      case 'manaBurn':
        totals.manaBurn += effect.amount;
        break;
      case 'heal':
        break;
    }
  }
}

/** Everything equipped gear adds up to. Ammunition only matters when attacking. */
export function gearTotals(equipment: Equipment, getItem: ItemLookup): GearTotals {
  const totals = emptyTotals();
  for (const slot of EQUIP_SLOTS) {
    const id = equipment[slot];
    if (!id) continue;
    const item = getItem(id);
    switch (item.kind) {
      case 'armour':
        totals.defense += item.defense;
        totals.armour.physical += item.physicalArmour;
        totals.armour.magic += item.magicArmour;
        addEffects(totals, item.effects);
        break;
      case 'shield':
        totals.defense += item.defense;
        addEffects(totals, item.effects);
        break;
      case 'weapon':
      case 'trinket':
        addEffects(totals, item.effects);
        break;
      case 'potion':
      case 'ammo':
      case 'kit':
        break;
    }
  }
  return totals;
}

/** Adds a flat bonus to dice notation: "3" + 1 = "4", "1d8" + 1 = "1d8+1". */
export function addToDice(text: string, bonus: number): string {
  if (bonus === 0) return text;
  if (/^\d+$/.test(text)) return String(Math.max(0, Number(text) + bonus));
  const match = /^(\d+d\d+)([+-]\d+)?$/.exec(text);
  if (!match) throw new Error(`Not valid dice notation: "${text}"`);
  const total = (match[2] ? Number(match[2]) : 0) + bonus;
  return total === 0 ? match[1]! : `${match[1]}${total > 0 ? '+' : ''}${total}`;
}

/** The attack a weapon makes, with any ammunition's bonuses folded in. */
export function weaponAttack(weapon: WeaponItem, ammo?: AmmoItem): AttackProfile {
  if (!ammo) return weapon.attack;
  return {
    ...weapon.attack,
    graze: addToDice(weapon.attack.graze, ammo.bonusGraze),
    hit: addToDice(weapon.attack.hit, ammo.bonusHit),
    ...(ammo.extraDamage ? { extra: ammo.extraDamage } : {}),
  };
}

/** Uses one piece of ammunition from the merc's inventory. Returns null when there is none left. */
export function spendAmmo(inventory: InventoryStack[], ammoId: string): InventoryStack[] | null {
  const stack = inventory.find((s) => s.itemId === ammoId);
  if (!stack || stack.quantity < 1) return null;
  return inventory
    .map((s) => (s.itemId === ammoId ? { ...s, quantity: s.quantity - 1 } : s))
    .filter((s) => s.quantity > 0);
}
