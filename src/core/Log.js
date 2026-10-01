// Structured logging: a small ring buffer of { t, lvl, cat, msg, data } that
// the debug overlay shows and "copy diagnostics" exports. Uncaught errors and
// rejected promises are recorded too. Nothing leaves the device.
const MAX = 300;
const buf = [];
const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

function push(lvl, cat, msg, data) {
  const e = { t: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0), lvl, cat, msg: String(msg).slice(0, 300) };
  if (data !== undefined) { try { e.data = JSON.parse(JSON.stringify(data)); } catch (x) { e.data = String(data); } }
  buf.push(e);
  if (buf.length > MAX) buf.shift();
  if (lvl === 'error') console.error(`[${cat}] ${e.msg}`, data ?? '');
  else if (lvl === 'warn') console.warn(`[${cat}] ${e.msg}`, data ?? '');
  return e;
}

export const log = {
  info: (cat, msg, data) => push('info', cat, msg, data),
  warn: (cat, msg, data) => push('warn', cat, msg, data),
  error: (cat, msg, data) => push('error', cat, msg, data),
  entries: (n = MAX) => buf.slice(-n),
  counts: () => buf.reduce((a, e) => { a[e.lvl] = (a[e.lvl] || 0) + 1; return a; }, {}),
  clear: () => { buf.length = 0; },
};

// capture what would otherwise only reach the console
if (typeof window !== 'undefined' && !window.__trkLogHooked) {
  window.__trkLogHooked = true;
  window.addEventListener('error', (e) => push('error', 'window', e.message || 'error', { src: e.filename, line: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => push('error', 'promise', (e.reason && (e.reason.message || e.reason)) || 'rejection'));
}
