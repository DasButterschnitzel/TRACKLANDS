# TRACKLANDS 4.0.0 — release audit (phases 1–8)

Status per area. **PASS**: built, reachable in the game and covered by a named test suite. **DEFERRED**: deliberately not built, with the reason (no fake option is shown for it). **UNTESTED**: works in the headless browser but not checked on the named hardware.

Suites run in CI on every push (core, economy, transport, qa groups) unless marked *local*: `fuzz`, `perf` and `gallery` run locally for the release.

## Phase 1 — base game
| Area | Status | Evidence |
|---|---|---|
| World generation, 8 regions, pinned generators | PASS | `worldgen`, `seeds` |
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
| Rail-building AI | DEFERRED | could not share the player's signalling safely |
| Planning mode, blueprints | DEFERRED | need a second, non-simulated copy of the rail graph |
| Era visuals | DEFERRED | eras exist as calendar, label and news; buildings do not change by era |

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
| Terrain presets, advanced generator | DEFERRED | the generator has no terrain parameters besides a height map; no option is shown that it cannot honour |
| World generation in a worker | DEFERRED | the generator shares tables with the renderer; a busy screen with a label is shown instead |
| Real GPUs, audio devices, phones | UNTESTED | everything ran on SwiftShader |

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
- The sun's shadow map was kept after a game ended (two textures per restart). It is now freed (`bench` memory audit).
- F3 was bound twice (debug text and performance overlay). The debug text stays on the backtick key.
