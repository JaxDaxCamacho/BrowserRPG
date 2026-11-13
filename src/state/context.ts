import { getRace } from '../content';
import { finalStats, type DialogueContext } from '../engine';

/** Gives the engine what it needs from content: a merc's stats depend on their race. */
export const dialogueContext: DialogueContext = {
  statsOf: (merc) => finalStats(merc, getRace(merc.raceId)),
};
