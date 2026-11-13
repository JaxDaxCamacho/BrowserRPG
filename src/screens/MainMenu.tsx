import { useGameStore } from '../state/store';

export function MainMenu() {
  const newGame = useGameStore((s) => s.newGame);

  return (
    <main className="screen menu">
      <h1 className="menu-title">Allerya Heroes</h1>
      <p className="menu-tagline">Lead your mercenaries into the dark.</p>
      <nav className="menu-buttons">
        <button type="button" onClick={newGame}>
          New Game
        </button>
        {/* Enabled once save slots exist (milestone 3). */}
        <button type="button" disabled title="No saved game yet">
          Continue
        </button>
      </nav>
    </main>
  );
}
