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
// context (menu, peaceful, busy, night, winter, city, industrial).
const BASE = 'assets/music/';
const FADE = 3;          // seconds of crossfade

export class MusicManager {
  constructor(audio) {
    this.audio = audio;           // AudioEngine (context, music gain, settings)
    this.tracks = [];
    this.loaded = false;
    this.history = [];            // indices played, for "previous"
    this.cur = null;              // { i, el, src, gain }
    this.paused = false;
    this.shuffle = true;
    this.context = 'menu';
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
      }));
    } catch (e) { this.tracks = []; }
    return this.tracks;
  }
  has() { return this.tracks.length > 0; }
  nowPlaying() { return this.cur ? this.tracks[this.cur.i] : null; }

  // the context the game is in (menu, peaceful, busy, night, winter, city, industrial)
  setContext(ctx) { this.context = ctx; }

  pick() {
    const n = this.tracks.length;
    if (!n) return -1;
    if (!this.shuffle) return this.cur ? (this.cur.i + 1) % n : 0;
    const recent = new Set(this.history.slice(-Math.min(3, n - 1)));
    let sum = 0;
    const w = this.tracks.map((t, i) => { if (recent.has(i)) return 0; const x = t.weight * (t.mood.includes(this.context) ? 3 : 1); sum += x; return x; });
    if (sum <= 0) return Math.floor(Math.random() * n);
    let r = Math.random() * sum;
    for (let i = 0; i < n; i++) { r -= w[i]; if (r <= 0) return i; }
    return n - 1;
  }

  play(i = this.pick()) {
    const A = this.audio, c = A.ctx;
    if (!c || i < 0 || !this.tracks[i]) return false;
    const t = this.tracks[i];
    const el = new Audio(BASE + encodeURIComponent(t.file));
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
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
    el.addEventListener('ended', () => { if (this.cur && this.cur.el === el) this.next(); });
    el.addEventListener('error', () => { if (this.cur && this.cur.el === el) { this.cur = null; setTimeout(() => this.next(), 1000); } });
    el.play().catch(() => {});
    this.paused = false;
    if (this.onChange) this.onChange(t);
    return true;
  }
  fadeOut(x) {
    const c = this.audio.ctx, now = c.currentTime;
    try { x.gain.gain.cancelScheduledValues(now); x.gain.gain.setValueAtTime(x.gain.gain.value, now); x.gain.gain.linearRampToValueAtTime(0.0001, now + FADE); } catch (e) { /* closed */ }
    setTimeout(() => { try { x.el.pause(); x.src.disconnect(); x.gain.disconnect(); } catch (e) { /* gone */ } }, FADE * 1000 + 200);
  }
  next() { if (this.has()) this.play(this.pick()); }
  prev() {
    if (this.history.length < 2) return;
    this.history.pop();
    const i = this.history.pop();
    this.play(i);
  }
  pause() { if (this.cur) { this.cur.el.pause(); this.paused = true; if (this.onChange) this.onChange(this.nowPlaying()); } }
  resume() { if (this.cur) { this.cur.el.play().catch(() => {}); this.paused = false; } else this.next(); }
  toggle() { if (this.paused || !this.cur) this.resume(); else this.pause(); }
  stop() { if (this.cur) { this.fadeOut(this.cur); this.cur = null; } }

  // called every frame: start when allowed, follow the music setting
  update() {
    const s = this.audio.game.settings;
    if (!this.has() || !this.audio.ctx) return;
    if (!s.music) { if (this.cur && !this.paused) this.pause(); return; }
    if (!this.cur && !this.paused) this.next();
  }
}
