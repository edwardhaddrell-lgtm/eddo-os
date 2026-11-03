// EDDO OS · House tab — a holographic 3D model of the house and garden office.
// Rooms glow when their lights are on (colour + brightness from Home Assistant),
// the garden office tints blue → amber with its temperature. Hover a room for
// its name and state, click to focus it, click empty space to zoom back out.
// The model itself is in eddo-house-data.js. Rendering runs only while the tab
// is open, and the archive scene is hidden meanwhile.
(() => {
  "use strict";
  const H = window.EDDO_HOUSE; if (!H || !window.eddoTabs) return;
  const HA = () => window.eddoHA;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------ rooms
  const rooms = [];
  H.floors.forEach((f, i) => f.rooms.forEach((r) => rooms.push({ ...r, floor: f.id, floorName: f.name, y: i * (H.floorHeight + H.floorGap), h: H.floorHeight })));
  (H.outbuildings || []).forEach((o) => rooms.push({ ...o, floor: "garden", floorName: "Garden", y: 0, h: o.h || 2.4 }));
  rooms.forEach((r) => { r.ents = new Set(r.entities || []); r.on = 0; r.color = [1, 0.7, 0.42]; r.bri = 0; r.temp = null; r.glow = 0; });
  const states = new Map();
  let dirty = true;

  const LIGHTY = /light|lamp|bulb|strip|candle/i;
  window.addEventListener("eddo-ha-ready", (e) => {
    const { allStates, devices, ents, areas } = e.detail;
    const areaName = new Map((areas || []).map((a) => [a.area_id, String(a.name || "").toLowerCase()]));
    const devArea = new Map((devices || []).map((d) => [d.id, d.area_id]));
    const stMap = new Map(allStates.map((s) => [s.entity_id, s]));
    rooms.forEach((r) => { r.ents = new Set((r.entities || []).filter((id) => stMap.has(id))); });
    for (const x of ents) {
      if (x.disabled_by || x.hidden_by) continue;
      const an = areaName.get(x.area_id || devArea.get(x.device_id)); if (!an) continue;
      const room = rooms.find((r) => (r.areas || []).some((a) => a.toLowerCase() === an)); if (!room) continue;
      const dom = x.entity_id.split(".")[0], st = stMap.get(x.entity_id); if (!st) continue;
      const useful = dom === "light" || dom === "climate" || (dom === "switch" && LIGHTY.test(x.entity_id + " " + (st.attributes.friendly_name || ""))) ||
        (dom === "sensor" && st.attributes.device_class === "temperature");
      if (useful) room.ents.add(x.entity_id);
    }
    rooms.forEach((r) => { if (r.climate && stMap.has(r.climate)) r.ents.add(r.climate); });
    const ids = [...new Set(rooms.flatMap((r) => [...r.ents]))];
    states.clear();
    ids.forEach((id) => { const s = stMap.get(id); states.set(id, { s: s.state, a: s.attributes }); });
    rooms.forEach(evalRoom); dirty = true;
    if (ids.length) HA().subscribe({ type: "subscribe_entities", entity_ids: ids }, (ev) => {
      for (const [id, v] of Object.entries(ev.a || {})) states.set(id, { s: v.s, a: v.a || {} });
      for (const [id, v] of Object.entries(ev.c || {})) {
        const cur = states.get(id) || { s: "", a: {} };
        if (v["+"]) { if ("s" in v["+"]) cur.s = v["+"].s; if (v["+"].a) Object.assign(cur.a, v["+"].a); }
        states.set(id, cur);
      }
      rooms.forEach(evalRoom); dirty = true;
    }).catch(() => {});
  });

  function evalRoom(r) {
    let on = 0, bri = 0, rgb = [0, 0, 0], n = 0, temp = null;
    for (const id of r.ents) {
      const st = states.get(id); if (!st) continue;
      const dom = id.split(".")[0];
      if ((dom === "light" || dom === "switch") && st.s === "on") {
        on++;
        const b = dom === "light" && st.a.brightness != null ? st.a.brightness / 255 : 1;
        bri = Math.max(bri, b);
        const c = dom === "light" && Array.isArray(st.a.rgb_color) ? st.a.rgb_color.map((v) => v / 255) : [1, 0.72, 0.45];
        rgb = rgb.map((v, i) => v + c[i]); n++;
      }
      if (dom === "climate" && Number.isFinite(+st.a.current_temperature)) temp = +st.a.current_temperature;
      if (dom === "sensor" && temp == null && Number.isFinite(+st.s)) temp = +st.s;
    }
    r.on = on; r.bri = bri; r.temp = temp;
    if (n) r.color = rgb.map((v) => v / n);
    const cl = r.climate && states.get(r.climate);
    r.hvac = cl ? cl.s : null;
  }
  const lightIds = (r) => [...r.ents].filter((id) => /^(light|switch)\./.test(id));
  function roomStatus(r) {
    const total = lightIds(r).length;
    const parts = [];
    if (total) parts.push(r.on ? `${r.on} ON` : "LIGHTS OFF");
    if (r.temp != null) parts.push(`${r.temp.toFixed(1)}°`);
    if (r.hvac && r.hvac !== "off") parts.push(String(r.hvac).replace(/_/g, " ").toUpperCase());
    return parts.join(" · ") || "—";
  }

  // ------------------------------------------------------------ 3D
  let T = null, renderer, scene, camera, pivot, canvas, labelsEl, running = false, building = null;
  const view = { theta: -0.75, phi: 0.72, dist: 52, target: null, goal: null, t0: performance.now() };
  let focused = null, hovered = null, drag = null, lastFrame = 0;

  async function ensure3D() {
    if (renderer) return true;
    if (building) return building;
    building = (async () => {
      try { T = await import("./three-eddo.min.js"); } catch (err) { console.warn("House: three.js failed to load", err); return false; }
      const stage = document.querySelector("#stage"); if (!stage) return false;
      canvas = document.createElement("canvas"); canvas.className = "eddo-house-canvas";
      labelsEl = document.createElement("div"); labelsEl.className = "eddo-house-labels";
      const anchor = stage.querySelector(".eddo-dim") || stage.querySelector(".scene-atmosphere");
      if (anchor) { anchor.after(canvas); canvas.after(labelsEl); } else { stage.prepend(labelsEl); stage.prepend(canvas); }
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0);
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(30, 16 / 9, 0.1, 400);
      pivot = new T.Group(); scene.add(pivot);
      buildModel();
      view.target = new T.Vector3(0, 3.2, 0); view.goal = { target: view.target.clone(), dist: view.dist, phi: view.phi };
      hookInput();
      return true;
    })();
    return building;
  }

  const C = { edge: 0x8fb9c2, edgeHot: 0xffd2a0, face: 0x9fd4dc, plate: 0x1c2427, grid: 0x6f8a90 };
  function buildModel() {
    const root = new T.Group();
    // centre the whole site (house + garden office) on the pivot
    const maxX = Math.max(...rooms.map((r) => r.x + r.w)), maxZ = Math.max(...rooms.map((r) => r.z + r.d));
    root.position.set(-maxX / 2, 0, -maxZ / 2);
    pivot.add(root);

    // ground: a faint site grid and the garden outline
    const gridPts = [];
    for (let x = -3; x <= Math.ceil(maxX) + 3; x++) gridPts.push(x, 0, -4, x, 0, maxZ + 3);
    for (let z = -4; z <= Math.ceil(maxZ) + 3; z++) gridPts.push(-3, 0, z, Math.ceil(maxX) + 3, 0, z);
    const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(gridPts, 3));
    root.add(new T.LineSegments(gg, new T.LineBasicMaterial({ color: C.grid, transparent: true, opacity: 0.07 })));
    const houseD = Math.max(...rooms.filter((r) => r.floor !== "garden").map((r) => r.z + r.d));
    const garden = [[0, houseD], [maxX + 0.4, houseD], [maxX + 0.4, maxZ + 1.2], [0, maxZ + 1.2], [0, houseD]];
    const gp = new T.BufferGeometry(); gp.setAttribute("position", new T.Float32BufferAttribute(garden.flatMap(([x, z]) => [x, 0.01, z]), 3));
    root.add(new T.Line(gp, new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.22 })));

    for (const r of rooms) {
      const g = new T.Group(); g.position.set(r.x + r.w / 2, r.y, r.z + r.d / 2); root.add(g);
      const plate = new T.Mesh(new T.BoxGeometry(r.w - 0.06, 0.05, r.d - 0.06), new T.MeshBasicMaterial({ color: C.plate, transparent: true, opacity: 0.62 }));
      plate.position.y = 0.025; g.add(plate);
      const glow = new T.Mesh(new T.PlaneGeometry(r.w - 0.12, r.d - 0.12), new T.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; g.add(glow);
      const box = new T.BoxGeometry(r.w, r.h, r.d);
      const faces = new T.Mesh(box, new T.MeshBasicMaterial({ color: C.face, transparent: true, opacity: 0.03, depthWrite: false, side: T.DoubleSide }));
      faces.position.y = r.h / 2; faces.userData.room = r; g.add(faces);
      const edges = new T.LineSegments(new T.EdgesGeometry(box), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: r.quiet ? 0.22 : 0.42 }));
      edges.position.y = r.h / 2; g.add(edges);
      if (r.bay) {   // bay window on the living room front
        const bw = Math.min(2.4, r.w - 0.6), bd = 0.45, bh = 2.0;
        const bay = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(bw, bh, bd)), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.35 }));
        bay.position.set(0, bh / 2, -r.d / 2 - bd / 2); g.add(bay);
      }
      r.mesh = { g, plate, glow, faces, edges, warm: 0 };
    }
    // labels
    labelsEl.innerHTML = rooms.filter((r) => !r.quiet).map((r) => `<div class="eddo-house-label" data-room="${r.id}"><b>${esc(r.name.toUpperCase())}</b><span></span></div>`).join("");
    rooms.forEach((r) => { r.label = labelsEl.querySelector(`[data-room="${r.id}"]`); });
  }

  const tmpC = () => new T.Color();
  function tempColour(t) {   // 16° blue → 21° neutral → 26° amber
    const cold = new T.Color(0x6fa8ff), mid = new T.Color(C.edge), hot = new T.Color(0xffa24a);
    if (t == null) return mid;
    return t < 21 ? cold.lerp(mid, Math.max(0, Math.min(1, (t - 16) / 5))) : mid.lerp(hot, Math.max(0, Math.min(1, (t - 21) / 5)));
  }
  function updateVisuals(dt) {
    for (const r of rooms) {
      const m = r.mesh; if (!m) continue;
      const want = r.on ? 0.16 + 0.3 * r.bri : 0;
      r.glow += (want - r.glow) * Math.min(1, dt * 4);
      const lc = new T.Color(r.color[0], r.color[1], r.color[2]);
      m.glow.material.color.copy(lc); m.glow.material.opacity = r.glow;
      m.plate.material.color.copy(new T.Color(C.plate).lerp(lc, r.glow * 0.7));
      const isFocus = focused === r, isHover = hovered === r, dim = focused && focused.floor !== r.floor;
      let edgeCol = r.climate ? tempColour(r.temp) : new T.Color(C.edge).lerp(new T.Color(C.edgeHot), r.glow * 0.8);
      m.edges.material.color.copy(edgeCol);
      m.edges.material.opacity = dim ? 0.08 : isHover || isFocus ? 0.95 : r.quiet ? 0.22 : 0.42 + r.glow * 0.4;
      m.faces.material.opacity = dim ? 0.01 : isHover || isFocus ? 0.08 : 0.03;
      m.plate.material.opacity = dim ? 0.15 : 0.62;
    }
  }

  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const r of rooms) {
      if (!r.label) continue;
      const p = new T.Vector3(r.x + r.w / 2, r.y + r.h + 0.15, r.z + r.d / 2);
      r.mesh.g.parent.localToWorld(p);
      p.project(camera);
      const vis = p.z < 1 && !(focused && focused.floor !== r.floor);
      const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
      const tf = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (r.label.style.transform !== tf) r.label.style.transform = tf;
      r.label.dataset.hidden = String(!vis);
      r.label.dataset.on = String(r.on > 0);
      r.label.dataset.active = String(hovered === r || focused === r);
      const s = r.label.querySelector("span"), txt = roomStatus(r);
      if (s.textContent !== txt) s.textContent = txt;
    }
  }

  function resize() {
    const stage = document.querySelector("#stage"); if (!stage || !renderer) return;
    const w = stage.offsetWidth, h = stage.offsetHeight, k = stage.getBoundingClientRect().width / w || 1;
    const pr = Math.min(2, (window.devicePixelRatio || 1) * k);
    if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
    const sz = renderer.getSize(new T.Vector2());
    if (sz.x !== w || sz.y !== h) renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // draw the model left of centre, clear of the workspace column on the right
    camera.setViewOffset(w * 1.06, h, w * 0.06, 0, w, h);
    camera.updateProjectionMatrix();
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (now - lastFrame < 30) return;          // ~30 fps is plenty
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    resize();
    // ease towards the goal view; drift gently when nothing is happening
    const g = view.goal;
    view.target.lerp(g.target, Math.min(1, dt * 3));
    view.dist += (g.dist - view.dist) * Math.min(1, dt * 3);
    view.phi += (g.phi - view.phi) * Math.min(1, dt * 3);
    if (!drag && !focused) view.theta += dt * 0.035;
    const sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    camera.position.set(view.target.x + view.dist * cp * Math.sin(view.theta), view.target.y + view.dist * sp, view.target.z + view.dist * cp * Math.cos(view.theta));
    camera.lookAt(view.target);
    updateVisuals(dt);
    renderer.render(scene, camera);
    placeLabels();
  }

  function roomCentre(r) { const p = new T.Vector3(r.x + r.w / 2, r.y + r.h / 2, r.z + r.d / 2); r.mesh.g.parent.localToWorld(p); return p; }
  function focus(r) {
    focused = r || null;
    if (!T) return;
    view.goal = r ? { target: roomCentre(r), dist: r.floor === "garden" ? 16 : 20, phi: 0.85 } : { target: new T.Vector3(0, 3.2, 0), dist: 52, phi: 0.72 };
    refreshList();
  }

  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    const ray = new T.Raycaster(), v = new T.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    const hits = ray.intersectObjects(rooms.filter((r) => r.mesh && !(focused && focused.floor !== r.floor)).map((r) => r.mesh.faces), false);
    // prefer real rooms over halls/landings
    const hit = hits.find((h) => !h.object.userData.room.quiet) || hits[0];
    return hit ? hit.object.userData.room : null;
  }
  const overUi = (el) => !!(el && el.closest && el.closest(".workbench, .eddo-ha, .eddo-srv, .eddo-quick, .eddo-dlg, .system-footer, .brand, .eddo-cam-overlay, button, a"));
  function hookInput() {
    const stage = document.querySelector("#stage");
    stage.addEventListener("mousedown", (e) => { if (!running || overUi(e.target)) return; drag = { x: e.clientX, y: e.clientY, theta: view.theta, phi: view.goal.phi, moved: false }; });
    window.addEventListener("mousemove", (e) => {
      if (!running) return;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        view.theta = drag.theta - dx * 0.006;
        view.goal.phi = Math.max(0.12, Math.min(1.35, drag.phi + dy * 0.004));
        return;
      }
      hovered = overUi(e.target) ? null : pick(e);
    });
    window.addEventListener("mouseup", (e) => {
      if (!running || !drag) return;
      const moved = drag.moved; drag = null;
      if (!moved && !overUi(e.target)) { const r = pick(e); focus(r && r !== focused ? r : null); }
    });
    stage.addEventListener("wheel", (e) => {
      if (!running || overUi(e.target)) return;
      view.goal.dist = Math.max(8, Math.min(60, view.goal.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: true });
  }

  function start() {
    running = true; lastFrame = 0;
    const s = document.querySelector("#stage");
    s && s.setAttribute("data-eddo-house", "true");
    requestAnimationFrame(frame);
  }
  function stop() {
    running = false; hovered = null; drag = null;
    document.querySelector("#stage")?.removeAttribute("data-eddo-house");
  }

  // ------------------------------------------------------------ tab
  let listEl = null;
  function refreshList() {
    if (!listEl || !listEl.isConnected) return;
    const groups = [...new Set(rooms.map((r) => r.floorName))];
    const html = groups.map((gname) => `<div class="eddo-house-floor"><p>${esc(gname.toUpperCase())}</p>` +
      rooms.filter((r) => r.floorName === gname && !r.quiet).map((r) =>
        `<button class="eddo-house-row" data-house-room="${r.id}" data-on="${r.on > 0}" aria-pressed="${focused === r}"><i style="--c:rgb(${r.color.map((v) => Math.round(v * 255)).join(",")})"></i><span>${esc(r.name)}</span><em>${esc(roomStatus(r))}</em></button>`).join("") + `</div>`).join("") +
      `<p class="wb-muted eddo-house-tip">Drag to turn · scroll to zoom · click a room to focus it</p>`;
    if (listEl.innerHTML !== html) listEl.innerHTML = html;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-house-room]"); if (!b) return;
    const r = rooms.find((x) => x.id === b.dataset.houseRoom);
    if (r && renderer) focus(focused === r ? null : r);
  });
  setInterval(() => { if (running) refreshList(); }, 1000);

  window.eddoTabs.register({
    id: "house", label: "House", pos: 1,
    render(c) {
      c.innerHTML = `<div class="eddo-house-list"></div>`;
      listEl = c.querySelector(".eddo-house-list");
      refreshList();
    },
    async onShow() { if (await ensure3D()) { start(); refreshList(); } },
    onHide() { stop(); focus(null); },
  });
})();
