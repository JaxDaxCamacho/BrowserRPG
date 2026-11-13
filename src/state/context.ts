import { getAdventure, getClass, getDialogue, getDungeon, getItem, getMonster, getRace } from '../content';
import { finalStats, mercSheet, type DialogueContext, type DungeonContext, type GameState, type Merc } from '../engine';

function maxHpOf(merc: Merc): number {
  return mercSheet(merc, getRace(merc.raceId), getClass(merc.classId), getItem).maxHp;
}

/** Gives the engine what it needs from content: stats and hit points depend on race, class and gear. */
export const dialogueContext: DialogueContext = {
  statsOf: (merc) => finalStats(merc, getRace(merc.raceId)),
  maxHpOf,
  getDungeon,
  defaultDungeon: (state) => (state.adventureId ? getAdventure(state.adventureId).dungeons[0] : undefined),
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
  };
}

export function currentHp(merc: Merc): { current: number; max: number } {
  const max = maxHpOf(merc);
  return { current: Math.max(0, max - merc.wounds), max };
}
