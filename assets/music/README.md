# Background music

The game's music is made from the masters in `Music/` at the top of the
repository (WAV files, stored with Git LFS):

| Folder | Period | Years |
|---|---|---|
| `Music/Early` | early years | to 1949 |
| `Music/Mid` | mid century | 1950–1999 |
| `Music/Late` | today | from 2000 |

`node tools/encode-music.mjs` turns them into the files in this folder and
writes `music.json`. For each master it:

1. trims the silence at the start and end;
2. evens out the loudness (-18 LUFS, peaks at most -2 dBTP);
3. adds a short fade at both ends;
4. encodes it as Opus at 64 kbit/s in WebM, about 0.5 MB a minute.

It only encodes what is new or changed, and drops the files of masters that
are gone. Afterwards, run `node tools/build-sw.mjs`.

To add a track:

1. Put a WAV into the right folder. The name decides the title and the moods:
   - `TT.wav` and `TT (n).wav` → "Early Days n";
   - `TTFunk (2).wav` → "Funk 3";
   - the style table is at the top of `tools/encode-music.mjs`.
2. Encode it with `node tools/encode-music.mjs`.
3. Commit both the master and the files in `assets/music/`.

## In the game

- **Calendar:** in a game, only the tracks of the current year's period play.
  When the calendar enters a new period, the music crossfades into it.
- **All eras:** Settings → Audio → "Music of all eras" plays every track,
  whatever the year. The title screen always plays all tracks.
- **Transitions:** the next track fades in four seconds before the current one
  ends, so there is never a gap.
- **Settings → Audio** also has:
  - play, pause, previous and next;
  - shuffle;
  - repeat (all / one / off);
  - the playlist (tap a track to play it);
  - the "now playing" note.
- **Web version:** tracks are not part of the first download. Each track is
  kept for offline play once it has played. The Windows and Android apps
  contain every track.

`music.json` (written by the tool; can be edited by hand for other music):

```json
{ "tracks": [ { "id": "late-lo-fi-2", "file": "late-lo-fi-2.webm", "title": "Lo-Fi 2",
  "artist": "", "period": "late", "years": [2000, 9999],
  "mood": ["peaceful", "night"], "duration": 182, "weight": 1 } ] }
```

- **`mood`** tags. Tracks matching what is happening come up three times as
  often: `menu`, `peaceful`, `busy`, `night`, `winter`, `city`, `industrial`.
- **`years`:** the calendar years the track belongs to. Without it, the track
  plays in every year.
- **Formats:** OGG, MP3, M4A, Opus, WAV and WebM all work. With no tracks at
  all, the game plays sound effects and ambience only.
