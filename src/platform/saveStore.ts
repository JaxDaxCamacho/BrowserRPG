import type { GameState } from '../engine';

/**
 * Where saves live. The game only talks to this interface, so the same code
 * runs in a browser, the Tauri desktop app and Android. The IndexedDB
 * implementation arrives with save slots in milestone 3.
 */
export interface SaveStore {
  list(): Promise<SaveSlotInfo[]>;
  load(slotId: string): Promise<GameState | null>;
  save(slotId: string, state: GameState): Promise<void>;
  remove(slotId: string): Promise<void>;
}

export interface SaveSlotInfo {
  slotId: string;
  /** Milliseconds since the Unix epoch. */
  savedAt: number;
}
