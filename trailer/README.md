# TRACKLANDS release trailer

Everything here is development tooling for the official trailer. Nothing in
this folder is loaded by the game or shipped to players. The trailer itself
is built from the current game build: every frame is drawn by the game and
every sound comes from the game's own sound engine.

## What is where

| Path | What |
|---|---|
| `scenes.json` | Every shot: save, start time, light, weather, camera path, interface, actions, length. Capturing a scene again gives the same frames and sound. |
| `edit.json` | The main edit (about 92 s): shots in order with their in-points, lengths and transitions; text cards; sound accents. Cards and accents sit on a shot (`"shot"`, `"off"`), so retiming keeps them in place. |
| `edit-30.json`, `edit-15.json`, `*-vertical.json` | Cutdowns: 30 s and 15 s, in 16:9 and 9:16 (each shot cropped to a 9:16 window, `"cx"` its centre). |
| `cards/cards.json` | Text cards, English and German. `tools/cards.mjs` renders them as PNGs into `cards/en`, `cards/de` (and with `--vertical` into `cards/en-v`, `cards/de-v` for 9:16); not committed. |
| `saves/` | Showcase saves of the world "Greenfield", one per era (1900, 1930, 1965, 1995, 2025). |
| `tools/capture.mjs` | Renders one scene frame by frame and writes `captures/<scene>-<lang>.mp4` + `.wav` (not committed). |
| `tools/camera.mjs` | Eased camera paths through keys, or a soft follow of a train, bus, tram, ship or aircraft. |
| `tools/build-world.mjs`, `world.page.js`, `showcase.page.js` | Builds the showcase world era by era. |
| `tools/sfx.mjs` | Renders single game sounds to `audio/sfx/` (not committed) for accents in the edit. |
| `tools/assemble.mjs` | FFmpeg timeline from `edit.json` → ProRes master with PCM sound in `output/`. |
| `tools/encode.mjs` | MP4 (H.264) and WebM (VP9) from the master, loudness-normalised. |

## How a frame is made

`capture.mjs` loads a save into the game in a headless Chromium, stops the
game's own `requestAnimationFrame` loop and then, for every frame:

1. Runs the scene's actions for that moment: script, real mouse drags on
   tiles, key presses.
2. Places the camera on its path.
3. Advances the game by exactly `1/fps` seconds. This covers simulation,
   vehicles, towns, weather, particles and sound.
4. Draws the frame and saves it.

A slow software renderer therefore never changes the speed of what is shown.
`Math.random` is seeded per scene, so a scene is reproducible.

The sound is the game's own engine (`src/audio/Audio.js`) running on an
`OfflineAudioContext`. Its clock reports the frame clock, so every chuff,
whistle, crossing bell and ambience change the game schedules lands on the
frame it belongs to. After the last frame the context is rendered to WAV.

`--probe` runs the same thing without drawing and prints where every train
(and with `--veh` every road vehicle, ship and aircraft) is once a second.
Shots are timed from that.

```sh
node trailer/tools/capture.mjs s01-dawn --lang=none   # clean shots, any language
node trailer/tools/capture.mjs s02-build --lang=de    # interface shots per language
node trailer/tools/capture.mjs s01-dawn --probe=1,2   # timing only
```

Interface shots are captured once per language (`--lang=en`, `--lang=de`):
the game runs in that language, only the text cards differ otherwise. Clicks
are real clicks on the game's buttons; the pointer is parked away afterwards
(`"park"`) so no hover tip stays up. Shots that show the coin balance set it
to a plausible amount for that point in the game (the showcase company is
topped up with builder money, see below); the finance history is shifted by
the same amount so the panels stay consistent.

Settings for captures: graphics high, shadows high, no performance overlay,
no tutorial or tips, no camera shake. Clean shots use the game's photo mode
with the world labels hidden; game notifications are hidden in all shots.

## The showcase world

`build-world.mjs` builds "Greenfield": seed 515, 128 × 128, continental
terrain with fewer towns and more fields, start year 1900, two rival
railway companies starting late.

It builds through the game's own code, the same calls the player's tools
and the rival companies make:
- station drag (which buys town buildings in the way);
- track drag with automatic routing, bridges and tunnels;
- pending works on lines in use;
- depots, consists and train purchase;
- signal rows, electrification, the four-track "second pair" tool;
- metro on the underground layer;
- tram track, bus, tram, ship and air lines.

Between the eras the world simply runs: decades of simulated play.

Developer shortcuts used to reach late-game states in a few minutes instead
of hours of play (all disclosed):

- **Builder money:** it is a builder (sandbox) game, and money is topped up.
- **Unlocks:** all regions and all research are unlocked.
- **Town growth:** sped up with the game's own `TownSystem.levelUp`. This is
  the routine that runs when a town meets its delivery goals, so the towns
  look exactly as a grown town looks in the game. Buildings put up while the
  years run carry their real year and era look.

### Found while capturing

Capturing the 2025 world showed trains standing still for good with "no
route". The cause was a real game bug: a lost train was put back at the
nearest station of *any* company and *any* level, so rival trains landed on
the player's platforms, main-line trains in metro tunnels, and trains on
platforms no line reaches. It is fixed in `src/trains/Trains.js`
(`recoverTrain`: own company, the route's own network, a platform the train
can use) with the regression suite `tests/suites/recovery.mjs`, committed on
its own; the saves were then rebuilt. A remaining train that briefly shows
"no route" in the 2025 save finds its way again within a minute (all
platforms were taken for a moment), which is normal play.

Not shown: the ship routes. The only water the showcase map offers between
towns runs along the map edge, and no camera angle avoids showing the edge
of the world, so the trailer shows buses, trams, metro and aircraft instead.

```sh
node trailer/tools/build-world.mjs --phases=A                                # 1900
node trailer/tools/build-world.mjs --from=greenfield-1900.json.gz --phases=B --stills
```

## Music

`assets/music/music.json` lists no tracks: TRACKLANDS has no creator-supplied
music yet, so the trailer uses no music. No music was downloaded or
generated. The edit is cut on the game's sound effects and ambience and
works without music.

**Music slot:** to add a score later, put the creator-approved track in
`trailer/audio/music.wav` and mix it under the existing master. The game
sound in the master leaves room for it; a −8 to −10 dB duck under the text
cards is a good start. Then run `encode.mjs` again. The edit points of
`edit.json` are the sections the brief describes (calm beginning, build-up,
mega shot, title), so a track can be cut to them.

## Output

`output/` (not committed):
- `tracklands-trailer-<lang>.mov`: ProRes 422 HQ master, 1920×1080, 60 fps, 24-bit PCM.
- `.mp4`: H.264 High, CRF 16, AAC 320 kb/s.
- `.webm`: VP9 + Opus.
- `<lang>` is `en`, `de` or `clean` (no text cards).
- Cutdowns: `tracklands-cutdown-30-*`, `tracklands-cutdown-15-*`, and the
  same with `-vertical` (1080×1920).

```sh
node trailer/tools/cards.mjs && node trailer/tools/cards.mjs --vertical
for l in en de clean; do node trailer/tools/assemble.mjs --lang=$l; done
node trailer/tools/encode.mjs trailer/output/tracklands-trailer-en.mov --webm
node trailer/tools/assemble.mjs --edit=edit-30-vertical.json --lang=de
```

Sound is normalised to −14 LUFS with true peak ≤ −1.5 dBTP.

## Requirements

Node 22, Playwright Chromium (as for the tests), FFmpeg with libx264,
libvpx-vp9, ProRes and Opus. A static build such as `imageio-ffmpeg`'s works.
