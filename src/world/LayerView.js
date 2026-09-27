// What the camera shows of the layers (Phase 11): SURFACE (the world as it
// is, tunnels hidden), UNDERGROUND (the ground, buildings and trees fade to a
// faint outline and the tunnels, metro stations and trains below appear) or
// ALL (both, the surface half faded). The view never changes the simulation.
export const LAYER_VIEWS = ['surface', 'underground', 'all'];
const FADE = { surface: 1, underground: 0.16, all: 0.5 };

export class LayerView {
  constructor(game) {
    this.game = game;
    this.mode = 'surface';
    this._t = 0;
  }
  set(mode) {
    if (!LAYER_VIEWS.includes(mode)) mode = 'surface';
    if (mode === this.mode) return;
    this.mode = mode;
    this.apply();
    this.game.events.emit('layerView', mode);
  }
  cycle() { this.set(LAYER_VIEWS[(LAYER_VIEWS.indexOf(this.mode) + 1) % LAYER_VIEWS.length]); }
  showsUnderground() { return this.mode !== 'surface'; }
  // the groups that fade: ground, water and trees, towns, industries, roads, decorations
  groups() {
    const g = this.game;
    return [g.world && g.world.view && g.world.view.group, g.towns && g.towns.group, g.industries && g.industries.group, g.roads && g.roads.group, g.decor && g.decor.group].filter(Boolean);
  }
  apply() {
    const g = this.game, f = FADE[this.mode];
    if (g.railView) g.railView.ugGroup.visible = this.mode !== 'surface';
    const seen = new Set();
    for (const grp of this.groups()) grp.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (seen.has(m)) continue;
        seen.add(m);
        const u = m.userData;
        if (u.lvOpacity === undefined) { u.lvOpacity = m.opacity; u.lvTransparent = m.transparent; u.lvDepthWrite = m.depthWrite; }
        if (f >= 1) { m.opacity = u.lvOpacity; m.transparent = u.lvTransparent; m.depthWrite = u.lvDepthWrite; }
        else { m.opacity = u.lvOpacity * f; m.transparent = true; m.depthWrite = false; }
        m.needsUpdate = true;
      }
    });
  }
  // new meshes (a growing town, a new industry) take the current fade
  update(dt) {
    if (this.mode === 'surface') return;
    this._t -= dt;
    if (this._t <= 0) { this._t = 1.5; this.apply(); }
  }
}
