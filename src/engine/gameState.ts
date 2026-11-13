import type { Merc } from './merc';

/**
 * The whole game in one plain-JSON object. Saving is writing this out;
 * loading is reading it back (after migrations keyed on `version`).
 */

export const SAVE_VERSION = 1;

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
}

export function createInitialState(rngSeed: number = 1): GameState {
  return {
    version: SAVE_VERSION,
    screen: 'menu',
    rngSeed,
    party: [],
    leaderId: null,
    nextMercId: 1,
  };
}
