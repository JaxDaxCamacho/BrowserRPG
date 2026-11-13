import { lazy, Suspense } from 'react';
import { ScreenRouter } from './screens/ScreenRouter';
import { useGameStore } from './state/store';

// The editor only exists in development builds.
const ContentEditor = import.meta.env.DEV ? lazy(() => import('./editor/ContentEditor')) : null;

export function App() {
  const tool = useGameStore((s) => s.tool);
  if (tool === 'contentEditor' && ContentEditor) {
    return (
      <Suspense fallback={<main className="screen">Loading the editor…</main>}>
        <ContentEditor />
      </Suspense>
    );
  }
  return <ScreenRouter />;
}
