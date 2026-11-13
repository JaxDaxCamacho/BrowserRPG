import { create } from 'zustand';
import { createInitialState, goToScreen, returnToMenu, startNewGame, type GameState, type Screen } from '../engine';

interface GameStore {
  game: GameState;
  newGame: () => void;
  goTo: (screen: Screen) => void;
  backToMenu: () => void;
}

/** Thin wrapper: holds the GameState and forwards every action to the engine. */
export const useGameStore = create<GameStore>((set) => ({
  game: createInitialState(),
  newGame: () => set({ game: startNewGame(randomSeed()) }),
  goTo: (screen) => set((s) => ({ game: goToScreen(s.game, screen) })),
  backToMenu: () => set((s) => ({ game: returnToMenu(s.game) })),
}));

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
