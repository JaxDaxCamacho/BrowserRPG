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

## Windows installer (Tauri)

`Build-Installer.bat` makes an installer friends can run: a normal Windows app (Start menu entry,
its own window) using the WebView2 runtime built into Windows 10 and 11, with all the art and sound
inside. It needs, on Windows:

1. Rust, from https://rustup.rs (default options).
2. The Visual Studio Build Tools with the "Desktop development with C++" workload:
   https://visualstudio.microsoft.com/visual-cpp-build-tools/

Then double-click `Build-Installer.bat`. The first run installs the Tauri tools and compiles for
several minutes; later runs are quicker. The game is built inside WSL (`npm run build:app`, which also
copies the asset library in), and the installer lands in `src-tauri\target\release\bundle\nsis\`.
It installs for the current user, so no administrator rights are needed to install. The installer
contains the commercial art packs, so share it only with people you are allowed to.
`npm run icons` remakes the app icons from the d20 art.

## Online co-op

Up to four players: one hosts, three join. The host opens a game and chooses **Host co-op** (on
adventure select or the dungeon bar) to get a five-letter join code. The others choose **Join a co-op
game** on the main menu, type the code and pick a merc to play; the host plays every merc nobody else
does, and takes a merc back if its player drops out (rejoining from the same browser gets it back).

- The host's game is the only one that changes the state and rolls dice. The others send what they do
  as commands (`src/state/commands.ts`), which the host checks: you can only act on your own merc's
  turn, change your own merc's gear and talents, and move a group your merc is in.
- Everyone sees the same screen; while the party is split, that is whichever fight or group has the turn.
- Conversations are decided by vote among the players whose mercs are present; the leader's player
  breaks ties.
- Browsers connect directly (WebRTC through PeerJS). PeerJS's free public server only introduces them,
  so it sees the join code but never the game. Only the host's game is saved.

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
