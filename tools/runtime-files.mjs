// The one list of files the game needs at runtime. Used by the service worker
// build (offline cache), the web release zip and the native (Tauri) staging,
// so the three can never disagree about what TRACKLANDS consists of.
//
// Everything under these directories is included automatically, so new
// modules, styles and creator content (e.g. music in assets/music/, content
// packs in assets/packs/) need no change here.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_DIRS = ['src', 'styles', 'vendor/three', 'icons', 'assets'];
export const RUNTIME_FILES = ['index.html', 'manifest.json'];
// the service worker belongs to the web build only (see tools/build-web.mjs)
export const WEB_ONLY_FILES = ['service-worker.js'];

function walk(dir) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel));
    else if (!e.name.startsWith('.')) out.push(rel);
  }
  return out;
}

// repository-relative POSIX paths, sorted
export function runtimeFiles() {
  return [...RUNTIME_FILES, ...RUNTIME_DIRS.flatMap(walk)].sort();
}

export function gameVersion() {
  return (fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8').match(/GAME_VERSION = '([^']+)'/) || [])[1] || '0';
}
