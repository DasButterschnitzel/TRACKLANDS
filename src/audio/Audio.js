// Synthesized sound effects (UI and world), ambience layers, a voice budget so
// big networks never turn into noise, a continuous sound for the nearest
// trains, and background music from creator-supplied files (MusicManager).
import { MusicManager } from './MusicManager.js';
import { TILE, tileCX, tileCZ } from '../util.js';

// industry ambience by kind: filtered noise loop (gain, filter) and a low hum,
// plus a typical one-shot now and then
const AMB_PROFILE = {
  mine: { noise: 0.05, freq: 160, filter: 'lowpass', hum: 0.004, humF: 42, shot: 'clank' },
  factory: { noise: 0.03, freq: 900, filter: 'bandpass', hum: 0.008, humF: 55, shot: 'clank' },
  heavy: { noise: 0.05, freq: 260, filter: 'lowpass', hum: 0.012, humF: 48, shot: 'clank' },
  port: { noise: 0.05, freq: 520, filter: 'lowpass', hum: 0.002, humF: 70, shot: 'gull' },
  farm: { noise: 0.018, freq: 700, filter: 'lowpass', hum: 0, humF: 0, shot: 'moo' },
  forest: { noise: 0.02, freq: 1400, filter: 'highpass', hum: 0, humF: 0, shot: null },
  hum: { noise: 0.008, freq: 3000, filter: 'highpass', hum: 0.01, humF: 100, shot: null },
};
export function industryKind(type) {
  if (['MINE', 'COAL_MINE', 'QUARRY', 'COPPER_MINE', 'SAND_PIT', 'CLAY_PIT', 'OIL_FIELD'].includes(type)) return 'mine';
  if (['STEEL_MILL', 'POWER_PLANT', 'REFINERY', 'GAS_PLANT', 'CHEM_PLANT', 'CEMENT_WORKS'].includes(type)) return 'heavy';
  if (['PORT', 'FISHERY'].includes(type)) return 'port';
  if (['FARM', 'LIVESTOCK_FARM', 'DAIRY_FARM', 'ORCHARD'].includes(type)) return 'farm';
  if (type === 'FOREST') return 'forest';
  if (type === 'DATA_CENTER') return 'hum';
  return 'factory';
}

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.ready = false;
    this.lastPlay = {};
    this.musicMgr = new MusicManager(this);
    this.voices = [];          // end times of sounds playing (voice budget)
    this.trainVoice = null;    // continuous sound of the nearest train
  }

  // must be called from a user gesture
  unlock() {
    // Safari reports 'interrupted' after calls/Siri: resume from any non-running state
    if (this.ctx) { if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}); return; }
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
    this.musicMgr.load();
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
    // voice budget: world sounds give way when many are playing at once
    const tNow = this.ctx.currentTime;
    this.voices = this.voices.filter((e) => e > tNow);
    const limit = opts.world ? 8 : 16;
    if (this.voices.length >= limit) return;
    this.voices.push(tNow + (opts.dur || 0.6));
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
        } else if (opts.kind === 'diesel') {
          // two-tone air horn
          this.tone(311, 0.55, { type: 'sawtooth', gain: 0.018 * v, attack: 0.03, rev: 0.3 });
          this.tone(370, 0.55, { type: 'sawtooth', gain: 0.015 * v, attack: 0.03, rev: 0.3 });
          this.tone(311, 0.3, { type: 'sawtooth', gain: 0.014 * v, attack: 0.02, when: 0.65, rev: 0.3 });
        } else if (opts.kind === 'electric') {
          // bright three-note chime
          [523, 659, 784].forEach((f, k) => this.tone(f, 0.35, { type: 'square', gain: 0.012 * v, attack: 0.02, when: k * 0.05, rev: 0.35 }));
        } else {
          // high speed / maglev: smooth rising tone
          this.tone(660, 0.6, { type: 'triangle', gain: 0.03 * v, attack: 0.05, glide: 880, rev: 0.4 });
          this.tone(990, 0.5, { type: 'sine', gain: 0.015 * v, attack: 0.05, when: 0.05, rev: 0.4 });
        }
        break;
      }
      case 'confirm': this.tone(660, 0.08, { gain: 0.045 * v }); this.tone(990, 0.12, { gain: 0.04 * v, when: 0.07 }); break;
      case 'cancel': this.tone(520, 0.08, { type: 'triangle', gain: 0.035 * v, glide: 390 }); break;
      case 'purchase': [784, 988, 1175].forEach((f, k) => this.tone(f, 0.16, { gain: 0.04 * v, when: k * 0.06 })); this.noiseHit(0.08, { freq: 6000, q: 2, gain: 0.02 * v, when: 0.12 }); break;
      case 'loan': this.tone(392, 0.25, { type: 'triangle', gain: 0.04 * v }); this.tone(523, 0.3, { type: 'triangle', gain: 0.04 * v, when: 0.12 }); break;
      case 'demolish': this.noiseHit(0.5, { freq: 300, q: 0.6, type: 'lowpass', gain: 0.14 * v }); for (let k = 0; k < 4; k++) this.noiseHit(0.12, { freq: 1400 + k * 300, q: 1.5, gain: 0.04 * v, when: 0.08 + k * 0.07 }); break;
      case 'road': this.noiseHit(0.25, { freq: 700, q: 0.8, gain: 0.06 * v }); this.noiseHit(0.2, { freq: 400, q: 0.6, gain: 0.05 * v, when: 0.15 }); break;
      case 'station': this.play('construct', { vol: v }); this.tone(880, 0.3, { gain: 0.02 * v, when: 0.25, rev: 0.3 }); break;
      case 'barrier': this.tone(180, 0.35, { type: 'square', gain: 0.012 * v, glide: 140 }); break;
      case 'blade': this.noiseHit(0.05, { freq: 4200, q: 8, gain: 0.04 * v }); this.noiseHit(0.05, { freq: 3100, q: 8, gain: 0.03 * v, when: 0.12 }); break;
      case 'hornDiesel': for (const f of [311, 370]) this.tone(f, 0.9, { type: 'sawtooth', gain: 0.018 * v, attack: 0.05, rev: 0.3 }); break;
      case 'hornElectric': for (const f of [466, 587]) this.tone(f, 0.6, { type: 'square', gain: 0.012 * v, attack: 0.03, rev: 0.2 }); break;
      case 'brake': this.noiseHit(0.9, { freq: 5200, q: 12, gain: 0.025 * v, attack: 0.1 }); break;
      case 'coupler': this.noiseHit(0.06, { freq: 900, q: 3, gain: 0.1 * v }); this.noiseHit(0.08, { freq: 500, q: 2, gain: 0.07 * v, when: 0.05 }); break;
      case 'doors': this.noiseHit(0.35, { freq: 2200, q: 1.5, gain: 0.025 * v, attack: 0.05 }); this.tone(1320, 0.12, { gain: 0.015 * v, when: 0.35 }); break;
      case 'announce': [659, 523, 784].forEach((f, k) => this.tone(f, 0.45, { gain: 0.03 * v, when: k * 0.28, rev: 0.5 })); break;
      case 'busEngine': case 'truckEngine': this.tone(name === 'truckEngine' ? 58 : 72, 0.8, { type: 'sawtooth', gain: 0.02 * v, attack: 0.1, glide: name === 'truckEngine' ? 90 : 110 }); this.noiseHit(0.6, { freq: 200, q: 0.8, type: 'lowpass', gain: 0.04 * v }); break;
      case 'tramBell': for (let k = 0; k < 2; k++) this.tone(1760, 0.3, { type: 'triangle', gain: 0.03 * v, when: k * 0.22, rev: 0.3 }); break;
      // bus doors: an air hiss, the leaves sliding, a soft chime
      case 'busDoor': this.noiseHit(0.32, { freq: 3600, q: 1.2, gain: 0.03 * v, attack: 0.02 }); this.noiseHit(0.25, { freq: 900, q: 2, gain: 0.025 * v, when: 0.12 }); this.tone(988, 0.1, { gain: 0.012 * v, when: 0.4 }); break;
      case 'airBrake': this.noiseHit(0.5, { freq: 4200, q: 2.5, gain: 0.03 * v, attack: 0.01 }); this.noiseHit(0.2, { freq: 1500, q: 1, gain: 0.02 * v, when: 0.05 }); break;
      // horns: a pitch per call so a street never sounds like one car
      case 'hornCar': { const f = (opts.pitch || 1) * (400 + Math.random() * 120); this.tone(f, 0.18, { type: 'square', gain: 0.012 * v }); if (Math.random() < 0.5) this.tone(f, 0.12, { type: 'square', gain: 0.01 * v, when: 0.24 }); break; }
      case 'hornBus': { const f = (opts.pitch || 1) * (230 + Math.random() * 40); this.tone(f, 0.45, { type: 'sawtooth', gain: 0.014 * v, attack: 0.02 }); this.tone(f * 1.26, 0.45, { type: 'sawtooth', gain: 0.01 * v, attack: 0.02 }); break; }
      case 'heavyTruck': this.tone(46, 1.1, { type: 'sawtooth', gain: 0.025 * v, attack: 0.15, glide: 70 }); this.noiseHit(0.9, { freq: 160, q: 0.7, type: 'lowpass', gain: 0.06 * v }); for (let k = 0; k < 3; k++) this.noiseHit(0.05, { freq: 300, q: 2, gain: 0.03 * v, when: 0.5 + k * 0.07 }); break;
      // pedestrian crossing: the steady ticking beeps of the push-button box
      case 'pedCrossing': for (let k = 0; k < 6; k++) this.tone(2400, 0.03, { type: 'square', gain: 0.008 * v, when: k * 0.16 }); break;
      case 'crowd': for (let k = 0; k < 5; k++) this.noiseHit(0.22, { freq: 500 + Math.random() * 900, q: 3, gain: 0.012 * v, when: k * 0.09 + Math.random() * 0.05 }); break;
      case 'construction': for (let k = 0; k < 3; k++) { this.tone(1900 + Math.random() * 400, 0.05, { type: 'triangle', gain: 0.02 * v, when: k * 0.28 }); this.noiseHit(0.05, { freq: 2600, q: 5, gain: 0.02 * v, when: k * 0.28 }); } break;
      case 'clank': this.noiseHit(0.08, { freq: 1200 + Math.random() * 600, q: 6, gain: 0.03 * v }); this.tone(310 + Math.random() * 80, 0.18, { type: 'triangle', gain: 0.012 * v, when: 0.01 }); break;
      case 'gull': { const f = 1600 + Math.random() * 500; for (let k = 0; k < 3; k++) this.tone(f, 0.14, { gain: 0.01 * v, when: k * 0.2, glide: f * 0.72 }); break; }
      case 'moo': this.tone(140 + Math.random() * 30, 0.9, { type: 'sawtooth', gain: 0.01 * v, attack: 0.12, glide: 110 }); break;
      case 'shipHorn': this.tone(98, 1.8, { type: 'sawtooth', gain: 0.03 * v, attack: 0.2, rev: 0.6 }); break;
      case 'takeoff': case 'landing': this.noiseHit(2.4, { freq: name === 'takeoff' ? 900 : 600, q: 0.7, gain: 0.05 * v, attack: 0.6 }); break;
      case 'cityGrow': this.tone(523, 0.3, { type: 'triangle', gain: 0.02 * v, rev: 0.4 }); this.tone(784, 0.4, { type: 'triangle', gain: 0.02 * v, when: 0.1, rev: 0.4 }); break;
      case 'industryUp': [220, 277, 330, 440].forEach((f, k) => this.tone(f, 0.35, { type: 'square', gain: 0.018 * v, when: k * 0.09 })); break;
      case 'contract': [523, 659, 784, 1046].forEach((f, k) => this.tone(f, 0.3, { gain: 0.035 * v, when: k * 0.07, rev: 0.3 })); break;
      case 'approve': this.tone(587, 0.2, { gain: 0.035 * v }); this.tone(880, 0.35, { gain: 0.035 * v, when: 0.12 }); break;
      case 'reject': this.tone(392, 0.2, { type: 'triangle', gain: 0.04 * v }); this.tone(294, 0.35, { type: 'triangle', gain: 0.04 * v, when: 0.15 }); break;
      case 'thunder': this.noiseHit(2.6, { freq: 120, q: 0.5, type: 'lowpass', gain: 0.22 * v, attack: 0.03 }); this.noiseHit(1.2, { freq: 400, q: 0.6, type: 'lowpass', gain: 0.06 * v, when: 0.3 }); break;
      case 'crossing':
        // level crossing bell: a few bright strikes
        for (let k = 0; k < 4; k++) { this.tone(1480, 0.18, { type: 'triangle', gain: 0.035 * v, when: k * 0.36, rev: 0.2 }); this.tone(2960, 0.08, { gain: 0.01 * v, when: k * 0.36 }); }
        break;
      case 'switch':
        this.noiseHit(0.06, { freq: 3000, q: 6, gain: 0.05 * v });
        this.tone(220, 0.06, { type: 'square', gain: 0.02 * v, when: 0.03 });
        break;
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
    // world ambience: a fixed pool of loops (created once, only their gains
    // and filters move): town traffic, station crowds, the nearest industry
    this.trafficL = mk(420, 'lowpass', 0.7);
    this.crowdL = mk(900, 'bandpass', 0.9);
    this.industryL = mk(300, 'lowpass', 1);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 55; og.gain.value = 0;
    const of = c.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 180;
    o.connect(of).connect(og).connect(this.amb); o.start();
    this.industryHum = { o, g: og };
    this.ambT = 0; this.oneShotT = 3;
    this.scene = { traffic: 0, crowd: 0, build: 0, ind: null, indV: 0, lights: 0, jam: 0, zoom: 0 };
  }

  // What is around the camera, measured a few times a second: cars on the
  // town streets, waiting passengers at stations and stops, buildings going
  // up, the nearest industry and its kind. Everything fades with distance
  // and with zooming out, so a large city is subtly alive up close and the
  // map view stays quiet.
  sceneAround() {
    const g = this.game.g, out = { traffic: 0, crowd: 0, build: 0, ind: null, indV: 0, lights: 0, jam: 0, zoom: 0 };
    if (!g || !g.camera) return out;
    const cam = g.camera, vs = cam.viewSize;
    out.zoom = Math.max(0, Math.min(1, (42 - vs) / 30));
    if (out.zoom <= 0) return out;
    const T = g.traffic;
    if (T) {
      let n = 0, j = 0;
      for (const car of T.cars) {
        if (car.from == null || car.from < 0) continue;
        const v = g.near({ x: tileCX(car.from), z: tileCZ(car.from) });
        if (v <= 0) continue;
        n += v;
        if (car.wait > 1.5) j += v;
      }
      out.traffic = Math.min(1, n / 25); out.jam = Math.min(1, j / 6);
      for (const tile of T.lights.keys()) out.lights = Math.max(out.lights, g.near({ x: tileCX(tile), z: tileCZ(tile) }));
    }
    const wait = (s) => (s.stock && s.stock.PASSENGERS) || 0;
    for (const s of g.stations.list) if (s) out.crowd += g.near({ x: tileCX(s.tile), z: tileCZ(s.tile) }) * Math.min(80, wait(s));
    if (g.roads) for (const s of g.roads.stops) if (!s.owner) out.crowd += g.near({ x: tileCX(s.tile), z: tileCZ(s.tile) }) * Math.min(40, wait(s)) * 0.6;
    out.crowd = Math.min(1, out.crowd / 120);
    if (g.towns && g.towns.animating) for (const b of g.towns.animating) out.build = Math.max(out.build, g.near({ x: b.pos[0], z: b.pos[2] }));
    if (g.industries) for (const i of g.industries.list) {
      const v = g.near({ x: (i.x + 1) * TILE, z: (i.z + 1) * TILE });
      if (v > out.indV) { out.indV = v; out.ind = i; }
    }
    return out;
  }
  updateAmbience(dt) {
    const t = this.ctx.currentTime;
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 0.25;
      // (a half-built world must never break the frame: keep the last scene)
      try { const sc = this.sceneAround(); for (const k in sc) if (typeof sc[k] === 'number' && !isFinite(sc[k])) sc[k] = 0; this.scene = sc; } catch (e) { this.scene.zoom = 0; }
    }
    const S = this.scene, z = S.zoom;
    const pulse = 0.75 + 0.25 * Math.sin(t * 0.7) * Math.sin(t * 0.23);
    this.trafficL.g.gain.setTargetAtTime(0.05 * S.traffic * z * pulse, t, 0.6);
    this.trafficL.f.frequency.setTargetAtTime(320 + 260 * S.traffic, t, 0.6);
    this.crowdL.g.gain.setTargetAtTime(0.035 * S.crowd * z * (0.8 + 0.2 * Math.sin(t * 1.9)), t, 0.5);
    const prof = S.ind ? AMB_PROFILE[industryKind(S.ind.type)] : null;
    const iv = prof ? S.indV * z : 0;
    this.industryL.g.gain.setTargetAtTime(prof ? prof.noise * iv : 0, t, 0.6);
    if (prof) { this.industryL.f.frequency.setTargetAtTime(prof.freq, t, 0.4); this.industryL.f.type = prof.filter; }
    this.industryHum.g.gain.setTargetAtTime(prof ? prof.hum * iv : 0, t, 0.6);
    if (prof && prof.humF) this.industryHum.o.frequency.setTargetAtTime(prof.humF, t, 0.5);
    // occasional one-shots from the same scene (the voice budget still applies)
    this.oneShotT -= dt;
    if (this.oneShotT > 0 || z <= 0) return;
    this.oneShotT = 1.2 + Math.random() * 2.5;
    const r = Math.random();
    if (prof && iv > 0.3 && prof.shot && r < 0.4) this.play(prof.shot, { vol: iv, world: true });
    else if (S.build > 0.3 && r < 0.6) this.play('construction', { vol: S.build * z, world: true });
    else if (S.jam > 0.25 && r < 0.75) this.play(Math.random() < 0.3 ? 'hornBus' : 'hornCar', { vol: Math.min(1, S.jam) * z * 0.8, world: true });
    else if (S.lights > 0.5 && z > 0.5 && r < 0.9) this.play('pedCrossing', { vol: S.lights * z * 0.7, world: true, dur: 1 });
    else if (S.crowd > 0.3) this.play('crowd', { vol: S.crowd * z * 0.8, world: true });
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
    if (this.trafficL) this.updateAmbience(dt);
    this.updateTrainSound(dt);
    this.updateMusic();
  }

  // The nearest moving train (only one: a big network stays calm): steam
  // exhaust beats with the wheels and louder under power, a diesel engine
  // note that rises with power, an electric motor whine with speed, and the
  // rail joints clicking with speed. Volume follows distance and zoom.
  updateTrainSound(dt) {
    const g = this.game.g;
    if (!g || !g.trains || !g.near || this.game.settings.volSfx <= 0) return;
    let best = null, bv = 0.25;
    for (const t of g.trains.trains) {
      if (t.state !== 'run' || t.v < 0.3 || !t.visual) continue;
      const p = t.visual.cars[0].mesh.position;
      const n = g.near(p) * (1 - Math.min(0.6, g.camera.viewSize / 60));
      if (n > bv) { bv = n; best = t; }
    }
    const V = this.trainVoice;
    if (!best) { if (V) this.stopTrainVoice(); return; }
    const kind = best._st.model.kind;
    const spd = best.v;                         // world units / s
    const pull = Math.max(0, Math.min(1, (best.v - (best._lastV ?? best.v)) / Math.max(dt, 1e-3) * 2));
    best._lastV = best.v;
    const c = this.ctx, t = c.currentTime;
    if (kind.startsWith('steam')) {
      if (V) this.stopTrainVoice();
      // four beats per wheel turn; driving wheel ~1.4 m → beat interval
      this.chuffT = (this.chuffT || 0) - dt;
      if (this.chuffT <= 0) {
        this.chuffT = Math.max(0.09, 0.55 / (0.3 + spd));
        this.noiseHit(0.12, { freq: 800 + spd * 60, q: 0.9, gain: (0.02 + pull * 0.05) * bv, dest: this.sfx });
      }
    } else {
      if (!V || V.kind !== kind) {
        if (V) this.stopTrainVoice();
        const o = c.createOscillator(), f = c.createBiquadFilter(), gn = c.createGain();
        o.type = kind === 'electric' || kind === 'hst' || kind === 'maglev' ? 'sine' : 'sawtooth';
        f.type = 'lowpass'; f.frequency.value = 400;
        gn.gain.value = 0.0001;
        o.connect(f).connect(gn).connect(this.sfx);
        o.start();
        this.trainVoice = { kind, o, f, gn };
      }
      const E = this.trainVoice;
      const electric = E.o.type === 'sine';
      E.o.frequency.setTargetAtTime(electric ? 220 + spd * 90 : 48 + pull * 30 + spd * 4, t, 0.3);
      E.f.frequency.setTargetAtTime(electric ? 1800 : 300 + pull * 500, t, 0.3);
      E.gn.gain.setTargetAtTime((electric ? 0.006 : 0.012 + pull * 0.012) * bv, t, 0.3);
    }
    // rail joints: two clicks every rail length
    this.jointT = (this.jointT || 0) - dt * spd;
    if (this.jointT <= 0) {
      this.jointT = 1.8;
      this.noiseHit(0.03, { freq: 2600, q: 3, gain: 0.02 * bv, dest: this.sfx });
      this.noiseHit(0.03, { freq: 2300, q: 3, gain: 0.018 * bv, when: 0.09, dest: this.sfx });
    }
  }
  stopTrainVoice() {
    const V = this.trainVoice;
    this.trainVoice = null;
    if (!V) return;
    const t = this.ctx.currentTime;
    V.gn.gain.setTargetAtTime(0.0001, t, 0.2);
    V.o.stop(t + 0.8);
  }

  // ---------- music: creator-supplied tracks (MusicManager) ----------
  updateMusic() {
    const M = this.musicMgr;
    if (!M) return;
    const g = this.game.g;
    // mood from what is happening
    let ctx = 'menu';
    if (g) {
      const env = g.env, T = g.trains ? g.trains.trains.length : 0;
      const big = g.towns ? g.towns.list.some((t) => t.stage >= 4) : false;
      ctx = env && env.night > 0.5 ? 'night' : env && env.snow > 0.3 ? 'winter' : T >= 12 ? 'busy' : big ? 'city' : 'peaceful';
    }
    M.setContext(ctx);
    M.update();
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}); }
}
