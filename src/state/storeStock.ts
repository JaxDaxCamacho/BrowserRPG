import { ITEMS } from '../content';
import type { GameState, StockEntry } from '../engine';

/** Always on the shelves, never running out: supplies, potions and ammunition. */
export const ALWAYS_IN_STOCK = [
  'rope',
  'trap-kit',
  'camping-kit',
  'rations',
  'healing-draught',
  'stoneskin-tonic',
  'draught-of-might',
  'healing-kit',
  'arrows',
  'bolts',
];

/** How many pieces of gear the store has each visit, one of each. */
const GEAR_ON_OFFER = 6;

/** A small deterministic hash, so the same visit always offers the same gear. */
function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** What the store sells before a dungeon: the supplies, and a handful of gear that changes per visit. */
export function stockFor(state: GameState, dungeonId: string): StockEntry[] {
  const always = ALWAYS_IN_STOCK.filter((id) => ITEMS.some((i) => i.id === id)).map((itemId): StockEntry => ({ itemId, quantity: null }));
  const gear = ITEMS.filter((i) => !ALWAYS_IN_STOCK.includes(i.id) && (i.kind === 'weapon' || i.kind === 'armour' || i.kind === 'shield' || i.kind === 'trinket' || i.kind === 'ammo'));
  const seed = hash(`${state.rngSeed}:${state.adventureId ?? ''}:${dungeonId}`);
  const offered = [...gear]
    .map((item, i) => ({ item, key: hash(`${seed}:${i}:${item.id}`) }))
    .sort((a, b) => a.key - b.key)
    .slice(0, GEAR_ON_OFFER)
    .map(({ item }): StockEntry => ({ itemId: item.id, quantity: 1 }));
  return [...always, ...offered];
}
