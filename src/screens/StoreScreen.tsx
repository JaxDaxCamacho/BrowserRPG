import { useState } from 'react';
import { getDungeon, getItem } from '../content';
import { sellPrice, type ItemDefinition } from '../engine';
import { useControl } from '../state/net';
import { ALWAYS_IN_STOCK } from '../state/storeStock';
import { useGameStore } from '../state/store';
import { Coins } from './Coins';
import { AssetImage } from './assets';
import { describeItem } from './MercBuilder';
import { Token } from './MercCard';
import { PartyWindow } from './PartyWindow';

/** What one purchase costs: ammunition comes in bundles of 20. */
function buyPrice(item: ItemDefinition): { price: number; label: string } {
  return item.kind === 'ammo' ? { price: item.value * 20, label: '20 for' } : { price: item.value, label: '' };
}

/**
 * The quartermaster's store, between taking a job and going into each
 * dungeon. Each merc trades with their own purse; in co-op, each player trades
 * for the mercs they play. The host leads the party out.
 */
export function StoreScreen() {
  const game = useGameStore((s) => s.game);
  const dispatch = useGameStore((s) => s.dispatch);
  const { isHost, controls, playerOf } = useControl();
  const yours = game.party.filter((m) => !m.dead && controls(m.id));
  const [mercId, setMercId] = useState<string | null>(yours[0]?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [party, setParty] = useState(false);

  const store = game.store;
  if (!store) return <main className="screen">The store is closed.</main>;
  const dungeon = getDungeon(store.dungeonId);
  const merc = game.party.find((m) => m.id === mercId && controls(m.id)) ?? yours[0];

  const tryDispatch = (cmd: Parameters<typeof dispatch>[0]) => {
    try {
      dispatch(cmd);
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const supplies = store.stock.filter((s) => ALWAYS_IN_STOCK.includes(s.itemId));
  const gear = store.stock.filter((s) => !ALWAYS_IN_STOCK.includes(s.itemId));

  const shelf = (entries: typeof store.stock) => (
    <ul className="store-shelf">
      {entries.map((entry) => {
        const item = getItem(entry.itemId);
        const { price, label } = buyPrice(item);
        const soldOut = entry.quantity === 0;
        const tooDear = !merc || merc.purse < price;
        return (
          <li key={entry.itemId} className={`store-item${soldOut ? ' sold-out' : ''}`}>
            <AssetImage id={item.icon} fallback={item.name.slice(0, 2)} size={44} className="store-icon" />
            <span className="store-text">
              <strong>{item.name}</strong>
              {entry.quantity !== null && <span className="dim"> · {soldOut ? 'sold out' : 'one in stock'}</span>}
              <span className="dim store-desc">{item.description ?? describeItem(item)}</span>
            </span>
            <span className="store-buy">
              <span className="store-price">
                {label && <span className="dim">{label} </span>}
                <Coins copper={price} />
              </span>
              <button
                type="button"
                className="primary"
                disabled={!merc || soldOut || tooDear}
                title={!merc ? 'You have no merc to buy for' : tooDear ? `${merc.name} cannot afford it` : undefined}
                onClick={() => merc && tryDispatch({ type: 'buy', mercId: merc.id, itemId: entry.itemId })}
              >
                Buy
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <main className="screen wide store-screen">
      <header className="screen-header">
        <h1>The Quartermaster</h1>
        <p className="dim">Stock up before setting out for {dungeon.name}. Each merc pays from their own purse; the store buys back at half price.</p>
      </header>

      <div className="store-columns">
        <section className="panel" aria-label="Who is buying">
          <h2>Buying for</h2>
          <ul className="store-mercs">
            {game.party
              .filter((m) => !m.dead)
              .map((m) => {
                const mine = controls(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`store-merc${merc?.id === m.id ? ' active' : ''}`}
                      disabled={!mine}
                      title={mine ? undefined : `Played by ${playerOf(m.id) ?? 'another player'}`}
                      onClick={() => setMercId(m.id)}
                    >
                      <Token name={m.name} portrait={m.portrait} size={36} />
                      <span>
                        <strong>{m.name}</strong>
                        <br />
                        <span className="dim">{mine ? <Coins copper={m.purse} /> : `played by ${playerOf(m.id) ?? 'another player'}`}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>

        <section className="panel" aria-label="For sale">
          <h2>Supplies</h2>
          {shelf(supplies)}
          <h2>Today's wares</h2>
          {shelf(gear)}
        </section>

        <section className="panel" aria-label="Sell">
          <h2>{merc ? `${merc.name}'s pack` : 'Your pack'}</h2>
          {merc ? (
            <>
              <p className="dim note">Purse: <Coins copper={merc.purse} />. Equipped gear is not for sale; take it off first in Party &amp; gear.</p>
              {merc.inventory.length === 0 ? (
                <p className="dim">The pack is empty.</p>
              ) : (
                <ul className="store-shelf">
                  {merc.inventory.map((stack, index) => {
                    const item = getItem(stack.itemId);
                    const count = item.kind === 'ammo' ? stack.quantity : 1;
                    return (
                      <li key={`${stack.itemId}-${index}`} className="store-item">
                        <AssetImage id={item.icon} fallback={item.name.slice(0, 2)} size={36} className="store-icon" />
                        <span className="store-text">
                          <strong>{item.name}</strong>
                          {stack.quantity > 1 && <span className="dim"> ×{stack.quantity}</span>}
                        </span>
                        <span className="store-buy">
                          <span className="store-price"><Coins copper={sellPrice(item.value) * count} /></span>
                          <button type="button" onClick={() => tryDispatch({ type: 'sell', mercId: merc.id, index })}>
                            Sell{count > 1 ? ' all' : ''}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <p className="dim">You have no merc in this party.</p>
          )}
        </section>
      </div>
      {message && <p className="error">{message}</p>}

      <footer className="screen-footer">
        <button type="button" onClick={() => setParty(true)}>
          Party &amp; gear
        </button>
        {isHost ? (
          <button type="button" className="primary" onClick={() => tryDispatch({ type: 'setOut' })}>
            Set out for {dungeon.name}
          </button>
        ) : (
          <span className="dim">The host leads the party out when everyone is ready.</span>
        )}
      </footer>
      {party && <PartyWindow initialMercId={merc?.id} onClose={() => setParty(false)} />}
    </main>
  );
}
