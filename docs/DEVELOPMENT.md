# TRACKLANDS — developer notes

How the game is built, tested and released. Player-facing information is in the [README](../README.md); the requirement-by-requirement audit of every phase is in [AUDIT.md](AUDIT.md).

Design notes by phase follow (they describe each phase as it shipped; later phases extended some of them).

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

## Networks, cities and roads (Phase 7)

- **Journeys:** passengers and freight travel as packets with an origin, a final destination and a trip purpose (commute, shopping, education, leisure, tourism, business, intercity). They change vehicles and modes along the service network (`src/economy/Network.js`). Payment is made once, on arrival, and split over the legs. Transfers earn nothing on their own.
- **Service quality:** lines show their interval, ride time, waiting time, capacity, demand, regularity and a quality score (`src/economy/Quality.js`). Bus and tram lines can keep an even spacing. Trains can skip empty or local stops and wait for a minimum load.
- **Cities:** accessibility by transit and land value per building, 15 district kinds, metropolitan regions, commuter belts, tourism and town events announced a month ahead (`src/world/Urban.js`).
- **Road types:** dirt track, road, avenue, one-way, four-lane, busway (buses only), expressway and highway (research), each with its own speed limit and capacity. Roads bridge rivers (up to 8 tiles), tunnel straight through hills (up to 12 tiles), and bigger roads cross railways on overpasses instead of level crossings. Tram priority (research) turns lights green for trams.
- **Harbours and airports:** three sizes each. Ports have berths (ships queue off the quay) and airports have runway slots (aircraft wait at the gate or circle). The biggest ships and aircraft need the bigger sizes. Trams, ships and aircraft are serviced where they call.
- **Fleet care:** refurbishment in a depot or garage, and heritage services with old vehicles (higher leisure fares, tourists).
- **Company standing:** reputation (towns, line quality, contract record), contracts with deadlines, service-level contracts, town concessions that keep rival buses out, and optional industry closures with redevelopment (world rule, off by default).
- **Finance analysis:** divisions, services, towns, cargo, cash flow, vehicle returns and a profit overlay.
- **Competitors:** intercity, town-bus and truck-freight rivals that pay their own way, go up for sale when in debt, and can be taken over. They never build railways, because a rival railway could not share the player's signalling safely.
- **Time and weather:** speeds up to 8× run the same fixed-step simulation (on a busy device the game runs slower rather than skipping steps). Day length setting, optional extreme weather (heatwaves, blizzards: slower, never destructive), fewer trips in bad weather, and eras by calendar year.
- **Tools:** FIND (`F`) for anything named, camera bookmarks, and sandbox tools in builder games. (Planning mode and blueprints followed in Phase 11.)
- **Metro:** deferred in Phase 7, built in Phase 11 (second track level, underground stations, portals and the underground view).

## Phase 8: content, polish and QA

The release audit for all eight phases (what is done, what is deferred and why, and which suite covers it) is in [`docs/AUDIT.md`](AUDIT.md).

- **Save safety:** rolling backups (up to 8, every 5 minutes of play, on leaving to the title, before an import or restore), a read-only health check of the running game, a crash snapshot after an uncaught error with a notice on the next start, autosave interval setting, a changelog (Settings → What's new), and diagnostics without personal data.
- **Music:** the creator's tracks in a playlist with shuffle, repeat (all/one/off), crossfades, mood and era preferences, and a "now playing" note. No music ships with the game.
- **Campaign:** the six built-in scenarios open one after another. A win earns gold, silver or bronze by how early it came.
- **Content packs:** vehicles and scenarios as JSON in `assets/packs` (see its README). Every entry is checked against a schema; bad entries are left out and listed in Settings → Content packs.
- **Help and controls:** FIND doubles as a command palette (`Ctrl+K`), km/h or mph, a haptics switch, and handbook pages for roads, ports and airports, reputation, fleet care, saves and shortcuts.
- **Branding:** a company logo (shape, symbol or initials, second colour, "surprise me") in the company panel and on a sign at the headquarters; three more station styles (harbour, art deco, steel and glass).
- **Manufacturers:** every vehicle belongs to one of twelve invented makers (Hollin & Ruck, Northvale Motive, Voltaris, Citymotor, Skyhaven Aero …); within a maker its models form generations by era. The catalogue shows maker and generation, filters by maker and finds models by maker name.
- **Performance:** a performance overlay (Settings → Graphics or `F3`) with frame rate and where the frame time goes (simulation, visuals, rendering), draw calls, scene memory and vehicle counts, each against a budget; long lists (world lists, line and stop vehicles) show 60 rows and add more on demand; a label on the busy screen while the world is built or a save loads; the world build time and the frame breakdown in the diagnostics. The sun's shadow map is now freed when a game ends (it was kept over restarts). The world is built in one step on the main thread; a worker was not added because the generator shares its tables with the renderer.
- **QA and long game:** nine more achievements (road fleet, trams, ships, aircraft, lines, cargo, reputation, a decade and half a century in business) and the matching statistics; photo mode (`P`, the palette or Settings) hides the interface, takes a PNG picture on the device, runs a slow cinematic camera around the view or after the selected vehicle and can hide the names; a `qa` suite (content in both languages, pathfinding under load, a six-year game with live edits and save/load round trips, economic stability on three worlds) and the save fuzzer at 1000 cases in CI.
- **New games:** quick start from the title, game mode presets (relaxed builder, classic, tycoon challenge) and a map preview of the chosen seed and size. (Terrain presets and the advanced generator followed in Phase 10.)

## Phase 9: competitor railways and engineering hardening

- **Competitor railways:** railway companies (Northstar Railways, Atlas Rail Freight, MetroLink Regional, Meridian Express, Keystone Transport) plan, build and run railways alongside the player, next to the Phase 5–8 coach and truck companies. Each has a personality (railway specialist, industrial freight, regional passengers, premium passengers, conservative, aggressive) that shapes what it looks for, how much debt it takes and how fast it grows, never common sense.
- **The same game, no cheating:** a company builds real track, stations, depots, passing loops, double track, signals and trains through the player's own construction code, pays every price from its own money (its loan on the player's terms), and is paid only for what its trains deliver. The player's research bonuses never apply to it. Its money never touches the player's books, statistics, news or undo.
- **Never griefing:** every track tile, station, depot and train has an owner (`RailNetwork.own`). Companies never build on, through or into anyone else's track or stations, never connect to them, keep a two-tile courtesy distance around the player's stations and depots, never demolish buildings or terraform, and their networks never touch. Player tools cannot remove or edit a rival's infrastructure either.
- **Projects, not spam:** a railway moves through stages (discover → evaluate → design → budget → approve → construct → operate → review → expand or retire), one stage per thinking tick. Opportunities come from a cached, sampled list of important town pairs and producing industry chains in the open regions. A corridor is planned first (a dry run through the player's planner) and rejected when too roundabout or twisty. Stations are sized by demand (2–4 tile platforms); new lines join others only at stations (through stations). Each operating line is diagnosed monthly for one bottleneck and gets the cheapest fitting answer: a train, a passing loop, double track (with block signals), longer platforms or another platform; work under running trains waits as pending works. Fleets are modernized one train a year by era, busy double-track corridors electrified. Unprofitable lines are closed completely (trains sold, stations, depot and every track tile removed). Rejected ideas and closed lines are remembered.
- **Failure and takeover:** a company in debt borrows within its limit, closes its worst line, and after a year in debt goes out of business cleanly. The player can buy a railway company: its trains, stations, depots, track and loan become the player's.
- **Seen by the player:** the company panel's league table links to a page per company (strategy, founded, cash, loan, value, profit, passengers and cargo carried, network, lines, plans, closed lines, history); a rival's trains, stations and depots show a company card and no controls; a flag in the company colour at its stations and its livery on its trains; a **Companies** overlay; brief news for plans (at most once a year per company), openings, double track and closures. New games choose 0, 1, 2, 3, 4 or 8 competitors, when they start (together, staggered, late) and their skill (relaxed, standard, tycoon, expert: how well they plan, never their money).
- **Deterministic and cheap:** decisions are seeded by world, company and month; at most two companies do their month's work per simulation step. A developer view (the backtick debug panel) lists every project with stage, estimate, budget and observation, the latest decisions with reasons, and anti-spam metrics (track tiles, unused track, duplicate corridors, idle trains and stations).
- **Engineering hardening:** CI in tiers (see Tests), cross-browser smoke in Chromium, Firefox and WebKit, a failure corpus for the save fuzzer, and an optional real-device job that reports NOT EXECUTED unless configured.

## Phase 10: terrain and eras

- **Terrain presets (world generator v4):** Classic, Gentle countryside, Great plains, Highlands, Alpine, Riverlands, Lake country, Coastal, Archipelago, Industrial basin, Dry frontier, Northern snowland and Continental (made for 192 × 192). A preset is a set of parameters (`src/world/Terrain.js`): relief, mountains, lakes, rivers (0–5) and their width, valleys carved by rivers, low passes between neighbouring regions, the coast (west, none, west and south, all round, islands), sea width, forest, farmland, climate (mixed, temperate, cold, dry: the regions' look, plants and roofs), towns and industries per region, and terrain-aware placement (towns by rivers and coasts on flat ground, mines and wells on their geological seams). The new-game dialog shows each preset's description, an **Advanced terrain settings** section for every parameter, and a live preview with towns, industries, land shares and a construction-cost breakdown (flat, slopes, bridges, tunnels along the lines between neighbouring towns). Every preset keeps the starting region's sites reachable over land (a ford where a lake or river cuts one off) and is validated on every map size.
- **Saves never change their world:** the save keeps the generator version and the terrain parameters; `classic` is the v3 world bit for bit, older saves rebuild with their own version, and fingerprints of v1, v2, v3 and v4 worlds are pinned in `tests/fixtures`. Map sizes stay 64, 96, 128 and 192 tiles (4096-tile maps are not offered: the tile simulation, rendering and saves are not built for them). Generation takes at most about 0.3 s at 192 × 192, so it runs on the main thread (a worker was not needed after profiling).
- **Eras you can see:** six architectural bands (`src/world/Eras.js`: early industrial, interwar, post-war, late modern, contemporary, near future). Every town building keeps the year it was built: its colours come from that era, and a year builds only what it could (no towers or glass towers before 1945, no skyscrapers before 1970). A new world gets a history (an older centre, newer edges), so a 1900 game starts in brick and timber and a 1990 game in layers. Buildings are rebuilt in the style of the day when they are 45 years old; the historic core (before 1945, within two rings of the centre) and landmarks stay. Stations keep the look of the year they opened (materials, gabled or flat roofs, lamps and canopies) until renovated; a station 40 years or older can be listed and then keeps its look. Signals put up before 1960 are semaphores (arm down for stop, raised for clear) until colour lights replace them all by 1995. Works get era fittings (brick chimney, concrete water tower, floodlights, solar panels, a wind turbine) and town streets their surface (setts, then asphalt). Competitors renovate their own stations when they fall two eras behind. Airports, ports, level crossings and catenary keep one look through the eras (see `docs/AUDIT.md`).
- **History:** each town's founding, stages, landmarks and first station, and a bar of how much each era built; the company's milestones (founded, first station and train, network sizes, new regions, first renovation and listed station, the eras). News when an era begins, a station is renovated or listed.
- **Catalogue and sandbox:** the vehicle catalogue filters by All, Current, Historic and Locked; six trains fill the eras' gaps (a goods tank engine, a hybrid shunter, a bi-mode branch unit, a regional EMU, a hydrogen regional train and a heavy electric freight locomotive). Builder games can move the calendar in the sandbox (±10 and ±25 years) and show the world's terrain.

## Phases 11–15

- **Phase 11:** four rail levels (surface, shallow and deep tunnel, viaduct) joined by portals and ramps; metro stations with street entrances; four-track corridors with local/express/freight roles; planning mode with projects; blueprints; station complexes with walking transfers.
- **Phase 12:** one central era resolver for infrastructure looks, one construction price, metro/tunnel/harbour/airport sounds.
- **Phase 13:** measured traffic performance with behaviour fingerprints, benchmark states against a control revision, everyday words in FIND and the vehicle catalogue, lifts and escalators, rival renovation rules, snow and night scenes, data-driven vehicle sound, localization QA.
- **Phase 14:** colour independence, Escape layering, touch sizes, errors that say what to do, an advisor that explains itself, offline and privacy checks.
- **Phase 15:** release candidate: player-flow audit, title and new-game hierarchy, name cleaning against markup in imported data, release documentation.

## Tests

The full regression suite runs headless in Chromium (Playwright) against a built-in static server:

```sh
npm install && npx playwright install chromium   # once
npm test                                         # full release gate
npm run test:quick                               # reduced sizes
node tests/run.mjs rail seeds prodsave           # selected suites
node tests/run.mjs fuzz --from=1 --to=60         # fuzzer seed range
```

### CI tiers

| Tier | When | What |
|---|---|---|
| static | every push, ~1 min | `node tools/check.mjs`: service worker current (a stale one fails here, not after the long suites), every module parses, relative imports resolve, JSON valid |
| fast gate | every push, after static | the functional suites in parallel groups, 150 save-fuzz cases plus the failure corpus, `qa` and `bench` in quick mode, and the cross-browser smoke in Chromium, Firefox and WebKit |
| integration | manual, or PR marked ready for review (`deep.yml`) | 400 save-fuzz cases in 2 shards, full `qa`, `bench`, `perf`, browsers |
| release | manual, or a `v*` tag | 1000 save-fuzz cases in 4 shards, rail fuzzer, production save, full `qa`, `bench`, `perf`, gallery, browsers |
| nightly | every night | 3000 save-fuzz cases in 6 shards, 200 rail-fuzzer seeds and the long suites |

Save fuzzing is deterministic and shardable: `node tests/run.mjs savefuzz --cases=1000 --shard=2/4` runs cases 251–500. A failure prints its case number, save version and mutations, with a one-line reproduction (`--seed=N --cases=1`). Every fuzz failure that was a real bug goes into `tests/fuzz-corpus.json` (a case number or the recorded mutations) and is replayed on every push with `--corpus`; rail-fuzzer bugs go into `tests/regression-seeds.json`.

Cross-browser: `BROWSER=webkit node tests/run.mjs xbrowser`, `BROWSER=firefox xvfb-run -a node tests/run.mjs xbrowser` (Firefox has WebGL only with a display). These are emulated viewports in desktop engines, not real devices.

Real devices: `tests/devicecloud.mjs` runs a smoke on BrowserStack real Android devices and desktop Safari when the `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY` secrets are set; otherwise it reports **NOT EXECUTED** and never fails CI. No real-device test has run for this project so far.

The table lists the core suites; `tests/run.mjs` registers all of them (82 in 6.1.x), and [AUDIT.md](AUDIT.md) maps every requirement to the suite that covers it.

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
| `savefuzz` | 300 mutated saves (1000 in the CI `qa` group) either load and keep running cleanly or are rejected with the load-failed dialog |
| `monkey` | Deterministic random UI input on desktop, phone (touch, German) and tablet |
| `ui` | Screenshots of the main screens from 1366×768 to 3440×1440, plus tablet and phone; layout checks for overflow, clipping, touch targets and missing strings |
| `perf` | Tick cost with 8, 24 and 50 trains; a 60-minute session checked for leaks |
| `savesafety` | Rolling backups, restore, the health check, crash snapshots and autosave settings |
| `music` | Playlist, shuffle, repeat modes, mood/era preference and the now-playing note |
| `campaign` | Campaign order, medals by finishing time, locked chapters |
| `helpui` | Command palette, units, haptics switch, handbook topics, shortcuts |
| `packs` | Content-pack schema: good entries load, bad ones are listed and left out |
| `branding` | Company logo editor, headquarters sign, logo in the save, station styles |
| `bench` | Benchmark worlds (64², 128², 192² with trains) against the frame budgets and the draw-call/scene baseline in `tests/perf-baseline.json` (`BENCH_UPDATE=1` rewrites it); memory over four game starts; the performance overlay; windowed lists |
| `qa` | Content QA (every name in English and German, sane vehicle data), 600 random route requests (valid, repeatable, fast), a six-year game with chaos edits and save/load round trips under the health check, economic stability on three worlds, the new achievements and statistics, photo mode |
| `xbrowser` | The same flows in Chromium, Firefox and WebKit: desktop, phone and tablet viewports at DPR 1–3, touch taps never build, turning the device, reduced motion, IndexedDB, save/load, hiding and showing the page |
| `ai` | A railway company beside a player network for 15 years: profitable lines, the player's infrastructure untouched, networks never touching, courtesy distance, anti-spam metrics, save/load of its plans, determinism, thinking budget; four companies for ten years; company page, read-only cards, overlay, news; clean liquidation and takeover |
| `aidecades` | Nightly: four companies for 50 years — networks never touch, fleets follow the eras, loans within limits, memory, save size |
| `hardening` | Emulated browser conditions in Chromium, Firefox and WebKit: the graphics reset by the browser (saved at once, reloads straight into the game), no WebGL (clear message), no IndexedDB, a full localStorage, no service worker, audio voice budget/mute/suspend (reported NOT TESTED where the environment has no audio output), a real 4.0.0 save, and an update between two builds (one cache left) |
| `makers` | Every vehicle has a maker and a generation; catalogue maker filter and search |
| `worldgen` | Node only: many seeds per generator version checked for complete regions, sites on land, spacing and a connected start region; v1–v4 fingerprints pinned; every terrain preset on every map size; presets look like what they promise; the terrain spec sanitised |
| `terrain` | The new-game dialog on a phone (presets, advanced settings, preview with a cost breakdown, the mega-map warning), a preset game started by touch that saves its terrain and rebuilds the same world, climates, farmland, a classic save left as it was |
| `eras` | 1900 and 1990 worlds (no towers in 1900, an older centre), building years through a save, a made-up past for older saves, station renovation and listing, semaphores and colour lights, era news, town history and company milestones, the catalogue era filter |

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
src/audio/               synthesized sound effects and ambience; MusicManager plays creator-supplied tracks
src/vfx/                 pooled particles
src/save/                IndexedDB/localStorage persistence, versioning, export/import
src/services/            MonetizationService stub: always unavailable, no ads or purchases are shown
src/title/               title screen diorama
tools/make-icons.mjs     renders icons/icon.svg to PNG app icons (Playwright)
```

Set `CREATOR_NAME` in `src/config.js` to credit the creator in the Credits panel.

All models, textures, icons and sound effects are generated procedurally at runtime. No music ships with the game: `assets/music` holds tracks the creator adds.
