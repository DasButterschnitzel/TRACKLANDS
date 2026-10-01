// Renders single sound effects from the game's own sound engine (development
// only) for accents in the trailer edit: the same synthesis the game plays,
// rendered offline to WAV (trailer/audio/sfx/<name>.wav).
//
//   node trailer/tools/sfx.mjs whistle:steam tramBell shipHorn ...
// (name:kind passes { kind } to the engine, e.g. whistle:steam)
import fs from 'fs';
import path from 'path';
import { startServer, launchBrowser, ROOT } from '../../tests/lib.mjs';

const names = process.argv.slice(2);
const out = path.join(ROOT, 'trailer', 'audio', 'sfx');
fs.mkdirSync(out, { recursive: true });
const { server, url } = await startServer();
const browser = await launchBrowser();
const page = await browser.newPage();
await page.addInitScript(() => localStorage.setItem('tracklands.settings', JSON.stringify({ lang: 'en', tutorial: false, volMaster: 0.9, volSfx: 0.85, volAmb: 0, music: false })));
await page.goto(url + '/index.html');
await page.waitForFunction(() => window.__tracklands && window.__tracklands.audio, null, { timeout: 60000 });
for (const spec of names) {
  const [name, kind] = spec.split(':');
  const b64 = await page.evaluate(async ([name, kind]) => {
    const A = window.__tracklands.audio, sr = 48000, secs = 5;
    const oc = new OfflineAudioContext(2, sr * secs, sr);
    let vt = 0;
    const proxy = new Proxy(oc, { get(t, k) { if (k === 'currentTime') return vt; if (k === 'state') return 'running'; if (k === 'resume' || k === 'suspend') return () => Promise.resolve(); const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
    const Real = window.AudioContext;
    window.AudioContext = function () { return proxy; };
    A.ctx = null; A.ready = false; A.lastPlay = {}; A.voices = [];
    A.unlock();
    window.AudioContext = Real;
    // ambience off: only the sound itself
    for (const k of ['wind', 'rainN', 'hum', 'trafficL', 'crowdL', 'industryL', 'tunnelL']) if (A[k]) A[k].g.gain.value = 0;
    if (A.industryHum) A.industryHum.g.gain.value = 0;
    A.amb.gain.value = 0;
    vt = 0.1;
    A.play(name, kind ? { kind } : {});
    const buf = await oc.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), n = buf.length;
    const dv = new DataView(new ArrayBuffer(44 + n * 4));
    const s = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); s(8, 'WAVE'); s(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); s(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
    const bytes = new Uint8Array(dv.buffer); let str = '';
    for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(str);
  }, [name, kind || null]);
  const file = path.join(out, `${spec.replace(':', '-')}.wav`);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log('wrote', path.relative(ROOT, file));
}
await browser.close();
server.close();
