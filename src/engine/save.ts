import { SAVE_VERSION, SCREENS, type GameState } from './gameState';

/**
 * Turns whatever was read from storage into a GameState this build can run,
 * or null if it cannot. Migrations from older versions are added here when
 * SAVE_VERSION is bumped.
 */
export function migrateSave(data: unknown): GameState | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as Partial<GameState>;
  if (candidate.version !== SAVE_VERSION) return null;
  if (!candidate.screen || !SCREENS.includes(candidate.screen)) return null;
  if (!Array.isArray(candidate.party)) return null;
  if (typeof candidate.rngSeed !== 'number' || typeof candidate.nextMercId !== 'number') return null;
  return candidate as GameState;
}
