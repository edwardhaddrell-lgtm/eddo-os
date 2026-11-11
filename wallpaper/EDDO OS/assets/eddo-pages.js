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
      if (!V3.running || e.button !== 0 || e.target.closest("button,a,input,select,textarea,.workbench,.wb-overview,.eddo-ha,.eddo-srv,.eddo-pip,.system-footer,.system-nav,.brand,.eddo-page-card")) return;
      V3.drag = { x: e.clientX, y: e.clientY, th: V3.view.theta, ph: V3.view.phi }; V3.view.auto = false;
    });
    window.addEventListener("pointermove", (e) => {
      const d = V3.drag; if (!d) return;
      V3.view.theta = d.th - (e.clientX - d.x) * 0.006; V3.view.phi = Math.max(0.35, Math.min(1.45, d.ph - (e.clientY - d.y) * 0.004));
    });
    window.addEventListener("pointerup", (e) => {
      const d = V3.drag; if (!d) return;
      V3.drag = null; clearTimeout(V3.resume); V3.resume = setTimeout(() => { V3.view.auto = true; }, 8000);
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) { V3.pinned = V3.hover ? V3.hover : null; V3.confirm = null; drawCard(); }   // a click pins what's under the mouse (or clears)
    });
    stage.addEventListener("pointermove", (e) => {
      if (!V3.running) return;
      const ui = e.target.closest("button,a,input,.workbench,.wb-overview,.eddo-ha,.eddo-srv,.eddo-pip,.system-footer,.system-nav,.eddo-page-card");
      V3.mouse = ui ? null : { x: e.clientX, y: e.clientY };
    });
    stage.addEventListener("pointerleave", () => { V3.mouse = null; });
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
  // ---- hover a thing in the scene for its details; click to keep the card open, × to close ----
  function pick(key, x, y, z, info, actions) { V3.picks.push({ key, x, y, z, info, actions }); }
  function toCanvas(x, y, z) {
    const p = new V3.T.Vector3(x, y, z).project(V3.camera); if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * V3.canvas.clientWidth, y: (-p.y * 0.5 + 0.5) * V3.canvas.clientHeight };
  }
  function updatePicks() {
    let best = null;
    if (V3.mouse && !V3.drag && V3.canvas) {
      const r = V3.canvas.getBoundingClientRect(), k = V3.canvas.clientWidth / (r.width || 1), mx = (V3.mouse.x - r.left) * k, my = (V3.mouse.y - r.top) * k;
      let bd = 26;
      for (const pk of V3.picks) { const c = toCanvas(pk.x, pk.y, pk.z); if (!c) continue; const dd = Math.hypot(c.x - mx, c.y - my); if (dd < bd) { bd = dd; best = pk.key; } }
    }
    V3.hover = best;
    const stage = document.querySelector("#stage"); if (stage) { const want = best ? "pointer" : ""; if (stage.style.cursor !== want && (best || stage.style.cursor === "pointer")) stage.style.cursor = want; }
    drawCard();
  }
  function drawCard() {
    const stage = document.querySelector("#stage"); if (!stage || !V3.canvas) return;
    const key = V3.pinned || V3.hover, pk = key && V3.picks.find((x) => x.key === key);
    if (V3.pinned && !pk && V3.picks.length) V3.pinned = null;   // it went away
    let el = V3.card;
    if (!pk || !V3.running) { if (el) el.hidden = true; return; }
    if (!el || !el.isConnected) { el = V3.card = document.createElement("div"); el.className = "eddo-page-card"; (V3.labels.parentNode || stage).insertBefore(el, V3.labels.nextSibling); }
    const c = toCanvas(pk.x, pk.y, pk.z); if (!c) { el.hidden = true; return; }
    el.hidden = false; el.dataset.pinned = String(V3.pinned === key);
    el.style.transform = `translate(${(c.x + 16).toFixed(1)}px, ${(c.y - 12).toFixed(1)}px)`;
    const conf = V3.confirm === key && pk.actions && pk.actions.remove;
    const html = `${V3.pinned === key ? '<button class="eddo-page-card-x" data-pcard-close aria-label="Close">×</button>' : ""}${pk.info()}` +
      (conf ? `<div class="eddo-page-card-confirm"><p>${esc(pk.actions.remove.ask)}</p><button data-pcard-yes>REMOVE</button><button data-pcard-no>CANCEL</button></div>`
        : pk.actions && pk.actions.remove && V3.pinned === key ? `<button class="eddo-page-card-rm" data-pcard-rm>× ${esc(pk.actions.remove.label || "REMOVE")}</button>` : "") +
      (V3.pinned === key ? "" : `<em class="eddo-page-card-hint">CLICK TO KEEP OPEN</em>`);
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest(".eddo-page-card")) return;
    const pk = V3.picks.find((x) => x.key === V3.pinned);
    if (e.target.closest("[data-pcard-close]") || e.target.closest("[data-pcard-no]") && !V3.confirm) { V3.pinned = null; V3.confirm = null; }
    else if (e.target.closest("[data-pcard-no]")) V3.confirm = null;
    else if (e.target.closest("[data-pcard-rm]")) V3.confirm = V3.pinned;
    else if (e.target.closest("[data-pcard-yes]") && pk && pk.actions && pk.actions.remove) { pk.actions.remove.run(); V3.pinned = null; V3.confirm = null; }
    drawCard();
  });
  function frame(now) {
    if (!V3.running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, V3.last ? (now - V3.last) / 1000 : 0.016); V3.last = now;
    const v = V3.view, pg = V3.page;
    if (v.auto) { if (pg && pg.sway) { v.swayT = (v.swayT || 0) + dt; v.theta = pg.view.theta + Math.sin(v.swayT / 7) * 0.32; } else v.theta += dt * 0.12; }
    const T = V3.T, cam = V3.camera;
    cam.position.set(v.tx + v.dist * Math.sin(v.phi) * Math.sin(v.theta), v.ty + v.dist * Math.cos(v.phi), v.tz + v.dist * Math.sin(v.phi) * Math.cos(v.theta));
    cam.lookAt(v.tx, v.ty, v.tz);
    size();
    const p = V3.page, g = p && V3.built.get(p.id);
    V3.picks = [];
    if (p && g && p.tick) p.tick(g, dt, now, T);
    updatePicks();
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
    V3.page = page; Object.assign(V3.view, { theta: 0.7, phi: 1.05, auto: true, tx: 0, ty: 0.6, tz: 0 }, page.view || {});
    V3.labels.innerHTML = ""; V3.tags.clear();
    document.querySelector("#stage")?.setAttribute("data-eddo-page", page.id);
    if (!V3.running) { V3.running = true; V3.last = 0; requestAnimationFrame(frame); }
    return true;
  }
  function hide3D() {
    V3.running = false; V3.page = null; V3.drag = null; V3.pinned = null; V3.hover = null; V3.confirm = null; if (V3.card) V3.card.hidden = true;
    document.querySelector("#stage")?.removeAttribute("data-eddo-page");
    if (V3.labels) { V3.labels.innerHTML = ""; V3.tags.clear(); }
  }
  const lineMat = (T, c, o) => new T.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
  const segs = (T, pts, c, o) => { const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); return new T.LineSegments(g, lineMat(T, c, o)); };
  function ring(pts, cx, y, cz, r, n = 48, ax = "y") {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      if (ax === "y") pts.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, cx + Math.cos(b) * r, y, cz + Math.sin(b) * r);
      else if (ax === "z") pts.push(cx + Math.cos(a) * r, y + Math.sin(a) * r, cz, cx + Math.cos(b) * r, y + Math.sin(b) * r, cz);   // ring facing z
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
      async onShow() { const stg = document.querySelector("#stage"); if (stg) stg.dataset.eddoTabpage = def.id; await registry(); def.discover && def.discover(REG); if (def.build) show3D(def); dirty = true; def.onShow && def.onShow(); },
      onHide() { const stg = document.querySelector("#stage"); if (stg && stg.dataset.eddoTabpage === def.id) delete stg.dataset.eddoTabpage; if (def.build) hide3D(); def.onHide && def.onHide(); },
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

  // ============================================================ 2. MEDIA — Plex, and the cartridges as Game Boy carts you drag into a player
  const MED = { carts: [], cartAt: 0, cartBusy: false, cartId: "sensor.cartridge_player_cartridge_id", present: "binary_sensor.cartridge_player_cartridge_present", script: "script.cartridge_play_on_frame",
    cast: null, server: null, posters: new Map(), postBusy: false, el: null, loaded: null, drag: null };
  async function loadCarts() {
    if (MED.cartBusy || Date.now() - MED.cartAt < 10 * 60e3 || !REG) return;
    MED.cartBusy = true;
    // which TV the cartridge script casts to (its play_media target)
    try {
      const sc = await HA().send({ type: "script/config", entity_id: MED.script }), seq = JSON.stringify((sc && sc.config && sc.config.sequence) || []);
      const m = /"action":"media_player\.play_media"[^}]*?"entity_id":"(media_player\.[a-z0-9_]+)"|"entity_id":"(media_player\.[a-z0-9_]+)"[^}]*?"action":"media_player\.play_media"/.exec(seq);
      MED.cast = m ? m[1] || m[2] : null;
      if (!MED.cast) { const all = [...seq.matchAll(/media_player\.[a-z0-9_]+/g)].map((x) => x[0]); MED.cast = all[all.length - 1] || null; }
    } catch (_) {}
    const autos = REG.allStates.filter((x) => x.entity_id.startsWith("automation."));
    const out = [];
    await Promise.all(autos.map(async (a) => {
      try {
        const r = await HA().send({ type: "automation/config", entity_id: a.entity_id }), cfg = r && r.config; if (!cfg) return;
        const conds = [].concat(cfg.conditions || cfg.condition || []), acts = [].concat(cfg.actions || cfg.action || []);
        const cond = conds.find((c) => c && [].concat(c.entity_id || []).includes(MED.cartId)); if (!cond) return;
        const act = acts.find((x) => x && /cartridge_play/.test(String(x.action || x.service || ""))); if (!act) return;
        const raw = String((act.data || {}).media_id ?? ""), ids = [...raw.matchAll(/\d+/g)].map((x) => x[0]);
        out.push({ name: cfg.alias || a.attributes.friendly_name, tag: String(cond.state || ""), ids, random: ids.length > 1, auto: a.entity_id });
      } catch (_) {}
    }));
    out.sort((a, b) => a.name.localeCompare(b.name));
    MED.carts = out; MED.cartAt = Date.now(); MED.cartBusy = false; dirty = true; MED.stageKey = "";
    loadPosters();
  }
  // posters come from Plex through Home Assistant's media browser (the cast TV can browse the Plex library)
  async function loadPosters() {
    if (MED.postBusy || !MED.cast) return; MED.postBusy = true;
    const browse = (type, id) => HA().send({ type: "media_player/browse_media", entity_id: MED.cast, media_content_type: type, media_content_id: id });
    try {
      if (!MED.server) { const root = await browse("plex", ""); const m = /^plex:\/\/([^/]+)/.exec((root && root.media_content_id) || ""); MED.server = m && m[1]; MED.libs = (root && root.children) || []; }
      if (!MED.server) throw 0;
      let shows = null;
      for (const c of MED.carts) {
        if (MED.posters.has(c.name) || !c.ids.length) continue;
        try {
          const it = await browse("movie", `plex://${MED.server}/${c.ids[0]}`).catch(() => browse("episode", `plex://${MED.server}/${c.ids[0]}`));
          let pic = it && it.thumbnail;
          if (it && /episode|season/.test(it.media_class)) {   // a TV cartridge: use the show's poster rather than one episode's still
            if (!shows) { shows = []; for (const lib of (MED.libs || []).filter((l) => l.children_media_class === "tv_show")) { const r = await browse(lib.media_content_type, lib.media_content_id).catch(() => null); shows.push(...((r && r.children) || [])); } }
            const nm = c.name.toLowerCase().replace(/^the\s+/, ""), show = shows.find((x) => String(x.title).toLowerCase().replace(/^the\s+/, "").startsWith(nm)) || shows.find((x) => String(it.title).toLowerCase().startsWith(String(x.title).toLowerCase()));
            if (show && show.thumbnail) pic = show.thumbnail;
          }
          MED.posters.set(c.name, pic ? (pic.startsWith("/") ? HA().baseUrl() + pic : pic) : "");
        } catch (_) { MED.posters.set(c.name, ""); }
        MED.stageKey = ""; drawMediaStage();
      }
    } catch (_) {}
    MED.postBusy = false;
  }
  const hue = (t) => { let h = 0; for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const nowPlaying = () => {
    const pref = MED.cast && st(MED.cast);
    if (pref && /^(playing|paused)$/.test(pref.s)) return [MED.cast, pref];
    return [...S.entries()].find(([id, x]) => id.startsWith("media_player.") && x.s === "playing") || [...S.entries()].find(([id, x]) => id.startsWith("media_player.") && x.s === "paused") || null;
  };
  function cartHtml(c, i, inPlayer) {
    const pic = MED.posters.get(c.name);
    return `<div class="eddo-gb" data-gb="${i}"${inPlayer ? ' data-in="true"' : ""} style="--h:${hue(c.name)}"><i class="eddo-gb-grip"></i><div class="eddo-gb-label">${pic ? `<img src="${esc(pic)}" alt="" draggable="false">` : `<span>${esc(c.name)}</span>`}</div><b>${esc(c.name)}</b><em>${c.random ? "RANDOM EPISODE" : "▼"}</em></div>`;
  }
  // the stage layer: the shelf of carts, the player in the middle, transport controls under it
  function drawMediaStage() {
    const stage = document.querySelector("#stage"), on = window.eddoTabs.active() === "media";
    if (!on) { if (MED.el) MED.el.hidden = true; return; }
    if (!MED.el || !MED.el.isConnected) {
      MED.el = document.createElement("div"); MED.el.className = "eddo-media-stage";
      MED.el.innerHTML = `<div class="eddo-gb-player" data-drop><div class="eddo-gb-slot"><div class="eddo-gb-in"></div></div><div class="eddo-gb-face"><span class="eddo-gb-led"></span><b>EDDO · CARTRIDGE PLAYER</b><em class="eddo-gb-hint">DRAG A CARTRIDGE IN</em></div>` +
        `<div class="eddo-gb-now"><small></small><strong></strong><i class="eddo-pg-prog"><s></s></i></div><div class="eddo-gb-ctl"><button data-mctl="eject" title="Stop">■</button><button data-mctl="play" title="Play / pause">▶</button><button data-mctl="next" title="Next">⏭</button></div></div><div class="eddo-gb-shelf"></div>`;
      stage.append(MED.el); MED.stageKey = "";
    }
    MED.el.hidden = false;
    const cur = st(MED.cartId), present = st(MED.present), phys = present && present.s === "on" && cur ? MED.carts.findIndex((c) => c.tag === cur.s) : -1;
    const inIdx = MED.loaded != null ? MED.loaded : phys;
    const key = MED.carts.map((c) => c.name + (MED.posters.get(c.name) || "")).join("|") + "#" + inIdx;
    if (key !== MED.stageKey) {
      MED.stageKey = key;
      MED.el.querySelector(".eddo-gb-shelf").innerHTML = MED.carts.length ? MED.carts.map((c, i) => (i === inIdx ? `<div class="eddo-gb-gap"></div>` : cartHtml(c, i))).join("") : `<p class="wb-muted">${MED.cartBusy || !MED.cartAt ? "Reading your cartridges…" : "No cartridge automations found."}</p>`;
      MED.el.querySelector(".eddo-gb-in").innerHTML = inIdx >= 0 && MED.carts[inIdx] ? cartHtml(MED.carts[inIdx], inIdx, true) : "";
      MED.el.querySelector(".eddo-gb-player").dataset.loaded = String(inIdx >= 0);
    }
    const np = nowPlaying(), a = np ? np[1].a : {}, playing = np && np[1].s === "playing";
    MED.el.querySelector(".eddo-gb-led").dataset.on = String(!!playing);
    MED.el.querySelector(".eddo-gb-now small").textContent = np ? (playing ? "NOW PLAYING" : "PAUSED") + " · " + String(a.friendly_name || "").replace(/^Plex \((.*)\)$/, "$1").toUpperCase() : inIdx >= 0 ? "LOADED" : "";
    MED.el.querySelector(".eddo-gb-now strong").textContent = np ? (a.media_series_title ? `${a.media_series_title} · ${a.media_title || ""}` : a.media_title || a.app_name || "") : inIdx >= 0 ? MED.carts[inIdx].name : "";
    MED.el.querySelector(".eddo-gb-now s").style.width = np && a.media_duration ? `${Math.min(100, ((a.media_position || 0) / a.media_duration) * 100).toFixed(1)}%` : "0%";
    MED.el.querySelector('[data-mctl="play"]').textContent = playing ? "❚❚" : "▶";
  }
  setInterval(drawMediaStage, 700);
  function playCart(i) {
    const c = MED.carts[i]; if (!c) return;
    MED.loaded = i; MED.stageKey = ""; drawMediaStage();
    const p = MED.el && MED.el.querySelector(".eddo-gb-player"); if (p) { p.dataset.flash = "true"; setTimeout(() => { p.dataset.flash = "false"; }, 900); }
    // run the cartridge's own automation (skipping its "is this cartridge in?" check), so random-episode carts still pick at random
    call("automation", "trigger", { target: { entity_id: c.auto }, service_data: { skip_condition: true } });
  }
  page({
    id: "media", label: "Media", pos: 3,
    discover(R) { if (!R) return; watch([MED.cartId, MED.present, ...R.allStates.filter((x) => x.entity_id.startsWith("media_player.")).map((x) => x.entity_id)]); loadCarts(); },
    onShow() { drawMediaStage(); },
    onHide() { if (MED.el) MED.el.hidden = true; },
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
      return `<p class="eddo-pg-h">ACROSS THE HOUSE</p>${now}<p class="wb-muted eddo-pg-note">Drag a cartridge into the player to play it on the Frame, or click one.</p>`;
    },
  });
  // drag a cart: a copy follows the pointer; drop it on the player to play
  document.addEventListener("pointerdown", (e) => {
    const c = e.target.closest && e.target.closest(".eddo-gb-shelf .eddo-gb[data-gb]"); if (!c || e.button !== 0) return;
    e.preventDefault();
    const r = c.getBoundingClientRect();
    MED.drag = { c, i: +c.dataset.gb, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, ghost: null, moved: false };
  });
  window.addEventListener("pointermove", (e) => {
    const d = MED.drag; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    if (!d.moved) { d.moved = true; d.ghost = d.c.cloneNode(true); d.ghost.classList.add("eddo-gb-ghost"); d.ghost.style.width = d.w + "px"; d.ghost.style.height = d.h + "px"; document.body.append(d.ghost); d.c.dataset.lifted = "true"; }
    d.ghost.style.transform = `translate(${e.clientX - d.dx}px, ${e.clientY - d.dy}px) rotate(${Math.max(-8, Math.min(8, (e.clientX - d.x) / 40))}deg)`;
    const pl = MED.el && MED.el.querySelector("[data-drop]"), pr = pl && pl.getBoundingClientRect();
    if (pl) pl.dataset.over = String(!!pr && e.clientX > pr.left && e.clientX < pr.right && e.clientY > pr.top && e.clientY < pr.bottom);
  });
  window.addEventListener("pointerup", () => {
    const d = MED.drag; MED.drag = null; if (!d) return;
    const pl = MED.el && MED.el.querySelector("[data-drop]"), over = pl && pl.dataset.over === "true";
    if (pl) pl.dataset.over = "false";
    if (d.ghost) d.ghost.remove(); delete d.c.dataset.lifted;
    if (!d.moved || over) playCart(d.i);   // a plain click plays it too
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest) return;
    const m = e.target.closest("[data-media]"); if (m) { call("media_player", "media_play_pause", { target: { entity_id: m.dataset.media } }); return; }
    const b = e.target.closest("[data-mctl]"); if (!b) return;
    const np = nowPlaying(), id = np ? np[0] : MED.cast; if (!id) return;
    if (b.dataset.mctl === "play") call("media_player", "media_play_pause", { target: { entity_id: id } });
    else if (b.dataset.mctl === "next") {
      // a random-episode cartridge (Bluey…) picks another episode; anything else skips to the next track
      const cur = st(MED.cartId), present = st(MED.present), phys = present && present.s === "on" && cur ? MED.carts.findIndex((c) => c.tag === cur.s) : -1, li = MED.loaded != null && MED.loaded >= 0 ? MED.loaded : phys;
      if (li >= 0 && MED.carts[li] && MED.carts[li].random) playCart(li); else call("media_player", "media_next_track", { target: { entity_id: id } });
    }
    else if (b.dataset.mctl === "eject") { call("media_player", "media_stop", { target: { entity_id: id } }); MED.loaded = -1; MED.stageKey = ""; }
  });

  // ============================================================ 3. NETWORK — the eero mesh (schmittx/home-assistant-eero), every client on the eero it's using, and the NAS
  // Falls back to Home Assistant's own Wi-Fi signal sensors (grouped by room) when the eero integration isn't there.
  const NET = { mode: "rooms", hubs: [], devs: [], net: {}, nas: {}, nodes: null, key: "" };
  const rssiCol = (v) => (v == null ? COL.edge : v >= -60 ? COL.ok : v >= -72 ? COL.warn : COL.bad);
  const rate = (id) => { const v = n(st(id)); return v == null ? 0 : v; };
  function netDiscover(R) {
    const devById = new Map(R.devices.map((d) => [d.id, d])), areaName = new Map(R.areas.map((a) => [a.area_id, a.name]));
    const stOf = new Map(R.allStates.map((x) => [x.entity_id, x]));
    const byDev = new Map(); for (const e of R.ents) { if (e.disabled_by || !e.device_id) continue; if (!byDev.has(e.device_id)) byDev.set(e.device_id, []); byDev.get(e.device_id).push(e.entity_id); }
    const pick = (devId, re) => (byDev.get(devId) || []).find((id) => re.test(id)) || null;
    const eeroDevs = R.devices.filter((d) => (d.manufacturer || "").toLowerCase() === "eero");
    if (eeroDevs.length) {
      NET.mode = "eero";
      const netDev = eeroDevs.find((d) => /network/i.test(d.model || ""));
      NET.net = netDev ? { status: pick(netDev.id, /_status$/), down: pick(netDev.id, /_download_speed$/), up: pick(netDev.id, /_upload_speed$/), ip: pick(netDev.id, /_public_ip$/), clients: pick(netDev.id, /_connected_clients$/), guests: pick(netDev.id, /_connected_guest_clients$/), name: netDev.name_by_user || netDev.name } : {};
      NET.hubs = eeroDevs.filter((d) => /^eero/i.test(d.model || "") && !/client|profile|network/i.test(d.model || "")).map((d) => ({ name: d.name_by_user || d.name, model: d.model, status: pick(d.id, /_status$/), clients: pick(d.id, /_connected_clients$/) }));
      NET.devs = eeroDevs.filter((d) => /client/i.test(d.model || "")).map((d) => {
        const tr = pick(d.id, /^device_tracker\./);
        return { name: String(d.name_by_user || d.name || "").replace(/\s*\((wired|wireless)\)$/i, ""), tracker: tr, sig: pick(d.id, /_signal_strength$/), conn: pick(d.id, /^binary_sensor\..*_connected$/), dl: pick(d.id, /_download_rate$/), ul: pick(d.id, /_upload_rate$/), wired: /wired/i.test(d.model || "") && !/wireless/i.test(d.model || "") };
      }).filter((x) => x.tracker);
    } else {
      NET.mode = "rooms";
      const sig = R.ents.filter((e) => !e.disabled_by && e.entity_id.startsWith("sensor.") && stOf.has(e.entity_id) && (() => { const a = stOf.get(e.entity_id).attributes; return a.device_class === "signal_strength" && /dbm/i.test(a.unit_of_measurement || ""); })());
      const one = new Map(); for (const e of sig) { const k = e.device_id || e.entity_id; if (!one.has(k)) one.set(k, e); }
      NET.devs = [...one.values()].map((e) => { const d = devById.get(e.device_id) || {}; return { name: d.name_by_user || d.name || e.entity_id, sig: e.entity_id, room: areaName.get(e.area_id || d.area_id) || "Unassigned" }; });
      NET.hubs = [...new Set(NET.devs.map((d) => d.room))].sort().map((name) => ({ name }));
      const f = (re) => { const x = R.allStates.find((s) => re.test(s.entity_id)); return x ? x.entity_id : null; };
      NET.net = { wan: f(/^binary_sensor\.eero_wan_status$/), ip: f(/^sensor\.eero_external_ip$/) };
    }
    const f = (re) => { const x = R.allStates.find((s) => re.test(s.entity_id)); return x ? x.entity_id : null; };
    const nf = (re) => f(new RegExp("^sensor\\.eddo_nas_" + re + "$"));
    NET.nas = { temp: nf("cpu_temperature"), cpu: nf("cpu_usage"), ram: nf("ram_usage"), array: nf("array_usage"), state: nf("array_state"), dcpu: nf("docker_total_cpu"), dmem: nf("docker_total_memory"), up: nf("up_since"), upd: nf("container_updates_available"), cache: nf("disk_cache_usage"),
      disks: R.allStates.filter((x) => /^sensor\.eddo_nas_disk_disk\d+_usage$/.test(x.entity_id)).map((x) => x.entity_id) };
    watch([...Object.values(NET.net), ...NET.hubs.flatMap((h) => [h.status, h.clients]), ...NET.devs.flatMap((d) => [d.tracker, d.sig, d.conn, d.dl, d.ul]), ...Object.values(NET.nas).flat()].filter(Boolean));
  }
  // where a client is: its eero (or room), and whether it's online
  function netPlace(d) {
    if (NET.mode !== "eero") return { hub: d.room, on: live(st(d.sig)) };
    const t = st(d.tracker), c = st(d.conn);
    const on = c ? c.s === "on" : !!(t && t.s === "home");
    return { hub: t && t.a.connected_to, on, wired: (t && t.a.connection_type === "wired") || d.wired, band: c && c.a.operating_band };
  }
  function netCard(d) {
    const t = st(d.tracker), a = (t && t.a) || {}, c = st(d.conn), v = n(st(d.sig)), dl = rate(d.dl), ul = rate(d.ul), p = netPlace(d);
    const row = (k, val) => (val == null || val === "" ? "" : `<dt>${k}</dt><dd>${esc(val)}</dd>`);
    return `<b>${esc(d.name.toUpperCase())}</b><dl>` +
      row("IP", a.ip) + row("MAC", a.mac) + row("MAKER", a.manufacturer) + row("HOSTNAME", a.host_name && a.host_name !== d.name ? a.host_name : "") +
      row(NET.mode === "eero" ? "EERO" : "ROOM", p.hub) + row("LINK", p.wired ? "Wired" : [c && c.a.operating_band, c && c.a.channel ? "ch " + c.a.channel : ""].filter(Boolean).join(" · ")) +
      row("SIGNAL", !p.wired && v != null ? `${v} dBm` : "") + row("TRAFFIC", dl || ul ? `↓ ${fmt(dl, 1)} · ↑ ${fmt(ul, 1)} Mbit/s` : "idle") + `</dl>`;
  }
  page({
    id: "network", label: "Network", pos: 4, view: { dist: 23, ty: 0.6, phi: 0.98 }, minDist: 8, maxDist: 40,
    discover(R) { if (!R) return; netDiscover(R); const key = NET.mode + NET.hubs.map((h) => h.name).join() + NET.devs.length; if (key !== NET.key) { NET.key = key; V3.built.delete("network"); if (V3.page && V3.page.id === "network") { const p = V3.page; V3.page = null; show3D(p); } } },
    build(g, T) {
      g.add(floorGrid(T, 9));
      const core = new T.LineSegments(new T.EdgesGeometry(new T.SphereGeometry(0.75, 10, 6)), lineMat(T, COL.cyan, 0.8)); core.position.y = 2.2; g.add(core);
      const nodes = { core, hubs: [], devs: [] };
      const A = NET.hubs.length || 1, R1 = NET.mode === "eero" ? 5.2 : 4.6, link = [];
      NET.hubs.forEach((h, i) => {
        const a = (i / A) * Math.PI * 2 - Math.PI / 2, x = Math.cos(a) * R1, z = Math.sin(a) * R1;
        // an eero: a rounded white puck; a room: a small diamond
        const m = NET.mode === "eero" ? segs(T, [...ring([], 0, -0.18, 0, 0.62, 40), ...ring([], 0, 0.18, 0, 0.62, 40), ...ring([], 0, 0.26, 0, 0.5, 36), ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => { const b = (k / 8) * Math.PI * 2; return [Math.cos(b) * 0.62, -0.18, Math.sin(b) * 0.62, Math.cos(b) * 0.62, 0.18, Math.sin(b) * 0.62]; })], 0xe8f4ff, 0.85)
          : new T.LineSegments(new T.EdgesGeometry(new T.SphereGeometry(0.32, 4, 2)), lineMat(T, COL.edge, 0.7));
        m.position.set(x, 1.0, z); g.add(m);
        nodes.hubs.push({ h, m, x, z }); link.push(0, 2.2, 0, x, 1.0, z);
      });
      nodes.links = segs(T, link, COL.cyan, 0.3); g.add(nodes.links);
      const MAXD = 90;   // clients are drawn from a pool and re-assigned each frame to whichever eero they're on
      for (let k = 0; k < MAXD; k++) { const m = new T.Mesh(new T.SphereGeometry(0.12, 4, 2), new T.MeshBasicMaterial({ color: COL.ok, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; g.add(m); nodes.devs.push(m); }
      nodes.spokes = segs(T, new Array(MAXD * 6).fill(0), COL.edge, 0.14); g.add(nodes.spokes);
      NET.nodes = nodes;
    },
    tick(g, dt, now) {
      const N = NET.nodes; if (!N) return;
      const nst = st(NET.net.status) || st(NET.net.wan), up = !nst || /connected|on|online/.test(nst.s);
      N.core.rotation.y += dt * 0.4; N.core.material.color.setHex(up ? COL.cyan : COL.bad); N.core.material.opacity = up ? 0.8 : 0.5 + 0.5 * Math.sin(now / 200);
      const down = n(st(NET.net.down)), upl = n(st(NET.net.up)), ip = st(NET.net.ip);
      tag("core", 0, 3.25, 0, `<b>INTERNET</b><span data-warn="${!up}">${up ? (down != null ? `↓ ${fmt(down)} · ↑ ${fmt(upl)} MBIT/S` : "ONLINE") : "DOWN"}</span>`, true);
      // place each online client around its hub
      const by = new Map(N.hubs.map((h) => [h.h.name, []]));
      const off = [];
      for (const d of NET.devs) { const p = netPlace(d); if (!p.on) { off.push(d); continue; } (by.get(p.hub) || by.get([...by.keys()][0]) || []).push({ d, p }); }
      const sp = N.spokes.geometry.attributes.position.array; sp.fill(0);
      let k = 0; const busiest = [];
      for (const hub of N.hubs) {
        const list = by.get(hub.h.name) || [];
        hub.m.rotation.y += dt * 0.3;
        const hs = st(hub.h.status), ok = !hs || /green|connected|online|on/.test(hs.s);
        hub.m.material.color.setHex(ok ? 0xe8f4ff : COL.bad);
        pick("h:" + hub.h.name, hub.x, 1.0, hub.z, () => `<b>${esc(String(hub.h.name).toUpperCase())}</b><dl><dt>MODEL</dt><dd>${esc(hub.h.model || "—")}</dd><dt>STATUS</dt><dd>${esc(hs ? hs.s : "—")}</dd><dt>DEVICES</dt><dd>${list.length} online</dd><dt>WIRED</dt><dd>${list.filter((x) => x.p.wired).length}</dd></dl>`);
        tag("h" + hub.h.name, hub.x, 1.75, hub.z, `<b>${esc(String(hub.h.name).toUpperCase())}</b><span data-warn="${!ok}">${list.length} ${NET.mode === "eero" ? "ON THIS EERO" : "DEVICES"}${ok ? "" : " · " + esc(String(hs.s).toUpperCase())}</span>`, true);
        list.forEach(({ d, p }, i) => {
          if (k >= N.devs.length) return;
          const m = N.devs[k], ring1 = Math.floor(i / 14), slot = i % 14, per = Math.min(14, list.length - ring1 * 14);
          const r = 1.25 + ring1 * 0.65, a = (slot / per) * Math.PI * 2 + (now / 1000) * (0.12 + ring1 * 0.04) * (ring1 % 2 ? -1 : 1);
          const x = hub.x + Math.cos(a) * r, z = hub.z + Math.sin(a) * r, y = 0.55 + (i % 3) * 0.22;
          const v = n(st(d.sig)), bw = rate(d.dl) + rate(d.ul);
          m.visible = true; m.position.set(x, y, z); m.rotation.y += dt;
          m.material.color.setHex(p.wired ? COL.cyan : rssiCol(v)); m.material.opacity = 0.9;
          m.scale.setScalar(1 + Math.min(1.5, bw / 20) + (bw > 0.5 ? 0.15 * Math.sin(now / 120 + k) : 0));
          sp.set([hub.x, 1.0, hub.z, x, y, z], k * 6);
          if (bw > 0.5) busiest.push({ d, bw, x, y, z });
          pick("c:" + (d.tracker || d.sig), x, y, z, () => netCard(d));
          const weak = !p.wired && v != null && v < -72;
          tag("d" + k, x, y + 0.34, z, `<b>${esc(d.name.toUpperCase())}</b><span data-warn="true">${v} dBm</span>`, weak, "eddo-page-tag-sm");
          k++;
        });
      }
      for (let j = k; j < N.devs.length; j++) { N.devs[j].visible = false; tag("d" + j, 0, 0, 0, "", false); }
      busiest.sort((a, b) => b.bw - a.bw).slice(0, 3).forEach((b, i) => tag("bw" + i, b.x, b.y - 0.3, b.z, `<b>${esc(b.d.name.toUpperCase())}</b><span>${fmt(b.bw, 1)} MBIT/S</span>`, true, "eddo-page-tag-sm eddo-page-tag-busy"));
      for (let i = busiest.length; i < 3; i++) tag("bw" + i, 0, 0, 0, "", false);
      N.spokes.geometry.attributes.position.needsUpdate = true;
      NET.offline = off;
    },
    panel() {
      const rows = NET.devs.map((d) => ({ d, p: netPlace(d), v: n(st(d.sig)), bw: rate(d.dl) + rate(d.ul) }));
      const on = rows.filter((r) => r.p.on), wifi = on.filter((r) => !r.p.wired);
      const good = wifi.filter((r) => r.v != null && r.v >= -60).length, fair = wifi.filter((r) => r.v != null && r.v < -60 && r.v >= -72).length, weak = wifi.filter((r) => r.v != null && r.v < -72).length;
      const nst = st(NET.net.status) || st(NET.net.wan), up = !nst || /connected|on|online/.test(nst.s), ip = st(NET.net.ip);
      const down = n(st(NET.net.down)), upl = n(st(NET.net.up)), tested = st(NET.net.down) && st(NET.net.down).a.last_updated;
      const worst = wifi.filter((r) => r.v != null && r.v < -66).sort((a, b) => a.v - b.v).slice(0, 6);
      const busy = on.filter((r) => r.bw > 0.1).sort((a, b) => b.bw - a.bw).slice(0, 5), maxbw = Math.max(1, ...busy.map((r) => r.bw));
      const N = NET.nas, v = (k) => n(st(N[k])), upS = st(N.up), upDays = upS && live(upS) ? Math.floor((Date.now() - Date.parse(upS.s)) / 864e5) : null;
      const hubs = NET.mode === "eero" ? `<p class="eddo-pg-h">EEROS</p><div class="eddo-pg-grid">${NET.hubs.map((h) => { const hs = st(h.status), ok = !hs || /green|connected|online/.test(hs.s); return card(String(h.name).toUpperCase(), fmt(rows.filter((r) => r.p.on && r.p.hub === h.name).length), `${esc(h.model || "")}${ok ? "" : " · " + esc(String(hs.s))}`, ok ? "" : ' data-warn="true"'); }).join("")}</div>` : "";
      return `<div class="eddo-pg-grid">${card("INTERNET", up ? "Online" : "Down", ip && live(ip) ? esc(ip.s) : "", up ? "" : ' data-warn="true"')}${card("SPEED TEST", down != null ? `${fmt(down)} / ${fmt(upl)}` : "—", down != null ? `Mbit/s${tested ? " · " + ago(Date.parse(tested)) : ""}` : "")}${card("ONLINE", on.length, `${wifi.length} Wi-Fi · ${on.length - wifi.length} wired`)}</div>` +
        hubs +
        `<p class="eddo-pg-h">WI-FI SIGNAL <span>${good} STRONG · ${fair} FAIR · ${weak} WEAK</span></p>${worst.length ? worst.map((r) => bar(r.d.name, ((r.v + 95) / 55) * 100, r.v + " dBm" + (r.p.band ? " · " + String(r.p.band).replace(" GHz", "G") : ""), r.v < -72)).join("") : `<p class="wb-muted eddo-pg-note">Every Wi-Fi device has a good signal.</p>`}` +
        (busy.length ? `<p class="eddo-pg-h">BUSIEST RIGHT NOW</p>${busy.map((r) => bar(r.d.name, (r.bw / maxbw) * 100, fmt(r.bw, 1) + " Mbit/s")).join("")}` : "") +
        `<p class="eddo-pg-h">EDDO-NAS ${st(N.state) && live(st(N.state)) ? `<span>ARRAY ${esc(st(N.state).s.toUpperCase())}</span>` : ""}</p>` +
        `<div class="eddo-pg-grid">${card("CPU", v("cpu") != null ? fmt(v("cpu")) + "%" : "—", v("temp") != null ? fmt(v("temp")) + "°C" : "", v("temp") >= 85 ? ' data-warn="true"' : "")}${card("RAM", v("ram") != null ? fmt(v("ram")) + "%" : "—")}${card("UP", upDays != null ? upDays + " d" : "—", v("upd") ? `${fmt(v("upd"))} container updates` : "")}</div>` +
        `${bar("ARRAY", v("array"), v("array") != null ? fmt(v("array")) + "%" : "—", v("array") >= 90)}${N.disks.map((id, i) => bar("DISK " + (i + 1), n(st(id)), n(st(id)) != null ? fmt(n(st(id))) + "%" : "—", n(st(id)) >= 90)).join("")}${bar("DOCKER CPU", v("dcpu"), v("dcpu") != null ? fmt(v("dcpu")) + "%" : "—")}` +
        (NET.mode !== "eero" ? `<p class="wb-muted eddo-pg-note">Install the eero integration to see every device on the eero it's using.</p>` : "");
    },
  });

  // ============================================================ 4. WORKSHOP — Bambu P1S + AMS, the filament shelf, the print queue
  const WS = { p: null, trays: [], queue: null, items: [], itemsAt: 0, stock: null, stockItems: [], stockAt: 0, obj: null, shelf: null, shelfKey: "" };
  async function loadList(id, force, at) {
    if (!id || (!force && Date.now() - WS[at] < 60e3)) return null;
    WS[at] = Date.now();
    try { const r = await HA().send({ type: "call_service", domain: "todo", service: "get_items", target: { entity_id: id }, return_response: true }); dirty = true; return ((r && r.response && r.response[id]) || {}).items || []; } catch (_) { return null; }
  }
  async function loadQueue(force) { const it = await loadList(WS.queue, force, "itemsAt"); if (it) WS.items = it; }
  async function loadStock(force) { const it = await loadList(WS.stock, force, "stockAt"); if (it) { WS.stockItems = it; buildShelfSpools(); } }
  const hexOf = (t) => { const m = /#([0-9a-f]{6})/i.exec(String(t || "")); return m ? parseInt(m[1], 16) : null; };
  const shortName = (t) => String(t || "").replace(/\(2nd spool\)/i, "").replace(/^(PLA|PETG|ABS|TPU|ASA)\s+(Basic|Matte|Silk|Silk Multi-Color|Tough|HF|CF)?\s*/i, "").trim() || String(t || "");
  // a spool: two flanges, the hub, and the wound filament between them; axis "z" faces the camera, "x" sits side-on (in the AMS)
  function spoolPts(ax, cx, cy, cz, r = 1, w = 0.66) {
    const fl = [], fil = [], off = (k) => (ax === "z" ? [cx, cy, cz + k] : [cx + k, cy, cz]);
    for (const k of [-w / 2, w / 2]) { const [x, y, z] = off(k); ring(fl, x, y, z, r, 40, ax); ring(fl, x, y, z, r * 0.28, 18, ax); }
    for (let i = 0; i < 4; i++) { const k = -w / 2 + 0.06 + (i / 3) * (w - 0.12), [x, y, z] = off(k); ring(fil, x, y, z, r * 0.84, 36, ax); }
    for (const k of [-w / 2 + 0.03, w / 2 - 0.03]) { const [x, y, z] = off(k); for (let rr = 0.4; rr <= 0.84; rr += 0.11) ring(fil, x, y, z, r * rr, 30, ax); }
    return { fl, fil };
  }
  const SHELF = { cols: 5, rows: 4, cell: 2.3, x0: -13.2, y0: 0.2 };
  function buildShelfSpools() {
    const g = WS.shelf, T = V3.T; if (!g || !T) return;
    const items = WS.stockItems.filter((i) => i.status === "needs_action").slice(0, SHELF.cols * SHELF.rows);
    const key = items.map((i) => i.uid + (i.description || "")).join("|"); if (key === WS.shelfKey) return; WS.shelfKey = key;
    g.children.slice().forEach((c) => { g.remove(c); c.geometry && c.geometry.dispose(); });
    WS.spools = [];
    for (const [k, el] of V3.tags) if (k.startsWith("sh") && k !== "shelf") el.dataset.hidden = "true";
    items.forEach((it, n) => {
      const c = n % SHELF.cols, r = Math.floor(n / SHELF.cols), cx = SHELF.x0 + (c + 0.5) * SHELF.cell, cy = SHELF.y0 + (SHELF.rows - r - 0.5) * SHELF.cell;
      const { fl, fil } = spoolPts("z", cx, cy, 0, 0.98);
      const col = hexOf(it.description) ?? 0x8fb9c2;
      const a = segs(T, fl, 0xb8c4c8, 0.35), b = segs(T, fil, col, 0.9);
      g.add(a, b); WS.spools.push({ it, a, b, x: cx, y: cy });
    });
  }
  page({
    id: "workshop", label: "Workshop", pos: 5, view: { dist: 33, ty: 4.3, phi: 1.22, tx: -3.6, theta: 0.18 }, sway: true, minDist: 8, maxDist: 48,
    discover(R) {
      if (!R) return;
      const bam = R.ents.filter((e) => e.platform === "bambu_lab" && !e.disabled_by);
      const f = (re) => { const x = bam.find((e) => re.test(e.entity_id)); return x ? x.entity_id : null; };
      WS.p = bam.length ? { progress: f(/print_progress$/), status: f(/print_status$/), stage: f(/current_stage$/), task: f(/task_name$/), layer: f(/current_layer$/), layers: f(/total_layer_count$/), remain: f(/remaining_time$/), end: f(/end_time$/),
        nozzle: f(/nozzle_temperature$/), bed: f(/bed_temperature$/), nozzleT: f(/nozzle_target_temperature$/), bedT: f(/sensor\..*bed_target_temperature$/), hum: f(/ams_1_humidity$/), amsT: f(/ams_1_temperature$/), active: f(/active_tray$/), weight: f(/print_weight$/), online: f(/_online$/) } : null;
      WS.trays = bam.filter((e) => /_ams_\d+_tray_\d+$/.test(e.entity_id) && e.entity_id.startsWith("sensor.")).map((e) => e.entity_id).sort();
      const todo = (re) => (R.allStates.find((s) => s.entity_id.startsWith("todo.") && re.test(s.entity_id + " " + String(s.attributes.friendly_name || "").toLowerCase())) || {}).entity_id || null;
      WS.queue = todo(/print.?queue|print/); WS.stock = todo(/filament/);
      watch([...(WS.p ? Object.values(WS.p) : []), ...WS.trays, WS.queue, WS.stock]);
      loadQueue(true); loadStock(true);
    },
    build(g, T) {
      g.add(floorGrid(T, 14).translateX(-3.6));
      const PX = 3.8, s = 3.9, h = 4.6, d = 3.9;   // P1S: 389 × 458 × 389 mm, 1 unit = 100 mm
      const P = new T.Group(); P.position.x = PX; g.add(P);
      const L = [];   // body outline
      const box = (x0, x1, y0, y1, z0, z1, out) => { const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; c.forEach(([x, z], k) => { const [nx, nz] = c[(k + 1) % 4]; out.push(x, y0, z, nx, y0, nz, x, y1, z, nx, y1, nz, x, y0, z, x, y1, z); }); };
      box(-s / 2, s / 2, 0, h, -d / 2, d / 2, L);
      const det = [], F = d / 2 + 0.01;
      det.push(-s / 2, 0.42, F, s / 2, 0.42, F);   // base band
      for (const [a, b] of [[[-1.72, 0.6], [1.72, 0.6]], [[1.72, 0.6], [1.72, 4.42]], [[1.72, 4.42], [-1.72, 4.42]], [[-1.72, 4.42], [-1.72, 0.6]]]) det.push(a[0], a[1], F, b[0], b[1], F);   // glass door
      det.push(1.5, 1.9, F + 0.04, 1.5, 3.1, F + 0.04);   // door handle
      det.push(-s / 2 + 0.25, h, -d / 2 + 0.25, s / 2 - 0.25, h, -d / 2 + 0.25, s / 2 - 0.25, h, -d / 2 + 0.25, s / 2 - 0.25, h, d / 2 - 0.25, s / 2 - 0.25, h, d / 2 - 0.25, -s / 2 + 0.25, h, d / 2 - 0.25, -s / 2 + 0.25, h, d / 2 - 0.25, -s / 2 + 0.25, h, -d / 2 + 0.25);   // top glass
      det.push(-1.3, 0.22, F, -0.7, 0.22, F);   // screen strip
      P.add(segs(T, L, COL.edge, 0.6), segs(T, det, COL.edge, 0.3));
      // AMS on top: 372 × 218 × 280 mm, sloped smoked lid, four spools side by side
      const A = [], aw = 3.72, ad = 2.8, ay = h + 0.02, ah = 2.0;
      box(-aw / 2, aw / 2, ay, ay + 0.9, -ad / 2, ad / 2, A);
      const lid = [[-aw / 2, ay + 0.9, ad / 2], [aw / 2, ay + 0.9, ad / 2], [aw / 2, ay + ah, ad / 2 - 0.55], [-aw / 2, ay + ah, ad / 2 - 0.55]];
      const back = [[-aw / 2, ay + ah, -ad / 2], [aw / 2, ay + ah, -ad / 2]];
      const P2 = (a, b) => A.push(...a, ...b);
      lid.forEach((p, k) => P2(p, lid[(k + 1) % 4])); P2(lid[3], back[0]); P2(lid[2], back[1]); P2(back[0], back[1]);
      P2([-aw / 2, ay + 0.9, -ad / 2], back[0]); P2([aw / 2, ay + 0.9, -ad / 2], back[1]);
      P.add(segs(T, A, COL.edge, 0.55));
      const amsSp = [];
      for (let k = 0; k < 4; k++) {
        const cx = -1.29 + k * 0.86, { fl, fil } = spoolPts("x", cx, ay + 1.0, -0.1, 0.92, 0.62);
        const a = segs(T, fl, 0xb8c4c8, 0.3), b = segs(T, fil, COL.edge, 0.85); P.add(a, b); amsSp.push({ a, b, x: PX + cx, y: ay + 2.25 });
      }
      // inside: the bed (moves down as the part grows), the gantry and toolhead at the top, the part itself
      const bed = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(2.56, 0.05, 2.56)), lineMat(T, COL.edge, 0.7)); P.add(bed);
      const gp = []; for (let k = -4; k <= 4; k++) { const v = (k / 4) * 1.28; gp.push(v, 0, -1.28, v, 0, 1.28, -1.28, 0, v, 1.28, 0, v); }
      const bedGrid = segs(T, gp, COL.edge, 0.15); P.add(bedGrid);
      const gantry = segs(T, [-1.8, 3.95, 0, 1.8, 3.95, 0, -1.8, 3.95, -0.1, -1.8, 3.95, 0.1], COL.edge, 0.6); P.add(gantry);
      const head = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(0.5, 0.55, 0.45)), lineMat(T, COL.cyan, 0.9)); head.position.y = 3.95; P.add(head);
      const NL = 60, op = [];
      for (let k = 0; k < NL; k++) { const y = (k / NL) * 1.6, r = 0.62 * (1 - 0.2 * Math.sin((k / NL) * Math.PI) + 0.08 * Math.sin(k / 3)); ring(op, 0, y, 0, r, 36); }
      const obj = segs(T, op, COL.cyan, 0.85); P.add(obj);
      // the filament shelf: 5 × 4 cubbies
      const sh = [], { cols, rows, cell, x0, y0 } = SHELF, x1 = x0 + cols * cell, y1 = y0 + rows * cell, zf = 0.55, zb = -0.55;
      for (let c = 0; c <= cols; c++) { const x = x0 + c * cell; sh.push(x, y0, zf, x, y1, zf, x, y0, zb, x, y1, zb); }
      for (let r = 0; r <= rows; r++) { const y = y0 + r * cell; sh.push(x0, y, zf, x1, y, zf, x0, y, zb, x1, y, zb); for (let c = 0; c <= cols; c++) { const x = x0 + c * cell; sh.push(x, y, zf, x, y, zb); } }
      sh.push(x0, 0, zf, x0, y0, zf, x1, 0, zf, x1, y0, zf);   // feet
      g.add(segs(T, sh, COL.edge, 0.28));
      WS.shelf = new T.Group(); g.add(WS.shelf); WS.shelfKey = "";
      WS.obj = { P, bed, bedGrid, gantry, head, obj, NL, amsSp, PX };
      buildShelfSpools();
    },
    tick(g, dt, now) {
      const o = WS.obj, P = WS.p; if (!o) return;
      if (WS.shelf && WS.shelf.children.length === 0 && WS.stockItems.length) { WS.shelfKey = ""; buildShelfSpools(); }
      const prog = P ? n(st(P.progress)) ?? 0 : 0, status = P ? String((st(P.status) || {}).s || "") : "", stage = P ? String((st(P.stage) || {}).s || "") : "";
      const printing = /running|printing|prepare/.test(status) || (/print|heat|level|calib/.test(stage) && !/idle|finish/.test(status));
      const done = /finish/.test(status), k = Math.max(0, Math.min(1, prog / 100));
      // the P1S lowers its bed as the part grows; the nozzle stays at the top
      const bedY = 3.7 - 1.6 * k - 0.05;
      o.bed.position.y = bedY; o.bedGrid.position.y = bedY + 0.03; o.obj.position.y = bedY + 0.03;
      o.obj.geometry.setDrawRange(0, Math.round(o.NL * k) * 36 * 2);
      const trays = WS.trays.map((id) => st(id));
      const act = trays.find((t) => t && t.a.active);
      const colHex = act && act.a.color ? parseInt(String(act.a.color).slice(1, 7), 16) : COL.cyan;
      o.obj.material.color.setHex(colHex); o.obj.material.opacity = printing ? 0.9 : done ? 0.55 : 0.15;
      o.head.position.x = printing ? Math.sin(now / 180) * 0.7 : 0; o.head.position.z = printing ? Math.cos(now / 240) * 0.6 : 0; o.head.material.opacity = printing ? 0.95 : 0.45;
      o.amsSp.forEach((sp, i) => {
        const t = trays[i];
        const c = t && t.a.color ? parseInt(String(t.a.color).slice(1, 7), 16) : COL.edge, on = !!(t && t.a.active), empty = !t || t.a.empty;
        sp.b.material.color.setHex(c); sp.b.material.opacity = empty ? 0 : on ? 0.95 : 0.75;
        if (on && printing) { sp.a.rotation.x += dt * 1.2; sp.b.rotation.x += dt * 1.2; }
        pick("ams" + i, sp.x, sp.y - 1.1, 0, () => `<b>AMS SLOT ${i + 1}${on ? " · FEEDING" : ""}</b><dl><dt>FILAMENT</dt><dd>${esc(empty ? "Empty" : t.a.name || t.s)}</dd><dt>TYPE</dt><dd>${esc((t && t.a.type) || "—")}</dd><dt>COLOUR</dt><dd><i class="eddo-sw" style="background:${esc(String((t && t.a.color) || "#555").slice(0, 7))}"></i>${esc(String((t && t.a.color) || "").slice(0, 7))}</dd>${t && t.a.remain >= 0 ? `<dt>LEFT</dt><dd>${t.a.remain}%</dd>` : ""}${t && t.a.nozzle_temp_min ? `<dt>NOZZLE</dt><dd>${esc(t.a.nozzle_temp_min)}–${esc(t.a.nozzle_temp_max)}°</dd>` : ""}</dl>`);
      });
      // one label for the whole AMS (four separate ones sit on top of each other)
      tag("ams", o.PX, 7.15, 0, `<b>AMS</b><span class="eddo-ams-row">${o.amsSp.map((sp, i) => { const t = trays[i], c = t && !t.a.empty && t.a.color ? String(t.a.color).slice(0, 7) : "transparent"; return `<i style="background:${esc(c)}"${t && t.a.active ? ' data-on="true"' : ""}></i>`; }).join("")}</span>`, true);
      (WS.spools || []).forEach((sp, i) => {
        tag("sh" + i, sp.x, sp.y - 1.25, 0.6, `<b>${esc(shortName(sp.it.summary).toUpperCase())}</b>`, true, "eddo-page-tag-sm eddo-page-tag-shelf");
        const it = sp.it, parts = String(it.description || "").split("·").map((x) => x.trim());
        pick("sp:" + it.uid, sp.x, sp.y, 0.4, () => `<b>${esc(it.summary.toUpperCase())}</b><dl><dt>COLOUR</dt><dd><i class="eddo-sw" style="background:${esc(parts[0] && /^#/.test(parts[0]) ? parts[0] : "#555")}"></i>${esc(parts[0] || "—")}</dd>${parts[1] ? `<dt>TYPE</dt><dd>${esc(parts[1])}</dd>` : ""}${parts[2] ? `<dt>CODE</dt><dd>${esc(parts[2])}</dd>` : ""}${parts[3] ? `<dt>BOUGHT</dt><dd>${esc(parts.slice(3).join(" · "))}</dd>` : ""}</dl>`,
          { remove: { label: "REMOVE FROM SHELF", ask: `Remove ${it.summary} from the shelf?`, run: () => { HA().send({ type: "call_service", domain: "todo", service: "remove_item", target: { entity_id: WS.stock }, service_data: { item: it.uid } }).catch(() => {}).finally(() => setTimeout(() => loadStock(true), 500)); } } });
      });
      const task = P && st(P.task);
      tag("job", o.PX, 8.3, 0, `<b>${printing ? Math.round(prog) + "%" : done ? "DONE" : "IDLE"}</b><span>${esc(String(live(task) ? task.s : "").toUpperCase())}</span>`, !!P);
      tag("shelf", SHELF.x0 + (SHELF.cols * SHELF.cell) / 2, SHELF.y0 + SHELF.rows * SHELF.cell + 0.7, 0, `<b>FILAMENT</b><span>${(WS.spools || []).length} SPOOLS${WS.stock ? "" : " · NO LIST"}</span>`, true);
    },
    panel() {
      const P = WS.p; if (!P) return `<p class="wb-muted eddo-pg-note">No Bambu Lab printer in Home Assistant.</p>`;
      const prog = n(st(P.progress)), status = String((st(P.status) || {}).s || "—"), stage = String((st(P.stage) || {}).s || "").replace(/_/g, " ");
      const rem = n(st(P.remain)), end = st(P.end), task = st(P.task);
      const printing = /running|printing|prepare/.test(status);
      const items = WS.items.filter((i) => i.status === "needs_action"), doneN = WS.items.length - items.length;
      const stockN = WS.stockItems.filter((i) => i.status === "needs_action").length;
      return `<div class="wb-large">${prog != null ? Math.round(prog) : "—"}<small>${printing ? "% PRINTED" : status === "finish" ? "% · FINISHED" : "% · " + esc(status.toUpperCase())}</small></div>` +
        `<p class="eddo-pg-task">${esc(live(task) ? task.s : "No job")}</p><i class="eddo-pg-prog"><s style="width:${prog || 0}%"></s></i>` +
        `<div class="eddo-pg-grid">${card("LAYER", `${fmt(n(st(P.layer)))} / ${fmt(n(st(P.layers)))}`, esc(stage.toUpperCase()))}${card("TIME LEFT", rem != null && printing ? (rem >= 1 ? `${Math.floor(rem)} h ${Math.round((rem % 1) * 60)} m` : `${Math.round(rem * 60)} min`) : "—", printing && live(end) ? "done " + new Date(end.s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "")}` +
        `${card("NOZZLE", fmt(n(st(P.nozzle))) + "°", n(st(P.nozzleT)) ? "→ " + fmt(n(st(P.nozzleT))) + "°" : "")}${card("BED", fmt(n(st(P.bed))) + "°", n(st(P.bedT)) ? "→ " + fmt(n(st(P.bedT))) + "°" : "")}${card("AMS", n(st(P.hum)) != null ? fmt(n(st(P.hum))) + "% RH" : "—", n(st(P.amsT)) != null ? fmt(n(st(P.amsT)), 1) + "°C" : "", n(st(P.hum)) >= 45 ? ' data-warn="true"' : "")}${card("ON THE SHELF", stockN, "spools")}</div>` +
        `<p class="eddo-pg-h">PRINT QUEUE ${WS.queue ? `<span>${items.length} TO PRINT${doneN ? ` · ${doneN} DONE` : ""}</span>` : ""}</p>` +
        (WS.queue ? `<div class="eddo-pg-queue">${items.map((i) => `<button data-q="${esc(i.uid)}"><i></i><b>${esc(i.summary)}</b>${i.description ? `<small>${esc(i.description)}</small>` : ""}</button>`).join("") || `<p class="wb-muted eddo-pg-note">Queue's empty.</p>`}</div><form class="eddo-pg-add" data-qadd><input name="t" placeholder="Add a model to print…" autocomplete="off"><button>ADD</button></form>`
          : `<p class="wb-muted eddo-pg-note">Make a to-do list called "Print queue" in Home Assistant and it shows up here.</p>`) +
        `<p class="wb-muted eddo-pg-note">The shelf is the "Filament stock" list in Home Assistant: tick a spool off there when it's used up, add new ones with a colour like #FF8800 in the description.</p>`;
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
  setInterval(() => { if (window.eddoTabs.active() === "workshop") { loadStock(false); loadQueue(false); } }, 30e3);

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
