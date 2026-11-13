import { SAVE_VERSION, SCREENS, type GameState } from './gameState';

type Loose = Record<string, unknown>;

/**
 * One step per version: each takes a save at version N and returns it at N + 1.
 * Add a step here whenever SAVE_VERSION is bumped.
 */
const MIGRATIONS: Record<number, (save: Loose) => Loose> = {
  // v2 added gold, story flags, the current adventure and the dialogue in progress.
  1: (save) => ({ ...save, version: 2, gold: 0, flags: {}, adventureId: null, dialogue: null }),
};

/**
 * Turns whatever was read from storage into a GameState this build can run,
 * or null if it cannot (not a save, or from a newer version of the game).
 */
export function migrateSave(data: unknown): GameState | null {
  if (typeof data !== 'object' || data === null) return null;
  let save = data as Loose;

  while (typeof save.version === 'number' && save.version < SAVE_VERSION) {
    const step = MIGRATIONS[save.version];
    if (!step) return null;
    save = step(save);
  }
  if (save.version !== SAVE_VERSION) return null;

  const candidate = save as Partial<GameState>;
  if (!candidate.screen || !SCREENS.includes(candidate.screen)) return null;
  if (!Array.isArray(candidate.party)) return null;
  if (typeof candidate.rngSeed !== 'number' || typeof candidate.nextMercId !== 'number') return null;
  return candidate as GameState;
}
