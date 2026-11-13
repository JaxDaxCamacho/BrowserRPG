import { closeAdventure, completeAdventure } from './adventure';
import { makeCheck, type CheckResult } from './checks';
import { awardXp } from './levels';
import { COPPER_PER_GOLD, formatCoins } from './currency';
import { rollDice } from './dice';
import type { DungeonDefinition } from './dungeon';
import { enterDungeon } from './dungeon';
import { announceRolls, type GameState, type Screen, type ShownRoll } from './gameState';
import { ensureLiveLeader, knockDown, saveRoll } from './injuries';
import type { RaceDefinition } from './race';
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

/** Who an effect lands on: the merc who made the check (or the leader), the leader, or everyone. */
export type EffectTarget = 'roller' | 'leader' | 'party';

/** A change to the game made when an outcome is reached. */
export type Effect =
  | { type: 'setFlag'; flag: string; value: FlagValue }
  /** Pays (or, if negative, takes) money in copper from the leader's purse. */
  | { type: 'money'; amount: number }
  /** Dice notation, e.g. "1d6". */
  | { type: 'damage'; amount: string; target: EffectTarget }
  | { type: 'heal'; amount: string; target: EffectTarget }
  /** Puts items into the leader's pack. */
  | { type: 'giveItem'; itemId: string; quantity: number }
  /** Marks the trap, event or chest that opened this dialogue as done, so it never fires again. */
  | { type: 'resolveFeature' }
  /** Pays the leader as many gold crowns as a number flag holds, such as the fee agreed in the debrief. */
  | { type: 'payFlag'; flag: string }
  /** Experience for every merc still alive. */
  | { type: 'xp'; amount: number }
  /** Marks the adventure finished; the party recovers its hit points back in town. */
  | { type: 'completeAdventure' };

export interface Outcome {
  /** Shown to the player before moving on. Without it the dialogue advances straight away. */
  text?: string;
  effects?: Effect[];
  /** Continue to this node of the same dialogue. */
  goto?: string;
  /**
   * End the dialogue and show this screen. Exactly one of `goto` and `end` is set.
   * Ending on adventure select leaves the adventure behind.
   */
  end?: Screen;
  /** With `end: "dungeon"`: enter this dungeon, from its start. */
  dungeon?: string;
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
  check: (CheckResult & { stat: StatName; mercName: string; mercId: string }) | null;
  text: string;
  /** Lines describing what the effects did, such as damage taken. */
  notes: string[];
  goto?: string;
  end?: Screen;
  dungeon?: string;
}

export interface DialogueState {
  dialogueId: string;
  nodeId: string;
  result: DialogueResult | null;
  /** The map feature (trap, event, goal) that opened this dialogue, if any. */
  source?: string;
  /** With the party split: the mercs present. Checks and effects only involve them. */
  mercIds?: string[];
}

/** Things the engine needs from outside: final stats and hit points depend on content data. */
export interface DialogueContext {
  statsOf: (merc: Merc) => Stats;
  maxHpOf: (merc: Merc) => number;
  raceOf: (merc: Merc) => RaceDefinition;
  getDungeon: (dungeonId: string) => DungeonDefinition;
  /** The dungeon an `end: "dungeon"` outcome enters when it names none: the adventure's first. */
  defaultDungeon: (state: GameState) => string | undefined;
}

export function startDialogue(
  state: GameState,
  dialogue: DialogueDefinition,
  options: { nodeId?: string; source?: string; mercIds?: string[] } = {},
): GameState {
  return {
    ...state,
    screen: 'dialogue',
    dialogue: {
      dialogueId: dialogue.id,
      nodeId: options.nodeId ?? dialogue.start,
      result: null,
      ...(options.source ? { source: options.source } : {}),
      ...(options.mercIds ? { mercIds: options.mercIds } : {}),
    },
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

/** Mercs on their feet and present: with the party split, only those in the dialogue's group. */
export function standingMercs(state: GameState): Merc[] {
  const present = state.dialogue?.mercIds;
  return state.party.filter((m) => !m.down && !m.dead && (!present || present.includes(m.id)));
}

/** Who makes a check, and with what modifier. A merc who is down cannot. */
export function checkMaker(
  state: GameState,
  check: DialogueCheck,
  ctx: Pick<DialogueContext, 'statsOf'>,
): { merc: Merc; modifier: number } {
  const standing = standingMercs(state);
  const leader = getLeader(state);
  const leaderHere = leader && standing.some((m) => m.id === leader.id) ? leader : undefined;
  const candidates = check.by === 'leader' ? [leaderHere ?? standing[0]] : standing;
  let best: { merc: Merc; modifier: number } | null = null;
  for (const merc of candidates) {
    if (!merc) continue;
    const modifier = statModifier(ctx.statsOf(merc)[check.stat]);
    if (!best || modifier > best.modifier) best = { merc, modifier };
  }
  if (!best) throw new Error('A check needs at least one merc standing.');
  return best;
}

function targetsOf(state: GameState, target: EffectTarget, rollerId: string | null): Merc[] {
  const standing = standingMercs(state);
  if (target === 'party') return standing;
  const leader = getLeader(state);
  const roller = rollerId ? state.party.find((m) => m.id === rollerId) : null;
  const leaderHere = leader && standing.some((m) => m.id === leader.id) ? leader : undefined;
  const pick = target === 'roller' && roller ? roller : (leaderHere ?? standing[0]);
  return pick ? [pick] : [];
}

function applyEffects(
  state: GameState,
  effects: Effect[] = [],
  rollerId: string | null,
  ctx: DialogueContext,
): { state: GameState; notes: string[]; rolls: ShownRoll[] } {
  let next = state;
  const notes: string[] = [];
  const rolls: ShownRoll[] = [];
  const updateMerc = (id: string, change: (m: Merc) => Merc) => {
    next = { ...next, party: next.party.map((m) => (m.id === id ? change(m) : m)) };
  };

  for (const effect of effects) {
    switch (effect.type) {
      case 'setFlag':
        next = { ...next, flags: { ...next.flags, [effect.flag]: effect.value } };
        break;
      case 'money':
      case 'payFlag': {
        const payee = getLeader(next) ?? next.party[0];
        const flag = effect.type === 'payFlag' ? next.flags[effect.flag] : undefined;
        const amount = effect.type === 'money' ? effect.amount : typeof flag === 'number' ? flag * COPPER_PER_GOLD : 0;
        if (!payee || amount === 0) break;
        const purse = Math.max(0, payee.purse + amount);
        updateMerc(payee.id, (m) => ({ ...m, purse }));
        notes.push(
          amount > 0
            ? `${payee.name} receives ${formatCoins(amount)}.`
            : `${payee.name} pays ${formatCoins(payee.purse - purse)}.`,
        );
        break;
      }
      case 'xp': {
        const awarded = awardXp(next.party, Object.fromEntries(next.party.map((m) => [m.id, effect.amount])));
        next = { ...next, party: awarded.party };
        notes.push(`Everyone gains ${effect.amount} XP.`, ...awarded.lines);
        break;
      }
      case 'completeAdventure':
        next = completeAdventure(next);
        notes.push('Contract complete. Back in town, the party recovers its strength.');
        break;
      case 'damage':
      case 'heal': {
        for (const merc of targetsOf(next, effect.target, rollerId)) {
          const rolled = rollDice(next.rngSeed, effect.amount);
          next = { ...next, rngSeed: rolled.seed };
          const max = ctx.maxHpOf(merc);
          if (effect.type === 'damage') {
            const wounds = Math.min(max, merc.wounds + rolled.value);
            const down = wounds >= max;
            notes.push(`${merc.name} takes ${rolled.value} damage.`);
            if (down) {
              // Going down outside a fight injures just the same.
              const fall = knockDown({ ...merc, wounds }, ctx.raceOf(merc), next.rngSeed);
              next = { ...next, rngSeed: fall.seed };
              updateMerc(merc.id, () => ({ ...fall.merc, wounds }));
              notes.push(fall.line);
              if (fall.save) rolls.push(saveRoll(merc.name, fall.save));
            } else {
              updateMerc(merc.id, (m) => ({ ...m, wounds }));
            }
          } else {
            const wounds = Math.max(0, merc.wounds - rolled.value);
            updateMerc(merc.id, (m) => ({ ...m, wounds }));
            notes.push(`${merc.name} recovers ${merc.wounds - wounds} HP.`);
          }
        }
        break;
      }
      case 'giveItem': {
        const holder = getLeader(next) ?? next.party[0];
        if (!holder) break;
        updateMerc(holder.id, (m) => {
          const stack = m.inventory.find((s) => s.itemId === effect.itemId);
          const inventory = stack
            ? m.inventory.map((s) => (s === stack ? { ...s, quantity: s.quantity + effect.quantity } : s))
            : [...m.inventory, { itemId: effect.itemId, quantity: effect.quantity }];
          return { ...m, inventory };
        });
        break;
      }
      case 'resolveFeature': {
        const source = next.dialogue?.source;
        if (source && next.dungeon && !next.dungeon.resolved.includes(source)) {
          next = { ...next, dungeon: { ...next.dungeon, resolved: [...next.dungeon.resolved, source] } };
        }
        break;
      }
    }
  }
  return { state: ensureLiveLeader(next), notes, rolls };
}

/** Moves to the outcome's next node, or ends the dialogue. */
function advance(state: GameState, to: Pick<Outcome, 'goto' | 'end' | 'dungeon'>, ctx: DialogueContext): GameState {
  if (!state.dialogue) return state;
  if (to.goto) return { ...state, dialogue: { ...state.dialogue, nodeId: to.goto, result: null } };
  if (to.end === 'adventureSelect') return closeAdventure(state);
  const closed: GameState = { ...state, dialogue: null, screen: to.end ?? 'dungeon' };
  // Ending on the map with no map in progress enters a dungeon: the one named, or the adventure's first.
  const target = to.dungeon ?? (closed.screen === 'dungeon' && !closed.dungeon ? ctx.defaultDungeon(closed) : undefined);
  if (target) return enterDungeon(closed, ctx.getDungeon(target));
  return closed;
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
    check = { ...rolled.value, stat: option.check.stat, mercName: maker.merc.name, mercId: maker.merc.id };
    outcome = rolled.value.success ? option.success : option.failure;
  } else {
    outcome = option.outcome;
  }
  if (!outcome) throw new Error(`Option "${optionId}" has no outcome.`);

  const applied = applyEffects(next, outcome.effects, check?.mercId ?? null, ctx);
  next = applied.state;

  // A check, or anything that happened to the party, pauses so the player can see it.
  if (outcome.text || check || applied.notes.length > 0) {
    const result: DialogueResult = {
      optionId,
      check,
      text: outcome.text ?? '',
      notes: applied.notes,
      ...(outcome.goto ? { goto: outcome.goto } : {}),
      ...(outcome.end ? { end: outcome.end } : {}),
      ...(outcome.dungeon ? { dungeon: outcome.dungeon } : {}),
    };
    next = { ...next, dialogue: { ...next.dialogue!, result } };
    if (check) {
      next = announceRolls(next, [
        {
          who: check.mercName,
          what: `${check.stat.charAt(0).toUpperCase()}${check.stat.slice(1)} check`,
          sides: 20,
          dice: check.roll.dice,
          kept: check.roll.natural,
          total: check.total,
          target: check.difficulty,
          result: check.success ? 'Success' : 'Failure',
          good: check.success,
        },
        ...applied.rolls,
      ]);
    } else {
      next = announceRolls(next, applied.rolls);
    }
    return next;
  }
  return advance(announceRolls(next, applied.rolls), outcome, ctx);
}

/** The player has read the result and moves on. */
export function continueDialogue(state: GameState, ctx: DialogueContext): GameState {
  const result = state.dialogue?.result;
  if (!result) return state;
  return advance(state, result, ctx);
}
