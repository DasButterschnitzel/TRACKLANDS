# TRACKLANDS 6.1.1 — release audit (phases 1–15)

Status per area. **PASS**: built, reachable in the game and covered by a named test suite that ran green for this release. **PARTIAL**: built, with a named part missing. **MISSING**: asked for and not built. **BROKEN**: built and not working. **HIDDEN**: built but not reachable by the player. **UNTESTED**: works in the headless browser but not checked on the named hardware. **NOT EXECUTED**: a job exists but has not run (no credentials). **DEFERRED**: deliberately not built, with a reason that still holds today (no fake option is shown for it). Every requirement of phases 1–12 was re-read for this audit; each PASS below is re-run on the 6.0.0 commit (see *Release gates 6.0.0*), and rows whose status changed since 5.0.0 say so. No row is BROKEN or HIDDEN.

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
| Underground metro | PASS (Phase 11) | was DEFERRED in 5.0.0; see Phase 11 (`layers`, `metro`) |
| Rail-building AI | PASS (Phase 9) | built on ownership: see Phase 9 |
| Planning mode, blueprints | PASS (Phase 11) | was DEFERRED in 5.0.0; see Phase 11 (`planning`, `costquote`) |
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
| Four-track corridors for the player | PASS (Phase 11) | `fourtrack` |
| Four-track corridors built by rival companies | DEFERRED | still holds: double track with loops covers every demand the planner measures; the rival planner cannot yet verify a four-track junction layout safe |
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
| Airports, ports, level crossings and catenary by era | PASS (Phase 12) | was DEFERRED in 5.0.0; see Phase 12 (`erainfra`, `p12risk`, `gallery`) |
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
| Project estimate equals the charge | PASS (fixed in Phase 12) | was PARTIAL: a station over planned track was estimated as if the track were not there (860 estimated, 720 charged). One price now (`costquote`, `planning`) |
| Blueprints: capture, five built-in patterns + terminus throat, rotate, mirror, JSON import/export (numbers only; bad input refused), versioned browser library | PASS | `planning`, `stationcomplex` |
| Station complexes (stations and stops a walk away, across levels) | PASS | `stationcomplex` |
| Bike parking (+1 reach) and park & ride (towns 3 tiles further), charged once, saved | PASS | `stationcomplex` |
| Line diagram marks metro stops, other lines and walking interchanges | PASS | `stationcomplex` |
| Network map filters (all / railway / metro), metro stations as squares | PASS | `stationcomplex` |
| Older saves load on the surface layer only; nothing moves | PASS | `layers`, `prodsave`, `savefuzz` |
| `mapsize` expected one-layer rail arrays | PASS | fixed (four layers) |
| Four-track catenary, tunnel portals and metro stations by era | PASS (Phase 12) | see Phase 12 |

## Phase 12 — infrastructure that looks its age
| Area | Status | Evidence / reason |
|---|---|---|
| One central resolver (`src/world/VisualEra.js`): nine categories × the six era bands of `Eras.js`, every shared family explained (`FALLBACK_NOTES`), special families (high-speed catenary and portal, metro ramp) | PASS | `erainfra` (nine categories, distinct families, 1900…2060 all resolve) |
| Objects keep the year they were built: per-tile build and electrification years (run-length encoded, written only once something is built), opening and renovation years for stations, stops and terminals; older saves show the world's start year and write nothing new | PASS | `erainfra` (production save), `savefuzz` (era fields fuzzed directly in every fourth generated case) |
| Airports: pioneer, mid-century, jet, modern, future × three sizes × passenger/cargo | PASS | `erainfra`, `gallery` (`eras.png`) |
| Ports: early, industrial, container, modern × size × specialization (general, container, bulk, oil, ferry, mixed; from what they handle) | PASS | `erainfra`, `gallery` |
| Terminal renovation: look only (capacity unchanged), opened / renovated year, target look and cost in the inspector, refused when already current or younger than 20 years | PASS | `erainfra` |
| Renovation booked in its own expense category | PASS (fixed in Phase 12) | was booked as “train upgrades”; `erainfra` checks the ledger |
| Level crossings: gates, lights, half and full barriers by the year the track was laid, renewed by the authority every 40 years; closing for trains retested after a renewal changed the look | PASS | `erainfra`, `p12risk`, `crossings` |
| Catenary: lattice, standard, modern and high-speed by the year of electrification; masts every other tile and aligned; one shared gantry across parallel lines; none through stations; none in tunnels; four-track masts 0.9 from the nearest track centre | PASS | `erainfra`, `p12risk` |
| Tunnel portals: masonry, industrial, concrete, modern, high-speed; a metro ramp is a cut at ground level (it was drawn at rail height, 1.5 below the grass, and never seen) | PASS (fixed in Phase 12) | `p12risk` (every portal within 0.02 of the terrain) |
| Metro stations and entrances in four generations (tiled, concrete, modern, glass) | PASS | `erainfra`, `p12risk` (a 1910 entrance keeps its look through save, load and 50 years) |
| Bus stops in four looks | PASS | `erainfra` |
| Signals by era | PASS (Phase 10) | `eras` |
| Street furniture by era (street lamps) | PASS (Phase 10) | town lamps follow the era band (`Towns.js`); `eras` |
| Heritage: a listed station never changes its look and refuses renovation | PASS | `p12risk` (60 years on) |
| Era gallery: 1900, 1935, 1960, 1985, 2005, 2025, 2060 × eight categories, no two consecutive years alike | PASS | `gallery` *(deep)* |
| Era transitions and model caches: one instanced mesh per look, made on first use; 40 sandbox calendar jumps and four restarts leave no geometry or texture behind | PASS | `p12risk` |
| Long game from 1900 for 60 years with two railway companies: early terminals keep their look, later ones look their age, stations opened across three quarter-centuries, renovation at most one station a year per company, heap +36 MB, save 175 KB, looks survive save/load | PASS | `eralong` *(deep; 30 years quick)* |
| Snow, night and weather on the new models | PASS (Phase 13) | `erainfra` renders day, snow, night and winter night and measures them; three issues found and fixed (see Phase 13) |
| Rival companies: the same resolver for their stations; renovation only two eras behind and at most once a year; no heritage listing (a player's choice); at most one metro | PASS | `ai`, `metro`, `eralong` |
| Rival terminal renovation | PASS (Phase 13) | rivals own railway stations only (no airports or ports): renovation rules for their stations, see Phase 13 |
| Sound: metro door chime on arrival and warning tone on departure, tunnel rumble loop (louder in the underground view), gulls and ship horns at harbours, jet engines at airports, renovation and project fanfares; still under the voice budget and a fixed loop pool | PASS | `audio` (every effect plays; harbour/airport/tunnel ambience; pooled loop) |
| Background music: only files the player adds, with id, file, title, artist, era, mood and weight | PASS | `music`; no music is generated |
| Sound on real speakers | PHYSICAL AUDIO: UNTESTED | no audio device in the container |
| One construction price: estimate = charge for station over track, new track, metro, elevated, extension, four-track station, partial build and blueprint; a changed world re-quotes; a failed build charges and books nothing | PASS (fixed in Phase 12) | `costquote` (found three mismatches: 860/720, 805/825, 300/170), `planning`, `p12risk` (same quote twice) |
| UI suite time: measured (80 % in screenshots under SwiftShader); state-driven frame gate instead of fixed sleeps; coverage unchanged | PASS | `ui` prints its slowest viewports; two viewports 263 s → 113 s |
| Picking across layers: underground view picks metro stations, entrances pick their station, viaduct before ground | PASS (fixed in Phase 12) | `metro` |
| Infrastructure upkeep broken down by level (tooltip = what the month charges) | PASS | `p12risk` |
| World information: year, today's building style, start year, terrain, climate, map size, seed | PASS | `erainfra` |
| Freight routing never loops between transfers; metro sets carry passengers only and refuse freight wagons | PASS | `p12risk`, `network` |
| Lifts and escalators | PASS (Phase 13) | see Phase 13 |
| Performance overlay (F3) counts per era family | PASS (Phase 13) | F3 lists airport/port looks, stop looks, crossing families, catenary, portals, metro ramps and underground chunks (`bench`) |
| Real devices, real GPUs | REAL DEVICE: UNTESTED | everything ran on SwiftShader and emulated touch |
| Device cloud (BrowserStack) | NOT EXECUTED | no credentials configured |

### Phase 12 risks, each a permanent check (`p12risk`, `erainfra`)
- an old airport switching look as the calendar moves — `erainfra` (1905 terminals still pioneer/early in 1985), `eralong`
- a listed station changing on year advance — `p12risk`
- catenary duplicated after renovation — `p12risk` (vertex count unchanged)
- four-track catenary intersecting trains — `p12risk`
- crossing barriers failing after the look changes — `p12risk`
- a metro entrance in the wrong era after save/load — `p12risk`
- a tunnel portal on the wrong layer — `p12risk` (found and fixed: the metro ramp)
- a project estimate changing with nothing changed — `p12risk`
- a sandbox year jump leaking resources — `p12risk`

### Historic bugs kept as regression checks
Four-layer map sizes (`mapsize`), platform extension underground and on viaducts (`metro`), undo restoring track roles (`fourtrack`), plan rollback in money and ledger (`planning`, `costquote`), bulldozer on tunnel and viaduct layers (`layers`), a second pair inside a project (`planning`), seed 18 platform isolation (`fuzz`).

## Phase 13 — measured performance, words the game understands, stations between levels
| Area | Status | Evidence / reason |
|---|---|---|
| City traffic hot paths (junction refresh by version, reused edge buckets, cached stop index and density, flagged crossings, heat fade over touched tiles only) | PASS | render-free sim per frame 3.6 → 2.4 ms, traffic 1.33 → 0.9 ms (same machine, same run); behaviour identical: `trafficperf` fingerprints recorded on 6.0.0 (city 1932381902, 192² world 121268215) unchanged after every step |
| Subsystem telemetry (trains, road, traffic, towns, industries, passengers, cargo, AI, weather, other) with p95/p99 | PASS | `bench` writes them per world into `tests/output/bench-<rev>.json`; F3 shows them live |
| Benchmark states PASS / ABSOLUTE TARGET MISS[, NO REGRESSION] / REGRESSION / ENVIRONMENT INVALID, same-environment control, JSON history; the 8 ms budget unchanged | PASS | `bench` (state classification check), `tools/bench-compare.mjs` against 6.0.0 (`d9a0ef5`), see gates |
| Deterministic traffic (no Math.random, wall clock, frame rate or network) | PASS | `trafficperf` runs the city twice and compares with the fixture |
| FIND in everyday English and German (aliases, accents, ß, hyphens, plural stems, small typos, ranking, objects before commands on ties), never executes | PASS | `search` (28 queries × both interface languages, typos, no side effects, chosen commands) |
| Catalogue description → the existing filters, chips, Clear filters, text search when nothing is understood, unknown words named, phone sizes | PASS | `catalogsearch` (9 EN/DE descriptions) |
| Vehicle sound profile from data (`soundProfile`), content-pack field validated, model-id guessing removed | PASS | `audio`, `packs` |
| Feature checks by semantic markers (`data-section` / `data-field`) instead of translated text | PASS | `audit`, `ai`, `metro` |
| Deterministic localization QA: key parity, placeholders, keys named in code exist, mechanical checks (numbers, units, negation, English left in German, formal register) | PASS | `localization` (3,300+ keys, 0 findings) |
| Optional semantic translation review (CI secret only, report only, sends key/English/German only, hash cache, calibration with 20 known-bad pairs, precision/recall) | NOT EXECUTED: LANGUAGE SEMANTIC REVIEW NOT CONFIGURED | no `TYPESAFE_API_KEY`/`TYPESAFE_API_URL` secret; the tool and its contract are tested against a local stand-in service (`localization`); the key name appears in no shipped file |
| Lifts (12 s) and escalators (7 s) per change of level instead of 20 s on the stairs, only where the complex spans levels, cost and monthly upkeep, hub inspector | PASS | `stationcomplex` (walk 50 → 42 → 37 s, charged once, upkeep 22/month, refused on one level and before 1890/1920) |
| Rival railways add them only at busy multi-level stations with healthy finances | PASS | `stationcomplex` (built at 3000 passengers a year; not after a quiet year, not while losing money) |
| Rival station renovation: important stations only, healthy finances, six-year cooldown, capacity unchanged, now and then kept as heritage | PASS | `stationcomplex`, `eralong` (5 renovations in a century), `aidecades` |
| Snow, night and winter-night scenes of the era infrastructure, measured | PASS (three fixes) | `erainfra`: airport grass stayed green under snow (winter look), terminals lit only their airside windows (landside strips), cloud-shadow bodies threw hard patches under the moon (day only) |
| Save compatibility and fuzz for the new fields (amenities, heritage, rival flow memory) | PASS | `savefuzz` (a quarter of the cases mutate them; replayable `set:` corpus ops), `stationcomplex` (save/load) |
| `setSetting('lang')` switches the language (the German search pass had silently run in English) | PASS (fixed in Phase 13) | `search` checks the interface language, `localization` |
| Firefox: phone contexts without `isMobile` (unsupported there) | PASS (fixed in Phase 13) | browsers (firefox) job red on three heads until fixed in `openPage` |

## Phase 14 — the player's side
| Area | Status | Evidence / reason |
|---|---|---|
| Discovery: FIND shows everyday examples that only fill the field; handbook topics for metro, four-track corridors, planning, station complexes, eras, finding, accessibility | PASS | `search`, `helpui`, `localization` |
| Problem → action: every problem in the transport overview can be shown or acted on (a deadlock without a place now leads to its train) | PASS (fixed in Phase 14) | `access` |
| Finance → world: a train in the finance list opens it in the world | PASS | `access` |
| Errors say what to do: a "what to do" line under the error and after the build hint, 48 texts in both languages | PASS | `access` |
| Colour independence: every overlay class has its own pattern and a legend in words; light signals show stop and clear at different heights; amounts carry +/− | PASS | `access` |
| Touch targets: ≥ 32 px in the top bar and tool strip, ≥ 24 px for every control in seven panels on a phone | PASS (fixed in Phase 14) | `access` (speed buttons were 28 px, the changelog link 16 px) |
| Escape one layer at a time (dialog, popover, panel, tool), also from a text field; a cancelled question answers its caller | PASS (fixed in Phase 14) | `access` (the overlay menu ignored Escape; a cancelled confirm left its caller waiting forever) |
| Modal dialogs: role, aria-modal, focus | PASS | `access` |
| Station complex UI: other levels, walking times, time per level, amenities with cost and upkeep | PASS | `stationcomplex` |
| The advisor explains its measure for every kind of advice and never builds, buys or changes anything | PASS | `access` (state unchanged over 20 runs and renders) |
| Offline static play with the network off (new game, load, FIND, catalogue, metro, traffic, save), no console errors | PASS | `offline`; the release artifact is checked the same way with `STATIC_ROOT` |
| Privacy: no request leaves the local origin; typed words never appear in a request | PASS | `offline` |
| Long session and the 192 × 192 map; save size | PASS | `bench` (192²), `eralong` (a century: heap and save size bounded), `aidecades` |
| Cross-browser | PASS | Chromium, Firefox and WebKit in CI (`xbrowser hardening terrain eras erainfra p12risk search catalogsearch access`) |
| Real devices, real GPUs, speakers | REAL DEVICE: UNTESTED · REAL GPU: UNTESTED · PHYSICAL AUDIO: UNTESTED | headless SwiftShader and emulated touch only |
| Device cloud (BrowserStack) | NOT EXECUTED | no credentials configured |

## Phase 15 — release candidate: the player's journey, end to end
A feature freeze: only defects found by auditing whole player flows were changed. Each finding has a severity; every BLOCKER and HIGH and the important MEDIUM ones were fixed with a regression check, LOW and COSMETIC ones are listed and left for a later patch.

| Finding | Severity | Status | Evidence |
|---|---|---|---|
| A name in an imported save (train, station, company …) could carry markup that ran script in the statistics panel | HIGH (security) | FIXED — markup characters dropped where text comes in: loaded/imported saves, blueprints, scenarios, content packs, every rename field; imports over 32 MB refused | `security` (fails on 6.1.0: 2 script runs) |
| New-game presets white on the light dialog (invisible) | HIGH | FIXED | `access` (contrast incl. the new-game dialog) |
| FIND example words white on the light sheet (1.1:1) | HIGH | FIXED | `access` (contrast, fails on 6.1.0 with 39 texts) |
| Start Journey and New game… opened the same long dialog; expert options (height map, seed) first | MEDIUM | FIXED — Start Journey starts the standard world with the tutorial; height map, wear and industry rules folded away, seed under the map preview | `rcflow`, `campaign`, `terrain`, `mapsize`, `tutorial` |
| Unchosen filters (catalogue, research) and locked research faded like disabled controls (1.3–1.7:1) | MEDIUM | FIXED | `access` |
| Phone tool strip scrolled 4 px by scroll snapping and faded Select | MEDIUM | FIXED | `access` (strip at 0, fade only where more follows) |
| Logo clipped on a 360 px phone; version link unreadable on the title scene; Statistics on the title without a save | LOW | FIXED | screenshots |
| README described metro, planning and terrain presets as deferred and the music as generative | MEDIUM (docs) | FIXED — player README; developer notes in `docs/DEVELOPMENT.md`; `docs/RELEASE_NOTES.md` | review |
| Disabled buttons at ~1.9:1 | LOW | LEFT — disabled controls, distinguishable by shape and state | — |
| Company level badge, cloud-covered locked regions, preset/terrain/size all named "Classic" | COSMETIC | LEFT | — |

| Release flow | Status | Evidence |
|---|---|---|
| First public session: Start Journey → tutorial (skippable) → drag a track → undo with refund → close → reopen → Continue with the same company | PASS | `rcflow` |
| First train through the tutorial with real mouse input | PASS | `tutorial` |
| Every layout at 360×740, 412×860, phone landscape, tablet portrait/landscape, 1280×800, 1366×768, 1920×1080, 2560×1440, 3440×1440 (overflow, clipping, touch targets, missing strings) | PASS | `ui` (200 screenshots reviewed for the main screens) |
| Text contrast in seven panels and the new-game dialog | PASS | `access` |
| German interface: title, HUD, finance, transport, settings, station on desktop and a 360 px phone — no clipping | PASS | screenshots |
| Hostile names in every panel and inspector | PASS | `security` |
| Saves written by 6.0.0 and 6.1.0 (built from their release commits) load, pass the health check, keep running and round-trip | PASS | release gate (below) |
| Network requests in a whole session: same origin only; nothing typed leaves the device | PASS | `offline` |
| No debug logging in game code (`console.log/info/debug` outside `src/debug`); the monetization stub shows nothing | PASS | static review |
| Licences: three.js r186 (MIT) bundled with its licence file; all models, textures, icons and sounds generated; no music shipped; invented makers and places | PASS | review |

## Release gates 6.1.1
Run locally on the 6.1.1 release candidate (`a563a25`; the commits after it change documentation only), one gate group at a time where timing matters; CI (`tests.yml`, nine jobs incl. Chromium, Firefox and WebKit and the new `security` and `rcflow` in core) green on that head. This container renders at about 1 frame per second (SwiftShader), and background jobs end after 30 minutes, so the long gates ran as separate jobs.

| Gate | Result |
|---|---|
| Every registered suite (83) | PASS — in CI's four groups and three browsers, plus `ui` (all ten viewports), `tutorial`, `touch`, `xbrowser` and the changed suites locally |
| Save fuzz, 1000 cases + 22 corpus entries (4 shards) | **0 bad** — 1008 started, 14 rejected cleanly by the load-failed dialog; 250 cases mutated lifts, escalators or a rival's flow memory directly |
| Rail fuzzer, seeds 1–40 | PASS |
| `prodsave` | PASS — 1,220 coins/min (band 900–2000) |
| `qa`, `gallery`, `ai`, `trafficperf` | PASS |
| `perf` | PASS — 8 to 100 trains: tick average ≤ 0.32 ms, p99 ≤ 1.7 ms |
| `aidecades` (50 years, four companies) | PASS — save 351 KB, no company closed |
| `eralong` (a century from 1900) | PASS — 5 renovations, heap +35 MB, save 175 KB, every terminal's look survives save/load |
| `bench` against 6.1.0 (`553e68e`) in the same environment | **PASS** in all three worlds: 64² 1.81 ms (control 2.00), 128² 2.30 ms (2.92), 192² 5.49 ms (5.87), budget 8 ms. This run's environment was slower than the 6.1.0 release run (control 192²: 5.87 ms against 5.48 ms then); the comparison is within one environment. The 192² p99 (39 ms) comes from monthly town and industry work, as recorded for 6.1.0 |
| `offline`, `pwa`, `hardening` | PASS. `offline` failed once while `monkey` ran in parallel (the service worker did not take control within the test's wait on a starved CPU) and passed alone, all ten checks |
| `monkey` (desktop, phone, tablet) | PASS — seeds 1–3 × desktop, phone (touch, German) and tablet, 600 steps each: no NaN, no conflicts. Seeds 2 and 3 ran in parallel and the job limit ended their tablet runs part-way (the process was stopped, not the game); the tablet runs passed when repeated on their own |
| Saves from 6.0.0 and 6.1.0 | PASS — made with the 6.0.0 (`d9a0ef5`) and 6.1.0 (`553e68e`) commits from the production save after four game months; both load in 6.1.1, pass the health check before and after two more months, and round-trip |
| Release package | see below and the PR description |
| Optional semantic translation review | NOT EXECUTED: LANGUAGE SEMANTIC REVIEW NOT CONFIGURED (no CI secret) |
| Real devices, real GPU, physical audio, BrowserStack | UNTESTED / UNTESTED / UNTESTED / NOT EXECUTED |

### Release decision 6.1.1
BLOCKER 0 · HIGH 0 open (3 found, fixed) · MEDIUM 0 open (5 found, fixed) · LOW 1 open · COSMETIC 3 open. Release gates: green. **Recommendation: READY.**

## Release gates 6.1.0
Run locally on `74b97ac` (the Phase 14 commit; the only later change is the `access` suite closing its desktop page before the phone page, a test-harness fix for a CI runner timeout) — dispatching `deep.yml` from this session is refused. CI (`tests.yml`) on every push; the Firefox job was red on three heads until the harness stopped passing `isMobile` to Firefox (`3463774`). This container renders at about **1 frame per second** (SwiftShader); long runs were split to stay under the session's 30-minute job limit.

| Gate | Result |
|---|---|
| Every regular suite (all 81, incl. the new `trafficperf`, `search`, `catalogsearch`, `localization`, `offline`, `access`) | PASS — run in blocks on the release code; `monkey` 3 seeds × desktop/phone/tablet, 600 steps each (0 NaN, 0 conflicts) |
| Save fuzz, 1000 cases + 22 corpus entries | PASS — 1008 started, 14 rejected cleanly with the load-failed dialog, **0 bad**; 249 cases mutated lifts, escalators or a rival's flow memory directly. (A first attempt of shards 3–4 was cut off by the session's 30-minute job limit mid-run — every later case timed out on the closed browser; the rerun in separate jobs passed and cases 690–709 pass in sequence.) |
| Rail fuzzer, seeds 1–40 | PASS (no gaps, overlaps, stuck trains or NaN) |
| `prodsave` | PASS — 1,233 coins/min (band 900–2000) |
| `qa`, `gallery`, `ai`, `trafficperf` | PASS (traffic fingerprints unchanged since 6.0.0) |
| `perf` | PASS — 100 trains: tick average 0.19–0.25 ms, p99 ≤ 1.1 ms |
| `aidecades` (50 years, four companies) | PASS — save 351 KB in 15 ms, no company closed |
| `eralong` (a century from 1900) | PASS — 5 station renovations in 100 years, heap +36 MB, save 175 KB |
| `bench` with the 6.0.0 control in the same environment (`tools/bench-compare.mjs`) | **PASS** in all three worlds: 64² 1.41 ms (control 1.70), 128² 2.10 ms (2.76), 192² 4.53 ms (5.48) against the unchanged 8 ms budget; the 192² p99 (46 ms) is town growth and monthly industry work, recorded, not hidden |
| Offline static package | see the PR description (the release zip, served alone, played through `offline` with `STATIC_ROOT`) |
| Three browsers | Chromium, Firefox, WebKit in CI |
| Optional semantic translation review | NOT EXECUTED: LANGUAGE SEMANTIC REVIEW NOT CONFIGURED (no CI secret) |

## Release gates 6.0.0
Run locally on the 6.0.0 commits (dispatching `deep.yml` from this session is refused); CI (`tests.yml`, eight jobs incl. Chromium, Firefox and WebKit) green on every pushed head from `29ef398` on. This container renders at about **1 frame per second** (SwiftShader), so time-bound UI suites were run one at a time.

| Gate | Result |
|---|---|
| Every regular suite (72, incl. `monkey` and all `ui` viewports) | PASS — `industry`, `transport` first timed out waiting for the camera at 1 fps; nine suites now drive the camera instead of waiting on frames (the checks are unchanged). `tutorial`, `touch`, `xbrowser` and `seeds` passed when re-run alone. |
| Save fuzz, 1000 cases + corpus | 1008 started, 11 rejected cleanly, **2 bad → fixed**: a daily-challenge set without its stats snapshot crashed the statistics (case 365); a track map that does not decode left stations on nothing (case 859, now refused with the load-failed dialog). Both are corpus entries (22 entries, all PASS); 250 cases mutated era fields directly |
| Rail fuzzer, seeds 1–40 | PASS (no gaps, overlaps, stuck trains or NaN; the resolver cleared every deadlock) |
| `prodsave` | PASS — 1,220 coins/min (band 900–2000) |
| `qa`, `gallery`, `ai` | PASS |
| `perf` | PASS — 100 trains: tick average 0.47 ms, p99 2.3 ms |
| `aidecades` (50 years, four companies) | PASS — networks never touch, 0 % unused track, fleets within two eras, save 350 KB |
| `eralong` (60 years from 1900) | PASS |
| `bench` | **FAIL, not a regression**: the 192 × 192 world's simulation takes 8.7–9.2 ms against the 8 ms budget. The 5.0.0 release commit (`b430f16`), which passed this gate at its release, measures 8.83 ms in this container today, and the pre-Phase-12 commit 9.57 ms. Draw calls, scene size and memory are within the baseline; 64² and 128² are within budget. Town traffic dominates (about 3 ms a frame with 248 cars); town lookups are now indexed. The budget was not raised. |
| Static release build | see the PR description |

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
