import { COPPER_PER_GOLD, STARTING_PURSE } from './currency';
import { SAVE_VERSION, SCREENS, type GameState } from './gameState';

type Loose = Record<string, unknown>;

/**
 * One step per version: each takes a save at version N and returns it at N + 1.
 * Add a step here whenever SAVE_VERSION is bumped.
 */
const MIGRATIONS: Record<number, (save: Loose) => Loose> = {
  // v2 added gold, story flags, the current adventure and the dialogue in progress.
  1: (save) => ({ ...save, version: 2, gold: 0, flags: {}, adventureId: null, dialogue: null }),
  // v3 gave every merc equipment, an inventory and their own purse, replacing party gold.
  2: (save) => {
    const { gold, ...rest } = save;
    const leaderId = typeof save.leaderId === 'string' ? save.leaderId : null;
    const party = Array.isArray(save.party) ? (save.party as Loose[]) : [];
    const payee = party.find((m) => m.id === leaderId) ?? party[0];
    return {
      ...rest,
      version: 3,
      party: party.map((merc) => ({
        ...merc,
        equipment: {},
        inventory: [],
        purse: STARTING_PURSE + (merc === payee && typeof gold === 'number' ? gold * COPPER_PER_GOLD : 0),
      })),
    };
  },
  // v4 added hit points (wounds), the map being explored and the fight in progress.
  // A save made on the old placeholder map screens has no map state, so it goes back to adventure select.
  3: (save) => {
    const party = Array.isArray(save.party) ? (save.party as Loose[]) : [];
    const offMap = save.screen === 'dungeon' || save.screen === 'combat';
    return {
      ...save,
      version: 4,
      screen: offMap ? 'adventureSelect' : save.screen,
      party: party.map((merc) => ({ ...merc, wounds: 0, down: false })),
      dungeon: null,
      encounter: null,
    };
  },
  // v5 added potions that last several encounters. A fight in progress restarts from its beginning.
  4: (save) => {
    const party = Array.isArray(save.party) ? (save.party as Loose[]) : [];
    const encounter = save.encounter as Loose | null | undefined;
    return {
      ...save,
      version: 5,
      party: party.map((merc) => ({ ...merc, potionEffects: [] })),
      encounter: encounter ? { featureId: encounter.featureId, returnTo: encounter.returnTo } : null,
    };
  },
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
