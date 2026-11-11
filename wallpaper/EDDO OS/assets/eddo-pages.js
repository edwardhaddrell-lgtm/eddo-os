// EDDO OS · extra pages: Garage (the XC60), Media (Plex + cartridge shelf), Network (signal map + NAS),
// Workshop (Bambu P1S, filament, print queue), Energy (Octopus, biggest users), plus the game-mode cockpit
// and the task-list touches (drag a task off to finish it, stale tasks sink and turn amber).
// Uses the Home Assistant connection from eddo-ha.js (window.eddoHA) and the tab registry (window.eddoTabs).
(() => {
  "use strict";
  if (!window.eddoTabs) return;
  const HA = () => window.eddoHA;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const call = (domain, service, data = {}) => HA() && HA().send({ type: "call_service", domain, service, service_data: data.service_data, target: data.target }).catch(() => {});
  const live = (x) => x && !/^(unknown|unavailable)$/.test(x.s);
  const n = (x) => (live(x) && Number.isFinite(+x.s) ? +x.s : null);
  const fmt = (v, d = 0) => (v == null ? "—" : (+v).toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
  const COL = { edge: 0x8fb9c2, ok: 0x5fe0a8, warn: 0xffb347, bad: 0xff5a4a, cyan: 0x7fd8ff };

  // ------------------------------------------------------------ Home Assistant state for the pages
  const S = new Map();   // entity_id -> { s, a, t }
  let REG = null, subscribed = new Set(), regAt = 0;
  const st = (id) => (id ? S.get(id) : null);
  function take(all) { for (const x of all || []) S.set(x.entity_id, { s: x.state, a: x.attributes || {}, t: Date.parse(x.last_updated) || 0 }); }
  function onEnt(ev) {
    for (const [id, v] of Object.entries(ev.a || {})) S.set(id, { s: v.s, a: v.a || {}, t: (v.lu || v.lc || 0) * 1000 });
    for (const [id, v] of Object.entries(ev.c || {})) {
      const cur = S.get(id) || { s: "", a: {}, t: 0 };
      if (v["+"]) { if ("s" in v["+"]) cur.s = v["+"].s; if (v["+"].a) cur.a = Object.assign({}, cur.a, v["+"].a); cur.t = (v["+"].lu || v["+"].lc || 0) * 1000 || Date.now(); }
      S.set(id, cur);
    }
    dirty = true;
  }
  function watch(ids) {
    const fresh = [...new Set(ids.filter((id) => id && !subscribed.has(id)))]; if (!fresh.length || !HA()) return;
    fresh.forEach((id) => subscribed.add(id));
    HA().subscribe({ type: "subscribe_entities", entity_ids: fresh }, onEnt).catch(() => fresh.forEach((id) => subscribed.delete(id)));
  }
  // registry snapshot (areas, devices, entities) — refreshed at most every 5 minutes
  async function registry(force) {
    if (!HA() || !HA().send) return null;
    if (!force && REG && Date.now() - regAt < 5 * 60e3) return REG;
    const r = window.eddoHAReady;
    try {
      const all = await HA().send({ type: "get_states" }); take(all);
      if (r) REG = { ...r, allStates: all };
      else {
        const [areas, devices, ents] = await Promise.all([HA().send({ type: "config/area_registry/list" }), HA().send({ type: "config/device_registry/list" }), HA().send({ type: "config/entity_registry/list" })]);
        REG = { areas, devices, ents, allStates: all };
      }
      regAt = Date.now();
    } catch (_) {}
    return REG;
  }
  window.addEventListener("eddo-ha-ready", () => {
    regAt = 0; subscribed.clear();
    // a page that opened before Home Assistant connected finds its entities now
    setTimeout(async () => { const p = PAGES.find((x) => x.id === window.eddoTabs.active()); if (!p) return; await registry(); p.discover && p.discover(REG); if (p.build && !V3.running) show3D(p); dirty = true; }, 300);
  });
  let dirty = true;

  // ------------------------------------------------------------ shared 3D stage (behind the interface, like the House tab)
  const V3 = { T: null, renderer: null, canvas: null, labels: null, scene: null, camera: null, page: null, running: false, last: 0,
    view: { theta: 0.7, phi: 1.05, dist: 9, auto: true, tx: 0, ty: 0.6, tz: 0 }, tags: new Map(), built: new Map(), drag: null };
  async function ensureStage() {
    if (V3.renderer) return true;
    const T = V3.T || (window.eddoHouse && await window.eddoHouse.three()) || await import("./three-eddo-2.min.js").catch(() => null);
    if (!T) return false; V3.T = T;
    const stage = document.querySelector("#stage"); if (!stage) return false;
    V3.canvas = document.createElement("canvas"); V3.canvas.className = "eddo-page-canvas";
    V3.labels = document.createElement("div"); V3.labels.className = "eddo-page-labels";
    const anchor = stage.querySelector(".eddo-house-canvas") || stage.querySelector(".eddo-dim") || stage.querySelector(".scene-atmosphere");
    if (anchor) { anchor.after(V3.canvas); V3.canvas.after(V3.labels); } else { stage.prepend(V3.labels); stage.prepend(V3.canvas); }
    try { V3.renderer = new T.WebGLRenderer({ canvas: V3.canvas, antialias: true, alpha: true }); } catch (_) { return false; }
    V3.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    V3.camera = new T.PerspectiveCamera(32, 1, 0.1, 400);
    stage.addEventListener("pointerdown", (e) => {
      if (!V3.running || e.button !== 0 || e.target.closest("button,a,input,select,textarea,.workbench,.wb-overview,.eddo-ha,.eddo-srv,.eddo-pip,.system-footer,.system-nav,.brand")) return;
      V3.drag = { x: e.clientX, y: e.clientY, th: V3.view.theta, ph: V3.view.phi }; V3.view.auto = false;
    });
    window.addEventListener("pointermove", (e) => {
      const d = V3.drag; if (!d) return;
      V3.view.theta = d.th - (e.clientX - d.x) * 0.006; V3.view.phi = Math.max(0.35, Math.min(1.45, d.ph - (e.clientY - d.y) * 0.004));
    });
    window.addEventListener("pointerup", () => { if (V3.drag) { V3.drag = null; clearTimeout(V3.resume); V3.resume = setTimeout(() => { V3.view.auto = true; }, 8000); } });
    stage.addEventListener("wheel", (e) => {
      if (!V3.running || e.target.closest(".workbench,.wb-overview,.eddo-ha,.eddo-srv,.eddo-pip")) return;
      const p = V3.page; V3.view.dist = Math.max((p && p.minDist) || 4, Math.min((p && p.maxDist) || 30, V3.view.dist * (1 + Math.sign(e.deltaY) * 0.08)));
    }, { passive: true });
    return true;
  }
  function size() {
    const r = V3.renderer, c = V3.canvas; if (!r) return;
    const w = c.clientWidth || 1, h = c.clientHeight || 1;
    if (c.width !== Math.round(w * r.getPixelRatio()) || c.height !== Math.round(h * r.getPixelRatio())) r.setSize(w, h, false);
    V3.camera.aspect = w / h;
    if (document.documentElement.classList.contains("eddo-phone")) { const G = 1.5; V3.camera.setViewOffset(w, h * G, 0, h * (G - 1), w, h); }
    else V3.camera.setViewOffset(w * 1.24, h, w * 0.24, 0, w, h);   // centre in the space left of the panel
    V3.camera.updateProjectionMatrix();
  }
  function tag(key, x, y, z, html, show, cls = "") {
    let el = V3.tags.get(key);
    if (!show) { if (el) el.dataset.hidden = "true"; return; }
    if (!el) { el = document.createElement("div"); el.className = "eddo-page-tag " + cls; V3.labels.append(el); V3.tags.set(key, el); }
    const p = new V3.T.Vector3(x, y, z).project(V3.camera);
    if (p.z > 1) { el.dataset.hidden = "true"; return; }
    el.dataset.hidden = "false";
    el.style.transform = `translate(${((p.x * 0.5 + 0.5) * V3.canvas.clientWidth).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * V3.canvas.clientHeight).toFixed(1)}px)`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  function frame(now) {
    if (!V3.running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, V3.last ? (now - V3.last) / 1000 : 0.016); V3.last = now;
    const v = V3.view; if (v.auto) v.theta += dt * 0.12;
    const T = V3.T, cam = V3.camera;
    cam.position.set(v.tx + v.dist * Math.sin(v.phi) * Math.sin(v.theta), v.ty + v.dist * Math.cos(v.phi), v.tz + v.dist * Math.sin(v.phi) * Math.cos(v.theta));
    cam.lookAt(v.tx, v.ty, v.tz);
    size();
    const p = V3.page, g = p && V3.built.get(p.id);
    if (p && g && p.tick) p.tick(g, dt, now, T);
    V3.renderer.render(V3.scene, cam);
  }
  async function show3D(page) {
    if (!(await ensureStage())) return false;
    if (V3.page && V3.page !== page) hide3D();
    const T = V3.T;
    if (!V3.scene) V3.scene = new T.Scene();
    V3.scene.children.slice().forEach((c) => V3.scene.remove(c));
    let g = V3.built.get(page.id);
    if (!g) { g = new T.Group(); page.build(g, T); V3.built.set(page.id, g); }
    V3.scene.add(g);
    V3.page = page; Object.assign(V3.view, { theta: 0.7, phi: 1.05, auto: true }, page.view || {});
    V3.labels.innerHTML = ""; V3.tags.clear();
    document.querySelector("#stage")?.setAttribute("data-eddo-page", page.id);
    if (!V3.running) { V3.running = true; V3.last = 0; requestAnimationFrame(frame); }
    return true;
  }
  function hide3D() {
    V3.running = false; V3.page = null; V3.drag = null;
    document.querySelector("#stage")?.removeAttribute("data-eddo-page");
    if (V3.labels) { V3.labels.innerHTML = ""; V3.tags.clear(); }
  }
  const lineMat = (T, c, o) => new T.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
  const segs = (T, pts, c, o) => { const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); return new T.LineSegments(g, lineMat(T, c, o)); };
  function ring(pts, cx, y, cz, r, n = 48, ax = "y") {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      if (ax === "y") pts.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, cx + Math.cos(b) * r, y, cz + Math.sin(b) * r);
      else pts.push(cx, y + Math.sin(a) * r, cz + Math.cos(a) * r, cx, y + Math.sin(b) * r, cz + Math.cos(b) * r);   // ring facing x
    }
    return pts;
  }
  function floorGrid(T, r = 6) {
    const pts = []; for (let k = 1; k <= 4; k++) ring(pts, 0, 0, 0, (r * k) / 4, 96);
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push(Math.cos(a) * r * 0.25, 0, Math.sin(a) * r * 0.25, Math.cos(a) * r, 0, Math.sin(a) * r); }
    return segs(T, pts, COL.edge, 0.12);
  }
  const card = (k, v, sub = "", attr = "") => `<div class="eddo-pg-stat"${attr}><span>${esc(k)}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
  const bar = (label, pct, right, warn) => `<div class="eddo-pg-bar"${warn ? ' data-warn="true"' : ""}><span>${esc(label)}</span><i><b style="width:${Math.max(0, Math.min(100, pct || 0))}%"></b></i><em>${right}</em></div>`;
  function spark(vals, w = 300, h = 54) {
    const v = vals.filter((p) => Number.isFinite(p[1])); if (v.length < 2) return `<p class="wb-muted eddo-pg-note">Not enough history yet.</p>`;
    const t0 = v[0][0], t1 = v[v.length - 1][0], lo = Math.min(...v.map((p) => p[1])), hi = Math.max(...v.map((p) => p[1])), rng = hi - lo || 1;
    const pts = v.map(([t, y]) => `${(((t - t0) / (t1 - t0 || 1)) * w).toFixed(1)},${(h - 4 - ((y - lo) / rng) * (h - 8)).toFixed(1)}`).join(" ");
    return `<svg class="eddo-pg-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"/><polygon points="0,${h} ${pts} ${w},${h}"/></svg><p class="eddo-pg-axis"><span>${fmt(lo)}</span><span>${fmt(hi)}</span></p>`;
  }
  async function history(id, hours) {
    if (!id || !HA()) return [];
    try {
      const r = await HA().send({ type: "history/history_during_period", start_time: new Date(Date.now() - hours * 3600e3).toISOString(), entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false });
      return ((r || {})[id] || []).map((x) => [((x.lu ?? x.lc) || 0) * 1000, +x.s]).filter((p) => Number.isFinite(p[1]));
    } catch (_) { return []; }
  }
  // each page draws into the tab panel; redraw on changes (at most twice a second)
  const PAGES = [];
  function page(def) {
    PAGES.push(def);
    window.eddoTabs.register({
      id: def.id, label: def.label, pos: def.pos,
      render(c) { def.el = c; c.innerHTML = `<div class="eddo-pg eddo-pg-${def.id}"><p class="wb-muted eddo-pg-note">Loading…</p></div>`; dirty = true; },
      async onShow() { await registry(); def.discover && def.discover(REG); if (def.build) show3D(def); dirty = true; def.onShow && def.onShow(); },
      onHide() { if (def.build) hide3D(); def.onHide && def.onHide(); },
    });
  }
  setInterval(() => {
    const id = window.eddoTabs.active(), p = PAGES.find((x) => x.id === id);
    if (!p || !p.el || !p.el.isConnected || !dirty) return;
    dirty = false;
    const box = p.el.querySelector(".eddo-pg"); if (!box) return;
    if (box.contains(document.activeElement) && document.activeElement.matches("input,textarea")) { dirty = true; return; }   // don't wipe what's being typed
    const html = p.panel();
    if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; p.after && p.after(box); }
  }, 500);
  setInterval(() => { dirty = true; }, 5000);

  // ============================================================ 1. GARAGE — the XC60
  const car = () => window.eddoHouse && window.eddoHouse.car;
  const GAR = { hist: [], histAt: 0, histId: null, marks: null };
  const posOf = (id) => {
    const k = String(id).toLowerCase();
    const fr = /front|_f_|^f|driver/.test(k) ? 1 : /rear|back|_r_/.test(k) ? -1 : 0, lr = /left|_l_|driver/.test(k) ? 1 : /right|_r(?:_|$)|passenger/.test(k) ? -1 : 0;
    return { fr, lr };
  };
  page({
    id: "garage", label: "Garage", pos: 2, view: { dist: 9.5, ty: 0.75, phi: 1.12 }, minDist: 5, maxDist: 16,
    discover() { const c = car(); if (!c) return; const V = c.V || {}; watch([...Object.values(c.ids || {}), ...(V.all || [])]); },
    build(g, T) {
      const M = window.EDDO_CAR_MODEL;
      g.add(floorGrid(T, 5));
      const dec = (k) => {
        if (!M || !M.groups[k]) return [];
        const bin = atob(M.groups[k]), q = new Int16Array(bin.length / 2);
        for (let i = 0; i < q.length; i++) q[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16;
        const out = new Array(q.length), f = M.span / 65535, mz = M.min[2] + M.span / 2;
        for (let i = 0; i < q.length; i += 3) { out[i] = (q[i] + 32768) * f + M.min[0]; out[i + 1] = (q[i + 1] + 32768) * f + M.min[1]; out[i + 2] = (q[i + 2] + 32768) * f + M.min[2] - mz; }
        return out;
      };
      const body = segs(T, [...dec("body"), ...dec("glass")], COL.edge, 0.5), wheels = segs(T, dec("wheels"), COL.edge, 0.35);
      const front = segs(T, dec("front"), 0xe8f4ff, 0.7), rear = segs(T, dec("rear"), 0xff4a3a, 0.6);
      g.add(body, wheels, front, rear);
      // markers: tyres (ring at each wheel), doors (box on each side), tailgate and bonnet
      const W = { x: 0.84, zf: 1.38, zr: -1.46, y: 0.37 };
      const mk = (pts, c) => { const s = segs(T, pts, c, 0); g.add(s); return s; };
      const tyre = (lr, fr) => mk(ring([], lr * (W.x + 0.06), W.y, fr > 0 ? W.zf : W.zr, 0.42, 40, "x"), COL.ok);
      const door = (lr, fr) => { const x = lr * 0.98, z0 = fr > 0 ? -0.05 : -1.05, z1 = fr > 0 ? 0.95 : -0.05; return mk([x, 0.45, z0, x, 0.45, z1, x, 0.45, z1, x, 1.05, z1, x, 1.05, z1, x, 1.05, z0, x, 1.05, z0, x, 0.45, z0], COL.warn); };
      GAR.marks = {
        tyres: { "1,1": tyre(1, 1), "-1,1": tyre(-1, 1), "1,-1": tyre(1, -1), "-1,-1": tyre(-1, -1) },
        doors: { "1,1": door(1, 1), "-1,1": door(-1, 1), "1,-1": door(1, -1), "-1,-1": door(-1, -1) },
        tail: mk([-0.7, 0.9, -2.36, 0.7, 0.9, -2.36, 0.7, 0.9, -2.36, 0.6, 1.4, -2.3, 0.6, 1.4, -2.3, -0.6, 1.4, -2.3, -0.6, 1.4, -2.3, -0.7, 0.9, -2.36], COL.warn),
        hood: mk([-0.7, 0.95, 1.2, 0.7, 0.95, 1.2, 0.7, 0.95, 1.2, 0.6, 0.85, 2.1, 0.6, 0.85, 2.1, -0.6, 0.85, 2.1, -0.6, 0.85, 2.1, -0.7, 0.95, 1.2], COL.warn),
        body, front, rear, W,
      };
    },
    tick(g, dt, now) {
      const c = car(), m = GAR.marks; if (!c || !m) return;
      const V = c.V || { doors: [], windows: [], tyres: [] }, on = (id) => { const x = (window.eddoHouse.states.get(id)) || st(id); return x && x.s === "on"; };
      const d = window.eddoHouse.carData(), pulse = 0.55 + 0.45 * Math.sin(now / 260);
      // tyres: green when fine, red when the car reports a problem
      const tyreBad = {}; for (const id of V.tyres || []) { const p = posOf(id); if (p.fr && p.lr) tyreBad[`${p.lr},${p.fr}`] = on(id); }
      for (const [k, s] of Object.entries(m.tyres)) { const bad = !!tyreBad[k]; s.material.color.setHex(bad ? COL.bad : COL.ok); s.material.opacity = bad ? pulse : (V.tyres || []).length ? 0.35 : 0; }
      const doorOpen = {}; let tail = false, hood = false;
      for (const id of V.doors || []) { const k = id.toLowerCase(); if (!on(id)) continue; if (/tailgate|boot|trunk/.test(k)) tail = true; else if (/hood|bonnet/.test(k)) hood = true; else { const p = posOf(id); doorOpen[`${p.lr},${p.fr}`] = true; } }
      for (const [k, s] of Object.entries(m.doors)) s.material.opacity = doorOpen[k] ? pulse : 0;
      m.tail.material.opacity = tail ? pulse : 0; m.hood.material.opacity = hood ? pulse : 0;
      m.body.material.opacity = d.locked === false ? 0.45 + 0.2 * pulse : 0.5;
      m.body.material.color.setHex(d.locked === false ? COL.warn : COL.edge);
      const lit = d.engine || /charging/i.test(d.chargeText || ""); m.front.material.opacity = lit ? 0.9 : 0.25; m.rear.material.opacity = lit ? 0.85 : 0.2;
      // labels at each wheel
      const W = m.W, lbl = { "1,1": "FL", "-1,1": "FR", "1,-1": "RL", "-1,-1": "RR" };
      for (const [k, s] of Object.entries(m.tyres)) {
        const [lr, fr] = k.split(",").map(Number);
        tag("t" + k, lr * (W.x + 0.25), 0.95, fr > 0 ? W.zf : W.zr, `<b>${lbl[k]}</b><span data-warn="${!!tyreBad[k]}">${tyreBad[k] ? "CHECK TYRE" : "OK"}</span>`, (V.tyres || []).length > 0);
      }
      tag("lock", 0, 2.05, 0, `<b>${d.locked === false ? "UNLOCKED" : d.locked ? "LOCKED" : "XC60"}</b><span>${d.home ? "ON THE DRIVE" : esc((d.where || "AWAY").toUpperCase())}</span>`, true, d.locked === false ? "eddo-page-tag-warn" : "");
      const openList = [...Object.keys(doorOpen).map((k) => ({ "1,1": "FRONT LEFT", "-1,1": "FRONT RIGHT", "1,-1": "REAR LEFT", "-1,-1": "REAR RIGHT" }[k] + " DOOR")), tail ? "TAILGATE" : "", hood ? "BONNET" : ""].filter(Boolean);
      tag("open", 0, 0.2, 2.9, `<b>${openList.length ? "OPEN" : ""}</b><span data-warn="true">${esc(openList.join(" · "))}</span>`, openList.length > 0);
    },
    async onShow() {
      const c = car(); if (!c) return;
      const id = (c.ids || {}).range || (c.V || {}).rangeFuel || (c.V || {}).rangeEv || (c.ids || {}).fuel;
      if (id && (id !== GAR.histId || Date.now() - GAR.histAt > 30 * 60e3)) { GAR.histId = id; GAR.histAt = Date.now(); GAR.hist = await history(id, 24 * 14); GAR.histUnit = (st(id) || window.eddoHouse.states.get(id) || { a: {} }).a.unit_of_measurement || ""; dirty = true; }
    },
    panel() {
      const H = window.eddoHouse; if (!H) return `<p class="wb-muted eddo-pg-note">The car comes from the House model, which hasn't loaded.</p>`;
      const d = H.carData(); if (!d.linked) return `<p class="wb-muted eddo-pg-note">No car found in Home Assistant.</p>`;
      const range = d.fuelRange ?? d.range, svc = [d.serviceMiles != null ? `${fmt(d.serviceMiles)} MI` : "", d.serviceTime || ""].filter(Boolean).join(" · ") || "—";
      const health = (d.health || []).filter(Boolean);
      const issues = [...d.openDoors.map((x) => x + " open"), ...d.openWindows.map((x) => x + " open"), ...d.tyreWarn, ...d.warnings];
      const u = String(GAR.histUnit || "").toLowerCase(), conv = u === "km" ? 0.621371 : 1;
      const btn = (act, label, ok = true) => ok ? `<button class="eddo-pg-btn" data-garage="${act}">${label}</button>` : "";
      return `<div class="wb-large">${range != null ? fmt(range) : "—"}<small>MILES OF RANGE</small></div>` +
        `<div class="eddo-pg-grid">${card("FUEL", d.fuel != null ? d.fuel + "%" : "—", d.fuelL != null ? fmt(d.fuelL, 0) + " L" : "")}${d.battery != null ? card("BATTERY", d.battery + "%", d.rangeEv != null ? fmt(d.rangeEv) + " mi electric" : d.charging ? "CHARGING" : d.plugged ? "PLUGGED IN" : "") : ""}` +
        `${card("ODOMETER", d.odometer != null ? fmt(d.odometer) : "—", "miles")}${card("SERVICE IN", svc)}${card("WHERE", d.home ? "Home" : esc(d.where || "Away"), d.last ? "seen " + ago(d.last) : "")}${card("LOCK", d.locked === false ? "Unlocked" : d.locked ? "Locked" : "—", "", d.locked === false ? ' data-warn="true"' : "")}</div>` +
        (issues.length ? `<p class="eddo-pg-alert">${esc(issues.join(" · ").toUpperCase())}</p>` : "") +
        (health.length ? `<p class="eddo-pg-h">HEALTH</p><div class="eddo-pg-chips">${health.map((h) => `<span data-ok="${h.ok}">${esc(h.name)}</span>`).join("")}</div>` : "") +
        `<p class="eddo-pg-h">RANGE · LAST 14 DAYS</p>${spark(GAR.hist.map(([t, v]) => [t, v * conv]))}` +
        `<div class="eddo-pg-btns">${btn(d.locked === false ? "lock" : "unlock", d.locked === false ? "LOCK" : H.car.confirmUnlock ? "TAP AGAIN TO UNLOCK" : "UNLOCK", !!d.lockId)}${btn("climaStart", "PRE-HEAT", !!d.btn.climaStart)}${btn("climaStop", "STOP CLIMATE", !!d.btn.climaStop)}${btn("flash", "FLASH LIGHTS", !!d.btn.flash)}</div>`;
    },
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-garage]"); if (!b || !window.eddoHouse) return;
    window.eddoHouse.carAction(b.dataset.garage); dirty = true; setTimeout(() => { dirty = true; }, 1600); setTimeout(() => { dirty = true; }, 4200);
  });

  // ============================================================ 2. MEDIA — Plex and the cartridge shelf
  const MED = { carts: [], cartAt: 0, cartBusy: false, cartId: "sensor.cartridge_player_cartridge_id", present: "binary_sensor.cartridge_player_cartridge_present", script: "cartridge_play_on_frame" };
  async function loadCarts() {
    if (MED.cartBusy || Date.now() - MED.cartAt < 10 * 60e3 || !REG) return;
    MED.cartBusy = true;
    const autos = REG.allStates.filter((x) => x.entity_id.startsWith("automation."));
    const out = [];
    await Promise.all(autos.map(async (a) => {
      try {
        const r = await HA().send({ type: "automation/config", entity_id: a.entity_id }), cfg = r && r.config; if (!cfg) return;
        const conds = [].concat(cfg.conditions || cfg.condition || []), acts = [].concat(cfg.actions || cfg.action || []);
        const cond = conds.find((c) => c && [].concat(c.entity_id || []).includes(MED.cartId)); if (!cond) return;
        const act = acts.find((x) => x && /cartridge_play/.test(String(x.action || x.service || ""))); if (!act) return;
        const data = act.data || {};
        out.push({ name: cfg.alias || a.attributes.friendly_name, tag: String(cond.state || ""), media: String(data.media_id ?? ""), action: String(act.action || act.service), data, auto: a.entity_id });
      } catch (_) {}
    }));
    out.sort((a, b) => a.name.localeCompare(b.name));
    MED.carts = out; MED.cartAt = Date.now(); MED.cartBusy = false; dirty = true;
  }
  const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  page({
    id: "media", label: "Media", pos: 3,
    discover(R) { if (!R) return; watch([MED.cartId, MED.present, ...R.allStates.filter((x) => x.entity_id.startsWith("media_player.")).map((x) => x.entity_id)]); loadCarts(); },
    panel() {
      const players = [...S.entries()].filter(([id, x]) => id.startsWith("media_player.") && /^(playing|paused)$/.test(x.s))
        .sort((a, b) => (a[1].s === "playing" ? 0 : 1) - (b[1].s === "playing" ? 0 : 1));
      const base = HA() ? HA().baseUrl() : "";
      const now = players.length ? players.map(([id, x]) => {
        const a = x.a, title = a.media_series_title ? `${a.media_series_title}` : a.media_title || a.app_name || "Playing", sub = a.media_series_title ? `S${a.media_season ?? "?"} · E${a.media_episode ?? "?"} · ${a.media_title || ""}` : a.media_artist || a.media_album_name || "";
        const pos = a.media_position != null && a.media_duration ? Math.min(100, (a.media_position / a.media_duration) * 100) : null;
        const where = String(a.friendly_name || id).replace(/^Plex \((.*)\)$/, "$1").replace(/^Plex for \w+ - /, "");
        return `<div class="eddo-pg-now" data-state="${x.s}">${a.entity_picture ? `<img src="${esc(base + a.entity_picture)}" alt="">` : `<div class="eddo-pg-cover">♫</div>`}` +
          `<div><small>${esc(x.s === "playing" ? "NOW PLAYING" : "PAUSED")} · ${esc(where.toUpperCase())}</small><b>${esc(title)}</b><em>${esc(sub)}</em>${pos != null ? `<i class="eddo-pg-prog"><s style="width:${pos.toFixed(1)}%"></s></i>` : ""}</div>` +
          `<button class="eddo-pg-btn" data-media="${esc(id)}">${x.s === "playing" ? "❚❚" : "▶"}</button></div>`;
      }).join("") : `<p class="wb-muted eddo-pg-note">Nothing playing.</p>`;
      const cur = st(MED.cartId), present = st(MED.present), inId = present && present.s === "on" && cur ? cur.s : "";
      const shelf = MED.carts.length ? `<div class="eddo-pg-shelf">${MED.carts.map((c, i) => `<button class="eddo-cart" data-cart="${i}" data-in="${c.tag === inId}" style="--h:${hue(c.name)}"><i></i><b>${esc(c.name)}</b><small>${c.tag === inId ? "IN THE PLAYER" : "PLAY ON FRAME"}</small></button>`).join("")}</div>`
        : `<p class="wb-muted eddo-pg-note">${MED.cartBusy || !MED.cartAt ? "Reading the cartridge automations…" : "No cartridge automations found."}</p>`;
      return `<p class="eddo-pg-h">ACROSS THE HOUSE</p>${now}<p class="eddo-pg-h">CARTRIDGE SHELF <span>${MED.carts.length}</span></p>${shelf}`;
    },
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest) return;
    const m = e.target.closest("[data-media]"); if (m) { call("media_player", "media_play_pause", { target: { entity_id: m.dataset.media } }); return; }
    const c = e.target.closest("[data-cart]"); if (!c) return;
    const cart = MED.carts[+c.dataset.cart]; if (!cart) return;
    const [dom, svc] = cart.action.split(".");
    c.dataset.busy = "true"; setTimeout(() => { c.dataset.busy = "false"; }, 2500);
    call(dom, svc, { service_data: cart.data });
  });

  // ============================================================ 3. NETWORK — signal map and the NAS
  const NET = { devs: [], areas: [], wan: null, ip: null, nas: {}, nodes: null };
  const rssiCol = (v) => (v == null ? COL.bad : v >= -60 ? COL.ok : v >= -72 ? COL.warn : COL.bad);
  page({
    id: "network", label: "Network", pos: 4, view: { dist: 15, ty: 0.4, phi: 0.95 }, minDist: 7, maxDist: 30,
    discover(R) {
      if (!R) return;
      const devById = new Map(R.devices.map((d) => [d.id, d])), areaName = new Map(R.areas.map((a) => [a.area_id, a.name]));
      const stOf = new Map(R.allStates.map((x) => [x.entity_id, x]));
      const sig = R.ents.filter((e) => !e.disabled_by && e.entity_id.startsWith("sensor.") && stOf.has(e.entity_id) && (() => { const a = stOf.get(e.entity_id).attributes; return a.device_class === "signal_strength" && /dbm/i.test(a.unit_of_measurement || ""); })());
      const byDev = new Map(); for (const e of sig) { const k = e.device_id || e.entity_id; if (!byDev.has(k) || /wi_?fi|rssi|signal/.test(e.entity_id)) byDev.set(k, e); }
      NET.devs = [...byDev.values()].map((e) => {
        const d = devById.get(e.device_id) || {}, area = areaName.get(e.area_id || d.area_id) || "Unassigned";
        return { id: e.entity_id, name: d.name_by_user || d.name || stOf.get(e.entity_id).attributes.friendly_name || e.entity_id, area };
      });
      const areas = [...new Set(NET.devs.map((d) => d.area))].sort(); NET.areas = areas;
      const f = (re) => { const x = R.allStates.find((s) => re.test(s.entity_id)); return x ? x.entity_id : null; };
      NET.wan = f(/^binary_sensor\.eero_wan_status$/) || f(/^binary_sensor\..*wan.*status/);
      NET.ip = f(/^sensor\.eero_external_ip$/) || f(/^sensor\..*external_ip/);
      const nf = (re) => f(new RegExp("^sensor\\.eddo_nas_" + re + "$"));
      NET.nas = { temp: nf("cpu_temperature"), cpu: nf("cpu_usage"), ram: nf("ram_usage"), array: nf("array_usage"), state: nf("array_state"), dcpu: nf("docker_total_cpu"), dmem: nf("docker_total_memory"), inb: nf("network_br0_inbound"), out: nf("network_br0_outbound"), up: nf("up_since"), upd: nf("container_updates_available"), cache: nf("disk_cache_usage"),
        disks: R.allStates.filter((s) => /^sensor\.eddo_nas_disk_disk\d+_usage$/.test(s.entity_id)).map((s) => s.entity_id) };
      watch([...NET.devs.map((d) => d.id), NET.wan, NET.ip, ...Object.values(NET.nas).flat()]);
      V3.built.delete("network"); if (V3.page && V3.page.id === "network") { const p = V3.page; V3.page = null; show3D(p); }
    },
    build(g, T) {
      g.add(floorGrid(T, 7.5));
      const core = new T.LineSegments(new T.EdgesGeometry(new T.SphereGeometry(0.7, 10, 6)), lineMat(T, COL.cyan, 0.8)); core.position.y = 1.6; g.add(core);
      const nodes = { core, areas: [], devs: [], links: null };
      const A = NET.areas.length || 1, R1 = 4.2, linkPts = [];
      NET.areas.forEach((name, i) => {
        const a = (i / A) * Math.PI * 2, x = Math.cos(a) * R1, z = Math.sin(a) * R1;
        const m = new T.LineSegments(new T.EdgesGeometry(new T.SphereGeometry(0.32, 4, 2)), lineMat(T, COL.edge, 0.7)); m.position.set(x, 0.9, z); g.add(m);
        nodes.areas.push({ name, m, x, z, a }); linkPts.push(0, 1.6, 0, x, 0.9, z);
      });
      for (const d of NET.devs) {
        const ar = nodes.areas.find((x) => x.name === d.area); if (!ar) continue;
        const sibs = NET.devs.filter((x) => x.area === d.area), k = sibs.indexOf(d);
        const m = new T.Mesh(new T.SphereGeometry(0.11, 4, 2), new T.MeshBasicMaterial({ color: COL.ok, transparent: true, opacity: 0.9, depthWrite: false })); g.add(m);
        nodes.devs.push({ d, m, ar, r: 0.75 + (k % 3) * 0.28, ph: (k / Math.max(1, sibs.length)) * Math.PI * 2, sp: 0.25 + (k % 4) * 0.06, y: 0.55 + (k % 5) * 0.16 });
      }
      nodes.links = segs(T, linkPts, COL.edge, 0.22); g.add(nodes.links);
      nodes.spokes = segs(T, new Array(nodes.devs.length * 6).fill(0), COL.edge, 0.12); g.add(nodes.spokes);
      NET.nodes = nodes;
    },
    tick(g, dt, now) {
      const N = NET.nodes; if (!N) return;
      const wan = st(NET.wan), up = !wan || wan.s === "on";
      N.core.rotation.y += dt * 0.4; N.core.material.color.setHex(up ? COL.cyan : COL.bad); N.core.material.opacity = up ? 0.8 : 0.5 + 0.5 * Math.sin(now / 200);
      tag("core", 0, 2.55, 0, `<b>INTERNET</b><span data-warn="${!up}">${up ? "ONLINE" : "DOWN"}${st(NET.ip) && live(st(NET.ip)) ? " · " + esc(st(NET.ip).s) : ""}</span>`, true);
      const sp = N.spokes.geometry.attributes.position.array;
      N.devs.forEach((o, i) => {
        const v = n(st(o.d.id)), off = !live(st(o.d.id)), a = o.ph + (now / 1000) * o.sp;
        const x = o.ar.x + Math.cos(a) * o.r, z = o.ar.z + Math.sin(a) * o.r;
        o.m.position.set(x, o.y, z); o.m.rotation.y += dt;
        o.m.material.color.setHex(off ? COL.bad : rssiCol(v)); o.m.material.opacity = off ? 0.4 + 0.5 * Math.abs(Math.sin(now / 300 + i)) : 0.9;
        sp.set([o.ar.x, 0.9, o.ar.z, x, o.y, z], i * 6);
        const weak = off || (v != null && v < -72);
        tag("d" + i, x, o.y + 0.32, z, `<b>${esc(o.d.name.toUpperCase())}</b><span data-warn="true">${off ? "OFFLINE" : v + " dBm"}</span>`, weak, "eddo-page-tag-sm");
      });
      N.spokes.geometry.attributes.position.needsUpdate = true;
      N.areas.forEach((ar, i) => { ar.m.rotation.y -= dt * 0.5; tag("a" + i, ar.x, 1.45, ar.z, `<b>${esc(ar.name.toUpperCase())}</b><span>${NET.devs.filter((d) => d.area === ar.name).length} DEVICES</span>`, true); });
    },
    panel() {
      const rows = NET.devs.map((d) => ({ d, v: n(st(d.id)), off: !live(st(d.id)) }));
      const good = rows.filter((r) => !r.off && r.v >= -60).length, ok = rows.filter((r) => !r.off && r.v < -60 && r.v >= -72).length, weak = rows.filter((r) => !r.off && r.v < -72).length, off = rows.filter((r) => r.off).length;
      const worst = rows.filter((r) => r.off || r.v < -66).sort((a, b) => (a.off ? -999 : a.v) - (b.off ? -999 : b.v)).slice(0, 7);
      const N = NET.nas, v = (k) => n(st(N[k]));
      const wan = st(NET.wan);
      const up = st(N.up), upDays = up && live(up) ? Math.floor((Date.now() - Date.parse(up.s)) / 864e5) : null;
      return `<div class="eddo-pg-grid">${card("INTERNET", !wan ? "—" : wan.s === "on" ? "Online" : "Down", st(NET.ip) && live(st(NET.ip)) ? esc(st(NET.ip).s) : "", wan && wan.s !== "on" ? ' data-warn="true"' : "")}${card("WI-FI DEVICES", rows.length, `${good} strong · ${ok} fair · ${weak} weak`)}${card("OFFLINE", off, off ? "need a look" : "all reporting", off ? ' data-warn="true"' : "")}</div>` +
        `<p class="eddo-pg-h">WEAKEST LINKS</p>${worst.length ? worst.map((r) => bar(r.d.name, r.off ? 0 : ((r.v + 95) / 55) * 100, r.off ? "OFFLINE" : r.v + " dBm", r.off || r.v < -72)).join("") : `<p class="wb-muted eddo-pg-note">Every device has a good signal.</p>`}` +
        `<p class="eddo-pg-h">EDDO-NAS ${st(N.state) && live(st(N.state)) ? `<span>ARRAY ${esc(st(N.state).s.toUpperCase())}</span>` : ""}</p>` +
        `<div class="eddo-pg-grid">${card("CPU", v("cpu") != null ? fmt(v("cpu")) + "%" : "—", v("temp") != null ? fmt(v("temp")) + "°C" : "", v("temp") >= 85 ? ' data-warn="true"' : "")}${card("RAM", v("ram") != null ? fmt(v("ram")) + "%" : "—")}${card("UP", upDays != null ? upDays + " d" : "—", v("upd") ? `${fmt(v("upd"))} container updates` : "")}</div>` +
        `${bar("ARRAY", v("array"), v("array") != null ? fmt(v("array")) + "%" : "—", v("array") >= 90)}${N.disks.map((id, i) => bar("DISK " + (i + 1), n(st(id)), n(st(id)) != null ? fmt(n(st(id))) + "%" : "—", n(st(id)) >= 90)).join("")}${bar("CACHE", v("cache"), v("cache") != null ? fmt(v("cache")) + "%" : "—")}` +
        `${bar("DOCKER CPU", v("dcpu"), v("dcpu") != null ? fmt(v("dcpu")) + "%" : "—")}${bar("DOCKER RAM", v("dmem"), v("dmem") != null ? fmt(v("dmem")) + "%" : "—")}` +
        `<p class="wb-muted eddo-pg-note">Network ↓ ${fmt(v("inb"), 2)} · ↑ ${fmt(v("out"), 2)} ${esc((st(N.inb) || { a: {} }).a.unit_of_measurement || "")}. The eeros don't report which device is on which eero to Home Assistant, so devices are grouped by room.</p>`;
    },
  });

  // ============================================================ 4. WORKSHOP — Bambu P1S, filament and the print queue
  const WS = { p: null, trays: [], queue: null, items: [], itemsAt: 0, obj: null };
  async function loadQueue(force) {
    if (!WS.queue || (!force && Date.now() - WS.itemsAt < 60e3)) return;
    WS.itemsAt = Date.now();
    try { const r = await HA().send({ type: "call_service", domain: "todo", service: "get_items", target: { entity_id: WS.queue }, return_response: true }); WS.items = ((r && r.response && r.response[WS.queue]) || {}).items || []; dirty = true; } catch (_) {}
  }
  page({
    id: "workshop", label: "Workshop", pos: 5, view: { dist: 8.5, ty: 1.4, phi: 1.12 }, minDist: 4, maxDist: 16,
    discover(R) {
      if (!R) return;
      const bam = R.ents.filter((e) => e.platform === "bambu_lab" && !e.disabled_by);
      const f = (re) => { const x = bam.find((e) => re.test(e.entity_id)); return x ? x.entity_id : null; };
      WS.p = bam.length ? { progress: f(/print_progress$/), status: f(/print_status$/), stage: f(/current_stage$/), task: f(/task_name$/), layer: f(/current_layer$/), layers: f(/total_layer_count$/), remain: f(/remaining_time$/), end: f(/end_time$/),
        nozzle: f(/nozzle_temperature$/), bed: f(/bed_temperature$/), nozzleT: f(/nozzle_target_temperature$/), bedT: f(/sensor\..*bed_target_temperature$/), hum: f(/ams_1_humidity$/), amsT: f(/ams_1_temperature$/), active: f(/active_tray$/), weight: f(/print_weight$/), online: f(/_online$/), light: f(/^light\..*chamber_light$/), cover: f(/^image\..*cover_image$/) } : null;
      WS.trays = bam.filter((e) => /_tray_\d+$|external_spool$/.test(e.entity_id) && e.entity_id.startsWith("sensor.")).map((e) => e.entity_id).sort();
      WS.queue = (R.allStates.find((s) => s.entity_id.startsWith("todo.") && /print/.test(s.entity_id + " " + String(s.attributes.friendly_name || "").toLowerCase())) || {}).entity_id || null;
      watch([...(WS.p ? Object.values(WS.p) : []), ...WS.trays, WS.queue]);
      loadQueue(true);
    },
    build(g, T) {
      g.add(floorGrid(T, 4.5));
      const s = 3.2, h = 3.4;   // the P1S: a box frame, the bed, the toolhead on its gantry
      g.add(new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(s, h, s)), lineMat(T, COL.edge, 0.45)).translateY(h / 2));
      const bed = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(s * 0.8, 0.06, s * 0.8)), lineMat(T, COL.edge, 0.7)); g.add(bed);
      const gridPts = []; for (let i = -4; i <= 4; i++) { const k = (i / 4) * s * 0.4; gridPts.push(k, 0, -s * 0.4, k, 0, s * 0.4, -s * 0.4, 0, k, s * 0.4, 0, k); }
      const bedGrid = segs(T, gridPts, COL.edge, 0.15); g.add(bedGrid);
      const gantry = segs(T, [-s / 2, 0, 0, s / 2, 0, 0], COL.edge, 0.6); g.add(gantry);
      const head = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(0.42, 0.5, 0.42)), lineMat(T, COL.cyan, 0.9)); g.add(head);
      // the part: stacked layer rings, revealed up to the progress
      const L = 60, objPts = [], r0 = 0.62;
      for (let i = 0; i < L; i++) { const y = (i / L) * 1.6, r = r0 * (1 - 0.35 * Math.sin((i / L) * Math.PI) * 0.6 + 0.1 * Math.sin(i / 3)); ring(objPts, 0, y, 0, r, 36); }
      const obj = segs(T, objPts, COL.cyan, 0.85); g.add(obj);
      // AMS spools beside it
      const spools = [];
      for (let i = 0; i < 4; i++) { const sp = segs(T, ring(ring([], 0, 0, 0, 0.36, 32, "x"), 0, 0, 0, 0.16, 20, "x"), COL.edge, 0.7); sp.position.set(-s / 2 - 0.9, 0.55 + i * 0.85, 0); g.add(sp); spools.push(sp); }
      WS.obj = { bed, bedGrid, gantry, head, obj, L, spools, perLayer: 36 * 2 * 3 };
    },
    tick(g, dt, now) {
      const o = WS.obj, P = WS.p; if (!o || !P) return;
      const prog = n(st(P.progress)) ?? 0, status = String((st(P.status) || {}).s || ""), printing = /running|printing|prepare/.test(status) || /print|heat|level|calib/.test(String((st(P.stage) || {}).s || "")) && !/idle|finish/.test(status);
      const done = /finish/.test(status), k = Math.max(0, Math.min(1, prog / 100));
      const bedY = 0.35, topY = bedY + 0.05 + 1.6 * k;
      o.bed.position.y = bedY; o.bedGrid.position.y = bedY + 0.035; o.obj.position.y = bedY + 0.04;
      o.obj.geometry.setDrawRange(0, Math.round(o.L * k) * 36 * 2);
      const act = String((st(P.active) || {}).s || ""), tray = WS.trays.find((id) => act && (id.endsWith(act) || (st(id) || { a: {} }).a.active)) || WS.trays.find((id) => (st(id) || { a: {} }).a.active);
      const colHex = tray && (st(tray) || { a: {} }).a.color ? parseInt(String(st(tray).a.color).slice(1, 7), 16) : COL.cyan;
      o.obj.material.color.setHex(colHex); o.obj.material.opacity = printing ? 0.9 : done ? 0.55 : 0.18;
      const hx = printing ? Math.sin(now / 180) * 0.5 : 0, hz = printing ? Math.cos(now / 240) * 0.45 : 0;
      o.gantry.position.y = topY + 0.3; o.head.position.set(hx, topY + 0.3 + 0.25, hz);
      o.head.material.opacity = printing ? 0.95 : 0.4;
      WS.trays.slice(0, 4).forEach((id, i) => {
        const t = st(id), sp = o.spools[i]; if (!sp || !t) return;
        const c = t.a.color ? parseInt(String(t.a.color).slice(1, 7), 16) : COL.edge, on = !!t.a.active;
        sp.material.color.setHex(t.a.empty ? 0x333333 : c); sp.material.opacity = on ? 0.95 : 0.55; if (on && printing) sp.rotation.x += dt * 1.5;
        tag("s" + i, sp.position.x - 0.1, sp.position.y + 0.42, 0, `<b>${esc(String(t.s || "EMPTY").toUpperCase())}</b><span>${on ? "FEEDING" : "SLOT " + (i + 1)}</span>`, true, "eddo-page-tag-sm");
      });
      const task = st(P.task);
      tag("job", 0, topY + 1.15, 0, `<b>${printing ? Math.round(prog) + "%" : done ? "DONE" : "IDLE"}</b><span>${esc(String(live(task) ? task.s : "").toUpperCase())}</span>`, true);
    },
    panel() {
      const P = WS.p; if (!P) return `<p class="wb-muted eddo-pg-note">No Bambu Lab printer in Home Assistant.</p>`;
      const prog = n(st(P.progress)), status = String((st(P.status) || {}).s || "—"), stage = String((st(P.stage) || {}).s || "").replace(/_/g, " ");
      const rem = n(st(P.remain)), end = st(P.end), task = st(P.task);
      const printing = /running|printing|prepare/.test(status);
      const trays = WS.trays.map((id) => st(id)).filter(Boolean);
      const items = WS.items.filter((i) => i.status === "needs_action"), doneN = WS.items.length - items.length;
      return `<div class="wb-large">${prog != null ? Math.round(prog) : "—"}<small>${printing ? "% PRINTED" : status === "finish" ? "% · FINISHED" : "% · " + esc(status.toUpperCase())}</small></div>` +
        `<p class="eddo-pg-task">${esc(live(task) ? task.s : "No job")}</p><i class="eddo-pg-prog"><s style="width:${prog || 0}%"></s></i>` +
        `<div class="eddo-pg-grid">${card("LAYER", `${fmt(n(st(P.layer)))} / ${fmt(n(st(P.layers)))}`, esc(stage.toUpperCase()))}${card("TIME LEFT", rem != null && printing ? (rem >= 1 ? `${Math.floor(rem)} h ${Math.round((rem % 1) * 60)} m` : `${Math.round(rem * 60)} min`) : "—", printing && live(end) ? "done " + new Date(end.s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "")}` +
        `${card("NOZZLE", fmt(n(st(P.nozzle))) + "°", n(st(P.nozzleT)) ? "→ " + fmt(n(st(P.nozzleT))) + "°" : "")}${card("BED", fmt(n(st(P.bed))) + "°", n(st(P.bedT)) ? "→ " + fmt(n(st(P.bedT))) + "°" : "")}${card("AMS", n(st(P.hum)) != null ? fmt(n(st(P.hum))) + "% RH" : "—", n(st(P.amsT)) != null ? fmt(n(st(P.amsT)), 1) + "°C" : "", n(st(P.hum)) >= 45 ? ' data-warn="true"' : "")}${card("WEIGHT", n(st(P.weight)) != null ? fmt(n(st(P.weight))) + " g" : "—", "this job")}</div>` +
        `<p class="eddo-pg-h">FILAMENT</p><div class="eddo-pg-trays">${trays.map((t) => `<div data-on="${!!t.a.active}" data-empty="${!!t.a.empty}"><i style="background:${esc(String(t.a.color || "#555").slice(0, 7))}"></i><b>${esc(t.a.empty ? "Empty" : t.s)}</b><small>${esc(t.a.type || "")}${t.a.remain >= 0 ? " · " + t.a.remain + "%" : ""}</small></div>`).join("")}</div>` +
        `<p class="eddo-pg-h">PRINT QUEUE ${WS.queue ? `<span>${items.length} TO PRINT${doneN ? ` · ${doneN} DONE` : ""}</span>` : ""}</p>` +
        (WS.queue ? `<div class="eddo-pg-queue">${items.map((i) => `<button data-q="${esc(i.uid)}"><i></i><b>${esc(i.summary)}</b>${i.description ? `<small>${esc(i.description)}</small>` : ""}</button>`).join("") || `<p class="wb-muted eddo-pg-note">Queue's empty.</p>`}</div><form class="eddo-pg-add" data-qadd><input name="t" placeholder="Add a model to print…" autocomplete="off"><button>ADD</button></form>`
          : `<p class="wb-muted eddo-pg-note">Make a to-do list called "Print queue" in Home Assistant and it shows up here.</p>`);
    },
  });
  document.addEventListener("click", (e) => {
    const q = e.target.closest && e.target.closest("[data-q]"); if (!q || !WS.queue) return;
    q.dataset.done = "true"; burst(q);
    HA().send({ type: "call_service", domain: "todo", service: "update_item", target: { entity_id: WS.queue }, service_data: { item: q.dataset.q, status: "completed" } }).catch(() => {}).finally(() => setTimeout(() => loadQueue(true), 600));
  });
  document.addEventListener("submit", (e) => {
    const f = e.target.closest && e.target.closest("[data-qadd]"); if (!f || !WS.queue) return;
    e.preventDefault(); const t = String(new FormData(f).get("t") || "").trim(); if (!t) return;
    f.reset();
    HA().send({ type: "call_service", domain: "todo", service: "add_item", target: { entity_id: WS.queue }, service_data: { item: t } }).catch(() => {}).finally(() => setTimeout(() => loadQueue(true), 500));
  });

  // ============================================================ 5. ENERGY — Octopus today vs yesterday, and the biggest users
  const EN = { e: {}, g: {}, power: [], hist: [], histAt: 0 };
  page({
    id: "energy", label: "Energy", pos: 6,
    discover(R) {
      if (!R) return;
      const f = (re) => { const x = R.allStates.find((s) => re.test(s.entity_id)); return x ? x.entity_id : null; };
      EN.e = { today: f(/^sensor\.octopus_energy_electricity_.*_current_accumulative_consumption$/), cost: f(/^sensor\.octopus_energy_electricity_.*_current_accumulative_cost$/), yday: f(/^sensor\.octopus_energy_electricity_.*_previous_accumulative_consumption$/), ycost: f(/^sensor\.octopus_energy_electricity_.*_previous_accumulative_cost$/),
        demand: f(/^sensor\.octopus_energy_electricity_.*_current_demand$/), rate: f(/^sensor\.octopus_energy_electricity_.*_current_rate$/), stand: f(/^sensor\.octopus_energy_electricity_.*_current_standing_charge$/), offpeak: f(/^binary_sensor\.octopus_energy_electricity_.*_off_peak$/) };
      EN.g = { today: f(/^sensor\.octopus_energy_gas_.*_current_accumulative_consumption_kwh$/), cost: f(/^sensor\.octopus_energy_gas_.*_current_accumulative_cost$/), yday: f(/^sensor\.octopus_energy_gas_.*_previous_accumulative_consumption_kwh$/), ycost: f(/^sensor\.octopus_energy_gas_.*_previous_accumulative_cost$/), rate: f(/^sensor\.octopus_energy_gas_.*_current_rate$/) };
      const devById = new Map(R.devices.map((d) => [d.id, d])), regOf = new Map(R.ents.map((e) => [e.entity_id, e]));
      EN.power = R.allStates.filter((s) => s.entity_id.startsWith("sensor.") && s.attributes.device_class === "power" && /^k?w$/i.test(s.attributes.unit_of_measurement || "") && !/octopus|eddo_nas|_cpu_|gpu|demand|grid|total|apparent|reactive/.test(s.entity_id) && !(regOf.get(s.entity_id) || {}).disabled_by)
        .map((s) => { const r = regOf.get(s.entity_id) || {}, d = devById.get(r.device_id) || {}; return { id: s.entity_id, name: d.name_by_user || d.name || s.attributes.friendly_name || s.entity_id }; });
      watch([...Object.values(EN.e), ...Object.values(EN.g), ...EN.power.map((p) => p.id)]);
    },
    async onShow() { if (EN.e.demand && Date.now() - EN.histAt > 10 * 60e3) { EN.histAt = Date.now(); EN.hist = await history(EN.e.demand, 24); dirty = true; } },
    panel() {
      const E = EN.e, G = EN.g, v = (id) => n(st(id));
      const cmp = (a, b) => { if (a == null || !b) return ""; const h = new Date().getHours() + new Date().getMinutes() / 60, pace = (a / Math.max(0.5, h)) * 24, d = Math.round(((pace - b) / b) * 100); return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}% vs yesterday's pace`; };
      const cost = (v(E.cost) || 0) + (v(G.cost) || 0), ycost = (v(E.ycost) || 0) + (v(G.ycost) || 0);
      const watts = (p) => { const x = st(p.id), val = n(x); if (val == null) return null; return /^kw$/i.test(x.a.unit_of_measurement || "") ? val * 1000 : val; };
      const top = EN.power.map((p) => ({ ...p, w: watts(p) })).filter((p) => p.w != null && p.w > 1).sort((a, b) => b.w - a.w).slice(0, 9);
      const max = Math.max(1, ...top.map((p) => p.w)), demand = v(E.demand), tracked = top.reduce((s, p) => s + p.w, 0);
      return `<div class="wb-large">${demand != null ? fmt(demand) : "—"}<small>WATTS RIGHT NOW${st(E.offpeak) && st(E.offpeak).s === "on" ? " · OFF-PEAK" : ""}</small></div>${spark(EN.hist)}` +
        `<div class="eddo-pg-grid">${card("TODAY", "£" + fmt(cost, 2), ycost ? `yesterday £${fmt(ycost, 2)}` : "")}${card("ELECTRICITY", fmt(v(E.today), 1) + " kWh", cmp(v(E.today), v(E.yday)), v(E.today) != null && v(E.yday) && (v(E.today) / Math.max(0.5, new Date().getHours() + 0.5)) * 24 > v(E.yday) * 1.15 ? ' data-warn="true"' : "")}` +
        `${card("GAS", fmt(v(G.today), 1) + " kWh", cmp(v(G.today), v(G.yday)))}${card("ELEC RATE", v(E.rate) != null ? fmt(v(E.rate) * 100, 1) + "p" : "—", v(E.stand) != null ? `+ ${fmt(v(E.stand) * 100, 0)}p/day standing` : "")}${card("GAS RATE", v(G.rate) != null ? fmt(v(G.rate) * 100, 2) + "p" : "—", "per kWh")}${card("YESTERDAY", fmt(v(E.yday), 1) + " kWh", fmt(v(G.yday), 1) + " kWh gas")}</div>` +
        `<p class="eddo-pg-h">BIGGEST USERS NOW ${demand ? `<span>${Math.round((tracked / demand) * 100)}% OF THE HOUSE TRACKED</span>` : ""}</p>` +
        (top.length ? top.map((p) => bar(p.name, (p.w / max) * 100, p.w >= 1000 ? fmt(p.w / 1000, 2) + " kW" : fmt(p.w) + " W", p.w > 1500)).join("") : `<p class="wb-muted eddo-pg-note">Nothing with a power meter is drawing power.</p>`);
    },
  });

  // ============================================================ game mode: PC vitals as a cockpit
  function gauge(label, v, max, unit, warnAt) {
    const k = v == null ? 0 : Math.max(0, Math.min(1, v / max)), a0 = -220, a1 = 40, a = a0 + (a1 - a0) * k, R = 44, cx = 56, cy = 56;
    const pt = (deg, r = R) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
    const arc = (from, to) => { const [x0, y0] = pt(from), [x1, y1] = pt(to); return `M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
    const ticks = Array.from({ length: 11 }, (_, i) => { const d = a0 + ((a1 - a0) * i) / 10, [x0, y0] = pt(d, R + 4), [x1, y1] = pt(d, R + (i % 5 ? 8 : 11)); return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`; }).join("");
    const [nx, ny] = pt(a, R - 8), hot = v != null && warnAt != null && v >= warnAt;
    return `<div class="eddo-gauge"${hot ? ' data-hot="true"' : ""}><svg viewBox="0 0 112 100"><g class="t">${ticks}</g><path class="bg" d="${arc(a0, a1)}"/>${k > 0.002 ? `<path class="fg" d="${arc(a0, a)}"/>` : ""}<line class="n" x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"/><circle cx="${cx}" cy="${cy}" r="3"/></svg>` +
      `<b>${v == null ? "—" : Math.round(v)}<small>${unit}</small></b><span>${label}</span></div>`;
  }
  let cockpitHtml = "";
  setInterval(() => {
    const el = document.querySelector("#stage .eddo-cockpit"); if (!el) { cockpitHtml = ""; return; }
    const d = window.eddoPc && window.eddoPc();
    const html = !d ? `<p class="wb-muted">Start the Loupedeck controller to see the PC's vitals here.</p>` :
      `<div class="eddo-cockpit-row">${gauge("CPU LOAD", d.cpu, 100, "%", 90)}${gauge("GPU LOAD", d.gpu, 100, "%", 97)}${gauge("CPU TEMP", d.cpuTemp, 100, "°", 85)}${gauge("GPU TEMP", d.gpuTemp, 95, "°", 83)}</div>` +
      `<div class="eddo-cockpit-strip">${bar("RAM", d.ram, d.ramUsedGb != null ? `${fmt(d.ramUsedGb, 1)} / ${fmt(d.ramTotalGb, 0)} GB` : fmt(d.ram) + "%", d.ram >= 90)}${bar("VRAM", d.vram, fmt(d.vram) + "%", d.vram >= 95)}${bar("GPU POWER", d.gpuWatts != null ? (d.gpuWatts / 450) * 100 : null, d.gpuWatts != null ? fmt(d.gpuWatts) + " W" : "—")}${bar("COOLANT", d.coolant != null ? ((d.coolant - 20) / 30) * 100 : null, d.coolant != null ? fmt(d.coolant, 1) + "°C" : "—", d.coolant >= 45)}</div>` +
      `<p class="eddo-cockpit-foot"><span>${esc(String(d.gpuName || "GPU").toUpperCase())}</span><span>${d.at ? "LIVE · " + new Date(d.at).toLocaleTimeString("en-GB") : ""}</span></p>`;
    if (html !== cockpitHtml) { cockpitHtml = html; el.innerHTML = html; }
  }, 1000);

  // ============================================================ tasks: drag one off to finish it, stale ones sink and turn amber
  function burst(el) {
    const r = el.getBoundingClientRect(), stage = document.querySelector("#stage"); if (!stage) return;
    const sr = stage.getBoundingClientRect(), sc = sr.width / (stage.offsetWidth || sr.width);
    const c = document.createElement("canvas"); c.className = "eddo-burst"; c.width = 360; c.height = 220;
    c.style.left = `${(r.left - sr.left + r.width / 2) / sc - 180}px`; c.style.top = `${(r.top - sr.top + r.height / 2) / sc - 110}px`;
    stage.append(c);
    const g = c.getContext("2d"), parts = Array.from({ length: 46 }, () => ({ x: 180, y: 110, vx: (Math.random() - 0.3) * 7, vy: (Math.random() - 0.65) * 6, l: 1, s: 1 + Math.random() * 2.2, h: Math.random() < 0.7 ? "143,224,190" : "255,214,150" }));
    const step = () => {
      g.clearRect(0, 0, 360, 220); let alive = 0;
      for (const p of parts) { if (p.l <= 0) continue; alive++; p.x += p.vx; p.y += p.vy; p.vy += 0.16; p.vx *= 0.98; p.l -= 0.022; g.fillStyle = `rgba(${p.h},${p.l})`; g.fillRect(p.x, p.y, p.s, p.s); }
      if (alive) requestAnimationFrame(step); else c.remove();
    };
    requestAnimationFrame(step);
  }
  const AGE_KEY = "eddo-task-seen";
  let seen = {}; try { seen = JSON.parse(localStorage.getItem(AGE_KEY) || "{}") || {}; } catch (_) {}
  setInterval(() => {
    const uids = window.eddoTasks ? window.eddoTasks.uids() : [];
    let changed = false;
    for (const u of uids) if (u && !seen[u]) { seen[u] = Date.now(); changed = true; }
    if (changed) { const keep = {}; for (const u of uids) keep[u] = seen[u]; for (const [k, t] of Object.entries(seen)) if (Date.now() - t < 60 * 864e5) keep[k] = t; seen = keep; try { localStorage.setItem(AGE_KEY, JSON.stringify(seen)); } catch (_) {} }
    document.querySelectorAll("#stage .wb-task[data-wb-task]").forEach((b) => {
      const u = uids[+b.dataset.wbTask], days = u && seen[u] ? (Date.now() - seen[u]) / 864e5 : 0;
      const done = b.getAttribute("aria-pressed") === "true", sink = done ? 0 : Math.min(1, days / 7);
      const want = done || days < 2 ? "" : days >= 4 ? "old" : "aging";
      if ((b.dataset.age || "") !== want) { if (want) b.dataset.age = want; else delete b.dataset.age; }
      b.style.setProperty("--sink", sink.toFixed(3));
      b.title = u && seen[u] && days >= 1 ? `On the list for ${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"}` : "";
    });
  }, 700);
  let tdrag = null, swallow = 0;
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest && e.target.closest("#stage .wb-task[data-wb-task]"); if (!b || e.button !== 0 || b.getAttribute("aria-pressed") === "true") return;
    tdrag = { b, x: e.clientX, y: e.clientY, dx: 0, on: false };
  }, true);
  window.addEventListener("pointermove", (e) => {
    if (!tdrag) return;
    const dx = e.clientX - tdrag.x, dy = e.clientY - tdrag.y;
    if (!tdrag.on && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) tdrag.on = true;
    if (!tdrag.on) return;
    tdrag.dx = Math.max(0, dx);
    const w = tdrag.b.offsetWidth || 300, k = Math.min(1, tdrag.dx / (w * 0.45));
    tdrag.b.style.transform = `translateX(${tdrag.dx}px)`; tdrag.b.style.opacity = String(1 - k * 0.6); tdrag.b.dataset.dragging = k >= 1 ? "go" : "true";
  });
  window.addEventListener("pointerup", () => {
    const d = tdrag; tdrag = null; if (!d || !d.on) return;
    swallow = Date.now();
    const w = d.b.offsetWidth || 300, go = d.dx >= w * 0.45;
    d.b.style.transition = "transform .28s ease, opacity .28s ease";
    if (go) {
      burst(d.b); d.b.style.transform = `translateX(${w}px)`; d.b.style.opacity = "0";
      setTimeout(() => { d.b.style.transition = ""; d.b.style.transform = ""; d.b.style.opacity = ""; delete d.b.dataset.dragging; swallow = 0; d.b.click(); }, 280);
    } else { d.b.style.transform = ""; d.b.style.opacity = ""; setTimeout(() => { d.b.style.transition = ""; delete d.b.dataset.dragging; }, 300); }
  });
  // the click that ends a drag shouldn't also tick the task
  window.addEventListener("click", (e) => { if (swallow && Date.now() - swallow < 400 && e.target.closest && e.target.closest(".wb-task")) { e.stopPropagation(); e.preventDefault(); } }, true);
  // a plain click that ticks a task gets the burst too
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("#stage .wb-task[data-wb-task]"); if (b && b.getAttribute("aria-pressed") !== "true" && e.isTrusted) burst(b); }, true);
})();
