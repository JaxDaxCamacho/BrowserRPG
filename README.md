# Allerya Heroes

A party-based dungeon crawler for browser, PC and Android, built once in TypeScript.

## Run it

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev      # play in the browser
npm test         # rules engine tests
npm run lint
npm run build    # type-check and build to dist/
```

## Layout

| Folder | Holds |
| --- | --- |
| `src/engine/` | Game rules as pure functions over `GameState`. No UI imports (enforced by lint). |
| `src/state/` | Zustand store that holds `GameState` and forwards actions to the engine. |
| `src/screens/` | React screens. `ScreenRouter` shows the one named by `game.screen`. |
| `src/platform/` | `SaveStore` interface; storage differs per platform, the game does not. |
| `src/content/` | Game data as JSON: classes, races, items, enemies, adventures (from milestone 2). |
| `src/render/` | PixiJS scenes for the dungeon map and combat rows (from milestone 5). |
| `tests/` | Vitest tests for the engine. |
