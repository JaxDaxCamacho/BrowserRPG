import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useGameStore } from './state/store';
import './styles.css';

/**
 * The tools app (tools.html, opened by Tools.bat): the content editor and the
 * dungeon maker, apart from the game. It runs on the development server, which
 * writes edited content back into src/content. Test play runs the game here too.
 */

const TOOLS = [
  {
    id: 'contentEditor' as const,
    name: 'Content Editor',
    what: 'Gear, abilities, monsters, classes, races, pre-built mercs, portraits and obstacle types.',
  },
  {
    id: 'dungeonMaker' as const,
    name: 'Dungeon Maker',
    what: 'Maps, rooms, traps, events, goals and enemy groups, with the obstacles on each battlefield. Test play from here.',
  },
];

function ToolsHub() {
  const openTool = useGameStore((s) => s.openTool);
  return (
    <main className="screen menu tools-hub">
      <h1 className="menu-title">Allerya Heroes Tools</h1>
      <p className="menu-tagline">Make and edit the game's content. Saving writes straight into the project.</p>
      <nav className="tools-list">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className="tool-card" onClick={() => openTool(t.id)}>
            <strong>{t.name}</strong>
            <span className="dim">{t.what}</span>
          </button>
        ))}
      </nav>
      {!import.meta.env.DEV && <p className="error">The tools only work on the development server: open them with Tools.bat.</p>}
    </main>
  );
}

function ToolsApp() {
  const tool = useGameStore((s) => s.tool);
  const testPlay = useGameStore((s) => s.testPlay);
  // An open tool, or a test play of a dungeon, shows through the game's own app; otherwise the hub.
  return tool || testPlay ? <App /> : <ToolsHub />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in tools.html');
createRoot(root).render(
  <StrictMode>
    <ToolsApp />
  </StrictMode>,
);
