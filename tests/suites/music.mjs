// Phase 8 music (creator-supplied tracks; none ship with the game): track
// choice by mood and era, shuffle and repeat kept in the settings, repeat one
// / all / off at the end of a track, the playlist and now-playing note in the
// settings. The tracks here are made up in the page; nothing is fetched.
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
  check(r.shipped === 0, 'no music ships with the game (the creator adds it)');
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
