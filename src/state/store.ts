import { create } from 'zustand';
import { getDungeon, PREMADES, premadeToDraft } from '../content';
import { addMerc, createInitialState, enterDungeon, setLeader, startNewGame, type GameState } from '../engine';
import { createDefaultSaveStore, type SaveRecord } from '../platform/saveStore';

export type Tool = 'contentEditor' | 'dungeonMaker';
const TOOLS: Tool[] = ['contentEditor', 'dungeonMaker'];

interface GameStore {
  game: GameState;
  /** The save slot the current game autosaves into; null on the main menu or in test play. */
  activeSlot: string | null;
  saves: SaveRecord[];
  /** False until the first read of storage finishes. */
  savesLoaded: boolean;
  /** Set when reading or writing storage fails, so the menu can say so. */
  saveError: string | null;
  /** A developer tool open instead of the game, such as the content editor. */
  tool: Tool | null;
  openTool: (tool: Tool | null) => void;
  /** Set while trying out a dungeon from the dungeon maker. Nothing is saved. */
  testPlay: { dungeonId: string } | null;
  startTestPlay: (dungeonId: string, adventureId: string) => void;
  endTestPlay: () => void;

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

function rememberTool(tool: Tool | null) {
  try {
    if (tool) sessionStorage.setItem('allerya.tool', tool);
    else sessionStorage.removeItem('allerya.tool');
  } catch {
    // Storage can be unavailable; the tool just will not reopen after a reload.
  }
}

/** The first four pre-built mercs, led by the first, dropped at a dungeon's start. */
function testParty(dungeonId: string, adventureId: string): GameState {
  let game: GameState = { ...startNewGame(randomSeed()), adventureId };
  for (const premade of PREMADES.slice(0, 4)) game = addMerc(game, premadeToDraft(premade));
  return enterDungeon(setLeader(game, 'merc-1'), getDungeon(dungeonId));
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: createInitialState(),
  activeSlot: null,
  saves: [],
  savesLoaded: false,
  saveError: null,
  tool: readOpenTool(),
  openTool: (tool) => {
    rememberTool(tool);
    set({ tool });
  },
  testPlay: null,
  startTestPlay: (dungeonId, adventureId) => {
    rememberTool('dungeonMaker');
    set({ tool: null, activeSlot: null, testPlay: { dungeonId }, game: testParty(dungeonId, adventureId) });
  },
  endTestPlay: () => {
    rememberTool('dungeonMaker');
    set({ tool: 'dungeonMaker', testPlay: null, game: createInitialState() });
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
    if (get().testPlay) {
      get().endTestPlay();
      return;
    }
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

/** Saving content reloads the page in development, so the open editor reopens itself. */
function readOpenTool(): Tool | null {
  try {
    const stored = sessionStorage.getItem('allerya.tool') as Tool | null;
    return import.meta.env.DEV && stored && TOOLS.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
