import { enterDungeon, type DungeonDefinition } from './dungeon';
import type { GameState } from './gameState';
import { addToPack } from './inventory';
import type { ItemLookup } from './items';
import type { Merc } from './merc';

/**
 * The quartermaster's store, visited after taking a job and before each
 * dungeon. Every merc buys with their own purse and sells for half what an
 * item is worth. Supplies are always in stock; a few pieces of gear change
 * from visit to visit.
 */

export interface StockEntry {
  itemId: string;
  /** How many are left; null means it never runs out. */
  quantity: number | null;
}

export interface StoreState {
  /** The dungeon the party sets out for when it leaves the store. */
  dungeonId: string;
  stock: StockEntry[];
}

/** What the store pays for an item, as a share of its value. */
export const SELL_RATE = 0.5;

export function sellPrice(value: number): number {
  return Math.floor(value * SELL_RATE);
}

/** Takes the party to the store on its way to a dungeon. */
export function openStore(state: GameState, dungeonId: string, stock: StockEntry[]): GameState {
  return { ...state, screen: 'store', store: { dungeonId, stock } };
}

function mercOf(state: GameState, mercId: string): Merc {
  const merc = state.party.find((m) => m.id === mercId);
  if (!merc || merc.dead) throw new Error('That merc cannot trade.');
  return merc;
}

function inStore(state: GameState): StoreState {
  if (state.screen !== 'store' || !state.store) throw new Error('The store is closed.');
  return state.store;
}

/** A merc buys one of an item with their own money; it goes into their pack. */
export function buyItem(state: GameState, mercId: string, itemId: string, getItem: ItemLookup): GameState {
  const store = inStore(state);
  const entry = store.stock.find((s) => s.itemId === itemId);
  if (!entry || entry.quantity === 0) throw new Error('That is sold out.');
  const merc = mercOf(state, mercId);
  const item = getItem(itemId);
  if (merc.purse < item.value) throw new Error(`${merc.name} cannot afford the ${item.name}.`);
  // Ammunition comes in bundles of 20; everything else one at a time.
  const quantity = item.kind === 'ammo' ? 20 : 1;
  const price = item.kind === 'ammo' ? item.value * quantity : item.value;
  if (merc.purse < price) throw new Error(`${merc.name} cannot afford ${quantity} ${item.name}.`);
  const pack = addToPack(merc.inventory, itemId, quantity, getItem);
  if (!pack) throw new Error(`There is no room in ${merc.name}'s pack.`);
  const stock = store.stock.map((s) => (s === entry && s.quantity !== null ? { ...s, quantity: s.quantity - 1 } : s));
  return {
    ...state,
    store: { ...store, stock },
    party: state.party.map((m) => (m.id === mercId ? { ...m, purse: m.purse - price, inventory: pack } : m)),
  };
}

/** A merc sells one of what is in a stack of their pack (a whole stack of ammunition) for half its worth. */
export function sellItem(state: GameState, mercId: string, stackIndex: number, getItem: ItemLookup): GameState {
  inStore(state);
  const merc = mercOf(state, mercId);
  const stack = merc.inventory[stackIndex];
  if (!stack) throw new Error('There is nothing there to sell.');
  const item = getItem(stack.itemId);
  const count = item.kind === 'ammo' ? stack.quantity : 1;
  const earned = sellPrice(item.value) * count;
  const inventory =
    count >= stack.quantity ? merc.inventory.filter((_, i) => i !== stackIndex) : merc.inventory.map((s, i) => (i === stackIndex ? { ...s, quantity: s.quantity - count } : s));
  return { ...state, party: state.party.map((m) => (m.id === mercId ? { ...m, purse: m.purse + earned, inventory } : m)) };
}

/** Leaves the store for the dungeon. */
export function setOut(state: GameState, def: DungeonDefinition): GameState {
  const store = inStore(state);
  if (store.dungeonId !== def.id) throw new Error('That is not where the party is headed.');
  const { store: _s, ...rest } = state;
  return enterDungeon({ ...rest, store: null }, def);
}

// ---------- supplies used outside fights ----------

/** Eats a ration from a merc's pack: heals them. Only outside a fight. */
export function eatRation(state: GameState, mercId: string, stackIndex: number, getItem: ItemLookup, maxHpOf: (m: Merc) => number): GameState {
  if (state.screen === 'combat') throw new Error('There is no time to eat in a fight.');
  const merc = mercOf(state, mercId);
  const stack = merc.inventory[stackIndex];
  const item = stack ? getItem(stack.itemId) : null;
  if (!stack || !item || item.kind !== 'kit' || item.use !== 'food') throw new Error('That is not something to eat.');
  if (merc.wounds === 0) throw new Error(`${merc.name} is not hurt.`);
  const healed = Math.min(merc.wounds, item.heal ?? 0);
  const inventory = stack.quantity > 1 ? merc.inventory.map((s, i) => (i === stackIndex ? { ...s, quantity: s.quantity - 1 } : s)) : merc.inventory.filter((_, i) => i !== stackIndex);
  const party = state.party.map((m) => (m.id === mercId ? { ...m, wounds: m.wounds - healed, down: m.wounds - healed >= maxHpOf(m) ? m.down : false, inventory } : m));
  return { ...state, party };
}

/** The first stack of a kind of supply carried by any of these mercs, if any. */
export function findSupply(
  party: Merc[],
  mercIds: string[],
  use: 'disarmTrap' | 'camp' | 'rope' | 'food' | 'healInjury',
  getItem: ItemLookup,
): { mercId: string; stackIndex: number } | null {
  for (const m of party) {
    if (m.dead || !mercIds.includes(m.id)) continue;
    const i = m.inventory.findIndex((s) => {
      const item = getItem(s.itemId);
      return item.kind === 'kit' && item.use === use;
    });
    if (i >= 0) return { mercId: m.id, stackIndex: i };
  }
  return null;
}

/** Uses up one of a stack in a merc's pack. */
export function spendOne(state: GameState, mercId: string, stackIndex: number): GameState {
  return {
    ...state,
    party: state.party.map((m) =>
      m.id !== mercId
        ? m
        : {
            ...m,
            inventory: m.inventory.map((s, i) => (i === stackIndex ? { ...s, quantity: s.quantity - 1 } : s)).filter((s) => s.quantity > 0),
          },
    ),
  };
}
