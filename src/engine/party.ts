import type { GameState } from './gameState';
import { startingKit, type Merc, type MercDraft } from './merc';

export const PARTY_SIZE = 4;

export function isPartyFull(state: GameState): boolean {
  return state.party.length >= PARTY_SIZE;
}

/** Adds a merc to the party. The caller validates the draft first. */
export function addMerc(state: GameState, draft: MercDraft): GameState {
  if (isPartyFull(state)) throw new Error(`The party already has ${PARTY_SIZE} mercenaries.`);
  if (draft.premadeId && state.party.some((m) => m.premadeId === draft.premadeId)) {
    throw new Error(`${draft.name} is already in the party.`);
  }
  const { loadout: _loadout, startingTalents: picked = [], ...identity } = draft;
  const talents: Record<string, number> = {};
  for (const id of picked) talents[id] = (talents[id] ?? 0) + 1;
  const merc: Merc = {
    ...identity,
    ...startingKit(draft),
    name: draft.name.trim(),
    id: `merc-${state.nextMercId}`,
    level: 1,
    xp: 0,
    talents,
  };
  return { ...state, party: [...state.party, merc], nextMercId: state.nextMercId + 1 };
}

/** Removes a merc; if they were the leader, the party has no leader until one is chosen again. */
export function removeMerc(state: GameState, mercId: string): GameState {
  if (!state.party.some((m) => m.id === mercId)) return state;
  return {
    ...state,
    party: state.party.filter((m) => m.id !== mercId),
    leaderId: state.leaderId === mercId ? null : state.leaderId,
  };
}

export function setLeader(state: GameState, mercId: string): GameState {
  if (!state.party.some((m) => m.id === mercId)) throw new Error(`No merc with id "${mercId}" in the party.`);
  return { ...state, leaderId: mercId };
}

/**
 * Co-op: a player votes for a leader. Once every voter has voted, the merc
 * with the most votes leads; a tie goes to the tie-breaker's pick (the host)
 * if it is among the tied, or else to the tied merc voted for first. Votes can
 * be changed until the leader is confirmed, and the result follows them.
 */
export function voteForLeader(state: GameState, voterId: string, mercId: string, voters: string[], tieBreaker?: string): GameState {
  if (state.screen !== 'leaderSelect') throw new Error('The leader is chosen once the party is made.');
  if (!voters.includes(voterId)) throw new Error('You have no merc in the party, so no vote.');
  if (!state.party.some((m) => m.id === mercId && !m.dead)) throw new Error(`No merc with id "${mercId}" in the party.`);
  const votes = { ...(state.leaderVotes ?? {}), [voterId]: mercId };
  if (!voters.every((v) => votes[v])) return { ...state, leaderVotes: votes };
  const tally = leaderTally(votes, voters);
  const top = Math.max(...Object.values(tally));
  const tied = Object.keys(tally).filter((id) => tally[id] === top);
  const tieBreak = tieBreaker ? votes[tieBreaker] : undefined;
  const winner =
    tied.length === 1 ? tied[0]! : tieBreak && tied.includes(tieBreak) ? tieBreak : Object.values(votes).find((id) => tied.includes(id))!;
  return { ...state, leaderVotes: votes, leaderId: winner };
}

/** Votes per merc, counting only the players who have a say now. */
export function leaderTally(votes: Record<string, string>, voters: string[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const v of voters) if (votes[v]) tally[votes[v]!] = (tally[votes[v]!] ?? 0) + 1;
  return tally;
}

export function getLeader(state: GameState): Merc | null {
  return state.party.find((m) => m.id === state.leaderId) ?? null;
}

/** Party creation is finished: move on to choosing a leader. */
export function confirmParty(state: GameState): GameState {
  if (!isPartyFull(state)) throw new Error(`A party needs ${PARTY_SIZE} mercenaries.`);
  return { ...state, screen: 'leaderSelect' };
}

/** The leader is chosen: move on to picking an adventure. */
export function confirmLeader(state: GameState): GameState {
  if (!getLeader(state)) throw new Error('Choose a leader first.');
  const { leaderVotes: _votes, ...rest } = state;
  return { ...rest, screen: 'adventureSelect' };
}
