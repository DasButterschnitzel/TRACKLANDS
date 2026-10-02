// Background music from files the creator supplies: assets/music/music.json
// lists the tracks, the audio files sit next to it. Nothing is generated.
// Without tracks the game plays sound effects and ambience only.
//
// music.json:
//   { "tracks": [ { "id": "morning", "file": "morning.ogg", "title": "Morning Line",
//                   "artist": "…", "era": "steam", "mood": ["peaceful", "menu"], "weight": 1 } ] }
//
// Playlist with shuffle, next / previous, pause, volume (Settings), crossfade
// between tracks, metadata for the now-playing display, and moods: the next
// track is picked by weight, preferring tracks tagged with the current
// context (menu, peaceful, busy, night, winter, city, industrial) and the
// calendar era (steam, diesel, electric, modern, future). Repeat: all (the
// playlist goes on), one (the same track again) or off (stop at the end of
// the list when not shuffling). Shuffle and repeat are kept in the settings;
// a short "now playing" note shows when a track starts (setting).
//
// Periods: a track may name the calendar years it belongs to ("period":
// early / mid / late, "years": [from, to]). In a game only the tracks of the
// current year are played, unless the player turns on "music of all eras";
// when the calendar moves into a new period the music crossfades into it.
// The next track starts FADE seconds before the current one ends, so tracks
// always overlap instead of leaving a gap.
//
// Files are fetched whole and played from memory: the web version's service
// worker keeps every track it has played in a cache of its own (not in the
// release download), and seeking works the same everywhere.
const BASE = 'assets/music/';
const FADE = 4;          // seconds of crossfade

export class MusicManager {
  constructor(audio) {
    this.audio = audio;           // AudioEngine (context, music gain, settings)
    this.tracks = [];
    this.loaded = false;
    this.history = [];            // indices played, for "previous"
    this.cur = null;              // { i, el, src, gain }
    this.paused = false;
    this.shuffle = true;
    this.repeat = 'all';          // 'all' | 'one' | 'off'
    this.context = 'menu';
    this.era = '';
    this.year = null;             // the game's calendar year (null on the title screen)
    this.allEras = false;         // setting: music of all eras, whatever the year
    this.onChange = null;
  }

  // one load, shared by every caller (the first call may still be in flight)
  load() {
    if (!this._loading) this._loading = this.fetchList();
    return this._loading;
  }
  async fetchList() {
    this.loaded = true;
    try {
      const r = await fetch(BASE + 'music.json', { cache: 'no-cache' });
      if (!r.ok) return this.tracks;
      const d = await r.json();
      this.tracks = (Array.isArray(d.tracks) ? d.tracks : []).filter((t) => t && typeof t.file === 'string' && /^[\w\-. ]+\.(ogg|mp3|m4a|opus|wav|webm)$/i.test(t.file)).map((t, i) => ({
        id: String(t.id || 'track' + i), file: t.file, title: String(t.title || t.file), artist: String(t.artist || ''), era: String(t.era || ''),
        mood: Array.isArray(t.mood) ? t.mood.map(String) : t.mood ? [String(t.mood)] : [], weight: Math.max(0.05, +t.weight || 1),
        period: String(t.period || ''), years: Array.isArray(t.years) && t.years.length === 2 ? [+t.years[0], +t.years[1]] : null,
      }));
    } catch (e) { this.tracks = []; }
    return this.tracks;
  }
  has() { return this.tracks.length > 0; }
  nowPlaying() { return this.cur ? this.tracks[this.cur.i] : null; }

  // the context the game is in (menu, peaceful, busy, night, winter, city, industrial)
  setContext(ctx, era = this.era, year = this.year) { this.context = ctx; this.era = era || ''; this.year = year == null ? null : +year; }
  // a track fits now: always on the title screen or with "all eras";
  // otherwise when the calendar year lies in its years
  fits(t) { return !t.years || this.allEras || this.year == null || (this.year >= t.years[0] && this.year <= t.years[1]); }
  // the period name of the current year ('' when the tracks name none)
  period() { if (this.year == null) return ''; const t = this.tracks.find((x) => x.years && this.year >= x.years[0] && this.year <= x.years[1]); return t ? t.period : ''; }
  // how likely a track is now: its weight, ×3 for the current mood, ×2 for the era
  score(t) { return t.weight * (t.mood.includes(this.context) ? 3 : 1) * (this.era && t.era === this.era ? 2 : 1); }

  pick() {
    const n = this.tracks.length;
    if (!n) return -1;
    const fit = this.tracks.map((t) => this.fits(t));
    const any = fit.some(Boolean);
    const ok = (i) => !any || fit[i];
    if (!this.shuffle) { let i = this.cur ? this.cur.i : -1; for (let k = 0; k < n; k++) { i = (i + 1) % n; if (ok(i)) return i; } return 0; }
    const pool = fit.filter((f, i) => ok(i)).length;
    const recent = new Set(this.history.slice(-Math.min(Math.max(3, Math.floor(pool / 3)), pool - 1)));
    let sum = 0;
    const w = this.tracks.map((t, i) => { if (!ok(i) || recent.has(i)) return 0; const x = this.score(t); sum += x; return x; });
    if (sum <= 0) { const c = this.tracks.map((t, i) => i).filter(ok); return c[Math.floor(Math.random() * c.length)]; }
    let r = Math.random() * sum;
    for (let i = 0; i < n; i++) { r -= w[i]; if (r <= 0) return i; }
    return n - 1;
  }

  play(i = this.pick()) {
    const A = this.audio, c = A.ctx;
    if (!c || i < 0 || !this.tracks[i]) return false;
    const t = this.tracks[i];
    const el = new Audio();
    el.preload = 'auto';
    const url = BASE + encodeURIComponent(t.file);
    // whole file into memory (cached by the service worker on the web), then play
    const token = (this._token = (this._token || 0) + 1);
    fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status)))).then((b) => {
      if (!this.cur || this.cur.el !== el) return;
      el.src = URL.createObjectURL(b);
      this._fails = 0;
      if (!this.paused) el.play().catch(() => {});
    }).catch(() => {
      // offline and not cached yet, or a missing file: try again later, waiting longer each time
      if (this.cur && this.cur.el === el && token === this._token) { this.cur = null; this._fails = (this._fails || 0) + 1; this.paused = true; setTimeout(() => { this.paused = false; this.next(); }, Math.min(30000, 1000 * 2 ** this._fails)); }
    });
    let src;
    try { src = c.createMediaElementSource(el); } catch (e) { return false; }
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    src.connect(gain).connect(A.music);
    const now = c.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE);
    const old = this.cur;
    if (old) this.fadeOut(old);
    this.cur = { i, el, src, gain };
    this.history.push(i);
    if (this.history.length > 50) this.history.shift();
    el.addEventListener('ended', () => { if (this.cur && this.cur.el === el) this.onEnded(); });
    el.addEventListener('error', () => { if (el.src && this.cur && this.cur.el === el) { this.cur = null; setTimeout(() => this.next(), 1000); } });
    this.paused = false;
    if (this.onChange) this.onChange(t);
    return true;
  }
  fadeOut(x) {
    const c = this.audio.ctx, now = c.currentTime;
    try { x.gain.gain.cancelScheduledValues(now); x.gain.gain.setValueAtTime(x.gain.gain.value, now); x.gain.gain.linearRampToValueAtTime(0.0001, now + FADE); } catch (e) { /* closed */ }
    setTimeout(() => { try { x.el.pause(); x.src.disconnect(); x.gain.disconnect(); if (x.el.src.startsWith('blob:')) URL.revokeObjectURL(x.el.src); } catch (e) { /* gone */ } }, FADE * 1000 + 200);
  }
  // a track ended: again (repeat one), the next, or stop at the end of the list
  onEnded() {
    if (!this.cur) return;
    if (this.repeat === 'one') { this.play(this.cur.i); return; }
    if (this.repeat === 'off' && !this.shuffle && this.cur.i >= this.tracks.length - 1) { this.stop(); this.paused = true; if (this.onChange) this.onChange(null); return; }
    this.next();
  }
  cycleRepeat() { this.repeat = this.repeat === 'all' ? 'one' : this.repeat === 'one' ? 'off' : 'all'; return this.repeat; }
  next() { if (this.has()) this.play(this.pick()); }
  prev() {
    if (this.history.length < 2) return;
    this.history.pop();
    const i = this.history.pop();
    this.play(i);
  }
  pause() { if (this.cur) { this.cur.el.pause(); this.paused = true; if (this.onChange) this.onChange(this.nowPlaying()); } }
  resume() { if (this.cur) { if (this.cur.el.src) this.cur.el.play().catch(() => {}); this.paused = false; } else this.next(); }
  toggle() { if (this.paused || !this.cur) this.resume(); else this.pause(); }
  stop() { if (this.cur) { this.fadeOut(this.cur); this.cur = null; } }

  // called every frame: start when allowed, follow the music setting
  update() {
    const s = this.audio.game.settings;
    if (s.musicShuffle != null) this.shuffle = !!s.musicShuffle;
    if (s.musicRepeat) this.repeat = s.musicRepeat;
    this.allEras = !!s.musicAllEras;
    if (!this.has() || !this.audio.ctx) return;
    if (!s.music) { if (this.cur && !this.paused) this.pause(); return; }
    if (!this.cur && !this.paused) { this.next(); return; }
    const c = this.cur;
    if (!c || this.paused || c.leaving) return;
    const el = c.el, d = el.duration;
    // the next track fades in while this one fades out (no gap between tracks)
    if (d && isFinite(d) && d > FADE * 3 && el.currentTime > d - FADE - 0.3) { c.leaving = true; this.onEnded(); return; }
    // the calendar moved into another period: crossfade into its music
    // (after the track has played a little, so a boundary year cannot flap)
    if (!this.fits(this.tracks[c.i]) && el.currentTime > 8) { c.leaving = true; this.next(); }
  }
}
