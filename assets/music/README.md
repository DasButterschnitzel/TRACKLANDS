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
- `weight`: how often the track comes up relative to others (default 1).

Remember to run `node tools/build-sw.mjs` so the offline cache includes the
new files.
