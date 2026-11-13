import type { GameState } from './gameState';

/**
 * The end of an adventure: the party is back in town, the contract is marked
 * done, and the company returns to picking work.
 */

/** True once the company has finished this adventure. */
export function isAdventureComplete(state: GameState, adventureId: string): boolean {
  return state.completedAdventures.includes(adventureId);
}

/**
 * Marks the current adventure finished. Back in town, every living merc
 * recovers their hit points and gets back up; potions wear off. Injuries and
 * the dead stay as they are.
 */
export function completeAdventure(state: GameState): GameState {
  const id = state.adventureId;
  if (!id) return state;
  return {
    ...state,
    completedAdventures: isAdventureComplete(state, id) ? state.completedAdventures : [...state.completedAdventures, id],
    party: state.party.map((m) => (m.dead ? m : { ...m, wounds: 0, down: false, potionEffects: [] })),
  };
}

/** Leaves the adventure behind: no map, no fight, back to adventure select. */
export function closeAdventure(state: GameState): GameState {
  return { ...state, screen: 'adventureSelect', adventureId: null, dialogue: null, dungeon: null, encounter: null };
}
