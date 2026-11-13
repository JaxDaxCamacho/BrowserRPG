import type { GameState } from '../engine';
import type { GameCommand } from '../state/commands';

/**
 * Online co-op. One player hosts: their game is the only one that changes the
 * state and rolls dice. The others join with a short code; they send commands
 * and receive the whole game back after every change.
 */

/** The host's player id; joining players use their own token. */
export const HOST_ID = 'host';

export interface NetPlayer {
  id: string;
  name: string;
  connected: boolean;
}

/** What every player knows about the session. */
export interface SessionInfo {
  code: string;
  players: NetPlayer[];
  /** Merc id to the player who claimed it. Mercs nobody claimed are played by the host. */
  seats: Record<string, string>;
}

/** Player to host. */
export type ClientMessage =
  | { t: 'hello'; token: string; name: string }
  | { t: 'command'; id: number; cmd: GameCommand }
  /** Claim a merc to play, or let go of one (mercId null lets go of all). */
  | { t: 'claim'; mercId: string | null };

/** Host to player. */
export type HostMessage =
  | { t: 'welcome'; playerId: string }
  | { t: 'state'; game: GameState; session: SessionInfo }
  | { t: 'rejected'; id: number; reason: string }
  | { t: 'bye'; reason: string };

/** Whether a merc is played by this player: seated to them, or, for the host, seated to nobody who is here. */
export function controlsMerc(session: SessionInfo, playerId: string, mercId: string): boolean {
  const seated = session.seats[mercId];
  const here = seated ? session.players.find((p) => p.id === seated)?.connected : false;
  if (playerId === HOST_ID) return !seated || !here;
  return seated === playerId && !!here;
}

/** The players who get a say in a conversation: those playing a merc who is present. */
export function votersFor(session: SessionInfo, game: GameState): string[] {
  const present = game.dialogue?.mercIds ?? game.party.filter((m) => !m.dead).map((m) => m.id);
  const voters = new Set<string>();
  for (const mercId of present) {
    const player = session.players.find((p) => p.connected && controlsMerc(session, p.id, mercId));
    voters.add(player?.id ?? HOST_ID);
  }
  return [...voters];
}

/** Short join codes, without letters that are easy to mix up. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCode(length = 5): string {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

/** The PeerJS id a game with this code is hosted under. */
export const peerIdFor = (code: string) => `allerya-heroes-${code.toUpperCase()}`;
