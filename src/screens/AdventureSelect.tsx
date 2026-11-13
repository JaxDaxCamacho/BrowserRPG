import { useState } from 'react';
import { ADVENTURES, getDialogue } from '../content';
import { formatCoins, goToScreen, isAdventureComplete, startAdventure } from '../engine';
import { useGameStore } from '../state/store';
import { mercsWithPoints, TrainingDialog } from './TrainingPanel';

export function AdventureSelect() {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);
  const testPlay = useGameStore((s) => s.testPlay);
  const backToMenu = useGameStore((s) => s.backToMenu);
  const [training, setTraining] = useState(false);
  const ready = mercsWithPoints(game.party);

  const open = ADVENTURES.filter((a) => !isAdventureComplete(game, a.id));
  const done = ADVENTURES.filter((a) => isAdventureComplete(game, a.id));
  const purse = game.party.filter((m) => !m.dead).reduce((n, m) => n + m.purse, 0);

  return (
    <main className="screen wide">
      <header className="screen-header">
        <h1>Pick an adventure</h1>
        <p className="dim">
          {done.length === 0 ? 'Word of paying work reaches your company.' : `Contracts completed: ${done.length}.`} The company
          holds {formatCoins(purse)}.
        </p>
      </header>

      <div className="card-list adventure-list">
        {open.map((adventure) => (
          <article key={adventure.id} className="panel">
            <h2>{adventure.title}</h2>
            <p className="dim adventure-difficulty">Difficulty: {adventure.difficulty}</p>
            <p className="adventure-summary">{adventure.summary}</p>
            <button
              type="button"
              className="primary"
              onClick={() => apply((g) => startAdventure(g, adventure.id, getDialogue(adventure.id, adventure.debrief)))}
            >
              Take the job
            </button>
          </article>
        ))}
        {open.length === 0 && (
          <article className="panel">
            <h2>No work for now</h2>
            <p className="adventure-summary">
              Your company has finished every contract on offer. New work will reach you in a later update.
            </p>
          </article>
        )}
        {done.map((adventure) => (
          <article key={adventure.id} className="panel adventure-done">
            <h2>{adventure.title}</h2>
            <p className="dim adventure-difficulty">Completed</p>
            <p className="adventure-summary">{adventure.summary}</p>
          </article>
        ))}
      </div>

      <footer className="screen-footer">
        <button type="button" className={ready.length > 0 ? 'primary' : ''} onClick={() => setTraining(true)}>
          Train{ready.length > 0 && ` (${ready.length} ready)`}
        </button>
        {testPlay ? (
          <button type="button" className="primary" onClick={backToMenu}>
            Back to the dungeon maker
          </button>
        ) : (
          <button type="button" onClick={() => apply((g) => goToScreen(g, 'leaderSelect'))}>
            Back to leader
          </button>
        )}
      </footer>
      {training && <TrainingDialog onClose={() => setTraining(false)} />}
    </main>
  );
}
