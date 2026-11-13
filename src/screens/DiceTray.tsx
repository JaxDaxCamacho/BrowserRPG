import { useEffect, useState } from 'react';
import type { ShownRoll } from '../engine';
import { useGameStore } from '../state/store';
import { DieFace } from './Dice';

/** How long the dice bounce before landing, and how long the result stays up after. */
const TUMBLE_MS = 900;
const SHOW_MS = 2600;

function TumblingDie({ value, sides, index, settled, dropped }: { value: number; sides: number; index: number; settled: boolean; dropped: boolean }) {
  const [face, setFace] = useState(() => 1 + Math.floor(Math.random() * sides));
  useEffect(() => {
    if (settled) {
      setFace(value);
      return;
    }
    const timer = window.setInterval(() => setFace(1 + Math.floor(Math.random() * sides)), 70);
    return () => window.clearInterval(timer);
  }, [settled, value, sides]);
  return (
    <span
      className={`tray-die${settled ? ' settled' : ' rolling'}${dropped ? ' dropped' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
      aria-hidden="true"
    >
      <DieFace value={face} />
    </span>
  );
}

/**
 * Every roll in the game shows up here: the dice bounce around the corner
 * of the screen, then land on the real value with who rolled and why.
 */
export function DiceTray() {
  const feed = useGameStore((s) => s.game.rollFeed);
  const [shown, setShown] = useState<{ seq: number; rolls: ShownRoll[] } | null>(null);
  const [settled, setSettled] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!feed || feed.seq === shown?.seq) return;
    setShown(feed);
    setSettled(false);
    setVisible(true);
    const land = window.setTimeout(() => setSettled(true), TUMBLE_MS);
    const hide = window.setTimeout(() => setVisible(false), TUMBLE_MS + SHOW_MS);
    return () => {
      window.clearTimeout(land);
      window.clearTimeout(hide);
    };
    // Only a new batch of rolls restarts the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.seq]);

  if (!shown) return null;
  return (
    <aside className={`dice-tray${visible ? ' visible' : ''}`} aria-live="polite" aria-label="Dice rolls">
      {shown.rolls.slice(0, 4).map((r, i) => (
        <div key={`${shown.seq}-${i}`} className={`tray-roll${settled ? (r.good === undefined ? '' : r.good ? ' good' : ' bad') : ''}`}>
          <div className="tray-dice">
            {r.dice.map((d, j) => (
              <TumblingDie
                key={j}
                value={d}
                sides={r.sides}
                index={i * 2 + j}
                settled={settled}
                dropped={r.dice.length > 1 && !(d === r.kept && r.dice.indexOf(r.kept) === j)}
              />
            ))}
          </div>
          <div className="tray-text">
            <span className="tray-who">{r.who}</span>
            <span className="tray-what">
              {r.what}
              {settled && r.total !== undefined && r.target !== undefined && (
                <>
                  {' '}
                  · {r.total} vs {r.target}
                </>
              )}
            </span>
            {settled && r.result && <span className="tray-result">{r.result}</span>}
          </div>
        </div>
      ))}
    </aside>
  );
}
