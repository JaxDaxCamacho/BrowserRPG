import type { DialogueState, FlagValue } from './dialogue';
import type { DungeonState, EncounterState } from './dungeon';
import type { Merc } from './merc';
import type { StoreState } from './store';

/**
 * The whole game in one plain-JSON object. Saving is writing this out;
 * loading is reading it back (after migrations keyed on `version`).
 */

export const SAVE_VERSION = 8;

export const SCREENS = [
  'menu',
  'partyCreation',
  'leaderSelect',
  'adventureSelect',
  'dialogue',
  'dungeon',
  'combat',
  'store',
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
  /** Co-op, while the leader is being chosen: each player's pick, by player id. */
  leaderVotes?: Record<string, string>;
  /** Counter for handing out merc ids that are unique within this game. */
  nextMercId: number;
  /** Story facts set by choices, read by later conditions. */
  flags: Record<string, FlagValue>;
  /** The adventure being played, or null before one is picked. */
  adventureId: string | null;
  /** Adventures the company has finished, in the order it finished them. */
  completedAdventures: string[];
  /** The conversation in progress, or null when there is none. */
  dialogue: DialogueState | null;
  /** The map being explored, including its fog of war. */
  dungeon: DungeonState | null;
  /** The fight on screen, or null. */
  encounter: EncounterState | null;
  /** Other fights going on at the same time, while the party is split. */
  otherEncounters?: EncounterState[];
  /** The store the party is visiting on its way to a dungeon. */
  store?: StoreState | null;
  /** The dice just rolled, for the dice tray to animate. `seq` goes up with each new batch. */
  rollFeed?: { seq: number; rolls: ShownRoll[] };
}

/** One die roll as the player should see it. */
export interface ShownRoll {
  /** Who rolled, e.g. "Aldric Vane". */
  who: string;
  /** What for, e.g. "Charisma check" or "Arming Sword". */
  what: string;
  sides: number;
  /** Every die thrown: two with advantage or disadvantage. */
  dice: number[];
  /** The die that counts. */
  kept: number;
  /** The total with modifiers, and what it had to reach, when there was a target. */
  total?: number;
  target?: number;
  /** Plain-word result, e.g. "Success", "Hit", "Spared". */
  result?: string;
  good?: boolean;
}

/** Puts a batch of rolls on the dice tray. */
export function announceRolls(state: GameState, rolls: ShownRoll[]): GameState {
  if (rolls.length === 0) return state;
  return { ...state, rollFeed: { seq: (state.rollFeed?.seq ?? 0) + 1, rolls } };
}

export function createInitialState(rngSeed: number = 1): GameState {
  return {
    version: SAVE_VERSION,
    screen: 'menu',
    rngSeed,
    party: [],
    leaderId: null,
    nextMercId: 1,
    flags: {},
    adventureId: null,
    completedAdventures: [],
    dialogue: null,
    dungeon: null,
    encounter: null,
  };
}
