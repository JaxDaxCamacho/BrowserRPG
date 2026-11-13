import type { GameState } from './gameState';
import type { Merc, MercDraft } from './merc';

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
  const merc: Merc = {
    ...draft,
    name: draft.name.trim(),
    id: `merc-${state.nextMercId}`,
    level: 1,
    xp: 0,
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
  return { ...state, screen: 'adventureSelect' };
}
