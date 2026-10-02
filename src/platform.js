// Where the game runs: the browser (web / installed PWA) or the native
// TRACKLANDS app (Tauri shell on Windows and Android). The game itself is the
// same everywhere; this module is the one place that knows the difference.
//
// Native APIs are reached through the global object Tauri injects
// (app.withGlobalTauri), so the game keeps its no-build-step structure.
import { BUILD } from './buildinfo.js';

const tauri = () => globalThis.__TAURI__ || null;

// true inside the Tauri shell. Tauri's globals come from initialization
// scripts, which on Android can run after the page's own modules, so the app's
// origin (http(s)://tauri.localhost on Windows and Android, tauri:// elsewhere)
// counts as well.
function nativeOrigin() {
  const l = globalThis.location;
  return !!l && (l.hostname === 'tauri.localhost' || l.protocol === 'tauri:');
}
export function isNative() {
  return !!(globalThis.isTauri || globalThis.__TAURI_INTERNALS__) || nativeOrigin();
}

// the Tauri API object once it exists (polls for a late injection: often for
// the first 20 s, then every half second; ms = Infinity never gives up)
function whenTauri(test, ms = 20000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const look = () => { const T = tauri(); const dt = Date.now() - t0; if (T && test(T)) resolve(T); else if (dt > ms) resolve(null); else setTimeout(look, dt < 20000 ? 50 : 500); };
    look();
  });
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
// Registering the listener is what stops Android from closing the app on
// Back, so it waits for a late Tauri API and retries a failed registration.
// Resolves to true once the listener is registered.
export async function onNativeBack(handler, hint) {
  if (!isNative()) return false;
  // without the listener Android closes the app on Back, so never give up
  // waiting for a late API (a slow first start)
  const T = await whenTauri((t) => t.app && typeof t.app.onBackButtonPress === 'function', Infinity);
  if (!T) return false;
  let armed = 0;
  const onBack = () => {
    if (handler()) { armed = 0; return; }
    const now = Date.now();
    if (now - armed < 2000) { T.app.exit(0); return; }
    armed = now;
    if (hint) hint();
  };
  // A registration that failed on our side may still have reached Android;
  // a retry then leaves two listeners, and one Back would arrive twice (the
  // second "press" would leave the app). The first listener that hears a Back
  // owns it from then on; the others stay silent.
  let owner = null;
  const listener = (id) => () => { if (owner == null) owner = id; if (owner === id) onBack(); };
  // a registration that neither succeeds nor fails within a few seconds (a
  // busy start) is tried again; a late answer to an earlier try is harmless
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const done = await Promise.race([T.app.onBackButtonPress(listener(attempt)).then(() => true), wait(4000).then(() => false)]);
      if (done) return true;
    } catch (e) { await wait(200 * (attempt + 1)); }
  }
  return false;
}
