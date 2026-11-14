import { CONTENT, getAdventure, getClass, startingTalentProblems, getDialogue, getDungeon, getItem, getRace, getTalentTree } from '../content';
import {
  activeCombatant,
  activeMercIds,
  addMerc,
  arrangeParty,
  attack,
  breakCamp,
  buyItem,
  eatRation,
  sellItem,
  setOut,
  canLeave,
  castAbility,
  castVote,
  chooseOption,
  confirmLeader,
  confirmParty,
  continueDialogue,
  defend,
  drinkPotion,
  encounterMercIds,
  endExploreTurn,
  endTurn,
  equipFromPack,
  finishCombat,
  flee,
  getLeader,
  giveStack,
  goToScreen,
  kick,
  leaveTheFallen,
  leaveDungeon,
  longRest,
  moveInPack,
  moveTo,
  regroup,
  removeMerc,
  retryCombat,
  runEnemyStep,
  setDestination,
  setLeader,
  spendStatPoints,
  spendTalentPoints,
  splitOff,
  startAdventure,
  startCombat,
  stepParty,
  stopWalking,
  unequip,
  type EquipSlot,
  type GameState,
  type GearRules,
  type MercDraft,
  type Pos,
  type StatName,
} from '../engine';
import { combatContext, dialogueContext, dungeonContext } from './context';

/**
 * Everything a player can do, as plain data. The screens dispatch these
 * instead of changing the game directly, so in co-op a command can travel to
 * the host, be checked against who sent it, and be applied there.
 */
export type GameCommand =
  // Setting up (the host)
  | { type: 'addMerc'; draft: MercDraft }
  | { type: 'removeMerc'; mercId: string }
  | { type: 'confirmParty' }
  | { type: 'setLeader'; mercId: string }
  | { type: 'confirmLeader' }
  | { type: 'goToScreen'; screen: 'partyCreation' | 'leaderSelect' }
  | { type: 'startAdventure'; adventureId: string }
  // Conversations
  | { type: 'chooseOption'; optionId: string }
  | { type: 'vote'; optionId: string }
  | { type: 'continueDialogue' }
  // The map
  | { type: 'setDestination'; pos: Pos }
  | { type: 'step' }
  | { type: 'stopWalking' }
  | { type: 'headOut' }
  | { type: 'splitOff'; mercId: string }
  | { type: 'regroup' }
  | { type: 'endExploreTurn' }
  | { type: 'longRest'; cure: { mercId: string; injuryId: string }[] }
  | { type: 'breakCamp' }
  // Training
  | { type: 'spendStatPoints'; mercId: string; picks: StatName[] }
  | { type: 'spendTalentPoints'; mercId: string; picks: string[] }
  // Gear
  | { type: 'equipFromPack'; mercId: string; index: number; slot: EquipSlot }
  | { type: 'moveInPack'; mercId: string; index: number; x: number; y: number }
  | { type: 'unequip'; mercId: string; slot: EquipSlot; at?: { x: number; y: number } }
  | { type: 'giveStack'; mercId: string; index: number; toId: string }
  | { type: 'arrangeParty' }
  // Fights
  | { type: 'startCombat' }
  | { type: 'enemyStep' }
  | { type: 'move'; to: Pos }
  | { type: 'attack'; targetId: string }
  | { type: 'kick'; targetId: string }
  | { type: 'cast'; abilityId: string; targetId: string | null }
  | { type: 'drink'; itemId: string }
  | { type: 'defend' }
  | { type: 'flee' }
  | { type: 'endTurn' }
  | { type: 'finishCombat' }
  | { type: 'retryCombat' }
  | { type: 'leaveTheFallen' }
  // The store, and supplies
  | { type: 'buy'; mercId: string; itemId: string }
  | { type: 'sell'; mercId: string; index: number }
  | { type: 'setOut' }
  | { type: 'eat'; mercId: string; index: number };

export const GEAR_RULES: GearRules = {
  getItem,
  raceOf: (m) => getRace(m.raceId),
  proficiencyOf: (m) => getClass(m.classId).armour,
};

/** Who is voting in a co-op conversation, and whose vote breaks a tie. */
export interface Voting {
  voterId: string;
  voters: string[];
  tieBreaker?: string;
}

function currentDialogue(g: GameState) {
  if (!g.dialogue || !g.adventureId) throw new Error('No conversation in progress.');
  return getDialogue(g.adventureId, g.dialogue.dialogueId);
}

function mapOf(g: GameState) {
  if (!g.dungeon) throw new Error('Not exploring.');
  return getDungeon(g.dungeon.dungeonId);
}

/** Applies one command to the game. Throws, with a reason, when it cannot be done. */
export function runCommand(g: GameState, cmd: GameCommand, voting?: Voting): GameState {
  switch (cmd.type) {
    case 'addMerc': {
      const why = startingTalentProblems(cmd.draft.classId, cmd.draft.startingTalents ?? [], CONTENT.talents);
      if (why.length > 0) throw new Error(`Starting talent: ${why[0]}.`);
      return addMerc(g, cmd.draft);
    }
    case 'removeMerc':
      return removeMerc(g, cmd.mercId);
    case 'confirmParty':
      return confirmParty(g);
    case 'setLeader':
      return setLeader(g, cmd.mercId);
    case 'confirmLeader':
      return confirmLeader(g);
    case 'goToScreen':
      return goToScreen(g, cmd.screen);
    case 'startAdventure':
      return startAdventure(g, cmd.adventureId, getDialogue(cmd.adventureId, getAdventure(cmd.adventureId).debrief));
    case 'chooseOption':
      return chooseOption(g, currentDialogue(g), cmd.optionId, dialogueContext);
    case 'vote':
      if (!voting) return chooseOption(g, currentDialogue(g), cmd.optionId, dialogueContext);
      return castVote(g, currentDialogue(g), voting.voterId, cmd.optionId, voting.voters, voting.tieBreaker, dialogueContext);
    case 'continueDialogue':
      return continueDialogue(g, dialogueContext);
    case 'setDestination':
      return setDestination(g, mapOf(g), cmd.pos);
    case 'step':
      return stepParty(g, mapOf(g), dungeonContext(g));
    case 'stopWalking':
      return stopWalking(g);
    case 'headOut': {
      const def = mapOf(g);
      return canLeave(g, def) ? leaveDungeon(g, def, dungeonContext(g)) : setDestination(g, def, def.start);
    }
    case 'splitOff':
      return splitOff(g, cmd.mercId);
    case 'regroup':
      return regroup(g);
    case 'endExploreTurn':
      return endExploreTurn(g);
    case 'longRest':
      return longRest(g, { cure: cmd.cure }, getItem);
    case 'breakCamp':
      return breakCamp(g);
    case 'spendStatPoints':
      return spendStatPoints(g, cmd.mercId, cmd.picks);
    case 'spendTalentPoints': {
      const merc = g.party.find((m) => m.id === cmd.mercId);
      const tree = merc ? getTalentTree(merc.classId) : undefined;
      if (!tree) throw new Error('That merc has no talent tree.');
      return spendTalentPoints(g, cmd.mercId, cmd.picks, tree);
    }
    case 'equipFromPack':
      return equipFromPack(g, cmd.mercId, cmd.index, cmd.slot, GEAR_RULES);
    case 'moveInPack':
      return moveInPack(g, cmd.mercId, cmd.index, cmd.x, cmd.y, getItem);
    case 'unequip':
      return unequip(g, cmd.mercId, cmd.slot, GEAR_RULES, cmd.at);
    case 'giveStack':
      return giveStack(g, cmd.mercId, cmd.index, cmd.toId, getItem);
    case 'arrangeParty':
      return arrangeParty(g, getItem);
    case 'startCombat':
      return g.encounter && !g.encounter.combat ? startCombat(g, combatContext) : g;
    case 'enemyStep':
      return runEnemyStep(g, combatContext);
    case 'move':
      return moveTo(g, cmd.to);
    case 'attack':
      return attack(g, cmd.targetId);
    case 'kick':
      return kick(g, cmd.targetId);
    case 'cast':
      return castAbility(g, cmd.abilityId, cmd.targetId, combatContext);
    case 'drink':
      return drinkPotion(g, cmd.itemId, combatContext);
    case 'defend':
      return defend(g);
    case 'flee':
      return flee(g, combatContext);
    case 'endTurn':
      return endTurn(g);
    case 'finishCombat':
      return finishCombat(g, combatContext);
    case 'retryCombat':
      return retryCombat(g, combatContext);
    case 'leaveTheFallen':
      return leaveTheFallen(g);
    case 'buy':
      return buyItem(g, cmd.mercId, cmd.itemId, getItem);
    case 'sell':
      return sellItem(g, cmd.mercId, cmd.index, getItem);
    case 'setOut':
      if (!g.store) throw new Error('The store is closed.');
      return setOut(g, getDungeon(g.store.dungeonId));
    case 'eat':
      return eatRation(g, cmd.mercId, cmd.index, getItem, (m) => dialogueContext.maxHpOf(m));
  }
}

// ---------- who may do what ----------

/** Commands only the host sends: setting up, resting, and the steps the host's game runs by itself. */
const HOST_ONLY: ReadonlySet<GameCommand['type']> = new Set([
  'confirmParty',
  'setLeader',
  'confirmLeader',
  'goToScreen',
  'startAdventure',
  'chooseOption',
  'step',
  'startCombat',
  'enemyStep',
  'arrangeParty',
  'longRest',
  'breakCamp',
  'setOut',
]);

/** Commands about one merc's own things: only that merc's player may send them. */
function ownMerc(cmd: GameCommand): string | null {
  switch (cmd.type) {
    case 'spendStatPoints':
    case 'spendTalentPoints':
    case 'equipFromPack':
    case 'moveInPack':
    case 'unequip':
    case 'giveStack':
    case 'splitOff':
    case 'buy':
    case 'sell':
    case 'eat':
      return cmd.mercId;
    default:
      return null;
  }
}

const COMBAT_TURN: ReadonlySet<GameCommand['type']> = new Set(['move', 'attack', 'kick', 'cast', 'drink', 'defend', 'flee', 'endTurn']);
const MAP_MOVES: ReadonlySet<GameCommand['type']> = new Set(['setDestination', 'stopWalking', 'headOut', 'regroup', 'endExploreTurn']);

/**
 * Why a player may not send this command, or null if they may. `controls`
 * says whether a merc is played by this player (the host plays any merc whose
 * player is not connected). The host may always act.
 */
export function commandBlocker(g: GameState, cmd: GameCommand, isHost: boolean, controls: (mercId: string) => boolean): string | null {
  if (isHost) return null;
  if (HOST_ONLY.has(cmd.type)) return 'Only the host can do that.';
  // While the party is being made, each joined player brings one merc of their own.
  if (cmd.type === 'addMerc') {
    if (g.screen !== 'partyCreation') return 'Mercs are added while the party is being made.';
    return g.party.some((m) => controls(m.id)) ? 'You already have a merc in the party.' : null;
  }
  if (cmd.type === 'removeMerc') {
    if (g.screen !== 'partyCreation') return 'Mercs are removed while the party is being made.';
    return controls(cmd.mercId) ? null : 'That is not your merc.';
  }
  const merc = ownMerc(cmd);
  if (merc) return controls(merc) ? null : 'That is not your merc.';
  if (COMBAT_TURN.has(cmd.type)) {
    const c = g.encounter?.combat;
    if (!c || c.outcome) return 'There is no fight to act in.';
    const actor = activeCombatant(c);
    return actor.mercId && controls(actor.mercId) ? null : 'It is not your turn.';
  }
  if (cmd.type === 'finishCombat' || cmd.type === 'retryCombat' || cmd.type === 'leaveTheFallen') {
    const e = g.encounter;
    return e && encounterMercIds(g, e).some(controls) ? null : 'You are not in this fight.';
  }
  if (MAP_MOVES.has(cmd.type)) {
    return activeMercIds(g).some(controls) ? null : 'None of your mercs is in the group that is moving.';
  }
  if (cmd.type === 'vote' || cmd.type === 'continueDialogue') {
    const present = g.dialogue?.mercIds ?? g.party.filter((m) => !m.dead).map((m) => m.id);
    return present.some(controls) ? null : 'None of your mercs is in this conversation.';
  }
  return null;
}

/** The merc who leads, for breaking tied votes. */
export function leaderOf(g: GameState): string | undefined {
  return getLeader(g)?.id;
}
