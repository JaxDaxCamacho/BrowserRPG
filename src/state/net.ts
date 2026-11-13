import { controlsMerc, HOST_ID } from '../net/protocol';
import { useGameStore } from './store';

/**
 * What this player may touch. Alone, everything; in co-op, the host plays any
 * merc nobody else is playing, and each joined player plays the mercs they claimed.
 */
export function useControl() {
  const net = useGameStore((s) => s.net);
  const online = !!net;
  const isClient = net?.role === 'client';
  const isHost = !net || net.role === 'host';
  const controls = (mercId: string | undefined | null): boolean => {
    if (!mercId) return false;
    if (!net) return true;
    return controlsMerc(net.session, net.myId, mercId);
  };
  /** The name of whoever plays a merc, for "Ana is acting…". */
  const playerOf = (mercId: string | undefined | null): string | null => {
    if (!net || !mercId) return null;
    const player = net.session.players.find((p) => p.connected && controlsMerc(net.session, p.id, mercId));
    if (!player) return null;
    return player.id === net.myId ? 'you' : player.id === HOST_ID ? 'the host' : player.name;
  };
  return { online, isClient, isHost, controls, playerOf, myId: net?.myId ?? HOST_ID };
}
