import { getDungeon, getMonster } from '../content';
import { combatRowsAt, featureById, resolveEncounter } from '../engine';
import { useGameStore } from '../state/store';
import { AssetImage } from './assets';
import { initials } from './MercCard';

/**
 * Stand-in for the combat screen (milestone 7): shows who the party is facing
 * and lets the player win or retreat so the map can be explored end to end.
 */
export function EncounterPlaceholder() {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);
  const { encounter, dungeon } = game;
  if (!encounter || !dungeon) return null;

  const def = getDungeon(dungeon.dungeonId);
  const feature = featureById(def, encounter.featureId);
  if (feature.type !== 'encounter') return null;
  const rows = combatRowsAt(def, feature);

  return (
    <main className="screen wide encounter">
      <header className="screen-header">
        <h1>{feature.name}</h1>
        <p className="dim">
          A fight across {rows} rows. The real combat screen arrives in milestone 7; for now, choose how it ends.
        </p>
      </header>
      <div className="card-list encounter-foes">
        {feature.monsters.map(({ monsterId, count }) => {
          const m = getMonster(monsterId);
          return (
            <div key={monsterId} className="merc-card">
              <span className="merc-head">
                <AssetImage id={m.portrait} fallback={initials(m.name)} className="token foe-token" size={52} />
                <span className="merc-title">
                  <strong>
                    {m.name} {count > 1 && <span className="dim">×{count}</span>}
                  </strong>
                  <span className="dim">
                    {m.archetype} · level {m.level} · {m.hp} HP · Defense {m.defense} · {m.attack.name}
                  </span>
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <footer className="screen-footer">
        <button type="button" onClick={() => apply((g) => resolveEncounter(g, 'retreat'))}>
          Retreat
        </button>
        <button type="button" className="primary" onClick={() => apply((g) => resolveEncounter(g, 'victory'))}>
          Win the fight (placeholder)
        </button>
      </footer>
    </main>
  );
}
