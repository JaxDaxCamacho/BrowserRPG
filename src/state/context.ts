import { getAbility, getAdventure, getClass, getDialogue, getDungeon, getItem, getMonster, getObstacle, getRace, getTalentTree } from '../content';
import {
  finalStats,
  mercSheet,
  talentEffects,
  type CombatContext,
  type DialogueContext,
  type DungeonContext,
  type GameState,
  type Merc,
} from '../engine';
import { stockFor } from './storeStock';

/** The full character sheet: race, class, gear and talents. */
export function sheetOf(merc: Merc) {
  return mercSheet(merc, getRace(merc.raceId), getClass(merc.classId), getItem, talentEffects(merc, getTalentTree(merc.classId)));
}

function maxHpOf(merc: Merc): number {
  return sheetOf(merc).maxHp;
}

/** Gives the engine what it needs from content: stats and hit points depend on race, class and gear. */
export const dialogueContext: DialogueContext = {
  // Includes injuries; gear does not count towards checks.
  statsOf: (merc) => finalStats(merc, getRace(merc.raceId)),
  maxHpOf,
  raceOf: (merc) => getRace(merc.raceId),
  getDungeon,
  defaultDungeon: (state) => (state.adventureId ? getAdventure(state.adventureId).dungeons[0] : undefined),
  stockFor,
};

/** Map moves also open dialogues from the current adventure. */
export function dungeonContext(state: GameState): DungeonContext {
  return {
    ...dialogueContext,
    getDialogue: (dialogueId) => {
      if (!state.adventureId) throw new Error('No adventure in progress.');
      return getDialogue(state.adventureId, dialogueId);
    },
    monsterName: (monsterId) => getMonster(monsterId).name,
    getItem,
    endingDialogue: (s) => {
      const adventure = s.adventureId ? getAdventure(s.adventureId) : null;
      return adventure?.ending ? getDialogue(adventure.id, adventure.ending) : null;
    },
  };
}

/** What the combat engine needs from content. */
export const combatContext: CombatContext = {
  getMonster,
  getObstacle,
  getAbility,
  getItem,
  getDungeon,
  sheetOf,
  raceOf: (merc) => getRace(merc.raceId),
};

export function currentHp(merc: Merc): { current: number; max: number } {
  const max = maxHpOf(merc);
  return { current: Math.max(0, max - merc.wounds), max };
}
