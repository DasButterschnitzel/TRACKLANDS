// Performance overlay (Phase 8): frame rate and where the frame time goes
// (simulation, visuals, rendering), draw calls, scene memory and vehicle
// counts, each against a budget. Toggled in Settings → Graphics or with F3.
// Reads only numbers the game already has; nothing leaves the device.

// budgets in ms per frame (a 30 fps floor on phones leaves 33 ms)
export const PERF_BUDGET = { frame: 33, sim: 8, vis: 6, render: 14, calls: 900 };

const WIN = 120;
export class PerfStats {
  constructor() { this.buf = { frame: [], sim: [], vis: [], render: [] }; this.sub = {}; }
  // the simulation's parts per frame (Game.tick)
  addSub(o) { for (const k in o) { const b = this.sub[k] || (this.sub[k] = []); b.push(o[k]); if (b.length > WIN) b.shift(); } }
  subAvg() { const out = {}; for (const k in this.sub) { const b = this.sub[k]; out[k] = b.length ? b.reduce((a, x) => a + x, 0) / b.length : 0; } return out; }
  // percentile of a part (sim, frame …) over the window
  pct(k, q) { const b = this.buf[k].slice().sort((a, c) => a - c); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * q))] : 0; }
  add(k, ms) { const b = this.buf[k]; b.push(ms); if (b.length > WIN) b.shift(); }
  avg(k) { const b = this.buf[k]; return b.length ? b.reduce((a, x) => a + x, 0) / b.length : 0; }
  p95(k) { const b = this.buf[k].slice().sort((a, c) => a - c); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * 0.95))] : 0; }
  // a summary: averages and p95 per part, render info, memory, over-budget parts
  report(g) {
    const r = g.renderer.info || { render: {}, memory: {} };
    const out = {
      fps: this.avg('frame') > 0 ? 1000 / this.avg('frame') : 0,
      frame: this.avg('frame'), frame95: this.p95('frame'),
      sim: this.avg('sim'), sim95: this.pct('sim', 0.95), sim99: this.pct('sim', 0.99), vis: this.avg('vis'), render: this.avg('render'),
      sub: this.subAvg(),
      calls: r.render.calls || 0, tris: r.render.triangles || 0,
      geos: r.memory.geometries || 0, texs: r.memory.textures || 0,
      heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
      trains: g.trains.trains.length, road: g.roads ? g.roads.vehicles.length : 0, map: g.mapSize,
    };
    out.over = ['sim', 'vis', 'render', 'calls'].filter((k) => out[k] > PERF_BUDGET[k]);
    if (out.frame95 > PERF_BUDGET.frame) out.over.unshift('frame');
    return out;
  }
}

export class PerfHud {
  constructor() { this.el = null; this.t = 0; }
  show(on) {
    if (on && !this.el) { this.el = document.createElement('div'); this.el.id = 'perf-hud'; this.el.setAttribute('aria-hidden', 'true'); document.body.appendChild(this.el); }
    if (!on && this.el) { this.el.remove(); this.el = null; }
  }
  update(dt, g) {
    if (!this.el) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const p = g.perf.report(g);
    const bad = (k, v) => (v > PERF_BUDGET[k] ? ' class="over"' : '');
    const f = (v) => v.toFixed(1);
    this.el.innerHTML = `<b>${Math.round(p.fps)} fps</b> · <span${bad('frame', p.frame95)}>p95 ${f(p.frame95)} ms</span><br>`
      + `sim <span${bad('sim', p.sim)}>${f(p.sim)}</span> · vis <span${bad('vis', p.vis)}>${f(p.vis)}</span> · gpu <span${bad('render', p.render)}>${f(p.render)}</span> ms<br>`
      + `<span${bad('calls', p.calls)}>${p.calls} calls</span> · ${Math.round(p.tris / 1000)}k tris<br>`
      + `${p.geos} geo · ${p.texs} tex${p.heap != null ? ` · ${Math.round(p.heap)} MB` : ''}<br>`
      + `${p.map}² · ${p.trains} trains · ${p.road} road`
      + this.detail(g, p);
  }
  // developer detail: the simulation by part and what the scene holds by
  // look (read from caches the game keeps; nothing is scanned per frame)
  detail(g, p) {
    const f = (v) => v.toFixed(2);
    const S = p.sub || {};
    const parts = ['trains', 'road', 'traffic', 'towns', 'industries', 'passengers', 'cargo', 'ai', 'weather', 'other'].map((k) => `${k} ${f(S[k] || 0)}`).join(' · ');
    const R = g.roads, RV = g.railView, X = g.crossings;
    const rs = RV && RV.statsTotal ? RV.statsTotal() : null;
    const looks = R && R.termMeshes ? [...R.termMeshes.keys()].map((k) => k.split(':').slice(0, 2).join(':')) : [];
    const air = new Set(looks.filter((k) => k.startsWith('airport')).map((k) => k.split(':')[1])), port = new Set(looks.filter((k) => k.startsWith('dock')).map((k) => k.split(':')[1]));
    const xf = X && X.fams ? Object.entries(X.fams).filter(([, F]) => F.posts && F.posts.count).map(([k]) => k) : [];
    return `<br><small>sim p95 ${f(p.sim95 || 0)} · p99 ${f(p.sim99 || 0)} ms<br>${parts}<br>`
      + `cars ${g.traffic ? g.traffic.cars.length : 0} · looks ${looks.length + (R && R.stopEraMeshes ? R.stopEraMeshes.size : 0)} (air ${[...air].join('/') || '–'}, port ${[...port].join('/') || '–'})<br>`
      + `crossings ${xf.join('/') || '–'}${rs ? ` · catenary ${rs.cat} · portals ${rs.portal} · metro ramps ${rs.cut} · underground chunks ${rs.ugChunks}` : ''}</small>`;
  }
}
