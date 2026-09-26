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
| Tools | `1`–`9` (8 signals, 9 waypoint) | Bottom bar |
| Trains list | `T` | Menu rail |
| Overlays | `O` | Layers button |
| Pause | `Space` | Speed buttons |
| Undo (10 s) | `Ctrl+Z` | Undo button |
| Traffic overlay | `H` | Layers button |
| Debug overlay | `F3` or `` ` `` | — |

## Railway operations (v2)

- **Consists:** every train is an ordered list of vehicles (front → rear) with real lengths and masses. Use the **Train Builder** to add, remove, reorder or turn vehicles, change or double up locomotives, and save consists as templates. **AUTO BUILD** picks wagons for the cargo you choose.
- **Wagons:** 19 classes with their own look and visible loads. Cargo↔wagon compatibility is data-driven (`WAGONS` in `src/config.js`). Stations and industries show which wagons carry their cargo.
- **Power/weight:** trains are rated Excellent, Good, Heavy or Overloaded. The rating affects acceleration, gradients and top speed.
- **Reversing:** push-pull trains and diesel/electric units reverse directly. Other engines run around the train, and steam engines turn on the turntable. Trains never flip in place.
- **Signalling:** the railway signals itself.
  - Trains reserve track ahead in blocks and release it behind their rear.
  - Paths through junctions are reserved and locked, with animated switches.
  - Single-track sections are locked by direction.
  - Manual block, path and one-way signals fine-tune busy lines.
- **Track:** double track by default. Single track is cheaper: add double-track sections as passing loops. Waypoints let manual routes take a chosen line.
- **Stations:**
  - Platform tracks with length, roles, occupancy and a dispatcher that picks free, fitting platforms.
  - Add tracks (switch ladders are built automatically) and extend platforms. Long trains on short platforms still load, just more slowly.
  - Station levels 1–6, freight facilities, statistics and a bottleneck advisor.
- **Schedules:** manual routes support per-stop options: load/unload/transfer, wait for full load, dwell, platform and cargo selection, skip, and waypoints.
- **Overlays:** traffic, signals, blocks, routes, congestion, cargo, electrification and stations.

Older saves (v1 and v2, including TRKL1 exports) are migrated automatically (the untouched original is kept in local storage as `pre_v3`).

## Tests

The full regression suite runs headless in Chromium (Playwright) against a built-in static server:

```sh
npm install && npx playwright install chromium   # once
npm test                                         # full release gate
npm run test:quick                               # reduced sizes
node tests/run.mjs rail seeds prodsave           # selected suites
node tests/run.mjs fuzz --from=1 --to=60         # fuzzer seed range
```

| Suite | What it protects |
|---|---|
| `unit` | Save pipeline without a browser: migration idempotency, sanitizer repairs, rejection of non-saves |
| `rail` | The in-game railway scenarios (`index.html?railtest`): single track, loops, multi-track stations, crossings, signals, passenger transfers, timetables, overtaking, signal rows, network contracts |
| `seeds` | Permanent fuzzer regression seeds (`tests/regression-seeds.json`), including the critical seeds 2, 20, 23 and 46 |
| `fuzz` | A range of random fuzzer seeds |
| `prodsave` | The real production save (`tests/fixtures/production-save.trkl1.txt`): every train, station, industry, town, research node and statistic survives; 20 simulated minutes without conflicts; income stays in band; lossless round trip |
| `economy` | Scripted early game with real money on five worlds: first line affordable, break-even, first-train payback, operating share, level pacing; extra trains on a saturated line add little |
| `persist` | Save/reload with live edits; offline progress is capped, never negative, and claimable once |
| `import` | UI import of the TRKL1 export (v2 → v3 with a `pre_v3` backup), malformed input, cancel, export → import |
| `tutorial` | The full tutorial with real mouse input |
| `savefuzz` | 300 mutated saves either load and keep running cleanly or are rejected with the load-failed dialog |
| `monkey` | Deterministic random UI input on desktop, phone (touch, German) and tablet |
| `ui` | Screenshots of the main screens from 1366×768 to 3440×1440, plus tablet and phone; layout checks for overflow, clipping, touch targets and missing strings |
| `perf` | Tick cost with 8, 24 and 50 trains; a 60-minute session checked for leaks |

Screenshots and other output go to `tests/output/`. GitHub Actions runs the suites on every push (`.github/workflows/tests.yml`).

Open `index.html?railtest` to run the automated railway scenarios on a throwaway world, which is never saved: single track with and without passing loops, short halts (deadlock resolver), multi-track stations and dispatching, a diamond crossing, and signals at 1× and coarse 4× steps. Each scenario checks that no two trains share a lane key, that train bodies never overlap geometrically, and that every train keeps making trips. The same suite runs from the console: `__tracklands.game.runRailTests()`.

For broader coverage there is a seeded simulation fuzzer (`src/debug/RailFuzz.js`). It builds a random network (single and double track, multi-track stations, depots and signals), buys random consists with random schedules, and runs 12 game minutes while making a live edit every 15 s: signals, single/double track, platform extensions, added station tracks, bulldozing, consist changes, buying and selling trains, waypoints, and station upgrades. On every check it asserts four things:
- no shared reservation keys, and no geometric body overlap;
- every key under a train body is held by that train, and the trail geometry lies on its tiles;
- no NaN, and no errors in the train tick;
- no train stuck for more than 150 s, trips are completed, and the save round-trips.

Runs are deterministic per seed. Start one from the console on a test world:

```js
__tracklands.startGame({ seed: 5065, difficulty: 'builder', test: true, paused: true })
// once running:
__tracklands.game.runRailFuzz(5, 12)          // seed, game minutes -> result object
```

## Project layout

```
index.html, styles/main.css, manifest.json, service-worker.js, icons/
vendor/three/            three.js r186 (MIT) — bundled locally
src/main.js              bootstrap, title screen, settings, save flows
src/Game.js              orchestrator: simulation loop, events, offline progress
src/config.js            all balancing data (costs, cargo, trains, research, regions…)
src/i18n.js              English + German strings
src/world/               world generation, terrain view, towns, industries, environment, decorations
src/rail/                network graph, routing, reservations and signals, rendering, switches/signals (RailFurniture.js), stations, construction tools
src/trains/              consists (Consist.js), train simulation (movement, reservations, dispatch, AI) and procedural models
src/debug/               automated rail test scenarios
src/economy/             coins, revenue, contracts, events, daily challenges
src/progression/         levels, research, regions, objectives, achievements, legacy, stats
src/ui/                  HUD, panels, inspector, tutorial, icons, Train Builder/station editor (RailUI.js), overlays
src/audio/               synthesized sound effects, ambience and generative music
src/vfx/                 pooled particles
src/save/                IndexedDB/localStorage persistence, versioning, export/import
src/services/            MonetizationService abstraction (development mode only)
src/title/               title screen diorama
tools/make-icons.mjs     renders icons/icon.svg to PNG app icons (Playwright)
```

Set `CREATOR_NAME` in `src/config.js` to credit the creator in the Credits panel.

All models, textures, icons, sound and music are generated procedurally at runtime.
