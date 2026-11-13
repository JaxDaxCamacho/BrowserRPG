import type { Screen } from '../engine';
import { useGameStore } from '../state/store';

interface Props {
  title: string;
  milestone: number;
  /** The next screen in the game flow, for walking the skeleton end to end. */
  next?: Screen;
}

/** Stand-in for a screen that a later milestone builds. */
export function PlaceholderScreen({ title, milestone, next }: Props) {
  const goTo = useGameStore((s) => s.goTo);
  const backToMenu = useGameStore((s) => s.backToMenu);

  return (
    <main className="screen placeholder">
      <h1>{title}</h1>
      <p>Built in milestone {milestone}.</p>
      <nav className="menu-buttons">
        {next && (
          <button type="button" onClick={() => goTo(next)}>
            Next screen
          </button>
        )}
        <button type="button" onClick={backToMenu}>
          Back to menu
        </button>
      </nav>
    </main>
  );
}
