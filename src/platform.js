// Where the game runs: the browser (web / installed PWA) or the native
// TRACKLANDS app (Tauri shell on Windows and Android). The game itself is the
// same everywhere; this module is the one place that knows the difference.
//
// Native APIs are reached through the global object Tauri injects
// (app.withGlobalTauri), so the game keeps its no-build-step structure.
import { BUILD } from './buildinfo.js';

const tauri = () => globalThis.__TAURI__ || null;

// true inside the Tauri shell (Tauri defines __TAURI_INTERNALS__ before any script runs)
export function isNative() {
  return !!(globalThis.isTauri || globalThis.__TAURI_INTERNALS__);
}

// 'web' | 'windows' | 'android' | 'native'
export function platformName() {
  if (!isNative()) return 'web';
  const ua = (globalThis.navigator && navigator.userAgent) || '';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  return 'native';
}

// "6.2.0 · Build abc1234 · Windows" style line for Settings / Credits
export function buildLabel(version) {
  const p = { web: 'Web', windows: 'Windows', android: 'Android', native: 'Native' }[platformName()];
  return `v${version} · ${BUILD.sha ? 'Build ' + BUILD.sha.slice(0, 7) + ' · ' : ''}${p}`;
}

// the service worker (offline cache) is for the browser only: the native app
// already ships every file and must never run a stale cached copy of itself
export function wantsServiceWorker() {
  return !isNative() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && location.protocol !== 'file:';
}

// Offer a file to the player (save export, diagnostics, photo).
// Web: the browser's normal download. Native: the system "save as" dialog.
// data: string | Blob. Resolves true when written (or handed to the browser).
export async function saveFile(name, data, mime = 'application/octet-stream') {
  const T = tauri();
  if (isNative() && T && T.dialog && T.fs) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const path = await T.dialog.save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
    if (!path) return false;
    if (typeof data === 'string') await T.fs.writeTextFile(path, data);
    else await T.fs.writeFile(path, new Uint8Array(await data.arrayBuffer()));
    return true;
  }
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return true;
}

// Android hardware / gesture Back. handler() returns true when it closed
// something (modal, panel, tool...); otherwise a second Back within two
// seconds leaves the app (the first one calls hint()). No-op elsewhere.
export function onNativeBack(handler, hint) {
  const T = tauri();
  if (!isNative() || !T || !T.app || typeof T.app.onBackButtonPress !== 'function') return null;
  let armed = 0;
  return T.app.onBackButtonPress(() => {
    if (handler()) { armed = 0; return; }
    const now = Date.now();
    if (now - armed < 2000) { T.app.exit(0); return; }
    armed = now;
    if (hint) hint();
  });
}
