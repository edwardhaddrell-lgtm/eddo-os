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
  const EN = {};
  const CAR = { ids: {}, open: false, mesh: null };   // the car out front   // Octopus Energy entity ids, found when Home Assistant connects
  const num = (id) => { const st = id && states.get(id); return st && Number.isFinite(+st.s) ? +st.s : null; };
  const watts = (id) => { const st = id && states.get(id); if (!st || !Number.isFinite(+st.s)) return null; return /kW/i.test(st.a.unit_of_measurement || "") ? +st.s * 1000 : +st.s; };
  const devWatts = (d) => { const w = (d.powerIds || []).map(watts).filter((v) => v != null); return w.length ? w.reduce((a, b) => a + b, 0) : null; };
  let dirty = true;
  const devices = (H.devices || []).map((d) => ({ ...d, ids: [], roomRef: rooms.find((r) => r.id === d.room) })).filter((d) => d.roomRef);
  const KIND_DOMAINS = { light: ["light", "switch"], lamp: ["light", "switch"], appliance: ["switch", "water_heater", "binary_sensor", "select", "sensor"], tv: ["media_player"],
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
        (dom === "sensor" && (st.attributes.device_class === "temperature" || st.attributes.device_class === "humidity"));
      if (useful) room.ents.add(x.entity_id);
    }
    rooms.forEach((r) => { if (r.climate && stMap.has(r.climate)) r.ents.add(r.climate); });
    // devices: explicit entity ids first, else the first unused entity whose name matches
    const used = new Set();
    for (const d of devices) {
      d.ids = [d.entity, ...(d.entities || [])].filter((id) => id && (stMap.has(id) || id.startsWith("media_player.")));   // media players (e.g. Plex) may only appear while playing
      if (!d.ids.length && d.match) {
        const doms = d.domains || KIND_DOMAINS[d.kind] || [];
        const hits = allStates.filter((st) => {
          if (used.has(st.entity_id) || (doms.length && !doms.includes(st.entity_id.split(".")[0]))) return false;
          const t = (st.entity_id.replace(/_/g, " ") + " " + (st.attributes.friendly_name || "")).toLowerCase();
          return d.match.some((m) => t.includes(m)) && !(d.not || []).some((m) => t.includes(m));
        });
        // prefer something you can switch over a reading: the earlier domains in the list win,
        // and among sensors a power reading beats energy totals and the like
        const rank = (st) => { const dom = st.entity_id.split(".")[0], i = doms.length ? doms.indexOf(dom) : 0; return i * 10 + (dom === "sensor" && !/power|watt|status|state/i.test(st.entity_id) ? 5 : 0); };
        const hit = hits.sort((a, b) => rank(a) - rank(b))[0];
        if (hit) {
          d.ids = [hit.entity_id];
          const pw = hits.find((st) => st !== hit && /power|watt/i.test(st.entity_id) && st.entity_id.startsWith("sensor."));
          if (pw && /^switch\./.test(hit.entity_id)) d.ids.push(pw.entity_id);   // a smart plug's power reading shows when it's actually running
        }
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
    // energy: Octopus Energy integration sensors (BottlecapDave), and power readings for devices and rooms
    const findE = (re) => { const x = allStates.find((st) => re.test(st.entity_id) && !/_export_/.test(st.entity_id)); return x ? x.entity_id : null; };
    const el = "^sensor\\.octopus_energy_electricity_.+_";
    Object.assign(EN, {
      demand: findE(new RegExp(el + "current_demand$")), kwh: findE(new RegExp(el + "current_accumulative_consumption$")),
      cost: findE(new RegExp(el + "current_accumulative_cost$")), rate: findE(new RegExp(el + "current_rate$")), next: findE(new RegExp(el + "next_rate$")),
      yKwh: findE(new RegExp(el + "previous_accumulative_consumption$")), yCost: findE(new RegExp(el + "previous_accumulative_cost$")),
      rates: findE(/^event\.octopus_energy_electricity_.+_current_day_rates$/),
      gasKwh: findE(/^sensor\.octopus_energy_gas_.+_current_accumulative_consumption(_kwh)?$/), gasCost: findE(/^sensor\.octopus_energy_gas_.+_current_accumulative_cost$/),
      gasRate: findE(/^sensor\.octopus_energy_gas_.+_current_rate$/),
      gasYKwh: findE(/^sensor\.octopus_energy_gas_.+_previous_accumulative_consumption(_kwh)?$/), gasYCost: findE(/^sensor\.octopus_energy_gas_.+_previous_accumulative_cost$/),
    });
    const isPower = (st) => st && st.entity_id.startsWith("sensor.") && (st.attributes.device_class === "power" || /^k?W$/.test(st.attributes.unit_of_measurement || "")) && !/octopus_energy/.test(st.entity_id);
    const entDev = new Map(ents.map((x) => [x.entity_id, x.device_id]));
    for (const d of devices) {   // a power sensor on the same Home Assistant device as the thing it measures
      d.powerIds = d.ids.filter((id) => isPower(stMap.get(id)));
      const dev = d.ids.map((id) => entDev.get(id)).find(Boolean);
      if (dev) for (const x of ents) if (x.device_id === dev && !d.powerIds.includes(x.entity_id) && isPower(stMap.get(x.entity_id))) d.powerIds.push(x.entity_id);
    }
    const taken = new Set(devices.flatMap((d) => d.powerIds));
    KIT.ids = discoverKit(allStates, ents);
    rooms.forEach((r) => { r.powerIds = []; });
    for (const x of ents) {
      if (x.disabled_by || taken.has(x.entity_id) || !isPower(stMap.get(x.entity_id))) continue;
      const an = areaName.get(x.area_id || devArea.get(x.device_id)); if (!an) continue;
      const room = rooms.find((r) => (r.areas || []).some((a) => a.toLowerCase() === an)); if (room) room.powerIds.push(x.entity_id);
    }
    // the car: Home Assistant companion app sensors ("Car fuel", "Car battery", "Car range remaining" …), plus its location
    const carIds = {}, carKeys = { fuel: /_car_fuel$/, battery: /_car_battery$/, range: /_car_range_remaining$/, odometer: /_car_odometer$/, charging: /_car_charging_status$/, connector: /_car_ev_connector_type$/, fueltype: /_car_fuel_type$/, name: /_car_name$/ };
    for (const [k, re] of Object.entries(carKeys)) { const st = allStates.find((x) => x.entity_id.startsWith("sensor.") && re.test(x.entity_id)); if (st) carIds[k] = st.entity_id; }
    if (H.car && H.car.entities) Object.assign(carIds, H.car.entities);
    // the official Volvo integration: richer and more reliable than the companion app, so its readings win
    const vol = ents.filter((x) => x.platform === "volvo" && !x.disabled_by && stMap.has(x.entity_id));
    const V = { doors: [], windows: [], tyres: [], warn: [], btn: {}, all: vol.map((x) => x.entity_id) };
    const VK = { battery: /battery_charge_level$/, rangeEv: /distance_to_empty_battery$|electric_range$|battery_range$|ev_range$/, rangeFuel: /distance_to_empty_tank$|distance_to_empty_fuel$|fuel_range$|tank_range$|^distance_to_empty$/, fuelL: /fuel_amount$/, odometer: /odometer$/,
      charging: /charging_status$/, connector: /charging_connection_status$/, chargeEta: /estimated_charging_time$/, chargePower: /charging_power$/, chargeTarget: /target_battery_charge_level$/,
      serviceDist: /distance_to_service$/, engineHours: /engine_(time|hours)_to_service$/, tripAuto: /trip_meter_automatic$/, tripManual: /trip_meter_manual$/, avgSpeed: /average_speed$/, serviceTime: /^time_to_service$|[^_]time_to_service$/, avgFuel: /average_fuel_consumption$/, avgEnergy: /average_energy_consumption$/, connection: /car_connection$|availability$/ };
    for (const x of vol) {
      const dom = x.entity_id.split(".")[0], k = String(x.translation_key || x.entity_id.split(".")[1]).toLowerCase(), st = stMap.get(x.entity_id);
      if (dom === "sensor") {
        let hit = false; for (const [n, re] of Object.entries(VK)) if (!V[n] && re.test(k)) { V[n] = x.entity_id; hit = true; break; }
        // fall back to the name for the two ranges ("Distance to empty tank", "Fuel range", "Electric range" …)
        const nm = (k + " " + String(st.attributes.friendly_name || "")).toLowerCase().replace(/_/g, " "), dist = /^(km|mi|m)$/i.test(st.attributes.unit_of_measurement || "");
        if (!hit && dist && !V.rangeFuel && /(empty|range).*(tank|fuel|petrol)|(tank|fuel|petrol).*(range|empty)/.test(nm)) V.rangeFuel = x.entity_id;
        else if (!hit && dist && !V.rangeEv && /(empty|range).*(battery|electric)|(battery|electric).*(range|empty)/.test(nm)) V.rangeEv = x.entity_id;
      }
      else if (dom === "lock") V.lock = V.lock || x.entity_id;
      else if (dom === "device_tracker") V.tracker = V.tracker || x.entity_id;
      else if (dom === "binary_sensor") {
        if (/door|hood|tailgate|tank_lid|bonnet/.test(k)) V.doors.push(x.entity_id);
        else if (/window|sunroof/.test(k)) V.windows.push(x.entity_id);
        else if (/tyre|tire/.test(k)) V.tyres.push(x.entity_id);
        else if (/engine_status|engine_running|^engine$/.test(k) || st.attributes.device_class === "running") V.engine = V.engine || x.entity_id;
        else if (st.attributes.device_class === "problem" || /fluid|service|light|warning|coolant|oil/.test(k)) V.warn.push(x.entity_id);
      } else if (dom === "button") {
        if (/climat\w*start|start\w*climat/.test(k)) V.btn.climaStart = x.entity_id; else if (/climat\w*stop|stop\w*climat/.test(k)) V.btn.climaStop = x.entity_id;
        else if (/flash/.test(k)) V.btn.flash = x.entity_id;
      }
    }
    CAR.V = V;
    for (const k of ["battery", "odometer", "charging", "connector", "tracker"]) if (V[k]) carIds[k] = V[k];
    const carDev = Object.values(carIds).map((id) => entDev.get(id)).find(Boolean);
    if (carDev) {
      const tr = ents.find((x) => x.device_id === carDev && x.entity_id.startsWith("device_tracker.")); if (tr && !carIds.tracker) carIds.tracker = tr.entity_id;
      const geo = ents.find((x) => x.device_id === carDev && /geocoded_location$/.test(x.entity_id)); if (geo && !carIds.place) carIds.place = geo.entity_id;
    }
    CAR.ids = carIds;
    const liveIds = discoverLive(allStates, ents, areaName, devArea);
    const ids = [...new Set([...rooms.flatMap((r) => [...r.ents, ...r.powerIds]), ...devices.flatMap((d) => [...d.ids, ...d.powerIds]), ...Object.values(EN).filter((v) => typeof v === "string"), ...Object.values(carIds), ...((CAR.V && CAR.V.all) || []), ...liveIds, ...(KIT.ids || [])])];
    states.clear();
    ids.forEach((id) => { const s = stMap.get(id); if (s) states.set(id, { s: s.state, a: s.attributes, t: Date.parse(s.last_updated) || 0 }); });
    rooms.forEach(evalRoom); rooms.forEach(borrowTemp); dirty = true;
    if (ids.length) HA().subscribe({ type: "subscribe_entities", entity_ids: ids }, onEntities).catch(() => {});
  });
  function onEntities(ev) {
    for (const [id, v] of Object.entries(ev.a || {})) states.set(id, { s: v.s, a: v.a || {}, t: (v.lu || v.lc || 0) * 1000 });
    for (const [id, v] of Object.entries(ev.c || {})) {
      const cur = states.get(id) || { s: "", a: {} };
      if (v["+"]) { if ("s" in v["+"]) cur.s = v["+"].s; if (v["+"].a) Object.assign(cur.a, v["+"].a); cur.t = (v["+"].lu || v["+"].lc || 0) * 1000 || Date.now(); }
      states.set(id, cur);
    }
    rooms.forEach(evalRoom); rooms.forEach(borrowTemp); dirty = true;
  }
  // Plex makes a media player per client only while it's in use, so look for new ones every 20 s while the tab is open
  // and hang any that are playing on the TV marked plexAny (the Frame).
  let plexPoll = -1e9;
  function pollPlex(now) {
    if (now - plexPoll < 20000 || !HA() || !HA().send) return; plexPoll = now;
    const tv = devices.find((d) => d.plexAny); if (!tv) return;
    HA().send({ type: "get_states" }).then((all) => {
      for (const st of all || []) if (states.has(st.entity_id) && st.entity_id.startsWith("media_player.")) states.set(st.entity_id, { s: st.state, a: st.attributes, t: Date.parse(st.last_updated) || Date.now() });
      const fresh = (all || []).filter((st) => /^media_player\.plex_/.test(st.entity_id) && /^(playing|paused)$/.test(st.state) && !devices.some((d) => d.ids.includes(st.entity_id)));
      if (!fresh.length) { dirty = true; return; }
      const ids = fresh.map((st) => st.entity_id);
      fresh.forEach((st) => states.set(st.entity_id, { s: st.state, a: st.attributes, t: Date.parse(st.last_updated) || Date.now() }));
      tv.ids = [...tv.ids, ...ids];
      const pl = LIVE.players.find((p) => p.dev === tv);
      if (pl) pl.ids.push(...ids); else { LIVE.players.push({ dev: tv, roomRef: tv.roomRef, ids, k: 0 }); LIVE.needBuild = true; }
      HA().subscribe({ type: "subscribe_entities", entity_ids: ids }, onEntities).catch(() => {});
      dirty = true;
    }).catch(() => {});
  }

  // a room without its own sensor can show another room's temperature (tempFrom: "<room id>")
  function borrowTemp(r) {
    if (!r.tempFrom || r.temp != null) return;
    const src = rooms.find((x) => x.id === r.tempFrom); if (!src || src.temp == null) return;
    r.temp = src.temp; r.hum = src.hum; r.tempId = src.tempId; r.tempVia = src.name;
  }
  function evalRoom(r) {
    let on = 0, bri = 0, rgb = [0, 0, 0], n = 0, temp = null, hum = null, target = null, action = null, tempId = null;
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
      if (dom === "climate") {
        if (Number.isFinite(+st.a.current_temperature)) { temp = +st.a.current_temperature; tempId = id; }
        if (st.s !== "off" && Number.isFinite(+st.a.temperature)) target = +st.a.temperature;
        if (Number.isFinite(+st.a.current_humidity)) hum = +st.a.current_humidity;
        action = st.a.hvac_action || (st.s === "off" ? "off" : null);
      }
      if (dom === "sensor" && Number.isFinite(+st.s)) {
        const dc = st.a.device_class;
        if (dc === "humidity") { if (hum == null) hum = +st.s; }
        else if (temp == null && (dc === "temperature" || !dc)) { temp = +st.s; tempId = id; }
      }
    }
    r.on = on; r.bri = bri; r.temp = temp; r.hum = hum; r.target = target; r.action = action; r.tempId = tempId;
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
        active = active || !/^(off|standby|unavailable|unknown)$/.test(s);
        if (!/PLAYING/.test(text) && (s === "playing" || !text || /^(OFF|STANDBY|UNAVAILABLE|UNKNOWN)$/.test(text))) text = s.toUpperCase();
      } else if (dom === "camera") {
        active = s !== "unavailable"; text = "CAMERA"; color = [0.82, 0.24, 0.17];
      } else {
        const isPow = Number.isFinite(+s) && /power|watt/i.test(id);
        active = active || /^(on|running|printing|prepare|washing|drying|active|heat|cool|playing|brewing|ready)$/i.test(s) || (isPow && +s > 5);
        const t = isPow ? `${Math.round(+s)} W` : s.replace(/_/g, " ").toUpperCase();
        text = text ? `${text} · ${t}` : t;
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
  let wxEl = null;
  let skyEl = null, plinth = null, northEl = null, lastSky = 0;
  let T = null, renderer, scene, camera, pivot, canvas, labelsEl, running = false, building = null;
  let anim = null, orbitMode = "drift", tour = null;
  const HOME = { dist: 52, phi: 0.72 };
  // ease the camera to a new view; theta (the turn) is optional and takes the short way round
  function goTo(goal, dur = 1200) {
    const from = { target: view.target ? view.target.clone() : goal.target.clone(), dist: view.dist, phi: view.phi, theta: view.theta };
    let dTheta = null;
    if (goal.theta != null) { dTheta = ((goal.theta - view.theta) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI; }
    view.goal = { target: goal.target, dist: goal.dist, phi: goal.phi };
    anim = view.target ? { from, dTheta, t0: performance.now(), dur } : null;
  }
  const view = { theta: -0.75, phi: 0.72, dist: 52, target: null, goal: null, t0: performance.now() };
  let focused = null, hovered = null, hoveredDev = null, drag = null, lastFrame = 0;
  let energyMode = false;
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
      wxEl = document.createElement("canvas"); wxEl.className = "eddo-house-wx";
      if (anchor) { anchor.after(skyEl); skyEl.after(wxEl); wxEl.after(canvas); canvas.after(labelsEl); } else { stage.prepend(labelsEl); stage.prepend(canvas); stage.prepend(skyEl); }
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0);
      scene = new T.Scene(); scene.fog = new T.Fog(0x070b10, 40, 80);   // far lines fade into the background
      camera = new T.PerspectiveCamera(30, 16 / 9, 0.1, 400);
      pivot = new T.Group(); scene.add(pivot);
      buildModel();
      view.target = new T.Vector3(0, 3.2, 0); view.goal = { target: view.target.clone(), dist: view.dist, phi: view.phi };
      hookInput();
      return true;
    })();
    return building;
  }

  // a room with a sloping ceiling at the street side (loft rooms under the roof): a prism, centred like a box
  // ---- the car: a stylised plug-in hybrid SUV at real size (4.71 m long, 1.90 m wide, 1.66 m tall),
  // proportions taken from side, front and back photos. Drawn in outline like the house; no badges.
  function buildCar(root) {
    const cfg = H.car || {}, at = cfg.at || { x: 2.3, z: -4.8 }, heading = cfg.heading ?? Math.PI;   // kerbside, along the road
    const g = new T.Group(); g.position.set(at.x, 0, at.z); g.rotation.y = heading; root.add(g);
    const seg = [], det = [], L = (a, b, out = seg) => out.push(...a, ...b);
    const poly = (pts, out = seg, close = false) => { for (let i = 0; i < pts.length - 1; i++) L(pts[i], pts[i + 1], out); if (close) L(pts[pts.length - 1], pts[0], out); };
    const W = 0.95, Wg = 0.74, len = 4.71, cx = len / 2;   // half width of body and of the glasshouse
    const X = (x) => x - cx;   // centre the car on its group
    // side profile (x from the front, y up), read off the side photo
    const body = [[0.02, 0.33], [0, 0.55], [0.06, 0.78], [0.35, 0.86], [1.0, 0.95], [1.5, 1.03]];          // nose and bonnet
    const glassFront = [[1.5, 1.03], [2.12, 1.6]], roof = [[2.12, 1.6], [3.4, 1.63], [4.32, 1.6], [4.55, 1.55]];
    const rear = [[4.55, 1.55], [4.66, 1.2], [4.71, 0.95], [4.7, 0.5], [4.62, 0.33]];
    const sill = [[4.62, 0.33], [4.28, 0.33], [3.37, 0.33], [1.4, 0.33], [0.5, 0.33], [0.02, 0.33]];
    for (const side of [-1, 1]) {
      const zb = side * W, zg = side * Wg, P = (pts, z) => pts.map(([x, y]) => [X(x), y, z]);
      poly(P(body, zb)); poly(P(rear, zb));
      poly(P(glassFront, zg)); poly(P(roof, zg));
      L([X(1.5), 1.03, zb], [X(1.5), 1.03, zg]); L([X(4.55), 1.55, zg], [X(4.55), 1.55, zb]);        // shoulder in to the glass
      // windows: beltline, pillars, door cuts and the body crease
      poly(P([[1.62, 1.07], [2.75, 1.1], [3.65, 1.13], [4.42, 1.2]], zb + side * -0.02));
      for (const [x0, y0, x1, y1] of [[2.72, 1.1, 2.68, 1.57], [3.64, 1.13, 3.62, 1.6], [4.38, 1.2, 4.3, 1.55]]) L([X(x0), y0, zb - side * 0.06], [X(x1), y1, zg + side * 0.03], det);
      for (const x of [2.62, 3.6]) L([X(x), 0.38, zb], [X(x + 0.02), 1.08, zb], det);
      poly(P([[0.5, 0.86], [2.4, 0.92], [4.5, 0.98]], zb), det);
      // wheel arches and sill
      const arch = (wx) => { const pts = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; pts.push([X(wx) + Math.cos(a) * 0.46, 0.33 + Math.sin(a) * 0.46 * 0.9, zb]); } return pts; };
      poly(arch(0.95)); poly(arch(3.815));
      poly([[X(0.02), 0.33, zb], [X(0.49), 0.33, zb]]); poly([[X(1.41), 0.33, zb], [X(3.355), 0.33, zb]]); poly([[X(4.275), 0.33, zb], [X(4.62), 0.33, zb]]);
      // mirror
      poly([[X(1.62), 1.0, zb], [X(1.75), 1.08, zb + side * 0.18], [X(1.88), 1.04, zb + side * 0.18], [X(1.78), 0.98, zb]], det, true);
      // wheels: tyre, rim and a few spokes (20" wheels, ~0.74 m tyres)
      for (const wx of [0.95, 3.815]) {
        const z = side * 0.83;
        for (const [r, out] of [[0.37, seg], [0.26, det]]) { const pts = []; for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2; pts.push([X(wx) + Math.cos(a) * r, 0.37 + Math.sin(a) * r, z]); } poly(pts, out); }
        for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; L([X(wx), 0.37, z], [X(wx) + Math.cos(a) * 0.26, 0.37 + Math.sin(a) * 0.26, z], det); }
      }
    }
    // across the car: nose, windscreen, roof edges, rear screen, tail
    for (const [x, y, w] of [[0, 0.55, W], [0.06, 0.78, W], [1.5, 1.03, Wg], [2.12, 1.6, Wg], [4.32, 1.6, Wg], [4.55, 1.55, Wg], [4.71, 0.95, W], [4.7, 0.5, W]]) L([X(x), y, -w], [X(x), y, w]);
    for (const z of [-0.55, 0.55]) poly([[X(2.3), 1.66, z], [X(4.25), 1.66, z]], det);   // roof rails
    poly([[X(0.04), 0.62, -0.42], [X(0.04), 0.62, 0.42], [X(0.06), 0.82, 0.42], [X(0.06), 0.82, -0.42]], det, true);   // grille
    poly([[X(4.68), 0.95, -0.55], [X(4.68), 0.95, 0.55], [X(4.66), 0.62, 0.55], [X(4.66), 0.62, -0.55]], det, true);  // tailgate panel
    const geo = (pts) => { const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); return gg; };
    // the real car's outline (edges of a 3D model, interior and badges removed) replaces the hand-drawn one when present
    const M = window.EDDO_CAR_MODEL, dec = (k) => {
      if (!M || !M.groups[k]) return [];
      const bin = atob(M.groups[k]), q = new Int16Array(bin.length / 2);
      for (let i = 0; i < q.length; i++) q[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16;
      const out = new Array(q.length), f = M.span / 65535;
      for (let i = 0; i < q.length; i += 3) {   // model: x across, y up, front at +z  →  car group: front at -x
        const mx = (q[i] + 32768) * f + M.min[0], my = (q[i + 1] + 32768) * f + M.min[1], mz = (q[i + 2] + 32768) * f + M.min[2];
        out[i] = -mz; out[i + 1] = my; out[i + 2] = mx;
      }
      return out;
    };
    if (M) { g.scale.setScalar(1.15); seg.length = 0; det.length = 0; seg.push(...dec("body"), ...dec("glass")); det.push(...dec("wheels")); }   // a touch larger, to sit in proportion with the house
    const lines = new T.LineSegments(geo(seg), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.55, depthWrite: false }));
    const detail = new T.LineSegments(geo(det), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.3, depthWrite: false }));
    g.add(lines, detail);
    // lights: slim front lamps and tall rear lamps, glowing softly
    const lamp = (pts, col) => { const l = new T.LineSegments(geo(pts), new T.LineBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending })); g.add(l); return l; };
    const fl = [], rl = [];
    for (const side of [-1, 1]) {
      fl.push(X(0.05), 0.82, side * 0.58, X(0.12), 0.84, side * 0.86);
      rl.push(X(4.68), 1.3, side * 0.82, X(4.7), 0.9, side * 0.86, X(4.7), 0.9, side * 0.86, X(4.69), 0.85, side * 0.55);
    }
    const front = lamp(M ? dec("front") : fl, 0xe8f4ff), back = lamp(M ? dec("rear") : rl, 0xff4a3a);
    // charging: a glowing line along the side that pulses while it's plugged in
    const chg = lamp([X(0.6), 0.6, W + 0.01, X(4.3), 0.66, W + 0.01, X(0.6), 0.6, -W - 0.01, X(4.3), 0.66, -W - 0.01], 0x5fe0a8);
    // shadow on the road and a click target
    const shadow = new T.Mesh(new T.PlaneGeometry(4.9, 2.1), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; g.add(shadow);
    const hit = new T.Mesh(new T.BoxGeometry(4.8, 1.7, 2.0), new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.y = 0.85; g.add(hit);
    // road edge (kerb) and a faint centre line, so it reads as the street
    const kz = at.z + 1.25, road = [];
    road.push(-1.5, 0.01, kz, 6.5, 0.01, kz);
    for (let x = -1.5; x < 6.5; x += 1.2) road.push(x, 0.01, at.z - 2.4, x + 0.6, 0.01, at.z - 2.4);
    root.add(new T.LineSegments(geo(road), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.12, depthWrite: false })));
    CAR.mesh = { g, lines, detail, front, back, chg, hit, shadow, glow: 0, dense: !!M };
  }
  // car readings, in friendly units
  // health checks the Volvo integration reports (each a "problem" sensor that turns on when something needs attention)
  const HEALTH = [["OIL", /oil/], ["COOLANT", /coolant/], ["BRAKE FLUID", /brake.?fluid/], ["WASHER FLUID", /washer/], ["SERVICE", /service/], ["BULBS", /light|bulb|lamp|indicator|beam|fog/]];
  function carData() {
    const I = CAR.ids, V = CAR.V || { doors: [], windows: [], tyres: [], warn: [], btn: {} };
    // the car app only reports while it's connected (driving), and goes "unavailable" when parked:
    // use the last good reading from history then (CAR.last, filled by loadCarHistory)
    const sv = (id) => { if (!id) return null; const x = states.get(id); if (x && !/^(unknown|unavailable)$/.test(x.s)) return x; return (CAR.last && CAR.last[id]) || x; };
    const st = (k) => sv(I[k] || V[k]);
    const live = (x) => x && !/^(unknown|unavailable)$/.test(x.s);
    const pct = (k) => { const x = st(k); return live(x) && Number.isFinite(+x.s) ? Math.round(+x.s) : null; };
    const milesOf = (x) => { if (!live(x) || !Number.isFinite(+x.s)) return null; const u = String(x.a.unit_of_measurement || "m").toLowerCase(); const v = +x.s; return Math.round(u === "mi" ? v : u === "km" ? v * 0.621371 : v / 1609.34); };
    const miles = (k) => milesOf(st(k));
    const word = (k) => { const x = st(k); return live(x) ? String(x.s) : null; };
    const label = (id) => { const x = sv(id); return String((x && x.a.friendly_name) || id.split(".")[1]).replace(/^(volvo\s+)?(xc\d+|v\d+|s\d+|ex\d+|c\d+)\s+/i, "").replace(/_/g, " "); };
    const onIds = (list) => list.filter((id) => { const x = sv(id); return x && x.s === "on"; });
    const tr = st("tracker"), home = tr ? tr.s === "home" : true;
    const conn = word("connector") || "", chg = word("charging") || "";
    const charging = /^(charging|true|on)$/i.test(chg);
    const plugged = charging || (/connected|plugged|done|complete/i.test(conn || chg) && !/disconnected|unplugged|not/i.test(conn || chg));
    const fuelL = (() => { const x = sv(V.fuelL); return live(x) && Number.isFinite(+x.s) ? +x.s : null; })();
    const tank = (H.car && H.car.tank) || 71;   // XC60 T8 tank, litres
    let fuel = pct("fuel"); if (fuel == null && fuelL != null) fuel = Math.max(0, Math.min(100, Math.round(fuelL / tank * 100)));
    const rangeEv = milesOf(sv(V.rangeEv)), rangeFuel = milesOf(sv(V.rangeFuel));
    const appRange = miles("range");   // the car app's "range remaining" (kept as a fallback)
    // range comes from the car app's "range remaining" first; the Volvo readings only fill in if it has none
    const range = appRange != null ? appRange : rangeEv != null || rangeFuel != null ? (rangeEv || 0) + (rangeFuel || 0) : null;
    const lk = sv(V.lock), locked = live(lk) ? lk.s === "locked" : null;
    const allIds = [...Object.values(I), ...(V.all || [])], last = Math.max(0, ...allIds.map((id) => (sv(id) || {}).t || 0));
    const svc = sv(V.serviceTime);
    const fuelRange = appRange != null ? appRange : rangeFuel;
    return { fuel, fuelL, battery: pct("battery"), range, rangeEv, rangeFuel, appRange, fuelRange, odometer: miles("odometer"), charging, plugged, chargeText: chg || null, connector: conn || null,
      chargeEta: word("chargeEta") && V.chargeEta ? `${sv(V.chargeEta).s} ${sv(V.chargeEta).a.unit_of_measurement || ""}`.trim() : null,
      chargePower: V.chargePower && live(sv(V.chargePower)) ? `${sv(V.chargePower).s} ${sv(V.chargePower).a.unit_of_measurement || ""}`.trim() : null,
      locked, openDoors: onIds(V.doors).map(label), openWindows: onIds(V.windows).map(label), tyreWarn: onIds(V.tyres).map(label), warnings: onIds(V.warn).map(label),
      serviceMiles: milesOf(sv(V.serviceDist)), serviceTime: live(svc) ? `${svc.s} ${svc.a.unit_of_measurement || ""}`.trim() : null,
      avgFuel: V.avgFuel && live(sv(V.avgFuel)) ? `${sv(V.avgFuel).s} ${sv(V.avgFuel).a.unit_of_measurement || ""}`.trim() : null,
      btn: V.btn, lockId: V.lock || null, volvo: !!(V.all && V.all.length),
      health: HEALTH.map(([name, re]) => { const ids = (V.warn || []).filter((id) => re.test(id + " " + String((sv(id) || { a: {} }).a.friendly_name || "").toLowerCase())); return ids.length ? { name, ok: !onIds(ids).length, bad: onIds(ids).map(label) } : null; }).filter(Boolean),
      engine: V.engine && live(sv(V.engine)) ? sv(V.engine).s === "on" : null,
      engineHours: V.engineHours && live(sv(V.engineHours)) ? `${sv(V.engineHours).s} ${sv(V.engineHours).a.unit_of_measurement || "h"}` : null,
      trip: milesOf(sv(V.tripAuto)), tripManual: milesOf(sv(V.tripManual)),
      avgSpeed: (() => { const x = sv(V.avgSpeed); if (!live(x) || !Number.isFinite(+x.s)) return null; const u = String(x.a.unit_of_measurement || "").toLowerCase(); return Math.round(/km/.test(u) ? +x.s * 0.621371 : +x.s) + " mph"; })(),
      home, where: word("place") || (tr && tr.s !== "home" ? tr.s : null), name: word("name") || (H.car && H.car.name) || "XC60", last, linked: Object.keys(I).length > 0 || !!(V.all && V.all.length) };
  }
  async function loadCarHistory() {
    if (CAR.histBusy || !HA() || Date.now() - (CAR.histAt || 0) < 10 * 60e3) return;
    const ids = [...new Set([...Object.values(CAR.ids || {}), ...["battery", "fuelL", "rangeEv", "rangeFuel", "odometer"].map((k) => CAR.V && CAR.V[k])].filter((id) => id && id.startsWith("sensor.")))];
    const stale = ids.filter((id) => { const x = states.get(id); return !x || /^(unknown|unavailable)$/.test(x.s); });
    CAR.histAt = Date.now(); if (!stale.length) return;
    CAR.histBusy = true;
    try {
      const res = await HA().send({ type: "history/history_during_period", start_time: new Date(Date.now() - 14 * 864e5).toISOString(), entity_ids: stale, minimal_response: false, no_attributes: false, significant_changes_only: false });
      CAR.last = CAR.last || {};
      for (const id of stale) {
        const rows = (res || {})[id] || []; let unit = null;
        for (const r of rows) if (r.a && r.a.unit_of_measurement) unit = r.a.unit_of_measurement;
        for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if (r.s != null && !/^(unknown|unavailable)$/.test(r.s)) { CAR.last[id] = { s: r.s, a: { ...(r.a || {}), unit_of_measurement: (r.a && r.a.unit_of_measurement) || unit }, t: ((r.lu ?? r.lc) || 0) * 1000 }; break; } }
      }
    } catch (_) {}
    CAR.histBusy = false; refreshList();
  }
  function updateCar(dt, now) {
    if (CAR.mesh) loadCarHistory();
    const m = CAR.mesh; if (!m) return;
    const c = carData(), strip = heatMode || energyMode, ghost = !c.home;
    const base = (strip ? 0.08 : ghost ? 0.18 : CAR.open || CAR.hover ? 0.95 : 0.55) * (m.dense ? 0.6 : 1);   // the detailed outline has many more lines
    m.lines.material.opacity += (base - m.lines.material.opacity) * Math.min(1, dt * 4);
    m.detail.material.opacity = m.lines.material.opacity * 0.55;
    m.shadow.material.opacity = ghost || strip ? 0 : 0.22 * (0.5 + 0.5 * dayK);
    const lit = !ghost && !strip ? 1 : 0; m.glow += (lit - m.glow) * Math.min(1, dt * 2);
    m.front.material.opacity = (m.dense ? 0.35 : 0.55) * m.glow * (0.4 + 0.6 * (1 - dayK)); m.back.material.opacity = (m.dense ? 0.45 : 0.6) * m.glow * (0.4 + 0.6 * (1 - dayK));
    m.chg.material.opacity = c.plugged && !strip ? (c.charging ? 0.35 + 0.35 * Math.sin(now / 600) : 0.25) : 0;
    const low = (c.fuel != null && c.fuel < 15) || (c.battery != null && c.battery < 10 && !c.plugged) || c.openDoors.length > 0 || c.locked === false && c.home;
    m.lines.material.color.set(low ? 0xffa64a : C.edge);
  }
  function slopeGeo(w, h, d, knee, run) {
    const P = [[-d / 2, -h / 2], [-d / 2, -h / 2 + knee], [-d / 2 + run, h / 2], [d / 2, h / 2], [d / 2, -h / 2]];
    const pos = [], uv = [];
    const tri = (a, b, c, ua, ub, uc) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
    for (let i = 0; i < P.length; i++) {            // walls, floor and ceiling: one quad per edge of the profile
      const [z0, y0] = P[i], [z1, y1] = P[(i + 1) % P.length];
      const a = [-w / 2, y0, z0], b = [w / 2, y0, z0], c = [w / 2, y1, z1], e = [-w / 2, y1, z1];
      tri(a, b, c, [0, 0], [1, 0], [1, 1]); tri(a, c, e, [0, 0], [1, 1], [0, 1]);
    }
    for (const x of [-w / 2, w / 2]) {                // the two side walls, fanned from the first corner
      const q = P.map(([z, y]) => [x, y, z]), quv = P.map(([z, y]) => [(z + d / 2) / d, (y + h / 2) / h]);
      for (let i = 1; i < P.length - 1; i++) tri(q[0], q[i], q[i + 1], quv[0], quv[i], quv[i + 1]);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    return g;
  }
  // ceiling height at a point in a room (z from the room's front wall)
  const ceilAt = (r, z) => r.slope ? Math.min(r.h, r.slope.knee + (r.h - r.slope.knee) * Math.max(0, z) / r.slope.run) : r.h;
  // walls glow at their edges and stay clear in the middle
  let _edgeTex = null;
  function edgeTex() {
    if (_edgeTex) return _edgeTex;
    const N = 128, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const e = Math.min(x, y, N - 1 - x, N - 1 - y) / (N / 2);   // 0 at the edge, 1 in the middle
      const a = Math.pow(1 - e, 3.2) * 0.95 + 0.05;
      const i = (y * N + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * a); img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return (_edgeTex = new T.CanvasTexture(cv));
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
      const box = r.slope ? slopeGeo(r.w, r.h, r.d, r.slope.knee, r.slope.run) : new T.BoxGeometry(r.w, r.h, r.d);
      const faces = new T.Mesh(box, new T.MeshBasicMaterial({ color: C.face, map: edgeTex(), transparent: true, opacity: 0.12, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }));
      faces.position.y = r.h / 2; faces.userData.room = r; g.add(faces);
      const edges = new T.LineSegments(new T.EdgesGeometry(box), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: r.quiet ? 0.22 : 0.42 }));
      edges.position.y = r.h / 2; g.add(edges);
      if (r.roof) {   // pitched roof: ridge down the middle, gable ends; shares the wall lines' material so it lights and fades with them
        const o = r.roof.overhang ?? 0.12, rh = r.roof.rise || 0.6, alongX = r.roof.ridge !== "z";
        const hw = r.w / 2 + o, hd = r.d / 2 + o, y0 = r.h, y1 = r.h + rh, pts = [];
        const L = (a, c) => pts.push(...a, ...c);
        if (alongX) {
          L([-hw, y1, 0], [hw, y1, 0]);
          for (const x of [-hw, hw]) { L([x, y0, -hd], [x, y1, 0]); L([x, y1, 0], [x, y0, hd]); L([x, y0, -hd], [x, y0, hd]); }
          for (const z of [-hd, hd]) L([-hw, y0, z], [hw, y0, z]);
          for (let t = 0.25; t < 1; t += 0.25) for (const sz of [-1, 1]) { const x = -hw + 2 * hw * t; L([x, y0, sz * hd], [x, y1, 0]); }
        } else {
          L([0, y1, -hd], [0, y1, hd]);
          for (const z of [-hd, hd]) { L([-hw, y0, z], [0, y1, z]); L([0, y1, z], [hw, y0, z]); L([-hw, y0, z], [hw, y0, z]); }
          for (const x of [-hw, hw]) L([x, y0, -hd], [x, y0, hd]);
          for (let t = 0.25; t < 1; t += 0.25) for (const sx of [-1, 1]) { const z = -hd + 2 * hd * t; L([sx * hw, y0, z], [0, y1, z]); }
        }
        const rg = new T.BufferGeometry(); rg.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
        r.roofLines = new T.LineSegments(rg, new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.42 })); g.add(r.roofLines);
      }
      if (r.bay) {   // bay window on the living room front
        const bw = Math.min(2.4, r.w - 0.6), bd = 0.45, bh = 2.0;
        const bay = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(bw, bh, bd)), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.35 }));
        bay.position.set(0, bh / 2, -r.d / 2 - bd / 2); g.add(bay);
      }
      r.mesh = { g, plate, glow, faces, edges, warm: 0 };
    }
    // outline of the whole building: walls, roof, chimneys, windows, porch (detail lines are fainter)
    if (H.shell) {
      const S = H.shell, seg = [], det = [];
      const L = (a, b, out = seg) => out.push(...a, ...b);
      const box = (x0, x1, z0, z1, y0, y1, out = seg) => {
        const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
        c.forEach(([x, z], i) => { const [nx, nz] = c[(i + 1) % 4]; L([x, y0, z], [nx, y0, nz], out); L([x, y1, z], [nx, y1, nz], out); L([x, y0, z], [x, y1, z], out); });
      };
      const rect = (pts, out = seg) => pts.forEach((p, i) => L(p, pts[(i + 1) % pts.length], out));
      const m = S.main;
      if (m) {
        box(m.x0, m.x1, m.z0, m.z1, 0, m.eaves);
        L([m.x0, m.ridge, m.ridgeZ], [m.x1, m.ridge, m.ridgeZ]);                                  // ridge
        const ov = 0.28;                                                                          // eaves overhang + fascia
        L([m.x0, m.eaves, m.z0 - ov], [m.x1, m.eaves, m.z0 - ov]); L([m.x0, m.eaves - 0.22, m.z0 - ov], [m.x1, m.eaves - 0.22, m.z0 - ov]);
        for (const x of [m.x0, m.x1]) { L([x, m.eaves, m.z0 - ov], [x, m.ridge, m.ridgeZ]); L([x, m.eaves - 0.22, m.z0 - ov], [x, m.eaves, m.z0 - ov]); }
        if (!S.dormer) for (const x of [m.x0, m.x1]) L([x, m.ridge, m.ridgeZ], [x, m.eaves, m.z1]);
        // tile courses on the front slope
        const slope = (x, t) => [x, m.eaves + (m.ridge - m.eaves) * t, (m.z0 - ov) + (m.ridgeZ - m.z0 + ov) * t];
        for (let t = 0.14; t < 0.97; t += 0.14) L(slope(m.x0, t), slope(m.x1, t), det);
        for (const r of S.rooflights || []) rect([slope(r.x0, r.t0), slope(r.x1, r.t0), slope(r.x1, r.t1), slope(r.x0, r.t1)]);
      }
      if (S.dormer) { const d = S.dormer, y0 = m ? m.eaves : 0;
        if (d.slope && m) {   // its roof falls gently from the main ridge to the back wall
          const yf = m.ridge, c = [[d.x0, d.z0, yf], [d.x1, d.z0, yf], [d.x1, d.z1, d.top], [d.x0, d.z1, d.top]];
          c.forEach(([x, z, y], i) => { const [nx, nz, ny] = c[(i + 1) % 4]; L([x, y0, z], [nx, y0, nz]); L([x, y, z], [nx, ny, nz]); L([x, y0, z], [x, y, z]); });
        } else box(d.x0, d.x1, d.z0, d.z1, y0, d.top);
      }
      for (const c of S.chimneys || []) {
        const base = (m ? m.ridge : 8) - 1.2; box(c.x0, c.x1, c.z0, c.z1, base, c.top);
        box(c.x0 - 0.05, c.x1 + 0.05, c.z0 - 0.05, c.z1 + 0.05, c.top - 0.25, c.top - 0.1, det);   // corbel band
        const n = c.pots || 0, pw = Math.min(0.2, (c.x1 - c.x0) / (n + 1)), zc = (c.z0 + c.z1) / 2;
        for (let i = 0; i < n; i++) { const xc = c.x0 + (c.x1 - c.x0) * (i + 1) / (n + 1); box(xc - pw / 2, xc + pw / 2, zc - pw / 2, zc + pw / 2, c.top, c.top + 0.45 + (i % 2) * 0.1); }
      }
      if (S.outrigger) { const o = S.outrigger, mx = (o.x0 + o.x1) / 2; box(o.x0, o.x1, o.z0, o.z1, 0, o.eaves);
        L([mx, o.ridge, o.z0], [mx, o.ridge, o.z1]); for (const z of [o.z1]) { L([o.x0, o.eaves, z], [mx, o.ridge, z]); L([mx, o.ridge, z], [o.x1, o.eaves, z]); } }
      if (S.extension) { const e = S.extension;
        box(e.x0, e.x1, e.z0, e.z1, 0, e.low);
        L([e.x0, e.high, e.z0], [e.x1, e.high, e.z0]); L([e.x0, e.high, e.z0], [e.x0, e.low, e.z1]); L([e.x1, e.high, e.z0], [e.x1, e.low, e.z1]); }
      if (S.bay) { const b = S.bay, z = -b.depth, rz = 0, hi = 0.35;
        box(b.x0, b.x1, z, 0, 0, b.top);
        // hipped tiled roof: eaves overhang round the bay, a short ridge against the wall
        const o = 0.15, e = [[b.x0 - o, z - o], [b.x1 + o, z - o], [b.x1 + o, rz], [b.x0 - o, rz]];
        L([e[0][0], b.top, e[0][1]], [e[1][0], b.top, e[1][1]]); L([e[0][0], b.top, e[0][1]], [e[3][0], b.top, e[3][1]]); L([e[1][0], b.top, e[1][1]], [e[2][0], b.top, e[2][1]]);
        L([b.x0 + hi, b.roof, rz], [b.x1 - hi, b.roof, rz]); L([e[0][0], b.top, e[0][1]], [b.x0 + hi, b.roof, rz]); L([e[1][0], b.top, e[1][1]], [b.x1 - hi, b.roof, rz]);
        L([e[3][0], b.top, rz], [b.x0 + hi, b.roof, rz]); L([e[2][0], b.top, rz], [b.x1 - hi, b.roof, rz]);
        for (let t = 0.33; t < 0.9; t += 0.33) L([e[0][0] + (b.x0 + hi - e[0][0]) * t, b.top + (b.roof - b.top) * t, e[0][1] + (rz - e[0][1]) * t], [e[1][0] + (b.x1 - hi - e[1][0]) * t, b.top + (b.roof - b.top) * t, e[1][1] + (rz - e[1][1]) * t], det);
        // the bay's sash windows
        const wy0 = 0.55, wy1 = b.top - 0.15, wx0 = b.x0 + 0.12, wx1 = b.x1 - 0.12, mid = (wx0 + wx1) / 2;
        rect([[wx0, wy0, z], [wx1, wy0, z], [wx1, wy1, z], [wx0, wy1, z]]);
        L([mid, wy0, z], [mid, wy1, z], det); L([wx0, (wy0 + wy1) / 2, z], [wx1, (wy0 + wy1) / 2, z], det);
        L([b.x0 - 0.05, wy0 - 0.05, z - 0.05], [b.x1 + 0.05, wy0 - 0.05, z - 0.05], det);    // sill
      }
      for (const w of S.windows || []) {
        const z = w.face === "rear" ? (S.dormer ? S.dormer.z1 : m.z1) : (m ? m.z0 : 0);
        rect([[w.x0, w.y0, z], [w.x1, w.y0, z], [w.x1, w.y1, z], [w.x0, w.y1, z]]);
        const my = (w.y0 + w.y1) / 2, mx = (w.x0 + w.x1) / 2;
        if (w.sash) { L([w.x0, my, z], [w.x1, my, z], det); if (!w.single) L([mx, w.y0, z], [mx, w.y1, z], det); }
        else L([mx, w.y0, z], [mx, w.y1, z], det);
        L([w.x0 - 0.06, w.y0 - 0.05, z], [w.x1 + 0.06, w.y0 - 0.05, z], det);           // sill
      }
      if (S.door) { const d = S.door, z = m ? m.z0 : 0, r = (d.x1 - d.x0) / 2, cx = (d.x0 + d.x1) / 2, dz = z + d.recess;
        const arc = (zz, out) => { let prev = null; for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16, p = [cx + Math.cos(a) * r, d.spring + Math.sin(a) * r, zz]; if (prev) L(prev, p, out); prev = p; } };
        arc(z, seg); arc(z - 0.06, det);                                                          // the white arch moulding
        for (const x of [d.x0, d.x1]) { L([x, 0, z], [x, d.spring, z]); L([x, 0, z], [x, 0, dz], det); L([x, d.spring, z], [x, d.spring, dz], det); }
        const f0 = cx - 0.42, f1 = cx + 0.42;                                                     // door, set back in the porch
        rect([[f0, 0, dz], [f1, 0, dz], [f1, 2.05, dz], [f0, 2.05, dz]]);
        rect([[f0 + 0.12, 1.1, dz], [cx - 0.05, 1.1, dz], [cx - 0.05, 1.85, dz], [f0 + 0.12, 1.85, dz]], det);
        rect([[cx + 0.05, 1.1, dz], [f1 - 0.12, 1.1, dz], [f1 - 0.12, 1.85, dz], [cx + 0.05, 1.85, dz]], det);
        // tiled path out to the pavement
        const pz = S.frontWall ? S.frontWall.z : -1.7;
        rect([[d.x0, 0.01, pz], [d.x1 + 0.2, 0.01, pz], [d.x1 + 0.2, 0.01, z], [d.x0, 0.01, z]], det);
        for (let t = 0.25; t < 1; t += 0.25) { const zz = pz + (z - pz) * t; L([d.x0, 0.01, zz], [d.x1 + 0.2, 0.01, zz], det); }
      }
      if (S.downpipe && m) { const x = S.downpipe.x, z = m.z0 - 0.04; L([x, 0, z], [x, m.eaves - 0.2, z], det); L([x, m.eaves - 0.2, z], [x, m.eaves - 0.2, z - 0.25], det); }
      if (S.frontWall) { const f = S.frontWall;
        L([f.x0, 0, f.z], [f.x1, 0, f.z]); L([f.x0, f.h, f.z], [f.x1, f.h, f.z]); L([f.x0, f.h - 0.15, f.z], [f.x1, f.h - 0.15, f.z], det);
        L([f.x0, 0, f.z], [f.x0, 0, m ? m.z0 - 0.5 : 0], det);
        for (const x of f.piers || []) box(x, x + 0.3, f.z - 0.05, f.z + 0.25, 0, f.h + 0.15);
      }
      // finished roofs: faint filled slopes (tiles as courses), so the house reads as solid from above
      { const rf = [];
        const face = (pts) => { for (let i = 1; i + 1 < pts.length; i++) rf.push(...pts[0], ...pts[i], ...pts[i + 1]); };
        const courses = (a0, a1, b0, b1, step) => {   // lines across a quad from edge a (eaves) to edge b (ridge)
          const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]), n = Math.max(2, Math.round(len / step));
          const lerp = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
          for (let i = 1; i < n; i++) L(lerp(a0, b0, i / n), lerp(a1, b1, i / n), det);
        };
        const ov = 0.28;
        if (m) {
          face([[m.x0, m.eaves, m.z0 - ov], [m.x1, m.eaves, m.z0 - ov], [m.x1, m.ridge, m.ridgeZ], [m.x0, m.ridge, m.ridgeZ]]);
          if (S.dormer && S.dormer.slope) { const d = S.dormer, b0 = [m.x0, m.ridge, m.ridgeZ], b1 = [m.x1, m.ridge, m.ridgeZ], a0 = [m.x0, d.top, d.z1 + 0.12], a1 = [m.x1, d.top, d.z1 + 0.12];
            face([b0, b1, a1, a0]);   // the back roof: a shallow slope from the ridge to the back wall
            L(a0, a1); L([m.x0, d.top - 0.18, d.z1 + 0.12], [m.x1, d.top - 0.18, d.z1 + 0.12], det);   // fascia
            courses(a0, a1, b0, b1, 0.5);
            for (const x of [m.x0, m.x1]) face([[x, m.eaves, m.z0], [x, m.ridge, m.ridgeZ], [x, d.top, m.z1], [x, m.eaves, m.z1]]);   // gable walls
          } else if (S.dormer) { const d = S.dormer;
            face([[d.x0, d.top, d.z0], [d.x1, d.top, d.z0], [d.x1, d.top, d.z1 + 0.1], [d.x0, d.top, d.z1 + 0.1]]);
            for (const x of [m.x0, m.x1]) face([[x, m.eaves, m.z0], [x, m.ridge, m.ridgeZ], [x, d.top, d.z0], [x, d.top, m.z1], [x, m.eaves, m.z1]]);
          } else {
            face([[m.x0, m.ridge, m.ridgeZ], [m.x1, m.ridge, m.ridgeZ], [m.x1, m.eaves, m.z1 + ov], [m.x0, m.eaves, m.z1 + ov]]);
            courses([m.x0, m.eaves, m.z1 + ov], [m.x1, m.eaves, m.z1 + ov], [m.x0, m.ridge, m.ridgeZ], [m.x1, m.ridge, m.ridgeZ], 0.45);
          }
        }
        if (S.outrigger) { const o = S.outrigger, mx = (o.x0 + o.x1) / 2, e = 0.2;
          const l0 = [o.x0 - e, o.eaves - 0.1, o.z0], l1 = [o.x0 - e, o.eaves - 0.1, o.z1 + e], r0 = [o.x1 + e, o.eaves - 0.1, o.z0], r1 = [o.x1 + e, o.eaves - 0.1, o.z1 + e], t0 = [mx, o.ridge, o.z0], t1 = [mx, o.ridge, o.z1 + e];
          face([l0, l1, t1, t0]); face([r0, r1, t1, t0]); face([[o.x0, o.eaves, o.z1], [mx, o.ridge, o.z1], [o.x1, o.eaves, o.z1]]);
          L(l0, l1); L(r0, r1); L(l1, t1); L(t1, r1); L(t0, t1);
          courses(l0, l1, t0, t1, 0.3); courses(r0, r1, t0, t1, 0.3);
        }
        if (S.extension) { const x = S.extension, e = 0.15;
          const a0 = [x.x0 - e, x.low - 0.05, x.z1 + e], a1 = [x.x1, x.low - 0.05, x.z1 + e], b0 = [x.x0 - e, x.high, x.z0], b1 = [x.x1, x.high, x.z0];
          face([a0, a1, b1, b0]); L(a0, a1); L(a0, b0); L([a0[0], a0[1] - 0.18, a0[2]], [a1[0], a1[1] - 0.18, a1[2]], det);   // gutter line
          courses(a0, a1, b0, b1, 0.25);
        }
        if (S.bay) { const b = S.bay, z = -b.depth, o = 0.15, hi = 0.35;
          const e0 = [b.x0 - o, b.top, z - o], e1 = [b.x1 + o, b.top, z - o], e2 = [b.x1 + o, b.top, 0], e3 = [b.x0 - o, b.top, 0], r0 = [b.x0 + hi, b.roof, 0], r1 = [b.x1 - hi, b.roof, 0];
          face([e0, e1, r1, r0]); face([e0, r0, e3]); face([e1, e2, r1]);
        }
        const rg = new T.BufferGeometry(); rg.setAttribute("position", new T.Float32BufferAttribute(rf, 3));
        shellRoof = new T.Mesh(rg, new T.MeshBasicMaterial({ color: C.face, transparent: true, opacity: 0.08, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
        root.add(shellRoof);
      }
      if (H.garden) { const G = H.garden;
        for (const poly of G.decks || []) {
          const P = poly.map(([x, z]) => [x, 0.06, z]); rect(P);
          // boards: lines along z, clipped to the deck's outline
          const xs = poly.map((p) => p[0]), step = G.boardStep || 0.3;
          for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
            const hits = [];
            poly.forEach(([x1, z1], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; if ((x1 <= x && x2 > x) || (x2 <= x && x1 > x)) hits.push(z1 + (x - x1) / (x2 - x1) * (z2 - z1)); });
            hits.sort((p, q) => p - q); for (let i = 0; i + 1 < hits.length; i += 2) L([x, 0.06, hits[i]], [x, 0.06, hits[i + 1]], det);
          }
        }
        for (const it of G.items || []) {
          const { x0, x1, z0, z1 } = it, h = it.h || 0.8, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          if (it.kind === "rotary") {   // rotary washing line: pole and four arms
            const r = it.r || 1.2, top = it.h || 1.9;
            L([it.x, 0, it.z], [it.x, top, it.z]);
            const ring = []; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; ring.push([it.x + Math.cos(a) * r, top - 0.2, it.z + Math.sin(a) * r]); L([it.x, top, it.z], ring[i], det); L([it.x, top - 0.9, it.z], ring[i], det); }
            rect(ring, det);
          } else if (it.kind === "tree") {   // canopy as a few stacked rings on a trunk (its own group, so the wind can sway it)
            const r = it.r || 1.5, y0 = it.y0 || 1.6, top = it.h || 4, tp = [];
            tp.push(0, 0, 0, 0, y0, 0);
            for (const [t, k] of [[0, 0.6], [0.3, 1], [0.65, 0.85], [1, 0.4]]) {
              const y = y0 + (top - y0) * t, rr = r * k;
              for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2, b2 = (i + 1) / 20 * Math.PI * 2; tp.push(Math.cos(a) * rr, y, Math.sin(a) * rr, Math.cos(b2) * rr, y, Math.sin(b2) * rr); }
            }
            LIVE.treeDefs.push({ x: it.x, z: it.z, pts: tp });
          } else if (it.kind === "bbq") {   // kettle-ish grill under its cover: body, rounded lid, legs
            box(x0, x1, z0, z1, 0.25, h - 0.25, det);
            for (const zz of [z0, z1]) { let prev = null; for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8, p = [cx + Math.cos(a) * (x1 - x0) / 2, h - 0.25 + Math.sin(a) * 0.25, zz]; if (prev) L(prev, p, det); prev = p; } }
            L([x0, h - 0.25, z0], [x0, h - 0.25, z1], det); L([x1, h - 0.25, z0], [x1, h - 0.25, z1], det); L([cx, h, z0], [cx, h, z1], det);
          } else if (it.kind === "chair") {
            box(x0, x1, z0, z1, 0, 0.45, det); box(x0, x1, z1 - 0.05, z1, 0.45, h, det);
          } else {   // covered furniture, planters, storage: a soft box (top edges pulled in)
            box(x0, x1, z0, z1, 0, h * 0.85, det);
            const i = Math.min(0.12, (x1 - x0) / 4); box(x0 + i, x1 - i, z0 + i, z1 - i, h * 0.85, h, det);
          }
        }
      }
      const mk = (pts) => { const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); return gg; };
      shellLines = new T.LineSegments(mk(seg), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.3, depthWrite: false }));
      shellDetail = new T.LineSegments(mk(det), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.16, depthWrite: false }));
      root.add(shellLines); root.add(shellDetail);
      buildCar(root);
    }

    // daylight objects live in the model's own coordinates (so plan north works)
    sunGroup = new T.Group(); sunGroup.userData = { cx: maxX / 2, cz: maxZ / 2 }; root.add(sunGroup);
    shadowGroup = new T.Group(); shadowGroup.visible = false; root.add(shadowGroup);   // sun shadows off: they read oddly on the outline model
    sunMarker = new T.Mesh(new T.CircleGeometry(0.55, 24), new T.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    sunGroup.add(sunMarker);
    sunPath = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.15 }));
    sunGroup.add(sunPath);
    updateSun(true);
    buildLive(root, maxX, maxZ);

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
        const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].flatMap(([a, b]) => [a, f.y || 0.06, b]);
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
      } else if (kind === "stairs") {   // a straight flight rising from v0 to v1, with a handrail on the u0 side
        const n = f.steps || 13, rise = (f.h || 2.6) / n, run = (z1 - z0) / n, pts = [];
        const P = (a, c) => pts.push(...a, ...c);
        for (let i = 0; i < n; i++) {
          const za = z0 + i * run, zb = za + run, yb = y + i * rise, yt = yb + rise;
          P([x0, yb, za], [x1, yb, za]); P([x0, yb, za], [x0, yt, za]); P([x1, yb, za], [x1, yt, za]);   // riser
          P([x0, yt, za], [x1, yt, za]); P([x0, yt, za], [x0, yt, zb]); P([x1, yt, za], [x1, yt, zb]);   // tread
          if (i < n - 1) for (const xx of [x0 + 0.04]) P([xx, yt, za + run / 2], [xx, yt + 0.9, za + run / 2]);   // spindles
        }
        P([x0, y, z0], [x0, y, z1]); P([x0, y, z1], [x0, y + n * rise, z1]); P([x1, y, z0], [x1, y, z1]);   // stringer + under-stairs
        const hx = x0 + 0.04; P([hx, y + rise + 0.9, z0 + run / 2], [hx, y + n * rise + 0.9, z1]);   // handrail
        P([hx, y, z0], [hx, y + rise + 1.0, z0]);   // newel post
        const gg = new T.BufferGeometry(); gg.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
        const l = new T.LineSegments(gg, furMat()); g.add(l); parts.push(l);
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
    const mat = (o) => new T.MeshBasicMaterial({ color: 0x6f878c, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: T.DoubleSide, fog: false, ...o });
    const lmat = () => new T.LineBasicMaterial({ color: 0x6f878c, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    const segs = (pts) => { const g2 = new T.BufferGeometry(); g2.setAttribute("position", new T.Float32BufferAttribute(pts.flat(), 3)); return g2; };
    for (const d of devices) {
      const r = d.roomRef, g = r.mesh.g;
      const hgt = d.y ?? (d.kind === "climate" && /radiator/i.test(d.name) ? 0.45 : Math.min(KIND_HEIGHT[d.kind] ?? 1, ceilAt(r, d.v * r.d) - 0.2));
      const x = -r.w / 2 + d.u * r.w, z = -r.d / 2 + d.v * r.d;
      const core = new T.Group(); core.position.set(x, hgt, z); core.renderOrder = 20; g.add(core);
      const parts = [];   // role: on = only when running, off = only when idle, both = always; k = opacity
      const add = (obj, role, k, tint = true) => { obj.renderOrder = 20; core.add(obj); parts.push({ obj, role, k, tint }); return obj; };
      const faceCentre = () => { core.rotation.order = "YXZ"; core.rotation.y = Math.atan2(-x, -z); };
      const k = d.kind;
      if (k === "light" || k === "lamp") {
        const rad = k === "light" ? 0.08 : 0.06;
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
        if (d.look) core.rotation.y = Math.atan2((-r.w / 2 + d.look[0] * r.w) - x, (-r.d / 2 + d.look[1] * r.d) - z);   // aimed at a point (same u/v as the room)
        else if (d.u < 0 || d.u > 1 || d.v < 0 || d.v > 1 || d.faceOut) core.rotation.y += Math.PI;   // outdoor cameras look away from the house
      } else if (k === "tv") {
        const [sw, sh] = d.screen || [0.36, 0.21];   // screen: [w, h] in metres = real size on the wall
        add(new T.Mesh(new T.PlaneGeometry(sw, sh), mat()), "on", 0.55);                                        // a screen that lights up
        add(new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(sw, sh)), lmat()), "both", 0.9);
        if (d.screen) core.rotation.y = d.u < 0.5 ? Math.PI / 2 : d.u > 0.5 && d.v > 0.05 && d.v < 0.95 ? -Math.PI / 2 : 0;   // flat on its wall
        else faceCentre();
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
      const hs = d.screen ? Math.max(0.6, ...d.screen) : 0.6, hit = new T.Mesh(new T.BoxGeometry(hs, hs, hs), new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
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
  let shellLines = null, shellDetail = null, shellRoof = null;
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
  const DAMP = 65;   // % relative humidity where mould becomes a risk
  const hist = { at: 0, busy: false, series: new Map() };   // tempId -> [[ms, °C], ...]
  async function loadHistory(force) {
    if (hist.busy || (!force && Date.now() - hist.at < 15 * 60e3) || !HA()) return;
    const ids = [...new Set([...rooms.map((r) => r.tempId), EN.demand, EN.gasKwh].filter(Boolean))]; if (!ids.length) return;
    hist.busy = true;
    const start = new Date(Date.now() - 24 * 3600e3).toISOString();
    const pts = (rows, id) => (rows || []).map((x) => [((x.lu ?? x.lc) || 0) * 1000, id.startsWith("climate.") ? +(x.a && x.a.current_temperature) : +x.s * (id === EN.demand && /kW/i.test((states.get(id)?.a || {}).unit_of_measurement || "") ? 1000 : 1)]).filter(([t, v]) => t && Number.isFinite(v));
    try {
      const sens = ids.filter((id) => !id.startsWith("climate.")), clim = ids.filter((id) => id.startsWith("climate."));
      const [a, b] = await Promise.all([
        sens.length ? HA().send({ type: "history/history_during_period", start_time: start, entity_ids: sens, minimal_response: true, no_attributes: true, significant_changes_only: false }) : {},
        clim.length ? HA().send({ type: "history/history_during_period", start_time: start, entity_ids: clim, minimal_response: false, no_attributes: false, significant_changes_only: false }) : {},
      ]);
      for (const id of ids) { const p = pts((a || {})[id] || (b || {})[id], id); if (p.length) hist.series.set(id, p); }
      hist.at = Date.now();
    } catch (_) {}
    hist.busy = false; refreshList();
  }
  // a small line of the last 24 h, with the overnight low marked
  function spark(r) {
    const p = r.tempId && hist.series.get(r.tempId); if (!p || p.length < 2) return "";
    const now = Date.now(), t0 = now - 24 * 3600e3, W = 92, Hh = 22;
    let all = p.concat([[now, r.temp ?? p[p.length - 1][1]]]).filter(([t]) => t >= t0 - 3600e3);
    if (all.length > 240) {   // busy sensors (live demand) report every few seconds: average into ~6-minute buckets
      const B = new Map(); for (const [t, v] of all) { const k = Math.floor((t - t0) / 360e3), e = B.get(k) || [t, 0, 0]; e[1] += v; e[2]++; B.set(k, e); }
      all = [...B.values()].map(([t, v, n]) => [t, v / n]);
    }
    const vs = all.map(([, v]) => v), lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(1, hi - lo);
    const X = (t) => Math.max(0, (t - t0) / (now - t0)) * W, Y = (v) => Hh - 2 - (v - lo) / span * (Hh - 4);
    let d = "";
    for (const [t, v] of all) d += `${d ? "L" : "M"}${X(t).toFixed(1)} ${Y(v).toFixed(1)}`;
    if (r.tempId === EN.demand) return `<svg class="eddo-heat-spark eddo-en-spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
    const iLo = vs.indexOf(lo);
    return `<svg class="eddo-heat-spark" viewBox="0 0 ${W} ${Hh}" title="Last 24 hours"><path d="${d}"/><circle cx="${X(all[iLo][0]).toFixed(1)}" cy="${Y(lo).toFixed(1)}" r="1.8"/></svg><small class="eddo-heat-range">${lo.toFixed(1)}–${hi.toFixed(1)}°</small>`;
  }
  // today's half-hour prices, from the Octopus "current day rates" event
  function dayRates() {
    const st = EN.rates && states.get(EN.rates), rs = st && st.a && st.a.rates;
    return Array.isArray(rs) ? rs.map((x) => ({ a: Date.parse(x.start), b: Date.parse(x.end), p: +x.value_inc_vat })).filter((x) => x.a && Number.isFinite(x.p)) : [];
  }
  function chart(pts, t0, t1, top, kind, colr) {
    const W = 300, Hh = 64, X = (t) => (t - t0) / (t1 - t0) * W, Y = (v) => Hh - 2 - (v / Math.max(1e-9, top)) * (Hh - 6);
    let g = "";
    if (kind === "area") {
      const line = pts.map(([t, v], i) => `${i ? "L" : "M"}${X(t).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
      g = `<path class="a" d="${line}L${X(pts[pts.length - 1][0]).toFixed(1)} ${Hh}L${X(pts[0][0]).toFixed(1)} ${Hh}Z"/><path class="l" d="${line}"/>`;
    } else {
      const bw = W / 48 - 1;
      g = pts.map(([t, v]) => v > 0 ? `<rect x="${(X(t) - bw / 2).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Hh - Y(v)).toFixed(1)}"/>` : "").join("");
    }
    const nowX = Math.min(W, X(Date.now()));
    const marks = [0, 6, 12, 18, 24].map((hh) => { const t = t0 + hh * 3600e3; return `<span style="left:${(hh / 24 * 100).toFixed(1)}%">${new Date(Math.min(t, t1 - 1)).toTimeString().slice(0, 5)}</span>`; }).join("");
    return `<div class="eddo-en-chart" style="--c:${colr}"><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${(Hh * f).toFixed(1)}" y2="${(Hh * f).toFixed(1)}"/>`).join("")}${g}<line class="now" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="0" y2="${Hh}"/></svg><div class="eddo-en-axis">${marks}</div></div>`;
  }
  function energyPanel() {
    if (!EN.demand && !EN.kwh && !EN.rate) return `<p class="wb-muted">No Octopus Energy readings found. Add the Octopus Energy integration (HACS, by BottlecapDave) to Home Assistant, with the Home Mini option ticked.</p>`;
    const w = watts(EN.demand), rate = num(EN.rate), kwh = num(EN.kwh), cost = num(EN.cost);
    const gbp = (v) => v == null ? "—" : `£${v.toFixed(2)}`;
    const k = wCol(w || 0), c = `rgb(${Math.round(k.r * 255)},${Math.round(k.g * 255)},${Math.round(k.b * 255)})`;
    const perHour = w != null && rate != null ? (w / 1000) * rate : null;
    // electricity: one live number, today's totals, and the last 24 hours
    let h = `<div class="eddo-en-live" style="--c:${c}"><b>${w != null ? fmtW(w) : "—"}</b><span>ELECTRICITY NOW${perHour != null ? ` · ${gbp(perHour)}/H` : ""}</span></div>` +
      `<p class="eddo-en-stats"><span>TODAY <b>${kwh != null ? kwh.toFixed(1) + " kWh" : "—"}</b></span><span><b>${gbp(cost)}</b></span><span>RATE <b>${rate != null ? (rate * 100).toFixed(1) + "p" : "—"}</b></span></p>`;
    const ps = EN.demand && hist.series.get(EN.demand);
    if (ps && ps.length > 2) {
      const t1 = Date.now(), t0 = t1 - 24 * 3600e3, B = new Map();
      for (const [t, v] of ps) if (t >= t0) { const q = Math.floor((t - t0) / 600e3), e = B.get(q) || [0, 0]; e[0] += v; e[1]++; B.set(q, e); }
      const pts = [...B.entries()].sort((a, b) => a[0] - b[0]).map(([q, [v, n]]) => [t0 + (q + 0.5) * 600e3, v / n]);
      if (w != null) pts.push([t1, w]);
      h += chart(pts, t0, t1, Math.max(...pts.map(([, v]) => v)), "area", "#5fe0a8");
    }
    // gas: today's totals, the boiler, and when it was used since midnight
    if (EN.gasKwh || EN.gasCost) {
      const gk = num(EN.gasKwh), gc = num(EN.gasCost), burn = gasBurning();
      h += `<p class="eddo-en-stats eddo-en-gasrow"><span>GAS TODAY <b>${gk != null ? gk.toFixed(1) + " kWh" : "—"}</b></span><span><b>${gbp(gc)}</b></span><span data-on="${!!burn}">${burn ? "BOILER FIRING" : "BOILER IDLE"}</span></p>`;
      const gs = EN.gasKwh && hist.series.get(EN.gasKwh);
      if (gs && gs.length > 1) {
        const mid = new Date(); mid.setHours(0, 0, 0, 0); const t0 = mid.getTime(), t1 = t0 + 24 * 3600e3, slots = new Array(48).fill(0);
        let prev = null;
        for (const [t, v] of gs.filter(([t]) => t >= t0).concat(gk != null ? [[Date.now(), gk]] : [])) { if (prev != null && v >= prev) slots[Math.min(47, Math.floor((t - t0) / 1800e3))] += v - prev; prev = v; }
        const pk = Math.max(...slots);
        if (pk > 0) h += chart(slots.map((v, i) => [t0 + (i + 0.5) * 1800e3, v]), t0, t1, pk, "bars", "#7fb8ff");
      }
    }
    return h;
  }
  function tempColour(t) {   // 16° blue → 21° neutral → 26° amber
    const cold = new T.Color(0x6fa8ff), mid = new T.Color(C.edge), hot = new T.Color(0xffa24a);
    if (t == null) return mid;
    return t < 21 ? cold.lerp(mid, Math.max(0, Math.min(1, (t - 16) / 5))) : mid.lerp(hot, Math.max(0, Math.min(1, (t - 21) / 5)));
  }
  function updateVisuals(dt) {
    for (const r of rooms) {
      const m = r.mesh; if (!m) continue;
      const want = r.on && !heatMode && !energyMode ? 0.16 + 0.3 * r.bri : 0;
      r.glow += (want - r.glow) * Math.min(1, dt * 4);
      const lc = new T.Color(r.color[0], r.color[1], r.color[2]);
      m.glow.material.color.copy(lc); m.glow.material.opacity = r.glow * FLOOR_GLOW * SOLID;
      m.plate.material.color.copy(new T.Color(C.plate).lerp(lc, r.glow * 0.7));
      const isFocus = focused === r, isHover = hovered === r, dim = isDim(r);
      const night = 0.6 + 0.4 * dayK;                         // the model darkens after sunset; lit rooms keep glowing
      const base = new T.Color(0x101517).lerp(new T.Color(C.plate), 0.4 + 0.6 * dayK);
      if (heatMode && r.temp != null && !r.quiet) {
        // heating rooms breathe slowly in warm light; others hold their temperature colour
        const breathe = r.action === "heating" ? 0.5 + 0.5 * Math.sin(performance.now() / 1400) : 0;
        m.plate.material.color.copy(tempColour(r.temp).multiplyScalar(0.5 + 0.15 * breathe));
        m.glow.material.color.copy(new T.Color(0xff8a3d)); m.glow.material.opacity = r.action === "heating" ? 0.05 + 0.1 * breathe : 0;
      }
      else m.plate.material.color.copy(base.lerp(lc, r.glow * 0.7 * FLOOR_GLOW));
      let edgeCol = r.climate ? tempColour(r.temp) : new T.Color(C.edge).lerp(new T.Color(C.edgeHot), r.glow * 0.8);
      m.edges.material.color.copy(edgeCol);
      m.edges.material.opacity = dim ? 0.06 : isHover || isFocus ? 0.95 : (r.quiet ? 0.22 : 0.42 + r.glow * 0.4) * (r.glow > 0.05 ? 1 : night);
      if (r.roofLines) r.roofLines.material.opacity = Math.min(0.6, m.edges.material.opacity);   // roof stays neutral; only the walls take the temperature tint
      m.faces.material.opacity = (dim ? 0.01 : isHover || isFocus ? 0.2 : r.quiet ? 0.03 : 0.07) * SOLID;
      m.plate.material.opacity = (dim ? 0.12 : heatMode && r.temp != null ? 0.8 : 0.62) * SOLID;
      for (const fl of r.furniture || []) fl.material.opacity = heatMode || energyMode ? 0 : dim ? 0.03 : isFocus ? 0.6 : isHover ? 0.45 : 0.28 * night;
    }
  }

  const fmtW = (w) => w == null ? "—" : w >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
  const wCol = (w) => { const k = Math.min(1, Math.log10(1 + (w || 0)) / Math.log10(3000)); return k < 0.5 ? new T.Color(0x5fe0a8).lerp(new T.Color(0xffc25a), k * 2) : new T.Color(0xffc25a).lerp(new T.Color(0xff5a4a), (k - 0.5) * 2); };
  let flow = null;
  // Is the boiler burning gas? The thermostat calling for heat says so straight away; otherwise
  // the gas meter's running total going up in its latest half-hourly reading.
  function gasBurning() {
    if (rooms.some((r) => r.action === "heating")) return "HEATING";
    const gs = EN.gasKwh && hist.series.get(EN.gasKwh), cur = num(EN.gasKwh);
    if (gs && gs.length && cur != null) { const last = gs[gs.length - 1]; if (cur > last[1] + 0.05 && Date.now() - last[0] < 40 * 60e3) return "HOT WATER / HEATING"; }
    return null;
  }
  const BOILER = H.boiler || { room: "bath", u: 0.88, v: 0.9, y: 1.5 };
  let boiler = null, boilerLabel = null;
  function buildBoiler() {
    const r = rooms.find((x) => x.id === BOILER.room); if (!r || !r.mesh || boiler) return;
    const g = new T.Group(); g.position.set(-r.w / 2 + BOILER.u * r.w, BOILER.y, -r.d / 2 + BOILER.v * r.d); r.mesh.g.add(g);
    const box = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(0.42, 0.68, 0.3)), new T.LineBasicMaterial({ color: 0x7fb8ff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    box.position.y = 0.34; g.add(box);
    const mk = (rad, c) => { const m = new T.Mesh(new T.SphereGeometry(rad, 16, 12), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthTest: false, depthWrite: false, fog: false })); m.renderOrder = 23; g.add(m); return m; };
    const outer = mk(0.22, 0xff7a2a), mid = mk(0.14, 0xffa64a), inner = mk(0.07, 0xfff1b0), halo = mk(0.6, 0xff6a20);
    [outer, mid, inner].forEach((m) => { m.position.y = 0.2; }); halo.position.y = 0.25;
    boiler = { g, box, outer, mid, inner, halo, k: 0, r };
  }
  function updateBoiler(dt, now) {
    if (!boiler) { if (!energyMode && !heatMode) return; buildBoiler(); if (!boiler) return; }
    const show = (energyMode || heatMode) && !hiddenFloor(boiler.r.floor), burning = show ? gasBurning() : null;
    boiler.box.material.opacity += ((show ? 0.55 : 0) - boiler.box.material.opacity) * Math.min(1, dt * 4);
    boiler.k += ((burning ? 1 : 0) - boiler.k) * Math.min(1, dt * 1.5);
    // a soft flame: stretched glows that flicker a little
    const f = (a) => 0.85 + 0.15 * Math.sin(now / a) * Math.sin(now / (a * 1.7));
    boiler.outer.scale.set(1, 1.7 * f(130), 1); boiler.mid.scale.set(1, 1.9 * f(97), 1); boiler.inner.scale.set(1, 1.6 * f(71), 1);
    boiler.outer.material.opacity = 0.35 * boiler.k * f(160); boiler.mid.material.opacity = 0.5 * boiler.k * f(110); boiler.inner.material.opacity = 0.85 * boiler.k;
    boiler.halo.material.opacity = 0.08 * boiler.k * f(300);
    boiler.burning = burning;
    if (!boilerLabel && labelsEl) { boilerLabel = document.createElement("div"); boilerLabel.className = "eddo-house-dev eddo-boiler-label"; boilerLabel.innerHTML = "<b>BOILER</b><span></span>"; labelsEl.append(boilerLabel); }
    if (boilerLabel) {
      boilerLabel.dataset.hidden = String(!show);
      if (show) {
        const p = boiler.g.getWorldPosition(new T.Vector3()); p.y += 0.7; p.project(camera);
        boilerLabel.style.transform = `translate(${((p.x * 0.5 + 0.5) * canvas.clientWidth).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * canvas.clientHeight).toFixed(1)}px)`;
        const t = burning ? `FIRING · ${burning}` : "IDLE"; const sp = boilerLabel.querySelector("span"); if (sp.textContent !== t) sp.textContent = t;
        boilerLabel.dataset.on = String(!!burning);
      }
    }
  }
  function buildEnergy() {
    if (flow || !T) return;
    flow = { cols: new Map(), packets: [], meter: null };
    const hall = rooms.find((r) => r.id === "hall") || rooms[0];
    const ring = new T.Mesh(new T.RingGeometry(0.22, 0.3, 32), new T.MeshBasicMaterial({ color: 0x5fe0a8, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: T.DoubleSide, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.08, -hall.d / 2 + 0.35); ring.renderOrder = 21; hall.mesh.g.add(ring);
    const core = new T.Mesh(new T.SphereGeometry(0.11, 14, 10), new T.MeshBasicMaterial({ color: 0x5fe0a8, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
    core.position.set(0, 0.35, -hall.d / 2 + 0.35); core.renderOrder = 21; hall.mesh.g.add(core);
    flow.meter = { ring, core };
    const pg = new T.SphereGeometry(0.05, 8, 6);
    for (let i = 0; i < 72; i++) {
      const m = new T.Mesh(pg, new T.MeshBasicMaterial({ color: 0xffc25a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthTest: false, depthWrite: false, fog: false }));
      m.renderOrder = 22; m.visible = false; scene.add(m); flow.packets.push(m);
    }
    for (const d of devices) {
      if (!d.mesh) continue;
      const col = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0x5fe0a8, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
      const edge = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: 0x5fe0a8, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      const g = new T.Group(); g.add(col, edge); g.position.set(d.mesh.core.position.x, 0, d.mesh.core.position.z); g.scale.set(0.2, 0.001, 0.2); g.visible = false;
      d.roomRef.mesh.g.add(g); flow.cols.set(d, { g, col, edge, h: 0 });
    }
  }
  function updateEnergy(dt, now) {
    if (!flow && !energyMode) return;
    buildEnergy(); if (!flow) return;
    const on = energyMode ? 1 : 0;
    const total = watts(EN.demand);
    const mm = flow.meter; mm.ring.material.opacity += (on * 0.8 - mm.ring.material.opacity) * Math.min(1, dt * 4);
    mm.core.material.opacity = mm.ring.material.opacity * (0.7 + 0.3 * Math.sin(now / 500));
    mm.ring.scale.setScalar(1 + 0.25 * Math.sin(now / 700));
    if (total != null) { const c = wCol(total); mm.ring.material.color.copy(c); mm.core.material.color.copy(c); }
    const meterW = mm.core.getWorldPosition(new T.Vector3());
    let pi = 0;
    for (const [d, c] of flow.cols) {
      const w = energyMode && !hiddenFloor(d.roomRef.floor) ? devWatts(d) : null;
      const want = w != null && w >= 3 ? 0.25 + 1.9 * Math.min(1, Math.log10(1 + w) / Math.log10(3000)) : 0;
      c.h += (want - c.h) * Math.min(1, dt * 3);
      c.g.visible = c.h > 0.01; if (!c.g.visible) continue;
      c.g.scale.y = c.h; c.g.position.y = c.h / 2;
      const col = wCol(w || 0); c.col.material.color.copy(col); c.edge.material.color.copy(col);
      c.col.material.opacity = 0.22 * Math.min(1, c.h * 3); c.edge.material.opacity = 0.75 * Math.min(1, c.h * 3);
      // packets run from the meter to anything drawing power; faster for bigger loads
      if (w != null && w >= 3) {
        const to = d.mesh.core.getWorldPosition(new T.Vector3()), n = w > 800 ? 3 : w > 100 ? 2 : 1, speed = 0.18 + 0.5 * Math.min(1, Math.log10(1 + w) / Math.log10(3000));
        for (let k = 0; k < n && pi < flow.packets.length; k++, pi++) {
          const m = flow.packets[pi], t = ((now / 1000) * speed + k / n + (d.u || 0)) % 1;
          m.position.lerpVectors(meterW, to, t); m.position.y += Math.sin(t * Math.PI) * 0.8;
          m.material.color.copy(col); m.material.opacity = 0.9 * Math.sin(t * Math.PI); m.visible = true;
        }
      }
    }
    for (; pi < flow.packets.length; pi++) flow.packets[pi].visible = false;
  }
  const _wp = { v: null };
  const SOLID = 0.8;   // floors and walls: 20% more see-through
  const FLOOR_GLOW = window.EDDO_WEB ? 0.5 : 1;   // lit floors glow half as strongly on the Mac (its screen makes them look brighter)
  function updateDevices(dt, now) {
    const tmp = _wp.v || (_wp.v = new T.Vector3());
    for (const d of devices) {
      const m = d.mesh; if (!m) continue;
      const st = devState(d); d.st = st;
      // cameras stay red whenever they're linked (a camera that's idle or briefly unavailable is still a camera)
      const lit = d.kind === "camera" ? st.linked && d.ids.length > 0 : st.active;
      m.glow += ((lit ? 1 : 0) - m.glow) * Math.min(1, dt * 3);      // fade over about a second
      const col = new T.Color(...(d.kind === "camera" ? [0.95, 0.26, 0.2] : st.color || (d.kind === "light" || d.kind === "lamp" ? [1, 0.72, 0.45] : d.kind === "tv" ? [0.62, 0.83, 1] : d.kind === "camera" ? [1, 0.38, 0.32] : [1, 0.64, 0.29])));
      const idle = new T.Color(st.linked ? 0x7d9599 : 0x3c4648);
      const dim = hiddenFloor(d.roomRef.floor) || (whatsOn && !focused && !devActive(d));
      const near = hoveredDev === d || focused === d.roomRef;
      const base = heatMode || energyMode ? 0 : dim ? 0.12 : near ? 1 : 0.8;
      for (const p of m.parts) {
        const w = p.role === "on" ? m.glow : p.role === "off" ? 1 - m.glow : 1;
        p.obj.material.opacity = base * p.k * w;
        p.obj.material.color.copy(p.tint ? idle.clone().lerp(col, m.glow) : idle);
        p.obj.visible = p.obj.material.opacity > 0.005;
      }
      // same size on screen at any zoom; a little bigger under the mouse
      m.core.getWorldPosition(tmp);
      const want = d.screen ? (hoveredDev === d ? 1.05 : 1) : Math.max(0.7, Math.min(2.4, camera.position.distanceTo(tmp) / 26)) * (hoveredDev === d ? 1.45 : 1);   // real-size screens stay real size
      m.size += (want - m.size) * Math.min(1, dt * 8); m.core.scale.setScalar(m.size);
      if (m.pool) { m.pool.material.color.copy(col); m.pool.material.opacity = dim || heatMode || energyMode ? 0 : m.glow * (st.bri ?? 1) * (d.kind === "light" ? 0.28 : 0.22) * FLOOR_GLOW; }
    }
  }
  // ---- live weather over the house: clouds, rain, snow, mist and storm glow from the real forecast
  // On by default in the web edition (Mac); add ?wx=rain|snow|storm|cloudy|fog|clear to the address to preview one.
  const wxOn = () => { const p = window.rhineWallpaperHost && window.rhineWallpaperHost.properties, v = p && p.liveweather && p.liveweather.value; return v != null ? v !== false : !!window.EDDO_WEB; };
  const WX_TEST = (location.search.match(/[?&]wx=(\w+)/) || [])[1];
  const WX = { clouds: [], drops: [], flash: 0, nextFlash: 0, sprites: null, last: 0, w: 0, h: 0 };
  function wxState() {
    const o = window.eddoOutside || {}, code = +o.code || 0;
    let s = { cloud: Number.isFinite(+o.cloud) ? +o.cloud : code >= 3 ? 90 : code >= 1 ? 40 : 5, rain: 0, snow: 0, fog: 0, storm: 0, wind: Number.isFinite(+o.wind) ? +o.wind : 8 };
    if (code >= 45 && code <= 48) s.fog = 1;
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) s.rain = Math.max(0.25, Math.min(1, (+o.precip || 0) / 4 + (code >= 63 || code === 81 || code === 82 ? 0.5 : 0.2)));
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) s.snow = Math.max(0.3, Math.min(1, (+o.snow || 0) + 0.4));
    if (code >= 95) { s.rain = 0.9; s.storm = 1; }
    const T = { rain: { cloud: 95, rain: 0.7 }, snow: { cloud: 90, snow: 0.8 }, storm: { cloud: 100, rain: 1, storm: 1, wind: 30 }, cloudy: { cloud: 85, rain: 0, snow: 0 }, fog: { cloud: 70, fog: 1 }, clear: { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0 } }[WX_TEST];
    return T ? { ...s, ...T } : s;
  }
  function cloudSprites() {     // a few soft cloud puffs, drawn once
    const out = [];
    for (let k = 0; k < 5; k++) {
      const c = document.createElement("canvas"); c.width = 420; c.height = 160; const g = c.getContext("2d");
      for (let i = 0; i < 16; i++) {
        const r = 26 + Math.random() * 40, x = r + 4 + Math.random() * (420 - 2 * r - 8), y = 80 + (Math.random() - 0.5) * Math.max(0, 160 - 2 * r - 8);
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(255,255,255,.45)"); gr.addColorStop(0.6, "rgba(255,255,255,.18)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      out.push(c);
    }
    return out;
  }
  function drawWeather(now) {
    if (!wxEl) return;
    const on = wxOn() || !!WX_TEST;
    wxEl.style.display = on ? "" : "none"; if (!on) return;
    const w = wxEl.clientWidth, h = wxEl.clientHeight; if (!w || !h) return;
    if (WX.w !== w || WX.h !== h) { wxEl.width = w; wxEl.height = h; WX.w = w; WX.h = h; WX.clouds = []; WX.drops = []; }
    const dt = Math.min(0.1, (now - (WX.last || now)) / 1000); WX.last = now;
    const s = wxState(), g = wxEl.getContext("2d"); g.clearRect(0, 0, w, h);
    if (!WX.sprites) WX.sprites = cloudSprites();
    const night = 1 - dayK, windPx = (8 + s.wind * 2.2) * (w / 1600);
    // clouds: count and darkness from cloud cover; heavier and greyer when it's raining
    const want = Math.round(s.cloud / 100 * 9);
    while (WX.clouds.length < want) WX.clouds.push({ x: WX.clouds.length ? Math.random() * w : -200, y: -h * 0.04 + Math.random() * h * 0.1, s: 0.7 + Math.random() * 1.1, k: Math.floor(Math.random() * 5), z: 0.4 + Math.random() * 0.8, a: 0 });
    const shade = s.rain || s.storm ? 0.55 : 1;
    WX.clouds.forEach((c, i) => {
      c.x += windPx * c.z * dt; c.a = Math.min(1, c.a + dt * 0.3) * (i < want ? 1 : 0.98);
      if (c.x > w + 50) { c.x = -460 * c.s; c.y = -h * 0.04 + Math.random() * h * 0.1; }
      g.globalAlpha = c.a * (0.08 + 0.12 * (s.cloud / 100)) * (0.55 + 0.45 * (1 - night)) * shade;
      g.drawImage(WX.sprites[c.k], c.x, c.y, 420 * c.s, 160 * c.s);
    });
    WX.clouds = WX.clouds.filter((c, i) => i < want || c.a > 0.02);
    { // fade the clouds out well above the house so they never sit on it
      g.globalCompositeOperation = "destination-out"; g.globalAlpha = 1;
      const fm = g.createLinearGradient(0, h * 0.1, 0, h * 0.26); fm.addColorStop(0, "rgba(0,0,0,0)"); fm.addColorStop(1, "rgba(0,0,0,1)");
      g.fillStyle = fm; g.fillRect(0, h * 0.1, w, h); g.globalCompositeOperation = "source-over";
    }
    if (night > 0.3 || s.rain) { g.globalCompositeOperation = "source-atop"; g.globalAlpha = 0.35 * Math.max(night, s.rain ? 0.6 : 0); g.fillStyle = "#0b1218"; g.fillRect(0, 0, w, h); g.globalCompositeOperation = "source-over"; }
    // rain streaks / snow flakes, slanted by the wind
    const nDrops = Math.round((s.rain * 380 + s.snow * 260) * (w / 1600));
    while (WX.drops.length < nDrops) WX.drops.push({ x: Math.random() * w, y: Math.random() * h, v: 0.6 + Math.random() * 0.6, r: Math.random() });
    WX.drops.length = Math.min(WX.drops.length, nDrops);
    const slant = Math.min(0.6, s.wind / 60);
    g.globalAlpha = 1;
    if (s.rain) { g.strokeStyle = "rgba(170,200,220,.32)"; g.lineWidth = 1; g.beginPath(); }
    for (const d of WX.drops) {
      if (s.rain) {
        const sp = 900 * d.v * (h / 900); d.y += sp * dt; d.x += sp * slant * dt;
        g.moveTo(d.x, d.y); g.lineTo(d.x - 14 * slant * d.v, d.y - 14 * d.v);
      } else {
        const sp = 60 * d.v * (h / 900); d.y += sp * dt; d.x += (windPx * 0.6 + Math.sin(now / 900 + d.r * 9) * 18) * dt;
        g.fillStyle = `rgba(235,242,248,${0.35 + d.r * 0.4})`; g.beginPath(); g.arc(d.x, d.y, 1 + d.r * 1.6, 0, Math.PI * 2); g.fill();
      }
      if (d.y > h) { d.y = -10; d.x = Math.random() * w; } if (d.x > w + 20) d.x -= w + 40;
    }
    if (s.rain) g.stroke();
    // mist: a soft band low across the model
    if (s.fog) { const gr = g.createLinearGradient(0, h * 0.35, 0, h); gr.addColorStop(0, "rgba(150,170,180,0)"); gr.addColorStop(0.6, "rgba(150,170,180,.16)"); gr.addColorStop(1, "rgba(150,170,180,.24)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    // storm: an occasional soft glow inside the clouds (no hard strobe)
    if (s.storm) {
      if (now > WX.nextFlash) { WX.flash = 1; WX.nextFlash = now + 6000 + Math.random() * 12000; WX.fx = Math.random() * w; }
      if (WX.flash > 0.01) { const gr = g.createRadialGradient(WX.fx, h * 0.15, 0, WX.fx, h * 0.15, w * 0.5); gr.addColorStop(0, `rgba(200,215,255,${0.28 * WX.flash})`); gr.addColorStop(1, "rgba(200,215,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); WX.flash *= Math.pow(0.02, dt); }
    }
  }
  // background that follows the real sky: night navy with stars, a warm glow on the sun's side at dawn and dusk, a pale haze by day
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  let skyX = null, skyFace = null;
  function updateSky() {
    if (!skyEl || !sunMarker) return;
    const k = dayK, tw = Math.max(0, 1 - Math.abs(k - 0.35) / 0.35);   // twilight peaks around sunrise/sunset
    const top = mix([4, 7, 12], [10, 22, 30], k), hor = mix(mix([8, 14, 22], [24, 44, 52], k), [78, 46, 28], tw * 0.8);
    // where the sun is relative to where the camera is looking (left/right), worked out from angles so it
    // can't flip when the sun is behind the camera; the glow fades away when you're facing away from it
    const sw = sunMarker.getWorldPosition(new T.Vector3()), cp = camera.position, tg = view.target || sw;
    const aSun = Math.atan2(sw.x - cp.x, sw.z - cp.z), aCam = Math.atan2(tg.x - cp.x, tg.z - cp.z);
    const diff = ((aCam - aSun + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const hfov = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    const want = Math.max(-30, Math.min(130, 50 + diff / (hfov / 2) * 50)), face = Math.max(0, Math.cos(diff));
    skyX = skyX == null ? want : skyX + (want - skyX) * 0.12; skyFace = skyFace == null ? face : skyFace + (face - skyFace) * 0.12;
    const x = skyX;
    if (scene.fog) scene.fog.color.setRGB(...mix(top, hor, 0.4).map((v) => v / 255));
    skyEl.style.setProperty("--sky-top", `rgba(${top},.84)`); skyEl.style.setProperty("--sky-hor", `rgba(${hor},.72)`);
    skyEl.style.setProperty("--sky-x", `${x.toFixed(1)}%`); skyEl.style.setProperty("--sky-glow", ((0.08 + tw * 0.32 + k * 0.06) * skyFace).toFixed(3));
    skyEl.style.setProperty("--sky-stars", NS.el ? "0" : (Math.max(0, 1 - k * 1.6) * 0.8).toFixed(2));
  }
  let carCard = null;
  function placeCarCard() {
    const m = CAR.mesh; if (!m || !labelsEl) return;
    if (!carCard) { carCard = document.createElement("div"); carCard.className = "eddo-car-card"; labelsEl.append(carCard); }
    const c = carData(), show = c.linked && !heatMode && !energyMode && !focused && !floorSel;
    carCard.dataset.hidden = String(!show); if (!show) return;
    const p = m.g.getWorldPosition(new T.Vector3()); p.y += 2.3; p.project(camera);
    const tf = `translate(${((p.x * 0.5 + 0.5) * canvas.clientWidth).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * canvas.clientHeight).toFixed(1)}px)`;
    if (carCard.style.transform !== tf) carCard.style.transform = tf;
    const bar = (v, warn) => v == null ? "" : `<i style="--v:${v}%" data-low="${v < warn}"></i>`;
    const html = c.home
      ? `<b>${esc(c.name.toUpperCase())}${c.charging ? ' <em class="chg">⚡ CHARGING</em>' : c.plugged ? ' <em class="chg">PLUGGED IN</em>' : ""}</b>` +
        (c.fuel != null || c.fuelRange != null ? `<span>FUEL ${c.fuel != null ? bar(c.fuel, 15) : "<i></i>"}<small>${c.fuel != null ? c.fuel + "%" : ""}</small><small class="mi">${c.fuelRange != null ? c.fuelRange + " MI" : ""}</small></span>` : "") +
        (c.battery != null || c.rangeEv != null ? `<span>BATT ${c.battery != null ? bar(c.battery, 10) : "<i></i>"}<small>${c.battery != null ? c.battery + "%" : ""}</small><small class="mi">${c.rangeEv != null ? c.rangeEv + " MI" : ""}</small></span>` : "") +
        (c.range != null ? `<span class="rng">${c.range} <small>MI RANGE</small></span>` : "") +
        (c.openDoors.length || c.openWindows.length ? `<em class="warn">${c.openDoors.length ? "DOOR OPEN" : "WINDOW OPEN"}</em>` : c.locked === false ? `<em class="warn">UNLOCKED</em>` : c.locked ? `<small class="lk">LOCKED</small>` : "")
      : `<b>${esc(c.name.toUpperCase())} <em>AWAY</em></b>${c.where ? `<span class="rng"><small>${esc(c.where.toUpperCase())}</small></span>` : ""}`;
    if (carCard.innerHTML !== html) carCard.innerHTML = html;
  }
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    placeCarCard();
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
      const heat = heatMode && !r.quiet && r.temp != null;
      if (energyMode) {
        const rw = [...(r.powerIds || []).map(watts), ...devices.filter((d) => d.roomRef === r).map(devWatts)].filter((v) => v != null);
        const tot = rw.length ? rw.reduce((a, b) => a + b, 0) : null;
        r.label.dataset.heat = "false"; r.label.dataset.energy = "true";
        const s = r.label.querySelector("span"), t = tot != null && tot >= 3 ? fmtW(tot) : ""; if (s.textContent !== t) s.textContent = t;
        if (r.quiet || !t) r.label.dataset.hidden = "true";
        const sub = r.label.querySelector("i"); if (sub && sub.textContent) sub.textContent = "";
        continue;
      }
      r.label.dataset.energy = "false";
      r.label.dataset.heat = String(heatMode);
      if (heatMode && !heat) r.label.dataset.hidden = "true";
      const s = r.label.querySelector("span"), txt = heat ? `${r.temp.toFixed(1)}°` : heatMode ? "" : (hovered === r || focused === r) ? roomStatus(r) : "";
      if (s.textContent !== txt) s.textContent = txt;
      let sub = r.label.querySelector("i"); if (!sub) { sub = document.createElement("i"); r.label.append(sub); }
      const sxt = heat ? [r.tempVia ? `VIA ${r.tempVia.toUpperCase()}` : "", r.target != null ? `SET ${r.target.toFixed(1)}°` : "", r.action === "heating" ? "HEATING" : r.action === "cooling" ? "COOLING" : "", r.hum != null ? `${Math.round(r.hum)}% RH` : ""].filter(Boolean).join(" · ") : "";
      r.label.dataset.damp = String(heat && r.hum != null && r.hum >= DAMP);
      if (sub.textContent !== sxt) sub.textContent = sxt;
      if (heat) { const c = tempColour(r.temp); r.label.style.setProperty("--tc", `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`); }
    }
    for (const d of devices) {
      if (!d.label || !d.mesh) continue;
      const ew = energyMode ? devWatts(d) : null;
      const show = energyMode ? ew != null && ew >= 3 && !hiddenFloor(d.roomRef.floor) : !heatMode && (hoveredDev === d || focused === d.roomRef || (whatsOn && !focused && devActive(d)));
      d.label.dataset.hidden = String(!show);
      if (!show) continue;
      const p = d.mesh.core.getWorldPosition(new T.Vector3()); p.project(camera);
      const tf = `translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      if (d.label.style.transform !== tf) d.label.style.transform = tf;
      d.label.dataset.on = String(!!(d.st && d.st.active)); d.label.dataset.hover = String(hoveredDev === d);
      const s = d.label.querySelector("span"), txt = energyMode ? fmtW(ew) : d.st ? d.st.text : "";
      if (s.textContent !== txt) s.textContent = txt;
    }
  }

  // ---- overlays that follow a marker on screen
  const screenOf = (d) => { const p = d.mesh.core.getWorldPosition(new T.Vector3()).project(camera); return { x: (p.x * 0.5 + 0.5) * canvas.clientWidth, y: (-p.y * 0.5 + 0.5) * canvas.clientHeight, ok: p.z < 1 }; };
  let ringEl = null, ringDev = null;
  function holdRing(d, ms) {
    if (!labelsEl) return;
    if (!ringEl) { ringEl = document.createElement("div"); ringEl.className = "eddo-house-ring"; ringEl.innerHTML = `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16"/></svg>`; labelsEl.append(ringEl); }
    ringDev = d;
    ringEl.dataset.on = "false"; void ringEl.offsetWidth;            // restart the sweep
    if (d) { ringEl.style.setProperty("--ms", ms + "ms"); ringEl.dataset.on = "true"; }
  }
  // hover a camera for 3 s: a ring fills, then its live view appears on a panel in front of it
  const previews = new Map();   // camera device -> { el, timer, alive }; any number can be open at once
  let restoreCams = [];
  let dwellDev = null, dwellTimer = null;
  const DWELL_MS = 1200;
  function dwell(d) {
    if (d === dwellDev) return;
    dwellDev = d; clearTimeout(dwellTimer);
    if (d && d.cam && !drag && !previews.has(d)) { holdRing(d, DWELL_MS); dwellTimer = setTimeout(() => { holdRing(null); openPreview(d); }, DWELL_MS); }
    else if (ringDev && (!drag || !d)) holdRing(null);
  }
  // The panel opens on a snapshot straight away, then switches to the live feed after 5 s,
  // keeping the snapshot underneath until the first live frame arrives (so it's never black).
  // It stays open until its × is clicked (or Esc), and comes back when you return to the tab.
  async function openPreview(d) {
    if (previews.has(d)) return;
    const el = document.createElement("div"); el.className = "eddo-house-preview";
    el.innerHTML = `<img class="still" alt=""><img class="live" alt=""><span></span><em>LOADING…</em><button data-house-preview-close aria-label="Close camera">×</button>`;
    el.querySelector("button").dataset.housePreviewClose = d.cam; labelsEl.append(el);
    const pv = { el, timer: null, alive: true }; previews.set(d, pv);
    const still = el.querySelector(".still"), live = el.querySelector(".live"), em = el.querySelector("em");
    el.querySelector("span").textContent = (d.name || "").toUpperCase(); el.dataset.state = "loading"; el.dataset.live = "false";
    requestAnimationFrame(() => { el.dataset.open = "true"; });
    const f = window.eddoCams && await window.eddoCams.feed(d.cam);
    if (!pv.alive) return;
    if (!f) { em.textContent = "NO FEED"; return; }
    still.onload = () => { if (pv.alive) { el.dataset.state = "live"; if (el.dataset.live !== "true") em.textContent = f.stream ? "SNAPSHOT · LIVE IN A MOMENT" : "SNAPSHOT · CLICK TO OPEN"; } };
    still.onerror = () => { if (pv.alive && el.dataset.live !== "true") em.textContent = "NO SNAPSHOT"; };
    still.src = f.still;
    if (f.stream) pv.timer = setTimeout(() => {
      if (!pv.alive) return;
      live.onload = () => { if (pv.alive) { el.dataset.state = "live"; el.dataset.live = "true"; em.textContent = "● LIVE · CLICK CAMERA TO OPEN"; } };
      live.onerror = () => { if (pv.alive) { el.dataset.live = "false"; em.textContent = "SNAPSHOT · LIVE UNAVAILABLE"; } };
      live.src = f.stream;
    }, 5000);
  }
  function closePreview(d) {
    const pv = previews.get(d); if (!pv) return;
    pv.alive = false; clearTimeout(pv.timer); previews.delete(d);
    pv.el.querySelectorAll("img").forEach((img) => { img.onload = img.onerror = null; img.removeAttribute("src"); });   // stops the stream
    pv.el.dataset.open = "false"; setTimeout(() => pv.el.remove(), 500);
  }
  // close them all; keep = reopen the same ones when you come back to the tab
  function closeAllPreviews(keep) {
    restoreCams = keep ? [...previews.keys()] : [];
    [...previews.keys()].forEach(closePreview);
  }

  // the panel sits at the end of the camera's view cone; a CSS 3-D transform maps it onto that rectangle
  function homography(w, h, q) {
    const src = [[0, 0], [w, 0], [w, h], [0, h]], A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = q[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {           // Gaussian elimination
      let m = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
      [A[c], A[m]] = [A[m], A[c]]; [b[c], b[m]] = [b[m], b[c]];
      if (Math.abs(A[c][c]) < 1e-9) return null;
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const H = b.map((v, i) => v / A[i][i]);
    return `matrix3d(${[H[0], H[3], 0, H[6], H[1], H[4], 0, H[7], 0, 0, 1, 0, H[2], H[5], 0, 1].map((v) => v.toFixed(6)).join(",")})`;
  }
  function placePreview() { for (const [d, pv] of previews) placeOne(d, pv.el); }
  function placeOne(d, el) {
    const W = 0.62, Hh = 0.36, Z = 0.85, w = 320, h = 186;          // panel in the marker's own space (it scales with the marker)
    const pts = [[-W, Hh, Z], [W, Hh, Z], [W, -Hh, Z], [-W, -Hh, Z]].map(([x, y, z]) => {
      const p = d.mesh.core.localToWorld(new T.Vector3(x, y, z)).project(camera);
      return { x: (p.x * 0.5 + 0.5) * canvas.clientWidth, y: (-p.y * 0.5 + 0.5) * canvas.clientHeight, ok: p.z < 1 };
    });
    if (pts.some((p) => !p.ok)) { el.style.visibility = "hidden"; return; }
    // the cone may face away from the screen; mirror so the picture always reads the right way round
    const cross = (pts[1].x - pts[0].x) * (pts[3].y - pts[0].y) - (pts[1].y - pts[0].y) * (pts[3].x - pts[0].x);
    const q = (cross < 0 ? [pts[1], pts[0], pts[3], pts[2]] : pts).map((p) => [p.x, p.y]);
    const m = homography(w, h, q); if (!m) return;
    el.style.visibility = ""; el.style.transform = m;
  }
  // ---- settings menu for a device (press and hold a marker, or right-click if Windows lets it through)
  let pop = null;
  function openPop(d) {
    closePop();
    pop = { dev: d, el: document.createElement("div") };
    pop.el.className = "eddo-house-pop"; labelsEl.append(pop.el);
    renderPop();
  }
  function closePop() { if (pop) { pop.el.remove(); pop = null; } }
  function renderPop() {
    if (!pop) return;
    const d = pop.dev, st = d.st || devState(d), i = devices.indexOf(d), lid = lightOf(d);
    const la = lid && states.get(lid) ? states.get(lid).a : {}, modes = la.supported_color_modes || [];
    const ct = modes.includes("color_temp"), col = modes.some((m) => /hs|rgb|xy/.test(m));
    let h = `<header><b>${esc(d.name.toUpperCase())}</b><em>${esc(d.cam ? "CAMERA" : st.text || "")}</em><button data-house-pop-close aria-label="Close">×</button></header>`;
    if (canToggle(d)) h += `<button class="eddo-house-pop-main" data-house-dev="${i}" data-on="${st.active}">${st.active ? "TURN OFF" : "TURN ON"}</button>`;
    if (lid) h += `<p>BRIGHTNESS</p><div class="eddo-house-item"><div class="eddo-house-slider" data-bri="${esc(lid)}" style="--pct:${briPct(lid)}%"><i></i></div></div>`;
    if (ct) h += `<p>WARMTH</p><div class="eddo-house-pop-row">${[["WARM", 2700], ["NEUTRAL", 4000], ["DAYLIGHT", 6000]].map(([n, k]) => `<button data-house-ct="${esc(lid)}:${k}" style="--c:${k < 3000 ? "#ffb36b" : k < 5000 ? "#ffe2bf" : "#dcecff"}">${n}</button>`).join("")}</div>`;
    if (col) h += `<p>COLOUR</p><div class="eddo-house-pop-sw">${["255,147,41", "255,60,40", "255,40,140", "150,60,255", "40,110,255", "40,220,200", "90,255,90"].map((c) => `<button data-house-rgb="${esc(lid)}:${c}" style="--c:rgb(${c})" aria-label="Colour"></button>`).join("")}</div>`;
    const mids = d.ids.filter((x) => x.startsWith("media_player."));
    if (mids.length) {
      const { pid, tv } = mediaIds(d), a = (states.get(pid) || {}).a || {}, ps = (states.get(pid) || {}).s;
      const title = a.media_series_title ? `${a.media_series_title} · ${a.media_title || ""}` : a.media_title ? `${a.media_title}${a.media_artist ? " · " + a.media_artist : ""}` : a.app_name || "";
      if (title) h += `<p>NOW PLAYING</p><div class="eddo-house-pop-np">${esc(title)}</div>`;
      h += `<p>PLAYBACK</p><div class="eddo-house-pop-row"><button data-house-media="${i}:prev" aria-label="Previous">⏮</button><button data-house-media="${i}:play" aria-label="Play or pause">${ps === "playing" ? "⏸" : "▶"}</button><button data-house-media="${i}:next" aria-label="Next">⏭</button></div>`;
      h += `<p>TV</p><div class="eddo-house-pop-row"><button data-house-media="${i}:vdown">VOL −</button><button data-house-media="${i}:vup">VOL +</button><button data-house-media="${i}:power">${/^(off|standby|unavailable)$/.test((states.get(tv) || {}).s || "off") ? "TURN ON" : "TURN OFF"}</button></div>`;
    }
    if (d.ac) {   // air con: the current setting, modes the unit offers, and the temperature
      const cid = d.ids.find((x) => x.startsWith("climate.")), cs = cid && states.get(cid), modes = ((cs && cs.a.hvac_modes) || ["cool", "heat", "dry", "fan_only", "off"]);
      const nice = (m) => ({ cool: "COOL", heat: "HEAT", dry: "DRY", fan_only: "FAN", heat_cool: "AUTO", auto: "AUTO", off: "OFF" }[m] || String(m).toUpperCase());
      if (cs) h += `<p>AIR CON · ${nice(cs.s)}${cs.a.temperature != null ? ` · SET ${cs.a.temperature}°` : ""}${cs.a.current_temperature != null ? ` · ROOM ${cs.a.current_temperature}°` : ""}</p>` +
        `<div class="eddo-house-pop-row eddo-ac-modes">${modes.map((m) => `<button data-house-hvac="${i}:${m}"${cs.s === m ? ' class="on"' : ""}>${nice(m)}</button>`).join("")}</div>` +
        `<div class="eddo-house-pop-row"><button data-house-clim="${i}:-0.5">− 0.5°</button><button data-house-clim="${i}:0.5">+ 0.5°</button></div>`;
    } else if (d.ids.some((x) => x.startsWith("climate."))) h += `<p>HEATING</p><div class="eddo-house-pop-row"><button data-house-clim="${i}:-0.5">− 0.5°</button><button data-house-clim="${i}:0.5">+ 0.5°</button><button data-house-clim="${i}:power">${st.active ? "OFF" : "ON"}</button></div>`;
    if (d.cam) h += `<button class="eddo-house-pop-main" data-house-cam="${esc(d.cam)}">OPEN CAMERA</button>`;
    h += `<p class="eddo-house-pop-ids">${d.ids.length ? esc(d.ids.join(" · ")) : "NOT LINKED TO HOME ASSISTANT"}</p>`;
    if (pop.el.innerHTML !== h) pop.el.innerHTML = h;
  }
  function placePop() {
    if (!pop || !pop.dev.mesh) return;
    const s = screenOf(pop.dev), w = canvas.clientWidth;
    const x = Math.min(w - 250, Math.max(10, s.x + 18)), y = Math.max(10, s.y - 30);
    const tf = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`; if (pop.el.style.transform !== tf) pop.el.style.transform = tf;
  }
  function resize() {
    const stage = document.querySelector("#stage"); if (!stage || !renderer) return;
    const w = stage.offsetWidth, h = stage.offsetHeight, k = stage.getBoundingClientRect().width / w || 1;
    const pr = Math.min(window.EDDO_WEB ? 1.5 : 2, (window.devicePixelRatio || 1) * k);   // a little lower on Retina laptops keeps it smooth
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
    // Wallpaper Engine sets a frame-rate cap; in a browser (Mac / web edition) draw at the screen's full rate
    // In a browser (Mac): 60 fps while you're moving the model or it's easing, 24 fps when it's just sitting there.
    const busy = drag || anim || performance.now() - lastInput < 3000;
    const fps = window.EDDO_WEB ? (busy ? 60 : 24) : Math.max(20, Math.min(60, (window.rhineWallpaperHost && window.rhineWallpaperHost.fps) || 30));
    if (now - lastFrame < 1000 / fps - 8) return;    // follow Wallpaper Engine's frame-rate setting
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    resize();
    const g = view.goal;
    if (anim) {
      // one smooth ease-in-out move to the new view
      const t = Math.min(1, (now - anim.t0) / anim.dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, a = anim.from;
      view.target.lerpVectors(a.target, g.target, e);
      view.dist = a.dist + (g.dist - a.dist) * e; view.phi = a.phi + (g.phi - a.phi) * e;
      if (anim.dTheta != null) view.theta = a.theta + anim.dTheta * e;
      if (t >= 1) anim = null;
    } else {
      // small follow-ups (scroll zoom, drag) settle quickly
      view.target.lerp(g.target, Math.min(1, dt * 5));
      view.dist += (g.dist - view.dist) * Math.min(1, dt * 5);
      view.phi += (g.phi - view.phi) * Math.min(1, dt * 5);
      if (!drag && !focused) view.theta += dt * (orbitMode === "spin" ? 0.16 : orbitMode === "drift" ? 0.035 : 0);
    }
    const sp = Math.sin(view.phi), cp = Math.cos(view.phi);
    camera.position.set(view.target.x + view.dist * cp * Math.sin(view.theta), view.target.y + view.dist * sp, view.target.z + view.dist * cp * Math.cos(view.theta));
    camera.lookAt(view.target);
    if (scene.fog) { scene.fog.near = view.dist - 6; scene.fog.far = view.dist + 32; }
    updateSun(false);
    if (sunMarker) sunMarker.lookAt(camera.position);
    if (shellLines) { const want = (focused || floorSel ? 0.04 : whatsOn ? 0.1 : 0.34 * (0.75 + 0.25 * dayK)) * LIVE.bootShell; const k = Math.min(1, dt * 4); shellLines.material.opacity += (want - shellLines.material.opacity) * k; shellDetail.material.opacity += (want * 0.55 - shellDetail.material.opacity) * k; if (shellRoof) shellRoof.material.opacity += ((focused || floorSel ? 0 : want * 0.25) - shellRoof.material.opacity) * k; }
    if (plinth) for (const a of plinth.arcs) a.arc.rotation.y += a.speed * dt;
    if (now - lastSky > 50) { lastSky = now; updateSky(); }   // often and eased, so the sun glow glides as you turn
    drawWeather(now);
    updateVisuals(dt);
    updateDevices(dt, now);
    updateEnergy(dt, now);
    updateBoiler(dt, now);
    updateCar(dt, now);
    updateLive(dt, now);
    updateKit(dt, now);
    updateStars(dt, now);
    updateSmoke(dt, now);
    pollPlex(now);
    bootStep(now);
    renderer.render(scene, camera);
    placeLabels();
    placeLive();
    placeKit();
    if (ringEl && ringDev) { const p = screenOf(ringDev); ringEl.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`; }
    placePreview(); placePop();
  }

  function roomCentre(r) { const p = new T.Vector3(r.x + r.w / 2, r.y + r.h / 2, r.z + r.d / 2); r.mesh.g.parent.localToWorld(p); return p; }
  function focus(r) {
    focused = r || null; CAR.open = false;
    if (r) whatsOn = false;
    if (!T) return;
    if (!r && floorSel) return setFloor(floorSel);
    if (!r && !tour) orbitMode = "drift";
    goTo(r ? { target: roomCentre(r), dist: r.floor === "garden" ? 16 : 20, phi: 0.85 } : { target: new T.Vector3(0, 3.2, 0), ...HOME });
    refreshList();
  }

  function setFloor(fl) {
    floorSel = fl || null; focused = null; CAR.open = false;
    if (!T) return;
    const rs = rooms.filter((r) => !floorSel || r.floor === floorSel);
    const c = rs.map(roomCentre).reduce((a, b) => a.add(b), new T.Vector3()).multiplyScalar(1 / Math.max(1, rs.length));
    if (!floorSel) orbitMode = "drift";
    goTo(floorSel ? { target: c, dist: floorSel === "garden" ? 18 : 30, phi: 0.95 } : { target: new T.Vector3(0, 3.2, 0), ...HOME });
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
  // While a room is open, a click on another room (even through the open room's walls) goes there;
  // a click on the open room itself or on empty space steps back out.
  function clickRoom(ev) {
    const rect = canvas.getBoundingClientRect();
    const ray = new T.Raycaster(), v = new T.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    const hits = ray.intersectObjects(rooms.filter((r) => r.mesh && (!floorSel || r.floor === floorSel)).map((r) => r.mesh.faces), false).map((h) => h.object.userData.room);
    if (!hits.length) return back();
    if (!focused) return focus(hits.find((r) => !r.quiet) || hits[0]);
    const iSelf = hits.indexOf(focused), before = iSelf < 0 ? hits : hits.slice(0, iSelf);
    const next = before.find((r) => !r.quiet) || (iSelf >= 0 ? hits.slice(iSelf + 1).find((r) => r.floor === focused.floor && !r.quiet) : null) || before[0];
    if (next && next !== focused) return focus(next);
    back();
  }
  function pickCar(ev) {
    if (!CAR.mesh || heatMode || energyMode || floorSel || (focused && !CAR.open)) return false;
    const rect = canvas.getBoundingClientRect(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1), camera);
    return ray.intersectObject(CAR.mesh.hit, false).length > 0;
  }
  function openCar() {
    stopTour(); closePop(); focused = null; whatsOn = false; CAR.open = true; orbitMode = "off";
    goTo({ target: CAR.mesh.g.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 0.8, 0)), dist: 13, phi: 0.5 }, 1300);
    refreshList();
  }
  function pickDevice(ev) {
    if (heatMode || energyMode) return null;
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
  // which media player to drive: the one playing (often Plex) for playback, the TV itself for power and volume
  function mediaIds(d) {
    const mids = d.ids.filter((x) => x.startsWith("media_player.")), st = (x) => (states.get(x) || {}).s;
    const pid = mids.find((x) => st(x) === "playing") || mids.find((x) => st(x) === "paused") || mids[0];
    const tv = mids.find((x) => !/plex|cast|spotify|chromecast/i.test(x)) || mids[0];
    return { pid, tv, mids };
  }
  function mediaAction(d, act) {
    if (!d) return;
    const { pid, tv } = mediaIds(d), svc = { prev: "media_previous_track", play: "media_play_pause", next: "media_next_track", vdown: "volume_down", vup: "volume_up" }[act];
    const target = act === "vdown" || act === "vup" ? tv : pid;
    if (act === "power") { const off = /^(off|standby|unavailable)$/.test((states.get(tv) || {}).s || "off"); call("media_player", off ? "turn_on" : "turn_off", { target: { entity_id: tv } }); }
    else if (svc && target) call("media_player", svc, { target: { entity_id: target } });
    setTimeout(renderPop, 600);
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
  const overUi = (el) => !!(el && el.closest && el.closest(".workbench, .eddo-ha, .eddo-srv, .eddo-quick, .eddo-dlg, .system-footer, .brand, .eddo-cam-overlay, .eddo-house-pop, .eddo-house-preview, button, a"));
  let lastInput = performance.now();
  function stopTour() { if (tour) { clearInterval(tour.timer); tour = null; } }
  function back() {
    stopTour(); closePop();
    if (CAR.open) { CAR.open = false; goTo({ target: new T.Vector3(0, 3.2, 0), ...HOME }); orbitMode = "drift"; return refreshList(); }
    if (focused) focus(null);
    else if (floorSel || whatsOn || orbitMode !== "drift") { whatsOn = false; setFloor(null); }
  }
  const VIEWS = {
    front: { theta: 0, phi: 0.22, dist: 44 },
    back: { theta: Math.PI, phi: 0.32, dist: 48 },
    side: { theta: Math.PI / 2, phi: 0.3, dist: 46 },
    top: { theta: 0, phi: 1.42, dist: 50 },
  };
  function setView(name) {
    if (!T || !view.target) return;
    stopTour(); closePop();
    whatsOn = false; focused = null; floorSel = null;
    if (name === "spin") { orbitMode = orbitMode === "spin" ? "drift" : "spin"; goTo({ target: new T.Vector3(0, 3.2, 0), ...HOME }); return refreshList(); }
    if (name === "tour") {
      const list = rooms.filter((r) => !r.quiet);
      let i = 0; orbitMode = "off";
      const step = () => { if (!running) return stopTour(); const r = list[i++ % list.length]; focused = r; whatsOn = false; goTo({ target: roomCentre(r), dist: r.floor === "garden" ? 16 : 21, phi: 0.82, theta: view.theta + 0.9 }, 1800); refreshList(); };
      tour = { timer: setInterval(step, 6500) }; step(); return;
    }
    orbitMode = "off";
    goTo({ target: new T.Vector3(0, name === "top" ? 2 : 3.6, 0), ...VIEWS[name] }, 1400);
    refreshList();
  }
  setInterval(() => { if (running && !drag && !tour && (focused || floorSel || whatsOn || orbitMode === "off") && performance.now() - lastInput > 120000) back(); }, 5000);  // drift home after 2 idle minutes
  function hookInput() {
    const stage = document.querySelector("#stage");
    ["mousemove", "mousedown", "wheel"].forEach((t) => window.addEventListener(t, () => { lastInput = performance.now(); }, { passive: true }));
    stage.addEventListener("contextmenu", (e) => { if (!running || overUi(e.target)) return; e.preventDefault(); const d = pickDevice(e); if (d) openPop(d); else back(); });
    window.addEventListener("keydown", (e) => { if (running && e.key === "Escape") { if (pop) closePop(); else if (previews.size) closePreview([...previews.keys()].pop()); else back(); } });
    stage.addEventListener("mousedown", (e) => {
      if (!running || overUi(e.target) || e.button !== 0) return;
      stopTour(); anim = null; clearTimeout(dwellTimer);
      drag = { x: e.clientX, y: e.clientY, theta: view.theta, phi: view.goal.phi, moved: false };
      // press and hold a marker for its settings
      const d = pickDevice(e);
      if (d) { const dr = drag; holdRing(d, 550); dr.hold = setTimeout(() => { if (drag === dr && !dr.moved) { dr.held = true; holdRing(null); openPop(d); } }, 550); }
    });
    window.addEventListener("mousemove", (e) => {
      if (!running) return;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 7) { drag.moved = true; clearTimeout(drag.hold); holdRing(null); }
        if (!drag.moved) return;
        view.theta = drag.theta - dx * 0.006;
        view.goal.phi = Math.max(0.12, Math.min(1.35, drag.phi + dy * 0.004));
        return;
      }
      const ui = overUi(e.target);
      hoveredDev = ui ? null : pickDevice(e);
      dwell(hoveredDev);
      hovered = ui ? null : hoveredDev ? hoveredDev.roomRef : pick(e);
      CAR.hover = !ui && !hoveredDev && pickCar(e);
    });
    window.addEventListener("mouseup", (e) => {
      if (!running || !drag) return;
      const dr = drag, moved = dr.moved; drag = null; clearTimeout(dr.hold); holdRing(null);
      if (dr.held || moved || overUi(e.target)) return;
      if (pop) { closePop(); return; }
      const d = pickDevice(e);
      if (d && d.cam && window.eddoCams && (focused === d.roomRef || previews.has(d))) { window.eddoCams.open(d.cam); return; }
      if (d && canToggle(d) && focused === d.roomRef) { toggleDevice(d); return; }     // click a light in the focused room to switch it
      if (d) return focus(d.roomRef);
      if (pickCar(e)) { openCar(); return; }
      clickRoom(e);
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
    LIVE.bootT = performance.now(); LIVE.bootShell = 0;
    for (const l of [shellLines, shellDetail, shellRoof]) if (l) l.material.opacity = 0;
    const s = document.querySelector("#stage");
    s && s.setAttribute("data-eddo-house", "true");
    requestAnimationFrame(frame);
    if (restoreCams.length) { const ds = restoreCams; restoreCams = []; setTimeout(() => running && ds.forEach(openPreview), 300); }
  }
  // The moving background tracks the mouse only while it thinks no button is held on it. If a press started on it
  // never got its release (the House tab covered it mid-press), it stops following the mouse; cancel any such press.
  function releaseBackground() {
    const sc = document.querySelector("#three-scene"); if (!sc || typeof PointerEvent !== "function") return;
    for (const pointerId of [1, 0, 2]) {
      try { sc.dispatchEvent(new PointerEvent("pointercancel", { pointerId, pointerType: "mouse", bubbles: true })); } catch (_) {}
      try { sc.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId, pointerType: "mouse", bubbles: true })); } catch (_) {}
    }
    const once = (e) => { window.removeEventListener("pointermove", once, true);
      try { sc.dispatchEvent(new PointerEvent("pointermove", { pointerId: e.pointerId, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY, bubbles: true })); } catch (_) {} };
    window.addEventListener("pointermove", once, true);
  }
  function stop() {
    stopTour(); closePop(); closeAllPreviews(true); dwell(null);
    running = false; hovered = null; hoveredDev = null; drag = null;
    document.querySelector("#stage")?.removeAttribute("data-eddo-house");
    releaseBackground();
  }

  // ------------------------------------------------------------ live extras
  // doors & windows (contact sensors), music (media players), weather (rain/snow, wind in the trees),
  // bin day and parcels out front, and the holographic boot-up when the tab opens.
  const LIVE = { doors: [], players: [], bins: [], parcels: [], trees: [], treeDefs: [], rain: null, root: null, tags: new Map(), bootT: null, bootShell: 1, scan: null, binMeshes: [], parcel: null, wxK: 0 };
  const DOOR_CLASSES = ["door", "garage_door", "opening", "window"];
  const isOpenSt = (id) => { const st = id && states.get(id); return !!st && st.s === "on"; };
  function discoverLive(allStates, ents, areaName, devArea) {
    const entOf = new Map(ents.map((x) => [x.entity_id, x]));
    const roomOf = (x) => { const an = x && areaName.get(x.area_id || devArea.get(x.device_id)); return an ? rooms.find((r) => (r.areas || []).some((a) => a.toLowerCase() === an)) || null : null; };
    const text = (st) => (st.entity_id.replace(/_/g, " ") + " " + (st.attributes.friendly_name || "")).toLowerCase();
    const live = (st) => { const x = entOf.get(st.entity_id); return !x || !(x.disabled_by || x.hidden_by); };
    // doors & windows: matched to the model's doors by name, otherwise put on their room's back wall
    const have = new Set(allStates.map((st) => st.entity_id));
    const conf = (H.doors || []).map((d) => ({ ...d, ids: [d.entity, ...(d.entities || [])].filter((id) => id && have.has(id)), roomRef: rooms.find((r) => r.id === d.room) })).filter((d) => d.roomRef);
    const claimed = new Set(conf.flatMap((d) => d.ids));
    for (const st of allStates) {
      if (claimed.has(st.entity_id) || !st.entity_id.startsWith("binary_sensor.") || !DOOR_CLASSES.includes(st.attributes.device_class) || !live(st)) continue;
      const t = text(st), hit = conf.find((d) => !d.auto && !d.entity && (d.match || []).some((m) => t.includes(m)));
      if (hit) { hit.ids.push(st.entity_id); continue; }
      if (!H.autoDoors) continue;   // only the doors and windows listed in the model are drawn (set autoDoors: true to place the rest)
      const r = roomOf(entOf.get(st.entity_id)); if (!r) continue;
      const n = conf.filter((d) => d.roomRef === r && d.auto).length, win = st.attributes.device_class === "window";
      // a door sensor in a room that already has a door in the model belongs to that door (an unclaimed one first)
      const mine = !win && (conf.find((d) => d.roomRef === r && !d.auto && !d.window && !d.entity && !d.ids.length) || conf.find((d) => d.roomRef === r && !d.auto && !d.window && !d.entity));
      if (mine) { mine.ids.push(st.entity_id); continue; }
      conf.push({ name: st.attributes.friendly_name || st.entity_id, room: r.id, roomRef: r, wall: "back", at: 0.25 + (n % 3) * 0.25, w: win ? 0.9 : 0.8, window: win, auto: true, ids: [st.entity_id] });
    }
    LIVE.doors = conf.filter((d) => d.ids.length);
    for (const d of LIVE.doors) { const lk = allStates.find((st) => st.entity_id.startsWith("lock.") && (d.match || []).some((m) => text(st).includes(m))); d.lockId = lk ? lk.entity_id : null; }
    // music & TV: media players, grouped onto the TV they belong to or the room they're in
    const tvs = devices.filter((d) => d.kind === "tv"), groups = new Map();
    for (const st of allStates) {
      if (!st.entity_id.startsWith("media_player.") || !live(st)) continue;
      const t = text(st); let d = tvs.find((v) => v.ids.includes(st.entity_id) || (v.match || []).some((m) => t.includes(m)));
      const r = d ? d.roomRef : roomOf(entOf.get(st.entity_id)); if (!r) continue;
      if (!d) d = tvs.find((v) => v.roomRef === r) || null;   // a player in a room with a TV belongs to that TV (one set of rings, one label)
      const key = d ? "tv:" + devices.indexOf(d) : "room:" + r.id;
      if (!groups.has(key)) groups.set(key, { dev: d || null, roomRef: r, ids: [], k: 0 });
      groups.get(key).ids.push(st.entity_id);
    }
    LIVE.players = [...groups.values()];
    for (const g of LIVE.players) if (g.dev) g.dev.ids = [...new Set([...g.dev.ids, ...g.ids])];
    // bin day (e.g. Waste Collection Schedule) and parcels due (e.g. Mail and Packages, Parcel)
    LIVE.bins = allStates.filter((st) => /^(sensor|calendar)\./.test(st.entity_id) && /\b(bins?|waste|recycl\w*|refuse|rubbish|food caddy)\b/.test(text(st)) && live(st)).map((st) => st.entity_id);
    LIVE.parcels = allStates.filter((st) => st.entity_id.startsWith("sensor.") && /parcel|package|deliver/.test(text(st)) && !/delivered|update|last|image|exception|camera/.test(text(st)) && live(st) && Number.isFinite(+st.state)).map((st) => st.entity_id);
    LIVE.needBuild = true;
    return [...LIVE.doors.flatMap((d) => [...d.ids, d.lockId].filter(Boolean)), ...LIVE.players.flatMap((p) => p.ids), ...LIVE.bins, ...LIVE.parcels];
  }

  // where a door sits: hinge point, direction along the wall, and which way is into the room (plan x, z)
  function doorFrame(d) {
    const r = d.roomRef, at = d.at ?? 0.5, w = d.w || 0.85;
    let p, a, n;
    if (d.wall === "front") { p = [r.x + at * r.w - w / 2, r.z]; a = [1, 0]; n = [0, 1]; }
    else if (d.wall === "back") { p = [r.x + at * r.w - w / 2, r.z + r.d]; a = [1, 0]; n = [0, -1]; }
    else if (d.wall === "left") { p = [r.x, r.z + at * r.d - w / 2]; a = [0, 1]; n = [1, 0]; }
    else { p = [r.x + r.w, r.z + at * r.d - w / 2]; a = [0, 1]; n = [-1, 0]; }
    if (d.inset) p = [p[0] + n[0] * d.inset, p[1] + n[1] * d.inset];
    if (d.hinge === "far") { p = [p[0] + a[0] * w, p[1] + a[1] * w]; a = [-a[0], -a[1]]; }
    if (d.out) n = [-n[0], -n[1]];
    return { p, a, n, w };
  }
  const lineGeo = (pts) => { const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); return g; };
  const lineMat = (color, opacity) => new T.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

  function buildLive(root, maxX, maxZ) {
    LIVE.root = root;
    LIVE.dyn = new T.Group(); root.add(LIVE.dyn); buildLiveDyn();
    buildLiveStatic(root, maxX, maxZ);
  }
  // doors and players depend on what Home Assistant has, so they're rebuilt whenever it (re)connects
  function buildLiveDyn() {
    const root = LIVE.dyn; if (!root) return;
    LIVE.needBuild = false;
    while (root.children.length) root.remove(root.children[0]);
    LIVE.tags.forEach((el) => { el.dataset.hidden = "true"; });
    KIT.built = false;
    // doors & windows
    for (const d of LIVE.doors) {
      const { p, a, n, w } = doorFrame(d), r = d.roomRef, h = d.window ? 1.1 : 2.0, y0 = r.y + (d.window ? 0.95 : 0.02);
      const g = new T.Group(); g.position.set(p[0], y0, p[1]); g.rotation.y = Math.atan2(-a[1], a[0]); root.add(g);
      const sz = Math.sin(g.rotation.y) * n[0] + Math.cos(g.rotation.y) * n[1] > 0 ? 1 : -1;   // local +z is into the room?
      const frame = new T.LineSegments(lineGeo([0, 0, 0, 0, h, 0, 0, h, 0, w, h, 0, w, h, 0, w, 0, 0]), lineMat(C.edge, 0.45)); g.add(frame);
      const leaf = new T.Group(); g.add(leaf);
      const leafLines = new T.LineSegments(lineGeo([0, 0, 0, w, 0, 0, w, 0, 0, w, h, 0, w, h, 0, 0, h, 0, 0, h, 0, 0, 0, 0, w * 0.82, h * 0.48, 0, w * 0.82, h * 0.52, 0]), lineMat(C.edge, 0.45)); leaf.add(leafLines);
      const fill = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
      fill.position.set(w / 2, h / 2, 0); leaf.add(fill);
      const ap = []; if (!d.window) for (let i = 0; i < 16; i++) { const t0 = i / 16 * 1.4, t1 = (i + 1) / 16 * 1.4; ap.push(w * Math.cos(t0), 0.01, sz * w * Math.sin(t0), w * Math.cos(t1), 0.01, sz * w * Math.sin(t1)); }
      const arc = new T.LineSegments(lineGeo(ap.length ? ap : [0, 0, 0, 0, 0, 0]), lineMat(0xffb36b, 0)); g.add(arc);
      d.mesh = { g, frame, leaf, leafLines, fill, arc, sz, k: 0, h };
    }
    // music: three rings that ripple out from the speaker or TV while it plays
    for (const pl of LIVE.players) {
      const r = pl.roomRef, d = pl.dev;
      const x = r.x + (d ? d.u : 0.5) * r.w, z = r.z + (d ? d.v : 0.5) * r.d, y = r.y + (d ? (d.y ?? KIND_HEIGHT.tv) : 1.0);
      const g = new T.Group(); g.position.set(x, y, z); root.add(g);
      pl.rings = [0, 1, 2].map(() => { const m = new T.Mesh(new T.RingGeometry(0.93, 1, 48), new T.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending })); m.rotation.x = -Math.PI / 2; g.add(m); return m; });
      pl.g = g;
    }
  }
  function buildLiveStatic(root, maxX, maxZ) {
    // weather: rain/snow streaks over the whole site
    {
      const N = 700, seed = [];
      for (let i = 0; i < N; i++) seed.push([-3 + Math.random() * (maxX + 6), Math.random() * 15, -5 + Math.random() * (maxZ + 9)]);
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(N * 6), 3)); geo.setDrawRange(0, 0);
      const pos = geo.attributes.position.array;
      const ln = new T.LineSegments(geo, new T.LineBasicMaterial({ color: 0xa9d8ff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
      seed.maxX = maxX + 6; ln.frustumCulled = false; root.add(ln); LIVE.rain = { ln, geo, pos, seed, N };
    }
    // trees: their own groups so the wind can move them (pivot at the trunk)
    for (const t of LIVE.treeDefs) {
      const g = new T.Group(); g.position.set(t.x, 0, t.z); root.add(g);
      g.add(new T.LineSegments(lineGeo(t.pts), shellDetail ? shellDetail.material : lineMat(C.edge, 0.16)));
      LIVE.trees.push({ g, ph: Math.random() * 6 });
    }
    // bins by the front wall, parcel by the front door
    const box = (w, h, d, x, y, z, op = 0.7) => { const e = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(w, h, d)), lineMat(C.edge, op)); e.position.set(x, y + h / 2, z); return e; };
    for (let i = 0; i < 3; i++) {
      const g = new T.Group(); g.position.set(0.45 + i * 0.75, 0, -1.15); g.visible = false; root.add(g);
      g.add(box(0.58, 0.95, 0.7, 0, 0.08, 0)); g.add(box(0.62, 0.06, 0.76, 0, 1.03, 0.02));          // body, lid
      g.add(box(0.5, 0.04, 0.04, 0, 1.0, 0.4));                                                     // handle
      for (const sx of [-1, 1]) { const c = []; for (let k = 0; k < 12; k++) { const a0 = k / 12 * Math.PI * 2, a1 = (k + 1) / 12 * Math.PI * 2; c.push(sx * 0.3, 0.1 + Math.sin(a0) * 0.1, 0.32 + Math.cos(a0) * 0.1, sx * 0.3, 0.1 + Math.sin(a1) * 0.1, 0.32 + Math.cos(a1) * 0.1); } g.add(new T.LineSegments(lineGeo(c), lineMat(C.edge, 0.7))); }
      LIVE.binMeshes.push(g);
    }
    {
      const g = new T.Group(); g.position.set(4.25, 0, -0.75); g.visible = false; root.add(g);
      g.add(box(0.45, 0.3, 0.35, 0, 0, 0)); g.add(new T.LineSegments(lineGeo([-0.225, 0.3, 0, 0.225, 0.3, 0, 0, 0.3, -0.175, 0, 0.3, 0.175, -0.225, 0.3, 0, -0.225, 0, 0, 0.225, 0.3, 0, 0.225, 0, 0]), lineMat(0xffd08a, 0.8)));
      LIVE.parcel = g;
    }
    // boot-up: a scan plane that sweeps up the house as the floors build
    {
      const x0 = -1, x1 = maxX + 1, z0 = -2, z1 = maxZ + 1;
      const g = new T.Group(); root.add(g);
      g.add(new T.LineSegments(lineGeo([x0, 0, z0, x1, 0, z0, x1, 0, z0, x1, 0, z1, x1, 0, z1, x0, 0, z1, x0, 0, z1, x0, 0, z0]), lineMat(0x9fe8ff, 0)));
      const pl = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), new T.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
      pl.rotation.x = -Math.PI / 2; pl.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); g.add(pl); g.visible = false; LIVE.scan = g;
    }
  }

  // bins: days until collection, from whatever the sensor gives
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function binDays(id) {
    const st = states.get(id); if (!st) return null;
    const a = st.a || {}, s = String(st.s).trim();
    if (Number.isFinite(+a.daysTo)) return +a.daysTo;
    if (id.startsWith("calendar.")) { const t = Date.parse(a.start_time); return Number.isFinite(t) ? Math.round((dayStart(t) - dayStart(Date.now())) / 864e5) : null; }
    if (/^today$/i.test(s)) return 0; if (/^tomorrow$/i.test(s)) return 1;
    const m = s.match(/in (\d+) days?/i); if (m) return +m[1];
    if (/^\d+(\.\d+)?$/.test(s)) return /day|^$/i.test(a.unit_of_measurement || "") ? Math.round(+s) : null;
    const t = Date.parse(s); return Number.isFinite(t) ? Math.round((dayStart(t) - dayStart(Date.now())) / 864e5) : null;
  }
  const binName = (id) => { const st = states.get(id); return String((st && st.a.friendly_name) || id.split(".")[1]).replace(/_/g, " ").replace(/\b(next|collection|bins?|day)\b/gi, "").replace(/\s+/g, " ").trim() || "Bins"; };
  const binColour = (n) => /recycl|paper|glass|blue/i.test(n) ? 0x6fd6ff : /garden|green/i.test(n) ? 0x7fe08a : /food|caddy/i.test(n) ? 0xffc25a : 0xb8c4c8;

  function updateLive(dt, now) {
    if (!LIVE.root) return;
    if (LIVE.needBuild) buildLiveDyn();
    const wall = Date.now(), k = Math.min(1, dt * 4), boot = LIVE.bootShell;
    // doors & windows
    for (const d of LIVE.doors) {
      const m = d.mesh; if (!m) continue;
      const openIds = d.ids.filter(isOpenSt), open = openIds.length > 0;
      d.since = open ? Math.max(...openIds.map((id) => states.get(id).t || wall)) : 0;
      d.long = open && wall - d.since > 10 * 60e3;
      d.unlocked = !!d.lockId && (states.get(d.lockId) || {}).s === "unlocked";
      m.k += ((open ? 1 : 0) - m.k) * k;
      const hide = hiddenFloor(d.roomRef.floor) || energyMode, pulse = d.long || d.unlocked ? 0.5 + 0.5 * Math.sin(now / 260) : 0;
      if (!d.window) m.leaf.rotation.y = -m.sz * m.k * 1.4;
      const col = open ? 0xffb36b : d.unlocked ? 0xff6a5a : C.edge;
      for (const l of [m.frame, m.leafLines]) { l.material.color.setHex(col); l.material.opacity = (hide ? 0.04 : open || d.unlocked ? 0.7 + 0.3 * pulse : 0.4) * boot; }
      m.fill.material.opacity = hide ? 0 : m.k * (d.window ? 0.18 : 0.1) + pulse * 0.08;
      m.arc.material.opacity = hide ? 0 : m.k * 0.45 * boot;
    }
    // music
    for (const pl of LIVE.players) {
      if (!pl.rings) continue;
      const playing = pl.ids.some((id) => (states.get(id) || {}).s === "playing"), hide = hiddenFloor(pl.roomRef.floor) || heatMode || energyMode;
      pl.k += ((playing && !hide ? 1 : 0) - pl.k) * k;
      pl.rings.forEach((m, i) => { const ph = (now / 1000 * 0.55 + i / 3) % 1; m.scale.setScalar(0.15 + ph * 1.3); m.material.opacity = pl.k * (1 - ph) * 0.4; });
      pl.playing = playing;
    }
    // weather
    const o = window.eddoOutside, code = o ? +o.code : -1;
    const snowy = !!o && (o.snow > 0 || [71, 73, 75, 77, 85, 86].includes(code)), rainy = !!o && !snowy && (o.precip > 0 || [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code));
    const wet = (rainy || snowy) && !heatMode && !energyMode;
    LIVE.wxK += ((wet ? 1 : 0) - LIVE.wxK) * Math.min(1, dt * 1.5);
    const wind = o ? (o.wind || 0) / 3.6 : 0, [wx, wz] = o ? planDir(((o.windDir || 0) + 180) * Math.PI / 180) : [0, 0];
    if (LIVE.rain) {
      const R = LIVE.rain, mat = R.ln.material;
      mat.opacity = LIVE.wxK * (snowy ? 0.55 : 0.35);
      if (LIVE.wxK > 0.01) {
        const inten = snowy ? 0.6 : Math.max(0.3, Math.min(1, 0.3 + (o.precip || 0) * 0.35)), n = Math.round(R.N * inten);
        const fall = snowy ? 1.1 : 9, drift = Math.min(6, wind * (snowy ? 0.35 : 0.25)), len = snowy ? 0.07 : 0.42;
        const vx = wx * drift, vz = wz * drift, vl = Math.hypot(vx, fall, vz) || 1;
        for (let i = 0; i < n; i++) {
          const s = R.seed[i];
          s[1] -= fall * dt; s[0] += vx * dt; s[2] += vz * dt;
          if (snowy) s[0] += Math.sin(now / 900 + i) * 0.2 * dt;
          if (s[1] < 0) { s[1] += 15; s[0] = -3 + Math.random() * (R.seed.maxX || 12); }
          const j = i * 6; R.pos[j] = s[0]; R.pos[j + 1] = s[1]; R.pos[j + 2] = s[2];
          R.pos[j + 3] = s[0] - vx / vl * len; R.pos[j + 4] = s[1] + fall / vl * len; R.pos[j + 5] = s[2] - vz / vl * len;
        }
        R.geo.setDrawRange(0, n * 2); R.geo.attributes.position.needsUpdate = true;
      }
    }
    // wind in the trees
    const amp = 0.004 + Math.min(0.05, wind * 0.006);
    for (const t of LIVE.trees) { const s = 0.6 + 0.4 * Math.sin(now / 650 + t.ph); t.g.rotation.z = -wx * amp * s; t.g.rotation.x = wz * amp * s; }
    // bins & parcels out front (all-house or ground floor view)
    const front = !heatMode && !energyMode && (!floorSel || floorSel === "ground") && !focused, hr = new Date().getHours();
    LIVE.binsDue = LIVE.bins.map((id) => ({ id, days: binDays(id), name: binName(id) })).filter((b) => b.days === 0 && hr < 14 || b.days === 1 && hr >= 16);
    LIVE.binMeshes.forEach((g, i) => {
      const b = LIVE.binsDue[i]; g.visible = !!b && front;
      if (b) g.children.forEach((c) => { c.material.color.setHex(binColour(b.name)); c.material.opacity = 0.75 * boot; });
    });
    LIVE.parcelCount = LIVE.parcels.reduce((a, id) => a + Math.max(0, +((states.get(id) || {}).s) || 0), 0);
    if (LIVE.parcel) { LIVE.parcel.visible = LIVE.parcelCount > 0 && front; LIVE.parcel.position.y = 0.05 + Math.sin(now / 500) * 0.05; LIVE.parcel.rotation.y = now / 3000; }
  }

  // floating tags in the labels layer (projected from model coordinates)
  function liveTag(key, x, y, z, html, show, cls = "") {
    let el = LIVE.tags.get(key);
    if (!show) { if (el) el.dataset.hidden = "true"; return; }
    if (!el) { el = document.createElement("div"); el.className = "eddo-live-tag " + cls; labelsEl.append(el); LIVE.tags.set(key, el); }
    const p = LIVE.root.localToWorld(new T.Vector3(x, y, z)).project(camera);
    if (p.z > 1) { el.dataset.hidden = "true"; return; }
    el.dataset.hidden = "false";
    const tf = `translate(${((p.x * 0.5 + 0.5) * canvas.clientWidth).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * canvas.clientHeight).toFixed(1)}px)`;
    if (el.style.transform !== tf) el.style.transform = tf;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  const mins = (ms) => { const m = Math.round(ms / 60e3); return m < 1 ? "JUST NOW" : m < 60 ? `${m} MIN` : `${Math.floor(m / 60)} H ${m % 60} MIN`; };
  function placeLive() {
    if (!LIVE.root || !labelsEl) return;
    const wall = Date.now(), quiet = heatMode || energyMode;
    for (const [i, d] of LIVE.doors.entries()) {
      if (!d.mesh) continue;
      const { p, a, w } = doorFrame(d), show = !energyMode && !hiddenFloor(d.roomRef.floor) && (d.mesh.k > 0.5 || d.unlocked);
      const what = d.mesh.k > 0.5 ? `OPEN · ${mins(wall - d.since)}` : "UNLOCKED";
      liveTag("door" + i, p[0] + a[0] * w / 2, d.roomRef.y + (d.window ? 2.3 : 2.4), p[1] + a[1] * w / 2, `<b>${esc(d.name.toUpperCase())}</b><span data-warn="${!!(d.long || d.unlocked)}">${what}</span>`, show);
    }
    for (const [i, pl] of LIVE.players.entries()) {
      if (!pl.g) continue;
      const show = pl.playing && pl.k > 0.3 && !quiet;
      const id = pl.ids.find((x) => (states.get(x) || {}).s === "playing"), a = id ? states.get(id).a : {};
      const title = a.media_series_title || a.media_title || a.app_name || "Playing", sub = a.media_series_title ? a.media_title : a.media_artist || "";
      let pic = pl.dev && a.entity_picture ? String(a.entity_picture) : "";
      if (pic && !/^https?:/i.test(pic)) pic = (HA() && HA().baseUrl ? HA().baseUrl() : "") + pic;
      const html = (pic ? `<img src="${esc(pic)}" alt="">` : `<i class="eddo-live-note">♪</i>`) + `<b>${esc(String(title).toUpperCase())}</b>${sub ? `<span>${esc(String(sub))}</span>` : ""}`;
      const g = pl.g; liveTag("media" + i, g.position.x, g.position.y + (pic ? 1.0 : 0.6), g.position.z, html, show, pic ? "eddo-live-poster" : "");
    }
    const bins = LIVE.binsDue || [];
    liveTag("bins", 0.45 + (Math.max(1, bins.length) - 1) * 0.375, 1.6, -1.15, `<b>${bins.some((b) => b.days === 0) ? "BIN DAY" : "BINS OUT TONIGHT"}</b><span>${esc(bins.map((b) => b.name.toUpperCase()).join(" · "))}</span>`, bins.length > 0 && LIVE.binMeshes[0] && LIVE.binMeshes[0].visible);
    liveTag("parcel", 4.25, 0.9, -0.75, `<b>${LIVE.parcelCount} PARCEL${LIVE.parcelCount === 1 ? "" : "S"} DUE</b>`, LIVE.parcel && LIVE.parcel.visible);
  }

  // boot-up: floors rise from the plan as a scan plane sweeps up, then the shell and roof fade in
  function bootStep(now) {
    if (LIVE.bootT == null) return;
    const b = (now - LIVE.bootT) / 2600, top = 12.5;
    const ease = (x) => x <= 0 ? 0.001 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
    for (const r of rooms) if (r.mesh) r.mesh.g.scale.y = ease((b - (r.y / top) * 0.7) / 0.3);
    LIVE.bootShell = Math.max(0, Math.min(1, (b - 0.6) / 0.4));
    if (LIVE.scan) {
      LIVE.scan.visible = b < 1.05; LIVE.scan.position.y = Math.min(1, b / 0.95) * top;
      const op = Math.max(0, 1 - b) ; LIVE.scan.children[0].material.opacity = 0.6 * op; LIVE.scan.children[1].material.opacity = 0.05 * op;
    }
    if (b >= 1.05) { LIVE.bootT = null; LIVE.bootShell = 1; rooms.forEach((r) => r.mesh && r.mesh.g.scale.set(1, 1, 1)); if (LIVE.scan) LIVE.scan.visible = false; }
  }

  // ------------------------------------------------------------ kit: appliances, 3D printer, office AC, home server
  const KIT = { appl: [], prn: null, ac: null, nas: null, built: false };
  const numOf = (id) => { const x = id && states.get(id); return x && Number.isFinite(+x.s) ? +x.s : null; };
  const strOf = (id) => { const x = id && states.get(id); return x && !/^(unknown|unavailable)$/.test(x.s) ? String(x.s) : null; };
  function discoverKit(allStates, ents) {
    const entOf = new Map(ents.map((x) => [x.entity_id, x]));
    const ok = (id) => { const x = entOf.get(id); return !x || !x.disabled_by; };
    const ids = [];
    // appliances: Home Connect operation state / progress / remaining time when there is one, otherwise the smart plug's power
    KIT.appl = devices.filter((d) => d.kind === "appliance" && /wash|dish|dry|tumble/i.test(d.name)).map((d) => {
      const key = /dish/i.test(d.name) ? "dish" : /dry|tumble/i.test(d.name) ? "dry" : "wash";
      const re = key === "dish" ? /dishwasher/ : key === "dry" ? /dryer|tumble/ : /washing_machine|(?<!dish)washer(?!_dry)/;
      const pick = (r2) => { const x = allStates.find((st) => st.entity_id.startsWith("sensor.") && re.test(st.entity_id) && r2.test(st.entity_id) && ok(st.entity_id)); return x ? x.entity_id : null; };
      const a = { d, key, state: pick(/operation_state/), progress: pick(/program_progress|progress/), remain: pick(/remaining|finish_time|time_left/), on: false, done: 0, k: 0 };
      ids.push(a.state, a.progress, a.remain, ...(d.powerIds || []));
      return a;
    });
    // 3D printer: the Bambu Lab integration
    const bam = ents.filter((x) => x.platform === "bambu_lab" && !x.disabled_by && x.entity_id.startsWith("sensor."));
    const bk = (re) => { const x = bam.find((e) => re.test(String(e.translation_key || "") + " " + e.entity_id)); return x ? x.entity_id : null; };
    KIT.prn = bam.length ? { progress: bk(/print_progress/), remain: bk(/remaining_time/), stage: bk(/current_stage|\bstage\b/), status: bk(/print_status/), task: bk(/task_name|gcode_file|subtask/), layer: bk(/current_layer/), layers: bk(/total_layer/) } : null;
    if (KIT.prn) ids.push(...Object.values(KIT.prn));
    // home server (Unraid): CPU temperature and load
    const ur = allStates.filter((st) => st.entity_id.startsWith("sensor.") && /eddo.?nas|unraid/.test(st.entity_id + " " + String(st.attributes.friendly_name || "").toLowerCase()) && ok(st.entity_id));
    const uf = (re) => { const x = ur.find((st) => re.test(st.entity_id)); return x ? x.entity_id : null; };
    KIT.nas = H.server ? { ...H.server, temp: uf(/cpu_temp/), load: uf(/cpu_(usage|utili[sz]ation|load)/), ram: uf(/(ram|memory)_(usage|utili[sz]ation|used)/), array: uf(/array_(usage|utili[sz]ation|used)/) } : null;
    if (KIT.nas) ids.push(KIT.nas.temp, KIT.nas.load, KIT.nas.ram, KIT.nas.array);
    // office AC: the climate device flagged ac: true in the model
    const acDev = devices.find((d) => d.ac);
    KIT.ac = acDev ? { d: acDev, id: acDev.ids.find((x) => x.startsWith("climate.")) || null } : null;
    KIT.built = false;
    return ids.filter(Boolean);
  }
  const roomPt = (r, u, v, y) => [r.x + u * r.w, r.y + y, r.z + v * r.d];
  function buildKit() {
    const root = LIVE.dyn; if (!root) return;
    KIT.built = true;
    const lm = (c, o) => new T.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
    const mm = (c) => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending });
    const edgeBox = (w, h, d, c, o) => new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(w, h, d)), lm(c, o));
    // appliances: a ring floating over each one (spins while running, solid when done)
    for (const a of KIT.appl) {
      const r = a.d.roomRef, [x, y, z] = roomPt(r, a.d.u, a.d.v, 1.15), g = new T.Group(); g.position.set(x, y, z); root.add(g);
      const ring = new T.Mesh(new T.RingGeometry(0.17, 0.2, 40, 1, 0, Math.PI * 1.4), mm(0x6fd6ff)); ring.rotation.x = -Math.PI / 2; g.add(ring);
      const full = new T.Mesh(new T.RingGeometry(0.17, 0.2, 40), mm(0x5fe0a8)); full.rotation.x = -Math.PI / 2; g.add(full);
      const prog = new T.Mesh(new T.RingGeometry(0.21, 0.225, 60, 1, 0, Math.PI * 2), mm(0xffffff)); prog.rotation.x = -Math.PI / 2; g.add(prog);
      a.mesh = { g, ring, full, prog };
    }
    // kitchen appliances: a small model of each, standing against its nearest wall
    for (const d of devices.filter((x) => x.kind === "appliance" && /wash|dish|dry|tumble|coffee/i.test(x.name))) {
      const r = d.roomRef, kind = /coffee/i.test(d.name) ? "coffee" : /dish/i.test(d.name) ? "dish" : "drum";
      const [W, Hh, D] = kind === "coffee" ? [0.24, 0.34, 0.34] : [0.6, 0.84, 0.58], y0 = kind === "coffee" ? 0.92 : 0;
      const wallX = Math.min(d.u, 1 - d.u) * r.w < Math.min(d.v, 1 - d.v) * r.d;
      const nx = wallX ? (d.u < 0.5 ? 1 : -1) : 0, nz = wallX ? 0 : (d.v < 0.5 ? 1 : -1);
      const x = wallX ? (d.u < 0.5 ? r.x : r.x + r.w) + nx * (D / 2 + 0.03) : r.x + d.u * r.w;
      const z = wallX ? r.z + d.v * r.d : (d.v < 0.5 ? r.z : r.z + r.d) + nz * (D / 2 + 0.03);
      const g = new T.Group(); g.position.set(x, r.y + y0, z); g.rotation.y = Math.atan2(nx, nz); root.add(g);   // local +z faces into the room
      const pts = [], L = (a, b) => pts.push(...a, ...b), fz = D / 2 + 0.002;
      const box = (x0, x1, ya, yb, z0, z1) => { const c = [[x0, ya, z0], [x1, ya, z0], [x1, ya, z1], [x0, ya, z1]]; c.forEach((p, i) => { const q = c[(i + 1) % 4]; L(p, q); L([p[0], yb, p[2]], [q[0], yb, q[2]]); L(p, [p[0], yb, p[2]]); }); };
      const circ = (cx, cy, rr, n = 24) => { for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; L([cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr, fz], [cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr, fz]); } };
      box(-W / 2, W / 2, 0, Hh, -D / 2, D / 2);
      if (kind === "drum") {                       // front loader: control strip, dial, porthole door
        L([-W / 2, Hh - 0.14, fz], [W / 2, Hh - 0.14, fz]); circ(W / 2 - 0.1, Hh - 0.07, 0.035, 12); L([-W / 2 + 0.05, Hh - 0.07, fz], [-W / 2 + 0.2, Hh - 0.07, fz]);
        circ(0, Hh * 0.45, 0.2); circ(0, Hh * 0.45, 0.14); L([-W / 2 + 0.05, 0.06, fz], [W / 2 - 0.05, 0.06, fz]);
      } else if (kind === "dish") {                // dishwasher: control strip, handle, door panel
        L([-W / 2, Hh - 0.1, fz], [W / 2, Hh - 0.1, fz]); L([-0.12, Hh - 0.16, fz + 0.02], [0.12, Hh - 0.16, fz + 0.02]);
        box(-W / 2 + 0.03, W / 2 - 0.03, 0.1, Hh - 0.12, D / 2 - 0.004, D / 2); L([-W / 2, 0.1, fz], [W / 2, 0.1, fz]);
      } else {                                     // coffee machine: drip tray, spout, cup
        L([-W / 2 + 0.03, 0.06, fz], [W / 2 - 0.03, 0.06, fz]); L([0, 0.24, fz - 0.02], [0, 0.19, fz - 0.02]);
        box(-0.035, 0.035, 0.07, 0.15, D / 2 - 0.1, D / 2 - 0.03); L([-W / 2, Hh - 0.06, fz], [W / 2, Hh - 0.06, fz]);
      }
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
      const lines = new T.LineSegments(geo, lm(C.edge, 0.55)); g.add(lines);
      d.model = { g, lines };
    }
    // 3D printer: the bed and a block that rises with the print
    const pd = devices.find((d) => d.kind === "printer");
    if (KIT.prn && pd) {
      const r = pd.roomRef, [x, y, z] = roomPt(r, pd.u, pd.v, 0.78), g = new T.Group(); g.position.set(x, y, z); root.add(g);
      const bed = edgeBox(0.26, 0.01, 0.26, 0xffc25a, 0); g.add(bed);
      const fill = new T.Mesh(new T.BoxGeometry(0.16, 1, 0.16), mm(0xffc25a)); fill.position.y = 0.005; fill.scale.y = 0.001; g.add(fill);
      const cage = edgeBox(0.3, 0.34, 0.3, 0xffc25a, 0); cage.position.y = 0.17; g.add(cage);
      KIT.prn.mesh = { g, bed, fill, cage, k: 0 };
      KIT.prn.dev = pd;
    }
    // office AC: a wall-mounted mini split, with airflow
    if (KIT.ac) {
      const d = KIT.ac.d, r = d.roomRef, y = r.y + (d.mountY || 2.0);
      // on whichever wall it's nearest, facing into the room
      const wallX = Math.min(d.u, 1 - d.u) * r.w < Math.min(d.v, 1 - d.v) * r.d, face = wallX ? (d.u < 0.5 ? 1 : -1) : (d.v < 0.5 ? 1 : -1);
      const x = wallX ? (d.u < 0.5 ? r.x + 0.02 : r.x + r.w - 0.02) : r.x + d.u * r.w, z = wallX ? r.z + d.v * r.d : (d.v < 0.5 ? r.z + 0.02 : r.z + r.d - 0.02);
      const g = new T.Group(); g.position.set(x, y, z); root.add(g);
      g.rotation.y = wallX ? (face > 0 ? Math.PI / 2 : -Math.PI / 2) : (face > 0 ? 0 : Math.PI);
      const W = 0.85, Hh = 0.28, D = 0.2, pts = [];
      const P = (a, b) => pts.push(...a, ...b);
      // body: flat back, rounded front (approximated with a chamfer), vent slot and flap underneath
      const prof = [[0, -Hh / 2], [D * 0.75, -Hh / 2], [D, -Hh / 4], [D, Hh / 2 - 0.04], [D * 0.8, Hh / 2], [0, Hh / 2]];
      for (const sx of [-W / 2, W / 2]) prof.forEach((p, i) => { const q = prof[(i + 1) % prof.length]; P([sx, p[1], p[0]], [sx, q[1], q[0]]); });
      prof.forEach((p) => P([-W / 2, p[1], p[0]], [W / 2, p[1], p[0]]));
      P([-W / 2 + 0.05, -Hh / 2 + 0.02, D * 0.6], [W / 2 - 0.05, -Hh / 2 + 0.02, D * 0.6]);   // vent
      P([W / 2 - 0.08, Hh / 2 - 0.06, D * 0.98], [W / 2 - 0.05, Hh / 2 - 0.06, D * 0.98]);     // status light
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
      const body = new T.LineSegments(geo, lm(C.edge, 0.7)); g.add(body);
      const flap = new T.Group(); flap.position.set(0, -Hh / 2, D * 0.75); g.add(flap);
      const fg = new T.BufferGeometry(); fg.setAttribute("position", new T.Float32BufferAttribute([-W / 2 + 0.04, 0, 0, W / 2 - 0.04, 0, 0, -W / 2 + 0.04, 0, 0, -W / 2 + 0.04, 0, 0.09, W / 2 - 0.04, 0, 0, W / 2 - 0.04, 0, 0.09, -W / 2 + 0.04, 0, 0.09, W / 2 - 0.04, 0, 0.09], 3));
      const flapL = new T.LineSegments(fg, lm(C.edge, 0.7)); flap.add(flapL);
      // airflow: streaks that leave the vent and fall into the room
      const N = 60, ag = new T.BufferGeometry(); ag.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(N * 6), 3));
      const air = new T.LineSegments(ag, new T.LineBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending })); air.frustumCulled = false; g.add(air);
      KIT.ac.mesh = { g, body, flap, flapL, air, seeds: Array.from({ length: N }, () => [Math.random() * W - W / 2, Math.random(), Math.random()]), W, Hh, D, k: 0 };
    }
    // home server: a small rack where it lives
    if (KIT.nas && KIT.nas.room) {
      const r = rooms.find((x) => x.id === KIT.nas.room);
      if (r) {
        const s = KIT.nas, [x, y, z] = roomPt(r, s.u, s.v, s.y || 0), g = new T.Group(); g.position.set(x, y, z); root.add(g);
        const w = s.w || 0.24, h = s.h || 0.42, d = s.d || 0.42;
        const box = edgeBox(w, h, d, C.edge, 0.6); box.position.y = h / 2; g.add(box);
        const pts = []; for (let i = 1; i <= 4; i++) { const yy = h * 0.15 + i * h * 0.16; pts.push(-w / 2 + 0.03, yy, d / 2 + 0.001, w / 2 - 0.06, yy, d / 2 + 0.001); }
        const bg = new T.BufferGeometry(); bg.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); const bays = new T.LineSegments(bg, lm(C.edge, 0.45)); g.add(bays);
        const led = new T.Mesh(new T.SphereGeometry(0.02, 8, 6), new T.MeshBasicMaterial({ color: 0x5fe0a8, transparent: true, opacity: 0.9, depthWrite: false })); led.position.set(w / 2 - 0.035, h - 0.05, d / 2 + 0.01); g.add(led);
        s.mesh = { g, box, bays, led, room: r };
      }
    }
  }
  const fmtMins = (m) => m == null ? null : m < 60 ? `${Math.round(m)} MIN` : `${Math.floor(m / 60)} H ${String(Math.round(m % 60)).padStart(2, "0")} MIN`;
  function minsLeft(id) {
    const x = id && states.get(id); if (!x || /^(unknown|unavailable)$/.test(x.s)) return null;
    const t = Date.parse(x.s); if (!Number.isFinite(+x.s) && Number.isFinite(t)) return Math.max(0, (t - Date.now()) / 60000);   // a finish time
    const v = +x.s, u = String(x.a.unit_of_measurement || "min").toLowerCase();
    return !Number.isFinite(v) ? null : /^h/.test(u) ? v * 60 : /^s/.test(u) ? v / 60 : v;
  }
  function updateKit(dt, now) {
    if (!LIVE.dyn) return;
    if (!KIT.built) buildKit();
    const k = Math.min(1, dt * 3), wall = Date.now(), quiet = heatMode || energyMode;
    for (const a of KIT.appl) {
      if (!a.mesh) continue;
      const st = strOf(a.state), w = devWatts(a.d), pct = numOf(a.progress);
      const running = st ? /run|active|delayed|pause/i.test(st) : w != null && w > 6;
      if (a.on && !running) a.done = wall;                     // just finished
      if (running) a.done = 0;
      if (st && /finish|end/i.test(st)) a.done = a.done || wall;
      a.on = running; a.pct = pct; a.left = minsLeft(a.remain);
      const done = !running && a.done && wall - a.done < 90 * 60e3, hide = hiddenFloor(a.d.roomRef.floor) || quiet;
      a.k += (((running || done) && !hide ? 1 : 0) - a.k) * k;
      a.mesh.ring.material.opacity = running ? 0.75 * a.k : 0; a.mesh.ring.rotation.z = -now / 500;
      a.mesh.full.material.opacity = done ? (0.55 + 0.25 * Math.sin(now / 400)) * a.k : 0;
      a.mesh.prog.material.opacity = running && pct != null ? 0.6 * a.k : 0;
      if (running && pct != null) { const want = Math.max(0.02, Math.min(1, pct / 100)); if (a.mesh.pv !== want) { a.mesh.pv = want; a.mesh.prog.geometry.dispose(); a.mesh.prog.geometry = new T.RingGeometry(0.21, 0.225, 60, 1, Math.PI / 2, -Math.PI * 2 * want); } }
      a.done = done ? a.done : (running ? 0 : a.done); a.showDone = done;
      if (a.d.model) { const m = a.d.model.lines.material; m.color.setHex(running ? 0x6fd6ff : done ? 0x5fe0a8 : C.edge); m.opacity = hide ? 0.06 : running || done ? 0.75 : 0.45; }
    }
    for (const d of devices) if (d.model && /coffee/i.test(d.name)) { const on = d.ids.some((id) => (states.get(id) || {}).s === "on"), m = d.model.lines.material; m.color.setHex(on ? 0xffb36b : C.edge); m.opacity = hiddenFloor(d.roomRef.floor) || quiet ? 0.06 : on ? 0.8 : 0.45; }
    const P = KIT.prn;
    if (P && P.mesh) {
      const status = (strOf(P.status) || strOf(P.stage) || "").toLowerCase(), pct = numOf(P.progress);
      const printing = /running|printing|prepare|heating|slicing|pause/.test(status) || (pct != null && pct > 0 && pct < 100 && !/idle|finish|fail|offline/.test(status));
      const hide = hiddenFloor(P.dev.roomRef.floor) || quiet;
      P.mesh.k += ((printing && !hide ? 1 : 0) - P.mesh.k) * k;
      P.printing = printing; P.pct = pct; P.left = minsLeft(P.remain); P.status = status;
      P.mesh.bed.material.opacity = 0.8 * P.mesh.k; P.mesh.cage.material.opacity = 0.35 * P.mesh.k;
      const hgt = Math.max(0.002, 0.22 * Math.min(1, (pct || 0) / 100)); P.mesh.fill.scale.y = hgt; P.mesh.fill.position.y = hgt / 2 + 0.005;
      P.mesh.fill.material.opacity = (0.28 + 0.12 * Math.sin(now / 350)) * P.mesh.k;
    }
    const A = KIT.ac;
    if (A && A.mesh) {
      const st = A.id && states.get(A.id), mode = st ? String(st.a.hvac_action || st.s || "off") : "off";
      const on = st && st.s !== "off" && !/^(unknown|unavailable)$/.test(st.s), m = A.mesh;
      const col = /cool/.test(mode) ? 0x6fd6ff : /heat/.test(mode) ? 0xffa64a : /dry/.test(mode) ? 0x7fe08a : 0xdfe8ea;
      const hide = hiddenFloor(A.d.roomRef.floor) || energyMode;
      m.k += ((on && !hide ? 1 : 0) - m.k) * k;
      m.flap.rotation.x = 0.9 * m.k; m.body.material.color.setHex(on ? col : C.edge); m.flapL.material.color.setHex(on ? col : C.edge);
      m.body.material.opacity = hide ? 0.06 : 0.7; m.flapL.material.opacity = hide ? 0.06 : 0.7;
      m.air.material.color.setHex(col); m.air.material.opacity = 0.45 * m.k;
      if (m.k > 0.01) {
        const pos = m.air.geometry.attributes.position.array, sp = /heat/.test(mode) ? 0.55 : 0.8;
        m.seeds.forEach((s, i) => {
          s[1] = (s[1] + dt * sp * (0.6 + 0.4 * s[2])) % 1;
          const t = s[1], x0 = s[0], zf = m.D * 0.8 + t * 1.6, yf = -m.Hh / 2 - t * t * 1.1, j = i * 6, len = 0.12;
          pos[j] = x0; pos[j + 1] = yf; pos[j + 2] = zf; pos[j + 3] = x0; pos[j + 4] = yf + len * 0.6 * t + 0.02; pos[j + 5] = zf - len;
        });
        m.air.geometry.attributes.position.needsUpdate = true;
      }
      A.mode = on ? mode : "off"; A.st = st;
    }
    const S = KIT.nas;
    if (S && S.mesh) {
      const t = numOf(S.temp), up = t != null, hide = hiddenFloor(S.mesh.room.floor) || energyMode;
      S.mesh.led.material.color.setHex(!up ? 0xff5a4a : t >= 85 ? 0xff5a4a : t >= 70 ? 0xffa64a : 0x5fe0a8);
      S.mesh.led.material.opacity = hide ? 0.1 : !up ? 0.5 + 0.5 * Math.sin(now / 200) : 0.6 + 0.3 * Math.sin(now / 900);
      S.mesh.box.material.opacity = hide ? 0.05 : 0.6; S.mesh.bays.material.opacity = hide ? 0.04 : 0.45;
      S.up = up; S.t = t;
    }
  }
  function placeKit() {
    if (!LIVE.root || !labelsEl) return;
    const quiet = heatMode || energyMode;
    KIT.appl.forEach((a, i) => {
      const show = a.mesh && a.k > 0.3 && !quiet;
      const what = a.on ? [a.pct != null ? Math.round(a.pct) + "%" : "RUNNING", a.left != null ? fmtMins(a.left) + " LEFT" : ""].filter(Boolean).join(" · ") : "DONE";
      const p = a.mesh ? a.mesh.g.position : { x: 0, y: 0, z: 0 };
      liveTag("appl" + i, p.x, p.y + 0.35, p.z, `<b>${esc(a.d.name.toUpperCase())}</b><span data-ok="${!a.on}">${what}</span>`, show, "eddo-kit-tag");
    });
    const P = KIT.prn;
    if (P && P.mesh) {
      const p = P.mesh.g.position, task = strOf(P.task);
      const lay = numOf(P.layer) != null && numOf(P.layers) ? `LAYER ${numOf(P.layer)}/${numOf(P.layers)}` : "";
      liveTag("prn", p.x, p.y + 0.7, p.z, `<b>EDDO-PRINT · ${P.pct != null ? Math.round(P.pct) + "%" : "PRINTING"}</b><span>${[P.left != null ? fmtMins(P.left) + " LEFT" : "", lay].filter(Boolean).join(" · ")}</span>${task ? `<span class="t">${esc(task.replace(/\.(gcode|3mf)$/i, "").slice(0, 32))}</span>` : ""}`, P.printing && P.mesh.k > 0.3 && !quiet, "eddo-kit-tag");
    }
    const S = KIT.nas;
    if (S && S.mesh) {
      const p = S.mesh.g.position, r = S.mesh.room, near = focused === r || floorSel === r.floor;
      const extra = [numOf(S.load) != null ? `CPU ${Math.round(numOf(S.load))}%` : "", numOf(S.ram) != null ? `RAM ${Math.round(numOf(S.ram))}%` : ""].filter(Boolean).join(" · ");
      liveTag("nas", p.x, p.y + (S.h || 0.42) + 0.35, p.z, `<b>${esc((S.name || "EDDO-NAS").toUpperCase())}</b><span data-warn="${!S.up || S.t >= 70}">${S.up ? `${Math.round(S.t)}°C${extra ? " · " + extra : ""}` : "OFFLINE"}</span>`, !hiddenFloor(r.floor) && !energyMode && (near || !S.up || S.t >= 85), "eddo-kit-tag");
    }
  }

  // ------------------------------------------------------------ night sky and chimney smoke
  // a star dome that turns with the view (dims with cloud cover, fades out by day), a few twinkling stars and the odd
  // shooting star; and a whisper of smoke from the chimney while the heating is on
  const SKY = { dome: null, twinkles: [], shoot: null, nextShoot: 0, smoke: [], smokeK: 0, emitT: 0 };
  function glowTex(size, soft) {
    const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d");
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(soft, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, size, size); return new T.CanvasTexture(c);
  }
  // a crisp 2D night sky behind the model: a pre-drawn star field (with the Milky Way) that pans as the view turns,
  // per-star twinkle, the odd shooting star, and aurora curtains low in the north. Fades by day and with cloud.
  const NS = { el: null, ctx: null, field: null, fw: 0, fh: 0, tw: [], aur: null, actx: null, shoot: null, next: 0, k: 0, lastDraw: 0 };
  function nsBuild() {
    if (NS.el || !skyEl) return;
    NS.el = document.createElement("canvas"); NS.el.className = "eddo-house-night"; skyEl.append(NS.el);
    NS.ctx = NS.el.getContext("2d");
    NS.aur = document.createElement("canvas"); NS.aur.width = 360; NS.aur.height = 120; NS.actx = NS.aur.getContext("2d");
  }
  function nsField(W, Hh) {
    // the field is 3 screens wide (it wraps as you spin) and a bit taller than the screen
    const dpr = Math.min(2, window.devicePixelRatio || 1), fw = Math.round(W * 3), fh = Math.round(Hh * 1.4);
    const c = document.createElement("canvas"); c.width = fw * dpr; c.height = fh * dpr; const g = c.getContext("2d"); g.scale(dpr, dpr);
    const R = (a, b) => a + Math.random() * (b - a);
    const band = (x) => fh * 0.38 + Math.sin(x / fw * Math.PI * 2 * 1.5 + 0.8) * fh * 0.16;   // the Milky Way's path
    // nebula glow of the Milky Way: soft overlapping clouds, cool in the core with a warm edge, and a few dark lanes
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 900; i++) {
      const x = R(0, fw), y = band(x) + (Math.random() - 0.5) * fh * 0.14 * (0.4 + Math.random()), r = R(20, 90);
      const hue = Math.random() < 0.25 ? "255,210,180" : Math.random() < 0.5 ? "170,190,255" : "200,215,240";
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${hue},${R(0.008, 0.022).toFixed(3)})`); gr.addColorStop(1, `rgba(${hue},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 160; i++) { const x = R(0, fw), y = band(x) + R(-12, 12), r = R(10, 34); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(0,0,0,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.globalCompositeOperation = "lighter";
    // stars: thousands of faint pin-pricks, denser along the band, with a few bright ones carrying a small halo
    const tints = ["255,255,255", "210,225,255", "255,238,215", "225,235,255", "255,220,200"];
    const n = Math.round(fw * fh / 420);
    for (let i = 0; i < n; i++) {
      const inBand = Math.random() < 0.45, x = R(0, fw), y = inBand ? band(x) + (Math.random() - 0.5) * fh * 0.12 * (Math.random() + 0.3) : R(0, fh);
      const m = Math.random() ** 3.2;                     // most are faint
      const a = 0.12 + m * 0.85, r = 0.35 + m * 1.05, t = tints[(Math.random() * tints.length) | 0];
      g.fillStyle = `rgba(${t},${a.toFixed(3)})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      if (m > 0.8) { const h = r * 5; const gr = g.createRadialGradient(x, y, 0, x, y, h); gr.addColorStop(0, `rgba(${t},.28)`); gr.addColorStop(1, `rgba(${t},0)`); g.fillStyle = gr; g.fillRect(x - h, y - h, h * 2, h * 2); }
      if (m > 0.86 && NS.tw.length < 140) NS.tw.push({ x, y, r, t, ph: R(0, 9), sp: R(0.5, 2.2) });
    }
    NS.field = c; NS.fw = fw; NS.fh = fh;
  }
  function nsAurora(t) {
    // curtains: vertical rays whose height and brightness ripple along the arc, green at the base fading to violet
    const g = NS.actx, W = NS.aur.width, Hh = NS.aur.height;
    g.clearRect(0, 0, W, Hh); g.globalCompositeOperation = "lighter";
    for (let x = 0; x < W; x += 1) {
      const u = x / W, edge = Math.sin(Math.PI * u) ** 1.5;
      const wave = Math.sin(u * 9 + t * 0.35) * 0.5 + Math.sin(u * 23 - t * 0.6) * 0.3 + Math.sin(u * 51 + t * 1.3) * 0.2;
      const base = Hh * (0.78 + 0.08 * Math.sin(u * 5 + t * 0.2)), top = base - Hh * (0.35 + 0.35 * (0.5 + 0.5 * wave));
      const a = edge * (0.25 + 0.75 * Math.max(0, 0.5 + 0.5 * Math.sin(u * 37 + t * 0.9 + Math.sin(u * 7 + t * 0.3) * 2)));
      const gr = g.createLinearGradient(0, base, 0, top);
      gr.addColorStop(0, "rgba(80,255,170,0)"); gr.addColorStop(0.12, `rgba(80,255,170,${(0.5 * a).toFixed(3)})`); gr.addColorStop(0.4, `rgba(60,230,190,${(0.35 * a).toFixed(3)})`);
      gr.addColorStop(0.75, `rgba(110,120,255,${(0.16 * a).toFixed(3)})`); gr.addColorStop(1, "rgba(150,90,255,0)");
      g.fillStyle = gr; g.fillRect(x, top, 1, base - top);
    }
  }
  function updateStars(dt, now) {
    if (!skyEl) return; nsBuild(); if (!NS.ctx) return;
    const o = window.eddoOutside, cloud = o && Number.isFinite(+o.cloud) ? +o.cloud / 100 : 0;
    const night = Math.max(0, Math.min(1, 1 - dayK * 1.7)), want = night * (1 - 0.8 * cloud) * (heatMode || energyMode ? 0.5 : 1);
    NS.k += (want - NS.k) * Math.min(1, dt * 0.8);
    NS.el.style.opacity = NS.k.toFixed(3);
    if (NS.k < 0.01) return;
    const W = skyEl.clientWidth, Hh = skyEl.clientHeight; if (!W || !Hh) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (NS.el.width !== Math.round(W * dpr) || NS.el.height !== Math.round(Hh * dpr)) { NS.el.width = Math.round(W * dpr); NS.el.height = Math.round(Hh * dpr); NS.field = null; NS.tw = []; }
    if (!NS.field) nsField(W, Hh);
    const g = NS.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    // pan with the camera: turning sweeps the field sideways (one full turn = the whole field), tilting moves it up/down
    const tg = view.target || new T.Vector3(), az = Math.atan2(camera.position.x - tg.x, camera.position.z - tg.z), el = Math.asin(Math.max(-1, Math.min(1, (camera.position.y - tg.y) / camera.position.distanceTo(tg))));
    const ox = (((az / (Math.PI * 2)) * NS.fw) % NS.fw + NS.fw) % NS.fw;
    // the horizon: a point far away at ground level, straight ahead. The sky sits above it, like a sky box
    const fwd0 = tg.clone().sub(camera.position).setY(0); if (fwd0.lengthSq() < 1e-6) fwd0.set(0, 0, -1);
    const hp = camera.position.clone().add(fwd0.normalize().multiplyScalar(300)).setY(0).project(camera);
    const hy = Math.max(-Hh, Math.min(Hh * 2, (-hp.y * 0.5 + 0.5) * Hh)), oy = NS.fh - hy;   // field's bottom edge sits on the horizon
    if (hy <= 0) { NS.el.style.opacity = "0"; return; }   // looking straight down: no sky in view
    for (const sx of [-ox, NS.fw - ox]) if (sx < W && sx + NS.fw > 0) g.drawImage(NS.field, 0, 0, NS.field.width, NS.field.height, sx, -oy, NS.fw, NS.fh);
    // twinkles
    g.globalCompositeOperation = "lighter";
    for (const s of NS.tw) {
      let x = s.x - ox; if (x < -10) x += NS.fw; if (x > W + 10) continue; const y = s.y - oy; if (y < -10 || y > Hh + 10) continue;
      const a = Math.max(0, Math.sin(now / 1000 * s.sp + s.ph)) ** 6 * 0.75; if (a < 0.02) continue;
      g.fillStyle = `rgba(${s.t},${a.toFixed(3)})`; g.fillRect(x - s.r * 2.6, y - 0.4, s.r * 5.2, 0.8); g.fillRect(x - 0.4, y - s.r * 2.6, 0.8, s.r * 5.2);   // a small sparkle cross
    }
    // aurora, low in the north: placed where north is on screen, fading out when north is behind you
    if (plinth && pivot) {
      const n = plinth.north.clone(); pivot.children[0].localToWorld(n);
      const c0 = pivot.children[0].localToWorld(new T.Vector3(0, 0, 0)), north = n.sub(c0).setY(0).normalize();
      const fwd = tg.clone().sub(camera.position).setY(0).normalize(), facing = fwd.dot(north);
      const side = fwd.x * north.z - fwd.z * north.x;   // which side of the view north is on
      const vis = Math.max(0, facing + 0.35) / 1.35;
      if (vis > 0.02) {
        if (now - (NS.aT || 0) > 80) { nsAurora(now / 1000); NS.aT = now; }   // the curtains move slowly: redraw them ~12 times a second
        const aw = W * 1.15, cx = W / 2 - side * W * 0.55, ah = Math.min(hy, Hh * 0.45);
        g.globalAlpha = Math.min(1, vis * 1.3) * 0.85; g.imageSmoothingEnabled = true;
        g.drawImage(NS.aur, cx - aw / 2, hy - ah * 0.86, aw, ah);   // its base (86% down the curtain canvas) on the horizon
        g.globalAlpha = 1;
      }
    }
    // shooting star
    if (!NS.shoot && now > NS.next) { if (NS.next) NS.shoot = { x: Math.random() * W * 0.8 + W * 0.1, y: Math.random() * Hh * 0.3, dx: (Math.random() < 0.5 ? -1 : 1) * (380 + Math.random() * 260), dy: 140 + Math.random() * 120, t: 0 }; NS.next = now + 20000 + Math.random() * 50000; }
    if (NS.shoot) {
      const s = NS.shoot; s.t += dt / 0.8; const hx = s.x + s.dx * s.t, hy = s.y + s.dy * s.t, tx = hx - s.dx * 0.18, ty = hy - s.dy * 0.18;
      const gr = g.createLinearGradient(tx, ty, hx, hy); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, `rgba(255,255,255,${(0.9 * Math.sin(Math.PI * Math.min(1, s.t))).toFixed(3)})`);
      g.strokeStyle = gr; g.lineWidth = 1.2; g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke();
      if (s.t >= 1) NS.shoot = null;
    }
    g.globalCompositeOperation = "destination-out";
    const fade = g.createLinearGradient(0, hy - Hh * 0.08, 0, hy + 2); fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = fade; g.fillRect(0, hy - Hh * 0.08, W, Hh * 0.08 + 2); g.fillStyle = "#000"; g.fillRect(0, hy + 2, W, Hh);
    g.globalCompositeOperation = "source-over";
  }
  function updateSmoke(dt, now) {
    const ch = H.shell && (H.shell.chimneys || [])[0]; if (!ch || !LIVE.root || !T) return;
    if (!SKY.puffTex) SKY.puffTex = glowTex(64, 0.45);
    const heating = !!gasBurning() && !energyMode;
    SKY.smokeK += ((heating ? 1 : 0) - SKY.smokeK) * Math.min(1, dt * 0.5);
    const o = window.eddoOutside, wind = o ? Math.min(12, (o.wind || 0) / 3.6) : 1.5, [wx, wz] = o ? planDir(((o.windDir || 0) + 180) * Math.PI / 180) : [0.3, 0.3];
    // emit from the middle pot
    SKY.emitT -= dt;
    if (SKY.smokeK > 0.05 && SKY.emitT <= 0 && SKY.smoke.length < 22) {
      SKY.emitT = 0.45 + Math.random() * 0.35;
      const sp = new T.Sprite(new T.SpriteMaterial({ map: SKY.puffTex, color: 0xcdd6da, transparent: true, opacity: 0, depthWrite: false }));
      const n = ch.pots || 1, xc = ch.x0 + (ch.x1 - ch.x0) * (Math.ceil(n / 2)) / (n + 1);
      sp.position.set(xc + (Math.random() - 0.5) * 0.08, ch.top + 0.55, (ch.z0 + ch.z1) / 2 + (Math.random() - 0.5) * 0.08);
      LIVE.root.add(sp); SKY.smoke.push({ sp, t: 0, life: 5 + Math.random() * 3, dx: (Math.random() - 0.5) * 0.15, dz: (Math.random() - 0.5) * 0.15 });
    }
    for (let i = SKY.smoke.length - 1; i >= 0; i--) {
      const p = SKY.smoke[i]; p.t += dt / p.life;
      if (p.t >= 1) { LIVE.root.remove(p.sp); p.sp.material.dispose(); SKY.smoke.splice(i, 1); continue; }
      const drift = 0.12 + wind * 0.09;
      p.sp.position.x += (wx * drift + p.dx) * dt; p.sp.position.z += (wz * drift + p.dz) * dt; p.sp.position.y += (0.55 - p.t * 0.25) * dt;
      const s = 0.35 + p.t * 1.6; p.sp.scale.set(s, s, 1);
      p.sp.material.opacity = 0.16 * SKY.smokeK * Math.sin(Math.PI * Math.min(1, p.t * 1.4)) * (1 - p.t * 0.4) * (0.55 + 0.45 * (1 - dayK * 0.5));
    }
  }

  // ------------------------------------------------------------ tab
  let listEl = null, sliding = null;
  const FLOORS = [["", "ALL"], ["ground", "GROUND"], ["first", "FIRST"], ["second", "SECOND"], ["garden", "OFFICE"]];
  let barEl = null;
  const EDNET_MARK = `<svg viewBox="0 0 632.25 151.85" aria-label="EDNET" role="img"><path fill="currentColor" d="M56.12 94.51 L102.28 94.51 L108.6 59.28 L62.44 59.28 L65.84 38.87 L115.65 38.87 L128.28 0 L26.72 0 L0 151.85 L102.77 151.85 L109.57 112.97 L52.96 112.97 L56.12 94.51ZM521.22 0 L519.27 0 L419.66 0 L392.94 151.85 L495.71 151.85 L502.51 112.97 L445.9 112.97 L449.06 94.51 L495.22 94.51 L501.54 59.28 L455.38 59.28 L458.78 38.87 L501.03 38.87 L508.58 38.87 L545.51 38.87 L525.83 151.85 L572 151.85 L591.67 38.87 L625.2 38.87 L632.25 0 L521.22 0ZM259.72,46.89c0-16.52-4.41-28.46-13.24-35.84-8.83-7.37-23.69-11.05-44.58-11.05h-64.63l-26.72,151.85h64.63c26.08,0,44.98-5.83,56.73-17.49,11.74-11.66,20.04-31.1,24.9-58.31,1.94-11.01,2.92-20.73,2.92-29.15ZM211.37,51.75l-8.5,48.35c-.97,5.51-3,9.03-6.07,10.57-3.08,1.54-7.77,2.31-14.09,2.31h-19.19l12.88-74.1h19.19c5.5,0,9.55.57,12.15,1.7,2.59,1.14,3.89,3.56,3.89,7.29,0,1.62-.08,2.92-.24,3.89ZM360.87,0l-11.66,65.6h-1.94c.32-2.59.49-4.9.49-6.92s-.24-3.6-.73-4.74L322.24,0h-43.49l-26.73,151.85h46.16l11.42-65.6h1.94c-.33,2.59-.49,4.9-.49,6.92s.32,3.61.97,4.74l24.78,53.94h43.49L407.03,0h-46.16Z"/></svg>`;
  const VIEW_BTNS = [["spin", "SPIN"], ["tour", "TOUR"], ["front", "FRONT"], ["back", "BACK"], ["side", "SIDE"], ["top", "TOP"]];
  // The bar is built once and then only updated, so its sliding highlight can animate between buttons.
  function updateBar() {
    if (!barEl || !barEl.isConnected) return;
    if (!barEl.dataset.built) {
      barEl.dataset.built = "1";
      barEl.innerHTML =
        `<div class="eddo-house-tabs" data-group="floor"><i class="eddo-house-ind"></i>${FLOORS.map(([id, l]) => `<button data-house-floor="${id}">${l}</button>`).join("")}</div>` +
        `<div class="eddo-house-views"><span class="eddo-house-cap">VIEW</span>${VIEW_BTNS.map(([id, l]) => `<button data-house-view="${id}">${l}</button>`).join("")}</div>` +
        `<div class="eddo-house-views"><span class="eddo-house-cap">SHOW</span><button data-house-mode="heat">HEAT</button><button data-house-mode="energy">ENERGY</button><button data-house-mode="on">WHAT'S ON</button><span class="eddo-house-sun"></span></div>`;
    }
    const cur = focused ? focused.floor : floorSel || "";
    barEl.querySelectorAll("[data-house-floor]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.houseFloor === cur && (!!focused || !!floorSel || (!cur && orbitMode !== "off" && !tour)))));
    const ind = barEl.querySelector(".eddo-house-ind"), on = barEl.querySelector('[data-house-floor][aria-pressed="true"]');
    if (on) { ind.style.width = on.offsetWidth + "px"; ind.style.left = on.offsetLeft + "px"; ind.style.opacity = "1"; } else ind.style.opacity = "0";
    const vOn = tour ? "tour" : orbitMode === "spin" ? "spin" : null;
    barEl.querySelectorAll("[data-house-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.houseView === vOn)));
    barEl.querySelector('[data-house-mode="heat"]').setAttribute("aria-pressed", String(heatMode));
    barEl.querySelector('[data-house-mode="energy"]').setAttribute("aria-pressed", String(energyMode));
    barEl.querySelector('[data-house-mode="on"]').setAttribute("aria-pressed", String(whatsOn));
    const sun = sunInfo ? `${sunInfo.up ? "☀" : "☾"} ${sunInfo.rise}–${sunInfo.set}` : "", se = barEl.querySelector(".eddo-house-sun");
    if (se.textContent !== sun) se.textContent = sun;
  }
  function devRow(d) {
    const st = d.st || devState(d), i = devices.indexOf(d), lid = lightOf(d), hasClim = d.ids.some((x) => x.startsWith("climate."));
    const action = d.cam ? ` data-house-cam="${d.cam}"` : canToggle(d) ? ` data-house-dev="${i}"` : " data-static";
    let row = `<div class="eddo-house-item" data-on="${st.active}" data-linked="${st.linked}"><button class="eddo-house-row"${action}><i style="--c:${st.active ? "#ffb36b" : "transparent"}"></i><span>${esc(d.name)}</span><em>${esc(d.cam ? "OPEN CAMERA ↗" : st.text)}</em></button>`;
    if (lid) { const pct = briPct(lid); row += `<div class="eddo-house-slider" data-bri="${esc(lid)}" style="--pct:${pct}%"><i></i></div>`; }
    if (hasClim) row += `<div class="eddo-house-clim"><button data-house-clim="${i}:-0.5" aria-label="Lower">−</button><button data-house-clim="${i}:0.5" aria-label="Raise">+</button><button data-house-clim="${i}:power">${st.active ? "TURN OFF" : "TURN ON"}</button></div>`;
    return row + `</div>`;
  }
  function carPanel() {
    const c = carData();
    if (!c.linked) return `<div class="eddo-house-head"><h3 class="eddo-house-room">Car</h3><button class="eddo-house-off" data-house-back>BACK</button></div><p class="wb-muted">No car found. Add the Volvo integration in Home Assistant, or turn on the car sensors in the Home Assistant app on the car.</p>`;
    const ago = c.last ? Math.round((Date.now() - c.last) / 60000) : null;
    const tidy = (t) => t ? String(t).replace(/_/g, " ") : t;
    const mi = (v) => v != null ? v.toLocaleString("en-GB") + " mi" : null;
    // compact meters: label, bar, % (+ litres / electric miles when they add something)
    const meter = (label, v, warn, col, extra) => v == null ? "" : `<div class="eddo-car-m" data-low="${v < warn}"><span>${label}</span><i style="--v:${v}%;--c:${col}"></i><b>${v}%</b>${extra ? `<small>${extra}</small>` : ""}</div>`;
    const kv = (k, v, warn) => v == null || v === "" ? "" : `<span>${k}</span><em${warn ? ' data-warn="true"' : ""}>${esc(String(v).toUpperCase())}</em>`;
    const chip = (ok, good, bad) => `<span class="eddo-car-chip" data-ok="${ok}">${ok ? good : bad}</span>`;
    const btn = (act, label, cls = "") => `<button data-car-act="${act}"${cls ? ` class="${cls}"` : ""}>${label}</button>`;
    let h = `<div class="eddo-car-panel"><div class="eddo-house-head"><h3 class="eddo-house-room">${esc(c.name)}</h3><button class="eddo-house-off" data-house-back>BACK</button></div>` +
      `<p class="wb-muted eddo-house-sub">${c.home ? "PARKED AT HOME" : "AWAY" + (c.where ? " · " + esc(c.where.toUpperCase()) : "")}${ago != null ? ` · UPDATED ${ago < 1 ? "JUST NOW" : ago < 60 ? ago + " MIN AGO" : Math.round(ago / 60) + " H AGO"}` : ""}</p>`;
    // range on the left, fuel / battery on the right
    h += `<div class="eddo-car-top">` + (c.range != null ? `<div class="eddo-car-rng"><b>${c.range}<small> mi</small></b><span>RANGE</span></div>` : "") +
      `<div class="eddo-car-ms">${meter("FUEL", c.fuel, 15, "#ffc25a", c.fuelL != null ? Math.round(c.fuelL) + " L" : "")}${meter("BATT", c.battery, 10, "#5fe0a8", c.rangeEv != null && c.rangeEv !== c.range ? c.rangeEv + " MI" : "")}</div></div>`;
    if (c.volvo) {
      h += `<div class="eddo-car-chips">` + (c.locked != null ? chip(c.locked, "LOCKED", "UNLOCKED") : "") + chip(!c.openDoors.length, "DOORS SHUT", "DOOR OPEN") +
        chip(!c.openWindows.length, "WINDOWS SHUT", "WINDOW OPEN") + (CAR.V.tyres.length ? chip(!c.tyreWarn.length, "TYRES OK", "CHECK TYRES") : "") +
        (c.engine != null ? chip(!c.engine, "ENGINE OFF", "ENGINE ON") : "") + `</div>`;
      const acts = [c.lockId ? (c.locked ? btn("unlock", CAR.confirmUnlock ? "TAP AGAIN" : "UNLOCK", CAR.confirmUnlock ? "warn" : "") : btn("lock", "LOCK")) : "",
        c.btn.climaStart ? btn("climaStart", "CLIMATE ON") : "", c.btn.climaStop ? btn("climaStop", "CLIMATE OFF") : "", c.btn.flash ? btn("flash", "FLASH") : ""].filter(Boolean);
      if (acts.length) h += `<div class="eddo-car-acts">${acts.join("")}</div>`;
    }
    if (c.health.length) h += `<div class="eddo-car-health">${c.health.map((x) => `<span data-ok="${x.ok}" title="${esc(x.bad.join(", "))}"><i></i>${x.name}</span>`).join("")}</div>`;
    else if (c.warnings.length) h += `<div class="eddo-car-kv">${kv("Warnings", c.warnings.join(", "), true)}</div>`;
    const svc = [c.serviceMiles != null ? mi(c.serviceMiles) : null, c.serviceTime, c.engineHours].filter(Boolean).join(" · ") || null;
    const facts = kv("Open", [...c.openDoors, ...c.openWindows].join(", ") || null, true) + kv("Tyres", c.tyreWarn.join(", ") || null, true) +
      kv("Charging", tidy(c.chargeText)) + kv("Cable", tidy(c.connector)) + (c.charging ? kv("Full in", c.chargeEta) + kv("Power", c.chargePower) : "") +
      kv("Mileage", mi(c.odometer)) + kv("Service", svc) + kv("Trip", mi(c.trip)) + kv("Trip B", mi(c.tripManual)) +
      kv("Avg speed", c.avgSpeed) + kv("Avg fuel", c.avgFuel) + (!c.home && c.where ? kv("Location", c.where) : "");
    if (facts) h += `<div class="eddo-car-kv">${facts}</div>`;
    // which Home Assistant sensors feed the card, with their current values (to check the links)
    const V = CAR.V || {}, src = { ...CAR.ids };
    for (const k of ["battery", "fuelL", "rangeEv", "rangeFuel", "odometer", "charging", "connector", "lock", "tracker"]) if (V[k]) src["volvo " + k] = V[k];
    h += `<details class="eddo-car-src"><summary>SENSORS</summary>${Object.entries(src).map(([k, id]) => { const x = states.get(id); return `<p><span>${esc(k)}</span><em>${esc(id)}</em><b>${esc(x ? String(x.s) + (x.a.unit_of_measurement ? " " + x.a.unit_of_measurement : "") : "NOT FOUND")}</b></p>`; }).join("") || "<p>NONE</p>"}</details></div>`;
    return h;
  }
  function carAction(act) {
    const c = carData();
    if (act === "unlock" && !CAR.confirmUnlock) { CAR.confirmUnlock = true; refreshList(); setTimeout(() => { CAR.confirmUnlock = false; refreshList(); }, 4000); return; }
    CAR.confirmUnlock = false;
    if ((act === "lock" || act === "unlock") && c.lockId) call("lock", act, { target: { entity_id: c.lockId } });
    else if (c.btn[act]) call("button", "press", { target: { entity_id: c.btn[act] } });
    setTimeout(refreshList, 1500);
  }
  function refreshList() {
    if (!listEl || !listEl.isConnected || sliding) return;
    let body;
    if (CAR.open) {
      body = carPanel();
    } else if (focused) {
      const ds = devices.filter((d) => d.roomRef === focused);
      const scenes = (focused.sceneNames || []).map(([id, n]) => `<button data-house-scene="${esc(id)}">${esc(n)}</button>`).join("");
      body = `<div class="eddo-house-floor"><p>${esc(focused.floorName.toUpperCase())} · <button class="eddo-house-back" data-house-back>ALL ROOMS ↩</button></p>` +
        `<div class="eddo-house-head"><h3 class="eddo-house-room">${esc(focused.name)}</h3><button class="eddo-house-off" data-house-off="${focused.id}">ALL OFF</button></div>` +
        `<p class="wb-muted eddo-house-sub">${esc(roomStatus(focused))}</p>` + (scenes ? `<div class="eddo-house-scenes">${scenes}</div>` : "") +
        (ds.length ? ds.map(devRow).join("") : `<p class="wb-muted">No devices placed in this room.</p>`) + `</div>` +
        `<p class="wb-muted eddo-house-tip">Drag a slider or scroll on a light to dim it · click empty space to zoom out</p>`;
    } else if (energyMode) {
      body = energyPanel();
    } else if (heatMode) {
      // short and calm: inside vs outside, then one line per room (warmest first)
      loadHistory(false);
      const rs = rooms.filter((r) => !r.quiet && r.temp != null && (!floorSel || r.floor === floorSel)).sort((a, b) => b.temp - a.temp);
      const avg = rs.length ? rs.reduce((a, r) => a + r.temp, 0) / rs.length : null;
      const out = window.eddoOutside && Number.isFinite(+window.eddoOutside.t) ? +window.eddoOutside.t : null;
      const col = (t) => { const c = tempColour(t); return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`; };
      body = `<p class="eddo-en-stats"><span>INSIDE <b>${avg != null ? avg.toFixed(1) + "°" : "—"}</b></span><span>OUTSIDE <b>${out != null ? out.toFixed(1) + "°" : "—"}</b></span></p>` +
        (rs.length ? rs.map((r) => `<div class="eddo-house-item"><button class="eddo-house-row" data-house-room="${r.id}"><i style="background:${col(r.temp)};border-color:${col(r.temp)}"></i><span>${esc(r.name)}${r.hum != null && r.hum >= DAMP ? ` <mark>DAMP</mark>` : ""}</span><em>${spark(r)}<b style="color:${col(r.temp)}">${r.temp.toFixed(1)}°</b></em></button></div>`).join("")
          : `<p class="wb-muted">No temperature sensors found for these rooms.</p>`);
    } else if (whatsOn) {
      // just what's on, one tap each to switch off
      const live = devices.filter((d) => devActive(d) && !hiddenFloor(d.roomRef.floor));
      body = `<div class="eddo-house-head"><h3 class="eddo-house-room">What's on</h3>${live.length ? `<button class="eddo-house-off" data-house-off="*">ALL LIGHTS OFF</button>` : ""}</div>` +
        (live.length ? live.slice(0, 10).map((d) => { const i = devices.indexOf(d), act = d.cam ? ` data-house-cam="${d.cam}"` : canToggle(d) ? ` data-house-dev="${i}"` : " data-static";
          return `<div class="eddo-house-item" data-on="true"><button class="eddo-house-row"${act}><i style="--c:#ffb36b"></i><span>${esc(d.name)}</span><em>${esc(d.roomRef.name.toUpperCase())}</em></button></div>`; }).join("") +
          (live.length > 10 ? `<p class="wb-muted">+ ${live.length - 10} more</p>` : "")
          : `<p class="wb-muted">Everything's off.</p>`);
    } else if (!floorSel) {
      const on = rooms.filter((r) => r.on > 0).length;
      body = `<p class="wb-muted eddo-house-tip">${on ? `${on} room${on > 1 ? "s" : ""} lit · ` : ""}Pick a floor above, or click a room on the model</p>`;
    } else {
      const groups = [...new Set(rooms.filter((r) => !floorSel || r.floor === floorSel).map((r) => r.floorName))];
      body = groups.map((gname) => `<div class="eddo-house-floor"><p>${esc(gname.toUpperCase())}</p>` +
        rooms.filter((r) => r.floorName === gname && !r.quiet).map((r) =>
          `<div class="eddo-house-item" data-on="${r.on > 0}"><button class="eddo-house-row" data-house-room="${r.id}"><i style="--c:rgb(${r.color.map((v) => Math.round(v * 255)).join(",")})"></i><span>${esc(r.name)}</span><em>${esc(heatMode ? (r.temp != null ? r.temp.toFixed(1) + "°" : "—") : roomStatus(r))}</em></button></div>`).join("") + `</div>`).join("") +
        `<p class="wb-muted eddo-house-tip">Drag to turn · scroll to zoom · click a room to control it</p>`;
    }
    updateBar(); renderPop();
    const html = body;
    if (listEl.innerHTML !== html) listEl.innerHTML = html;
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !running) return;
    const q = (sel) => e.target.closest(sel);
    let b;
    if (q("[data-house-pop-close]")) return closePop();
    if ((b = q("[data-house-preview-close]"))) { const d = devices.find((x) => x.cam === b.dataset.housePreviewClose); return d && closePreview(d); }
    if ((b = q("[data-house-view]"))) return setView(b.dataset.houseView);
    if ((b = q("[data-house-ct]"))) { const [id, k] = b.dataset.houseCt.split(":"); return call("light", "turn_on", { target: { entity_id: id }, service_data: { color_temp_kelvin: +k } }); }
    if ((b = q("[data-house-rgb]"))) { const [id, c] = b.dataset.houseRgb.split(":"); return call("light", "turn_on", { target: { entity_id: id }, service_data: { rgb_color: c.split(",").map(Number) } }); }
    if ((b = q("[data-house-floor]"))) { stopTour(); closePop(); whatsOn = false; if (!b.dataset.houseFloor) orbitMode = "drift"; return setFloor(b.dataset.houseFloor); }
    if ((b = q("[data-house-mode]"))) {
      if (b.dataset.houseMode === "energy") { energyMode = !energyMode; if (energyMode) { heatMode = false; whatsOn = false; loadHistory(true); closePop(); closeAllPreviews(); dwell(null); hoveredDev = null; } return refreshList(); }
      if (b.dataset.houseMode === "heat") { heatMode = !heatMode; if (heatMode) { energyMode = false; loadHistory(true); whatsOn = false; closePop(); closeAllPreviews(); dwell(null); hoveredDev = null; } }
      else { whatsOn = !whatsOn; if (whatsOn) { heatMode = false; energyMode = false; stopTour(); focused = null; floorSel = null; setFloor(null); } }
      return refreshList();
    }
    if (q("[data-house-back]") && !q("[data-house-off]")) { stopTour(); return focus(null); }
    if ((b = q("[data-house-off]"))) { const id = b.dataset.houseOff; roomOff(id === "*" ? rooms : rooms.filter((r) => r.id === id)); return; }
    if ((b = q("[data-house-scene]"))) return call("scene", "turn_on", { target: { entity_id: b.dataset.houseScene } });
    if ((b = q("[data-house-cam]"))) { window.eddoCams && window.eddoCams.open(b.dataset.houseCam); return; }
    if ((b = q("[data-car-act]"))) { carAction(b.dataset.carAct); return; }
    if ((b = q("[data-house-media]"))) { const [i, act] = b.dataset.houseMedia.split(":"); mediaAction(devices[+i], act); return; }
    if ((b = q("[data-house-hvac]"))) { const [i, m] = b.dataset.houseHvac.split(":"), d = devices[+i], id = d && d.ids.find((x) => x.startsWith("climate.")); if (id) call("climate", "set_hvac_mode", { target: { entity_id: id }, service_data: { hvac_mode: m } }); return; }
    if ((b = q("[data-house-clim]"))) { const [i, v] = b.dataset.houseClim.split(":"); return climate(devices[+i], v === "power" ? 0 : +v, v === "power"); }
    if ((b = q("[data-house-dev]"))) { const d = devices[+b.dataset.houseDev]; if (d && canToggle(d)) toggleDevice(d); return; }
    if ((b = q("[data-house-room]"))) { stopTour(); const r = rooms.find((x) => x.id === b.dataset.houseRoom); if (r && renderer) focus(focused === r ? null : r); }
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
  const WMO_WORD = { 0: "CLEAR", 1: "MOSTLY CLEAR", 2: "PARTLY CLOUDY", 3: "OVERCAST", 45: "FOG", 48: "FOG", 51: "DRIZZLE", 53: "DRIZZLE", 55: "DRIZZLE", 61: "LIGHT RAIN", 63: "RAIN", 65: "HEAVY RAIN", 71: "LIGHT SNOW", 73: "SNOW", 75: "HEAVY SNOW", 80: "SHOWERS", 81: "SHOWERS", 82: "HEAVY SHOWERS", 95: "THUNDERSTORM", 96: "THUNDERSTORM", 99: "THUNDERSTORM" };
  setInterval(() => {   // "· 9° LIGHT RAIN" after the address
    const el = document.querySelector("#stage .eddo-house-wxline"), o = window.eddoOutside; if (!el) return;
    const t = WX_TEST ? ` · PREVIEW: ${WX_TEST.toUpperCase()}` : o && Number.isFinite(+o.t) ? ` · ${Math.round(o.t)}° ${WMO_WORD[o.code] || ""}${o.wind ? ` · WIND ${Math.round(o.wind)} KM/H` : ""}` : "";
    if (el.textContent !== t) el.textContent = t;
  }, 2000);

  window.eddoTabs.register({
    id: "house", label: "House", pos: 1,
    render(c) {
      c.innerHTML = `<div class="eddo-house-hero"><span>${esc(H.address || "11 SHORTLANDS")}<em class="eddo-house-wxline"></em></span><span class="eddo-house-pow">POWERED BY ${EDNET_MARK}</span></div><div class="eddo-house-bar"></div><div class="eddo-house-list"></div>`;
      barEl = c.querySelector(".eddo-house-bar");
      listEl = c.querySelector(".eddo-house-list");
      refreshList();
    },
    async onShow() { if (await ensure3D()) { start(); refreshList(); } },
    onHide() { stop(); focus(null); },
  });
})();
