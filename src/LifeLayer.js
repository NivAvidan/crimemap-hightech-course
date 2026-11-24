// Street-level 3D ambience rendered with three.js inside the MapLibre GL context:
// pedestrians walking on sidewalks, cars driving on the real road network and real OSM traffic lights.
// Purely decorative geographic background – carries NO crime data.
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import { ROAD_WIDTH } from './mapStyle.js';

const MIN_ZOOM = 15.2;
const RADIUS = 520; // meters around the camera target
const MAX_PEDS = 420, MAX_CARS = 150, MAX_LIGHTS = 160;
const PERSON_SCALE = 1.7, CAR_SCALE = 1.15, LIGHT_SCALE = 1.5;
const WALK = new Set(['minor', 'service', 'tertiary', 'secondary', 'primary', 'path', 'pedestrian']);
const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
const SHIRTS = [0xff5252, 0x40c4ff, 0xffd740, 0x69f0ae, 0xe040fb, 0xffffff, 0xff9100, 0x7c4dff, 0x26c6da, 0xf06292, 0xcfd8dc];
const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68642, 0x8d5524, 0xffdbac];
const CARS = [0xffffff, 0xd9dee5, 0x9aa5b1, 0x30363d, 0xc62828, 0x1565c0, 0xfdd835, 0x2e7d32, 0xff6f00, 0xeceff1];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const zUp = (g) => g.rotateX(Math.PI / 2);

export class LifeLayer {
  id = 'life-3d';
  type = 'custom';
  renderingMode = '3d';
  enabled = true;
  stats = { peds: 0, cars: 0, lights: 0 };
  onStats = null;

  onAdd(map, gl) {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.scene.add(new THREE.AmbientLight(0xcfe2ff, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-0.5, -0.8, 1.2);
    this.scene.add(sun);

    const lambert = (o = {}) => new THREE.MeshLambertMaterial(o);
    const basic = (o = {}) => new THREE.MeshBasicMaterial(o);
    const inst = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
      return m;
    };
    // ---- person (forward = +x, up = +z, feet at z=0)
    const leg = new THREE.BoxGeometry(0.15, 0.15, 0.82).translate(0, 0, -0.41);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 0.6).translate(0, 0, -0.3);
    this.P = {
      torso: inst(new THREE.BoxGeometry(0.26, 0.44, 0.62).translate(0, 0, 1.15), lambert(), MAX_PEDS),
      head: inst(new THREE.SphereGeometry(0.14, 10, 8).translate(0, 0, 1.62), lambert(), MAX_PEDS),
      legL: inst(leg, lambert({ color: 0x2b3a55 }), MAX_PEDS),
      legR: inst(leg, lambert({ color: 0x2b3a55 }), MAX_PEDS),
      armL: inst(arm, lambert(), MAX_PEDS),
      armR: inst(arm, lambert(), MAX_PEDS),
    };
    // ---- car
    this.C = {
      body: inst(new THREE.BoxGeometry(4.3, 1.8, 0.75).translate(0, 0, 0.62), lambert(), MAX_CARS),
      cabin: inst(new THREE.BoxGeometry(2.3, 1.6, 0.62).translate(-0.25, 0, 1.28), lambert({ color: 0x10202e }), MAX_CARS),
      wheels: inst(new THREE.BoxGeometry(3.0, 1.9, 0.5).translate(0, 0, 0.25), lambert({ color: 0x0a0d12 }), MAX_CARS),
      head: inst(new THREE.BoxGeometry(0.08, 1.5, 0.18).translate(2.16, 0, 0.72), basic({ color: 0xfff3c4 }), MAX_CARS),
      tail: inst(new THREE.BoxGeometry(0.08, 1.5, 0.16).translate(-2.16, 0, 0.74), basic({ color: 0xff1a1a }), MAX_CARS),
    };
    // ---- traffic light
    const lamp = new THREE.SphereGeometry(0.2, 10, 8);
    this.L = {
      pole: inst(zUp(new THREE.CylinderGeometry(0.07, 0.09, 3.3, 8)).translate(0, 0, 1.65), lambert({ color: 0x8794a6 }), MAX_LIGHTS),
      box: inst(new THREE.BoxGeometry(0.3, 0.3, 1.25).translate(0, 0, 3.85), lambert({ color: 0x151b24 }), MAX_LIGHTS),
      red: inst(lamp.clone().translate(0, 0, 4.25), basic(), MAX_LIGHTS),
      yellow: inst(lamp.clone().translate(0, 0, 3.85), basic(), MAX_LIGHTS),
      green: inst(lamp.clone().translate(0, 0, 3.45), basic(), MAX_LIGHTS),
    };
    this.peds = [];
    this.cars = [];
    this.lights = [];
    this.paths = [];
    this.origin = null;
    this.last = performance.now();
    this._m = new THREE.Matrix4(); this._a = new THREE.Matrix4(); this._b = new THREE.Matrix4(); this._c = new THREE.Color(); this._v = new THREE.Vector3();
    this.lightCache = new Map();
    this._onMove = () => this.maybeRebuild();
    map.on('moveend', this._onMove);
    map.on('sourcedata', (e) => { if (e.sourceId === 'omt' && e.isSourceLoaded && this.needPaths) this.maybeRebuild(true); });
    this.maybeRebuild(true);
  }

  setEnabled(v) {
    this.enabled = v;
    if (v) this.maybeRebuild(true); else this.clear();
    this.map?.triggerRepaint();
  }

  clear() {
    this.peds = []; this.cars = []; this.lights = []; this.paths = []; this.origin = null;
    for (const g of [this.P, this.C, this.L]) for (const m of Object.values(g)) m.count = 0;
    this.report();
  }
  report() {
    this.stats = { peds: this.peds.length, cars: this.cars.length, lights: this.lights.length, estimated: !!this.lightsEstimated, active: !!this.origin };
    this.onStats?.(this.stats);
  }

  maybeRebuild(force) {
    const map = this.map;
    if (!this.enabled) return;
    if (map.getZoom() < MIN_ZOOM) { if (this.origin) this.clear(); return; }
    const c = map.getCenter();
    if (!force && this.origin && this.paths.length) {
      const d = new maplibregl.LngLat(this.originLngLat[0], this.originLngLat[1]).distanceTo(c);
      if (d < 180) return;
    }
    this.rebuild(c);
  }

  rebuild(center) {
    const map = this.map;
    const mc = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
    const s = mc.meterInMercatorCoordinateUnits();
    this.origin = { x: mc.x, y: mc.y, s };
    this.originLngLat = [center.lng, center.lat];
    const toLocal = (lng, lat) => {
      const m = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
      return [(m.x - mc.x) / s, -(m.y - mc.y) / s];
    };
    this.toLocal = toLocal;
    // --- collect road polylines around the camera target
    const feats = map.querySourceFeatures('omt', { sourceLayer: 'transportation' });
    const paths = [];
    const R2 = RADIUS * RADIUS;
    for (const f of feats) {
      const p = f.properties;
      if (p.brunnel === 'tunnel' || !(WALK.has(p.class) || DRIVE.has(p.class))) continue;
      const g = f.geometry;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const line of lines) {
        let cur = [];
        const flush = () => {
          if (cur.length > 1) {
            const cum = [0];
            for (let i = 1; i < cur.length; i++) cum.push(cum[i - 1] + Math.hypot(cur[i][0] - cur[i - 1][0], cur[i][1] - cur[i - 1][1]));
            const len = cum[cum.length - 1];
            if (len > 6) paths.push({ pts: cur, cum, len, cls: p.class, w: ROAD_WIDTH[p.class] || 5, oneway: p.oneway === 1, stops: [] });
          }
          cur = [];
        };
        for (const [lng, lat] of line) {
          const q = toLocal(lng, lat);
          if (q[0] * q[0] + q[1] * q[1] <= R2) cur.push(q); else flush();
        }
        flush();
      }
    }
    this.paths = paths;
    this.needPaths = paths.length === 0;
    // endpoint connectivity (continue onto the next street at junctions / tile seams)
    const ends = new Map();
    const key = (p) => Math.round(p[0] / 3) + ':' + Math.round(p[1] / 3);
    for (const path of paths) {
      for (const atStart of [true, false]) {
        const k = key(atStart ? path.pts[0] : path.pts[path.pts.length - 1]);
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push({ path, atStart });
      }
    }
    this.ends = ends; this.endKey = key;

    const walk = paths.filter((p) => WALK.has(p.cls));
    const drive = paths.filter((p) => DRIVE.has(p.cls));
    const weighted = (list) => {
      const total = list.reduce((a, p) => a + p.len, 0);
      return { total, pick: () => { let r = Math.random() * total; for (const p of list) { if ((r -= p.len) <= 0) return p; } return list[list.length - 1]; } };
    };
    this.walkPick = weighted(walk); this.drivePick = weighted(drive);
    this.peds = [];
    const nP = walk.length ? Math.min(MAX_PEDS, Math.round(this.walkPick.total / 14)) : 0;
    for (let i = 0; i < nP; i++) {
      const path = this.walkPick.pick();
      const isPath = path.cls === 'path' || path.cls === 'pedestrian';
      this.peds.push({ path, d: Math.random() * path.len, dir: Math.random() < 0.5 ? 1 : -1, speed: rnd(1.0, 1.7), side: Math.random() < 0.5 ? 1 : -1,
        off: isPath ? rnd(0, 0.8) : path.w / 2 + rnd(1.0, 2.6), phase: Math.random() * 6.28, shirt: pick(SHIRTS), skin: pick(SKIN), h: rnd(0.9, 1.08), seg: 0 });
    }
    this.cars = [];
    const nC = drive.length ? Math.min(MAX_CARS, Math.round(this.drivePick.total / 55)) : 0;
    for (let i = 0; i < nC; i++) {
      const path = this.drivePick.pick();
      this.cars.push({ path, d: Math.random() * path.len, dir: path.oneway || Math.random() < 0.5 ? 1 : -1, v: 0, vmax: rnd(7, 13) * (path.cls === 'minor' ? 0.7 : 1), color: pick(CARS), seg: 0 });
    }
    // static per-instance colors
    this.peds.forEach((p, i) => {
      this.P.torso.setColorAt(i, this._c.setHex(p.shirt));
      this.P.head.setColorAt(i, this._c.setHex(p.skin));
      this.P.armL.setColorAt(i, this._c.setHex(p.shirt)); this.P.armR.setColorAt(i, this._c.setHex(p.shirt));
    });
    for (const k of ['torso', 'head', 'armL', 'armR']) if (this.P[k].instanceColor) this.P[k].instanceColor.needsUpdate = true;
    this.cars.forEach((c, i) => this.C.body.setColorAt(i, this._c.setHex(c.color)));
    if (this.C.body.instanceColor) this.C.body.instanceColor.needsUpdate = true;
    for (const m of Object.values(this.P)) m.count = this.peds.length;
    for (const m of Object.values(this.C)) m.count = this.cars.length;
    this.lights = [];
    for (const m of Object.values(this.L)) m.count = 0;
    this.loadLights(center);
    this.report();
    map.triggerRepaint();
  }

  // Traffic lights: real OSM signal nodes (via the local server proxy). Until/unless they arrive,
  // poles are placed at junctions of main roads derived from the map's road network (marked "estimated").
  junctionNodes() {
    const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
    const nodes = new Map();
    const key = (p) => Math.round(p[0] / 2.5) + ':' + Math.round(p[1] / 2.5);
    this.paths.forEach((path, pi) => {
      if (!DRIVE.has(path.cls) || path.cls === 'motorway') return;
      const major = MAJOR.has(path.cls);
      path.pts.forEach((p, i) => {
        const k = key(p);
        let n = nodes.get(k);
        if (!n) nodes.set(k, (n = { p, paths: new Set(), dirs: [], major: false, top: false }));
        n.paths.add(pi);
        if (major) n.major = true;
        if (major && path.cls !== 'tertiary') n.top = true;
        for (const j of [i - 1, i + 1]) {
          const q = path.pts[j];
          if (q) n.dirs.push((Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI) % Math.PI);
        }
      });
    });
    const cand = [];
    for (const n of nodes.values()) {
      if (!n.major || n.paths.size < 2 || n.dirs.length < 3) continue;
      // a real junction has roads crossing in clearly different directions (filters tile-seam duplicates)
      let cross = false;
      for (let i = 0; i < n.dirs.length && !cross; i++) for (let j = i + 1; j < n.dirs.length; j++) {
        const d = Math.abs(n.dirs[i] - n.dirs[j]);
        if (Math.min(d, Math.PI - d) > 0.6) { cross = true; break; }
      }
      if (cross) cand.push(n);
    }
    cand.sort((x, y) => y.top - x.top);
    const out = [];
    for (const n of cand) {
      if (out.some((o) => Math.hypot(o[0] - n.p[0], o[1] - n.p[1]) < 55)) continue;
      out.push(n.p);
    }
    return out;
  }

  setLights(points, estimated) {
    for (const path of this.paths) path.stops = [];
    const lights = [];
    for (const [x, y] of points) {
      if (x * x + y * y > RADIUS * RADIUS || lights.length >= MAX_LIGHTS) continue;
      // snap the pole to the curb of the nearest road and register a stop line for cars on it
      let best = null;
      for (const path of this.paths) {
        if (!DRIVE.has(path.cls)) continue;
        for (let i = 1; i < path.pts.length; i++) {
          const a = path.pts[i - 1], b = path.pts[i];
          const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
          const px = a[0] + dx * t, py = a[1] + dy * t, dist = Math.hypot(x - px, y - py);
          if (dist < 9) {
            const l = Math.sqrt(l2);
            path.stops.push({ d: path.cum[i - 1] + l * t, light: lights.length, axis: Math.abs(dx) > Math.abs(dy) ? 1 : 0 });
            if (!best || dist < best.dist) best = { dist, nx: -dy / l, ny: dx / l, w: path.w };
          }
        }
      }
      const off = best ? best.w / 2 + 1.2 : 0;
      lights.push({ x: x + (best ? best.nx * off : 0), y: y + (best ? best.ny * off : 0), offset: Math.abs(x * 7.919 + y * 10.4729) % 24 });
    }
    this.lights = lights;
    this.lightsEstimated = estimated;
    const m = this._m;
    lights.forEach((l, i) => {
      m.makeScale(LIGHT_SCALE, LIGHT_SCALE, LIGHT_SCALE).setPosition(l.x, l.y, 0);
      for (const mesh of Object.values(this.L)) mesh.setMatrixAt(i, m);
    });
    for (const mesh of Object.values(this.L)) { mesh.count = lights.length; mesh.instanceMatrix.needsUpdate = true; }
    this.report();
    this.map.triggerRepaint();
  }

  async loadLights(center) {
    this.setLights(this.junctionNodes(), true);
    const cx = Math.floor(center.lng / 0.03), cy = Math.floor(center.lat / 0.03);
    const k = cx + ',' + cy;
    let nodes = this.lightCache.get(k);
    if (!nodes) {
      try {
        const r = await fetch(`/api/osm/signals?cx=${cx}&cy=${cy}`, { signal: AbortSignal.timeout(70000) });
        if (r.ok) { nodes = (await r.json()).nodes; this.lightCache.set(k, nodes); }
      } catch { /* keep estimated junction lights */ }
    }
    if (!nodes?.length || !this.origin || !this.enabled) return;
    if (Math.floor(this.originLngLat[0] / 0.03) + ',' + Math.floor(this.originLngLat[1] / 0.03) !== k) return; // camera moved on
    this.setLights(nodes.map(([lng, lat]) => this.toLocal(lng, lat)), false);
  }

  // 0 = green, 1 = yellow, 2 = red for the given axis
  lightState(l, axis, t) {
    const ph = (t + l.offset + (axis ? 12 : 0)) % 24;
    return ph < 9.5 ? 0 : ph < 12 ? 1 : 2;
  }

  sample(agent, out) {
    const { pts, cum } = agent.path;
    let i = Math.min(agent.seg, pts.length - 2);
    while (i < pts.length - 2 && cum[i + 1] < agent.d) i++;
    while (i > 0 && cum[i] > agent.d) i--;
    agent.seg = i;
    const a = pts[i], b = pts[i + 1], l = cum[i + 1] - cum[i] || 1, t = (agent.d - cum[i]) / l;
    out.dx = ((b[0] - a[0]) / l) * agent.dir; out.dy = ((b[1] - a[1]) / l) * agent.dir;
    out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t;
  }

  // at the end of a street: continue to a connected one, otherwise turn around / respawn
  advance(agent, allow, respawn) {
    const path = agent.path;
    if (agent.d >= 0 && agent.d <= path.len) return;
    const end = agent.d > path.len ? path.pts[path.pts.length - 1] : path.pts[0];
    const options = (this.ends.get(this.endKey(end)) || []).filter((o) => o.path !== path && allow.has(o.path.cls));
    if (options.length) {
      const o = pick(options);
      agent.path = o.path; agent.dir = o.atStart ? 1 : -1; agent.d = o.atStart ? 0.01 : o.path.len - 0.01; agent.seg = 0;
      if (agent.off !== undefined) { const isPath = o.path.cls === 'path' || o.path.cls === 'pedestrian'; agent.off = isPath ? rnd(0, 0.8) : o.path.w / 2 + rnd(1.0, 2.6); }
    } else if (respawn) {
      const p = respawn();
      agent.path = p; agent.dir = p.oneway || Math.random() < 0.5 ? 1 : -1; agent.d = agent.dir > 0 ? 0.01 : p.len - 0.01; agent.seg = 0; agent.v = 0;
    } else {
      agent.dir *= -1; agent.side *= -1; agent.d = Math.max(0.01, Math.min(path.len - 0.01, agent.d));
    }
  }

  update(dt, t) {
    const o = {}, m = this._m, a = this._a, b = this._b;
    // ---- pedestrians
    const P = this.P;
    this.peds.forEach((p, i) => {
      p.d += p.speed * p.dir * dt;
      this.advance(p, WALK, null);
      this.sample(p, o);
      p.phase += dt * p.speed * 4.2;
      const sw = Math.sin(p.phase) * 0.62;
      const x = o.x - o.dy * p.side * p.off * p.dir, y = o.y + o.dx * p.side * p.off * p.dir;
      const sc = PERSON_SCALE * p.h;
      m.makeRotationZ(Math.atan2(o.dy, o.dx)); m.scale(this._v.set(sc, sc, sc)); m.setPosition(x, y, 0);
      P.torso.setMatrixAt(i, m); P.head.setMatrixAt(i, m);
      const limb = (mesh, ly, lz, ang) => { a.makeRotationY(ang).setPosition(0, ly, lz); b.multiplyMatrices(m, a); mesh.setMatrixAt(i, b); };
      limb(P.legL, 0.11, 0.84, sw); limb(P.legR, -0.11, 0.84, -sw);
      limb(P.armL, 0.28, 1.44, -sw * 0.8); limb(P.armR, -0.28, 1.44, sw * 0.8);
    });
    for (const mesh of Object.values(P)) mesh.instanceMatrix.needsUpdate = true;
    // ---- cars (right-hand traffic, stop at red lights)
    const C = this.C;
    this.cars.forEach((c, i) => {
      let target = c.vmax;
      for (const st of c.path.stops) {
        const ahead = (st.d - c.d) * c.dir;
        if (ahead > 4 && ahead < 22 && this.lights[st.light] && this.lightState(this.lights[st.light], st.axis, t) !== 0) { target = 0; break; }
      }
      c.v += Math.max(-9 * dt, Math.min(3.5 * dt, target - c.v));
      if (c.v < 0) c.v = 0;
      c.d += c.v * c.dir * dt;
      this.advance(c, DRIVE, this.drivePick.pick);
      this.sample(c, o);
      const lane = c.path.oneway ? 0 : Math.min(c.path.w / 4, 2.2);
      m.makeRotationZ(Math.atan2(o.dy, o.dx)); m.scale(this._v.set(CAR_SCALE, CAR_SCALE, CAR_SCALE)); m.setPosition(o.x + o.dy * lane, o.y - o.dx * lane, 0);
      for (const mesh of Object.values(C)) mesh.setMatrixAt(i, m);
    });
    for (const mesh of Object.values(C)) mesh.instanceMatrix.needsUpdate = true;
    // ---- traffic lights (lamp colours)
    const L = this.L, col = this._c;
    this.lights.forEach((l, i) => {
      const st = this.lightState(l, 0, t);
      L.red.setColorAt(i, col.setHex(st === 2 ? 0xff1e1e : 0x3a0808));
      L.yellow.setColorAt(i, col.setHex(st === 1 ? 0xffc400 : 0x3a2c05));
      L.green.setColorAt(i, col.setHex(st === 0 ? 0x1fff6a : 0x06321a));
    });
    for (const k of ['red', 'yellow', 'green']) if (L[k].instanceColor) L[k].instanceColor.needsUpdate = true;
  }

  render(gl, matrix) {
    if (!this.enabled || !this.origin) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.update(dt, now / 1000);
    const o = this.origin;
    const proj = new THREE.Matrix4().fromArray(matrix.defaultProjectionData?.mainMatrix || matrix);
    const local = new THREE.Matrix4().makeTranslation(o.x, o.y, 0).scale(new THREE.Vector3(o.s, -o.s, o.s));
    this.camera.projectionMatrix = proj.multiply(local);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  onRemove() {
    this.map.off('moveend', this._onMove);
  }
}
