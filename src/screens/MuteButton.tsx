import { useMuted } from './sound';

/** Turns the game's sound effects on and off; the choice is remembered. */
export function MuteButton() {
  const [muted, setMuted] = useMuted();
  return (
    <button type="button" className="mute-button" aria-pressed={muted} title={muted ? 'Sound off: click to turn it on' : 'Sound on: click to mute'} onClick={() => setMuted(!muted)}>
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
