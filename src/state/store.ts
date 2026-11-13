import { create } from 'zustand';
import { createInitialState, startNewGame, type GameState } from '../engine';
import { createDefaultSaveStore, type SaveRecord } from '../platform/saveStore';

interface GameStore {
  game: GameState;
  /** The save slot the current game autosaves into; null on the main menu. */
  activeSlot: string | null;
  saves: SaveRecord[];
  /** False until the first read of storage finishes. */
  savesLoaded: boolean;
  /** Set when reading or writing storage fails, so the menu can say so. */
  saveError: string | null;
  /** A developer tool open instead of the game, such as the content editor. */
  tool: 'contentEditor' | null;
  openTool: (tool: 'contentEditor' | null) => void;

  /** Runs an engine command against the current game. */
  apply: (command: (game: GameState) => GameState) => void;
  refreshSaves: () => Promise<void>;
  newGame: (slotId: string) => void;
  continueGame: (slotId: string) => void;
  backToMenu: () => void;
}

const saveStore = createDefaultSaveStore();

/** Writes are queued so they land in order and a refresh never reads a half-finished save. */
let pendingWrites: Promise<void> = Promise.resolve();

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: createInitialState(),
  activeSlot: null,
  saves: [],
  savesLoaded: false,
  saveError: null,
  tool: readOpenTool(),
  openTool: (tool) => {
    try {
      if (tool) sessionStorage.setItem('allerya.tool', tool);
      else sessionStorage.removeItem('allerya.tool');
    } catch {
      // Storage can be unavailable; the tool just will not reopen after a reload.
    }
    set({ tool });
  },

  apply: (command) => set((s) => ({ game: command(s.game) })),

  refreshSaves: async () => {
    await pendingWrites;
    try {
      const saves = await saveStore.list();
      set({ saves, savesLoaded: true, saveError: null });
    } catch (error) {
      set({ saves: [], savesLoaded: true, saveError: `Could not read saved games: ${describe(error)}` });
    }
  },

  newGame: (slotId) => set({ game: startNewGame(randomSeed()), activeSlot: slotId }),

  continueGame: (slotId) => {
    const record = get().saves.find((s) => s.slotId === slotId);
    if (record) set({ game: record.state, activeSlot: slotId });
  },

  backToMenu: () => {
    set({ game: createInitialState(), activeSlot: null });
    void get().refreshSaves();
  },
}));

// Autosave: every change to a game in progress is written to its slot.
useGameStore.subscribe((now, before) => {
  if (now.game === before.game && now.activeSlot === before.activeSlot) return;
  const { game, activeSlot } = now;
  if (!activeSlot || game.screen === 'menu') return;
  pendingWrites = pendingWrites
    .then(() => saveStore.save(activeSlot, game))
    .catch((error: unknown) => {
      useGameStore.setState({ saveError: `Could not save the game: ${describe(error)}` });
    });
});

/** Saving content reloads the page in development, so the editor reopens itself. */
function readOpenTool(): 'contentEditor' | null {
  try {
    return import.meta.env.DEV && sessionStorage.getItem('allerya.tool') === 'contentEditor' ? 'contentEditor' : null;
  } catch {
    return null;
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
