# Content packs

Add road vehicles (buses, trucks, trams, ships, aircraft) and scenarios
without changing the code. Put pack files in this folder and list them in
`index.json`:

```json
{ "packs": ["my-pack.json"] }
```

A pack file:

```json
{
  "id": "my_pack",
  "name": "My pack",
  "version": "1.0",
  "vehicles": [
    { "id": "blue_bus", "name": "Blue Bus 40", "kind": "bus", "cap": 40, "speed": 60,
      "price": 1200, "op": 12, "level": 3, "color": "#2f6bd0", "shape": "urban" },
    { "id": "salt_truck", "name": "Salt Truck", "kind": "truck", "groups": ["bulk"],
      "cap": 20, "speed": 55, "price": 1400, "op": 14 }
  ],
  "scenarios": [
    { "id": "salt_coast", "name": "Salt Coast", "seed": 4242, "mapSize": 64, "difficulty": "standard",
      "startYear": 1950, "deadline": 1970, "money": 0, "goals": [{ "k": "value", "n": 80000 }] }
  ]
}
```

Vehicle fields:
- **Required:** `id` (a–z, 0–9, `_`), `name`, `kind` (`bus`, `truck`, `tram`, `dock`, `airport`), `cap`, `speed` (km/h), `price`, `op` (running cost per month).
- **Optional:** `level` (1–50), `color` (`#rrggbb`), `shape` (buses: `mini`, `classic`, `urban`, `coach`, `decker`, `artic`, `shuttle`, `electric`, `express`, `eartic`, `pod`), `groups` (cargo groups, required for trucks), `mail`, `comfort` (0.5–2), `minAirport`, `minPort`.

Each entry is checked when the game starts. An entry with a problem is left
out, and Settings → Content packs lists what was wrong with it. Pack vehicles
get the id `<pack>.<id>`, so they never replace built-in ones. Pack scenarios
appear under "Pack scenarios" in the scenario menu.

Run `node tools/build-sw.mjs` afterwards so the offline cache includes the
new files.
