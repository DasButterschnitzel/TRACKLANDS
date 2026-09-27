# Background music

Drop audio files (OGG, MP3, M4A, Opus, WAV or WebM) into this folder and list
them in `music.json`. The game loads the list at start, plays the tracks as a
shuffled playlist with crossfades, and shows the title and artist in Settings.
With an empty list the game plays only sound effects and ambience.

```json
{
  "tracks": [
    {
      "id": "morning",
      "file": "morning-line.ogg",
      "title": "Morning Line",
      "artist": "Your Name",
      "era": "steam",
      "mood": ["peaceful", "menu"],
      "weight": 1
    }
  ]
}
```

- `file`: file name in this folder (letters, digits, `-`, `_`, `.`, spaces).
- `mood`: optional tags. The game prefers tracks matching what is happening:
  `menu`, `peaceful`, `busy` (large network), `night`, `winter`, `city`
  (large towns), `industrial`.
- `era`: optional, one of `steam`, `diesel`, `electric`, `modern`, `future`.
  Tracks of the game's current era come up twice as often.
- `weight`: how often the track comes up relative to others (default 1).

In Settings → Audio: play, pause, previous/next, shuffle, repeat (all / one /
off), the playlist (tap a track to play it) and a switch for the short
"now playing" note when a track starts. Shuffle and repeat are remembered.

Remember to run `node tools/build-sw.mjs` so the offline cache includes the
new files.
