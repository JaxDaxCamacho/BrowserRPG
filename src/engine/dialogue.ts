import { makeCheck, type CheckResult } from './checks';
import type { GameState, Screen } from './gameState';
import type { Merc } from './merc';
import { getLeader } from './party';
import { statModifier, type StatName, type Stats } from './stats';

/**
 * Dialogue is a small graph of nodes stored as data. A node shows text and a
 * list of options; an option may need a dice check and leads to an outcome.
 * The debrief, NPC conversations, traps and loot all run on this.
 */

export type FlagValue = boolean | number | string;

/** Something that must be true for an option to be available. */
export type Condition =
  | { type: 'flag'; flag: string; equals: FlagValue }
  | { type: 'partyHasClass'; classId: string }
  | { type: 'partyHasRace'; raceId: string };

/** A change to the game made when an outcome is reached. */
export type Effect = { type: 'setFlag'; flag: string; value: FlagValue } | { type: 'gold'; amount: number };

export interface Outcome {
  /** Shown to the player before moving on. Without it the dialogue advances straight away. */
  text?: string;
  effects?: Effect[];
  /** Continue to this node of the same dialogue. */
  goto?: string;
  /** End the dialogue and show this screen. Exactly one of `goto` and `end` is set. */
  end?: Screen;
}

export interface DialogueCheck {
  stat: StatName;
  difficulty: number;
  /** The leader speaks for the party; `best` uses whoever has the highest modifier. */
  by: 'leader' | 'best';
}

export interface DialogueOption {
  id: string;
  text: string;
  requires?: Condition[];
  check?: DialogueCheck;
  /** Used when there is no check. */
  outcome?: Outcome;
  /** Used with a check. */
  success?: Outcome;
  failure?: Outcome;
}

export interface DialogueNode {
  id: string;
  speaker?: string;
  /** Key of the illustration shown in the centre of the screen. */
  image?: string;
  text: string;
  options: DialogueOption[];
}

export interface DialogueDefinition {
  id: string;
  start: string;
  nodes: DialogueNode[];
}

/** What happened after the player picked an option, shown until they continue. */
export interface DialogueResult {
  optionId: string;
  check: (CheckResult & { stat: StatName; mercName: string }) | null;
  text: string;
  goto?: string;
  end?: Screen;
}

export interface DialogueState {
  dialogueId: string;
  nodeId: string;
  result: DialogueResult | null;
}

/** Things the engine needs from outside: final stats depend on race data. */
export interface DialogueContext {
  statsOf: (merc: Merc) => Stats;
}

export function startDialogue(state: GameState, dialogue: DialogueDefinition): GameState {
  return {
    ...state,
    screen: 'dialogue',
    dialogue: { dialogueId: dialogue.id, nodeId: dialogue.start, result: null },
  };
}

function findNode(dialogue: DialogueDefinition, nodeId: string): DialogueNode {
  const node = dialogue.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Dialogue "${dialogue.id}" has no node "${nodeId}".`);
  return node;
}

export function currentNode(state: GameState, dialogue: DialogueDefinition): DialogueNode {
  if (!state.dialogue || state.dialogue.dialogueId !== dialogue.id) {
    throw new Error(`Dialogue "${dialogue.id}" is not the one in progress.`);
  }
  return findNode(dialogue, state.dialogue.nodeId);
}

export function conditionMet(state: GameState, condition: Condition): boolean {
  switch (condition.type) {
    case 'flag':
      return (state.flags[condition.flag] ?? false) === condition.equals;
    case 'partyHasClass':
      return state.party.some((m) => m.classId === condition.classId);
    case 'partyHasRace':
      return state.party.some((m) => m.raceId === condition.raceId);
  }
}

/** The conditions stopping the party from picking this option. Empty means it is available. */
export function unmetConditions(state: GameState, option: DialogueOption): Condition[] {
  return (option.requires ?? []).filter((c) => !conditionMet(state, c));
}

/** Who makes a check, and with what modifier. */
export function checkMaker(
  state: GameState,
  check: DialogueCheck,
  ctx: DialogueContext,
): { merc: Merc; modifier: number } {
  const candidates = check.by === 'leader' ? [getLeader(state) ?? state.party[0]] : state.party;
  let best: { merc: Merc; modifier: number } | null = null;
  for (const merc of candidates) {
    if (!merc) continue;
    const modifier = statModifier(ctx.statsOf(merc)[check.stat]);
    if (!best || modifier > best.modifier) best = { merc, modifier };
  }
  if (!best) throw new Error('A check needs at least one merc in the party.');
  return best;
}

function applyEffects(state: GameState, effects: Effect[] = []): GameState {
  let next = state;
  for (const effect of effects) {
    switch (effect.type) {
      case 'setFlag':
        next = { ...next, flags: { ...next.flags, [effect.flag]: effect.value } };
        break;
      case 'gold':
        next = { ...next, gold: Math.max(0, next.gold + effect.amount) };
        break;
    }
  }
  return next;
}

/** Moves to the outcome's next node, or ends the dialogue. */
function advance(state: GameState, to: Pick<Outcome, 'goto' | 'end'>): GameState {
  if (!state.dialogue) return state;
  if (to.goto) return { ...state, dialogue: { ...state.dialogue, nodeId: to.goto, result: null } };
  return { ...state, dialogue: null, screen: to.end ?? 'dungeon' };
}

/**
 * The player picks an option. Rolls its check if it has one, applies the
 * outcome's effects, then either shows the result text or moves straight on.
 */
export function chooseOption(
  state: GameState,
  dialogue: DialogueDefinition,
  optionId: string,
  ctx: DialogueContext,
): GameState {
  const node = currentNode(state, dialogue);
  if (state.dialogue?.result) throw new Error('Continue past the current result before choosing again.');
  const option = node.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`Node "${node.id}" has no option "${optionId}".`);
  if (unmetConditions(state, option).length > 0) throw new Error(`Option "${optionId}" is not available.`);

  let next = state;
  let outcome: Outcome | undefined;
  let check: DialogueResult['check'] = null;

  if (option.check) {
    const maker = checkMaker(state, option.check, ctx);
    const rolled = makeCheck(state.rngSeed, maker.modifier, option.check.difficulty);
    next = { ...next, rngSeed: rolled.seed };
    check = { ...rolled.value, stat: option.check.stat, mercName: maker.merc.name };
    outcome = rolled.value.success ? option.success : option.failure;
  } else {
    outcome = option.outcome;
  }
  if (!outcome) throw new Error(`Option "${optionId}" has no outcome.`);

  next = applyEffects(next, outcome.effects);

  // A check always pauses on its result so the player sees the roll.
  if (outcome.text || check) {
    const result: DialogueResult = {
      optionId,
      check,
      text: outcome.text ?? '',
      ...(outcome.goto ? { goto: outcome.goto } : {}),
      ...(outcome.end ? { end: outcome.end } : {}),
    };
    return { ...next, dialogue: { ...next.dialogue!, result } };
  }
  return advance(next, outcome);
}

/** The player has read the result and moves on. */
export function continueDialogue(state: GameState): GameState {
  const result = state.dialogue?.result;
  if (!result) return state;
  return advance(state, result);
}
