// Music: the shipped playlist (Music/ masters encoded by tools/encode-music.mjs:
// early / mid / late periods), track choice by mood and era, the calendar
// period (only the current period's tracks, unless "music of all eras" is on),
// the next track fading in before the current one ends, a crossfade when the
// calendar enters a new period, shuffle and repeat kept in the settings,
// repeat one / all / off, the playlist and now-playing note, a real track
// decoding in the browser, and the service worker leaving music out of the
// release download. Choice tests use tracks made up in the page.
import fs from 'fs';
import path from 'path';
import { ROOT } from '../lib.mjs';
import { openPage, startTestGame } from '../lib.mjs';

export const name = 'music';
export async function run({ browser, base }) {
  const lines = [];
  let ok = true;
  const check = (c, msg) => { lines.push((c ? 'ok   ' : 'FAIL ') + msg); if (!c) ok = false; };
  const { ctx, page, errors } = await openPage(browser, base, { viewport: { width: 1280, height: 800 } });
  await startTestGame(page, 777);
  const r = await page.evaluate(async () => {
    const app = window.__tracklands, M = app.audio.musicMgr, out = {};
    await M.load();
    out.shipped = M.tracks.length;
    out.shippedList = M.tracks.map((t) => ({ file: t.file, period: t.period, years: t.years }));
    // a real shipped track decodes (Opus in WebM)
    try {
      const f = M.tracks[0] && M.tracks[0].file;
      const buf = await (await fetch('assets/music/' + encodeURIComponent(f))).arrayBuffer();
      const ac = new OfflineAudioContext(2, 48000, 48000);
      const ab = await ac.decodeAudioData(buf);
      out.decoded = { file: f, seconds: Math.round(ab.duration), ch: ab.numberOfChannels };
    } catch (e) { out.decoded = { error: String(e) }; }
    // periods: in 1925 only early tracks, in 1975 mid, in 2010 late; all eras = everything
    {
      const P = (id, period, years) => ({ id, file: id + '.webm', title: id, artist: '', era: '', mood: [], weight: 1, period, years });
      const keep = M.tracks;
      M.tracks = [P('e1', 'early', [1800, 1949]), P('e2', 'early', [1800, 1949]), P('m1', 'mid', [1950, 1999]), P('l1', 'late', [2000, 9999])];
      M.shuffle = true; M.allEras = false;
      const seen = (year) => { M.setContext('peaceful', '', year); const s = new Set(); for (let i = 0; i < 300; i++) { M.history = []; s.add(M.tracks[M.pick()].period); } return [...s].sort().join(','); };
      out.periods = { y1925: seen(1925), y1975: seen(1975), y2010: seen(2010), title: (() => { M.setContext('menu', '', null); const s = new Set(); for (let i = 0; i < 300; i++) { M.history = []; s.add(M.tracks[M.pick()].period); } return [...s].sort().join(','); })() };
      M.allEras = true; out.periods.all1925 = seen(1925); M.allEras = false;
      M.setContext('peaceful', '', 1975); out.periodName = M.period();
      // gapless: the next track starts FADE seconds before the end; a new
      // period crossfades in once the track has played a little
      const calls = [];
      const realNext = M.next.bind(M), realEnded = M.onEnded.bind(M);
      M.next = () => calls.push('next'); M.onEnded = () => calls.push('ended');
      app.settings.music = true; app.settings.musicAllEras = false;
      const ctx0 = M.audio.ctx; if (!ctx0) M.audio.ctx = { currentTime: 0 };   // (no AudioContext without a user gesture here)
      const fake = (i, t, d) => ({ i, el: { duration: d, currentTime: t, pause() {}, play() { return Promise.resolve(); } }, src: { disconnect() {} }, gain: { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, disconnect() {} } });
      M.paused = false; M.cur = fake(2, 100, 180); M.update(); out.midway = calls.length;
      M.cur = fake(2, 176.5, 180); M.update(); out.nearEnd = calls.slice();
      calls.length = 0; M.setContext('peaceful', '', 2001); M.cur = fake(2, 3, 180); M.update(); out.newPeriodEarly = calls.length;
      M.cur = fake(2, 20, 180); M.update(); out.newPeriodLater = calls.slice();
      calls.length = 0; app.settings.musicAllEras = true; M.cur = fake(2, 20, 180); M.update(); out.allErasKeeps = calls.length; app.settings.musicAllEras = false;
      M.next = realNext; M.onEnded = realEnded; M.cur = null; M.audio.ctx = ctx0;
      M.tracks = keep;
    }
    const T = (id, mood, era) => ({ id, file: id + '.ogg', title: 'Track ' + id, artist: 'Test', era, mood, weight: 1 });
    M.tracks = [T('a', ['peaceful'], 'steam'), T('b', ['busy'], 'diesel'), T('c', ['night'], 'steam'), T('d', [], '')];
    // choice: mood ×3, era ×2
    M.setContext('peaceful', 'steam');
    out.scores = M.tracks.map((t) => M.score(t));
    M.shuffle = true; M.history = [];
    const n = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) { M.history = []; n[M.pick()]++; }
    out.picks = n;
    // repeat: one → the same again; off without shuffle → stop after the last
    const played = [];
    const realPlay = M.play.bind(M);
    M.play = (i) => { played.push(i); M.cur = { i, el: { pause() {}, play() { return Promise.resolve(); } }, src: { disconnect() {} }, gain: { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, disconnect() {} } }; M.paused = false; return true; };
    M.stop = () => { M.cur = null; };
    M.repeat = 'one'; M.play(2); played.length = 0; M.onEnded();
    out.one = played.slice();
    M.repeat = 'off'; M.shuffle = false; M.play(3); played.length = 0; M.onEnded();
    out.offEnd = { played: played.length, stopped: M.cur === null && M.paused };
    M.repeat = 'all'; M.play(3); played.length = 0; M.onEnded();
    out.allWrap = played.slice();
    M.play = realPlay;
    // settings: shuffle and repeat kept, playlist, now-playing toggle
    app.settings.music = true; M.shuffle = true; M.repeat = 'all';
    const ui = app.ui;
    ui.openPanel('settings');
    await new Promise((res) => setTimeout(res, 50));
    document.querySelector('[data-act="musicRepeat"]').click();
    document.querySelector('[data-act="musicShuffle"]').click();
    await new Promise((res) => setTimeout(res, 30));
    out.saved = { repeat: app.settings.musicRepeat, shuffle: app.settings.musicShuffle };
    out.rows = document.querySelectorAll('[data-act="musicPlay"]').length;
    out.toggle = !!document.querySelector('[data-key="nowPlaying"]');
    // now playing: a note when a track starts
    const before = document.querySelectorAll('.toast').length;
    M.onChange(M.tracks[1]);
    await new Promise((res) => setTimeout(res, 30));
    out.toast = [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Track b'));
    app.settings.nowPlaying = false;
    const n0 = document.querySelectorAll('.toast').length;
    M.onChange(M.tracks[2]);
    out.silent = ![...document.querySelectorAll('.toast')].slice(n0).some((t) => t.textContent.includes('Track c'));
    app.settings.nowPlaying = true;
    void before;
    ui.closePanel();
    M.tracks = []; M.cur = null;
    return out;
  });
  const masters = ['Early', 'Mid', 'Late'].reduce((n, d) => n + (fs.existsSync(path.join(ROOT, 'Music', d)) ? fs.readdirSync(path.join(ROOT, 'Music', d)).filter((f) => /\.wav$/i.test(f)).length : 0), 0);
  const missing = r.shippedList.filter((t) => !fs.existsSync(path.join(ROOT, 'assets', 'music', t.file)));
  const byPeriod = r.shippedList.reduce((m, t) => ((m[t.period] = (m[t.period] || 0) + 1), m), {});
  check(r.shipped > 0 && r.shipped === masters && !missing.length, `every music master ships as a track: ${r.shipped} of ${masters} (early ${byPeriod.early || 0}, mid ${byPeriod.mid || 0}, late ${byPeriod.late || 0})${missing.length ? '; missing ' + missing.map((t) => t.file).join(', ') : ''}`);
  check(r.shippedList.every((t) => t.period && t.years && t.years[0] <= t.years[1]), 'every track names its period and years');
  check(r.decoded && r.decoded.seconds > 10 && r.decoded.ch === 2, `a shipped track decodes in the browser (${JSON.stringify(r.decoded)})`);
  check(r.periods.y1925 === 'early' && r.periods.y1975 === 'mid' && r.periods.y2010 === 'late', `the music follows the calendar: 1925 ${r.periods.y1925}, 1975 ${r.periods.y1975}, 2010 ${r.periods.y2010}`);
  check(r.periods.all1925 === 'early,late,mid' && r.periods.title === 'early,late,mid', `"music of all eras" and the title screen play every period (${r.periods.all1925} / ${r.periods.title})`);
  check(r.periodName === 'mid', `the settings name the current period (${r.periodName})`);
  check(r.midway === 0 && r.nearEnd.join() === 'ended', `the next track fades in 4 s before the current one ends, not earlier (${r.midway} / ${r.nearEnd.join()})`);
  check(r.newPeriodEarly === 0 && r.newPeriodLater.join() === 'next' && r.allErasKeeps === 0, `a new period crossfades into its music after a few seconds (and not with "all eras") (${r.newPeriodEarly} / ${r.newPeriodLater.join()} / ${r.allErasKeeps})`);
  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  check(!/assets\/music\/[^']+\.webm'/.test(sw) && /const MUSIC = 'tracklands-music-/.test(sw), 'the service worker leaves the music out of the release download and keeps played tracks in a cache of their own');
  check(r.scores.join() === '6,1,2,1', `track weights by mood and era: ${r.scores.join(', ')}`);
  check(r.picks[0] > r.picks[2] && r.picks[2] > r.picks[1] * 1.3, `the peaceful steam track comes up most (${r.picks.join('/')})`);
  check(r.one.join() === '2', 'repeat one plays the same track again');
  check(r.offEnd.played === 0 && r.offEnd.stopped, 'repeat off stops after the last track');
  check(r.allWrap.join() === '0', 'repeat all goes back to the first track');
  check(r.saved.repeat === 'one' && r.saved.shuffle === false, `shuffle and repeat are kept in the settings (${JSON.stringify(r.saved)})`);
  check(r.rows === 4 && r.toggle, `the playlist lists ${r.rows} tracks, with a now-playing switch`);
  check(r.toast && r.silent, 'a now-playing note when a track starts (and none when switched off)');
  if (errors.length) { ok = false; lines.push('errors: ' + errors.slice(0, 3).join(' | ')); }
  await ctx.close();
  return { ok, lines };
}
