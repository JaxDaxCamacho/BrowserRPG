import Peer, { type DataConnection } from 'peerjs';
import { newCode, peerIdFor, type ClientMessage, type HostMessage } from './protocol';

/**
 * The connection layer. Browsers talk directly over WebRTC; PeerJS's free
 * public server only introduces them (it sees the join code, never the game).
 */

export interface HostLink {
  code: string;
  /** Sends to one player, or to every connected player. */
  send: (playerConnId: string | null, msg: HostMessage) => void;
  close: () => void;
}

export interface HostEvents {
  onMessage: (connId: string, msg: ClientMessage) => void;
  onLeave: (connId: string) => void;
  onError: (message: string) => void;
}

/** Opens a game for others to join. Tries a few codes in case one is taken. */
export async function openHost(events: HostEvents): Promise<HostLink> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      const peer = await openPeer(peerIdFor(code));
      const conns = new Map<string, DataConnection>();
      peer.on('connection', (conn) => {
        conn.on('open', () => conns.set(conn.connectionId, conn));
        conn.on('data', (data) => events.onMessage(conn.connectionId, data as ClientMessage));
        conn.on('close', () => {
          conns.delete(conn.connectionId);
          events.onLeave(conn.connectionId);
        });
        conn.on('error', () => {
          conns.delete(conn.connectionId);
          events.onLeave(conn.connectionId);
        });
      });
      peer.on('error', (err) => events.onError(describe(err)));
      peer.on('disconnected', () => peer.reconnect());
      return {
        code,
        send: (connId, msg) => {
          if (connId) conns.get(connId)?.send(msg);
          else for (const c of conns.values()) c.send(msg);
        },
        close: () => peer.destroy(),
      };
    } catch (error) {
      if (!String(error).includes('unavailable-id')) throw error;
    }
  }
  throw new Error('Could not get a join code. Try again.');
}

export interface ClientLink {
  send: (msg: ClientMessage) => void;
  close: () => void;
}

export interface ClientEvents {
  onMessage: (msg: HostMessage) => void;
  onClose: (reason: string) => void;
}

/** Joins the game hosted under a code. */
export async function joinHost(code: string, events: ClientEvents): Promise<ClientLink> {
  const peer = await openPeer();
  const conn = peer.connect(peerIdFor(code), { reliable: true });
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('No game found with that code.')), 12000);
    conn.on('open', () => {
      window.clearTimeout(timer);
      resolve();
    });
    peer.on('error', (err) => {
      window.clearTimeout(timer);
      reject(new Error(err.type === 'peer-unavailable' ? 'No game found with that code.' : describe(err)));
    });
  });
  conn.on('data', (data) => events.onMessage(data as HostMessage));
  conn.on('close', () => events.onClose('The host has left.'));
  peer.on('disconnected', () => peer.reconnect());
  return {
    send: (msg) => conn.send(msg),
    close: () => peer.destroy(),
  };
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer();
    peer.on('open', () => resolve(peer));
    peer.on('error', (err) => {
      peer.destroy();
      reject(new Error(err.type === 'unavailable-id' ? 'unavailable-id' : describe(err)));
    });
  });
}

function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'type' in err) {
    const type = (err as { type: string }).type;
    if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Could not reach the matchmaking server. Check your internet connection.';
    if (type === 'browser-incompatible') return 'This browser does not support online play.';
  }
  return err instanceof Error ? err.message : String(err);
}
