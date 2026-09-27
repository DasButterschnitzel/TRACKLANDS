// Photo mode (Phase 8): the interface steps aside for a clean view of the
// world. A small bar takes a picture (a PNG saved on the device, nothing is
// uploaded), starts a slow cinematic camera that circles the view or follows
// the selected vehicle, shows or hides the name labels, and leaves the mode
// (also Esc or P). The game keeps running at its speed.
import { icon } from './icons.js';

const VEHICLES = ['train', 'roadveh'];

export const PhotoModeMixin = {
  photoOn() { return !!this._photo; },
  setPhoto(on) {
    const g = this.game;
    if (!g || on === !!this._photo) return;
    if (on) {
      this.closePanel();
      const sel = g.selection && VEHICLES.includes(g.selection.type) ? `${g.selection.type}:${g.selection.id}` : null;
      this._photo = { cine: false, labels: true, sel, t: 0 };
      document.body.classList.add('photo-mode');
      const bar = document.createElement('div');
      bar.id = 'photo-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', this.tr('photo_mode'));
      document.body.appendChild(bar);
      this.renderPhotoBar();
    } else {
      document.body.classList.remove('photo-mode', 'photo-nolabels');
      const bar = document.getElementById('photo-bar');
      if (bar) bar.remove();
      if (this._photo.cine && this._photo.sel && this.followId === this._photo.sel) this.followId = null;
      this._photo = null;
    }
  },
  renderPhotoBar() {
    const bar = document.getElementById('photo-bar'), P = this._photo;
    if (!bar || !P) return;
    bar.innerHTML = `<button class="btn primary" data-act="photoShot">${icon('camera', 'mini')} ${this.tr('photo_take')}</button>
      <button class="btn ${P.cine ? 'on' : ''}" data-act="photoCine" aria-pressed="${P.cine}">${icon('play', 'mini')} ${this.tr(P.sel ? 'photo_cine_follow' : 'photo_cine')}</button>
      <button class="btn ${P.labels ? '' : 'on'}" data-act="photoLabels" aria-pressed="${!P.labels}">${this.tr('photo_no_labels')}</button>
      <button class="btn ghost" data-act="photoExit" aria-label="${this.tr('photo_exit')}">${icon('close', 'mini')} ${this.tr('photo_exit')}</button>`;
  },
  // the cinematic camera: a slow turn around the view, or following the vehicle
  photoUpdate(dt) {
    const P = this._photo, g = this.game;
    if (!P || !P.cine) return;
    const C = g.camera;
    P.t += dt;
    C.azGoal += dt * 0.12;
    if (!P.sel) C.zoomGoal = Math.max(C.minZoom, Math.min(C.maxZoom, C.zoomGoal * (1 + Math.sin(P.t * 0.25) * 0.0015)));
  },
  // a picture of the world as it is now (without the interface)
  photoShot() {
    const g = this.game, cv = g.renderer.domElement;
    g.renderer.render(g.scene, g.camera.camera);
    const name = `tracklands-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const url = cv.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    const bar = document.getElementById('photo-bar');
    if (bar) { bar.classList.add('flash'); setTimeout(() => bar.classList.remove('flash'), 300); }
    this.app.audio.play('click');
    this._lastShot = { name, bytes: url.length };
    return this._lastShot;
  },
  photoActions() {
    return {
      photo: () => this.setPhoto(!this.photoOn()),
      photoExit: () => this.setPhoto(false),
      photoShot: () => { this.photoShot(); },
      photoCine: () => {
        const P = this._photo; if (!P) return;
        P.cine = !P.cine;
        if (P.sel) this.followId = P.cine ? P.sel : (this.followId === P.sel ? null : this.followId);
        this.renderPhotoBar();
      },
      photoLabels: () => { const P = this._photo; if (!P) return; P.labels = !P.labels; document.body.classList.toggle('photo-nolabels', !P.labels); this.renderPhotoBar(); },
    };
  },
};
