import { useEffect, useState } from 'react';
import { getLeader, type GameState } from '../engine';
import { SAVE_SLOTS, type SaveRecord } from '../platform/saveStore';
import { useGameStore } from '../state/store';

type View = 'main' | 'newGame' | 'continue';

const SCREEN_LABELS: Record<GameState['screen'], string> = {
  menu: 'Main menu',
  partyCreation: 'Creating the party',
  leaderSelect: 'Choosing a leader',
  adventureSelect: 'Picking an adventure',
  dialogue: 'In conversation',
  dungeon: 'Exploring',
  combat: 'In combat',
};

function describeSave(record: SaveRecord): string {
  const { state } = record;
  const leader = getLeader(state);
  const who = leader ? `${leader.name}'s company` : `${state.party.length} of 4 mercenaries`;
  return `${who} · ${SCREEN_LABELS[state.screen]} · ${new Date(record.savedAt).toLocaleString()}`;
}

export function MainMenu() {
  const saves = useGameStore((s) => s.saves);
  const savesLoaded = useGameStore((s) => s.savesLoaded);
  const saveError = useGameStore((s) => s.saveError);
  const refreshSaves = useGameStore((s) => s.refreshSaves);
  const newGame = useGameStore((s) => s.newGame);
  const continueGame = useGameStore((s) => s.continueGame);

  const [view, setView] = useState<View>('main');
  /** The used slot the player has asked to overwrite, awaiting a yes or no. */
  const [overwriting, setOverwriting] = useState<string | null>(null);

  useEffect(() => {
    void refreshSaves();
  }, [refreshSaves]);

  const saveIn = (slotId: string) => saves.find((s) => s.slotId === slotId);

  if (view === 'main') {
    return (
      <main className="screen menu">
        <h1 className="menu-title">Allerya Heroes</h1>
        <p className="menu-tagline">Lead your mercenaries into the dark.</p>
        <nav className="menu-buttons">
          <button type="button" onClick={() => setView('newGame')}>
            New Game
          </button>
          <button
            type="button"
            disabled={saves.length === 0}
            title={saves.length === 0 ? 'No saved game yet' : undefined}
            onClick={() => setView('continue')}
          >
            Continue
          </button>
        </nav>
        {saveError && <p className="error">{saveError}</p>}
      </main>
    );
  }

  const isNew = view === 'newGame';
  return (
    <main className="screen menu">
      <h1>{isNew ? 'New Game' : 'Continue'}</h1>
      <p className="menu-tagline">{isNew ? 'Choose a slot for your new company.' : 'Choose a company to lead.'}</p>
      {!savesLoaded && <p className="menu-tagline">Reading saved games…</p>}
      <ul className="slot-list">
        {SAVE_SLOTS.map((slotId, index) => {
          const record = saveIn(slotId);
          const label = `Slot ${index + 1}`;

          if (isNew && record && overwriting === slotId) {
            return (
              <li key={slotId} className="slot slot-confirm">
                <span>Replace the game in {label}? This cannot be undone.</span>
                <span className="row">
                  <button type="button" className="danger" onClick={() => newGame(slotId)}>
                    Replace
                  </button>
                  <button type="button" onClick={() => setOverwriting(null)}>
                    Keep it
                  </button>
                </span>
              </li>
            );
          }

          return (
            <li key={slotId}>
              <button
                type="button"
                className="slot"
                disabled={!isNew && !record}
                onClick={() => {
                  if (!isNew) continueGame(slotId);
                  else if (record) setOverwriting(slotId);
                  else newGame(slotId);
                }}
              >
                <strong>{label}</strong>
                <span>{record ? describeSave(record) : 'Empty'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <nav className="menu-buttons">
        <button
          type="button"
          onClick={() => {
            setOverwriting(null);
            setView('main');
          }}
        >
          Back
        </button>
      </nav>
    </main>
  );
}
