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
      const p = V3.page, swipe = !!(p && p.dragStart && p.dragStart(e.clientX, e.clientY));
      V3.drag = { x: e.clientX, y: e.clientY, th: V3.view.theta, ph: V3.view.phi, hover: V3.hover, swipe }; if (!swipe) V3.view.auto = false;
    });
    window.addEventListener("pointermove", (e) => {
      const d = V3.drag; if (!d) return;
      if (d.swipe) { V3.page && V3.page.dragMove && V3.page.dragMove(e.clientX - d.x); return; }
      V3.view.theta = d.th - (e.clientX - d.x) * 0.006; V3.view.phi = Math.max(0.35, Math.min(1.45, d.ph - (e.clientY - d.y) * 0.004));
    });
    window.addEventListener("pointerup", (e) => {
      const d = V3.drag; if (!d) return;
      V3.drag = null;
      if (d.swipe) {
        V3.page && V3.page.dragEnd && V3.page.dragEnd(e.clientX - d.x);
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) { V3.pinned = d.hover || null; V3.confirm = null; drawCard(); }   // a tap on a spool still opens it
        return;
      }
      clearTimeout(V3.resume); V3.resume = setTimeout(() => { V3.view.auto = true; }, 8000);
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) { V3.pinned = d.hover || null; V3.confirm = null; V3.view.auto = !d.hover && V3.view.auto; drawCard(); }   // a click pins what was under the mouse (or clears)
    });
    stage.addEventListener("pointermove", (e) => {
      if (!V3.running) return;
      const ui = e.target.closest("button,a,input,.workbench,.wb-overview,.eddo-ha,.eddo-srv,.eddo-pip,.system-footer,.system-nav,.eddo-page-card");
      V3.mouse = ui ? null : { x: e.clientX, y: e.clientY };
    });
    stage.addEventListener("pointerleave", () => { V3.mouse = null; });
    stage.addEventListener("wheel", (e) => {
      if (!V3.running || e.target.closest(".workbench,.wb-overview,.eddo-ha,.eddo-srv,.eddo-pip")) return;
      const p = V3.page;
      if (p && p.onSwipe && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.8) {
        V3.swipe = (V3.swipe || 0) + e.deltaX; clearTimeout(V3.swipeT);
        V3.swipeT = setTimeout(() => { V3.swipe = 0; V3.swipeLock = false; }, 220);   // the gesture (and its momentum) has finished
        if (!V3.swipeLock && Math.abs(V3.swipe) > 35) { p.onSwipe(Math.sign(V3.swipe)); V3.swipeLock = true; }
        return;
      }
      V3.view.dist = Math.max((p && p.minDist) || 4, Math.min((p && p.maxDist) || 30, V3.view.dist * (1 + Math.sign(e.deltaY) * 0.08)));
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
      (pk.actions && pk.actions.open ? `<button class="eddo-page-card-open" data-pcard-open>${esc(pk.actions.open.label)}</button>` : "") +
      (V3.pinned === key ? "" : `<em class="eddo-page-card-hint">CLICK TO KEEP OPEN</em>`);
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest(".eddo-page-card")) return;
    const pk = V3.picks.find((x) => x.key === V3.pinned);
    if (e.target.closest("[data-pcard-close]") || e.target.closest("[data-pcard-no]") && !V3.confirm) { V3.pinned = null; V3.confirm = null; }
    else if (e.target.closest("[data-pcard-no]")) V3.confirm = null;
    else if (e.target.closest("[data-pcard-rm]")) V3.confirm = V3.pinned;
    else if (e.target.closest("[data-pcard-open]") && pk && pk.actions && pk.actions.open) { V3.pinned = null; pk.actions.open.run(); }
    else if (e.target.closest("[data-pcard-yes]") && pk && pk.actions && pk.actions.remove) { pk.actions.remove.run(); V3.pinned = null; V3.confirm = null; }
    drawCard();
  });
  function frame(now) {
    if (!V3.running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, V3.last ? (now - V3.last) / 1000 : 0.016); V3.last = now;
    const v = V3.view, pg = V3.page;
    if (v.auto && !V3.pinned && pg && pg.still) { const e = Math.min(1, dt * 1.2); v.theta += (pg.view.theta - v.theta) * e; v.phi += (pg.view.phi - v.phi) * e; }   // a fixed front view: drift back to it
    else if (v.auto && !V3.pinned) { if (pg && pg.sway) { v.swayT = (v.swayT || 0) + dt; v.theta = pg.view.theta + Math.sin(v.swayT / 7) * 0.32; } else v.theta += dt * 0.12; }
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
    fitPanel(box);
  }, 500);
  // keep a page's panel clear of the tab bar under it: cap its height and let it scroll
  function fitPanel(box) {
    const nav = document.querySelector("#stage .wb-nav"); if (!nav || !box.isConnected) return;
    const sc = box.getBoundingClientRect().height / (box.offsetHeight || 1) || 1, room = (nav.getBoundingClientRect().top - box.getBoundingClientRect().top) / sc - 18;
    if (room > 120) { box.style.maxHeight = room + "px"; box.dataset.scroll = String(box.scrollHeight > room + 2); }
  }
  window.addEventListener("resize", () => document.querySelectorAll("#stage .eddo-pg").forEach(fitPanel));
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
      NET.net = netDev ? { status: pick(netDev.id, /_status$/), test: pick(netDev.id, /run_speed_test$/), down: pick(netDev.id, /_download_speed$/), up: pick(netDev.id, /_upload_speed$/), ip: pick(netDev.id, /_public_ip$/), clients: pick(netDev.id, /_connected_clients$/), guests: pick(netDev.id, /_connected_guest_clients$/), name: netDev.name_by_user || netDev.name } : {};
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
  // ---------------------------------------------------------------- the EDNET rack (Edward's 10" mini rack, from the photo)
  // Top to bottom: EDNET logo · Netgear GS308 · Cat6 patch panel · Hue bridge · eero (behind the vent) · Home Assistant Yellow · Ring · EDDO-NAS (behind the vent)
  const RACK = { view: "rack", g: null, mesh: null, tex: null, canvas: null, drawn: 0, blink: [] };
  const RU = [   // unit height in front-panel pixels (the panel face is drawn 1024 px wide)
    { id: "logo", name: "EDNET", h: 190 }, { id: "switch", name: "NETGEAR GS308", h: 175 }, { id: "patch", name: "PATCH PANEL", h: 170 },
    { id: "hue", name: "HUE BRIDGE", h: 160 }, { id: "eero", name: "LIVING ROOM EERO", h: 160 },
    { id: "ha", name: "HOME ASSISTANT YELLOW", h: 150 }, { id: "ring", name: "RING", h: 140 }, { id: "nas", name: "EDDO-NAS", h: 155 },
  ];
  const FACE_W = 1024, FACE_H = RU.reduce((t, u) => t + u.h, 0), W3 = 5.08, H3 = (W3 * FACE_H) / FACE_W, Y0 = 0.35, DEPTH = 3.4;
  RU.reduce((y, u) => { u.y = y; return y + u.h; }, 0);
  const unitY = (u) => Y0 + H3 * (1 - (u.y + u.h / 2) / FACE_H);   // 3D height of a unit's centre
  const DOCKERS = [["plex", "Plex"], ["immich", "Immich"], ["adguard_home", "AdGuard Home"], ["vaultwarden", "Vaultwarden"], ["nginxproxymanager", "Nginx Proxy Manager"], ["nanit", "Nanit bridge"], ["eddo_os_web", "EDDO OS (web)"], ["music_assistant", "Music Assistant"], ["paperless_ngx", "Paperless"]];
  const RK = { hue: [], cont: [], ha: null, haOs: null, autos: [], ringHosts: [] };
  function rackDiscover(R) {
    RK.hue = R.ents.filter((e) => e.platform === "hue" && e.entity_id.startsWith("light.") && !e.disabled_by).map((e) => e.entity_id);
    RK.cont = R.allStates.filter((x) => /^switch\.eddo_nas_container_/.test(x.entity_id)).map((x) => x.entity_id);
    RK.ha = (R.allStates.find((x) => x.entity_id === "update.home_assistant_core_update") || {}).entity_id || null;
    RK.haOs = (R.allStates.find((x) => x.entity_id === "update.home_assistant_operating_system_update") || {}).entity_id || null;
    RK.autos = R.allStates.filter((x) => x.entity_id.startsWith("automation.")).map((x) => x.entity_id);
    watch([...RK.hue, ...RK.cont, ...DOCKERS.map(([k]) => `binary_sensor.eddo_nas_container_${k}_update`), RK.ha, RK.haOs, ...RK.autos].filter(Boolean));
  }
  const ringDevs = () => NET.devs.filter((d) => /^ring/i.test(d.name) || /ring/i.test(((st(d.tracker) || { a: {} }).a.host_name) || ""));
  const wiredOn = () => NET.devs.filter((d) => { const p = netPlace(d); return p.on && p.wired; });
  const eeroHub = () => NET.hubs.find((h) => /living/i.test(h.name)) || NET.hubs[0];
  // ---- the front face, drawn like the photo: black printed panels, purple Cat6 keystones, yellow patch leads
  const FACE_SCALE = 1.5;   // the face canvas is drawn at 1.5× for crisper detail (all drawing still uses 1024-wide coordinates)
  function screw(g, x, y) {   // a domed black head with a Phillips cross, sitting in a slight recess
    g.fillStyle = "rgba(0,0,0,.55)"; g.beginPath(); g.arc(x + 1.5, y + 2.5, 14, 0, 7); g.fill();
    const gr = g.createRadialGradient(x - 4, y - 5, 1, x, y, 13); gr.addColorStop(0, "#4a4f57"); gr.addColorStop(0.45, "#1b1d21"); gr.addColorStop(1, "#08090a");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill();
    g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 12.5, Math.PI * 1.05, Math.PI * 1.75); g.stroke();
    g.lineCap = "round"; g.strokeStyle = "#050506"; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.1)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 6, y - 1.5); g.lineTo(x + 6, y - 1.5); g.stroke();
  }
  function keystone(g, x, y, used) {   // a purple Cat6 keystone: body, latch, label and a recessed jack
    g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(x - 25, y - 23, 52, 52);
    const gr = g.createLinearGradient(0, y - 24, 0, y + 24); gr.addColorStop(0, "#7a63d8"); gr.addColorStop(0.5, "#5b45b8"); gr.addColorStop(1, "#46349a");
    g.fillStyle = gr; g.fillRect(x - 24, y - 24, 48, 48);
    g.strokeStyle = "rgba(255,255,255,.18)"; g.lineWidth = 1; g.strokeRect(x - 23.5, y - 23.5, 47, 47);
    g.fillStyle = "#3a2a80"; g.fillRect(x - 24, y + 17, 48, 7); g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(x - 10, y - 22, 20, 3);
    const jg = g.createLinearGradient(0, y - 12, 0, y + 10); jg.addColorStop(0, "#000"); jg.addColorStop(1, used ? "#3d3f4a" : "#1a1c20");
    g.fillStyle = jg; g.fillRect(x - 14, y - 12, 28, 22);
    if (used) { g.fillStyle = "rgba(190,205,255,.85)"; g.fillRect(x - 12, y - 10, 24, 18); g.fillStyle = "rgba(255,255,255,.6)"; g.fillRect(x - 12, y - 10, 24, 3); }
    else { g.fillStyle = "#c9a54a"; for (let k = 0; k < 8; k++) g.fillRect(x - 10 + k * 2.8, y - 11, 1.4, 4); }   // the contacts inside an empty jack
  }
  let layerPattern = null;
  function rackPanelFace(g, u) {   // a 3D-printed black panel: fine layer lines, a chamfered edge, recessed screws
    const y0 = u.y + 4, h = u.h - 8, x0 = 14, w = FACE_W - 28;
    g.fillStyle = "#121316"; g.fillRect(x0, y0, w, h);
    if (!layerPattern) { const pc = Object.assign(document.createElement("canvas"), { width: 8, height: 4 }), q = pc.getContext("2d"); q.fillStyle = "rgba(255,255,255,.035)"; q.fillRect(0, 0, 8, 1); q.fillStyle = "rgba(0,0,0,.12)"; q.fillRect(0, 2, 8, 1); layerPattern = g.createPattern(pc, "repeat"); }
    g.fillStyle = layerPattern; g.fillRect(x0, y0, w, h);
    const grd = g.createLinearGradient(0, y0, 0, y0 + h); grd.addColorStop(0, "rgba(255,255,255,.07)"); grd.addColorStop(0.5, "rgba(255,255,255,0)"); grd.addColorStop(1, "rgba(0,0,0,.35)"); g.fillStyle = grd; g.fillRect(x0, y0, w, h);
    g.strokeStyle = "rgba(255,255,255,.14)"; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 3, y0 + h - 2); g.lineTo(x0 + 3, y0 + 3); g.lineTo(x0 + w - 3, y0 + 3); g.stroke();   // lit chamfer
    g.strokeStyle = "rgba(0,0,0,.7)"; g.beginPath(); g.moveTo(x0 + w - 2, y0 + 3); g.lineTo(x0 + w - 2, y0 + h - 2); g.lineTo(x0 + 3, y0 + h - 2); g.stroke();      // shaded chamfer
    screw(g, 52, y0 + 26); screw(g, 52, y0 + h - 26); screw(g, FACE_W - 52, y0 + 26); screw(g, FACE_W - 52, y0 + h - 26);
  }
  function drawFace(now) {
    const c = RACK.canvas, g = c.getContext("2d"); g.setTransform(FACE_SCALE, 0, 0, FACE_SCALE, 0, 0); g.clearRect(0, 0, FACE_W, FACE_H);
    const U = Object.fromEntries(RU.map((u) => [u.id, u]));
    for (const u of RU) if (u.id !== "gap") rackPanelFace(g, u);
    // EDNET
    { const u = U.logo, mk = window.eddoHouse && window.eddoHouse.mark && window.eddoHouse.mark(), m = mk && /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(mk), d = mk && /d="([^"]+)"/.exec(mk);
      if (m && d && window.Path2D) { const vw = +m[1], vh = +m[2], w = 520, k = w / vw; g.save(); g.translate((FACE_W - w) / 2, u.y + u.h / 2 - (vh * k) / 2); g.scale(k, k); const run = RACK.testing ? 0.5 + 0.5 * Math.sin(now / 140) : 0; g.fillStyle = "#f2f2ee"; g.shadowColor = `rgba(127,216,255,${0.45 + 0.5 * run})`; g.shadowBlur = 18 + 40 * run; g.fill(new Path2D(d[1])); g.restore(); }
      else { g.font = "italic 900 120px MiSans, system-ui"; g.fillStyle = "#f2f2ee"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("EDNET", FACE_W / 2, u.y + u.h / 2); g.textAlign = "left"; } }
    // GS308: grey switch with 8 ports and their lights; a keystone each side
    const sw = U.switch, sy = sw.y + sw.h / 2, ports = [];
    keystone(g, 128, sy - 14, true); keystone(g, 920, sy - 14, false);
    { const mg = g.createLinearGradient(0, sw.y + 34, 0, sw.y + 138); mg.addColorStop(0, "#2a2d33"); mg.addColorStop(0.5, "#1b1d21"); mg.addColorStop(1, "#141518"); g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(223, sw.y + 38, 600, 104); g.fillStyle = mg; g.fillRect(220, sw.y + 34, 600, 104); g.strokeStyle = "rgba(255,255,255,.16)"; g.strokeRect(220.5, sw.y + 34.5, 599, 103); }
    g.font = "600 20px MiSans, system-ui"; g.fillStyle = "#cfd2d6"; g.fillText("NETGEAR", 236, sw.y + 60); g.fillText("GS308", 742, sw.y + 60);
    const wired = Math.max(1, Math.min(8, wiredOn().length || 7));
    for (let i = 0; i < 8; i++) {
      const x = 300 + i * 62, y = sw.y + 92; ports.push([x, y]);
      { const pg2 = g.createLinearGradient(0, y - 18, 0, y + 18); pg2.addColorStop(0, "#000"); pg2.addColorStop(1, "#202226"); g.fillStyle = pg2; g.fillRect(x - 22, y - 18, 44, 36); g.strokeStyle = "#5a5e64"; g.strokeRect(x - 22, y - 18, 44, 36); g.fillStyle = "#c9a54a"; for (let q = 0; q < 8; q++) g.fillRect(x - 12 + q * 3.2, y - 16, 1.5, 4); }
      const lit = i < 7 && (RACK.blink[i] = (RACK.blink[i] || 0) + Math.random()) % 3 > (i < wired ? 0.5 : 2.9);
      g.fillStyle = i < 7 ? (lit ? "#5bff7a" : "#1f6b2c") : "#222"; if (lit) { g.shadowColor = "#5bff7a"; g.shadowBlur = 10; } g.fillRect(x + 8, y - 30, 8, 6); g.shadowBlur = 0;
    }
    // patch panel: ten Cat6 keystones, the first seven patched
    const pp = U.patch, py = pp.y + pp.h / 2, pk = [];
    for (let i = 0; i < 10; i++) { const x = 130 + i * 85; pk.push([x, py]); keystone(g, x, py, i < 7); g.font = "500 11px MiSans, system-ui"; g.fillStyle = "#8f86c9"; g.fillText("CAT.6", x - 16, py - 30); }
    // Hue bridge panel: round cable hole, two keystones, USB-C, a button, and the white bridge itself
    const hu = U.hue, hy = hu.y + hu.h / 2, hueOn = RK.hue.filter((id) => (st(id) || {}).s === "on").length;
    g.fillStyle = "#050607"; g.beginPath(); g.arc(120, hy, 40, 0, 7); g.fill();
    keystone(g, 230, hy, false); keystone(g, 320, hy, false);
    g.fillStyle = "#0b0c0e"; g.fillRect(395, hy - 26, 30, 52); g.fillStyle = "#333"; g.fillRect(404, hy - 10, 12, 20);
    g.fillStyle = "#050607"; g.beginPath(); g.arc(475, hy, 14, 0, 7); g.fill();
    g.fillStyle = "#e9ebee"; g.beginPath(); g.roundRect ? g.roundRect(560, hu.y + 26, 300, hu.h - 52, 18) : g.rect(560, hu.y + 26, 300, hu.h - 52); g.fill();
    g.strokeStyle = "#c9ccd1"; g.lineWidth = 2; g.stroke();
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(680 + i * 22, hu.y + 50, 6, 0, 7); g.strokeStyle = hueOn ? "#7fb2ff" : "#b8bcc2"; g.stroke(); }
    g.fillStyle = "#d4d7db"; g.fillRect(760, hy - 10, 46, 40); keystone(g, 940, hy + 4, true);
    // eero vent
    const slot = (x, y, w, h, a) => { const sg = g.createLinearGradient(x, 0, x + w, 0); sg.addColorStop(0, `rgba(0,0,0,${a})`); sg.addColorStop(0.5, `rgba(4,5,7,${a * 0.85})`); sg.addColorStop(1, `rgba(0,0,0,${a})`); g.fillStyle = sg; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 6) : g.rect(x, y, w, h); g.fill(); g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(x + w, y + 3, 1.5, h - 6); };
    const ve = U.eero; for (let i = 0; i < 26; i++) slot(150 + i * 28, ve.y + 34, 14, ve.h - 68, 1);
    const eh = eeroHub(), eOk = !eh || !st(eh.status) || /green|connected|online/.test(st(eh.status).s);
    g.fillStyle = eOk ? "rgba(255,255,255,.18)" : "rgba(255,90,74,.4)"; g.fillRect(450, ve.y + 70, 120, 20);   // the eero's light through the slots
    // Home Assistant Yellow: the board's I/O through a window
    const ha = U.ha, hy2 = ha.y + ha.h / 2;
    g.fillStyle = "#1a1c20"; g.fillRect(360, ha.y + 20, 450, ha.h - 40); g.fillStyle = "#c7c9cc"; g.fillRect(372, ha.y + 28, 426, ha.h - 56);
    g.fillStyle = "#2a2d31"; g.fillRect(395, hy2 - 30, 22, 14); g.fillRect(430, hy2 - 30, 22, 14);
    g.fillStyle = "#4f8cff"; g.beginPath(); g.arc(405, hy2 + 14, 8, 0, 7); g.fill(); g.fillStyle = "#ff5a5a"; g.beginPath(); g.arc(440, hy2 + 14, 8, 0, 7); g.fill();
    g.fillStyle = "#e3e5e8"; g.fillRect(500, hy2 - 30, 48, 26); g.fillRect(500, hy2 + 2, 48, 26);
    g.fillStyle = "#2a2d31"; g.fillRect(575, hy2 + 8, 22, 12);
    g.fillStyle = "#9fa3a8"; g.fillRect(630, hy2 - 20, 64, 52); g.fillStyle = "#0c0d0f"; g.fillRect(640, hy2 - 8, 44, 34);
    g.fillStyle = Math.sin(now / 180) > 0 ? "#5bff7a" : "#1f6b2c"; g.fillRect(636, hy2 - 18, 8, 6); g.fillStyle = "#5bff7a"; g.fillRect(680, hy2 - 18, 8, 6);
    g.fillStyle = "#0c0d0f"; g.fillRect(720, hy2 - 10, 40, 40); keystone(g, 150, ha.y + 40, true);
    // Ring (blank panel with a keystone)
    const rg = U.ring; keystone(g, 150, rg.y + 60, true);
    const ringN = ringDevs().filter((d) => netPlace(d).on).length;
    g.font = "600 18px MiSans, system-ui"; g.fillStyle = ringN ? "#7fd8ff" : "#555"; g.fillText("● RING", 840, rg.y + rg.h / 2 + 6);
    // NAS vent, lit blue by the fans (brighter when the CPU works harder)
    // hovered: a heartbeat that beats faster and brighter the harder the CPU works
    const nk = (RACK.unit && RACK.unit.nas && RACK.unit.nas.k) || 0, cpu = n(st(NET.nas.cpu)) || 10, period = Math.max(260, 1500 - cpu * 12);
    const beat = Math.pow(Math.max(0, Math.sin((now / period) * Math.PI)), 6);
    const nv = U.nas, glow = 0.25 + Math.min(0.6, cpu / 100) + 0.08 * Math.sin(now / 700) + nk * (0.15 + 0.55 * beat);
    const bg = g.createRadialGradient(FACE_W / 2, nv.y + nv.h / 2, 10, FACE_W / 2, nv.y + nv.h / 2, 340); bg.addColorStop(0, `rgba(70,110,255,${glow})`); bg.addColorStop(1, "rgba(70,110,255,0)");
    g.fillStyle = bg; g.fillRect(100, nv.y + 20, FACE_W - 200, nv.h - 40);
    for (let i = 0; i < 26; i++) slot(150 + i * 28, nv.y + 30, 14, nv.h - 60, 0.82);
    if (!RACK.leads) RACK.leads = [   // (fixed positions: work them out once)
      { a: [128, sy - 6], b: [ports[0][0], ports[0][1]], col: 0xe8b52a, sag: 60, ua: "switch", ub: "switch" },
      ...[1, 2, 3, 4, 5, 6].map((i) => ({ a: [ports[i][0], ports[i][1]], b: [pk[i - 1][0], pk[i - 1][1]], col: 0xe8b52a, sag: 50, ua: "switch", ub: "patch" })),
      { a: [940, hy + 4], b: [785, hy + 10], col: 0xe8b52a, sag: -40, ua: "hue", ub: "hue" },
      { a: [150, ha.y + 40], b: [660, hy2 + 10], col: 0x8a63d6, sag: 90, ua: "ha", ub: "ha" },
    ];
    RACK.drawn = now; if (RACK.tex) RACK.tex.needsUpdate = true;
  }
  // ---- the patch leads as real cables: tubes that arc out of the panel, with plugs at each end
  const faceAt = (px, py) => [(px / FACE_W - 0.5) * W3, Y0 + H3 * (1 - py / FACE_H)];
  const unitK = (id) => (RACK.unit && RACK.unit[id] ? RACK.unit[id].k : 0);
  function leadCurve(L, j) {
    const [ax, ay] = faceAt(...L.a), [bx, by] = faceAt(...L.b), za = 0.1 + 0.22 * unitK(L.ua), zb = 0.1 + 0.22 * unitK(L.ub), sag = (H3 * L.sag) / FACE_H;
    return [[ax, ay, za], [ax + j * 0.05, ay - sag, za + 0.5 + j * 0.06], [bx - j * 0.05, by + sag * 0.6, zb + 0.5 - j * 0.04], [bx, by, zb]];
  }
  const bez = (P, t) => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; return [0, 1, 2].map((k) => a * P[0][k] + b * P[1][k] + c * P[2][k] + d * P[3][k]); };
  const SEG = 36, RAD = 8, LIGHT = (() => { const v = [-0.4, 0.75, 0.55], m = Math.hypot(...v); return v.map((x) => x / m); })();
  function makeTube(T, col) {
    const geo = new T.BufferGeometry(), n = (SEG + 1) * RAD, idx = [];
    geo.setAttribute("position", new T.Float32BufferAttribute(new Array(n * 3).fill(0), 3));
    geo.setAttribute("color", new T.Float32BufferAttribute(new Array(n * 3).fill(1), 3));
    for (let i = 0; i < SEG; i++) for (let r = 0; r < RAD; r++) { const a = i * RAD + r, b = i * RAD + ((r + 1) % RAD), c = a + RAD, d = b + RAD; idx.push(a, c, b, b, c, d); }
    geo.setIndex(idx);
    return new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, color: col, transparent: true }));
  }
  function updateTube(mesh, P, rad) {
    const pos = mesh.geometry.attributes.position.array, colr = mesh.geometry.attributes.color.array;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, p = bez(P, t), q = bez(P, Math.min(1, t + 0.01)), o = bez(P, Math.max(0, t - 0.01));
      let tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // a frame around the tangent: n1 ⟂ tangent (from world up, or x when the cable runs vertically), n2 = t × n1
      let ux = 0, uy = 1, uz = 0; if (Math.abs(ty) > 0.9) { ux = 1; uy = 0; }
      let n1x = uy * tz - uz * ty, n1y = uz * tx - ux * tz, n1z = ux * ty - uy * tx; const nl = Math.hypot(n1x, n1y, n1z) || 1; n1x /= nl; n1y /= nl; n1z /= nl;
      const n2x = ty * n1z - tz * n1y, n2y = tz * n1x - tx * n1z, n2z = tx * n1y - ty * n1x;
      for (let r = 0; r < RAD; r++) {
        const a = (r / RAD) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a), nx = n1x * c + n2x * s2, ny = n1y * c + n2y * s2, nz = n1z * c + n2z * s2, k = (i * RAD + r) * 3;
        pos[k] = p[0] + nx * rad; pos[k + 1] = p[1] + ny * rad; pos[k + 2] = p[2] + nz * rad;
        const sh = 0.45 + 0.55 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) + 0.25 * Math.pow(Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]), 12);
        colr[k] = colr[k + 1] = colr[k + 2] = sh;
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.attributes.color.needsUpdate = true;
  }
  function buildLeads(g, T) {
    RACK.cables = (RACK.leads || []).map((L) => {
      const tube = makeTube(T, L.col); g.add(tube);
      const boot = () => { const b = new T.Mesh(new T.BoxGeometry(0.11, 0.11, 0.2), new T.MeshBasicMaterial({ color: 0xb9c8ff, transparent: true, opacity: 0.55 })); g.add(b); return b; };
      const dots = [0, 1, 2].map(() => { const d = new T.Mesh(new T.SphereGeometry(0.045, 10, 8), new T.MeshBasicMaterial({ color: 0xc8f4ff, transparent: true, opacity: 0, depthWrite: false })); g.add(d); return d; });
      return { L, tube, ba: boot(), bb: boot(), dots };
    });
  }
  function tickLeads(now) {
    const flow = Math.max(unitK("eero"), unitK("switch")), busy = NET.devs.reduce((t, d) => t + rate(d.dl) + rate(d.ul), 0), speed = 0.35 + Math.min(1.6, busy / 40);
    (RACK.cables || []).forEach((c, i) => {
      const L = c.L, k = Math.max(unitK(L.ua), unitK(L.ub)), j = k * Math.sin(now / 90 + i * 1.7);   // wobble while a unit it plugs into is hovered
      const P = leadCurve(L, j); updateTube(c.tube, P, 0.034);
      const dim = RACK.any && k < 0.1 ? 0.3 : 1, hi = 1 + 0.35 * k;
      c.tube.material.color.setHex(L.col).multiplyScalar(dim * hi);
      c.ba.position.set(P[0][0], P[0][1], P[0][2] + 0.04); c.bb.position.set(P[3][0], P[3][1], P[3][2] + 0.04);
      c.ba.material.opacity = c.bb.material.opacity = 0.55 * dim;
      c.dots.forEach((d, q) => {   // traffic while the eero or switch is hovered
        if (flow < 0.02) { d.material.opacity = 0; return; }
        const t = (((now / 1000) * speed + q / 3 + i * 0.13) % 1 + 1) % 1, p = bez(P, i % 2 ? 1 - t : t);
        d.position.set(p[0], p[1], p[2]); d.material.opacity = flow;
      });
    });
  }
  function vents(w, h, cols, rows) {   // a perforated side/back panel texture
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h }), g = c.getContext("2d");
    g.fillStyle = "#0f1114"; g.fillRect(0, 0, w, h); g.strokeStyle = "#262a2f"; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) { g.fillStyle = "#050607"; g.fillRect(40 + q * ((w - 80) / cols), 50 + r * ((h - 100) / rows), (w - 80) / cols - 14, (h - 100) / rows - 26); }
    return c;
  }
  // a box shaded like it's lit from above-left (no lights in this build, so each face gets its own tone)
  function shadedBox(T, w, h, d, base, tones = [0.72, 0.55, 1.0, 0.3, 0.86, 0.45]) {
    const c = new T.Color(base), mats = tones.map((k) => new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(k) }));
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mats); m.userData.tones = tones; m.userData.base = c; return m;
  }
  const toneBox = (m, f) => m.material.forEach((mt, i) => mt.color.copy(m.userData.base).multiplyScalar(m.userData.tones[i] * f));
  function buildRack(g, T) {
    g.add(floorGrid(T, 7));
    RACK.canvas = RACK.canvas || Object.assign(document.createElement("canvas"), { width: FACE_W * FACE_SCALE, height: Math.round(FACE_H * FACE_SCALE) });
    RACK.tex = new T.CanvasTexture(RACK.canvas); RACK.tex.anisotropy = 4;
    drawFace(performance.now()); RACK.unit = {};
    // each unit is its own slice of the front face, so it can slide out and the others can dim
    for (const u of RU) {
      if (u.id === "gap") continue;
      const h = (H3 * u.h) / FACE_H, geo = new T.PlaneGeometry(W3, h), uv = geo.attributes.uv, v0 = 1 - (u.y + u.h) / FACE_H, v1 = 1 - u.y / FACE_H;
      for (let q = 0; q < uv.count; q++) uv.setY(q, uv.getY(q) > 0.5 ? v1 : v0);
      const m = new T.Mesh(geo, new T.MeshBasicMaterial({ map: RACK.tex })); m.position.set(0, unitY(u), 0.02); m.userData.unit = u.id; g.add(m);
      const body = shadedBox(T, W3 - 0.04, h - 0.03, u.id === "nas" ? 2.6 : 1.4, 0x1a1c20); body.position.set(0, unitY(u), 0.02 - body.geometry.parameters.depth / 2 - 0.002); g.add(body);
      const ol = segs(T, [-W3 / 2, -h / 2, 0, W3 / 2, -h / 2, 0, W3 / 2, -h / 2, 0, W3 / 2, h / 2, 0, W3 / 2, h / 2, 0, -W3 / 2, h / 2, 0, -W3 / 2, h / 2, 0, -W3 / 2, -h / 2, 0], COL.cyan, 0); ol.position.copy(m.position); ol.position.z += 0.01; g.add(ol);
      RACK.unit[u.id] = { m, ol, body, k: 0, d: 0 };
    }
    buildLeads(g, T);
    // the frame: two aluminium uprights each side, top and bottom rails, corner brackets on top
    const L = [], X = W3 / 2 + 0.36, TOP = Y0 + H3 + 0.62, Z0 = 0.05, Z1 = -DEPTH, D0 = Z0 - Z1;
    const bx = (x0, x1, y0, y1, z0, z1) => { const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; c.forEach(([x, z], k) => { const [nx, nz] = c[(k + 1) % 4]; L.push(x, y0, z, nx, y0, nz, x, y1, z, nx, y1, nz, x, y0, z, x, y1, z); }); };
    const P0 = (sx) => (sx > 0 ? X : -X - 0.33);   // the uprights sit symmetrically either side of the panels
    for (const sx of [-1, 1]) { bx(P0(sx), P0(sx) + 0.33, 0, TOP, Z0 - 0.33, Z0); bx(P0(sx), P0(sx) + 0.33, 0, TOP, Z1, Z1 + 0.33); }
    bx(-X - 0.33, X + 0.33, TOP - 0.62, TOP, Z0 - 0.33, Z0); bx(-X - 0.33, X + 0.33, 0, 0.3, Z0 - 0.33, Z0); bx(-X - 0.33, X + 0.33, TOP - 0.3, TOP, Z1, Z0);
    for (const sx of [-1, 1]) for (const z of [Z0 - 0.16, Z1 + 0.16]) bx(P0(sx) + 0.03, P0(sx) + 0.3, TOP, TOP + 0.3, z - 0.14, z + 0.14);   // corner brackets
    L.length = 0;   // (no outline over the solid aluminium: lines lying on a face flicker as it turns)
    const alu = (w, h, d, x, y, z) => { const b = shadedBox(T, w, h, d, 0xb9bfc6, [0.8, 0.6, 1.05, 0.35, 0.92, 0.5]); b.position.set(x, y, z); g.add(b); return b; };
    for (const sx of [-1, 1]) { alu(0.33, TOP, 0.33, P0(sx) + 0.165, TOP / 2, Z0 - 0.165); alu(0.33, TOP, 0.33, P0(sx) + 0.165, TOP / 2, Z1 + 0.165); }
    alu(2 * X - 0.004, 0.62, 0.32, 0, TOP - 0.31, Z0 - 0.165); alu(2 * X - 0.004, 0.3, 0.32, 0, 0.15, Z0 - 0.165); alu(2 * X - 0.004, 0.3, D0 - 0.68, 0, TOP - 0.15, (Z0 + Z1) / 2);
    for (const sx of [-1, 1]) for (const z of [Z0 - 0.16, Z1 + 0.16]) alu(0.27, 0.3, 0.28, P0(sx) + 0.165, TOP + 0.156, z);
    // a soft contact shadow where it stands
    { const c2 = Object.assign(document.createElement("canvas"), { width: 256, height: 256 }), q = c2.getContext("2d"), gr = q.createRadialGradient(128, 128, 20, 128, 128, 128); gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(1, "rgba(0,0,0,0)"); q.fillStyle = gr; q.fillRect(0, 0, 256, 256);
      const sh = new T.Mesh(new T.PlaneGeometry(2 * X + 2.2, D0 + 2.2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c2), transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.012, (Z0 + Z1) / 2); g.add(sh); }
    // sides, back and top: dark perforated panels so it reads as a solid box
    const sideTex = new T.CanvasTexture(vents(512, 768, 3, 9)), backTex = new T.CanvasTexture(vents(768, 768, 4, 9));
    const skin = (geo, tex, op) => new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex || null, color: tex ? 0xffffff : 0x111316, transparent: true, opacity: op, side: T.DoubleSide, depthWrite: true }));
    const D = Z0 - Z1, Wt = 2 * X + 0.66;
    for (const sx of [-1, 1]) { const m = skin(new T.PlaneGeometry(D - 0.7, TOP - 0.62), sideTex, 0.92); m.rotation.y = Math.PI / 2; m.position.set(sx * (X + 0.2), (TOP - 0.62) / 2 + 0.3, (Z0 + Z1) / 2); g.add(m); }
    { const m = skin(new T.PlaneGeometry(2 * X - 0.04, TOP - 0.62), backTex, 0.92); m.position.set(0, (TOP - 0.62) / 2 + 0.3, Z1 + 0.16); g.add(m); }
    { const m = skin(new T.PlaneGeometry(2 * X - 0.04, D - 0.7), null, 0.9); m.rotation.x = -Math.PI / 2; m.position.set(0, TOP - 0.32, (Z0 + Z1) / 2); g.add(m); }
    const glowTex = (() => { const c = Object.assign(document.createElement("canvas"), { width: 128, height: 128 }), q = c.getContext("2d"), gr = q.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.5)"); gr.addColorStop(1, "rgba(255,255,255,0)"); q.fillStyle = gr; q.fillRect(0, 0, 128, 128); return new T.CanvasTexture(c); })();
    // light from the rack: a soft pool on the floor, and the vents throwing stripes forward
    const pool = new T.Mesh(new T.PlaneGeometry(9, 7), new T.MeshBasicMaterial({ map: glowTex, color: 0x5a8cff, transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.02, 0.6); g.add(pool); RACK.pool = pool;
    const stripes = (() => { const c = Object.assign(document.createElement("canvas"), { width: 512, height: 256 }), q = c.getContext("2d");
      for (let i = 0; i < 26; i++) { const x = 70 + i * 14.5, gr = q.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, "rgba(255,255,255,.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); q.fillStyle = gr; q.beginPath(); q.moveTo(x, 0); q.lineTo(x + 7, 0); q.lineTo(x + 7 + (x - 256) * 0.5, 256); q.lineTo(x + (x - 256) * 0.5, 256); q.fill(); }
      return new T.CanvasTexture(c); })();
    const beam = new T.Mesh(new T.PlaneGeometry(W3 * 1.5, 2.6), new T.MeshBasicMaterial({ map: stripes, color: 0x6d8fff, transparent: true, opacity: 0.22, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    beam.rotation.x = -Math.PI / 2; beam.position.set(0, 0.03, 1.35); g.add(beam); RACK.beam = beam;
    // callout leaders to the right
    const lp = []; for (const u of RU) { if (!u.name) continue; const y = unitY(u); lp.push(W3 / 2 + 0.75, y, 0.1, W3 / 2 + 1.25, y, 0.1); }
    RACK.leaders = segs(T, lp, COL.cyan, 0.35); g.add(RACK.leaders);
  }
  function tickRack(dt, now) {
    if (now - RACK.drawn > (RACK.unit && RACK.unit.nas && RACK.unit.nas.k > 0.02 ? 90 : 450)) drawFace(now);
    // which unit is under the mouse: a ray against the unit faces (steady, unlike the nearest-point picks)
    RACK.hit = null;
    if (V3.mouse && !V3.drag && RACK.unit) {
      const r = V3.canvas.getBoundingClientRect(), ray = RACK.ray || (RACK.ray = new V3.T.Raycaster());
      ray.setFromCamera(new V3.T.Vector2(((V3.mouse.x - r.left) / r.width) * 2 - 1, -((V3.mouse.y - r.top) / r.height) * 2 + 1), V3.camera);
      const h = ray.intersectObjects(Object.values(RACK.unit).map((U) => U.m), false)[0];
      if (h) { const wp = RACK.g.worldToLocal(h.point.clone()); RACK.hit = { id: h.object.userData.unit, p: [wp.x, wp.y, wp.z] }; }
    }
    const focus = V3.pinned && String(V3.pinned).startsWith("u:") ? String(V3.pinned).slice(2) : RACK.hit ? RACK.hit.id : null;
    RACK.any = !!focus;
    let wob = false;
    for (const [id, U] of Object.entries(RACK.unit || {})) {
      U.k += ((id === focus ? 1 : 0) - U.k) * Math.min(1, dt * 9);
      U.d += ((focus && id !== focus ? 1 : 0) - U.d) * Math.min(1, dt * 7);
      U.m.position.z = 0.02 + 0.22 * U.k; U.ol.position.z = U.m.position.z + 0.01;
      const c = 1 - 0.62 * U.d; U.m.material.color.setRGB(c, c, c);
      if (U.body) { U.body.position.z = U.m.position.z - U.body.geometry.parameters.depth / 2 - 0.002; toneBox(U.body, c * (1 + 0.6 * U.k)); }
      U.ol.material.opacity = U.k * (0.6 + 0.3 * Math.sin(now / 160));
      if (U.k > 0.02) wob = true;   // (includes the eero/switch traffic dots)
    }
    tickLeads(now);
    const v2 = (k) => n(st(NET.nas[k]));
    // the floor light follows the NAS (and the speed test)
    const cpu2 = v2("cpu") || 10, nasK = unitK("nas");
    if (RACK.pool) RACK.pool.material.opacity = (0.22 + Math.min(0.25, cpu2 / 200) + 0.06 * Math.sin(now / 900) + (RACK.testing ? 0.25 * (0.5 + 0.5 * Math.sin(now / 140)) : 0)) * (RACK.any && !nasK ? 0.6 : 1);
    if (RACK.beam) RACK.beam.material.opacity = 0.16 + Math.min(0.2, cpu2 / 250) + nasK * 0.2;
    // speed test: running state, and the numbers count up when the result lands
    const dn = n(st(NET.net.down)), upn = n(st(NET.net.up));
    if (RACK.testing && (now - RACK.testing > 120000 || (dn != null && RACK.testFrom && (dn !== RACK.testFrom[0] || upn !== RACK.testFrom[1])))) { RACK.testing = 0; RACK.countFrom = RACK.testFrom; RACK.countT = now; }
    RACK.shown = [dn, upn].map((x, q) => { if (x == null) return null; if (!RACK.countT || now - RACK.countT > 1600) return x; const a = (RACK.countFrom && RACK.countFrom[q]) || 0, k2 = Math.min(1, (now - RACK.countT) / 1600); return a + (x - a) * (1 - Math.pow(1 - k2, 3)); });
    if (RACK.leaders) RACK.leaders.material.opacity = focus ? 0.12 : 0.35;
    const ip = st(NET.net.ip), down = n(st(NET.net.down)), upl = n(st(NET.net.up)), nst = st(NET.net.status) || st(NET.net.wan), online = !nst || /connected|on|online/.test(nst.s);
    const eh = eeroHub(), hueOn = RK.hue.filter((id) => (st(id) || {}).s === "on").length;
    const ver = st(RK.ha), osu = st(RK.haOs), autosOn = RK.autos.filter((id) => (st(id) || {}).s === "on").length;
    const contOn = RK.cont.filter((id) => (st(id) || {}).s === "on").length;
    const ring = ringDevs(), ringOn = ring.filter((d) => netPlace(d).on).length;
    const v = (k) => n(st(NET.nas[k])), upS = st(NET.nas.up), upDays = upS && live(upS) ? Math.floor((Date.now() - Date.parse(upS.s)) / 864e5) : null;
    const C = {
      logo: [RACK.testing ? "RUNNING A SPEED TEST…" : online ? "ONLINE" : "INTERNET DOWN", (RACK.shown || [])[0] != null ? `↓ ${fmt(RACK.shown[0])} · ↑ ${fmt(RACK.shown[1])} MBIT/S` : "", !online],
      switch: ["8 × 1 GIGABIT", `${wiredOn().length} WIRED DEVICES ONLINE`],
      patch: ["10 × CAT6", "7 PATCHED"],
      hue: [`${hueOn} OF ${RK.hue.length} LIGHTS ON`, "PHILIPS HUE"],
      eero: [eh ? `${NET.devs.filter((d) => { const p = netPlace(d); return p.on && p.hub === eh.name; }).length} ON THIS EERO` : "EERO 6+", "CLICK FOR THE MESH MAP"],
      ha: [ver ? `CORE ${String(ver.a.installed_version || "").toUpperCase()}` : "HOME ASSISTANT", `${autosOn} AUTOMATIONS ON${(ver && ver.s === "on") || (osu && osu.s === "on") ? " · UPDATE READY" : ""}`],
      ring: [`${ringOn} OF ${ring.length || "?"} RING DEVICES ONLINE`, "RING-MQTT", ring.length && ringOn < ring.length],
      nas: [`CPU ${fmt(v("cpu"))}% · ${fmt(v("temp"))}°C`, `ARRAY ${fmt(v("array"))}% · ${contOn} DOCKERS UP${upDays != null ? " · " + upDays + " D" : ""}`, v("temp") >= 85 || v("array") >= 90],
    };
    for (const u of RU) {
      if (!u.name) continue;
      const y = unitY(u), c = C[u.id] || ["", ""];
      tag("r:" + u.id, W3 / 2 + 1.3, y, 0.1, `<b>${esc(u.name)}</b><span${c[2] ? ' data-warn="true"' : ""}>${esc(c[0])}</span>${c[1] ? `<span>${esc(c[1])}</span>` : ""}`, true, "eddo-page-tag-left");
      const tg = V3.tags.get("r:" + u.id); if (tg) { tg.dataset.focus = focus === u.id ? "true" : focus ? "dim" : "false"; }
      const act = u.id === "switch" || u.id === "eero" ? { open: { label: "OPEN THE MESH MAP ›", run: () => netView("mesh") } }
        : u.id === "logo" && NET.net.test ? { open: { label: RACK.testing ? "SPEED TEST RUNNING…" : "RUN A SPEED TEST ›", run: () => speedTest() } } : null;
      // one pick for the unit under the mouse (exactly where the mouse is) and one for a pinned unit
      if (RACK.hit && RACK.hit.id === u.id) pick("u:" + u.id, RACK.hit.p[0], RACK.hit.p[1], RACK.hit.p[2], () => rackCard(u), act);
      else if (V3.pinned === "u:" + u.id) pick("u:" + u.id, 0, y, 0.1 + 0.22 * unitK(u.id), () => rackCard(u), act);
    }
  }
  function speedTest() {
    if (RACK.testing || !NET.net.test) return;
    RACK.testing = performance.now(); RACK.testFrom = [n(st(NET.net.down)), n(st(NET.net.up))];
    call("button", "press", { target: { entity_id: NET.net.test } });
  }
  function rackCard(u) {
    const row = (k, val) => (val == null || val === "" ? "" : `<dt>${k}</dt><dd>${esc(val)}</dd>`);
    const v = (k) => n(st(NET.nas[k]));
    if (u.id === "logo") { const ip = st(NET.net.ip); return `<b>EDNET · INTERNET</b><dl>${row("STATUS", (st(NET.net.status) || {}).s || "—")}${row("PUBLIC IP", ip && ip.s)}${row("DOWN", n(st(NET.net.down)) != null ? fmt(n(st(NET.net.down))) + " Mbit/s" : "")}${row("UP", n(st(NET.net.up)) != null ? fmt(n(st(NET.net.up))) + " Mbit/s" : "")}${row("CLIENTS", NET.devs.filter((d) => netPlace(d).on).length)}</dl>`; }
    if (u.id === "switch") return `<b>NETGEAR GS308</b><dl>${row("PORTS", "8 × 1 Gbit")}${row("WIRED", wiredOn().map((d) => d.name).slice(0, 8).join(", ") || "—")}</dl>`;
    if (u.id === "patch") return `<b>PATCH PANEL</b><dl>${row("PORTS", "10 × Cat6 keystone")}${row("PATCHED", "7 to the switch")}</dl>`;
    if (u.id === "hue") return `<b>PHILIPS HUE BRIDGE</b><dl>${row("LIGHTS", `${RK.hue.filter((id) => (st(id) || {}).s === "on").length} on of ${RK.hue.length}`)}${row("ON NOW", RK.hue.filter((id) => (st(id) || {}).s === "on").map((id) => (st(id).a.friendly_name || id)).slice(0, 5).join(", ") || "none")}</dl>`;
    if (u.id === "eero") { const eh = eeroHub(), hs = eh && st(eh.status); return `<b>EERO · ${esc(String(eh ? eh.name : "").toUpperCase())}</b><dl>${row("MODEL", eh && eh.model)}${row("STATUS", hs && hs.s)}${row("DEVICES", eh ? NET.devs.filter((d) => { const p = netPlace(d); return p.on && p.hub === eh.name; }).length : "")}${row("MESH", NET.hubs.map((h) => h.name).join(" · "))}</dl>`; }
    if (u.id === "ha") { const ver = st(RK.ha), osu = st(RK.haOs); return `<b>HOME ASSISTANT YELLOW</b><dl>${row("CORE", ver && ver.a.installed_version)}${row("CORE UPDATE", ver && ver.s === "on" ? ver.a.latest_version : "up to date")}${row("OS UPDATE", osu && osu.s === "on" ? osu.a.latest_version : "up to date")}${row("AUTOMATIONS", `${RK.autos.filter((id) => (st(id) || {}).s === "on").length} on of ${RK.autos.length}`)}</dl>`; }
    if (u.id === "ring") { const r = ringDevs(); return `<b>RING</b><dl>${r.map((d) => row(d.name.replace(/^Ring/i, "").replace(/[-_]/g, " ").trim().toUpperCase() || "RING", netPlace(d).on ? "online" : "offline")).join("") || row("DEVICES", "none on the Wi-Fi")}</dl>`; }
    if (u.id === "nas") { const upS = st(NET.nas.up); return `<b>EDDO-NAS · UNRAID</b><dl>${row("CPU", `${fmt(v("cpu"))}% · ${fmt(v("temp"))}°C`)}${row("RAM", fmt(v("ram")) + "%")}${row("ARRAY", `${fmt(v("array"))}% · ${(st(NET.nas.state) || {}).s || ""}`)}${row("CACHE", fmt(v("cache")) + "%")}${row("DOCKERS", `${RK.cont.filter((id) => (st(id) || {}).s === "on").length} running of ${RK.cont.length}`)}${row("UP SINCE", upS && live(upS) ? new Date(upS.s).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "")}</dl>`; }
    return "";
  }
  function rackPanel() {
    const N = NET.nas, v = (k) => n(st(N[k])), upS = st(N.up), upDays = upS && live(upS) ? Math.floor((Date.now() - Date.parse(upS.s)) / 864e5) : null;
    const nst = st(NET.net.status) || st(NET.net.wan), up = !nst || /connected|on|online/.test(nst.s), ip = st(NET.net.ip);
    const mini = (label, val, warn) => `<div class="eddo-mini"${warn ? ' data-warn="true"' : ""}><span>${esc(label)}</span><b>${val != null ? fmt(val) + "%" : "—"}</b><i><s style="width:${Math.max(0, Math.min(100, val || 0))}%"></s></i></div>`;
    const dock = DOCKERS.map(([k, name]) => { const s0 = st("switch.eddo_nas_container_" + k); if (!s0) return ""; const upd = st(`binary_sensor.eddo_nas_container_${k}_update`), on = s0.s === "on";
      return `<div class="eddo-dock" data-on="${on}" title="${on ? "Running" : "Stopped"}${upd && upd.s === "on" ? " · update available" : ""}"><i></i><b>${esc(name)}</b>${upd && upd.s === "on" ? "<em>UPD</em>" : ""}</div>`; }).join("");
    const ver = st(RK.ha), contOn = RK.cont.filter((id) => (st(id) || {}).s === "on").length, updN = n(st(N.upd));
    const autosOn = RK.autos.filter((id) => (st(id) || {}).s === "on").length, hueOn = RK.hue.filter((id) => (st(id) || {}).s === "on").length;
    return `<div class="eddo-pg-grid">${card("INTERNET", up ? "Online" : "Down", ip && live(ip) ? esc(ip.s) : "", up ? "" : ' data-warn="true"')}${card("SPEED TEST", n(st(NET.net.down)) != null ? `${fmt(n(st(NET.net.down)))} / ${fmt(n(st(NET.net.up)))}` : "—", "Mbit/s")}${card("ON THE NETWORK", NET.devs.filter((d) => netPlace(d).on).length, `${wiredOn().length} wired`)}</div>` +
      `<p class="eddo-pg-h">EDDO-NAS · UNRAID <span>${st(N.state) && live(st(N.state)) ? "ARRAY " + esc(st(N.state).s.toUpperCase()) + " · " : ""}UP ${upDays != null ? upDays + " D" : "—"}</span></p>` +
      `<div class="eddo-pg-grid">${card("CPU", v("cpu") != null ? fmt(v("cpu")) + "%" : "—", v("temp") != null ? fmt(v("temp")) + "°C" : "", v("temp") >= 85 ? ' data-warn="true"' : "")}${card("RAM", v("ram") != null ? fmt(v("ram")) + "%" : "—")}${card("DOCKERS", `${contOn} / ${RK.cont.length}`, updN ? `${fmt(updN)} updates` : "running")}</div>` +
      `<div class="eddo-minis">${mini("ARRAY", v("array"), v("array") >= 90)}${N.disks.map((id, i) => mini("DISK " + (i + 1), n(st(id)), n(st(id)) >= 90)).join("")}${mini("CACHE", v("cache"))}</div>` +
      `<p class="eddo-pg-h">KEY DOCKERS</p><div class="eddo-docks">${dock}</div>` +
      `<p class="eddo-pg-h">HOME ASSISTANT <span>CORE ${ver ? esc(ver.a.installed_version || "—") : "—"}${ver && ver.s === "on" ? ` → ${esc(ver.a.latest_version || "")}` : ""} · ${autosOn}/${RK.autos.length} AUTOMATIONS · ${hueOn}/${RK.hue.length} HUE ON</span></p>`;
  }
  function netView(v) {
    RACK.view = v; dirty = true; V3.pinned = null;
    if (V3.labels) { V3.labels.innerHTML = ""; V3.tags.clear(); }
    const pg = PAGES.find((p) => p.id === "network"); if (!pg) return;
    pg.sway = v === "rack";
    Object.assign(V3.view, v === "rack" ? { dist: 22, ty: 3.4, phi: 1.36, theta: -0.32, tx: 0.9, auto: true } : { dist: 23, ty: 0.6, phi: 0.98, tx: 0, auto: true });
    pg.view = v === "rack" ? { dist: 22, ty: 3.4, phi: 1.36, theta: -0.32, tx: 0.9 } : { dist: 23, ty: 0.6, phi: 0.98, theta: 0.7 };
  }
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-netview]"); if (b) netView(b.dataset.netview); });

  page({
    id: "network", label: "Network", pos: 4, view: { dist: 22, ty: 3.4, phi: 1.36, theta: -0.32, tx: 0.9 }, sway: true, minDist: 6, maxDist: 40,
    discover(R) { if (!R) return; netDiscover(R); rackDiscover(R); const key = NET.mode + NET.hubs.map((h) => h.name).join() + NET.devs.length; if (key !== NET.key) { NET.key = key; V3.built.delete("network"); if (V3.page && V3.page.id === "network") { const p = V3.page; V3.page = null; show3D(p); } } },
    // two views: the EDNET rack (default) and the eero mesh map (open it from the switch or the eero)
    build(g, T) {
      RACK.mesh = new T.Group(); RACK.mesh.visible = RACK.view === "mesh"; g.add(RACK.mesh); this.buildMesh(RACK.mesh, T);
      RACK.g = new T.Group(); RACK.g.visible = RACK.view === "rack"; g.add(RACK.g); buildRack(RACK.g, T);
    },
    tick(g, dt, now, T) {
      if (RACK.mesh) RACK.mesh.visible = RACK.view === "mesh";
      if (RACK.g) RACK.g.visible = RACK.view === "rack";
      if (RACK.view === "mesh") this.tickMesh(g, dt, now, T); else tickRack(dt, now);
    },
    panel() { const seg = `<div class="eddo-pg-seg"><button data-netview="rack" aria-pressed="${RACK.view === "rack"}">RACK</button><button data-netview="mesh" aria-pressed="${RACK.view === "mesh"}">MESH MAP</button></div>`; return seg + (RACK.view === "mesh" ? this.panelMesh() : rackPanel()); },
    buildMesh(g, T) {
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
    tickMesh(g, dt, now) {
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
    panelMesh() {
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
  const shortName = (t) => String(t || "").replace(/\([^)]*\)/g, "").replace(/^(PLA|PETG|ABS|TPU|ASA)\s+(Basic|Matte|Silk|Silk Multi-Color|Tough|HF|CF)?\s*/i, "").trim() || String(t || "");
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
    // newest purchases first (the date at the end of the description, e.g. "Amazon, Oct 2026"); the shelf holds 20
    const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const when = (i) => { const m = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{4})/i.exec(i.description || ""); return m ? +m[2] * 12 + MON[m[1].toLowerCase()] : 0; };
    const all = WS.stockItems.filter((i) => i.status === "needs_action").map((i, k) => ({ i, k })).sort((a, b) => when(b.i) - when(a.i) || a.k - b.k).map((x) => x.i);
    WS.stockTotal = all.length;
    const per = SHELF.cols * SHELF.rows; WS.pages = Math.max(1, Math.ceil(all.length / per)); WS.page = Math.min(WS.page || 0, WS.pages - 1);
    const items = all.slice(WS.page * per, WS.page * per + per);
    const key = WS.page + ":" + items.map((i) => i.uid + (i.description || "")).join("|"); if (key === WS.shelfKey) return; WS.shelfKey = key;
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
  const SHELF_W = () => SHELF.cols * SHELF.cell;
  function shelfPage(dir, from) {
    const pages = WS.pages || 1, next = Math.max(0, Math.min(pages - 1, (WS.page || 0) + dir));
    if (next === WS.page || !WS.shelf) { if (WS.shelf) WS.shelf.userData.goal = 0; return; }
    // the current page slides out (keeping its spools), the next slides in from the other side
    const T = V3.T, out = new T.Group(), w = SHELF_W() + 1.5;
    WS.shelf.children.slice().forEach((c) => { WS.shelf.remove(c); out.add(c); });
    out.position.x = from != null ? from : WS.shelf.position.x; out.userData.goal = -dir * w; WS.shelf.parent.add(out);
    if (WS.shelfOut) { WS.shelfOut.parent && WS.shelfOut.parent.remove(WS.shelfOut); }
    WS.shelfOut = out;
    WS.page = next; WS.shelfKey = ""; buildShelfSpools();
    WS.shelf.position.x = dir * w + (from != null ? from : 0); WS.shelf.userData.goal = 0;
    haptic && haptic();
  }
  const haptic = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (_) {} };
  // drag the shelf sideways to flip pages (starts only on the shelf itself)
  function shelfRect() {
    const a = toCanvas(SHELF.x0, SHELF.y0, 0.6), b = toCanvas(SHELF.x0 + SHELF_W(), SHELF.y0 + SHELF.rows * SHELF.cell, 0.6); if (!a || !b) return null;
    const r = V3.canvas.getBoundingClientRect(), k = (r.width || 1) / V3.canvas.clientWidth;
    return { l: r.left + Math.min(a.x, b.x) * k, r: r.left + Math.max(a.x, b.x) * k, t: r.top + Math.min(a.y, b.y) * k, b: r.top + Math.max(a.y, b.y) * k, pxPerUnit: (Math.abs(b.x - a.x) * k) / SHELF_W() };
  }
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-shelf]"); if (b) shelfPage(+b.dataset.shelf); });
  window.addEventListener("keydown", (e) => { if (window.eddoTabs.active() !== "workshop" || /input|textarea/i.test((document.activeElement || {}).tagName || "")) return; if (e.key === "ArrowRight") shelfPage(1); else if (e.key === "ArrowLeft") shelfPage(-1); });
  // ---- the chamber camera, laid onto the door glass: a DOM <img> (HA images can't go into WebGL without CORS), warped with matrix3d ----
  function adj3(m) { return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]]; }
  function mul3(a, b) { const c = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j]; c[3 * i + j] = s; } return c; }
  function basis4(p) { const m = [p[0], p[2], p[4], p[1], p[3], p[5], 1, 1, 1], a = adj3(m), v = [a[0] * p[6] + a[1] * p[7] + a[2], a[3] * p[6] + a[4] * p[7] + a[5], a[6] * p[6] + a[7] * p[7] + a[8]]; return mul3(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]); }
  function warp(w, h, q) {   // q: top-left, top-right, bottom-left, bottom-right (canvas px)
    const t = mul3(basis4(q.flatMap((p) => [p.x, p.y])), adj3(basis4([0, 0, w, 0, 0, h, w, h])));
    for (let i = 0; i < 9; i++) t[i] /= t[8];
    return `matrix3d(${[t[0], t[3], 0, t[6], t[1], t[4], 0, t[7], 0, 0, 1, 0, t[2], t[5], 0, t[8]].map((v) => v.toFixed(8)).join(",")})`;
  }
  const picOf = (id) => { const x = st(id); return x && live(x) && x.a.entity_picture ? HA().baseUrl() + x.a.entity_picture : ""; };
  function wsCam(q) {
    let el = WS.camEl; const pic = q && WS.p && picOf(WS.p.cam);
    if (!pic) { if (el) { el.dataset.out = "true"; clearTimeout(WS.camKill); WS.camKill = setTimeout(() => { if (WS.camEl === el) { el.remove(); WS.camEl = null; } }, 450); } return; }
    clearTimeout(WS.camKill);
    if (!el || !el.isConnected) { el = WS.camEl = document.createElement("div"); el.className = "eddo-ws-cam"; el.innerHTML = '<img alt=""><i></i><b>LIVE · CHAMBER</b>'; V3.labels.prepend(el); WS.camAt = 0; }
    el.dataset.out = "false";
    const W = 330, H = 370; el.style.width = W + "px"; el.style.height = H + "px"; el.style.transform = warp(W, H, q);
    if (Date.now() - (WS.camAt || 0) > 2000 && !WS.camBusy) {   // the P1S camera is a ~1 fps still feed, so poll stills
      WS.camAt = Date.now(); WS.camBusy = true;
      const im = new Image(), img = el.firstChild;
      im.onload = () => { WS.camBusy = false; img.src = im.src; el.dataset.ok = "true"; };
      im.onerror = () => { WS.camBusy = false; };
      im.src = pic + (pic.includes("?") ? "&" : "?") + "t=" + Date.now();
    }
  }
  const hm = (h) => (h == null ? "—" : h >= 1 ? `${Math.floor(h)} H ${Math.round((h % 1) * 60)} M` : `${Math.round(h * 60)} MIN`);
  const clock = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  function wsMood() {
    const P = WS.p; if (!P) return { mood: "none" };
    const status = String((st(P.status) || {}).s || "").toLowerCase(), stage = String((st(P.stage) || {}).s || "").toLowerCase();
    const off = P.online && (st(P.online) || {}).s === "off";
    const printing = /running|printing|prepare/.test(status) || (/print|heat|level|calib/.test(stage) && !/idle|finish|fail/.test(status));
    const mood = off ? "offline" : printing ? "printing" : /pause/.test(status) ? "paused" : /fail/.test(status) ? "failed" : /finish/.test(status) ? (Date.now() - (WS.doneAt || 0) < 10 * 60e3 ? "done" : "finished") : "idle";
    return { mood, status, stage, prog: n(st(P.progress)) ?? 0 };
  }
  function glowTex(T) {
    if (WS.glow) return WS.glow;
    const c = Object.assign(document.createElement("canvas"), { width: 128, height: 128 }), q = c.getContext("2d"), gr = q.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); q.fillStyle = gr; q.fillRect(0, 0, 128, 128);
    return (WS.glow = new T.CanvasTexture(c));
  }
  function drawScreen(txt, sub, mood) {
    const o = WS.obj; if (!o || !o.scr) return;
    const key = txt + "|" + sub + "|" + mood; if (o.scrKey === key) return; o.scrKey = key;
    const c = o.scrCanvas, q = c.getContext("2d");
    q.fillStyle = "#06090b"; q.fillRect(0, 0, c.width, c.height);
    q.fillStyle = mood === "printing" ? "#8fe0be" : mood === "failed" ? "#ff7a6b" : "#9fc4d6";
    q.font = "600 44px MiSans, system-ui, sans-serif"; q.textBaseline = "middle"; q.fillText(txt, 18, 38);
    q.fillStyle = "#6c7a80"; q.font = "500 22px MiSans, system-ui, sans-serif"; q.fillText(sub, 18, 76);
    o.scr.material.map.needsUpdate = true;
  }
  page({
    id: "workshop", label: "Workshop", pos: 5, view: { dist: 31, ty: 4.1, phi: 1.3, tx: -3.2, theta: 0.1 }, still: true, minDist: 8, maxDist: 48, onSwipe: (d) => shelfPage(d),
    dragStart(x, y) { const r = shelfRect(); if (!r || (WS.pages || 1) < 2 || x < r.l || x > r.r || y < r.t || y > r.b) return false; WS.dragPx = r.pxPerUnit || 30; WS.dragging = true; return true; },
    dragMove(dx) { if (!WS.shelf) return; let x = dx / WS.dragPx; const pages = WS.pages || 1; if ((WS.page === 0 && x > 0) || (WS.page >= pages - 1 && x < 0)) x *= 0.3; WS.shelf.position.x = x; },   // resists at the ends
    dragEnd(dx) { WS.dragging = false; const pages = WS.pages || 1, dir = dx < 0 ? 1 : -1, ok = dir > 0 ? WS.page < pages - 1 : WS.page > 0;
      if (Math.abs(dx) > 60 && ok) shelfPage(dir, WS.shelf.position.x); else if (WS.shelf) WS.shelf.userData.goal = 0; },
    discover(R) {
      if (!R) return;
      const bam = R.ents.filter((e) => e.platform === "bambu_lab" && !e.disabled_by);
      const f = (re) => { const x = bam.find((e) => re.test(e.entity_id)); return x ? x.entity_id : null; };
      WS.p = bam.length ? { progress: f(/print_progress$/), status: f(/print_status$/), stage: f(/current_stage$/), task: f(/task_name$/), layer: f(/current_layer$/), layers: f(/total_layer_count$/), remain: f(/remaining_time$/), end: f(/end_time$/), start: f(/start_time$/),
        nozzle: f(/nozzle_temperature$/), bed: f(/bed_temperature$/), nozzleT: f(/nozzle_target_temperature$/), bedT: f(/sensor\..*bed_target_temperature$/), hum: f(/ams_1_humidity$/), amsT: f(/ams_1_temperature$/), active: f(/active_tray$/), weight: f(/print_weight$/), online: f(/_online$/),
        cam: f(/^camera\..*_camera$/), cover: f(/^image\..*cover_image$/), light: f(/^light\..*chamber_light$/) } : null;
      WS.trays = bam.filter((e) => /_ams_\d+_tray_\d+$/.test(e.entity_id) && e.entity_id.startsWith("sensor.")).map((e) => e.entity_id).sort();
      const todo = (re) => (R.allStates.find((s) => s.entity_id.startsWith("todo.") && re.test(s.entity_id + " " + String(s.attributes.friendly_name || "").toLowerCase())) || {}).entity_id || null;
      WS.queue = todo(/print.?queue|print/); WS.stock = todo(/filament/);
      watch([...(WS.p ? Object.values(WS.p) : []), ...WS.trays, WS.queue, WS.stock]);
      loadQueue(true); loadStock(true);
    },
    build(g, T) {
      g.add(floorGrid(T, 14).translateX(-3.6));
      const PX = 3.8, s = 3.9, h = 4.6, d = 3.9, F = d / 2;   // P1S: 389 × 458 × 389 mm, 1 unit = 100 mm
      const P = new T.Group(); P.position.x = PX; g.add(P);
      const BODY = 0x23262b, put = (m, x, y, z) => { m.position.set(x, y, z); P.add(m); return m; }, body = [];
      const CH = h - 0.9, CY = 0.6 + CH / 2;   // the chamber, between the base and the top
      body.push(put(shadedBox(T, s, 0.6, d, BODY), 0, 0.3, 0), put(shadedBox(T, s, 0.3, d, BODY), 0, h - 0.15, 0));
      for (const sx of [-1, 1]) body.push(put(shadedBox(T, 0.14, CH, d, BODY), sx * (s / 2 - 0.07), CY, 0), put(shadedBox(T, 0.2, CH, 0.1, 0x1a1c20), sx * (s / 2 - 0.24), CY, F - 0.05));
      body.push(put(shadedBox(T, s - 0.28, CH, 0.1, 0x16181b), 0, CY, -F + 0.05));
      const inner = put(new T.Mesh(new T.PlaneGeometry(s - 0.3, CH), new T.MeshBasicMaterial({ color: 0x14171a })), 0, CY, -F + 0.11);
      put(shadedBox(T, 0.08, 1.3, 0.1, 0x41464d), s / 2 - 0.45, 2.6, F + 0.05);   // door handle
      // the glass door, with a faint diagonal sheen
      const sheen = (() => { const c = Object.assign(document.createElement("canvas"), { width: 128, height: 256 }), q = c.getContext("2d"), gr = q.createLinearGradient(0, 0, 128, 256);
        gr.addColorStop(0, "rgba(255,255,255,.05)"); gr.addColorStop(0.32, "rgba(255,255,255,.05)"); gr.addColorStop(0.36, "rgba(255,255,255,.35)"); gr.addColorStop(0.44, "rgba(255,255,255,.05)"); gr.addColorStop(1, "rgba(255,255,255,.02)");
        q.fillStyle = gr; q.fillRect(0, 0, 128, 256); return new T.CanvasTexture(c); })();
      const GW = s - 0.68, glass = put(new T.Mesh(new T.PlaneGeometry(GW, CH), new T.MeshBasicMaterial({ map: sheen, color: 0xa8cede, transparent: true, opacity: 0.55, depthWrite: false })), 0, CY, F);
      // the little screen on the base
      const scrCanvas = Object.assign(document.createElement("canvas"), { width: 256, height: 96 });
      const scr = put(new T.Mesh(new T.PlaneGeometry(0.96, 0.36), new T.MeshBasicMaterial({ map: new T.CanvasTexture(scrCanvas) })), -s / 2 + 0.72, 0.3, F + 0.005);
      // inside: the bed (lowers as the part grows), the gantry and toolhead at the top, the part itself
      const bed = put(shadedBox(T, 2.56, 0.08, 2.56, 0x7a6638), 0, 3.6, 0);
      put(shadedBox(T, s - 0.3, 0.1, 0.12, 0x2b2e33), 0, 4.0, 0);
      const head = put(shadedBox(T, 0.55, 0.6, 0.5, 0x30343a), 0, 3.95, 0);
      const nozzleGlow = put(new T.Sprite(new T.SpriteMaterial({ map: glowTex(T), color: 0xff9a4a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })), 0, 3.6, 0); nozzleGlow.scale.set(0.6, 0.6, 1);
      const NL = 60, op = [];
      for (let k = 0; k < NL; k++) { const y = (k / NL) * 1.6, r = 0.62 * (1 - 0.2 * Math.sin((k / NL) * Math.PI) + 0.08 * Math.sin(k / 3)); ring(op, 0, y, 0, r, 36); }
      const obj = segs(T, op, COL.cyan, 0.85); P.add(obj);
      // the chamber light: a warm glow inside, and a spill on the floor in front of the door
      const lamp = put(new T.Sprite(new T.SpriteMaterial({ map: glowTex(T), color: 0xffe9c8, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })), 0, 3.3, 0); lamp.scale.set(4.6, 4.4, 1);
      const spill = put(new T.Mesh(new T.PlaneGeometry(6, 4), new T.MeshBasicMaterial({ map: glowTex(T), color: 0xffe2b8, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })), 0, 0.03, F + 1.6); spill.rotation.x = -Math.PI / 2;
      // AMS on top: 372 × 218 × 280 mm, a solid base and a smoked lid with the four spools showing through
      const ay = h + 0.02;
      body.push(put(shadedBox(T, 3.72, 0.9, 2.8, BODY), 0, ay + 0.45, 0));
      const lidGeo = new T.BoxGeometry(3.72, 1.22, 2.8);
      put(new T.Mesh(lidGeo, new T.MeshBasicMaterial({ color: 0x2e3a42, transparent: true, opacity: 0.38, depthWrite: false })), 0, ay + 0.9 + 0.61, 0);
      put(new T.LineSegments(new T.EdgesGeometry(lidGeo), lineMat(T, 0x8fb9c2, 0.28)), 0, ay + 0.9 + 0.61, 0);
      const amsSp = [];
      for (let k = 0; k < 4; k++) {
        const cx = -1.29 + k * 0.86, { fl, fil } = spoolPts("x", cx, ay + 1.0, -0.1, 0.92, 0.62);
        const a = segs(T, fl, 0xb8c4c8, 0.3), b = segs(T, fil, COL.edge, 0.85); P.add(a, b); amsSp.push({ a, b, x: PX + cx, y: ay + 2.25 });
      }
      // a soft contact shadow, and the progress ring on the floor
      { const c2 = Object.assign(document.createElement("canvas"), { width: 256, height: 256 }), q = c2.getContext("2d"), gr = q.createRadialGradient(128, 128, 30, 128, 128, 128); gr.addColorStop(0, "rgba(0,0,0,.8)"); gr.addColorStop(1, "rgba(0,0,0,0)"); q.fillStyle = gr; q.fillRect(0, 0, 256, 256);
        const sh = put(new T.Mesh(new T.PlaneGeometry(s + 2.4, d + 2.4), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c2), transparent: true, depthWrite: false })), 0, 0.012, 0); sh.rotation.x = -Math.PI / 2; }
      const track = put(new T.Mesh(new T.RingGeometry(3.05, 3.17, 128), new T.MeshBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0, depthWrite: false })), 0, 0.02, 0); track.rotation.x = -Math.PI / 2;
      const prog = put(new T.Mesh(new T.RingGeometry(3.0, 3.22, 128, 1, -Math.PI / 2, 0.001), new T.MeshBasicMaterial({ color: COL.ok, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })), 0, 0.025, 0); prog.rotation.x = -Math.PI / 2;
      // the filament shelf: 5 × 4 cubbies
      const sh = [], { cols, rows, cell, x0, y0 } = SHELF, x1 = x0 + cols * cell, y1 = y0 + rows * cell, zf = 0.55, zb = -0.55;
      for (let c = 0; c <= cols; c++) { const x = x0 + c * cell; sh.push(x, y0, zf, x, y1, zf, x, y0, zb, x, y1, zb); }
      for (let r = 0; r <= rows; r++) { const y = y0 + r * cell; sh.push(x0, y, zf, x1, y, zf, x0, y, zb, x1, y, zb); for (let c = 0; c <= cols; c++) { const x = x0 + c * cell; sh.push(x, y, zf, x, y, zb); } }
      sh.push(x0, 0, zf, x0, y0, zf, x1, 0, zf, x1, y0, zf);   // feet
      const shelfFrame = segs(T, sh, COL.edge, 0.28); g.add(shelfFrame);
      WS.shelf = new T.Group(); g.add(WS.shelf); WS.shelfKey = "";
      WS.obj = { P, body, inner, glass, scr, scrCanvas, bed, head, nozzleGlow, obj, NL, lamp, spill, amsSp, track, prog, shelfFrame, PX, s, h, d, F, GW, CH, CY, pct: -1, fade: 1, lampK: 0, hot: 1 };
      buildShelfSpools();
    },
    tick(g, dt, now) {
      const o = WS.obj, P = WS.p; if (!o) return;
      if (WS.shelf && WS.shelf.children.length === 0 && WS.stockItems.length) { WS.shelfKey = ""; buildShelfSpools(); }
      const M = wsMood(), mood = M.mood, k = Math.max(0, Math.min(1, M.prog / 100)), busy = mood === "printing" || mood === "paused";
      // a print that just finished: confetti off the status card
      if (WS.lastMood && /printing|paused/.test(WS.lastMood) && /finished|done/.test(mood)) { WS.doneAt = Date.now(); setTimeout(() => { const el = V3.tags.get("holo"); el && burst(el); haptic(); }, 120); }
      if (mood !== "none") WS.lastMood = mood;
      const ease = (r) => Math.min(1, dt * r);
      // the bed lowers as the part grows; the nozzle stays at the top
      const bedY = 3.6 - 1.6 * (busy || /done|finished/.test(mood) ? k : 0);
      o.bed.position.y = bedY; o.obj.position.y = bedY + 0.04;
      o.obj.geometry.setDrawRange(0, Math.round(o.NL * (busy || /done|finished/.test(mood) ? k : 0)) * 36 * 2);
      const trays = WS.trays.map((id) => st(id)), act = trays.find((t) => t && t.a.active);
      o.obj.material.color.setHex(act && act.a.color ? parseInt(String(act.a.color).slice(1, 7), 16) : COL.cyan); o.obj.material.opacity = busy ? 0.9 : 0.6;
      o.head.position.x = mood === "printing" ? Math.sin(now / 180) * 0.7 : 0; o.head.position.z = mood === "printing" ? Math.cos(now / 240) * 0.6 : 0;
      o.nozzleGlow.position.set(o.head.position.x, 3.62, o.head.position.z); o.nozzleGlow.material.opacity = mood === "printing" ? 0.55 + Math.sin(now / 90) * 0.15 : 0;
      // the chamber light follows Home Assistant
      const lightOn = !!(P && P.light && (st(P.light) || {}).s === "on");
      o.lampK += ((lightOn ? 1 : 0) - o.lampK) * ease(4);
      o.lamp.material.opacity = 0.5 * o.lampK; o.spill.material.opacity = 0.16 * o.lampK;
      o.inner.material.color.setRGB(0.08 + 0.25 * o.lampK, 0.09 + 0.22 * o.lampK, 0.1 + 0.18 * o.lampK);
      // is the mouse over the printer's front?
      const corner = (x, y) => toCanvas(o.PX + x, y, o.F + 0.01);
      const q = [corner(-o.GW / 2, o.CY + o.CH / 2), corner(o.GW / 2, o.CY + o.CH / 2), corner(-o.GW / 2, o.CY - o.CH / 2), corner(o.GW / 2, o.CY - o.CH / 2)];
      const facing = q.every(Boolean) && q[1].x > q[0].x + 20;
      let over = false;
      if (V3.mouse && facing) {
        const r = V3.canvas.getBoundingClientRect(), kk = V3.canvas.clientWidth / (r.width || 1), mx = (V3.mouse.x - r.left) * kk, my = (V3.mouse.y - r.top) * kk;
        const a = toCanvas(o.PX - o.s / 2, o.h + 2.2, o.F), b = toCanvas(o.PX + o.s / 2, 0, o.F);
        over = !!(a && b && mx > a.x && mx < b.x && my > a.y && my < b.y);
      }
      WS.overP = over;
      const hot = over || V3.pinned === "printer" ? 1.16 : 1; if (Math.abs(hot - o.hot) > 0.001) { o.hot += (hot - o.hot) * ease(8); if (Math.abs(hot - o.hot) < 0.005) o.hot = hot; o.body.forEach((m) => toneBox(m, o.hot)); }
      // the live camera sits on the glass while printing, or when you point at the printer
      const camOn = !!(P && P.cam && facing && (busy || over || V3.pinned === "printer"));
      wsCam(camOn ? q : null);
      o.glass.material.opacity = camOn ? 0.2 : 0.55;
      // progress ring on the floor
      const pct = busy ? Math.round(k * 200) / 2 : /done|finished/.test(mood) ? 100 : -1;
      if (pct !== o.pct) { o.pct = pct; o.prog.geometry.dispose(); o.prog.geometry = new V3.T.RingGeometry(3.0, 3.22, 128, 1, -Math.PI / 2, Math.max(0.001, (Math.max(0, pct) / 100) * Math.PI * 2)); }
      o.track.material.opacity += ((pct >= 0 ? 0.12 : 0) - o.track.material.opacity) * ease(3);
      o.prog.material.color.setHex(mood === "paused" ? COL.warn : COL.ok);
      o.prog.material.opacity += ((busy ? 0.75 + Math.sin(now / 600) * 0.12 : mood === "done" ? 0.6 : mood === "finished" ? 0.18 : 0) - o.prog.material.opacity) * ease(3);
      // the screen on the base
      drawScreen(busy ? `${Math.round(M.prog)}%` : mood === "offline" ? "OFFLINE" : mood === "failed" ? "FAILED" : /done|finished/.test(mood) ? "DONE" : "READY",
        busy ? `${hm(P && n(st(P.remain)))} LEFT` : lightOn ? "LIGHT ON" : "P1S · AMS", mood);
      // AMS: spool colours from the trays, one label for the lot
      o.amsSp.forEach((sp, i) => {
        const t = trays[i], c = t && t.a.color ? parseInt(String(t.a.color).slice(1, 7), 16) : COL.edge, on = !!(t && t.a.active), empty = !t || t.a.empty;
        sp.b.material.color.setHex(c); sp.b.material.opacity = empty ? 0 : on ? 0.95 : 0.75;
        if (on && mood === "printing") { sp.a.rotation.x += dt * 1.2; sp.b.rotation.x += dt * 1.2; }
        pick("ams" + i, sp.x, sp.y - 1.1, 0, () => `<b>AMS SLOT ${i + 1}${on ? " · FEEDING" : ""}</b><dl><dt>FILAMENT</dt><dd>${esc(empty ? "Empty" : t.a.name || t.s)}</dd><dt>TYPE</dt><dd>${esc((t && t.a.type) || "—")}</dd><dt>COLOUR</dt><dd><i class="eddo-sw" style="background:${esc(String((t && t.a.color) || "#555").slice(0, 7))}"></i>${esc(String((t && t.a.color) || "").slice(0, 7))}</dd>${t && t.a.remain >= 0 ? `<dt>LEFT</dt><dd>${t.a.remain}%</dd>` : ""}${t && t.a.nozzle_temp_min ? `<dt>NOZZLE</dt><dd>${esc(t.a.nozzle_temp_min)}–${esc(t.a.nozzle_temp_max)}°</dd>` : ""}</dl>`);
      });
      tag("ams", o.PX, 7.25, 0, `<b>AMS</b><span class="eddo-ams-row">${o.amsSp.map((sp, i) => { const t = trays[i], c = t && !t.a.empty && t.a.color ? String(t.a.color).slice(0, 7) : "transparent"; return `<i style="background:${esc(c)}"${t && t.a.active ? ' data-on="true"' : ""}></i>`; }).join("")}</span>`, true);
      // the printer itself: hover for its state, click to keep it open and switch the chamber light
      if (P) pick("printer", o.PX, o.CY, o.F + 0.1, () => `<b>BAMBU LAB P1S</b><dl><dt>STATE</dt><dd>${esc(mood.toUpperCase())}</dd><dt>NOZZLE</dt><dd>${fmt(n(st(P.nozzle)))}°</dd><dt>BED</dt><dd>${fmt(n(st(P.bed)))}°</dd><dt>LIGHT</dt><dd>${lightOn ? "ON" : "OFF"}</dd></dl>`,
        P.light ? { open: { label: lightOn ? "CHAMBER LIGHT OFF" : "CHAMBER LIGHT ON", run: () => call("light", lightOn ? "turn_off" : "turn_on", { target: { entity_id: P.light } }) } } : null);
      // the status card beside the printer: big while printing, the last print when idle
      if (P) {
        const task = st(P.task), name = live(task) && task.s ? task.s : "", cover = picOf(P.cover), img = cover ? `<img src="${esc(cover)}" alt="">` : "";
        const rem = n(st(P.remain)), end = st(P.end), w = n(st(P.weight)), stS = st(P.status);
        let html;
        if (mood === "printing" || mood === "paused") html = `<em>${mood === "paused" ? "PAUSED" : "PRINTING"} · ${Math.round(M.prog)}%</em><b class="big">${hm(rem)}</b><span>LEFT${live(end) && !isNaN(Date.parse(end.s)) ? " · DONE " + clock(Date.parse(end.s)) : ""}</span>${img}<b>${esc(name.toUpperCase())}</b><span>LAYER ${fmt(n(st(P.layer)))} / ${fmt(n(st(P.layers)))}</span>`;
        else if (mood === "done") html = `<b class="big">DONE</b><span>${esc(name.toUpperCase())}</span>${img}<span data-warn="true">CLEAR THE PLATE</span>`;
        else if (mood === "offline") html = `<em>PRINTER OFFLINE</em>`;
        else html = `<em>${mood === "failed" ? "LAST PRINT · FAILED" : "LAST PRINT"}</em>${img}<b>${esc((name || "—").toUpperCase())}</b><span>${w ? fmt(w) + " G · " : ""}${stS && stS.t ? "ENDED " + ago(stS.t).toUpperCase() : ""}</span>${mood === "finished" ? '<span data-warn="true">PLATE MAY STILL BE FULL</span>' : ""}`;
        tag("holo", o.PX + o.s / 2 + 1.1, 3.4, o.F, `<div class="eddo-ws-holo" data-mood="${mood}">${html}</div>`, true, "eddo-page-tag-left eddo-page-tag-holo");
      }
      // the shelf: slides between pages, steps back while a print runs (unless you point at it)
      if (WS.shelf && !WS.dragging) { const gx = WS.shelf.userData.goal || 0; WS.shelf.position.x += (gx - WS.shelf.position.x) * ease(9); if (Math.abs(WS.shelf.position.x - gx) < 0.01) WS.shelf.position.x = gx; }
      if (WS.shelfOut) {
        const so = WS.shelfOut; so.position.x += (so.userData.goal - so.position.x) * ease(9);
        const left = Math.abs(so.userData.goal - so.position.x) / (SHELF_W() + 1.5);
        so.children.forEach((c) => { c.material.opacity = (c.userData.o ?? (c.userData.o = c.material.opacity)) * Math.min(1, left * 1.6); });
        if (left < 0.02) { so.parent && so.parent.remove(so); so.children.forEach((c) => c.geometry && c.geometry.dispose()); WS.shelfOut = null; }
      }
      let overShelf = false; if (V3.mouse) { const r = shelfRect(); overShelf = !!(r && V3.mouse.x > r.l && V3.mouse.x < r.r && V3.mouse.y > r.t && V3.mouse.y < r.b); }
      o.fade += ((busy && !overShelf ? 0.3 : 1) - o.fade) * ease(3);
      o.shelfFrame.material.opacity = 0.28 * o.fade;
      if (WS.shelf) WS.shelf.children.forEach((c) => { c.material.opacity = (c.userData.o ?? (c.userData.o = c.material.opacity)) * o.fade; });
      // spools: no labels, hover one for its details
      (WS.spools || []).forEach((sp) => {
        const it = sp.it, parts = String(it.description || "").split("·").map((x) => x.trim());
        const kind = (parts[1] || (/\b(PLA\+?|PETG|ABS\+?|ASA|TPU|PC|PA)\b/i.exec(it.summary) || [""])[0]).toUpperCase();
        pick("sp:" + it.uid, sp.x + WS.shelf.position.x, sp.y, 0.4, () => `<b>${esc(shortName(it.summary).toUpperCase())}</b>${kind ? `<span class="eddo-ply" data-k="${esc(kind.split(" ")[0].replace("+", "P"))}">${esc(kind)}</span>` : ""}<dl><dt>COLOUR</dt><dd><i class="eddo-sw" style="background:${esc(parts[0] && /^#/.test(parts[0]) ? parts[0] : "#555")}"></i>${esc(parts[0] || "—")}</dd>${parts[2] ? `<dt>CODE</dt><dd>${esc(parts[2])}</dd>` : ""}${parts[3] ? `<dt>BOUGHT</dt><dd>${esc(parts.slice(3).join(" · "))}</dd>` : ""}</dl>`,
          { remove: { label: "REMOVE FROM SHELF", ask: `Remove ${it.summary} from the shelf?`, run: () => { HA().send({ type: "call_service", domain: "todo", service: "remove_item", target: { entity_id: WS.stock }, service_data: { item: it.uid } }).catch(() => {}).finally(() => setTimeout(() => loadStock(true), 500)); } } });
      });
      const pages = WS.pages || 1;
      tag("shelf", SHELF.x0 + (SHELF.cols * SHELF.cell) / 2, SHELF.y0 + SHELF.rows * SHELF.cell + 0.7, 0,
        `<b>FILAMENT · ${WS.stockTotal || 0} SPOOLS</b><span class="eddo-shelf-nav">${pages > 1 ? `<button data-shelf="-1"${WS.page ? "" : " disabled"}>‹</button>PAGE ${WS.page + 1} / ${pages}<button data-shelf="1"${WS.page < pages - 1 ? "" : " disabled"}>›</button>` : "ALL ON THE SHELF"}${WS.stock ? "" : " · NO LIST"}</span>`, true, "eddo-page-tag-nav");
    },
    panel() {
      const P = WS.p; if (!P) return `<p class="wb-muted eddo-pg-note">No Bambu Lab printer in Home Assistant.</p>`;
      const M = wsMood(), mood = M.mood, busy = mood === "printing" || mood === "paused";
      const task = st(P.task), name = live(task) && task.s ? task.s : "No job yet", cover = picOf(P.cover), rem = n(st(P.remain)), end = st(P.end), w = n(st(P.weight)), stS = st(P.status);
      const LBL = { printing: "PRINTING", paused: "PAUSED", done: "JUST FINISHED", finished: "LAST PRINT", failed: "LAST PRINT · FAILED", idle: "LAST PRINT", offline: "PRINTER OFFLINE" };
      const sub = busy ? `LAYER ${fmt(n(st(P.layer)))} / ${fmt(n(st(P.layers)))}${w ? " · " + fmt(w) + " G" : ""}` : `${w ? fmt(w) + " G · " : ""}${stS && stS.t ? "ended " + ago(stS.t) : ""}`;
      let h = `<div class="eddo-ws-job" data-mood="${mood}">${cover ? `<img src="${esc(cover)}" alt="">` : `<div class="eddo-ws-noimg">◇</div>`}<div><em>${LBL[mood] || "PRINTER"}</em><b>${esc(name)}</b><span>${esc(sub)}</span>${/done|finished/.test(mood) ? '<span data-warn="true">Clear the plate before the next one</span>' : ""}</div></div>`;
      if (busy) h += `<div class="wb-large">${Math.round(M.prog)}<small>% · ${hm(rem)} LEFT</small></div><i class="eddo-pg-prog"><s style="width:${M.prog}%"></s></i><p class="eddo-ws-sub">${live(end) && !isNaN(Date.parse(end.s)) ? "DONE AROUND " + clock(Date.parse(end.s)) : esc(String(M.stage || "").replace(/_/g, " ").toUpperCase())}</p>`;
      // filament in the AMS
      const trays = WS.trays.map((id) => st(id));
      if (trays.length) h += `<p class="eddo-pg-h">${busy ? "FILAMENT IN USE" : "IN THE AMS"}</p><div class="eddo-ws-ams">${trays.slice(0, 4).map((t, i) => { const empty = !t || t.a.empty, col = t && t.a.color ? String(t.a.color).slice(0, 7) : "transparent";
        return `<div${t && t.a.active ? ' data-on="true"' : ""}><i style="background:${esc(empty ? "transparent" : col)}"></i><b>${esc(empty ? "EMPTY" : (t.a.type || "—").toUpperCase())}</b><span>${esc(empty ? "Slot " + (i + 1) : t.a.name || t.s)}</span>${t && t.a.remain >= 0 && !empty ? `<em>${t.a.remain}%</em>` : ""}</div>`; }).join("")}</div>`;
      // the queue
      const items = WS.items.filter((i) => i.status === "needs_action"), doneN = WS.items.length - items.length;
      h += `<p class="eddo-pg-h">PRINT QUEUE ${WS.queue ? `<span>${items.length} TO PRINT${doneN ? ` · ${doneN} DONE` : ""}</span>` : ""}</p>` +
        (WS.queue ? `<div class="eddo-pg-queue">${items.map((i) => `<button data-q="${esc(i.uid)}"><i></i><b>${esc(i.summary)}</b>${i.description ? `<small>${esc(i.description)}</small>` : ""}</button>`).join("") || `<p class="wb-muted eddo-pg-note">Queue's empty.</p>`}</div><form class="eddo-pg-add" data-qadd><input name="t" placeholder="Add a model to print…" autocomplete="off"><button>ADD</button></form>`
          : `<p class="wb-muted eddo-pg-note">Make a to-do list called "Print queue" in Home Assistant and it shows up here.</p>`);
      const stockN = WS.stockItems.filter((i) => i.status === "needs_action").length, hum = n(st(P.hum));
      h += `<p class="eddo-ws-foot">NOZZLE ${fmt(n(st(P.nozzle)))}° · BED ${fmt(n(st(P.bed)))}° · AMS <span${hum >= 45 ? ' data-warn="true"' : ""}>${hum != null ? fmt(hum) + "% RH" : "—"}</span>${n(st(P.amsT)) != null ? " · " + fmt(n(st(P.amsT)), 1) + "°C" : ""} · ${stockN} SPOOLS</p>`;
      return h;
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
