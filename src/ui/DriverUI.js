// Driver mode: ride along with one train and set its power yourself. The
// camera follows the train closely; a panel shows speed, the current limit
// and the power lever (touch slider, or W / S and X to brake on a keyboard).
// Signals, stops and line speed limits still protect the train: the lever
// sets how much of the allowed speed the driver asks for.
import { KMH_PER_TILE_S } from '../config.js';
import { TILE, escapeHtml as esc } from '../util.js';
import { icon } from './icons.js';

export const DriverUIMixin = {
  startDrive(id) {
    const g = this.game, t = g.trains.byId(id);
    if (!t) return;
    if (this.driveId != null) this.stopDrive();
    this.driveId = id;
    t.drive = { throttle: 0.6, brake: false, limit: 0, vt: 0 };
    this.followId = id;
    this.closePanel();
    g.select(null);   // the cab panel replaces the inspector while driving
    const at = g.entityPos({ type: 'train', id });   // none while the train stands hidden in a depot
    if (at) g.camera.focus(at.x, at.z, 9);
    let el = document.getElementById('driver');
    if (!el) { el = document.createElement('div'); el.id = 'driver'; el.setAttribute('role', 'group'); document.body.appendChild(el); }
    el.innerHTML = `<div class="drv-head">${icon('train', 'mini')} <b>${esc(t.name)}</b><button class="icon-btn small" data-act="stopDrive" aria-label="${this.tr('drive_stop')}">${icon('close')}</button></div>
      <div class="drv-speed"><b id="drv-v">0</b><small>km/h</small><span id="drv-lim"></span></div>
      <label class="drv-lever"><span>${this.tr('drive_power')}</span><input type="range" min="0" max="100" step="5" value="60" data-input="driveThrottle" aria-label="${this.tr('drive_power')}"/></label>
      <div class="row"><button class="btn small" data-act="driveBrake" id="drv-brake">${this.tr('drive_brake')}</button><button class="btn ghost small" data-act="stopDrive">${this.tr('drive_stop')}</button></div>
      <small class="muted">${this.tr('drive_help')}</small>`;
    el.hidden = false;
    this.app.audio.play('whistle');
  },
  stopDrive() {
    const g = this.game, t = this.driveId != null && g ? g.trains.byId(this.driveId) : null;
    if (t) t.drive = null;
    this.driveId = null;
    this.followId = null;
    const el = document.getElementById('driver');
    if (el) el.hidden = true;
  },
  setThrottle(v) {
    const t = this.driveId != null ? this.game.trains.byId(this.driveId) : null;
    if (!t || !t.drive) return;
    t.drive.throttle = Math.max(0, Math.min(1, v));
    t.drive.brake = false;
    const r = document.querySelector('#driver input[type=range]');
    if (r) r.value = Math.round(t.drive.throttle * 100);
  },
  updateDriver() {
    if (this.driveId == null) return;
    const t = this.game.trains.byId(this.driveId);
    if (!t || !t.drive) { this.stopDrive(); return; }
    const kmh = (v) => Math.round((v / TILE) * KMH_PER_TILE_S);
    const a = document.getElementById('drv-v'), b = document.getElementById('drv-lim'), br = document.getElementById('drv-brake');
    if (a) a.textContent = kmh(t.v);
    if (b) b.textContent = t.drive.limit > 0.05 ? this.tr('drive_limit', { n: kmh(t.drive.limit) }) : this.tr('drive_stopped');
    if (br) br.classList.toggle('on', !!t.drive.brake);
  },
  driverActions() {
    return {
      drive: (a) => this.startDrive(+a),
      stopDrive: () => this.stopDrive(),
      driveBrake: () => { const t = this.driveId != null ? this.game.trains.byId(this.driveId) : null; if (t && t.drive) t.drive.brake = !t.drive.brake; },
    };
  },
  driverInputs() {
    return { driveThrottle: (el) => this.setThrottle(+el.value / 100) };
  },
};
