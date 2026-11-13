import { lazy, Suspense } from 'react';
import { ScreenRouter } from './screens/ScreenRouter';
import { useGameStore } from './state/store';

// The editors only exist in development builds.
const ContentEditor = import.meta.env.DEV ? lazy(() => import('./editor/ContentEditor')) : null;
const DungeonMaker = import.meta.env.DEV ? lazy(() => import('./editor/DungeonMaker')) : null;

export function App() {
  const tool = useGameStore((s) => s.tool);
  const Editor = tool === 'contentEditor' ? ContentEditor : tool === 'dungeonMaker' ? DungeonMaker : null;
  if (Editor) {
    return (
      <Suspense fallback={<main className="screen">Loading the editor…</main>}>
        <Editor />
      </Suspense>
    );
  }
  return <ScreenRouter />;
}
