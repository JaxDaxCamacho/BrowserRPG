import { useState } from 'react';
import { PREMADES, premadeToDraft } from '../content';
import { isPartyFull, PARTY_SIZE } from '../engine';
import { useControl } from '../state/net';
import { useGameStore } from '../state/store';
import { CoopWindow } from './Coop';
import { MercBuilder } from './MercBuilder';
import { MercCard } from './MercCard';

type Tab = 'premade' | 'custom';

export function PartyCreation() {
  const game = useGameStore((s) => s.game);
  const dispatch = useGameStore((s) => s.dispatch);
  const backToMenu = useGameStore((s) => s.backToMenu);
  const net = useGameStore((s) => s.net);
  const { isClient, controls, playerOf } = useControl();
  const [tab, setTab] = useState<Tab>('premade');
  const [coop, setCoop] = useState(false);

  const full = isPartyFull(game);
  // A joined player brings one merc of their own; the host fills the rest.
  const mine = game.party.find((m) => controls(m.id) && isClient);
  const canAdd = !full && !(isClient && mine);
  const hired = new Set(game.party.map((m) => m.premadeId));
  const emptySlots = PARTY_SIZE - game.party.length;

  return (
    <main className="screen wide">
      <header className="screen-header">
        <h1>{isClient ? 'Create your merc' : 'Create your party'}</h1>
        <p className="dim">
          {isClient
            ? mine
              ? `You play ${mine.name}. The host fills the rest of the party and picks the adventure.`
              : 'Hire one of the ready mercenaries or build your own. That merc is yours to play.'
            : `Hire ${PARTY_SIZE} mercenaries. ${game.party.length} of ${PARTY_SIZE} chosen.`}
        </p>
        {net?.role === 'host' && (
          <p className="coop-banner">
            Co-op: friends join with the code <strong className="join-code">{net.session.code}</strong> and each brings their own merc.{' '}
            {net.session.players.filter((p) => p.connected).length - 1} joined.{' '}
            <button type="button" className="link-button" onClick={() => setCoop(true)}>
              Players
            </button>
          </p>
        )}
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
                  controls(merc.id) ? (
                    <button type="button" onClick={() => dispatch({ type: 'removeMerc', mercId: merc.id })}>
                      Remove
                    </button>
                  ) : (
                    <span className="dim">chosen by {playerOf(merc.id) ?? 'another player'}</span>
                  )
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
                        disabled={inParty || !canAdd}
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
            <MercBuilder disabled={!canAdd} onAdd={(draft) => dispatch({ type: 'addMerc', draft })} />
          )}
        </section>
      </div>

      <footer className="screen-footer">
        <button type="button" onClick={backToMenu}>
          {isClient ? 'Leave the game' : 'Back to menu'}
        </button>
        {!isClient && (
          <button type="button" className="primary" disabled={!full} onClick={() => dispatch({ type: 'confirmParty' })}>
            Choose a leader
          </button>
        )}
      </footer>
      {coop && <CoopWindow onClose={() => setCoop(false)} />}
    </main>
  );
}
