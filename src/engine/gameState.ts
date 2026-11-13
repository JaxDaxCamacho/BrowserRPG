import type { DialogueState, FlagValue } from './dialogue';
import type { Merc } from './merc';

/**
 * The whole game in one plain-JSON object. Saving is writing this out;
 * loading is reading it back (after migrations keyed on `version`).
 */

export const SAVE_VERSION = 2;

export const SCREENS = [
  'menu',
  'partyCreation',
  'leaderSelect',
  'adventureSelect',
  'dialogue',
  'dungeon',
  'combat',
] as const;

export type Screen = (typeof SCREENS)[number];

export interface GameState {
  /** Save schema version, bumped whenever the shape of GameState changes. */
  version: number;
  /** Which screen is showing. The engine changes it; the UI only reads it. */
  screen: Screen;
  /** Seed for the dice generator, stored so rolls survive save and reload. */
  rngSeed: number;
  party: Merc[];
  /** The merc who speaks for the party and is its token on the map. */
  leaderId: string | null;
  /** Counter for handing out merc ids that are unique within this game. */
  nextMercId: number;
  gold: number;
  /** Story facts set by choices, read by later conditions. */
  flags: Record<string, FlagValue>;
  /** The adventure being played, or null before one is picked. */
  adventureId: string | null;
  /** The conversation in progress, or null when there is none. */
  dialogue: DialogueState | null;
}

export function createInitialState(rngSeed: number = 1): GameState {
  return {
    version: SAVE_VERSION,
    screen: 'menu',
    rngSeed,
    party: [],
    leaderId: null,
    nextMercId: 1,
    gold: 0,
    flags: {},
    adventureId: null,
    dialogue: null,
  };
}
