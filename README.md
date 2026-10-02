# TRACKLANDS

A cozy transport tycoon in a living low-poly miniature world. Lay railways, connect towns and industries, run buses, trams, trucks, ships, aircraft and metros, and watch hamlets grow into glowing cities across a century of changing technology.

## Play

TRACKLANDS is a static web app: no installation, no account, no server-side component. Serve the folder with any static web server and open it in a browser:

```sh
npx http-server -p 8080 .
# then open http://localhost:8080
```

(Any static server works, for example `python3 -m http.server 8080`. Opening `index.html` straight from the file system does not work, because browsers block ES modules there.)

- **Browsers:** a current desktop or mobile browser with WebGL2 — Chrome, Edge, Firefox, Safari or Android Chrome. A mouse or a touch screen; a keyboard adds shortcuts.
- **Install and offline:** the game is a Progressive Web App. After the first visit it is cached and runs fully offline; most browsers offer *Install* / *Add to Home Screen*. The first visit needs the network.
- **Updates:** when a new version is available the game shows an *Update* note. It saves and reloads only when you press it; otherwise the new version starts next time.

### Windows and Android apps

Each [GitHub Release](../../releases) also carries native builds of the same game:

- `TRACKLANDS-<version>-windows-x64-setup.exe`: a per-user installer for Windows 10 and 11. It installs Microsoft WebView2 if it is missing.
- `TRACKLANDS-<version>-android-universal.apk`: Android 7.0 or newer, for direct install.
- `TRACKLANDS-<version>-android.aab`: the bundle for Google Play.
- `TRACKLANDS-<version>-web.zip`, `SHA256SUMS.txt` and `release-manifest.json`.

The apps run fully offline and keep saves in their own storage; use *Export* to move a save between the browser and an app. On Android the Back button closes the topmost panel or dialog first; pressing it twice on an empty screen leaves the game.

## First steps

1. **Start Journey** on the title screen opens a standard world with the tutorial. **New game…** lets you choose difficulty, map size, terrain, start year and rival companies.
2. The tutorial walks you through your first station, track, depot and train. You can skip it and reopen any topic later from the **Handbook** (book icon, or `?`).
3. Stuck? **FIND** (`F`) searches towns, stations, vehicles, lines and commands in English or German — try “money”, “Stau”, “metro map”. Every error message says what to do next.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Select | Click | Tap |
| Pan | Drag in Select mode, middle/right drag, `W` `A` `S` `D` / arrows | Drag (Select mode) or two-finger drag |
| Zoom | Mouse wheel, `+` / `-` | Pinch |
| Rotate view | `Q` / `E` | — |
| Build track | Track tool, drag from tile to tile, release to build | Same; confirm with the ✓ handle |
| Tools | `1` select · `2` track · `3` station · `4` depot · `5` train · `6` bulldoze · `7` decorate · `8` signals · `9` waypoint · `R` road · `B` stop · `L` lines · `I` industry | Bottom bar |
| Underground view / build level | `U` / `[` `]` | Layers button |
| Planning mode | `J` | Planning button |
| Trains list · map · overlays | `T` · `M` · `O` | Menu rail · Layers button |
| Pause · faster · slower (up to 8×) | `Space` · `.` · `,` | Speed buttons |
| Find / command palette | `F` or `Ctrl+K` | Menu → Find |
| Undo (10 s) | `Ctrl+Z` | Undo button |
| Close dialog / panel / tool | `Esc` (one layer at a time) | Close button |
| Photo mode | `P` | Settings |
| Handbook | `?` | Book icon |

## Your saves

- The game saves automatically to your browser (IndexedDB, with a localStorage copy) and keeps up to eight rolling backups — **Backups** on the title screen restores one.
- **Settings → Export save** exports your company as a text or file and imports it again, also on another device. Older saves (back to version 1) load and are upgraded; the untouched original is kept.
- Saves stay on your device. Clearing the browser's site data deletes them, so export a copy now and then.

## Music

No music ships with the game. Put your own tracks in `assets/music` and list them in `assets/music/music.json` (see the README there); the game plays them as a playlist with shuffle, repeat and crossfades. Sound effects and ambience are generated in the browser.

## Privacy

TRACKLANDS makes no requests beyond its own files: no analytics, no accounts, no ads, no external fonts or scripts. What you type into FIND or the vehicle catalogue never leaves your device.

## Release validation

Every release passes the automated gates listed in [`docs/AUDIT.md`](docs/AUDIT.md): more than 80 browser suites, 1000 mutated-save cases, rail fuzzing, long simulated games, performance benchmarks and Chromium, Firefox and WebKit runs. These run in emulated browsers with a software renderer; real phones and tablets, real GPUs and physical audio output have not been tested by the project.

## More

- [Release notes](docs/RELEASE_NOTES.md)
- [Developer notes](docs/DEVELOPMENT.md): running the tests, CI tiers, project layout, debug tools
- [Releasing](docs/RELEASING.md): how a version tag becomes a GitHub Release
- [Native builds](docs/NATIVE-BUILDS.md) and [signing](docs/SIGNING.md): the Tauri shell for Windows and Android
- [Native release status](docs/RELEASE-NATIVE-STATUS.md): what has been verified, and how
- [Audit](docs/AUDIT.md): every requirement of every phase, its status and the suite that covers it
- Content packs (extra vehicles and scenarios as JSON): [`assets/packs/README.md`](assets/packs/README.md)

Three.js (MIT License) is bundled in `vendor/three`; everything else — models, textures, icons and sound — is made by the game itself.
