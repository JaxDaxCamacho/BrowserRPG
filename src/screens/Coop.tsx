import { useEffect, useState } from 'react';
import { HOST_ID } from '../net/protocol';
import { useControl } from '../state/net';
import { useGameStore } from '../state/store';
import { Token } from './MercCard';

/**
 * Online co-op screens: joining from the main menu, the co-op window (join
 * code, players, who plays which merc), the waiting room for joined players,
 * and the badge and notices shown during play.
 */

function lastName(): string {
  try {
    return localStorage.getItem('allerya.playerName') ?? '';
  } catch {
    return '';
  }
}

function rememberName(name: string) {
  try {
    localStorage.setItem('allerya.playerName', name);
  } catch {
    // Not remembering the name is fine.
  }
}

/** Main menu: join someone else's game with their code. */
export function JoinPanel({ onBack }: { onBack: () => void }) {
  const joinOnline = useGameStore((s) => s.joinOnline);
  const [name, setName] = useState(lastName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    rememberName(name.trim());
    try {
      await joinOnline(code, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen menu">
      <h1 className="menu-title">Join a game</h1>
      <p className="menu-tagline">Ask the host for their join code.</p>
      <form
        className="join-form panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && code.trim().length >= 4) void join();
        }}
      >
        <label className="form-field">
          <span>Your name</span>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Player" />
        </label>
        <label className="form-field">
          <span>Join code</span>
          <input
            className="join-code-input"
            value={code}
            maxLength={8}
            autoFocus
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="ABC12"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" className="primary" disabled={busy || code.trim().length < 4}>
            {busy ? 'Connecting…' : 'Join'}
          </button>
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </form>
    </main>
  );
}

/** Who plays which merc, the join code, and the players. Hosting starts here. */
export function CoopWindow({ onClose }: { onClose: () => void }) {
  const net = useGameStore((s) => s.net);
  const game = useGameStore((s) => s.game);
  const hostOnline = useGameStore((s) => s.hostOnline);
  const leaveOnline = useGameStore((s) => s.leaveOnline);
  const claimMerc = useGameStore((s) => s.claimMerc);
  const assignSeat = useGameStore((s) => s.assignSeat);
  const { playerOf } = useControl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const host = async () => {
    setBusy(true);
    setError(null);
    try {
      await hostOnline();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const living = game.party.filter((m) => !m.dead);
  const others = net?.session.players.filter((p) => p.id !== HOST_ID) ?? [];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Co-op" onClick={onClose}>
      <div className="modal coop-window" onClick={(e) => e.stopPropagation()}>
        <h2>Co-op</h2>
        {!net ? (
          <>
            <p>
              Host this game for up to three friends. They choose <strong>Join a game</strong> on their main menu and type the code you get. Each
              of them plays one merc; you play the rest.
            </p>
            <p className="dim note">Players connect directly to you. A free public matchmaking service only introduces the browsers to each other.</p>
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button type="button" className="primary" disabled={busy} onClick={() => void host()}>
                {busy ? 'Opening…' : 'Host a co-op game'}
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="join-code-line">
              Join code: <strong className="join-code">{net.session.code}</strong>
              {net.role === 'host' && (
                <button type="button" className="link-button" onClick={() => void navigator.clipboard?.writeText(net.session.code)}>
                  Copy
                </button>
              )}
            </p>
            <h3>Players</h3>
            <ul className="coop-players">
              <li>
                <strong>Host</strong>
                {net.role === 'host' && <span className="dim"> · you</span>}
              </li>
              {others.map((p) => (
                <li key={p.id} className={p.connected ? '' : 'away'}>
                  <strong>{p.name}</strong>
                  {p.id === net.myId && <span className="dim"> · you</span>}
                  {!p.connected && <span className="dim"> · disconnected</span>}
                </li>
              ))}
              {others.length === 0 && <li className="dim">Nobody has joined yet.</li>}
            </ul>
            <h3>Who plays which merc</h3>
            <ul className="coop-seats">
              {living.map((m) => {
                const seat = net.session.seats[m.id];
                const who = playerOf(m.id) ?? 'the host';
                return (
                  <li key={m.id} className="row">
                    <Token name={m.name} portrait={m.portrait} size={32} />
                    <span className="coop-seat-name">{m.name}</span>
                    {net.role === 'host' ? (
                      <select value={seat ?? ''} onChange={(e) => assignSeat(m.id, e.target.value || null)} aria-label={`Who plays ${m.name}`}>
                        <option value="">Host</option>
                        {others.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.connected ? '' : ' (away)'}
                          </option>
                        ))}
                      </select>
                    ) : seat === net.myId ? (
                      <>
                        <span className="dim">you</span>
                        <button type="button" onClick={() => claimMerc(null)}>
                          Let go
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="dim">{who}</span>
                        {who === 'the host' && (
                          <button type="button" className="primary" onClick={() => claimMerc(m.id)}>
                            Play this merc
                          </button>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
              {living.length === 0 && <li className="dim">The host has not built a party yet.</li>}
            </ul>
            <div className="row">
              <button type="button" className="danger" onClick={() => leaveOnline()}>
                {net.role === 'host' ? 'Stop hosting' : 'Leave the game'}
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** For joined players while the host is still setting up: the party, and a merc to claim. */
export function WaitingRoom() {
  const net = useGameStore((s) => s.net);
  const game = useGameStore((s) => s.game);
  const [open, setOpen] = useState(false);
  const { controls } = useControl();
  if (!net) return null;
  const mine = game.party.filter((m) => controls(m.id)).map((m) => m.name);
  return (
    <main className="screen">
      <header className="screen-header">
        <h1>Waiting for the host</h1>
        <p className="dim">Connected to game {net.session.code}. The host is getting the party ready and picking an adventure.</p>
      </header>
      <p>{mine.length > 0 ? `You play ${mine.join(' and ')}.` : 'Pick a merc to play: open the co-op window.'}</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          Choose your merc
        </button>
      </div>
      {open && <CoopWindow onClose={() => setOpen(false)} />}
    </main>
  );
}

/** A small corner badge while online, opening the co-op window; and notices for refused actions or lost connections. */
export function CoopBadge() {
  const net = useGameStore((s) => s.net);
  const notice = useGameStore((s) => s.netNotice);
  const clear = useGameStore((s) => s.clearNetNotice);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clear, 5000);
    return () => window.clearTimeout(timer);
  }, [notice, clear]);

  const connected = net ? net.session.players.filter((p) => p.connected).length : 0;
  return (
    <>
      {net && (
        <button type="button" className="coop-badge" onClick={() => setOpen(true)} title="Co-op: players and who plays which merc">
          Co-op · {net.session.code} · {connected} player{connected === 1 ? '' : 's'}
        </button>
      )}
      {notice && (
        <div className="coop-notice" role="status" onClick={clear}>
          {notice}
        </div>
      )}
      {open && <CoopWindow onClose={() => setOpen(false)} />}
    </>
  );
}
