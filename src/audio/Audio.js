// Fully synthesized audio: UI and world sound effects, ambience layers and a
// soft generative music system. Nothing is loaded from files.
export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.ready = false;
    this.lastPlay = {};
    this.musicNext = 0;
    this.chordIdx = 0;
  }

  // must be called from a user gesture
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.ratio.value = 3;
    this.master.connect(this.comp).connect(c.destination);
    this.sfx = c.createGain(); this.music = c.createGain(); this.amb = c.createGain();
    this.sfx.connect(this.master); this.music.connect(this.master); this.amb.connect(this.master);
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(2.6);
    this.revGain = c.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain).connect(this.master);
    this.noise = this.noiseBuffer();
    this.applyVolumes();
    this.startAmbience();
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.game.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.volMaster, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.volSfx, t, 0.05);
    this.music.gain.setTargetAtTime(s.music ? s.volMusic * 0.55 : 0, t, 0.3);
    this.amb.gain.setTargetAtTime(s.volAmb * 0.6, t, 0.3);
  }

  impulse(sec) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }
  noiseBuffer() {
    const c = this.ctx, len = c.sampleRate * 2;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // ---------- primitives ----------
  tone(freq, dur, { type = 'sine', gain = 0.1, attack = 0.005, when = 0, dest, glide, rev = 0 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    if (rev) { const r = c.createGain(); r.gain.value = rev; g.connect(r).connect(this.reverb); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  noiseHit(dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.1, when = 0, dest, attack = 0.005 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    const minGap = { coin: 70, click: 40, chuff: 60 }[name] || 90;
    if (this.lastPlay[name] && now - this.lastPlay[name] < minGap) return;
    this.lastPlay[name] = now;
    const v = opts.vol ?? 1;
    switch (name) {
      case 'click': this.tone(880, 0.07, { gain: 0.05 * v, glide: 700 }); break;
      case 'hover': this.tone(1200, 0.04, { gain: 0.015 * v }); break;
      case 'open': this.tone(520, 0.12, { type: 'triangle', gain: 0.04 * v, glide: 780 }); break;
      case 'close': this.tone(700, 0.1, { type: 'triangle', gain: 0.035 * v, glide: 480 }); break;
      case 'coin':
        this.tone(1318, 0.18, { gain: 0.06 * v, rev: 0.2 });
        this.tone(1976, 0.3, { gain: 0.05 * v, when: 0.06, rev: 0.3 });
        break;
      case 'rail':
        this.noiseHit(0.12, { freq: 2400, q: 3, gain: 0.08 * v });
        this.tone(140, 0.15, { type: 'triangle', gain: 0.08 * v, glide: 90 });
        this.noiseHit(0.08, { freq: 3200, q: 4, gain: 0.05 * v, when: 0.09 });
        break;
      case 'construct':
        for (let k = 0; k < 3; k++) { this.noiseHit(0.16, { freq: 400, q: 0.8, type: 'lowpass', gain: 0.12 * v, when: k * 0.12 }); this.tone(110 - k * 10, 0.12, { type: 'triangle', gain: 0.07 * v, when: k * 0.12 }); }
        break;
      case 'bulldoze':
        this.noiseHit(0.4, { freq: 300, q: 0.7, type: 'lowpass', gain: 0.14 * v });
        this.tone(90, 0.3, { type: 'sawtooth', gain: 0.025 * v, glide: 50 });
        break;
      case 'whistle': {
        const steam = opts.kind === 'steam' || opts.kind === 'steam2';
        if (steam) {
          const c = this.ctx, t = c.currentTime;
          for (const f of [740, 932]) {
            const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
            o.type = 'sine'; o.frequency.value = f; lfo.frequency.value = 6; lg.gain.value = 6;
            lfo.connect(lg).connect(o.frequency);
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 * v, t + 0.06);
            g.gain.setValueAtTime(0.03 * v, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
            o.connect(g).connect(this.sfx); const r = c.createGain(); r.gain.value = 0.4; g.connect(r).connect(this.reverb);
            o.start(t); lfo.start(t); o.stop(t + 0.8); lfo.stop(t + 0.8);
          }
          this.noiseHit(0.7, { freq: 2600, q: 2, gain: 0.02 * v });
        } else {
          this.tone(311, 0.5, { type: 'sawtooth', gain: 0.018 * v, attack: 0.03, rev: 0.3 });
          this.tone(392, 0.5, { type: 'sawtooth', gain: 0.015 * v, attack: 0.03, rev: 0.3 });
        }
        break;
      }
      case 'chuff':
        for (let k = 0; k < 4; k++) this.noiseHit(0.1, { freq: 900, q: 0.8, gain: 0.05 * v, when: k * 0.18 });
        break;
      case 'arrive': this.tone(1046, 0.6, { gain: 0.04 * v, rev: 0.4 }); this.tone(2093, 0.4, { gain: 0.012 * v, rev: 0.4 }); break;
      case 'load': for (let k = 0; k < 2; k++) this.tone(180 + k * 40, 0.09, { type: 'triangle', gain: 0.05 * v, when: k * 0.1 }); break;
      case 'unload': for (let k = 0; k < 2; k++) this.tone(240 - k * 50, 0.09, { type: 'triangle', gain: 0.05 * v, when: k * 0.1 }); break;
      case 'townUp': {
        const notes = [523, 659, 784, 1046, 1318];
        notes.forEach((f, k) => this.tone(f, 1.2, { type: 'triangle', gain: 0.05 * v, when: k * 0.09, rev: 0.6 }));
        [261, 329, 392].forEach((f) => this.tone(f, 2.2, { type: 'sine', gain: 0.04 * v, attack: 0.2, rev: 0.6 }));
        break;
      }
      case 'levelUp': [392, 523, 659, 784].forEach((f, k) => this.tone(f, 0.5, { type: 'triangle', gain: 0.05 * v, when: k * 0.08, rev: 0.5 })); break;
      case 'research': [880, 1108, 1318, 1760].forEach((f, k) => this.tone(f, 0.7, { gain: 0.035 * v, when: k * 0.07, rev: 0.6 })); break;
      case 'region':
        this.noiseHit(2.2, { freq: 600, q: 0.5, type: 'lowpass', gain: 0.06 * v, attack: 0.9 });
        [196, 294, 392, 494, 587].forEach((f, k) => this.tone(f, 2.5, { type: 'triangle', gain: 0.035 * v, when: 0.3 + k * 0.12, attack: 0.3, rev: 0.7 }));
        break;
      case 'achievement': [392, 523, 659, 784, 1046].forEach((f, k) => this.tone(f, 0.45, { type: 'square', gain: 0.018 * v, when: k * 0.1, rev: 0.4 })); break;
      case 'error': this.tone(330, 0.14, { type: 'triangle', gain: 0.05 * v }); this.tone(262, 0.18, { type: 'triangle', gain: 0.05 * v, when: 0.1 }); break;
      case 'legend':
        [262, 330, 392, 523, 659, 784, 1046].forEach((f, k) => this.tone(f, 2.4, { type: 'triangle', gain: 0.04 * v, when: k * 0.15, rev: 0.8 }));
        break;
      default: break;
    }
  }

  // ---------- ambience ----------
  startAmbience() {
    const c = this.ctx;
    const mk = (freq, type, q) => {
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f).connect(g).connect(this.amb);
      s.start();
      return { s, f, g };
    };
    this.wind = mk(380, 'lowpass', 0.6);
    this.rainN = mk(2400, 'highpass', 0.4);
    this.hum = mk(90, 'lowpass', 2);
    this.birdT = 2;
  }

  update(dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const g = this.game, env = g.env;
    const t = this.ctx.currentTime;
    if (this.wind) {
      const w = 0.05 + 0.03 * Math.sin(t * 0.13) + (env ? env.cloudiness * 0.03 : 0);
      this.wind.g.gain.setTargetAtTime(w, t, 0.5);
      this.rainN.g.gain.setTargetAtTime(env ? (env.rain * 0.09 + env.snow * 0.02) : 0, t, 0.8);
      const moving = g.trains ? g.trains.trains.filter((tr) => tr.state === 'run' && tr.v > 0.5).length : 0;
      this.hum.g.gain.setTargetAtTime(Math.min(0.08, moving * 0.012), t, 0.6);
    }
    // birdsong during the day
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 2 + Math.random() * 6;
      if (env && env.night < 0.3 && env.rain < 0.3) {
        const base = 2600 + Math.random() * 1800;
        const n = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) this.tone(base, 0.08, { gain: 0.012, when: k * 0.11, glide: base * (1.2 + Math.random() * 0.3), dest: this.amb });
      }
    }
    this.updateMusic();
  }

  // ---------- generative music ----------
  updateMusic() {
    const c = this.ctx;
    if (!this.game.settings.music) return;
    const now = c.currentTime;
    if (now + 0.5 < this.musicNext) return;
    const start = Math.max(now + 0.05, this.musicNext);
    const CHORDS = [
      [261.6, 329.6, 392.0, 493.9], [220.0, 261.6, 329.6, 392.0], [174.6, 220.0, 261.6, 329.6], [196.0, 246.9, 293.7, 392.0],
      [261.6, 329.6, 392.0, 440.0], [220.0, 277.2, 329.6, 440.0], [174.6, 220.0, 261.6, 349.2], [196.0, 246.9, 293.7, 349.2],
    ];
    const lvl = this.game.progression ? this.game.progression.level : 1;
    const variant = lvl >= 12 ? 4 : 0;
    const chord = CHORDS[variant + (this.chordIdx % 4)];
    this.chordIdx++;
    const dur = 8;
    // pad
    for (const f of chord) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
      o.type = 'triangle'; o2.type = 'sine';
      o.frequency.value = f / 2; o2.frequency.value = f / 2 * 1.004;
      fl.type = 'lowpass'; fl.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.018, start + 2.5);
      g.gain.linearRampToValueAtTime(0.014, start + dur - 1);
      g.gain.linearRampToValueAtTime(0.0001, start + dur + 1.5);
      o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(this.music);
      const r = c.createGain(); r.gain.value = 0.8; g.connect(r).connect(this.reverb);
      o.start(start); o2.start(start); o.stop(start + dur + 2); o2.stop(start + dur + 2);
    }
    // gentle plucked melody, density grows with the network
    const scale = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5];
    const trains = this.game.trains ? this.game.trains.trains.length : 0;
    const notes = 2 + Math.min(4, Math.floor(trains / 2) + Math.floor(lvl / 10));
    for (let k = 0; k < notes; k++) {
      if (Math.random() < 0.35) continue;
      const when = start - now + 0.5 + Math.random() * (dur - 1);
      const f = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 0.5 : 1);
      this.tone(f, 1.4, { gain: 0.02, when, dest: this.music, rev: 0.7 });
    }
    // soft bass
    this.tone(chord[0] / 4, dur, { type: 'sine', gain: 0.03, when: start - now, attack: 1.2, dest: this.music });
    this.musicNext = start + dur;
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}
