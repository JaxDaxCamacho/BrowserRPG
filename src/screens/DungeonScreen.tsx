import { useEffect, useRef, useState } from 'react';
import { getDungeon, getMonster } from '../content';
import {
  activeMercIds,
  allEncounters,
  encounterMercIds,
  canLeave,
  endExploreTurn,
  getLeader,
  goalReached,
  groupInFight,
  groupingBlocker,
  groupsHere,
  groupsOf,
  isSplit,
  leaveDungeon,
  regroup,
  restBlocker,
  setDestination,
  splitOff,
  stepParty,
  stopWalking,
  type FeatureDefinition,
  type GameState,
  type GroupState,
  type Merc,
} from '../engine';
import { DungeonView, type MarkerInfo } from '../render/DungeonView';
import { currentHp, dungeonContext } from '../state/context';
import { useGameStore } from '../state/store';
import { assetUrl } from './assets';
import { initials, Token } from './MercCard';
import { MuteButton } from './MuteButton';
import { PartyWindow } from './PartyWindow';
import { RestDialog } from './RestDialog';

/** Time between steps while the party walks a path. */
const STEP_MS = 160;

function markerFor(feature: FeatureDefinition): MarkerInfo {
  if (feature.type === 'encounter') {
    const first = getMonster(feature.monsters[0]!.monsterId);
    const count = feature.monsters.reduce((n, m) => n + m.count, 0);
    return { image: feature.icon ?? first.portrait, label: initials(first.name), count };
  }
  return { image: feature.icon, label: feature.type === 'goal' ? '★' : '?' };
}

export function DungeonScreen() {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);
  const backToMenu = useGameStore((s) => s.backToMenu);
  const testPlay = useGameStore((s) => s.testPlay);
  const [panel, setPanel] = useState<'party' | 'rest' | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<DungeonView | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const dungeon = game.dungeon;
  const def = dungeon ? getDungeon(dungeon.dungeonId) : null;
  const groups = groupsOf(game);
  const active = groups[0];
  const leader = active ? tokenMerc(game, active) : (getLeader(game) ?? game.party[0]);

  // Create the renderer once.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new DungeonView(hostRef.current, {
      onTileTap: (pos) =>
        applyRef.current((g) => {
          if (!g.dungeon) return g;
          const d = getDungeon(g.dungeon.dungeonId);
          return setDestination(g, d, pos);
        }),
      assetUrl,
      markerFor,
    });
    viewRef.current = view;
    void view.init();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Feed it the latest state.
  useEffect(() => {
    if (!def || !dungeon || !viewRef.current) return;
    const others = groupsOf(game)
      .slice(1)
      .map((g) => {
        const face = tokenMerc(game, g);
        return { id: g.id, pos: g.pos, ...(face?.portrait ? { portrait: face.portrait } : {}), initials: face ? initials(face.name) : '?', fighting: groupInFight(game, g) };
      });
    viewRef.current.update({
      def,
      dungeon,
      leaderPortrait: leader?.portrait,
      leaderInitials: leader ? initials(leader.name) : '?',
      ...(dungeon.group ? { groupId: dungeon.group.id } : {}),
      others,
    });
  }, [def, dungeon, leader, game]);

  // Walk the planned path one tile at a time.
  const walking = (dungeon?.path.length ?? 0) > 0;
  useEffect(() => {
    if (!walking) return;
    const timer = window.setTimeout(() => {
      applyRef.current((g) => {
        if (!g.dungeon) return g;
        return stepParty(g, getDungeon(g.dungeon.dungeonId), dungeonContext(g));
      });
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [walking, dungeon?.pos.x, dungeon?.pos.y, dungeon?.path.length]);

  if (!dungeon || !def) {
    return (
      <main className="screen">
        <p>No dungeon is being explored.</p>
        <button type="button" onClick={backToMenu}>
          Back to menu
        </button>
      </main>
    );
  }

  const goalDone = goalReached(dungeon, def);
  const split = isSplit(game);
  const world = dungeon.world;
  const here = new Set(activeMercIds(game));
  const groupBlock = groupingBlocker(game);
  const canRegroup = !groupBlock && groupsHere(game).length > 0;
  const restBlock = restBlocker(game);
  const turnNames = game.party.filter((m) => here.has(m.id)).map((m) => m.name);
  // Mercs who fell in a fight that now waits for a rescue.
  const awaitingRescue = new Set(
    allEncounters(game)
      .filter((e) => e.combat?.dormant)
      .flatMap((e) => encounterMercIds(game, e)),
  );
  const atExit = canLeave(game, def);
  const headOut = () =>
    apply((g) => {
      if (!g.dungeon) return g;
      const d = getDungeon(g.dungeon.dungeonId);
      return canLeave(g, d) ? leaveDungeon(g, d, dungeonContext(g)) : setDestination(g, d, d.start);
    });

  return (
    <main className="dungeon">
      <header className="dungeon-bar">
        <h1>{def.name.charAt(0).toUpperCase() + def.name.slice(1)}</h1>
        <ul className="party-strip">
          {game.party.map((m) => {
            const hp = currentHp(m);
            const inGroup = here.has(m.id);
            const canGo = inGroup && here.size > 1 && !m.dead && !groupBlock;
            return (
              <li
                key={m.id}
                className={`${m.down ? 'down' : ''}${split && !inGroup ? ' elsewhere' : ''}`}
                title={`${m.name}: ${hp.current} / ${hp.max} HP${split && !inGroup ? ' · in another group' : ''}`}
              >
                <Token name={m.name} portrait={m.portrait} size={36} />
                <span className="party-info">
                  <span className="party-name">
                    {m.name}
                    {m.id === game.leaderId && <span className="dim"> · leader</span>}
                  </span>
                  <span className="hp-bar" aria-label={`${hp.current} of ${hp.max} hit points`}>
                    <span style={{ width: `${(hp.current / hp.max) * 100}%` }} />
                  </span>
                  <span className="dim hp-text">
                    {m.dead ? 'Dead' : awaitingRescue.has(m.id) ? 'Fallen · awaiting rescue' : m.down ? 'Down' : `${hp.current} / ${hp.max}`}
                    {!m.dead && m.injuries.length > 0 && ` · ${m.injuries.length} injur${m.injuries.length === 1 ? 'y' : 'ies'}`}
                  </span>
                </span>
                {canGo && (
                  <button type="button" className="go-alone" title={`${m.name} leaves the group with their own token`} onClick={() => apply((g) => splitOff(g, m.id))}>
                    Go alone
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <MuteButton />
        <button type="button" className={testPlay ? 'primary' : ''} onClick={backToMenu}>
          {testPlay ? 'Back to the dungeon maker' : 'Menu'}
        </button>
      </header>

      <div className="dungeon-map" ref={hostRef} />

      <footer className="dungeon-footer">
        <ol className="dungeon-log" aria-live="polite">
          {dungeon.log.slice(-4).map((line, i) => (
            <li key={`${dungeon.log.length}-${i}`}>{line}</li>
          ))}
        </ol>
        {world && (
          <p className="world-banner" aria-live="polite">
            <strong>World round {world.round}</strong>
            {world.current?.kind === 'explore' ? (
              <>
                {' '}
                · {turnNames.join(', ')} {turnNames.length === 1 ? 'explores' : 'explore'} · {world.movesLeft ?? 0} move{world.movesLeft === 1 ? '' : 's'} left
              </>
            ) : (
              ' · a fight is under way'
            )}
          </p>
        )}
        <div className="row">
          {testPlay && <span className="goal-banner">Test play: nothing is saved.</span>}
          {goalDone && <span className="goal-banner">Goal reached. Make your way back to the entrance.</span>}
          {goalDone && split && <span className="goal-banner">Regroup the party to leave.</span>}
          {goalDone && !split && (
            <button type="button" className="primary" disabled={walking} onClick={headOut}>
              {atExit ? 'Leave the dungeon' : 'Head for the exit'}
            </button>
          )}
          {walking && (
            <button type="button" onClick={() => apply(stopWalking)}>
              Stop
            </button>
          )}
          {world?.current?.kind === 'explore' && (
            <button type="button" className="primary" disabled={walking} onClick={() => apply(endExploreTurn)}>
              End turn
            </button>
          )}
          {split && (
            <button type="button" disabled={!canRegroup} title={canRegroup ? undefined : 'Move onto another group’s tile to regroup.'} onClick={() => apply(regroup)}>
              Regroup
            </button>
          )}
          <button type="button" onClick={() => setPanel('party')}>
            Party
          </button>
          <button
            type="button"
            disabled={!dungeon.camping && !!restBlock}
            title={!dungeon.camping && restBlock ? restBlock : undefined}
            onClick={() => setPanel('rest')}
          >
            {dungeon.camping ? 'Back to camp' : dungeon.rested ? 'Camp used' : 'Make camp'}
          </button>
          <button type="button" onClick={() => viewRef.current?.centreOnParty()}>
            Centre on party
          </button>
        </div>
      </footer>
      {panel === 'party' && <PartyWindow onClose={() => setPanel(null)} />}
      {panel === 'rest' && <RestDialog onClose={() => setPanel(null)} />}
    </main>
  );
}

/** Who a group's token shows: the leader if they are in it, otherwise its first living merc. */
function tokenMerc(game: GameState, group: GroupState): Merc | undefined {
  const members = group.mercIds.map((id) => game.party.find((m) => m.id === id)).filter((m): m is Merc => !!m);
  return members.find((m) => m.id === game.leaderId) ?? members.find((m) => !m.dead) ?? members[0];
}
