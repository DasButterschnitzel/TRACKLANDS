// Audio: background music only from creator-supplied files (MusicManager:
// silent without tracks, playlist / next / pause with a track), the voice
// budget that keeps big networks calm, every sound effect name, and the
// continuous sound of the nearest train.
import fs from 'fs';
import path from 'path';
import { openPage, loadSave, productionSave, ROOT } from '../lib.mjs';

export const name = 'audio';

// a 1.5 s 440 Hz tone as a WAV file (the test track)
function wav() {
  const rate = 8000, n = rate * 1.5, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 6000), 44 + i * 2);
  return b;
}

export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const dir = path.join(ROOT, 'assets', 'music'), manifest = path.join(dir, 'music.json'), orig = fs.readFileSync(manifest, 'utf8');
  // 1) no tracks: silent, Settings says so
  {
    const { ctx, page, errors } = await openPage(browser, base);
    await loadSave(page, productionSave());
    await page.mouse.click(640, 400);   // a user gesture unlocks audio
    const r = await page.evaluate(async () => {
      const A = window.__tracklands.audio; A.unlock();
      await A.musicMgr.load();
      for (let i = 0; i < 5; i++) A.update(0.1);
      return { tracks: A.musicMgr.tracks.length, playing: !!A.musicMgr.nowPlaying() };
    });
    check(r.tracks === 0 && !r.playing, 'no tracks installed: no music plays');
    await page.evaluate(() => window.__tracklands.ui.openPanel('settings'));
    const txt = await page.evaluate(() => document.querySelector('#panel').textContent);
    check(/assets\/music/.test(txt), 'Settings explains where music goes');
    // voice budget and sound effect names
    const v = await page.evaluate(() => {
      const A = window.__tracklands.audio, bad = [];
      for (const n of ['click', 'confirm', 'cancel', 'purchase', 'loan', 'coin', 'construct', 'demolish', 'bulldoze', 'rail', 'road', 'station', 'switch', 'blade', 'crossing', 'barrier', 'whistle', 'chuff', 'hornDiesel', 'hornElectric', 'brake', 'coupler', 'doors', 'announce', 'load', 'unload', 'busEngine', 'truckEngine', 'tramBell', 'shipHorn', 'takeoff', 'landing', 'cityGrow', 'industryUp', 'research', 'contract', 'approve', 'reject', 'thunder', 'townUp', 'levelUp', 'error', 'busDoor', 'airBrake', 'hornCar', 'hornBus', 'heavyTruck', 'pedCrossing', 'crowd', 'construction', 'clank', 'gull', 'moo']) {
        try { A.lastPlay = {}; A.voices = []; A.play(n); } catch (e) { bad.push(n + ': ' + e.message); }
      }
      A.voices = []; A.lastPlay = {};
      let played = 0;
      for (let i = 0; i < 40; i++) { const before = A.voices.length; A.lastPlay = {}; A.play('arrive', { world: true, vol: 0.5 }); if (A.voices.length > before) played++; }
      return { bad, played, state: A.ctx ? A.ctx.state : 'none' };
    });
    check(!v.bad.length, `every sound effect plays (${v.bad.join('; ') || 'all'})`);
    check(v.played <= 8, `voice budget: 40 world sounds at once → ${v.played} voices`);
    // the nearest train's continuous sound
    const tsound = await page.evaluate(() => {
      const g = window.__tracklands.game, A = window.__tracklands.audio;
      g.speed = 1; const t = g.trains.trains.find((x) => x.state === 'run') || g.trains.trains[0];
      for (let i = 0; i < 200 && !(t.state === 'run' && t.v > 0.5); i++) g.tick(1 / 30);
      const p = t.visual.cars[0].mesh.position; g.camera.target.set(p.x, 0, p.z); g.camera.viewSize = 10;
      for (let i = 0; i < 20; i++) { g.tick(1 / 30); A.update(1 / 30); }
      return { kind: t._st.model.kind, chuff: A.chuffT != null, voice: !!A.trainVoice, joints: A.jointT != null };
    });
    check(tsound.joints && (tsound.kind.startsWith('steam') ? tsound.chuff : tsound.voice), `nearest train sounds (${tsound.kind}: exhaust ${tsound.chuff}, engine ${tsound.voice}, rail joints ${tsound.joints})`);
    // ambience around the camera: a busy street, waiting passengers, the
    // nearest industry by kind, silent when zoomed out; the loops are a
    // fixed pool (the same nodes before and after)
    const amb = await page.evaluate(async () => {
      const g = window.__tracklands.game, A = window.__tracklands.audio, { industryKind } = await import('./src/audio/Audio.js');
      const pool = [A.trafficL, A.crowdL, A.industryL, A.industryHum];
      const t = g.towns.list.slice().sort((a, b) => b.pop - a.pop)[0];
      for (let i = 0; i < 90; i++) g.tick(1 / 30);
      g.camera.target.set((t.x + 0.5) * 2, 0, (t.z + 0.5) * 2); g.camera.viewSize = 12;
      const st = g.stations.list.find(Boolean); if (st) st.stock.PASSENGERS = 60;
      A.ambT = 0; A.update(1 / 30);
      const town = { ...A.scene, ind: A.scene.ind && A.scene.ind.type };
      const mine = g.industries.list.find((i) => industryKind(i.type) === 'mine') || g.industries.list[0];
      g.camera.target.set((mine.x + 1) * 2, 0, (mine.z + 1) * 2);
      A.ambT = 0; A.update(1 / 30);
      const near = { ind: A.scene.ind && A.scene.ind.type, v: A.scene.indV };
      g.camera.viewSize = 70; A.ambT = 0; A.update(1 / 30);
      const far = A.scene.zoom;
      const same = [A.trafficL, A.crowdL, A.industryL, A.industryHum].every((x, i) => x === pool[i]);
      return { town, near, mineType: mine.type, kind: industryKind(mine.type), far, same };
    });
    check(amb.town.traffic > 0 && amb.near.ind === amb.mineType && amb.near.v > 0.8 && amb.far === 0 && amb.same, `ambience: town street traffic ${amb.town.traffic.toFixed(2)}, crowd ${amb.town.crowd.toFixed(2)}, next to a ${amb.mineType} the ${amb.kind} loop, zoomed out silent, pooled loops`);
    if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
    await ctx.close();
  }
  // 2) with a track: plays, next / pause work
  fs.writeFileSync(path.join(dir, '_test_tone.wav'), wav());
  fs.writeFileSync(manifest, JSON.stringify({ tracks: [{ id: 'a', file: '_test_tone.wav', title: 'Test Tone', artist: 'Test', mood: ['peaceful'] }, { id: 'b', file: '_test_tone.wav', title: 'Test Tone B', mood: ['night'] }] }));
  try {
    const { ctx, page, errors } = await openPage(browser, base);
    await loadSave(page, productionSave());
    await page.mouse.click(640, 400);
    const r = await page.evaluate(async () => {
      const A = window.__tracklands.audio; A.unlock();
      window.__tracklands.settings.music = true;
      await A.musicMgr.load();
      for (let i = 0; i < 40 && A.ctx.state !== 'running'; i++) { await A.ctx.resume().catch(() => {}); await new Promise((res) => setTimeout(res, 50)); }
      for (let i = 0; i < 3; i++) A.update(0.1);
      const first = A.musicMgr.nowPlaying();
      await new Promise((res) => setTimeout(res, 400));
      const el = A.musicMgr.cur && A.musicMgr.cur.el;
      A.musicMgr.next();
      const second = A.musicMgr.nowPlaying();
      A.musicMgr.pause();
      return { n: A.musicMgr.tracks.length, first: first && first.title, second: second && second.title, paused: A.musicMgr.paused, playingTime: el ? el.currentTime : -1, err: el && el.error ? el.error.code : 0 };
    });
    check(r.n === 2 && !!r.first && !!r.second && r.paused, `a track list plays, skips and pauses (${JSON.stringify(r)})`);
    if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 2).join(' | ')); }
    await ctx.close();
  } finally {
    fs.writeFileSync(manifest, orig);
    fs.rmSync(path.join(dir, '_test_tone.wav'), { force: true });
  }
  return { ok, lines };
}
