import type { GameState } from './gameState';
import {
  slotAccepts,
  validateEquipment,
  type ArmourProficiency,
  type EquipSlot,
  type InventoryStack,
  type ItemDefinition,
  type ItemLookup,
} from './items';
import type { Merc } from './merc';
import type { RaceDefinition } from './race';

/**
 * Each merc carries a pack laid out as a grid, Diablo style: every item takes
 * up a block of cells by its size, and stacks (arrows, potions) share one block.
 */

export const PACK_WIDTH = 10;
export const PACK_HEIGHT = 4;

export interface Size {
  w: number;
  h: number;
}

/** How many cells an item takes in a pack. */
export function itemSize(item: ItemDefinition): Size {
  switch (item.kind) {
    case 'weapon':
      return item.hands === 2 ? { w: 2, h: 4 } : { w: 1, h: 3 };
    case 'armour':
      return item.slot === 'body' ? { w: 2, h: 3 } : { w: 2, h: 2 };
    case 'shield':
      return { w: 2, h: 2 };
    case 'trinket':
    case 'potion':
      return { w: 1, h: 1 };
    case 'ammo':
      return { w: 1, h: 2 };
    case 'kit':
      return { w: 2, h: 1 };
  }
}

/** Stacks of the same item merge into one block. */
function stackable(item: ItemDefinition): boolean {
  return item.kind === 'ammo' || item.kind === 'potion' || item.kind === 'kit';
}

function occupied(stacks: InventoryStack[], getItem: ItemLookup, skip?: InventoryStack): boolean[][] {
  const grid = Array.from({ length: PACK_HEIGHT }, () => Array<boolean>(PACK_WIDTH).fill(false));
  for (const s of stacks) {
    if (s === skip || s.x === undefined || s.y === undefined) continue;
    const { w, h } = itemSize(getItem(s.itemId));
    for (let y = s.y; y < s.y + h && y < PACK_HEIGHT; y++) for (let x = s.x; x < s.x + w && x < PACK_WIDTH; x++) grid[y]![x] = true;
  }
  return grid;
}

/** Whether a block of this size fits with its top-left cell here. */
export function fitsAt(stacks: InventoryStack[], getItem: ItemLookup, size: Size, x: number, y: number, skip?: InventoryStack): boolean {
  if (x < 0 || y < 0 || x + size.w > PACK_WIDTH || y + size.h > PACK_HEIGHT) return false;
  const grid = occupied(stacks, getItem, skip);
  for (let yy = y; yy < y + size.h; yy++) for (let xx = x; xx < x + size.w; xx++) if (grid[yy]![xx]) return false;
  return true;
}

/** The first free spot for a block of this size, scanning column by column. */
export function findSpot(stacks: InventoryStack[], getItem: ItemLookup, size: Size): { x: number; y: number } | null {
  for (let x = 0; x < PACK_WIDTH; x++) for (let y = 0; y < PACK_HEIGHT; y++) if (fitsAt(stacks, getItem, size, x, y)) return { x, y };
  return null;
}

/** Gives every stack a place in the grid; stacks that do not fit stay unplaced. */
export function arrangePack(stacks: InventoryStack[], getItem: ItemLookup): InventoryStack[] {
  const placed: InventoryStack[] = stacks.filter((s) => s.x !== undefined && s.y !== undefined);
  for (const s of stacks) {
    if (s.x !== undefined && s.y !== undefined) continue;
    const spot = findSpot(placed, getItem, itemSize(getItem(s.itemId)));
    placed.push(spot ? { ...s, ...spot } : s);
  }
  return placed;
}

/** Adds items to a pack: onto an existing stack if they stack, otherwise into the first free spot. Null if there is no room. */
export function addToPack(stacks: InventoryStack[], itemId: string, quantity: number, getItem: ItemLookup, at?: { x: number; y: number }): InventoryStack[] | null {
  const item = getItem(itemId);
  if (stackable(item)) {
    const existing = stacks.find((s) => s.itemId === itemId);
    if (existing) return stacks.map((s) => (s === existing ? { ...s, quantity: s.quantity + quantity } : s));
  }
  const size = itemSize(item);
  const spot = at && fitsAt(stacks, getItem, size, at.x, at.y) ? at : findSpot(stacks, getItem, size);
  if (!spot) return null;
  return [...stacks, { itemId, quantity, ...spot }];
}

export interface GearRules {
  getItem: ItemLookup;
  raceOf: (merc: Merc) => RaceDefinition;
  proficiencyOf: (merc: Merc) => ArmourProficiency;
}

function updateMerc(state: GameState, mercId: string, change: (m: Merc) => Merc): GameState {
  return { ...state, party: state.party.map((m) => (m.id === mercId ? change(m) : m)) };
}

function mercOf(state: GameState, mercId: string): Merc {
  const merc = state.party.find((m) => m.id === mercId);
  if (!merc) throw new Error(`No merc "${mercId}".`);
  return merc;
}

/** The slot an item would naturally go in, for one-click equipping. */
export function naturalSlot(item: ItemDefinition, merc: Merc): EquipSlot | null {
  switch (item.kind) {
    case 'weapon':
      // A one-handed weapon goes to the off hand when the main hand already holds one: dual wielding.
      return item.hands === 1 && merc.equipment.mainHand && !merc.equipment.offHand ? 'offHand' : 'mainHand';
    case 'shield':
      return 'offHand';
    case 'armour':
      return item.slot;
    case 'trinket':
      return item.slot === 'neck' ? 'neck' : merc.equipment.ring1 ? (merc.equipment.ring2 ? 'ring1' : 'ring2') : 'ring1';
    case 'ammo':
      return 'ammo';
    default:
      return null;
  }
}

/**
 * Equips an item from the pack. Whatever was in the slot goes back into the
 * pack in its place. Ammunition stays in the pack (it is spent from there);
 * equipping it just picks which kind the weapon shoots.
 */
export function equipFromPack(state: GameState, mercId: string, stackIndex: number, slot: EquipSlot, rules: GearRules): GameState {
  const merc = mercOf(state, mercId);
  if (merc.dead) throw new Error(`${merc.name} is dead.`);
  const stack = merc.inventory[stackIndex];
  if (!stack) throw new Error('That item is not in the pack.');
  const item = rules.getItem(stack.itemId);
  if (!slotAccepts(slot, item)) throw new Error(`${item.name} cannot go there.`);

  const equipment = { ...merc.equipment, [slot]: item.id };
  // A two-hander clears the off hand.
  if (slot === 'mainHand' && item.kind === 'weapon' && item.hands === 2 && !rules.raceOf(merc).passives.some((p) => p.type === 'giantGrip')) {
    delete equipment.offHand;
  }
  const problems = validateEquipment(equipment, {
    race: rules.raceOf(merc),
    armourProficiency: rules.proficiencyOf(merc),
    getItem: rules.getItem,
    startersOnly: false,
  });
  if (problems.length > 0) throw new Error(problems[0]);

  if (item.kind === 'ammo') return updateMerc(state, mercId, (m) => ({ ...m, equipment }));

  // Take the item out of the pack, then put back whatever it replaced.
  let pack = merc.inventory
    .map((s, i) => (i === stackIndex ? { ...s, quantity: s.quantity - 1 } : s))
    .filter((s) => s.quantity > 0);
  const replaced = [merc.equipment[slot], slot === 'mainHand' && !equipment.offHand ? merc.equipment.offHand : undefined].filter(
    (id): id is string => !!id,
  );
  for (const id of replaced) {
    const next = addToPack(pack, id, 1, rules.getItem, stack.x !== undefined ? { x: stack.x, y: stack.y! } : undefined);
    if (!next) throw new Error('There is no room in the pack for what you are taking off.');
    pack = next;
  }
  return updateMerc(state, mercId, (m) => ({ ...m, equipment, inventory: pack }));
}

/** Takes an equipped item off into the pack, at a chosen cell if it fits there. */
export function unequip(state: GameState, mercId: string, slot: EquipSlot, rules: GearRules, at?: { x: number; y: number }): GameState {
  const merc = mercOf(state, mercId);
  const itemId = merc.equipment[slot];
  if (!itemId) return state;
  const equipment = { ...merc.equipment };
  delete equipment[slot];
  // Ammunition already lives in the pack.
  if (rules.getItem(itemId).kind === 'ammo') return updateMerc(state, mercId, (m) => ({ ...m, equipment }));
  const pack = addToPack(merc.inventory, itemId, 1, rules.getItem, at);
  if (!pack) throw new Error('There is no room in the pack.');
  return updateMerc(state, mercId, (m) => ({ ...m, equipment, inventory: pack }));
}

/** Moves a stack to another cell of the same pack. */
export function moveInPack(state: GameState, mercId: string, stackIndex: number, x: number, y: number, getItem: ItemLookup): GameState {
  const merc = mercOf(state, mercId);
  const stack = merc.inventory[stackIndex];
  if (!stack) return state;
  if (!fitsAt(merc.inventory, getItem, itemSize(getItem(stack.itemId)), x, y, stack)) throw new Error('It does not fit there.');
  return updateMerc(state, mercId, (m) => ({ ...m, inventory: m.inventory.map((s, i) => (i === stackIndex ? { ...s, x, y } : s)) }));
}

/** Hands a whole stack to another merc's pack. */
export function giveStack(state: GameState, fromId: string, stackIndex: number, toId: string, getItem: ItemLookup): GameState {
  if (fromId === toId) return state;
  const from = mercOf(state, fromId);
  const to = mercOf(state, toId);
  if (to.dead) throw new Error(`${to.name} is dead.`);
  const stack = from.inventory[stackIndex];
  if (!stack) return state;
  const pack = addToPack(to.inventory, stack.itemId, stack.quantity, getItem);
  if (!pack) throw new Error(`${to.name}'s pack is full.`);
  let next = updateMerc(state, toId, (m) => ({ ...m, inventory: pack }));
  next = updateMerc(next, fromId, (m) => ({ ...m, inventory: m.inventory.filter((_, i) => i !== stackIndex) }));
  // Giving away the arrows a bow was loaded with unloads it.
  if (from.equipment.ammo === stack.itemId) {
    next = updateMerc(next, fromId, (m) => {
      const equipment = { ...m.equipment };
      delete equipment.ammo;
      return { ...m, equipment };
    });
  }
  return next;
}

/** Makes sure every merc's pack items have a place in the grid (older saves had none). */
export function arrangeParty(state: GameState, getItem: ItemLookup): GameState {
  return { ...state, party: state.party.map((m) => ({ ...m, inventory: arrangePack(m.inventory, getItem) })) };
}
