#!/usr/bin/env node
// GitHub Release text for a version, taken only from the game's own changelog
// (src/changelog.js, English and German) — nothing generated or invented.
//   node tools/ci/release-notes.mjs 6.2.0 > notes.md
// Exits 1 when the changelog has no entry for the version.
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const v = process.argv[2];
const { CHANGELOG } = await import(pathToFileURL(path.join(ROOT, 'src/changelog.js')).href);
const e = CHANGELOG.find((x) => x.v === v);
if (!e) { console.error(`no changelog entry for ${v} in src/changelog.js`); process.exit(1); }
const lines = [
  `TRACKLANDS ${v}`, '',
  '### What changed', ...e.en.map((l) => `- ${l}`), '',
  '### Was ist neu', ...e.de.map((l) => `- ${l}`), '',
  '### Downloads',
  `- **Windows (x64):** \`TRACKLANDS-${v}-windows-x64-setup.exe\` — installer for Windows 10/11 (needs Microsoft Edge WebView2, installed automatically if missing)`,
  `- **Android:** \`TRACKLANDS-${v}-android-universal.apk\` for direct install; \`TRACKLANDS-${v}-android.aab\` is the Google Play upload bundle`,
  `- **Web / PWA:** \`TRACKLANDS-${v}-web.zip\` — unpack and serve the folder over HTTP(S)`,
  '- `SHA256SUMS.txt` and `release-manifest.json` list every file with its SHA-256 checksum, size and signing status.', '',
];
process.stdout.write(lines.join('\n'));
