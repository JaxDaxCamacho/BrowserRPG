# Allerya Heroes

A party-based dungeon crawler for browser, PC and Android, built once in TypeScript.

## Run it

Requires Node.js 20.19 or newer.

**One click (Windows with WSL):**

- `Play.bat` plays the game from a production build, which loads in about a second. After a code
  change, the first start rebuilds it (about 20 seconds, with a "getting ready" screen).
- `Develop.bat` runs the development server instead, with the content editor and dungeon maker on the
  main menu and changes showing up live. It is slower to load from the Windows drive: reading files
  across the WSL boundary is slow. Keeping the project inside WSL (for example `~/projects`) loads it
  in under a second.

Both open the game in its own window (Edge, or Chrome, in app mode) with the server hidden in WSL, and
stop the server when the window closes. If the server fails to start, a message box says how to see
why. `scripts/play.ps1 -ServerOnly` (add `-Dev` for the development server) starts just the server.

```bash
npm install
npm run dev      # play in the browser
npm test         # rules engine tests
npm run lint
npm run build    # type-check and build to dist/
```

## Art assets

The icon, portrait and animation packs are commercial and are **not** in this repository.
Put the packs in `../assets` (next to this folder) and/or the git-ignored `Assets/` folder inside it
(ability icons, the Fairytale item icons, class and race icons, obstacle containers, `Tokens/`
portraits, and the zipped `Animations/` and `SFX/` packs). Unzip what the game uses, then sync:

```bash
npm run assets:unpack   # Animations/ and SFX/ zips -> Assets/_unpacked (30 FPS sheets, combat and UI sounds)
```

Then run:

```bash
npm run assets:sync
```

This resizes the images (and compresses the sounds) into `asset-library/` (git-ignored), served at
`/asset-library/` by the dev server and the preview, and writes `asset-library/index.json`. Content refers to assets by id, such as
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
