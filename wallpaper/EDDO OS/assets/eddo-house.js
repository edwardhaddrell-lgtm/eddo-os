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
  const devices = (H.devices || []).map((d) => ({ ...d, ids: [], roomRef: rooms.find((r) => r.id === d.room) })).filter((d) => d.roomRef);
  const KIND_DOMAINS = { light: ["light", "switch"], lamp: ["light", "switch"], appliance: ["switch", "sensor", "binary_sensor", "select"], tv: ["media_player"],
    climate: ["climate"], fan: ["fan", "climate", "switch"], camera: ["camera"], printer: ["sensor"], pc: [] };
  const KIND_HEIGHT = { light: 2.3, lamp: 1.0, appliance: 0.6, tv: 1.25, climate: 1.9, fan: 0.7, camera: 1.9, printer: 0.95, pc: 0.75 };

  const LIGHTY = /light|lamp|bulb|strip|candle/i;
  window.addEventListener("eddo-ha-ready", (e) => {
    const { allStates, devices: devReg, ents, areas } = e.detail;
    const areaName = new Map((areas || []).map((a) => [a.area_id, String(a.name || "").toLowerCase()]));
    const devArea = new Map((devReg || []).map((d) => [d.id, d.area_id]));
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
    // devices: explicit entity ids first, else the first unused entity whose name matches
    const used = new Set();
    for (const d of devices) {
      d.ids = [d.entity, ...(d.entities || [])].filter((id) => id && stMap.has(id));
      if (!d.ids.length && d.match) {
        const doms = d.domains || KIND_DOMAINS[d.kind] || [];
        const hit = allStates.find((st) => {
          if (used.has(st.entity_id) || (doms.length && !doms.includes(st.entity_id.split(".")[0]))) return false;
          const t = (st.entity_id.replace(/_/g, " ") + " " + (st.attributes.friendly_name || "")).toLowerCase();
          return d.match.some((m) => t.includes(m)) && !(d.not || []).some((m) => t.includes(m));
        });
        if (hit) d.ids = [hit.entity_id];
      }
      d.ids.forEach((id) => used.add(id));
      d.ids.filter((id) => /^(light|switch)\./.test(id) && /light|lamp/.test(d.kind)).forEach((id) => d.roomRef.ents.add(id));
      d.ids.filter((id) => /^climate\./.test(id)).forEach((id) => d.roomRef.ents.add(id));
    }
    // scenes: listed in the model, plus any HA scene assigned to the room's area
    rooms.forEach((r) => { r.sceneList = (r.scenes || []).filter((id) => stMap.has(id)); });
    for (const x of ents) {
      if (!x.entity_id.startsWith("scene.") || x.disabled_by) continue;
      const an = areaName.get(x.area_id || devArea.get(x.device_id)); if (!an) continue;
      const room = rooms.find((r) => (r.areas || []).some((a) => a.toLowerCase() === an));
      if (room && !room.sceneList.includes(x.entity_id)) room.sceneList.push(x.entity_id);
    }
    rooms.forEach((r) => { r.sceneNames = r.sceneList.map((id) => [id, (stMap.get(id)?.attributes.friendly_name || id.split(".")[1].replace(/_/g, " "))]); });
    const ids = [...new Set([...rooms.flatMap((r) => [...r.ents]), ...devices.flatMap((d) => d.ids)])];
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
  function devState(d) {
    const sts = d.ids.map((id) => [id, states.get(id)]).filter(([, st]) => st);
    if (!d.ids.length) return { active: false, text: "NOT LINKED", linked: false };
    if (!sts.length) return { active: false, text: "—", linked: true };
    let active = false, text = "", color = null, bri = 1;
    for (const [id, st] of sts) {
      const dom = id.split(".")[0], s = String(st.s);
      if (dom === "light" || dom === "switch" || dom === "fan") {
        if (s === "on") { active = true; if (dom === "light" && st.a.brightness != null) bri = Math.max(0.15, st.a.brightness / 255); if (Array.isArray(st.a.rgb_color)) color = st.a.rgb_color.map((v) => v / 255); }
        text = s === "on" ? (dom === "light" && st.a.brightness != null ? `ON ${Math.round(st.a.brightness / 2.55)}%` : "ON") : (text || "OFF");
      } else if (dom === "climate") {
        active = s !== "off" && s !== "unavailable";
        const cur = st.a.current_temperature, tgt = st.a.temperature;
        text = [s.replace(/_/g, " ").toUpperCase(), cur != null ? `${cur}°` : "", tgt != null && active ? `→ ${tgt}°` : ""].filter(Boolean).join(" ");
        color = s === "cool" ? [0.44, 0.66, 1] : [1, 0.64, 0.29];
      } else if (dom === "media_player") {
        active = !/^(off|standby|unavailable|unknown)$/.test(s); text = s.toUpperCase();
      } else if (dom === "camera") {
        active = s !== "unavailable"; text = "CAMERA"; color = [0.82, 0.24, 0.17];
      } else {
        active = /^(on|running|printing|prepare|washing|drying|active|heat|cool|playing)$/i.test(s) || (Number.isFinite(+s) && +s > 5 && /power|watt/i.test(id));
        text = s.replace(/_/g, " ").toUpperCase();
      }
    }
    return { active, text, color, bri, linked: true };
  }
  const canToggle = (d) => d.ids.some((id) => /^(light|switch|fan)\./.test(id));
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
  let skyEl = null, plinth = null, northEl = null, lastSky = 0;
  let T = null, renderer, scene, camera, pivot, canvas, labelsEl, running = false, building = null;
  const view = { theta: -0.75, phi: 0.72, dist: 52, target: null, goal: null, t0: performance.now() };
  let focused = null, hovered = null, hoveredDev = null, drag = null, lastFrame = 0;
  let floorSel = null, heatMode = false, whatsOn = false, dayK = 1, sunInfo = null;
  const isQuietDev = (d) => d.kind === "camera" || d.kind === "pc";
  const devActive = (d) => !!(d.st && d.st.active && !isQuietDev(d));
  const roomActive = (r) => r.on > 0 || devices.some((d) => d.roomRef === r && devActive(d));
  const hiddenFloor = (fl) => (focused && focused.floor !== fl) || (!focused && floorSel && floorSel !== fl);
  const isDim = (r) => hiddenFloor(r.floor) || (whatsOn && !focused && !roomActive(r));

  async function ensure3D() {
    if (renderer) return true;
    if (building) return building;
    building = (async () => {
      try { T = await import("./three-eddo-2.min.js"); } catch (err) { console.warn("House: three.js failed to load", err); return false; }
      const stage = document.querySelector("#stage"); if (!stage) return false;
      canvas = document.createElement("canvas"); canvas.className = "eddo-house-canvas";
      labelsEl = document.createElement("div"); labelsEl.className = "eddo-house-labels";
      const anchor = stage.querySelector(".eddo-dim") || stage.querySelector(".scene-atmosphere");
      skyEl = document.createElement("div"); skyEl.className = "eddo-house-sky";
      const stars = document.createElement("i"); stars.className = "eddo-house-stars";
      let sh = []; for (let i = 0; i < 90; i++) sh.push(`${(Math.random() * 100).toFixed(2)}vw ${(Math.random() * 55).toFixed(2)}vh 0 ${Math.random() < 0.15 ? 1 : 0}px rgba(220,235,240,${(0.25 + Math.random() * 0.6).toFixed(2)})`);
      stars.style.boxShadow = sh.join(","); skyEl.append(stars);
      if (anchor) { anchor.after(skyEl); skyEl.after(canvas); canvas.after(labelsEl); } else { stage.prepend(labelsEl); stage.prepend(canvas); stage.prepend(skyEl); }
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
    // the plan's "up" (towards the garden) must point away from the street, so mirror z
    root.scale.z = -1;
    root.position.set(-maxX / 2, 0, maxZ / 2);
    pivot.add(root);

    // ground: a round holographic plinth that fades out at the edge, with a compass ring and slow HUD arcs
    {
      const cx = maxX / 2, cz = maxZ / 2, R = Math.max(maxX, maxZ) / 2 + 4;
      const pos = [], col = [], base = new T.Color(C.grid);
      const fade = (rr) => Math.max(0, 1 - rr / R) ** 1.4;
      const seg = (x1, z1, x2, z2, a1, a2) => { pos.push(cx + x1, 0, cz + z1, cx + x2, 0, cz + z2); for (const a of [a1, a2]) col.push(base.r * a, base.g * a, base.b * a); };
      for (let rr = 2; rr <= R; rr += 2) for (let i = 0; i < 96; i++) {
        const a = i / 96 * Math.PI * 2, b = (i + 1) / 96 * Math.PI * 2, f = fade(rr) * 0.5;
        seg(Math.cos(a) * rr, Math.sin(a) * rr, Math.cos(b) * rr, Math.sin(b) * rr, f, f);
      }
      for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; for (let rr = 0; rr < R; rr += 1) seg(Math.cos(a) * rr, Math.sin(a) * rr, Math.cos(a) * (rr + 1), Math.sin(a) * (rr + 1), fade(rr) * 0.35, fade(rr + 1) * 0.35); }
      const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); gg.setAttribute("color", new T.Float32BufferAttribute(col, 3));
      root.add(new T.LineSegments(gg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false })));
      // compass: true-north ticks, from the site's bearing
      const cp = [], Rc = R + 0.6;
      for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, b = (i + 1) / 96 * Math.PI * 2; cp.push(cx + Math.cos(a) * Rc, 0.01, cz + Math.sin(a) * Rc, cx + Math.cos(b) * Rc, 0.01, cz + Math.sin(b) * Rc); }
      for (let deg = 0; deg < 360; deg += 5) {
        const [dx, dz] = planDir(deg * Math.PI / 180), L = deg % 90 === 0 ? 0.9 : deg % 45 === 0 ? 0.55 : 0.25;
        cp.push(cx + dx * Rc, 0.01, cz + dz * Rc, cx + dx * (Rc + L), 0.01, cz + dz * (Rc + L));
      }
      const [nx, nz] = planDir(0), [px, pz] = [-nz, nx], tip = Rc + 1.5, bs = Rc + 1.0;
      cp.push(cx + nx * tip, 0.01, cz + nz * tip, cx + nx * bs + px * 0.3, 0.01, cz + nz * bs + pz * 0.3, cx + nx * tip, 0.01, cz + nz * tip, cx + nx * bs - px * 0.3, 0.01, cz + nz * bs - pz * 0.3);
      const cg = new T.BufferGeometry(); cg.setAttribute("position", new T.Float32BufferAttribute(cp, 3));
      root.add(new T.LineSegments(cg, new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.28, depthWrite: false })));
      plinth = { north: new T.Vector3(cx + nx * (tip + 0.7), 0, cz + nz * (tip + 0.7)), arcs: [] };
      for (const [rad, span, speed, op] of [[R + 2.2, 1.1, 0.05, 0.3], [R + 2.6, 0.45, -0.08, 0.22], [R + 2.6, 0.3, -0.08, 0.22]]) {
        const ap = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * span; ap.push(Math.cos(a) * rad, 0.01, Math.sin(a) * rad); }
        const ag = new T.BufferGeometry(); ag.setAttribute("position", new T.Float32BufferAttribute(ap, 3));
        const arc = new T.Line(ag, new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: op, depthWrite: false }));
        arc.position.set(cx, 0, cz); arc.rotation.y = plinth.arcs.length * 2.4; root.add(arc); plinth.arcs.push({ arc, speed });
      }
    }
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
    // faint outline of the whole building
    if (H.shell) {
      const S = H.shell, seg = [];
      const L = (a, b) => seg.push(...a, ...b);
      const box = (x0, x1, z0, z1, y0, y1) => {
        const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
        c.forEach(([x, z], i) => { const [nx, nz] = c[(i + 1) % 4]; L([x, y0, z], [nx, y0, nz]); L([x, y1, z], [nx, y1, nz]); L([x, y0, z], [x, y1, z]); });
      };
      const m = S.main;
      if (m) {
        box(m.x0, m.x1, m.z0, m.z1, 0, m.eaves);
        L([m.x0, m.ridge, m.ridgeZ], [m.x1, m.ridge, m.ridgeZ]);                              // ridge
        for (const x of [m.x0, m.x1]) { L([x, m.eaves, m.z0], [x, m.ridge, m.ridgeZ]); }       // front slope at both gables
        const rearTop = S.dormer ? S.dormer.top : m.eaves;
        if (!S.dormer) for (const x of [m.x0, m.x1]) L([x, m.ridge, m.ridgeZ], [x, m.eaves, m.z1]);
      }
      if (S.dormer) { const d = S.dormer; box(d.x0, d.x1, d.z0, d.z1, m ? m.eaves : 0, d.top); }
      for (const c of S.chimneys || []) box(c.x0, c.x1, c.z0, c.z1, (m ? m.ridge : 8) - 1.2, c.top);
      if (S.outrigger) { const o = S.outrigger, mx = (o.x0 + o.x1) / 2; box(o.x0, o.x1, o.z0, o.z1, 0, o.eaves);
        L([mx, o.ridge, o.z0], [mx, o.ridge, o.z1]); for (const z of [o.z1]) { L([o.x0, o.eaves, z], [mx, o.ridge, z]); L([mx, o.ridge, z], [o.x1, o.eaves, z]); } }
      if (S.extension) { const e = S.extension;
        box(e.x0, e.x1, e.z0, e.z1, 0, e.low);
        L([e.x0, e.high, e.z0], [e.x1, e.high, e.z0]); L([e.x0, e.high, e.z0], [e.x0, e.low, e.z1]); L([e.x1, e.high, e.z0], [e.x1, e.low, e.z1]); }
      if (S.bay) { const b = S.bay, z = -b.depth;
        box(b.x0, b.x1, z, 0, 0, b.top);
        L([b.x0, b.top, z], [b.x0, b.roof, 0]); L([b.x1, b.top, z], [b.x1, b.roof, 0]); L([b.x0, b.roof, 0], [b.x1, b.roof, 0]); }
      const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(seg, 3));
      shellLines = new T.LineSegments(gg, new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.14, depthWrite: false }));
      root.add(shellLines);
    }

    // daylight objects live in the model's own coordinates (so plan north works)
    sunGroup = new T.Group(); sunGroup.userData = { cx: maxX / 2, cz: maxZ / 2 }; root.add(sunGroup);
    shadowGroup = new T.Group(); root.add(shadowGroup);
    sunMarker = new T.Mesh(new T.CircleGeometry(0.55, 24), new T.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    sunGroup.add(sunMarker);
    sunPath = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.15 }));
    sunGroup.add(sunPath);
    updateSun(true);

    // furniture: edge outlines only, so the model stays light
    const FUR = { color: 0x9cc2c9 };
    const furMat = () => new T.LineBasicMaterial({ color: FUR.color, transparent: true, opacity: 0.32 });
    const outline = (g, w, h, d, x, y, z) => { const e = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(w, h, d)), furMat()); e.position.set(x, y + h / 2, z); g.add(e); return e; };
    for (const f of H.furniture || []) {
      const r = rooms.find((x) => x.id === f.room); if (!r || !r.mesh) continue;
      const g = r.mesh.g, parts = [];
      const x0 = -r.w / 2 + f.u0 * r.w, x1 = -r.w / 2 + f.u1 * r.w, z0 = -r.d / 2 + f.v0 * r.d, z1 = -r.d / 2 + f.v1 * r.d;
      const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, y = f.y || 0, h = f.h || 0.8;
      const kind = f.kind || "box";
      if (kind === "rug") {
        const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].flatMap(([a, b]) => [a, 0.06, b]);
        const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
        parts.push(new T.Line(gg, furMat())); g.add(parts[0]);
      } else if (kind === "sofa") {
        const seat = Math.min(0.45, h);
        parts.push(outline(g, w, seat, d, cx, y, cz));
        if (f.back !== false) {   // back rest along the wall side (the side nearest a wall)
          const alongX = w < d, bt = 0.2;
          parts.push(alongX ? outline(g, bt, h, d, (f.u1 > 0.5 ? x1 - bt / 2 : x0 + bt / 2), y, cz) : outline(g, w, h, bt, cx, y, (f.v1 > 0.5 ? z1 - bt / 2 : z0 + bt / 2)));
        }
      } else if (kind === "table") {
        parts.push(outline(g, w, 0.04, d, cx, y + h - 0.04, cz));
        const lx = w / 2 - 0.06, lz = d / 2 - 0.06;
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(outline(g, 0.04, h - 0.04, 0.04, cx + sx * lx, y, cz + sz * lz));
      } else if (kind === "chair") {
        parts.push(outline(g, w, 0.45, d, cx, y, cz));
        parts.push(outline(g, w, h - 0.45, 0.04, cx, y + 0.45, z0 + 0.02));
      } else {
        parts.push(outline(g, w, h, d, cx, y, cz));
        if (kind === "shelves") {
          const base = f.base || 0, n = f.shelves || 3;
          for (let i = 1; i <= n; i++) {
            const sy = y + base + (h - base) * (i / (n + 1));
            const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].flatMap(([a, b]) => [a, sy, b]);
            const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
            const l = new T.Line(gg, furMat()); g.add(l); parts.push(l);
          }
          if (base) { const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].flatMap(([a, b]) => [a, y + base, b]); const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); const l = new T.Line(gg, furMat()); g.add(l); parts.push(l); }
        }
      }
      (r.furniture = r.furniture || []).push(...parts);
    }

    // devices: a marker shaped by what it is. Markers draw on top of walls and keep the same size on screen.
    const mat = (o) => new T.MeshBasicMaterial({ color: 0x6f878c, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: T.DoubleSide, ...o });
    const lmat = () => new T.LineBasicMaterial({ color: 0x6f878c, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const segs = (pts) => { const g2 = new T.BufferGeometry(); g2.setAttribute("position", new T.Float32BufferAttribute(pts.flat(), 3)); return g2; };
    for (const d of devices) {
      const r = d.roomRef, g = r.mesh.g;
      const hgt = d.kind === "climate" && /radiator/i.test(d.name) ? 0.45 : Math.min(KIND_HEIGHT[d.kind] ?? 1, r.h - 0.2);
      const x = -r.w / 2 + d.u * r.w, z = -r.d / 2 + d.v * r.d;
      const core = new T.Group(); core.position.set(x, hgt, z); core.renderOrder = 20; g.add(core);
      const parts = [];   // role: on = only when running, off = only when idle, both = always; k = opacity
      const add = (obj, role, k, tint = true) => { obj.renderOrder = 20; core.add(obj); parts.push({ obj, role, k, tint }); return obj; };
      const faceCentre = () => { core.rotation.order = "YXZ"; core.rotation.y = Math.atan2(-x, -z); };
      const k = d.kind;
      if (k === "light" || k === "lamp") {
        const rad = k === "light" ? 0.1 : 0.075;
        add(new T.Mesh(new T.SphereGeometry(rad, 18, 12), mat()), "on", 1);                                    // the bulb
        add(new T.Mesh(new T.SphereGeometry(rad * 2.4, 18, 12), mat({ blending: T.AdditiveBlending })), "on", 0.22); // its halo
        const ring = add(new T.Mesh(new T.RingGeometry(rad * 0.75, rad, 28), mat()), "off", 0.85, false);       // off: a hollow ring
        ring.rotation.x = -Math.PI / 2;
      } else if (k === "camera") {
        const W = 0.17, Hh = 0.11, L = 0.34, c = [[-W, -Hh, L], [W, -Hh, L], [W, Hh, L], [-W, Hh, L]];
        const pts = []; for (let i = 0; i < 4; i++) pts.push([0, 0, 0], c[i], c[i], c[(i + 1) % 4]);
        add(new T.LineSegments(segs(pts), lmat()), "both", 0.8);                                                 // a view cone
        add(new T.Mesh(new T.SphereGeometry(0.035, 10, 8), mat()), "both", 1);
        faceCentre(); core.rotation.x = 0.4;
      } else if (k === "tv") {
        add(new T.Mesh(new T.PlaneGeometry(0.36, 0.21), mat()), "on", 0.55);                                    // a screen that lights up
        add(new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(0.36, 0.21)), lmat()), "both", 0.9);
        faceCentre();
      } else if (k === "climate") {
        const e = add(new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(0.12, 0.12, 0.12)), lmat()), "both", 0.6); // a diamond
        e.rotation.set(Math.PI / 4, 0, Math.PI / 4);
        const f = add(new T.Mesh(new T.BoxGeometry(0.07, 0.07, 0.07), mat()), "on", 0.9); f.rotation.copy(e.rotation);
      } else if (k === "printer" || k === "pc") {
        add(new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(0.2, 0.2, 0.2)), lmat()), "both", 0.85); // a wire cube
        add(new T.Mesh(new T.BoxGeometry(0.09, 0.09, 0.09), mat()), "on", 0.95);
      } else {   // appliances, fans
        const ring = add(new T.Mesh(new T.RingGeometry(0.1, 0.13, 6), mat()), "both", 0.8);                     // a hexagon ring
        ring.rotation.x = -Math.PI / 2;
        add(new T.Mesh(new T.SphereGeometry(0.045, 10, 8), mat()), "on", 1);
      }
      const hit = new T.Mesh(new T.BoxGeometry(0.6, 0.6, 0.6), new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.copy(core.position); hit.userData.device = d; g.add(hit);
      let pool = null;
      if (k === "light" || k === "lamp") {
        pool = new T.Mesh(new T.CircleGeometry(k === "light" ? 0.9 : 0.5, 32), new T.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
        pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.07, z); g.add(pool);
      }
      d.mesh = { core, hit, pool, parts, glow: 0, size: 1 };
    }
    // labels
    labelsEl.innerHTML = rooms.filter((r) => !r.quiet).map((r) => `<div class="eddo-house-label" data-room="${r.id}"><b>${esc(r.name.toUpperCase())}</b><span></span></div>`).join("");
    rooms.forEach((r) => { r.label = labelsEl.querySelector(`[data-room="${r.id}"]`); });
    devices.forEach((d, i) => {
      const el = document.createElement("div"); el.className = "eddo-house-dev"; el.dataset.hidden = "true";
      el.innerHTML = `<b>${esc(d.name.toUpperCase())}</b><span></span>`; labelsEl.append(el); d.label = el;
    });
  }

  // ---- daylight: sun position for the site, soft ground shadows, a sun marker on its path
  const SITE = H.site || { lat: 51.4057, lon: 0.0158, northDeg: 45 };
  function sunPos(date) {
    const rad = Math.PI / 180, d = (date.getTime() - 946728000000) / 864e5;
    const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
    const hA = (gmst * 15 + SITE.lon) * rad - ra, lat = SITE.lat * rad;
    const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hA));
    const az = Math.atan2(Math.sin(hA), Math.cos(hA) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;   // from north, clockwise
    return { el, az };
  }
  // compass bearing -> direction in the model's own (plan) coordinates: x right, z towards the garden
  const planDir = (bearing) => { const b = bearing + SITE.northDeg * Math.PI / 180; return [Math.sin(b), Math.cos(b)]; };
  function sunTimes(now) {
    const day = new Date(now); day.setHours(0, 0, 0, 0);
    let rise = null, set = null, prev = sunPos(day).el;
    for (let m = 5; m <= 1440; m += 5) {
      const t = new Date(day.getTime() + m * 60e3), el = sunPos(t).el, lim = -0.833 * Math.PI / 180;
      if (prev < lim && el >= lim && !rise) rise = t; if (prev >= lim && el < lim) set = t; prev = el;
    }
    const f = (t) => t ? t.toTimeString().slice(0, 5) : "—";
    return { rise: f(rise), set: f(set) };
  }
  let shellLines = null;
  let sunGroup = null, shadowGroup = null, sunMarker = null, sunPath = null, lastSun = 0;
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function updateSun(force) {
    const now = Date.now(); if (!force && now - lastSun < 60e3) return; lastSun = now;
    const { el, az } = sunPos(new Date(now));
    const deg = el * 180 / Math.PI;
    dayK = Math.max(0, Math.min(1, (deg + 4) / 14));
    const tt = sunTimes(now); sunInfo = { ...tt, up: deg > -0.833 };
    // shadows: each ground footprint, cast by the tallest part of the building above it
    shadowGroup.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); }); shadowGroup.clear();
    if (deg > 2) {
      const [dx, dz] = planDir(az), len = Math.min(30, 1 / Math.tan(el));
      const house = rooms.filter((r) => r.floor !== "garden");
      const bases = rooms.filter((r) => r.floor === "ground" || r.floor === "garden");
      for (const r of bases) {
        const top = r.floor === "garden" ? r.h : Math.max(...house.filter((o) => o.x < r.x + r.w - 0.01 && o.x + o.w > r.x + 0.01 && o.z < r.z + r.d - 0.01 && o.z + o.d > r.z + 0.01).map((o) => o.y + o.h));
        const ox = -dx * len * top, oz = -dz * len * top;
        const c = [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d]];
        const hl = hull(c.concat(c.map(([x, z]) => [x + ox, z + oz])));
        const shape = new T.Shape(hl.map(([x, z]) => new T.Vector2(x, z)));
        const geo = new T.ShapeGeometry(shape); geo.rotateX(Math.PI / 2);
        const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 * Math.min(1, deg / 12), depthWrite: false, side: T.DoubleSide }));
        m.position.y = 0.004; shadowGroup.add(m);
      }
    }
    // sun marker + today's path, on a dome around the site
    const R = 26, cx = sunGroup.userData.cx, cz = sunGroup.userData.cz;
    const at = (a, e) => { const [x, z] = planDir(a); return new T.Vector3(cx + x * R * Math.cos(e), Math.max(0, R * Math.sin(e)), cz + z * R * Math.cos(e)); };
    sunMarker.position.copy(at(az, el)); sunMarker.visible = deg > -2;
    sunMarker.material.opacity = 0.35 + 0.5 * dayK;
    const day = new Date(now); day.setHours(0, 0, 0, 0); const pts = [];
    for (let m = 0; m <= 1440; m += 15) { const sp = sunPos(new Date(day.getTime() + m * 60e3)); if (sp.el > 0) pts.push(at(sp.az, sp.el)); }
    sunPath.geometry.dispose(); sunPath.geometry = new T.BufferGeometry().setFromPoints(pts);
    sunPath.material.opacity = 0.08 + 0.12 * dayK;
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
      const isFocus = focused === r, isHover = hovered === r, dim = isDim(r);
      const night = 0.6 + 0.4 * dayK;                         // the model darkens after sunset; lit rooms keep glowing
      const base = new T.Color(0x101517).lerp(new T.Color(C.plate), 0.4 + 0.6 * dayK);
      if (heatMode && r.temp != null && !r.quiet) m.plate.material.color.copy(tempColour(r.temp).multiplyScalar(0.55));
      else m.plate.material.color.copy(base.lerp(lc, r.glow * 0.7));
      let edgeCol = r.climate ? tempColour(r.temp) : new T.Color(C.edge).lerp(new T.Color(C.edgeHot), r.glow * 0.8);
      m.edges.material.color.copy(edgeCol);
      m.edges.material.opacity = dim ? 0.06 : isHover || isFocus ? 0.95 : (r.quiet ? 0.22 : 0.42 + r.glow * 0.4) * (r.glow > 0.05 ? 1 : night);
      m.faces.material.opacity = dim ? 0.01 : isHover || isFocus ? 0.08 : 0.03;
      m.plate.material.opacity = dim ? 0.12 : heatMode && r.temp != null ? 0.8 : 0.62;
      for (const fl of r.furniture || []) fl.material.opacity = dim ? 0.03 : isFocus ? 0.6 : isHover ? 0.45 : 0.28 * night;
    }
  }

  const _wp = { v: null };
  function updateDevices(dt, now) {
    const tmp = _wp.v || (_wp.v = new T.Vector3());
    for (const d of devices) {
      const m = d.mesh; if (!m) continue;
      const st = devState(d); d.st = st;
      m.glow += ((st.active ? 1 : 0) - m.glow) * Math.min(1, dt * 3);      // fade over about a second
      const col = new T.Color(...(st.color || (d.kind === "light" || d.kind === "lamp" ? [1, 0.72, 0.45] : d.kind === "tv" ? [0.62, 0.83, 1] : d.kind === "camera" ? [1, 0.38, 0.32] : [1, 0.64, 0.29])));
      const idle = new T.Color(st.linked ? 0x7d9599 : 0x3c4648);
      const dim = hiddenFloor(d.roomRef.floor) || (whatsOn && !focused && !devActive(d));
      const near = hoveredDev === d || focused === d.roomRef;
      const base = dim ? 0.12 : near ? 1 : 0.8;
      for (const p of m.parts) {
        const w = p.role === "on" ? m.glow : p.role === "off" ? 1 - m.glow : 1;
        p.obj.material.opacity = base * p.k * w;
        p.obj.material.color.copy(p.tint ? idle.clone().lerp(col, m.glow) : idle);
        p.obj.visible = p.obj.material.opacity > 0.005;
      }
      // same size on screen at any zoom; a little bigger under the mouse
      m.core.getWorldPosition(tmp);
      const want = Math.max(0.7, Math.min(2.4, camera.position.distanceTo(tmp) / 26)) * (hoveredDev === d ? 1.45 : 1);
      m.size += (want - m.size) * Math.min(1, dt * 8); m.core.scale.setScalar(m.size);
      if (m.pool) { m.pool.material.color.copy(col); m.pool.material.opacity = dim ? 0 : m.glow * (st.bri ?? 1) * (d.kind === "light" ? 0.28 : 0.22) * (heatMode ? 0.3 : 1); }
    }
  }
  // background that follows the real sky: night navy with stars, a warm glow on the sun's side at dawn and dusk, a pale haze by day
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  function updateSky() {
    if (!skyEl || !sunMarker) return;
    const k = dayK, tw = Math.max(0, 1 - Math.abs(k - 0.35) / 0.35);   // twilight peaks around sunrise/sunset
    const top = mix([4, 7, 12], [10, 22, 30], k), hor = mix(mix([8, 14, 22], [24, 44, 52], k), [78, 46, 28], tw * 0.8);
    const p = sunMarker.getWorldPosition(new T.Vector3()).project(camera);
    const x = Math.max(-10, Math.min(110, (p.x * 0.5 + 0.5) * 100));
    skyEl.style.setProperty("--sky-top", `rgba(${top},.84)`); skyEl.style.setProperty("--sky-hor", `rgba(${hor},.72)`);
    skyEl.style.setProperty("--sky-x", `${x.toFixed(1)}%`); skyEl.style.setProperty("--sky-glow", (0.08 + tw * 0.32 + k * 0.06).toFixed(3));
    skyEl.style.setProperty("--sky-stars", (Math.max(0, 1 - k * 1.6) * 0.8).toFixed(2));
  }
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (plinth) {
      if (!northEl) { northEl = document.createElement("div"); northEl.className = "eddo-house-north"; northEl.textContent = "N"; labelsEl.append(northEl); }
      const p = plinth.north.clone(); pivot.children[0].localToWorld(p); p.project(camera);
      const tf = `translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      if (northEl.style.transform !== tf) northEl.style.transform = tf;
      northEl.dataset.hidden = String(!!(focused || floorSel));
    }
    for (const r of rooms) {
      if (!r.label) continue;
      const p = new T.Vector3(r.x + r.w / 2, r.y + r.h + 0.15, r.z + r.d / 2);
      r.mesh.g.parent.localToWorld(p);
      p.project(camera);
      const vis = p.z < 1 && !hiddenFloor(r.floor) && !(whatsOn && !focused && !roomActive(r));
      const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
      const tf = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (r.label.style.transform !== tf) r.label.style.transform = tf;
      r.label.dataset.hidden = String(!vis);
      r.label.dataset.on = String(r.on > 0);
      r.label.dataset.active = String(hovered === r || focused === r);
      const s = r.label.querySelector("span"), txt = heatMode ? (r.temp != null ? `${r.temp.toFixed(1)}°` : "") : (hovered === r || focused === r) ? roomStatus(r) : "";
      if (s.textContent !== txt) s.textContent = txt;
    }
    for (const d of devices) {
      if (!d.label || !d.mesh) continue;
      const show = hoveredDev === d || focused === d.roomRef || (whatsOn && !focused && devActive(d));
      d.label.dataset.hidden = String(!show);
      if (!show) continue;
      const p = d.mesh.core.getWorldPosition(new T.Vector3()); p.project(camera);
      const tf = `translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      if (d.label.style.transform !== tf) d.label.style.transform = tf;
      d.label.dataset.on = String(!!(d.st && d.st.active)); d.label.dataset.hover = String(hoveredDev === d);
      const s = d.label.querySelector("span"), txt = d.st ? d.st.text : "";
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
    camera.setViewOffset(w * 1.24, h, w * 0.24, 0, w, h);   // centre the model in the free space left of the room list
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
    updateSun(false);
    if (sunMarker) sunMarker.lookAt(camera.position);
    if (shellLines) { const want = focused || floorSel ? 0.035 : whatsOn ? 0.07 : 0.14 * (0.65 + 0.35 * dayK); shellLines.material.opacity += (want - shellLines.material.opacity) * Math.min(1, dt * 4); }
    if (plinth) for (const a of plinth.arcs) a.arc.rotation.y += a.speed * dt;
    if (now - lastSky > 400) { lastSky = now; updateSky(); }
    updateVisuals(dt);
    updateDevices(dt, now);
    renderer.render(scene, camera);
    placeLabels();
  }

  function roomCentre(r) { const p = new T.Vector3(r.x + r.w / 2, r.y + r.h / 2, r.z + r.d / 2); r.mesh.g.parent.localToWorld(p); return p; }
  function focus(r) {
    focused = r || null;
    if (r) whatsOn = false;
    if (!T) return;
    if (!r && floorSel) return setFloor(floorSel);
    view.goal = r ? { target: roomCentre(r), dist: r.floor === "garden" ? 16 : 20, phi: 0.85 } : { target: new T.Vector3(0, 3.2, 0), dist: 52, phi: 0.72 };
    refreshList();
  }

  function setFloor(fl) {
    floorSel = fl || null; focused = null;
    if (!T) return;
    const rs = rooms.filter((r) => !floorSel || r.floor === floorSel);
    const c = rs.map(roomCentre).reduce((a, b) => a.add(b), new T.Vector3()).multiplyScalar(1 / Math.max(1, rs.length));
    view.goal = floorSel ? { target: c, dist: floorSel === "garden" ? 18 : 30, phi: 0.95 } : { target: new T.Vector3(0, 3.2, 0), dist: 52, phi: 0.72 };
    refreshList();
  }
  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    const ray = new T.Raycaster(), v = new T.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    const hits = ray.intersectObjects(rooms.filter((r) => r.mesh && !hiddenFloor(r.floor)).map((r) => r.mesh.faces), false);
    // prefer real rooms over halls/landings
    const hit = hits.find((h) => !h.object.userData.room.quiet) || hits[0];
    return hit ? hit.object.userData.room : null;
  }
  function pickDevice(ev) {
    const rect = canvas.getBoundingClientRect();
    const ray = new T.Raycaster(), v = new T.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    const hits = ray.intersectObjects(devices.filter((d) => d.mesh && !hiddenFloor(d.roomRef.floor)).map((d) => d.mesh.hit), false);
    return hits.length ? hits[0].object.userData.device : null;
  }
  function toggleDevice(d) {
    for (const id of d.ids.filter((x) => /^(light|switch|fan)\./.test(x))) {
      const [domain] = id.split(".");
      HA().send({ type: "call_service", domain, service: "toggle", target: { entity_id: id } }).catch(() => {});
    }
  }
  const call = (domain, service, data) => HA().send({ type: "call_service", domain, service, service_data: data.service_data, target: data.target }).catch(() => {});
  const lightOf = (d) => d.ids.find((id) => id.startsWith("light.") && states.get(id)?.a?.supported_color_modes?.some?.((m) => m !== "onoff"));
  const pendingBri = new Map(); const briTimers = new Map();
  function briPct(id) { if (pendingBri.has(id)) return pendingBri.get(id); const st = states.get(id); return st && st.s === "on" && st.a.brightness != null ? Math.round(st.a.brightness / 2.55) : 0; }
  function setBri(id, pct, now) {
    pct = Math.max(0, Math.min(100, Math.round(pct))); pendingBri.set(id, pct);
    clearTimeout(briTimers.get(id));
    briTimers.set(id, setTimeout(() => {
      pct > 0 ? call("light", "turn_on", { target: { entity_id: id }, service_data: { brightness_pct: pct } }) : call("light", "turn_off", { target: { entity_id: id } });
      setTimeout(() => pendingBri.delete(id), 1500);
    }, now ? 0 : 350));
    refreshList();
  }
  function roomOff(rs) {
    for (const d of devices.filter((x) => rs.includes(x.roomRef) && /light|lamp|fan/.test(x.kind)))
      for (const id of d.ids) { const [dom] = id.split("."); if (/^(light|switch|fan)$/.test(dom) && states.get(id)?.s === "on") call(dom, "turn_off", { target: { entity_id: id } }); }
  }
  function climate(d, delta, power) {
    const id = d.ids.find((x) => x.startsWith("climate.")); if (!id) return;
    const st = states.get(id); if (!st) return;
    if (power) return call("climate", st.s === "off" ? "turn_on" : "turn_off", { target: { entity_id: id } });
    const t = (+st.a.temperature || +st.a.current_temperature || 20) + delta;
    call("climate", "set_temperature", { target: { entity_id: id }, service_data: { temperature: Math.round(t * 2) / 2 } });
  }
  const overUi = (el) => !!(el && el.closest && el.closest(".workbench, .eddo-ha, .eddo-srv, .eddo-quick, .eddo-dlg, .system-footer, .brand, .eddo-cam-overlay, button, a"));
  let lastInput = performance.now();
  function back() { if (focused) focus(null); else if (floorSel || whatsOn) { whatsOn = false; setFloor(null); } }
  setInterval(() => { if (running && !drag && (focused || floorSel || whatsOn) && performance.now() - lastInput > 120000) back(); }, 5000);  // drift home after 2 idle minutes
  function hookInput() {
    const stage = document.querySelector("#stage");
    ["mousemove", "mousedown", "wheel"].forEach((t) => window.addEventListener(t, () => { lastInput = performance.now(); }, { passive: true }));
    stage.addEventListener("contextmenu", (e) => { if (!running || overUi(e.target)) return; e.preventDefault(); back(); });
    window.addEventListener("keydown", (e) => { if (running && e.key === "Escape") back(); });
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
      const ui = overUi(e.target);
      hoveredDev = ui ? null : pickDevice(e);
      hovered = ui ? null : hoveredDev ? hoveredDev.roomRef : pick(e);
    });
    window.addEventListener("mouseup", (e) => {
      if (!running || !drag) return;
      const moved = drag.moved; drag = null;
      if (!moved && !overUi(e.target)) {
        const d = pickDevice(e);
        if (d && focused === d.roomRef && d.cam && window.eddoCams) { window.eddoCams.open(d.cam); return; }
        if (d && canToggle(d) && focused === d.roomRef) { toggleDevice(d); return; }     // click a light in the focused room to switch it
        const r = d ? d.roomRef : pick(e);
        focus(r && r !== focused ? r : null);
      }
    });
    stage.addEventListener("wheel", (e) => {
      if (!running || overUi(e.target)) return;
      const lid = hoveredDev && lightOf(hoveredDev);
      if (lid) { setBri(lid, briPct(lid) + (e.deltaY < 0 ? 5 : -5)); return; }
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
    running = false; hovered = null; hoveredDev = null; drag = null;
    document.querySelector("#stage")?.removeAttribute("data-eddo-house");
  }

  // ------------------------------------------------------------ tab
  let listEl = null, sliding = null;
  const FLOORS = [["", "ALL"], ["ground", "G"], ["first", "1"], ["second", "2"], ["garden", "OFFICE"]];
  function toolbar() {
    const sun = sunInfo ? `<span class="eddo-house-sun" title="Sunrise / sunset">${sunInfo.up ? "☀" : "☾"} ${sunInfo.rise} – ${sunInfo.set}</span>` : "";
    return `<div class="eddo-house-bar"><span class="eddo-house-seg">${FLOORS.map(([id, l]) => `<button data-house-floor="${id}" aria-pressed="${(floorSel || "") === id && !focused}">${l}</button>`).join("")}</span>` +
      `<span class="eddo-house-seg"><button data-house-mode="heat" aria-pressed="${heatMode}">HEAT</button><button data-house-mode="on" aria-pressed="${whatsOn}">WHAT'S ON</button></span></div>` + (sun ? `<p class="eddo-house-sunline">${sun}</p>` : "");
  }
  function devRow(d) {
    const st = d.st || devState(d), i = devices.indexOf(d), lid = lightOf(d), hasClim = d.ids.some((x) => x.startsWith("climate."));
    const action = d.cam ? ` data-house-cam="${d.cam}"` : canToggle(d) ? ` data-house-dev="${i}"` : " data-static";
    let row = `<div class="eddo-house-item" data-on="${st.active}" data-linked="${st.linked}"><button class="eddo-house-row"${action}><i style="--c:${st.active ? "#ffb36b" : "transparent"}"></i><span>${esc(d.name)}</span><em>${esc(d.cam ? "OPEN CAMERA ↗" : st.text)}</em></button>`;
    if (lid) { const pct = briPct(lid); row += `<div class="eddo-house-slider" data-bri="${esc(lid)}" style="--pct:${pct}%"><i></i></div>`; }
    if (hasClim) row += `<div class="eddo-house-clim"><button data-house-clim="${i}:-0.5" aria-label="Lower">−</button><button data-house-clim="${i}:0.5" aria-label="Raise">+</button><button data-house-clim="${i}:power">${st.active ? "TURN OFF" : "TURN ON"}</button></div>`;
    return row + `</div>`;
  }
  function refreshList() {
    if (!listEl || !listEl.isConnected || sliding) return;
    let body;
    if (focused) {
      const ds = devices.filter((d) => d.roomRef === focused);
      const scenes = (focused.sceneNames || []).map(([id, n]) => `<button data-house-scene="${esc(id)}">${esc(n)}</button>`).join("");
      body = `<div class="eddo-house-floor"><p>${esc(focused.floorName.toUpperCase())} · <button class="eddo-house-back" data-house-back>ALL ROOMS ↩</button></p>` +
        `<div class="eddo-house-head"><h3 class="eddo-house-room">${esc(focused.name)}</h3><button class="eddo-house-off" data-house-off="${focused.id}">ALL OFF</button></div>` +
        `<p class="wb-muted eddo-house-sub">${esc(roomStatus(focused))}</p>` + (scenes ? `<div class="eddo-house-scenes">${scenes}</div>` : "") +
        (ds.length ? ds.map(devRow).join("") : `<p class="wb-muted">No devices placed in this room.</p>`) + `</div>` +
        `<p class="wb-muted eddo-house-tip">Drag a slider or scroll on a light to dim it · click empty space to zoom out</p>`;
    } else if (whatsOn) {
      const live = rooms.filter(roomActive);
      body = `<div class="eddo-house-head"><h3 class="eddo-house-room">What's on</h3>${live.length ? `<button class="eddo-house-off" data-house-off="*">ALL LIGHTS OFF</button>` : ""}</div>` +
        (live.length ? live.map((r) => `<div class="eddo-house-floor"><p>${esc(r.name.toUpperCase())} · <button class="eddo-house-back" data-house-off="${r.id}">ALL OFF</button></p>` +
          devices.filter((d) => d.roomRef === r && devActive(d)).map(devRow).join("") + `</div>`).join("") : `<p class="wb-muted">Everything's off.</p>`);
    } else {
      const groups = [...new Set(rooms.filter((r) => !floorSel || r.floor === floorSel).map((r) => r.floorName))];
      body = groups.map((gname) => `<div class="eddo-house-floor"><p>${esc(gname.toUpperCase())}</p>` +
        rooms.filter((r) => r.floorName === gname && !r.quiet).map((r) =>
          `<div class="eddo-house-item" data-on="${r.on > 0}"><button class="eddo-house-row" data-house-room="${r.id}"><i style="--c:rgb(${r.color.map((v) => Math.round(v * 255)).join(",")})"></i><span>${esc(r.name)}</span><em>${esc(heatMode ? (r.temp != null ? r.temp.toFixed(1) + "°" : "—") : roomStatus(r))}</em></button></div>`).join("") + `</div>`).join("") +
        `<p class="wb-muted eddo-house-tip">Drag to turn · scroll to zoom · click a room to control it</p>`;
    }
    const html = toolbar() + body;
    if (listEl.innerHTML !== html) listEl.innerHTML = html;
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !running) return;
    const q = (sel) => e.target.closest(sel);
    let b;
    if ((b = q("[data-house-floor]"))) { whatsOn = false; return setFloor(b.dataset.houseFloor); }
    if ((b = q("[data-house-mode]"))) {
      if (b.dataset.houseMode === "heat") heatMode = !heatMode;
      else { whatsOn = !whatsOn; if (whatsOn) { focused = null; floorSel = null; setFloor(null); } }
      return refreshList();
    }
    if (q("[data-house-back]") && !q("[data-house-off]")) return focus(null);
    if ((b = q("[data-house-off]"))) { const id = b.dataset.houseOff; roomOff(id === "*" ? rooms : rooms.filter((r) => r.id === id)); return; }
    if ((b = q("[data-house-scene]"))) return call("scene", "turn_on", { target: { entity_id: b.dataset.houseScene } });
    if ((b = q("[data-house-cam]"))) { window.eddoCams && window.eddoCams.open(b.dataset.houseCam); return; }
    if ((b = q("[data-house-clim]"))) { const [i, v] = b.dataset.houseClim.split(":"); return climate(devices[+i], v === "power" ? 0 : +v, v === "power"); }
    if ((b = q("[data-house-dev]"))) { const d = devices[+b.dataset.houseDev]; if (d && canToggle(d)) toggleDevice(d); return; }
    if ((b = q("[data-house-room]"))) { const r = rooms.find((x) => x.id === b.dataset.houseRoom); if (r && renderer) focus(focused === r ? null : r); }
  });
  // brightness sliders in the panel (drag), and scroll over any light row
  document.addEventListener("mousedown", (e) => {
    const sl = e.target.closest && e.target.closest(".eddo-house-slider"); if (!sl || !running) return;
    e.preventDefault(); sliding = sl; slideTo(e);
  }, true);
  function slideTo(e) {
    const r = sliding.getBoundingClientRect(), pct = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    sliding.style.setProperty("--pct", pct.toFixed(0) + "%"); sliding.dataset.pct = pct.toFixed(0);
  }
  window.addEventListener("mousemove", (e) => { if (sliding) slideTo(e); });
  window.addEventListener("mouseup", () => { if (!sliding) return; const sl = sliding; sliding = null; setBri(sl.dataset.bri, +sl.dataset.pct, true); });
  document.addEventListener("wheel", (e) => {
    const it = e.target.closest && e.target.closest(".eddo-house-item"); if (!it || !running) return;
    const sl = it.querySelector(".eddo-house-slider"); if (!sl) return;
    e.preventDefault(); setBri(sl.dataset.bri, briPct(sl.dataset.bri) + (e.deltaY < 0 ? 5 : -5));
  }, { passive: false });
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
