import { useEffect, useRef } from 'react';
import { getDungeon, getMonster } from '../content';
import { getLeader, setDestination, stepParty, stopWalking, type FeatureDefinition } from '../engine';
import { DungeonView, type MarkerInfo } from '../render/DungeonView';
import { currentHp, dungeonContext } from '../state/context';
import { useGameStore } from '../state/store';
import { assetUrl } from './assets';
import { initials, Token } from './MercCard';

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
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<DungeonView | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const dungeon = game.dungeon;
  const def = dungeon ? getDungeon(dungeon.dungeonId) : null;
  const leader = getLeader(game) ?? game.party[0];

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
    viewRef.current.update({
      def,
      dungeon,
      leaderPortrait: leader?.portrait,
      leaderInitials: leader ? initials(leader.name) : '?',
    });
  }, [def, dungeon, leader]);

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

  const goal = def.features.find((f) => f.type === 'goal');
  const goalDone = goal ? dungeon.resolved.includes(goal.id) : false;

  return (
    <main className="dungeon">
      <header className="dungeon-bar">
        <h1>{def.name.charAt(0).toUpperCase() + def.name.slice(1)}</h1>
        <ul className="party-strip">
          {game.party.map((m) => {
            const hp = currentHp(m);
            return (
              <li key={m.id} className={m.down ? 'down' : ''} title={`${m.name}: ${hp.current} / ${hp.max} HP`}>
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
                    {m.down ? 'Down' : `${hp.current} / ${hp.max}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
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
        <div className="row">
          {testPlay && <span className="goal-banner">Test play: nothing is saved.</span>}
          {goalDone && <span className="goal-banner">Goal reached. The journey back comes in a later milestone.</span>}
          {walking && (
            <button type="button" onClick={() => apply(stopWalking)}>
              Stop
            </button>
          )}
          <button type="button" onClick={() => viewRef.current?.centreOnParty()}>
            Centre on party
          </button>
        </div>
      </footer>
    </main>
  );
}
