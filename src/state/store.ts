import { create } from 'zustand';
import { getDungeon, PREMADES, premadeToDraft } from '../content';
import { addMerc, createInitialState, enterDungeon, setLeader, settle, startNewGame, type GameState } from '../engine';
import { joinHost, openHost, type ClientLink, type HostLink } from '../net/peer';
import { controlsMerc, HOST_ID, votersFor, type ClientMessage, type HostMessage, type SessionInfo } from '../net/protocol';
import { commandBlocker, leaderOf, runCommand, type GameCommand, type Voting } from './commands';
import { combatContext } from './context';
import { createDefaultSaveStore, type SaveRecord } from '../platform/saveStore';

export type Tool = 'contentEditor' | 'dungeonMaker';
const TOOLS: Tool[] = ['contentEditor', 'dungeonMaker'];

interface GameStore {
  game: GameState;
  /** The save slot the current game autosaves into; null on the main menu or in test play. */
  activeSlot: string | null;
  saves: SaveRecord[];
  /** False until the first read of storage finishes. */
  savesLoaded: boolean;
  /** Set when reading or writing storage fails, so the menu can say so. */
  saveError: string | null;
  /** A developer tool open instead of the game, such as the content editor. */
  tool: Tool | null;
  openTool: (tool: Tool | null) => void;
  /** Set while trying out a dungeon from the dungeon maker. Nothing is saved. */
  testPlay: { dungeonId: string } | null;
  /** How long the dice tray waits before rolling, so a fight can show who attacks whom first. Not saved. */
  diceDelay: number;
  setDiceDelay: (ms: number) => void;
  startTestPlay: (dungeonId: string, adventureId: string) => void;
  endTestPlay: () => void;

  /** Runs an engine command against the current game. Local only: use dispatch for anything a player does. */
  apply: (command: (game: GameState) => GameState) => void;
  /**
   * Does something in the game. Alone or hosting, it happens here (and throws
   * if it cannot); as a joined player it goes to the host, and a refusal shows in `netNotice`.
   */
  dispatch: (cmd: GameCommand) => void;

  /** The online co-op session, if any. */
  net: NetState | null;
  /** The latest co-op message for the player: a refused action, a lost connection. */
  netNotice: string | null;
  clearNetNotice: () => void;
  hostOnline: () => Promise<void>;
  joinOnline: (code: string, name: string) => Promise<void>;
  leaveOnline: () => void;
  /** As a joined player: play this merc (or, with null, let go of yours). As host: take a merc back. */
  claimMerc: (mercId: string | null) => void;
  /** Host only: give a merc to a player, or with null back to the host. */
  assignSeat: (mercId: string, playerId: string | null) => void;
  refreshSaves: () => Promise<void>;
  newGame: (slotId: string) => void;
  continueGame: (slotId: string) => void;
  backToMenu: () => void;
}

export interface NetState {
  role: 'host' | 'client';
  /** This player's id: HOST_ID for the host. */
  myId: string;
  session: SessionInfo;
}

const saveStore = createDefaultSaveStore();

// The open connection, outside the store because it is not data.
let hostLink: HostLink | null = null;
let clientLink: ClientLink | null = null;
/** Host: which player is on each connection. */
const playerOnConn = new Map<string, string>();
let commandSeq = 0;

/** A random token that identifies this browser to a host, so rejoining keeps your seat. */
function playerToken(): string {
  try {
    const saved = localStorage.getItem('allerya.playerToken');
    if (saved) return saved;
    const token = `p-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('allerya.playerToken', token);
    return token;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** The vote set-up for a command from this player, in a co-op conversation. */
function votingFor(game: GameState, session: SessionInfo, playerId: string): Voting {
  const leader = leaderOf(game);
  const tieBreaker = leader ? session.players.find((p) => p.connected && controlsMerc(session, p.id, leader))?.id ?? HOST_ID : undefined;
  return { voterId: playerId, voters: votersFor(session, game), ...(tieBreaker ? { tieBreaker } : {}) };
}

/** Writes are queued so they land in order and a refresh never reads a half-finished save. */
let pendingWrites: Promise<void> = Promise.resolve();

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rememberTool(tool: Tool | null) {
  try {
    if (tool) sessionStorage.setItem('allerya.tool', tool);
    else sessionStorage.removeItem('allerya.tool');
  } catch {
    // Storage can be unavailable; the tool just will not reopen after a reload.
  }
}

/** The first four pre-built mercs, led by the first, dropped at a dungeon's start. */
function testParty(dungeonId: string, adventureId: string): GameState {
  let game: GameState = { ...startNewGame(randomSeed()), adventureId };
  for (const premade of PREMADES.slice(0, 4)) game = addMerc(game, premadeToDraft(premade));
  return enterDungeon(setLeader(game, 'merc-1'), getDungeon(dungeonId));
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: createInitialState(),
  activeSlot: null,
  saves: [],
  savesLoaded: false,
  saveError: null,
  tool: readOpenTool(),
  openTool: (tool) => {
    rememberTool(tool);
    set({ tool });
  },
  testPlay: null,
  diceDelay: 0,
  setDiceDelay: (ms) => set({ diceDelay: ms }),
  startTestPlay: (dungeonId, adventureId) => {
    rememberTool('dungeonMaker');
    set({ tool: null, activeSlot: null, testPlay: { dungeonId }, game: testParty(dungeonId, adventureId) });
  },
  endTestPlay: () => {
    rememberTool('dungeonMaker');
    set({ tool: 'dungeonMaker', testPlay: null, game: createInitialState() });
  },

  // Every command is followed by settle, which keeps a split party's turns in order.
  apply: (command) => set((s) => ({ game: settle(command(s.game), combatContext) })),

  dispatch: (cmd) => {
    const { net } = get();
    if (net?.role === 'client') {
      clientLink?.send({ t: 'command', id: ++commandSeq, cmd });
      return;
    }
    const voting = net?.role === 'host' ? votingFor(get().game, net.session, HOST_ID) : undefined;
    set((s) => ({ game: settle(runCommand(s.game, cmd, voting), combatContext) }));
  },

  net: null,
  netNotice: null,
  clearNetNotice: () => set({ netNotice: null }),

  hostOnline: async () => {
    if (get().net) return;
    const link = await openHost({
      onMessage: (connId, msg) => hostReceive(connId, msg),
      onLeave: (connId) => {
        const playerId = playerOnConn.get(connId);
        playerOnConn.delete(connId);
        if (!playerId) return;
        updateSession((ses) => ({ ...ses, players: ses.players.map((p) => (p.id === playerId ? { ...p, connected: false } : p)) }));
        const name = get().net?.session.players.find((p) => p.id === playerId)?.name ?? 'A player';
        set({ netNotice: `${name} has disconnected. You play their merc until they come back.` });
      },
      onError: (message) => set({ netNotice: message }),
    });
    hostLink = link;
    set({ net: { role: 'host', myId: HOST_ID, session: { code: link.code, players: [{ id: HOST_ID, name: 'Host', connected: true }], seats: {} } } });
  },

  joinOnline: async (code, name) => {
    if (get().net) return;
    const token = playerToken();
    const link = await joinHost(code.trim().toUpperCase(), {
      onMessage: (msg) => clientReceive(msg),
      onClose: (reason) => {
        clientLink = null;
        set({ net: null, netNotice: reason, game: createInitialState(), activeSlot: null });
      },
    });
    clientLink = link;
    set({ activeSlot: null, net: { role: 'client', myId: token, session: { code: code.toUpperCase(), players: [], seats: {} } } });
    link.send({ t: 'hello', token, name: name.trim() || 'Player' });
  },

  leaveOnline: () => {
    hostLink?.send(null, { t: 'bye', reason: 'The host has closed the game.' });
    hostLink?.close();
    clientLink?.close();
    hostLink = null;
    clientLink = null;
    playerOnConn.clear();
    const wasClient = get().net?.role === 'client';
    set({ net: null, ...(wasClient ? { game: createInitialState(), activeSlot: null } : {}) });
  },

  claimMerc: (mercId) => {
    const { net } = get();
    if (!net) return;
    if (net.role === 'client') clientLink?.send({ t: 'claim', mercId });
    else if (mercId) get().assignSeat(mercId, null);
  },

  assignSeat: (mercId, playerId) => {
    if (get().net?.role !== 'host') return;
    updateSession((ses) => {
      const seats = { ...ses.seats };
      if (playerId) seats[mercId] = playerId;
      else delete seats[mercId];
      return { ...ses, seats };
    });
  },

  refreshSaves: async () => {
    await pendingWrites;
    try {
      const saves = await saveStore.list();
      set({ saves, savesLoaded: true, saveError: null });
    } catch (error) {
      set({ saves: [], savesLoaded: true, saveError: `Could not read saved games: ${describe(error)}` });
    }
  },

  newGame: (slotId) => set({ game: startNewGame(randomSeed()), activeSlot: slotId }),

  continueGame: (slotId) => {
    const record = get().saves.find((s) => s.slotId === slotId);
    if (record) set({ game: record.state, activeSlot: slotId });
  },

  backToMenu: () => {
    if (get().net) get().leaveOnline();
    if (get().testPlay) {
      get().endTestPlay();
      return;
    }
    set({ game: createInitialState(), activeSlot: null });
    void get().refreshSaves();
  },
}));

// Autosave: every change to a game in progress is written to its slot.
useGameStore.subscribe((now, before) => {
  if (now.game === before.game && now.activeSlot === before.activeSlot) return;
  const { game, activeSlot } = now;
  if (!activeSlot || game.screen === 'menu') return;
  pendingWrites = pendingWrites
    .then(() => saveStore.save(activeSlot, game))
    .catch((error: unknown) => {
      useGameStore.setState({ saveError: `Could not save the game: ${describe(error)}` });
    });
});

// ---------- co-op ----------

function updateSession(change: (s: SessionInfo) => SessionInfo) {
  const net = useGameStore.getState().net;
  if (!net) return;
  useGameStore.setState({ net: { ...net, session: change(net.session) } });
}

/** The host handles a message from a player. */
function hostReceive(connId: string, msg: ClientMessage) {
  const store = useGameStore.getState();
  const net = store.net;
  if (!net || net.role !== 'host' || !hostLink) return;
  if (msg.t === 'hello') {
    const id = msg.token;
    playerOnConn.set(connId, id);
    updateSession((ses) => {
      const known = ses.players.some((p) => p.id === id);
      const players = known
        ? ses.players.map((p) => (p.id === id ? { ...p, name: msg.name, connected: true } : p))
        : [...ses.players, { id, name: msg.name, connected: true }];
      return { ...ses, players };
    });
    hostLink.send(connId, { t: 'welcome', playerId: id });
    broadcastState();
    return;
  }
  const playerId = playerOnConn.get(connId);
  if (!playerId) return;
  if (msg.t === 'claim') {
    updateSession((ses) => {
      const seats = { ...ses.seats };
      if (msg.mercId === null) {
        for (const [m, p] of Object.entries(seats)) if (p === playerId) delete seats[m];
      } else {
        const holder = seats[msg.mercId];
        const holderHere = holder && ses.players.find((p) => p.id === holder)?.connected;
        const exists = store.game.party.some((m) => m.id === msg.mercId && !m.dead);
        if (exists && (!holder || !holderHere || holder === playerId)) seats[msg.mercId] = playerId;
      }
      return { ...ses, seats };
    });
    return;
  }
  if (msg.t === 'command') {
    const game = store.game;
    const why = commandBlocker(game, msg.cmd, false, (mercId) => controlsMerc(net.session, playerId, mercId));
    if (why) {
      hostLink.send(connId, { t: 'rejected', id: msg.id, reason: why });
      return;
    }
    try {
      const next = settle(runCommand(game, msg.cmd, votingFor(game, net.session, playerId)), combatContext);
      useGameStore.setState({ game: next });
      // A merc a player brings to the party is theirs to play.
      if (msg.cmd.type === 'addMerc') {
        const added = next.party.find((m) => !game.party.some((old) => old.id === m.id));
        if (added) store.assignSeat(added.id, playerId);
      }
    } catch (error) {
      hostLink.send(connId, { t: 'rejected', id: msg.id, reason: describe(error) });
    }
  }
}

/** A joined player handles a message from the host. */
function clientReceive(msg: HostMessage) {
  const net = useGameStore.getState().net;
  if (!net || net.role !== 'client') return;
  switch (msg.t) {
    case 'welcome':
      useGameStore.setState({ net: { ...net, myId: msg.playerId } });
      break;
    case 'state':
      useGameStore.setState({ game: msg.game, net: { ...net, session: msg.session } });
      break;
    case 'rejected':
      useGameStore.setState({ netNotice: msg.reason });
      break;
    case 'bye':
      useGameStore.getState().leaveOnline();
      useGameStore.setState({ netNotice: msg.reason });
      break;
  }
}

/** The host sends everyone the game as it now is. Batched: several changes in one moment go as one message. */
let broadcastQueued = false;
function broadcastState() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  queueMicrotask(() => {
    broadcastQueued = false;
    const { net, game } = useGameStore.getState();
    if (net?.role === 'host' && hostLink) hostLink.send(null, { t: 'state', game, session: net.session });
  });
}

useGameStore.subscribe((now, before) => {
  if (now.net?.role !== 'host') return;
  if (now.game !== before.game || now.net !== before.net) broadcastState();
});

/** Saving content reloads the page in development, so the open editor reopens itself. */
function readOpenTool(): Tool | null {
  try {
    const stored = sessionStorage.getItem('allerya.tool') as Tool | null;
    return import.meta.env.DEV && stored && TOOLS.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
