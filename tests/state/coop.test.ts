import { describe, expect, it } from 'vitest';
import { getDialogue, getDungeon, PREMADES, premadeToDraft } from '../../src/content';
import { addMerc, castVote, enterDungeon, setLeader, startDialogue, startNewGame, type GameState } from '../../src/engine';
import { controlsMerc, HOST_ID, newCode, votersFor, type SessionInfo } from '../../src/net/protocol';
import { commandBlocker, runCommand } from '../../src/state/commands';
import { dialogueContext } from '../../src/state/context';

function party(): GameState {
  let s: GameState = { ...startNewGame(5), adventureId: 'greywater-ford' };
  for (const id of ['aldric-vane', 'pip-larkspur', 'maelis-thorne', 'korg-the-unbowed']) s = addMerc(s, premadeToDraft(PREMADES.find((p) => p.id === id)!));
  return setLeader(s, 'merc-1');
}

/** Ana plays Pip (merc-2), Bo plays Maelis (merc-3); the host plays the rest. */
const session = (boHere = true): SessionInfo => ({
  code: 'ABCDE',
  players: [
    { id: HOST_ID, name: 'Host', connected: true },
    { id: 'ana', name: 'Ana', connected: true },
    { id: 'bo', name: 'Bo', connected: boHere },
  ],
  seats: { 'merc-2': 'ana', 'merc-3': 'bo' },
});

describe('seats', () => {
  it('a player controls the mercs they claimed; the host controls the rest', () => {
    const s = session();
    expect(controlsMerc(s, 'ana', 'merc-2')).toBe(true);
    expect(controlsMerc(s, 'ana', 'merc-3')).toBe(false);
    expect(controlsMerc(s, HOST_ID, 'merc-1')).toBe(true);
    expect(controlsMerc(s, HOST_ID, 'merc-2')).toBe(false);
  });

  it('the host takes over a merc whose player has disconnected', () => {
    const s = session(false);
    expect(controlsMerc(s, 'bo', 'merc-3')).toBe(false);
    expect(controlsMerc(s, HOST_ID, 'merc-3')).toBe(true);
  });

  it('join codes are short and unambiguous', () => {
    const code = newCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}$/);
  });
});

describe('who may do what', () => {
  const ana = (mercId: string) => controlsMerc(session(), 'ana', mercId);

  it('setting up is the host’s job', () => {
    const g = party();
    expect(commandBlocker(g, { type: 'confirmParty' }, false, ana)).toMatch(/host/);
    expect(commandBlocker(g, { type: 'enemyStep' }, false, ana)).toMatch(/host/);
    expect(commandBlocker(g, { type: 'confirmParty' }, true, () => true)).toBeNull();
  });

  it('a player changes only their own merc’s gear and training', () => {
    const g = party();
    expect(commandBlocker(g, { type: 'unequip', mercId: 'merc-2', slot: 'mainHand' }, false, ana)).toBeNull();
    expect(commandBlocker(g, { type: 'unequip', mercId: 'merc-1', slot: 'mainHand' }, false, ana)).toMatch(/not your merc/);
    expect(commandBlocker(g, { type: 'spendTalentPoints', mercId: 'merc-3', picks: [] }, false, ana)).toMatch(/not your merc/);
  });

  it('a player acts in a fight only on their own merc’s turn', () => {
    const map = getDungeon('greywater-tower');
    let g = enterDungeon(party(), map);
    g = { ...g, screen: 'combat', encounter: { featureId: 'guards', returnTo: map.start } };
    g = runCommand(g, { type: 'startCombat' });
    const c = g.encounter!.combat!;
    const onTurn = (id: string) => ({ ...g, encounter: { ...g.encounter!, combat: { ...c, order: [id, ...c.order.filter((x) => x !== id)], turn: 0 } } });
    expect(commandBlocker(onTurn('merc-2'), { type: 'endTurn' }, false, ana)).toBeNull();
    expect(commandBlocker(onTurn('merc-1'), { type: 'endTurn' }, false, ana)).toMatch(/not your turn/);
  });

  it('walking the party needs a merc in the group that is moving', () => {
    const g = enterDungeon(party(), getDungeon('greywater-tower'));
    expect(commandBlocker(g, { type: 'setDestination', pos: { x: 4, y: 3 } }, false, ana)).toBeNull();
    expect(commandBlocker(g, { type: 'setDestination', pos: { x: 4, y: 3 } }, false, () => false)).toMatch(/None of your mercs/);
  });
});

describe('voting in conversations', () => {
  const debrief = getDialogue('greywater-ford', 'debrief');
  const atOffice = () => startDialogue(party(), debrief);

  it('everyone present with a merc gets a vote', () => {
    expect(votersFor(session(), atOffice()).sort()).toEqual(['ana', 'bo', HOST_ID].sort());
    // Bo is away: the host speaks for Maelis.
    expect(votersFor(session(false), atOffice()).sort()).toEqual(['ana', HOST_ID].sort());
  });

  it('waits for every vote, then goes with the majority', () => {
    const voters = ['host', 'ana', 'bo'];
    let g = castVote(atOffice(), debrief, 'host', 'ask-pay', voters, 'host', dialogueContext);
    expect(g.dialogue!.nodeId).toBe('office');
    expect(g.dialogue!.votes).toEqual({ host: 'ask-pay' });
    g = castVote(g, debrief, 'ana', 'ask-ford', voters, 'host', dialogueContext);
    g = castVote(g, debrief, 'bo', 'ask-ford', voters, 'host', dialogueContext);
    expect(g.dialogue!.nodeId).toBe('ford');
    expect(g.dialogue!.votes).toBeUndefined();
  });

  it('a tie goes to the leader’s player', () => {
    const voters = ['host', 'ana'];
    let g = castVote(atOffice(), debrief, 'ana', 'ask-ford', voters, 'host', dialogueContext);
    g = castVote(g, debrief, 'host', 'ask-pay', voters, 'host', dialogueContext);
    expect(g.dialogue!.nodeId).toBe('pay');
  });

  it('a vote can be changed before the last one is in, and outsiders cannot vote', () => {
    const voters = ['host', 'ana'];
    let g = castVote(atOffice(), debrief, 'ana', 'ask-ford', voters, 'host', dialogueContext);
    g = castVote(g, debrief, 'ana', 'ask-pay', voters, 'host', dialogueContext);
    expect(g.dialogue!.votes).toEqual({ ana: 'ask-pay' });
    expect(() => castVote(g, debrief, 'zed', 'ask-pay', voters, 'host', dialogueContext)).toThrow(/no say/);
  });

  it('alone, a vote is simply a choice', () => {
    const g = runCommand(atOffice(), { type: 'vote', optionId: 'ask-ford' });
    expect(g.dialogue!.nodeId).toBe('ford');
  });
});

describe('making the party together', () => {
  const fresh = (): GameState => ({ ...startNewGame(2), screen: 'partyCreation' });
  const draft = () => premadeToDraft(PREMADES.find((p) => p.id === 'pip-larkspur')!);

  it('a joined player may add one merc of their own while the party is made', () => {
    const none = () => false;
    expect(commandBlocker(fresh(), { type: 'addMerc', draft: draft() }, false, none)).toBeNull();
    const withMine = runCommand(fresh(), { type: 'addMerc', draft: draft() });
    expect(commandBlocker(withMine, { type: 'addMerc', draft: draft() }, false, (id) => id === 'merc-1')).toMatch(/already have a merc/);
    expect(commandBlocker({ ...fresh(), screen: 'dungeon' }, { type: 'addMerc', draft: draft() }, false, none)).toMatch(/being made/);
  });

  it('and remove only their own', () => {
    const g = runCommand(runCommand(fresh(), { type: 'addMerc', draft: draft() }), { type: 'addMerc', draft: premadeToDraft(PREMADES[0]!) });
    const mine = (id: string) => id === 'merc-1';
    expect(commandBlocker(g, { type: 'removeMerc', mercId: 'merc-1' }, false, mine)).toBeNull();
    expect(commandBlocker(g, { type: 'removeMerc', mercId: 'merc-2' }, false, mine)).toMatch(/not your merc/);
  });

  it('a merc can start with only one tier 1 talent of its own class', () => {
    const bad = { ...draft(), startingTalents: ['t-vanish'] };
    expect(() => runCommand(fresh(), { type: 'addMerc', draft: bad })).toThrow(/not a tier 1 talent/);
    const wrongClass = { ...draft(), startingTalents: ['bulwark'] };
    expect(() => runCommand(fresh(), { type: 'addMerc', draft: wrongClass })).toThrow(/not a talent of the rogue tree/);
    expect(runCommand(fresh(), { type: 'addMerc', draft: draft() }).party[0]!.talents).toEqual({ 't-backstab': 1 });
  });
});

describe('voting for the leader', () => {
  const choosing = (): GameState => ({ ...party(), leaderId: null, screen: 'leaderSelect' });
  const voting = (voterId: string) => ({ voterId, voters: votersFor(session(), choosing()) });
  const vote = (g: GameState, voterId: string, mercId: string) => runCommand(g, { type: 'voteLeader', mercId }, voting(voterId));

  it('gives every player with a merc a vote', () => {
    expect(votersFor(session(), choosing()).sort()).toEqual(['ana', 'bo', HOST_ID].sort());
  });

  it('waits for everyone, then the most votes lead', () => {
    let g = vote(choosing(), 'ana', 'merc-3');
    g = vote(g, 'bo', 'merc-3');
    expect(g.leaderId).toBeNull();
    g = vote(g, HOST_ID, 'merc-1');
    expect(g.leaderId).toBe('merc-3');
  });

  it('lets the host break a tie', () => {
    const s: SessionInfo = { ...session(), seats: { 'merc-2': 'ana' } };
    const v = (voterId: string) => ({ voterId, voters: votersFor(s, choosing()) });
    let g = runCommand(choosing(), { type: 'voteLeader', mercId: 'merc-2' }, v('ana'));
    g = runCommand(g, { type: 'voteLeader', mercId: 'merc-4' }, v(HOST_ID));
    expect(g.leaderId).toBe('merc-4');
  });

  it('follows a changed vote until the leader is confirmed, then forgets the votes', () => {
    let g = vote(choosing(), 'ana', 'merc-2');
    g = vote(g, 'bo', 'merc-2');
    g = vote(g, HOST_ID, 'merc-1');
    expect(g.leaderId).toBe('merc-2');
    g = vote(g, 'bo', 'merc-1');
    g = vote(g, 'ana', 'merc-1');
    expect(g.leaderId).toBe('merc-1');
    g = runCommand(g, { type: 'confirmLeader' });
    expect(g.screen).toBe('adventureSelect');
    expect(g.leaderVotes).toBeUndefined();
  });

  it('alone, a vote simply picks the leader', () => {
    expect(runCommand(choosing(), { type: 'voteLeader', mercId: 'merc-4' }).leaderId).toBe('merc-4');
  });

  it('only players with a merc may vote, and only while the leader is being chosen', () => {
    const controlsNone = () => false;
    const controlsPip = (id: string) => id === 'merc-2';
    expect(commandBlocker(choosing(), { type: 'voteLeader', mercId: 'merc-1' }, false, controlsPip)).toBeNull();
    expect(commandBlocker(choosing(), { type: 'voteLeader', mercId: 'merc-1' }, false, controlsNone)).toMatch(/no merc/);
    expect(commandBlocker({ ...choosing(), screen: 'adventureSelect' }, { type: 'voteLeader', mercId: 'merc-1' }, false, controlsPip)).toMatch(/once the party is made/);
    // Choosing a leader outright stays the host's.
    expect(commandBlocker(choosing(), { type: 'setLeader', mercId: 'merc-1' }, false, controlsPip)).toMatch(/Only the host/);
  });
});
