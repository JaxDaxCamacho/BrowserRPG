import { confirmLeader, goToScreen, setLeader } from '../engine';
import { useGameStore } from '../state/store';
import { MercCard } from './MercCard';

export function LeaderSelect() {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);

  return (
    <main className="screen wide">
      <header className="screen-header">
        <h1>Choose your leader</h1>
        <p className="dim">The leader speaks for the party and marks its place on the map.</p>
      </header>

      <div className="card-list leader-list">
        {game.party.map((merc) => (
          <MercCard
            key={merc.id}
            merc={merc}
            selected={merc.id === game.leaderId}
            badge={merc.id === game.leaderId ? 'Leader' : undefined}
            onSelect={() => apply((g) => setLeader(g, merc.id))}
          />
        ))}
      </div>

      <footer className="screen-footer">
        <button type="button" onClick={() => apply((g) => goToScreen(g, 'partyCreation'))}>
          Back to party
        </button>
        <button type="button" className="primary" disabled={!game.leaderId} onClick={() => apply(confirmLeader)}>
          Confirm leader
        </button>
      </footer>
    </main>
  );
}
