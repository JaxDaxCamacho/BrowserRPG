import { ADVENTURES, getDialogue } from '../content';
import { goToScreen, startAdventure } from '../engine';
import { useGameStore } from '../state/store';

export function AdventureSelect() {
  const apply = useGameStore((s) => s.apply);

  return (
    <main className="screen wide">
      <header className="screen-header">
        <h1>Pick an adventure</h1>
        <p className="dim">Word of paying work reaches your company.</p>
      </header>

      <div className="card-list adventure-list">
        {ADVENTURES.map((adventure) => (
          <article key={adventure.id} className="panel">
            <h2>{adventure.title}</h2>
            <p className="dim adventure-difficulty">Difficulty: {adventure.difficulty}</p>
            <p className="adventure-summary">{adventure.summary}</p>
            <button
              type="button"
              className="primary"
              onClick={() =>
                apply((g) => startAdventure(g, adventure.id, getDialogue(adventure.id, adventure.debrief)))
              }
            >
              Take the job
            </button>
          </article>
        ))}
      </div>

      <footer className="screen-footer">
        <button type="button" onClick={() => apply((g) => goToScreen(g, 'leaderSelect'))}>
          Back to leader
        </button>
      </footer>
    </main>
  );
}
