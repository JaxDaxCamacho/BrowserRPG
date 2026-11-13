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

## Art assets

The icon, portrait and animation packs are commercial and are **not** in this repository.
Put the packs in `../assets` (next to this folder) and run:

```bash
npm run assets:sync
```

This resizes about 3,200 images into `public/asset-library/` (git-ignored) and writes
`public/asset-library/index.json`. Content refers to assets by id, such as
`weapons/swords/sv-t-01`; anything missing shows a placeholder, so the game still runs
without the packs. Use `ASSETS_DIR=...` if the packs live somewhere else.

## Content editor

Run `npm run dev` and choose **Content Editor** on the main menu (development builds only).
It edits gear, abilities, monsters, classes, races and pre-built mercs, validates them
against the same rules the game uses, and writes the JSON files in `src/content/`.

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
