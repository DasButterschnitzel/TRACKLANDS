# TRACKLANDS 6.2.0 — release notes

TRACKLANDS is a transport tycoon in a low-poly miniature world. It runs in the browser (offline once loaded) and, from 6.2.0, as an app for Windows and Android — the same game everywhere, with no account and no server.

## What you can do

- **Railways in depth:** drag-built track over bridges, through tunnels and on four levels (surface, shallow and deep tunnel, viaduct); real consists with couplers, braking and power/weight; block, path and one-way signals that place themselves on request; multi-track stations, passing loops, four-track corridors with local, express and freight roles; metro with street entrances and an underground view.
- **Every mode:** buses and bus lines, trams, trucks, ships with modular ports, aircraft with slot-limited airports, station complexes with walking interchanges, lifts and escalators.
- **A living world:** towns that grow street by street through six architectural eras, industries linked in production chains, municipal authorities, weather and seasons, rival companies that build and run real networks with their own money — and never through yours.
- **Plan and manage:** planning mode with exact quotes, blueprints, a transport overview with problems and an advisor that explains its numbers, finance analysis down to each line, FIND in everyday English and German.
- **Play your way:** a guided start, custom worlds (13 terrain presets, four map sizes, start years 1900–1990), a scenario campaign, a sandbox, English and German, desktop and touch.

## New in 6.2.0

- **Apps for Windows and Android.** A Windows 10/11 installer (`TRACKLANDS-6.2.0-windows-x64-setup.exe`) and an Android app (`…-android-universal.apk`; `…-android.aab` for Google Play) wrap the unchanged game in the system's WebView. Everything is inside the package: the apps start and play without internet. The browser version stays exactly as it was.
- **Android Back** closes what is open first — a dialog, a panel, the active tool, the underground view; on an empty screen it asks once and the second press leaves the app.
- **In the apps,** exporting a save, the diagnostics and photos use the system's *Save as* dialog. Saves stay on the device.
- **Credits** show the exact build (commit) and platform.
- **Fix:** a train that had lost its way could be put back at the nearest station of *any* company or level — a rival's platform, a metro tunnel, a platform without track — and then stood still. It is now put back on its own company's network, on a platform it can use.

## New in 6.1.1

A release-candidate audit of the whole player journey:

- **Start Journey** begins a standard world with the tutorial at once; **New game…** holds every choice, with height maps, vehicle wear and industry rules folded into advanced sections.
- Text that had become unreadable is readable again: the game-mode presets, the FIND examples, unchosen filters and locked research.
- The phone tool strip starts at *Select* instead of fading it.
- **Security:** names inside imported saves, blueprints, scenarios and content packs can no longer carry markup (a crafted save could run script in the statistics panel). Imports larger than 32 MB are refused.

## Saves

Saves from every earlier version — back to version 1 — load and are upgraded on the first start; the untouched original is kept. Saves made by 6.2.0 load in 6.1.x as well (the save format did not change). The apps keep their saves inside the app; use *Settings → Export save* to move a game between browser and app. Keep an export (*Settings → Export save*) if you clear your browser's site data.

## Run it

**Windows:** run the setup `.exe` (per-user install, no administrator rights; it installs Microsoft Edge WebView2 if it is missing). **Android:** install the `.apk` (allow installing from this source) — or get it from Google Play once it is listed there. **Browser:** serve the unpacked web zip with any static web server and open it in a current browser with WebGL2:

```sh
npx http-server -p 8080 .        # or: python3 -m http.server 8080
```

Open `http://localhost:8080`. After the first visit the game works offline and can be installed as an app.

## Validation

Automated, on the release commit (details in [AUDIT.md](AUDIT.md)): the regular suites, 1000 mutated-save cases plus the failure corpus, rail fuzzing, the production save, long and multi-decade games, performance benchmarks against the previous release in the same environment, offline and update tests, and Chromium, Firefox and WebKit.

Not validated by the project: real phones and tablets (REAL DEVICE: UNTESTED), real graphics hardware (REAL GPU: UNTESTED — all rendering ran on a software renderer), physical audio output (UNTESTED), the real-device cloud (BrowserStack: NOT EXECUTED) and the optional external translation review (NOT EXECUTED).

## Licences

Three.js r186 (MIT License) is bundled in `vendor/three` with its licence file. All models, textures, icons and sound effects are generated by the game; no music ships with it. The repository carries no licence file of its own: rights to TRACKLANDS rest with its owner.
