# TRACKLANDS 5.0.0 — release audit (phases 1–10)

Status per area. **PASS**: built, reachable in the game and covered by a named test suite. **PARTIAL**: built, with a named part missing. **DEFERRED**: deliberately not built, with the reason (no fake option is shown for it). **UNTESTED**: works in the headless browser but not checked on the named hardware. **NOT EXECUTED**: a job exists but has not run (no credentials). Every requirement of phases 1–10 was re-read for this audit; rows that were DEFERRED in 4.0.0 and are now built say so.

Suites run in CI on every push (static check, then the core, economy, transport and fuzz-fast groups and the three-browser smoke, `.github/workflows/tests.yml`) unless marked *deep*: those run in the integration, release and nightly tiers (`deep.yml`) and locally for the release.

## Phase 1 — base game
| Area | Status | Evidence |
|---|---|---|
| World generation, 8 regions, pinned generators (v1–v4 fingerprints) | PASS | `worldgen`, `seeds` |
| Track building (bridges, tunnels, tiers, undo) | PASS | `rail`, `build`, `tools` |
| Cargo chains, towns, contracts, research, objectives | PASS | `economy`, `chains`, `towns` |
| Saves (versioned, export/import, offline progress) | PASS | `unit`, `persist`, `importexport`, `prodsave` |
| EN/DE interface | PASS | `ui` (missing-string check), `qa` (content in both languages) |

## Phase 2 — railway operations
| Area | Status | Evidence |
|---|---|---|
| Consists, couplers, Train Builder | PASS | `rail`, `rollingstock` |
| Signals, reservations, deadlock resolution | PASS | `rail`, `fuzz` *(local)*, `seeds` |
| Multi-track stations, dispatcher, schedules | PASS | `rail`, `stationtypes` |
| v3 save migration (idempotent, `pre_v3` kept) | PASS | `unit`, `prodsave` |

## Phase 3 — release pass
| Area | Status | Evidence |
|---|---|---|
| Visual design system, station tiers, town architecture | PASS | `gallery` *(local)*, `ui` |
| Passenger destinations, lines, timetables, network map | PASS | `rail`, `network` |
| Tutorial, handbook, tips | PASS | `tutorial`, `helpui` |
| PWA, service worker, graphics profiles | PASS | `pwa`, `unit` (service worker current) |

## Phase 4 — railway usability
| Area | Status | Evidence |
|---|---|---|
| In-place reversal, heading checks | PASS | `rail`, `fuzz` *(local)* |
| Station drag, platform extension | PASS | `build` |
| Liveries, depot orders, pending construction | PASS | `rail`, `build` |
| Weather states, seasons | PASS | `weather` |

## Phase 5 — transport tycoon
| Area | Status | Evidence |
|---|---|---|
| Ledger, loans, company value | PASS | `finance` |
| Wear, service, replacement | PASS | `fleet` |
| Town authority, permits | PASS | `authority` |
| Cargo ratings, competing stations, town growth | PASS | `towns`, `industry` |
| Crossings, roads, buses, trucks, trams, ships, aircraft | PASS | `crossings`, `roads`, `transport` |
| Map sizes 64–192, height maps | PASS | `mapsize` |
| Audio, MusicManager | PASS | `audio`, `music` |
| News, business cycle, lists | PASS | `news` |
| Company identity, driver mode, scenarios, rivals | PASS | `company`, `scenarios`, `rivals` |

## Phase 6 — road transport, touch, variety
| Area | Status | Evidence |
|---|---|---|
| Touch gesture state machine | PASS | `touch`, `stress` (touch loop) |
| Bus lines, stop types, garages | PASS | `buses` |
| Transport overview, problems, batch actions | PASS | `overview` |
| Road traffic, junctions, lights, bus priority | PASS | `traffic` |
| City archetypes, landmarks, districts | PASS | `cities` |
| New industries and cargos | PASS | `chains` |
| Rolling stock roster, catalogue, compare | PASS | `rollingstock` |
| Real phones and tablets | UNTESTED | headless Chromium only (CDP touch) |

## Phase 7 — networks, cities, operations
| Area | Status | Evidence / reason |
|---|---|---|
| Journeys (O/D packets, transfers, pay on arrival) | PASS | `network` |
| Station storage, handling, containers | PASS | `terminals` |
| Service quality, spacing, express/local | PASS | `network`, `fleet` |
| Accessibility, land value, districts, tourism, events | PASS | `urban` |
| Road types, one-way, busways, road bridges and tunnels | PASS | `roadtypes` |
| Ports and airports (3 sizes, berths, slots) | PASS | `terminals`, `audit` |
| Refurbishment, heritage services | PASS | `fleet` |
| Reputation, contracts 2.0, concessions | PASS | `standing` |
| Industry closure world rule, **off by default** | PASS | `standing`; only the "tycoon" preset turns it on |
| Finance analysis, profit overlay | PASS | `analysis` |
| Rivals (coaches, town buses, trucks), takeovers | PASS | `competition` |
| Speed up to 8× with the same simulation | PASS | `timectl` (1× and 8× give the same revenue and positions) |
| Extreme weather, never destructive | PASS | `timectl` |
| FIND, bookmarks, sandbox | PASS | `tools` |
| Underground metro | DEFERRED | needs a second track layer under the terrain; not at production quality, so not offered |
| Rail-building AI | PASS (Phase 9) | built on ownership: see Phase 9 |
| Planning mode, blueprints | DEFERRED | need a second, non-simulated copy of the rail graph |
| Era visuals | PASS (Phase 10) | see Phase 10 |

## Phase 8 — content, polish, QA
| Area | Status | Evidence / reason |
|---|---|---|
| Save safety (backups, health check, crash snapshot, autosave settings) | PASS | `savesafety` |
| Version display, changelog, diagnostics without personal data | PASS | `savesafety`, `bench` (diagnostics) |
| Music playlist, shuffle, repeat, now playing (no music shipped) | PASS | `music` |
| Campaign, medals, quick start, game presets, map preview | PASS | `campaign`, `scenarios` |
| Content packs (JSON, schema checked) | PASS | `packs` |
| Command palette, units, haptics, handbook topics, shortcuts | PASS | `helpui` |
| Company logo, HQ sign, station styles | PASS | `branding` |
| Manufacturers and generations | PASS | `makers` |
| Performance overlay, budgets, benchmark baseline, memory audit, windowed lists | PASS | `bench`, `perf` *(local)* |
| QA: content, pathfinding under load, long game with chaos, economy | PASS | `qa` |
| Save fuzz 1000 cases | PASS | `savefuzz --cases=1000` (987 load, 13 rejected cleanly, 0 bad) |
| Achievements, statistics, photo and cinematic mode | PASS | `qa` |
| Terrain presets, advanced generator | PASS (Phase 10) | see Phase 10 |
| World generation in a worker | DEFERRED | profiled in Phase 10: at most ~0.3 s at 192 × 192 with every preset (`worldgen` prints the slowest), so the busy screen suffices; the generator also reads the global map size |
| Real GPUs, audio devices, phones | UNTESTED | everything ran on SwiftShader |

## Phase 9 — competitor railways and hardening
| Area | Status | Evidence / reason |
|---|---|---|
| Railway companies with personalities (freight, railway, regional, premium, conservative), 0–8 competitors, timing and skill | PASS | `ai`, new-game dialog (`terrain` opens it) |
| The real game systems: track, stations, depots, trains through the player's construction code; own money, loans | PASS | `ai` (budget, ledger separation) |
| Project stages discover → … → retire, one per tick; memory of rejected ideas | PASS | `ai` (save/load keeps stages) |
| Corridor planning (dry run, detour and turn limits), stations sized by demand, through stations | PASS | `ai` |
| Passing loops, double track with block signals, platform extension, extra platforms, bottleneck diagnosis | PASS | `ai` (loops and double track in the result line) |
| Consists fitting the shortest platform, budget-aware locomotive choice, modernization by era, electrification | PASS | `ai`, `aidecades` *(deep)* |
| Clean closure of unprofitable lines, bankruptcy (liquidation), acquisition by the player | PASS | `ai` (liquidation leaves nothing; takeover transfers trains, stations, track) |
| Never griefing: ownership on every tile/station/train, courtesy distance, networks never touch, player tools cannot edit rival assets | PASS | `ai` (untouched player network, 0 links across owners) |
| No cheating: the player's research never applies to rivals | PASS | `ai`, code review (`NO_FX`) |
| Anti-spam: unused track, duplicate corridors, idle trains and stations, rebuild-and-close loops | PASS | `ai`, `aidecades` *(deep)* |
| Determinism, thinking budget (two companies per step) | PASS | `ai` |
| 50-year run with four companies | PASS | `aidecades` *(deep; 20 years in quick mode)* |
| UI: company page, read-only cards, overlay, news (rate-limited), debug view | PASS | `ai` |
| Four-track corridors | DEFERRED | double track with loops covers every demand the planner measures; a four-track corridor needs a junction layout the planner cannot yet verify safe |
| AI demolition or terraforming | DEFERRED (by design) | companies never demolish buildings or change terrain |
| CI tiers: static gate (stale service worker fails in seconds), fast gate, integration, release, nightly | PASS | `tools/check.mjs`, `tests.yml`, `deep.yml` |
| Save fuzz tiers (150 + corpus per push, 400, 1000, 3000 sharded) and the failure corpus | PASS | `savefuzz --corpus` (the corpus catches a removed fix) |
| Cross-browser smoke (Chromium, Firefox, WebKit) | PASS | `xbrowser`, `hardening`, `terrain`, `eras` in the browsers job |
| Browser hardening: context loss, no WebGL, no IndexedDB, full storage, no service worker, visibility, DPR 1–3, audio unlock, update from 4.0.0 | PASS | `hardening`, `xbrowser` |
| Audio output in Firefox headless | UNTESTED | the container has no audio device; reported NOT TESTED by the suite |
| Real-device cloud job (BrowserStack) | NOT EXECUTED | `tests/devicecloud.mjs` runs only with secrets; none are configured, and no result is claimed |

## Phase 10 — terrain and eras
| Area | Status | Evidence / reason |
|---|---|---|
| 13 terrain presets incl. the 12 asked for (countryside, plains, highlands, alpine, riverlands, lake country, coastal, archipelago, industrial basin, dry frontier, northern snowland, continental mega) | PASS | `worldgen` (every preset × seeds × map sizes playable; each looks like what it promises), `terrain` |
| Generator parameters under Advanced; preview (towns, industries, shares) with regenerate, random and seed entry | PASS | `terrain` (phone viewport, touch) |
| Rivers, valleys, passes, coasts, islands, lakes | PASS | `worldgen` (water and relief per preset) |
| Geology (ore, coal and oil seams) for mines and wells | PASS | `worldgen` (industries complete and on land); visible in placement only |
| Town placement by terrain; city shape by terrain | PASS | `worldgen`; archetypes and street plans follow water and mountains (`cities`) |
| Climates (biomes, plants, roofs), farmland | PASS | `worldgen`, `terrain` |
| Generator versioning (v4), terrain saved, old saves never regenerated | PASS | `worldgen` (v1–v4 fingerprints), `terrain` (save and reload), `prodsave` |
| Preset validation (start region over land, complete regions, sites on land, water and mountain limits) | PASS | `worldgen` |
| AI on hard terrain (alpine, archipelago) | PASS | `ai` |
| Construction-cost breakdown in the preview | PASS | `terrain` |
| Mega map warning; continental suggests 192 × 192 | PASS | `terrain` |
| 4096-tile maps | DEFERRED | not offered: the tile simulation, renderer and saves are built for at most 192 × 192 |
| Era bands; buildings by construction year; historic cores; renewal after 45 years | PASS | `eras` |
| Era-starting worlds (1900 vs 1990) | PASS | `eras` |
| Stations by era; renovation; heritage listing | PASS | `eras` |
| Signals by era (semaphores → colour lights) | PASS | `eras` |
| Industries and town streets by era | PASS | `eras` (news and rebuild on a new era), screenshots |
| Airports, ports, level crossings and catenary by era | DEFERRED | shared instanced models with one look; era variants need new model sets. No option claims otherwise |
| Era news, town history, company milestones | PASS | `eras` |
| Catalogue era filter (All, Current, Historic, Locked) | PASS | `eras` |
| Sandbox era (calendar) and terrain controls | PASS | `eras` (sandbox calendar); the terrain is fixed once a world exists, so the sandbox shows it |
| Content pass: missing train types per era | PASS | six new trains (goods steam, hybrid shunter, bi-mode unit, regional EMU, hydrogen regional, heavy electric freight); `qa` content checks, `makers` |
| Competitors and eras | PASS | modernization by era, electrification, station renovation (`ai`) |
| Benchmarks, memory audit, stress | PASS | `bench`, `stress`, `perf` *(deep)* |

## Phase 11 — metro, four-track corridors, planning
| Area | Status | Evidence / reason |
|---|---|---|
| Multi-layer rail graph (surface, shallow tunnel, deep tunnel, viaduct); portals and ramps link layers only at track ends; no layer leak | PASS | `layers` (graph validation per layer, `bad_link`/`layer_leak` kinds), `savefuzz` corpus (10 layer cases) |
| Grade separation: surface track across a tunnel or under a viaduct never joins it | PASS | `layers`, `fourtrack` (flyover over both pairs) |
| Underground view (surface / underground / all), layer chips, `U` and `[` `]` shortcuts, touch toolbar button | PASS | `layers` (screenshot), `touch` |
| Metro stations (cut-and-cover, deep, interchange, elevated), street entrances (a street corner in dense centres), metro names | PASS | `metro` |
| Metro vehicles: five sets (1930s to driverless), research `urban_rail`, short dwell and quick reversal | PASS | `metro`, `rollingstock`, `makers` |
| Monthly upkeep of tunnels, viaducts and metro/elevated stations; rivals pay their own | PASS | `metro` (ledger `maint_track`/`maint_station`) |
| Walking transfers between levels include stairs time | PASS | `metro` (50 s for three tiles and one flight) |
| Rival metro: at most one per company, only for a city, only when the estimate covers the upkeep | PASS | `metro` (none for small towns; one for a city; paid by the rival; no second) |
| Platforms lengthened and tracks added underground and on viaducts | PASS | `metro` (once refused as bad terrain) |
| Bulldozer on tunnel, deep and viaduct layers | PASS | `layers` (once found nothing there) |
| Track roles (local, express, freight) per tile; soft routing preference with fallback | PASS | `fourtrack` (express keeps its pair, freight the local pair, express falls back when its pair is cut) |
| “Second pair” tool: parallel pair with crossovers, one transaction, charged once, one undo step, roles restored on undo | PASS | `fourtrack`, `planning` (pair inside a project) |
| Express overtaking on a four-track corridor | PASS | `fourtrack` (side by side, more trips, no collisions) |
| Roles overlay | PASS | `fourtrack` (screenshot) |
| Planning mode: drawing plans builds and charges nothing; ghosts; no land reservation | PASS | `planning` |
| Project states, cost breakdown, revalidation when the ground is taken | PASS | `planning` |
| BUILD PROJECT all or nothing (rollback of a step failing half way); build the valid part; duplicate; compare; saved with the game | PASS | `planning` |
| Project estimate equals the charge | PARTIAL | a station planned over track planned in the same project is estimated as if the track were not there (860 estimated, 720 charged); being fixed in Phase 12 |
| Blueprints: capture, five built-in patterns + terminus throat, rotate, mirror, JSON import/export (numbers only; bad input refused), versioned browser library | PASS | `planning`, `stationcomplex` |
| Station complexes (stations and stops a walk away, across levels) | PASS | `stationcomplex` |
| Bike parking (+1 reach) and park & ride (towns 3 tiles further), charged once, saved | PASS | `stationcomplex` |
| Line diagram marks metro stops, other lines and walking interchanges | PASS | `stationcomplex` |
| Network map filters (all / railway / metro), metro stations as squares | PASS | `stationcomplex` |
| Older saves load on the surface layer only; nothing moves | PASS | `layers`, `prodsave`, `savefuzz` |
| `mapsize` expected one-layer rail arrays | PASS | fixed (four layers) |
| Four-track catenary, tunnel portals and metro stations by era | DEFERRED | Phase 12 |

## Standing constraints
| Rule | Status |
|---|---|
| No copyrighted game code or assets | PASS — models, textures, icons and sounds are generated in code; maker names are invented |
| No generated background music; no pay-to-win | PASS |
| No fake map or terrain options | PASS |
| Industry closure off by default; no destructive disasters by default | PASS |
| No personal data in diagnostics; no cloud backend | PASS |
| Touch and desktop | PASS (headless); real hardware UNTESTED |

## Fixed during the release cycle
- 5.0.0: rail fuzzer seed 18 (release gate) found that adding a platform to a one-tile station whose neighbours were both dead ends laid a platform no train could reach (`station_off_track`). It is refused now (`err_track_isolated`); seed 18 is a permanent regression seed.
- 5.0.0 release gate (local, the CI dispatch was not available to this session): 1000 save-fuzz cases in 4 shards + the corpus (988 load, 12 rejected cleanly, 0 bad), rail fuzzer seeds 1–40, `prodsave` (1,265 coins/min), full `qa`, `bench`, `perf` (100 trains: tick avg ≤ 0.22 ms), `gallery`, `ai`, `aidecades` (50 years: networks never touch).
- 5.0.0: in WebKit the new-game dialog scrolled sideways on a phone (the height-map file input kept its fixed intrinsic width); it now shrinks with the dialog (`terrain` in all three engines).
- 5.0.0: four new trains shared a silhouette with older models; each has its own length now (`rollingstock`).
- 5.0.0: the rail AI's alpine and archipelago runs, the terrain dialog and the era suite run in Chromium, Firefox and WebKit (browsers job).
- The sun's shadow map was kept after a game ended (two textures per restart). It is now freed (`bench` memory audit).
- F3 was bound twice (debug text and performance overlay). The debug text stays on the backtick key.
