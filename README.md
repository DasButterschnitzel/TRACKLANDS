# TRACKLANDS

A cozy railway empire builder set in a living low-poly miniature world. Build railways, connect settlements, move cargo through production chains and watch hamlets grow into glowing metropolises.

## Play

The game is a static web app (ES modules, no build step). Serve the folder with any static web server and open `index.html`:

```sh
npx http-server -p 8080 .
# then open http://localhost:8080
```

It is installable as a PWA and works offline after the first load. Requires a WebGL2 browser (current Chrome, Edge, Firefox, Android Chrome).

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Select | Click | Tap |
| Pan | Middle/right drag, drag in Select mode, WASD / arrows | Drag (Select mode) or two-finger drag |
| Zoom | Mouse wheel, `+` / `-` | Pinch |
| Rotate view | `Q` / `E` | — |
| Build track | Track tool, drag from tile to tile, release to build | Same |
| Tools | `1`–`7` | Bottom bar |
| Pause | `Space` | Speed buttons |
| Undo (10 s) | `Ctrl+Z` | Undo button |
| Heatmap | `H` | Heatmap button |
| Debug overlay | `F3` or `` ` `` | — |

## Project layout

```
index.html, styles/main.css, manifest.json, service-worker.js, icons/
vendor/three/            three.js r186 (MIT) — bundled locally
src/main.js              bootstrap, title screen, settings, save flows
src/Game.js              orchestrator: simulation loop, events, offline progress
src/config.js            all balancing data (costs, cargo, trains, research, regions…)
src/i18n.js              English + German strings
src/world/               world generation, terrain view, towns, industries, environment, decorations
src/rail/                network graph + routing, rendering, stations/depots, construction tools
src/trains/              train simulation (movement, reservations, AI) and procedural models
src/economy/             coins, revenue, contracts, events, daily challenges
src/progression/         levels, research, regions, objectives, achievements, legacy, stats
src/ui/                  HUD, panels, inspector, tutorial, icons
src/audio/               synthesized sound effects, ambience and generative music
src/vfx/                 pooled particles
src/save/                IndexedDB/localStorage persistence, versioning, export/import
src/services/            MonetizationService abstraction (development mode only)
src/title/               title screen diorama
tools/make-icons.mjs     renders icons/icon.svg to PNG app icons (Playwright)
```

Set `CREATOR_NAME` in `src/config.js` to credit the creator in the Credits panel.

All models, textures, icons, sound and music are generated procedurally at runtime.
