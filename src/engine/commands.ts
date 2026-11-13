import { startDialogue, type DialogueDefinition } from './dialogue';
import { createInitialState, type GameState, type Screen } from './gameState';

/**
 * Commands are pure functions: they take the current state and return a new one.
 * They never mutate their input, so the UI can compare states by reference.
 */

export function goToScreen(state: GameState, screen: Screen): GameState {
  if (state.screen === screen) return state;
  return { ...state, screen };
}

/** Starts a fresh game and sends the player to party creation. */
export function startNewGame(rngSeed: number): GameState {
  return { ...createInitialState(rngSeed), screen: 'partyCreation' };
}

/** Picks an adventure and opens its debrief. */
export function startAdventure(state: GameState, adventureId: string, debrief: DialogueDefinition): GameState {
  return startDialogue({ ...state, adventureId }, debrief);
}

export function returnToMenu(state: GameState): GameState {
  return goToScreen(state, 'menu');
}
