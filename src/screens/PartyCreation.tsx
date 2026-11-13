import { useState } from 'react';
import { PREMADES, premadeToDraft } from '../content';
import { isPartyFull, PARTY_SIZE } from '../engine';
import { useGameStore } from '../state/store';
import { MercBuilder } from './MercBuilder';
import { MercCard } from './MercCard';

type Tab = 'premade' | 'custom';

export function PartyCreation() {
  const game = useGameStore((s) => s.game);
  const dispatch = useGameStore((s) => s.dispatch);
  const backToMenu = useGameStore((s) => s.backToMenu);
  const [tab, setTab] = useState<Tab>('premade');

  const full = isPartyFull(game);
  const hired = new Set(game.party.map((m) => m.premadeId));
  const emptySlots = PARTY_SIZE - game.party.length;

  return (
    <main className="screen wide">
      <header className="screen-header">
        <h1>Create your party</h1>
        <p className="dim">
          Hire {PARTY_SIZE} mercenaries. {game.party.length} of {PARTY_SIZE} chosen.
        </p>
      </header>

      <div className="columns">
        <section className="panel" aria-label="Your party">
          <h2>Your party</h2>
          <div className="card-list">
            {game.party.map((merc) => (
              <MercCard
                key={merc.id}
                merc={merc}
                actions={
                  <button type="button" onClick={() => dispatch({ type: 'removeMerc', mercId: merc.id })}>
                    Remove
                  </button>
                }
              />
            ))}
            {Array.from({ length: emptySlots }, (_, i) => (
              <div key={i} className="merc-card empty dim">
                Empty slot
              </div>
            ))}
          </div>
        </section>

        <section className="panel" aria-label="Available mercenaries">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'premade'}
              className={tab === 'premade' ? 'active' : ''}
              onClick={() => setTab('premade')}
            >
              Ready to hire
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'custom'}
              className={tab === 'custom' ? 'active' : ''}
              onClick={() => setTab('custom')}
            >
              Build your own
            </button>
          </div>

          {tab === 'premade' ? (
            <div className="card-list">
              {PREMADES.map((premade) => {
                const draft = premadeToDraft(premade);
                const inParty = hired.has(premade.id);
                return (
                  <MercCard
                    key={premade.id}
                    merc={draft}
                    actions={
                      <button
                        type="button"
                        disabled={inParty || full}
                        onClick={() => dispatch({ type: 'addMerc', draft })}
                      >
                        {inParty ? 'In your party' : 'Hire'}
                      </button>
                    }
                  />
                );
              })}
            </div>
          ) : (
            <MercBuilder disabled={full} onAdd={(draft) => dispatch({ type: 'addMerc', draft })} />
          )}
        </section>
      </div>

      <footer className="screen-footer">
        <button type="button" onClick={backToMenu}>
          Back to menu
        </button>
        <button type="button" className="primary" disabled={!full} onClick={() => dispatch({ type: 'confirmParty' })}>
          Choose a leader
        </button>
      </footer>
    </main>
  );
}
