// Performance overlay (Phase 8): frame rate and where the frame time goes
// (simulation, visuals, rendering), draw calls, scene memory and vehicle
// counts, each against a budget. Toggled in Settings → Graphics or with F3.
// Reads only numbers the game already has; nothing leaves the device.

// budgets in ms per frame (a 30 fps floor on phones leaves 33 ms)
export const PERF_BUDGET = { frame: 33, sim: 8, vis: 6, render: 14, calls: 900 };

const WIN = 120;
export class PerfStats {
  constructor() { this.buf = { frame: [], sim: [], vis: [], render: [] }; }
  add(k, ms) { const b = this.buf[k]; b.push(ms); if (b.length > WIN) b.shift(); }
  avg(k) { const b = this.buf[k]; return b.length ? b.reduce((a, x) => a + x, 0) / b.length : 0; }
  p95(k) { const b = this.buf[k].slice().sort((a, c) => a - c); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * 0.95))] : 0; }
  // a summary: averages and p95 per part, render info, memory, over-budget parts
  report(g) {
    const r = g.renderer.info || { render: {}, memory: {} };
    const out = {
      fps: this.avg('frame') > 0 ? 1000 / this.avg('frame') : 0,
      frame: this.avg('frame'), frame95: this.p95('frame'),
      sim: this.avg('sim'), vis: this.avg('vis'), render: this.avg('render'),
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
      + `${p.map}² · ${p.trains} trains · ${p.road} road`;
  }
}
