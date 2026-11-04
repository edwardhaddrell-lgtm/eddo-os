// EDDO OS · Home Assistant link
// Live office + coffee machine panel, and the workspace's three daily tasks fed
// from a Home Assistant to-do list. Settings live in Wallpaper Engine's
// properties (group "Home Assistant"). Uses HA's WebSocket API, which works
// from a local wallpaper without any CORS changes in HA.
(() => {
  "use strict";
  const DEFAULTS = { haurl: "http://192.168.4.81:8123", hatoken: "", haarea: "Office", hakeywords: "coffee", haentities: "", hatodo: "Top 3", hacalendar: "haddrellwood", halinks: "Unraid=http://eddo-nas/", hatasksurl: "https://tasks.google.com/", hainside: "climate.garden_office", haoutside: "Bromley=51.4057,0.0158", haunraid: "unraid, eddo_nas, eddo-nas", jarvispipeline: "jarvis", jarvisprompts: "What's on my calendar today?|How warm is the office?|Turn on the office lights|Turn everything off in the office|Good morning, Jarvis", jarvisspeak: true, jarvistalk: true, jarvisgreet: true, greethours: 4, jarvisrate: 92, burnin: true, idleminutes: 10, showunraid: true, showha: true, hatasks: true, bgdim: 0 };
  // the PC controller only answers requests carrying its key (assets/bridge-key.js, written by the controller)
  const BRIDGE = "http://127.0.0.1:47290" + (window.EDDO_BRIDGE_KEY ? "/k/" + window.EDDO_BRIDGE_KEY : "");
  const TOGGLE = new Set(["light", "switch", "fan", "input_boolean", "automation", "cover", "media_player", "humidifier", "siren", "valve", "lock"]);
  const PRESS = new Set(["button", "input_button", "script", "scene"]);
  const SKIP = new Set(["update", "device_tracker", "event", "image", "camera", "tts", "stt", "conversation", "wake_word", "assist_satellite", "todo", "calendar", "notify", "select", "number", "text", "time", "date", "datetime"]);

  const cfg = { ...DEFAULTS };
  let ws = null, msgId = 0, pending = new Map(), retry = 0, retryTimer = null, connKey = "";
  let entities = [];           // entity_ids shown on the panel
  const names = new Map();     // entity_id -> display name
  const states = new Map();    // entity_id -> {s, a}
  let todoEntity = "", todoItems = [], localDone = new Set(), lastTaskClick = 0;
  let calEntity = "", expanded = new Set(), linkNote = "", tasksLoaded = false;
  let status = "idle", statusText = "";
  let panel, list, head, foot, temps;

  // ---------- properties ----------
  function readProps(p) {
    if (!p) return false;
    let changed = false;
    for (const k of Object.keys(DEFAULTS)) {
      if (p[k] && "value" in p[k]) {
        let v = p[k].value;
        if (typeof DEFAULTS[k] === "string") v = typeof v === "string" ? v.trim() : "";
        if (typeof DEFAULTS[k] === "number") v = Number.isFinite(+v) ? +v : DEFAULTS[k];
        if (cfg[k] !== v) { cfg[k] = v; changed = true; }
      }
    }
    return changed;
  }
  window.addEventListener("rhine-wallpaper-properties", (e) => {
    if (e.detail && e.detail.__eddo) return;
    const changed = readProps(e.detail);
    if (changed) { applyDim(); syncOutside(); render(); maybeConnect(); window.dispatchEvent(new Event("eddo-config")); }
    if (cfg.hatasks && todoEntity && ws) setTimeout(pushTasks, 0); // keep HA tasks over WE's typed ones
    if (calEntity && ws) setTimeout(() => pushEvent(calAttrs), 0);
  });

  // ---------- websocket ----------
  function wsUrl() {
    let u = cfg.haurl.replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(u)) u = "http://" + u;
    return u.replace(/^http/i, "ws") + "/api/websocket";
  }
  function send(msg) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error("offline"));
      const id = ++msgId; pending.set(id, { resolve, reject, msg }); ws.send(JSON.stringify({ id, ...msg }));
    });
  }
  window.eddoInfo = () => ({
    inside: insideTemp(), outside: outside && outside.t, outsideLabel: outside && outside.label, outsideCode: outside && outside.code,
    forecast: outside ? { max: outside.max, min: outside.min, rain: outside.rain, code: outside.dayCode } : null,
    calEntity, tasksLoaded, insideName: names.get(cfg.hainside) || "office",
    tasks: todoItems.filter((i) => i.status === "needs_action").map((i) => i.summary),
    event: calAttrs && calAttrs.message ? { name: calAttrs.message, start: calAttrs.start_time, allDay: !!calAttrs.all_day } : null,
    live: status === "live",
  });
  window.eddoHA = { send: (m) => send(m), subscribe: (m, cb) => subscribe(m, cb),
    unsubscribe: (id) => { const p = pending.get(id); if (p) pending.delete(id); return send({ type: "unsubscribe_events", subscription: id }).catch(() => {}); }, cfg, baseUrl: () => cfg.haurl.replace(/\/+$/, "").replace(/^(?!https?:\/\/)/i, "http://"), bridge: BRIDGE };
  function setStatus(s, t) { status = s; statusText = t || ""; render(); }

  function maybeConnect() {
    const key = cfg.haurl + "|" + cfg.hatoken + "|" + cfg.haarea + "|" + cfg.hakeywords + "|" + cfg.haentities + "|" + cfg.hatodo + "|" + cfg.hacalendar + "|" + cfg.showha + "|" + cfg.hatasks;
    if (key === connKey) return;
    connKey = key;
    disconnect();
    if (!cfg.showha && !cfg.hatasks) return setStatus("off");
    if (!cfg.haurl) return setStatus("setup", "Add your Home Assistant address in Wallpaper Engine settings.");
    if (!cfg.hatoken) return setStatus("setup", "Add a long-lived access token in Wallpaper Engine → Home Assistant.");
    connect();
  }
  function disconnect() {
    clearTimeout(retryTimer);
    if (ws) { ws.onclose = null; try { ws.close(); } catch (_) {} }
    ws = null; pending.forEach((p) => p.reject(new Error("closed"))); pending.clear();
  }
  function connect() {
    setStatus("connecting", "Connecting…");
    let sock;
    try { sock = new WebSocket(wsUrl()); } catch (e) { return scheduleRetry("Bad address"); }
    ws = sock;
    sock.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === "auth_required") sock.send(JSON.stringify({ type: "auth", access_token: cfg.hatoken }));
      else if (m.type === "auth_invalid") { setStatus("error", "Token rejected — check it in Wallpaper Engine settings."); sock.onclose = null; sock.close(); }
      else if (m.type === "auth_ok") { retry = 0; onReady().catch((e) => setStatus("error", String(e.message || e))); }
      else if (m.type === "result") {
        const p = pending.get(m.id); if (!p) return;
        if (p.msg.subscribe) { p.msg.subscribe.active = true; p.resolve(m); return; }
        pending.delete(m.id); m.success ? p.resolve(m.result) : p.reject(new Error(m.error?.message || "HA error"));
      } else if (m.type === "event") {
        const p = pending.get(m.id); p && p.msg.subscribe && p.msg.subscribe(m.event);
      }
    };
    sock.onclose = () => { if (ws === sock) scheduleRetry("Lost connection — retrying…"); };
    sock.onerror = () => {};
  }
  function scheduleRetry(text) {
    ws = null; pending.clear();
    const delay = Math.min(60000, 2000 * Math.pow(2, retry++));
    setStatus("error", text);
    clearTimeout(retryTimer); retryTimer = setTimeout(connect, delay);
  }
  function subscribe(msg, cb) { const m = { ...msg }; Object.defineProperty(m, "subscribe", { value: cb, enumerable: false, writable: true }); return send(m); }

  // ---------- discovery ----------
  async function onReady() {
    setStatus("loading", "Reading devices…");
    const [areas, devices, ents, allStates] = await Promise.all([
      send({ type: "config/area_registry/list" }), send({ type: "config/device_registry/list" }),
      send({ type: "config/entity_registry/list" }), send({ type: "get_states" })]);
    const areaWanted = cfg.haarea.toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
    const areaIds = new Set(areas.filter((a) => areaWanted.some((w) => a.name.toLowerCase() === w || a.area_id === w || a.name.toLowerCase().includes(w))).map((a) => a.area_id));
    const devArea = new Map(devices.map((d) => [d.id, d.area_id]));
    const devName = new Map(devices.map((d) => [d.id, d.name_by_user || d.name]));
    const reg = new Map(ents.map((e) => [e.entity_id, e]));
    const stateMap = new Map(allStates.map((s) => [s.entity_id, s]));
    window.dispatchEvent(new CustomEvent("eddo-ha-ready", { detail: { allStates, devices, ents, areas } }));
    const fixed = parseList(cfg.haentities);
    if (fixed.length) {
      entities = fixed.map((f) => f.id);
      for (const f of fixed) {
        const st = stateMap.get(f.id);
        names.set(f.id, f.label || (st && st.attributes.friendly_name) || f.id);
        states.set(f.id, st ? { s: st.state, a: st.attributes } : { s: "unavailable", a: {} });
      }
      setStatus("live");
      const ids = cfg.hainside && !entities.includes(cfg.hainside) ? [...entities, cfg.hainside] : entities;
      const ins = stateMap.get(cfg.hainside); if (ins) states.set(cfg.hainside, { s: ins.state, a: ins.attributes });
      subscribe({ type: "subscribe_entities", entity_ids: ids }, onEntities).catch(() => {});
      return startTodo(allStates);
    }
    const keywords = cfg.hakeywords.toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
    const picked = [];
    for (const st of allStates) {
      const id = st.entity_id, dom = id.split(".")[0], r = reg.get(id);
      if (SKIP.has(dom) || (r && (r.hidden_by || r.disabled_by || r.entity_category))) continue;
      const area = r ? r.area_id || devArea.get(r.device_id) : null;
      const label = ((st.attributes.friendly_name || "") + " " + id + " " + (r && devName.get(r.device_id) || "")).toLowerCase();
      const inArea = area && areaIds.has(area);
      const hit = keywords.some((k) => label.includes(k));
      if (inArea || hit) picked.push({ id, dom, primary: TOGGLE.has(dom) || dom === "climate" || dom === "water_heater" || PRESS.has(dom), hit });
    }
    // controllable things first, then sensors; keep it short enough for a wallpaper
    picked.sort((a, b) => (b.hit - a.hit) || (b.primary - a.primary) || a.id.localeCompare(b.id));
    entities = picked.slice(0, 6).map((p) => p.id);
    for (const id of entities) {
      const st = stateMap.get(id), r = reg.get(id);
      names.set(id, shortName(st.attributes.friendly_name || id, r && devName.get(r.device_id)));
      states.set(id, { s: st.state, a: st.attributes });
    }
    if (!entities.length) setStatus("empty", `Nothing found in area “${cfg.haarea}” or matching “${cfg.hakeywords}”.`);
    else setStatus("live");
    if (entities.length) subscribe({ type: "subscribe_entities", entity_ids: entities }, onEntities).catch(() => {});

    startTodo(allStates);
  }
  function startTodo(allStates) {
    // to-do list → workspace tasks
    todoEntity = findEntity(allStates, "todo", cfg.hatodo) || (cfg.hatodo ? "" : (allStates.find((s) => s.entity_id.startsWith("todo.")) || {}).entity_id || "");
    if (todoEntity) names.set(todoEntity, (allStates.find((x) => x.entity_id === todoEntity)?.attributes.friendly_name) || todoEntity);
    if (cfg.hatasks && !todoEntity) linkNote = `No to-do list called “${cfg.hatodo}” in HA yet.`;
    // calendar → workspace "Upcoming event"
    calEntity = findEntity(allStates, "calendar", cfg.hacalendar);
    if (calEntity) {
      const st = allStates.find((x) => x.entity_id === calEntity); pushEvent(st && st.attributes);
      subscribe({ type: "subscribe_entities", entity_ids: [calEntity] }, (ev) => {
        const v = (ev.a || {})[calEntity] || (ev.c || {})[calEntity]; if (!v) return;
        if (v.a) calAttrs = v.a; else if (v["+"] && v["+"].a) Object.assign(calAttrs, v["+"].a);
        if (v["-"] && v["-"].a) for (const k of v["-"].a) delete calAttrs[k];
        pushEvent(calAttrs); loadEvents();
      }).catch(() => {});
      loadEvents(); clearInterval(eventsTimer); eventsTimer = setInterval(loadEvents, 10 * 60 * 1000);
    } else if (cfg.hacalendar) linkNote = (linkNote ? linkNote + " " : "") + `No calendar matching “${cfg.hacalendar}” in HA yet.`;
    render();
    if (cfg.hatasks && todoEntity) subscribe({ type: "todo/item/subscribe", entity_id: todoEntity }, (ev) => { todoItems = ev.items || []; tasksLoaded = true; pushTasks(); }).catch(() => {});
  }
  let calAttrs = {}, eventsTimer = null, eventsBusy = false;
  // 03 Upcoming event: the next three events from the calendar, listed under the countdown
  async function loadEvents() {
    if (!calEntity || eventsBusy) return; eventsBusy = true;
    try {
      const r = await send({ type: "call_service", domain: "calendar", service: "get_events", target: { entity_id: calEntity }, service_data: { duration: { days: 60 } }, return_response: true });
      const list = ((r && r.response && r.response[calEntity]) || {}).events || [], now = Date.now();
      const next = list.map((e) => ({ ...e, t: Date.parse(e.start), allDay: !/T/.test(e.start) })).filter((e) => (Date.parse(e.end) || e.t) > now).sort((a, b) => a.t - b.t).slice(0, 3);
      const day = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase().replace(",", "");
      window.eddoEventsHtml = next.length ? `<div class="eddo-events"><p class="eddo-events-cap">NEXT UP</p>${next.map((e) => { const d = new Date(e.allDay ? e.start + "T00:00" : e.start); return `<div class="eddo-event"><span>${esc(day(d))}${e.allDay ? "" : " · " + d.toTimeString().slice(0, 5)}</span><b>${esc(e.summary || "Event")}</b></div>`; }).join("")}</div>` : "";
    } catch (_) { /* keep the last list */ }
    eventsBusy = false;
  }
  function findEntity(allStates, domain, want) {
    want = String(want || "").trim().toLowerCase(); if (!want) return "";
    const pool = allStates.filter((x) => x.entity_id.startsWith(domain + "."));
    const exact = pool.find((x) => x.entity_id === want || (x.attributes.friendly_name || "").toLowerCase() === want);
    if (exact) return exact.entity_id;
    const slug = want.replace(/[^a-z0-9]+/g, "_");
    const part = pool.find((x) => x.entity_id.includes(slug) || (x.attributes.friendly_name || "").toLowerCase().includes(want));
    return part ? part.entity_id : "";
  }
  function pushEvent(a) {
    a = a || {}; calAttrs = { ...a };
    let date = "";
    if (a.start_time) { const [d, t] = String(a.start_time).split(" "); date = a.all_day || !t ? d : d + " " + t.slice(0, 5); }
    const detail = { __eddo: true, eventname: { value: a.message || "" }, eventdate: { value: date } };
    const host = window.rhineWallpaperHost && window.rhineWallpaperHost.properties;
    if (host) { host.eventname = detail.eventname; host.eventdate = detail.eventdate; }
    window.dispatchEvent(new CustomEvent("rhine-wallpaper-properties", { detail }));
  }
  function parseList(text) {
    return String(text || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const [id, ...rest] = x.split("=");
      return { id: id.trim(), label: rest.join("=").trim() };
    }).filter((x) => /^[a-z_]+\.[a-z0-9_]+$/.test(x.id));
  }
  function shortName(n, device) {
    if (device && n.startsWith(device + " ") && n.length > device.length + 2) n = n.slice(device.length + 1);
    return n.replace(/\b(office|garden office)\b\s*/i, (m) => (n.trim().toLowerCase() === m.trim().toLowerCase() ? m : "")).trim() || n;
  }
  function onEntities(ev) {
    for (const [id, v] of Object.entries(ev.a || {})) states.set(id, { s: v.s, a: v.a || {} });
    for (const [id, v] of Object.entries(ev.c || {})) {
      const cur = states.get(id) || { s: "", a: {} };
      if (v["+"]) { if ("s" in v["+"]) cur.s = v["+"].s; if (v["+"].a) Object.assign(cur.a, v["+"].a); }
      if (v["-"] && v["-"].a) for (const k of v["-"].a) delete cur.a[k];
      states.set(id, cur);
    }
    render();
  }

  // ---------- tasks ----------
  function pushTasks() {
    if (!cfg.hatasks || !todoEntity) return;
    if (Date.now() - lastTaskClick < 1200) return void setTimeout(pushTasks, 1300);
    const items = todoItems.filter((i) => i.status === "needs_action" || localDone.has(i.uid)).slice(0, 3);
    taskUids = items.map((i) => i.uid);
    const detail = { __eddo: true };
    for (let i = 0; i < 3; i++) detail["task" + (i + 1)] = { value: items[i] ? items[i].summary : "" };
    const host = window.rhineWallpaperHost && window.rhineWallpaperHost.properties;
    if (host) for (const k of ["task1", "task2", "task3"]) host[k] = detail[k];
    window.dispatchEvent(new CustomEvent("rhine-wallpaper-properties", { detail }));
  }
  let taskUids = [];
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-wb-task]");
    if (!b || !cfg.hatasks || !todoEntity || !ws) return;
    const uid = taskUids[+b.dataset.wbTask]; if (!uid) return;
    const nowDone = b.getAttribute("aria-pressed") !== "true";
    lastTaskClick = Date.now();
    nowDone ? localDone.add(uid) : localDone.delete(uid);
    send({ type: "call_service", domain: "todo", service: "update_item", target: { entity_id: todoEntity }, service_data: { item: uid, status: nowDone ? "completed" : "needs_action" } }).catch(() => {});
  }, true);

  // ---------- panel ----------
  function fmtState(id) {
    const st = states.get(id); if (!st) return "—";
    const dom = id.split(".")[0], a = st.a || {};
    if (st.s === "unavailable" || st.s === "unknown") return "OFFLINE";
    if (dom === "climate") {
      const cur = a.current_temperature, tgt = a.temperature ?? (a.target_temp_low != null ? `${a.target_temp_low}–${a.target_temp_high}` : null);
      if (st.s === "off") return "OFF" + (cur != null ? " · " + cur + "°" : "");
      return `${cur != null ? cur + "°" : ""}${tgt != null ? " → " + tgt + "°" : ""}`.trim() || st.s.toUpperCase();
    }
    if (dom === "light" && st.s === "on" && a.brightness != null) return Math.round(a.brightness / 2.55) + "%";
    if (dom === "cover" && a.current_position != null) return a.current_position + "% OPEN";
    if (dom === "sensor" || dom === "number") { const n = parseFloat(st.s); return (isFinite(n) ? +n.toFixed(1) : st.s) + (a.unit_of_measurement ? " " + a.unit_of_measurement : ""); }
    if (PRESS.has(dom)) return "RUN ↗";
    return String(st.s).replace(/_/g, " ").toUpperCase();
  }
  function isOn(id) { const st = states.get(id); return st && ["on", "open", "opening", "playing", "heat", "heating", "cool", "auto", "unlocked"].includes(st.s); }
  function ensurePanel() {
    if (panel && panel.isConnected) return true;
    const stage = document.querySelector("#stage"); if (!stage) return false;
    panel = document.createElement("section");
    panel.className = "eddo-ha"; panel.setAttribute("aria-label", "Home Assistant");
    panel.innerHTML = '<button class="eddo-ha-kicker" data-collapse="ha" aria-expanded="true"><span>HOME SYSTEMS / <b></b></span><span class="eddo-ha-right"><i class="eddo-caret"></i><span class="eddo-ha-dot"></span></span></button><div class="eddo-ha-temps"></div><div class="eddo-ha-list"></div><p class="eddo-ha-foot"></p>';
    head = panel.querySelector(".eddo-ha-kicker b"); list = panel.querySelector(".eddo-ha-list"); foot = panel.querySelector(".eddo-ha-foot"); temps = panel.querySelector(".eddo-ha-temps");
    list.addEventListener("click", onPanelClick);
    applyCollapsed();
    stage.append(panel);
    new MutationObserver(syncMode).observe(stage, { attributes: true, attributeFilter: ["data-mode"] });
    syncMode();
    return true;
  }
  // Shown with the workspace only (hidden during the opening and in archive mode).
  function syncMode() {
    if (!panel) return;
    const wb = document.querySelector("#stage .workbench");
    const v = String(cfg.showha && document.querySelector("#stage")?.dataset.mode !== "boot" && !!wb && !wb.hidden);
    if (panel.dataset.visible !== v) panel.dataset.visible = v;
  }
  setInterval(syncMode, 800);
  // Sit directly under the right-hand workspace panel, matching its width.
  function placePanel() {
    if (!panel || panel.dataset.visible !== "true") return;
    const stage = document.querySelector("#stage"), mod = document.querySelector("#stage .wb-module");
    if (!stage || !mod || !mod.offsetWidth) return;
    const sr = stage.getBoundingClientRect(), mr = mod.getBoundingClientRect(), k = sr.width / (stage.offsetWidth || 1920) || 1, H = stage.offsetHeight || 1080;
    const want = (mr.bottom - sr.top) / k + 26;
    // Not enough room under a tall tab (e.g. Jarvis)? Shrink to the header bar instead of overlapping.
    const full = panel.dataset.squeezed === "true" ? (panel._fullH || panel.offsetHeight) : panel.offsetHeight;
    if (panel.dataset.squeezed !== "true") panel._fullH = full;
    const tabKey = (document.querySelector("#stage .wb-title")?.textContent || "");
    if (panel._tabKey !== tabKey) { panel._tabKey = tabKey; delete panel.dataset.peek; }
    const squeeze = want + full > H - 150 && !ui.ha && panel.dataset.peek !== "true";
    if (panel.dataset.squeezed !== String(squeeze)) panel.dataset.squeezed = String(squeeze);
    const top = Math.min(want, H - 150 - panel.offsetHeight);
    const set = (prop, v) => { if (panel.style[prop] !== v) panel.style[prop] = v; };
    set("left", Math.round((mr.left - sr.left) / k) + "px");
    set("width", Math.round(mr.width / k) + "px");
    set("top", Math.round(top) + "px");
  }
  setInterval(placePanel, 1000);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function render() {
    if (sliding) { renderWaiting = true; return; }
    if (!ensurePanel()) return;
    syncMode();
    head.textContent = (cfg.haarea || "HOME").toUpperCase();
    panel.dataset.status = status;
    renderTemps();
    requestAnimationFrame(placePanel);
    if (status !== "live") { list.innerHTML = ""; foot.textContent = statusText; return; }
    foot.textContent = linkNote;
    const row = (id) => {
      const dom = id.split(".")[0], act = TOGGLE.has(dom) || PRESS.has(dom);
      const climate = dom === "climate";
      return `<div class="eddo-ha-row${climate ? " eddo-ha-wide" : ""}" data-on="${isOn(id)}" data-entity="${esc(id)}">` +
        (act || climate ? `<button class="eddo-ha-main" data-act="${climate ? "expand" : "toggle"}"${climate ? ` aria-expanded="${expanded.has(id)}"` : ""}>` : `<div class="eddo-ha-main">`) +
        `<span class="eddo-ha-led"></span><span class="eddo-ha-name">${esc(names.get(id) || id)}${climate ? ` <i class="eddo-ha-caret">${expanded.has(id) ? "▴" : "▾"}</i>` : ""}</span><span class="eddo-ha-state">${esc(fmtState(id))}</span>` +
        (act || climate ? `</button>` : `</div>`) +
        (climate ? `<span class="eddo-ha-step"><button data-act="down" aria-label="Lower">−</button><button data-act="up" aria-label="Raise">+</button></span>` : "") +
        (colourable(id) ? `<button class="eddo-ha-dot" data-act="light" aria-label="Colour" aria-expanded="${lightOpen === id}" style="--dot:${lightColour(id)}"></button>` : "") +
        (dimmable(id) ? `<div class="eddo-slider eddo-ha-bri" data-kind="bri" data-for="${esc(id)}" data-min="1" data-max="100" data-value="${briPct(id) || 1}" style="--pct:${briPct(id)}%" role="slider" aria-label="Brightness"><i></i></div>` : "") +
        `</div>` + (climate && expanded.has(id) ? climatePanel(id) : "");
    };
    const actions = entities.filter((id) => PRESS.has(id.split(".")[0]));
    const wide = entities.filter((id) => ["climate", "water_heater"].includes(id.split(".")[0]));
    const rest = entities.filter((id) => !actions.includes(id) && !wide.includes(id));
    list.innerHTML =
      (actions.length || cfg.halinks ? `<div class="eddo-ha-actions">${actions.map((id) => `<button data-entity="${esc(id)}" data-act="toggle">${esc(names.get(id) || id)} <span>↗</span></button>`).join("")}${linksRow()}</div>` : "") +
      wide.map(row).join("") +
      (rest.length ? `<div class="eddo-ha-grid">${rest.map(row).join("")}</div>` : "") +
      (lightOpen && rest.includes(lightOpen) ? lightPanel(lightOpen) : "");
  }
  // ---------- light controls (brightness + colour) ----------
  var lightOpen = null, sliding = false, renderWaiting = false;
  const modesOf = (id) => (states.get(id)?.a?.supported_color_modes) || [];
  const dimmable = (id) => id.startsWith("light.") && modesOf(id).some((m) => m !== "onoff");
  const colourable = (id) => modesOf(id).some((m) => ["hs", "xy", "rgb", "rgbw", "rgbww"].includes(m));
  const tempable = (id) => modesOf(id).includes("color_temp");
  const SWATCHES = [[0, 100], [25, 100], [45, 100], [120, 90], [180, 90], [220, 100], [270, 90], [310, 80], [30, 45]];
  const briPct = (id) => { const st = states.get(id); return st && st.s === "on" && st.a.brightness != null ? Math.round(st.a.brightness / 2.55) : 0; };
  function lightColour(id) {
    const st = states.get(id); if (!st || st.s !== "on") return "transparent";
    const a = st.a;
    if (a.color_mode === "color_temp" || !Array.isArray(a.hs_color)) return (a.color_temp_kelvin || 3000) < 3500 ? "#ffd9a0" : "#eef3ff";
    return `hsl(${Math.round(a.hs_color[0])} ${Math.round(a.hs_color[1])}% ${a.hs_color[1] < 40 ? 80 : 55}%)`;
  }
  // compact colour strip under the grid: whites + 9 colours + a fine hue strip
  function lightPanel(id) {
    const a = (states.get(id) || { a: {} }).a, hue = Array.isArray(a.hs_color) ? Math.round(a.hs_color[0]) : 30;
    const whites = tempable(id) ? `<button data-act="ct" data-ct="warm" class="eddo-sw" style="--c:#ffd9a0" title="Warm white"></button><button data-act="ct" data-ct="cool" class="eddo-sw" style="--c:#eef3ff" title="Cool white"></button><i class="eddo-sw-gap"></i>` : "";
    return `<div class="eddo-ha-light" data-entity="${esc(id)}">` +
      `<div class="eddo-ha-light-head"><span>${esc((names.get(id) || id).toUpperCase())} · COLOUR</span><button data-act="light" aria-label="Close">✕</button></div>` +
      `<div class="eddo-ha-swatches">${whites}${SWATCHES.map(([h, sat]) => `<button data-act="hs" data-h="${h}" data-s="${sat}" class="eddo-sw" style="--c:hsl(${h} ${sat}% ${sat < 60 ? 75 : 55}%)"></button>`).join("")}</div>` +
      `<div class="eddo-slider eddo-ha-hue" data-kind="hue" data-for="${esc(id)}" data-min="0" data-max="359" data-value="${hue}" style="--pct:${(hue / 359 * 100).toFixed(1)}%" role="slider" aria-label="Hue"><i></i></div>` +
      `</div>`;
  }
  function lightCall(id, data) {
    return send({ type: "call_service", domain: "light", service: "turn_on", target: { entity_id: id }, service_data: data })
      .catch((err) => { linkNote = `${names.get(id) || id}: ${err.message || err}`; render(); setTimeout(() => { linkNote = ""; render(); }, 8000); });
  }
  // Custom sliders (Wallpaper Engine doesn't drive native range inputs reliably):
  // press to set, drag to adjust, release to send. Redraws are held while dragging.
  let drag = null;
  function sliderAt(el, clientX) {
    const r = el.getBoundingClientRect(), min = +el.dataset.min, max = +el.dataset.max;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
    const v = Math.round(min + f * (max - min));
    el.dataset.value = v; el.style.setProperty("--pct", (f * 100).toFixed(1) + "%");
    if (el.dataset.kind === "bri") { const st = el.closest(".eddo-ha-row")?.querySelector(".eddo-ha-state"); if (st) st.textContent = v + "%"; }
    return v;
  }
  function sliderCommit(el) {
    const id = el.dataset.for, v = +el.dataset.value;
    if (el.dataset.kind === "bri") lightCall(id, { brightness_pct: v });
    else if (el.dataset.kind === "hue") lightCall(id, { hs_color: [v, 100] });
  }
  document.addEventListener("mousedown", (e) => {
    const el = e.target.closest && e.target.closest(".eddo-slider"); if (!el) return;
    e.preventDefault(); e.stopPropagation();
    drag = el; sliding = true; el.dataset.dragging = "true"; sliderAt(el, e.clientX);
  }, true);
  document.addEventListener("mousemove", (e) => { if (drag) sliderAt(drag, e.clientX); }, true);
  const endDrag = (e) => {
    if (!drag) return;
    const el = drag; drag = null; if (e && e.clientX != null) sliderAt(el, e.clientX);
    delete el.dataset.dragging; sliderCommit(el);
    sliding = false; if (renderWaiting) { renderWaiting = false; setTimeout(render, 300); }
  };
  document.addEventListener("mouseup", endDrag, true);
  window.addEventListener("blur", () => endDrag());
  // Scroll wheel over a dimmable light: ±5% per notch; sent once you stop scrolling.
  let wheelTimer = null, wheelEl = null;
  document.addEventListener("wheel", (e) => {
    const row = e.target.closest && e.target.closest(".eddo-ha .eddo-ha-row"); if (!row) return;
    const el = row.querySelector(".eddo-slider.eddo-ha-bri"); if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const step = e.deltaY < 0 ? 5 : -5;
    const cur = +el.dataset.value || 0, base = row.dataset.on === "true" ? cur : 0;
    const v = Math.max(1, Math.min(100, Math.round((base + step) / 5) * 5 || (step > 0 ? 5 : 1)));
    el.dataset.value = v; el.style.setProperty("--pct", v + "%"); el.dataset.dragging = "true";
    const st = row.querySelector(".eddo-ha-state"); if (st) st.textContent = v + "%";
    row.dataset.on = "true";
    sliding = true; wheelEl = el;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const t = wheelEl; wheelEl = null; delete t.dataset.dragging;
      sliderCommit(t);
      sliding = false; if (renderWaiting) { renderWaiting = false; setTimeout(render, 300); }
    }, 350);
  }, { capture: true, passive: false });
  // a click on a slider shouldn't fall through to other handlers (e.g. collapsing a header)
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".eddo-slider")) e.stopPropagation(); }, true);
  function climatePanel(id) {
    const st = states.get(id) || { s: "", a: {} }, modes = st.a.hvac_modes || ["off", "heat", "cool"];
    const opts = [["power", st.s === "off" ? "Turn on" : "Turn off"], ["heat", "Heat"], ["cool", "Cool"], ["heat_cool", "Auto"], ["dry", "Dry"], ["fan_only", "Fan"]]
      .filter(([m]) => m === "power" || modes.includes(m));
    return `<div class="eddo-ha-modes" data-entity="${esc(id)}">${opts.map(([m, label]) =>
      `<button data-act="mode" data-mode="${m}" aria-pressed="${m === "power" ? st.s !== "off" : st.s === m}">${label}</button>`).join("")}</div>`;
  }
  function linksRow() {
    return parseLinks(cfg.halinks).map((l) => `<button data-link="${esc(l.url)}">${esc(l.label)} <span>↗</span></button>`).join("");
  }
  function parseLinks(text) {
    return String(text || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.indexOf("="); return i > 0 ? { label: x.slice(0, i).trim(), url: x.slice(i + 1).trim() } : { label: x, url: x };
    }).filter((l) => /^https?:\/\//i.test(l.url));
  }
  // Wallpaper Engine can't open other browsers, so ask the Loupedeck controller (running on this PC) to do it.
  function openLink(url, btn) {
    if (window.EDDO_WEB) { window.open(url, "_blank", "noopener"); flash(btn, "OPENED"); return; }   // web edition: a normal new tab/window
    fetch(`${BRIDGE}/open?url=${encodeURIComponent(url)}`).then((r) => { if (!r.ok) throw 0; flash(btn, "OPENED"); })
      .catch(() => { flash(btn, "NO LINK"); linkNote = "Start the Loupedeck controller to open links from the wallpaper."; render(); setTimeout(() => { linkNote = ""; render(); }, 8000); });
  }
  function flash(btn, text) { if (!btn) return; const s = btn.querySelector("span"); if (!s) return; const old = s.textContent; s.textContent = text; setTimeout(() => (s.textContent = old), 1600); }
  // ---------- inside vs outside ----------
  let outside = null, outsideTimer = null, outsideKey = "";
  const WMO = { 0: "CLEAR", 1: "MOSTLY CLEAR", 2: "PART CLOUDY", 3: "OVERCAST", 45: "FOG", 48: "FOG", 51: "DRIZZLE", 53: "DRIZZLE", 55: "DRIZZLE", 61: "RAIN", 63: "RAIN", 65: "HEAVY RAIN", 66: "SLEET", 67: "SLEET", 71: "SNOW", 73: "SNOW", 75: "HEAVY SNOW", 80: "SHOWERS", 81: "SHOWERS", 82: "HEAVY SHOWERS", 95: "THUNDER", 96: "THUNDER", 99: "THUNDER" };
  function outsideCfg() {
    const m = String(cfg.haoutside || "").match(/^\s*([^=]*)=\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    return m ? { label: m[1].trim() || "OUTSIDE", lat: +m[2], lon: +m[3] } : null;
  }
  function fetchOutside() {
    const o = outsideCfg(); if (!o) { outside = null; return renderTemps(); }
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${o.lat}&longitude=${o.lon}&current=temperature_2m,weather_code,cloud_cover,precipitation,rain,snowfall,wind_speed_10m,wind_direction_10m,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=1&timezone=auto`)
      .then((r) => r.json()).then((j) => {
        const d = j.daily || {};
        outside = { label: o.label, t: j.current.temperature_2m, code: j.current.weather_code, max: d.temperature_2m_max?.[0], min: d.temperature_2m_min?.[0], rain: d.precipitation_probability_max?.[0], dayCode: d.weather_code?.[0],
          cloud: j.current.cloud_cover, precip: j.current.precipitation, snow: j.current.snowfall, wind: j.current.wind_speed_10m, windDir: j.current.wind_direction_10m, isDay: j.current.is_day };
        window.eddoOutside = outside;   // shared with the House tab's heat view
        renderTemps();
      })
      .catch(() => {});
  }
  function syncOutside() {
    if (cfg.haoutside === outsideKey) return; outsideKey = cfg.haoutside;
    clearInterval(outsideTimer); fetchOutside(); outsideTimer = setInterval(fetchOutside, 10 * 60 * 1000);
  }
  function insideTemp() {
    const st = states.get(cfg.hainside); if (!st) return null;
    const v = st.a && st.a.current_temperature != null ? st.a.current_temperature : parseFloat(st.s);
    return Number.isFinite(+v) ? +v : null;
  }
  function renderTemps() {
    if (!temps) return;
    const inT = insideTemp(), o = outside;
    if (inT == null && !o) { temps.innerHTML = ""; return; }
    const fmt = (v) => (v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1));
    const diff = inT != null && o ? inT - o.t : null;
    temps.innerHTML =
      `<div class="eddo-ha-temp"><b>${fmt(inT)}<sup>°</sup></b><span>INSIDE<br>${esc((cfg.haarea || "OFFICE").toUpperCase())}</span></div>` +
      `<div class="eddo-ha-temp-diff">${diff == null ? "" : (diff >= 0 ? "+" : "−") + Math.abs(diff).toFixed(1) + "°"}</div>` +
      `<div class="eddo-ha-temp"><b>${fmt(o && o.t)}<sup>°</sup></b><span>OUTSIDE<br>${esc(o ? o.label.toUpperCase() + (WMO[o.code] ? " · " + WMO[o.code] : "") : "")}</span></div>`;
  }
  function onPanelClick(e) {
    const lb = e.target.closest("button[data-link]"); if (lb) return openLink(lb.dataset.link, lb);
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const host = b.closest("[data-entity]"), id = host.dataset.entity, dom = id.split(".")[0], act = b.dataset.act;
    let call;
    if (act === "expand") { expanded.has(id) ? expanded.delete(id) : expanded.add(id); return render(); }
    if (act === "light") { lightOpen = lightOpen === id ? null : id; return render(); }
    if (act === "hs") return void lightCall(id, { hs_color: [+b.dataset.h, +b.dataset.s] });
    if (act === "ct") { const a = states.get(id)?.a || {}; return void lightCall(id, { color_temp_kelvin: b.dataset.ct === "warm" ? (a.min_color_temp_kelvin || 2200) : (a.max_color_temp_kelvin || 6500) }); }
    if (act === "mode") {
      const m = b.dataset.mode, off = states.get(id)?.s === "off";
      call = m === "power" ? { domain: "homeassistant", service: "toggle" } : { domain: "climate", service: "set_hvac_mode", service_data: { hvac_mode: m } };
    } else if (act === "toggle") {
      if (PRESS.has(dom)) call = { domain: dom, service: dom === "scene" ? "turn_on" : dom === "script" ? "turn_on" : "press" };
      else call = { domain: dom === "cover" ? "cover" : "homeassistant", service: "toggle" };
    } else {
      const a = states.get(id)?.a || {}, step = a.target_temp_step || 0.5, d = act === "up" ? step : -step;
      const r1 = (v) => Math.round(v * 10) / 10;
      const data = a.temperature == null && a.target_temp_low != null
        ? { target_temp_low: r1(a.target_temp_low + d), target_temp_high: r1((a.target_temp_high ?? a.target_temp_low + 2) + d) }
        : { temperature: r1((a.temperature ?? 20) + d) };
      if (a.temperature != null) a.temperature = data.temperature; // so quick repeat clicks keep counting
      call = { domain: "climate", service: "set_temperature", service_data: data };
    }
    host.dataset.busy = "true";
    send({ type: "call_service", domain: call.domain, service: call.service, target: { entity_id: id }, service_data: call.service_data || {} })
      .catch((err) => { linkNote = `${names.get(id) || id}: ${err.message || err}`; console.warn("[EDDO HA]", call, err); render(); setTimeout(() => { linkNote = ""; render(); }, 10000); }).finally(() => { const r = list.querySelector(`[data-entity="${CSS.escape(id)}"]`); r && delete r.dataset.busy; });
  }

  setInterval(() => { if (panel && !panel.isConnected) { panel = null; render(); } }, 3000);
  // ---------- collapsible panels (Home Systems, Today's tasks) ----------
  const UI_KEY = "eddo-os-ui";
  let ui = {};
  try { ui = JSON.parse(localStorage.getItem(UI_KEY) || "{}") || {}; } catch (_) {}
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (_) {} };
  function applyCollapsed() {
    if (panel) {
      panel.dataset.collapsed = String(!!ui.ha);
      panel.querySelector("[data-collapse=ha]")?.setAttribute("aria-expanded", String(!ui.ha));
    }
    const today = document.querySelector("#stage .wb-today");
    if (today && today.dataset.collapsed !== String(!!ui.tasks)) today.dataset.collapsed = String(!!ui.tasks);
  }
  setInterval(applyCollapsed, 1500);

  // ↻ on Today's tasks: ask HA to re-pull Google Tasks now, then reload the list.
  function ensureRefreshButton() {
    const head = document.querySelector("#stage .wb-today .wb-heading"); if (!head) return;
    let b = head.querySelector(".eddo-task-refresh");
    if (!b) {
      b = document.createElement("button"); b.className = "eddo-task-refresh"; b.title = "Re-sync tasks"; b.setAttribute("aria-label", "Re-sync tasks");
      b.textContent = "↻"; const cnt = head.querySelector(".wb-task-count"); if (cnt) cnt.before(b); else head.append(b);
    }
    b.hidden = !(cfg.hatasks && todoEntity && ws);
    let o = head.querySelector(".eddo-task-open");
    if (!o) {
      o = document.createElement("button"); o.className = "eddo-task-open"; o.title = "Edit in Google Tasks";
      o.innerHTML = "Open Google Tasks <span>↗</span>"; b.before(o);
    }
    o.hidden = !cfg.hatasks;
  }
  setInterval(ensureRefreshButton, 1500);
  async function refreshTasks(btn) {
    if (!todoEntity || !ws || btn.dataset.spin === "true") return;
    btn.dataset.spin = "true";
    try {
      await send({ type: "call_service", domain: "homeassistant", service: "update_entity", target: { entity_id: todoEntity } }).catch(() => {});
      const r = await send({ type: "call_service", domain: "todo", service: "get_items", target: { entity_id: todoEntity }, return_response: true }).catch(() => null);
      const items = r && r.response && r.response[todoEntity] && r.response[todoEntity].items;
      if (Array.isArray(items)) { todoItems = items.map((x) => ({ uid: x.uid, summary: x.summary, status: x.status })); tasksLoaded = true; localDone.clear(); pushTasks(); }
    } finally { setTimeout(() => { btn.dataset.spin = "false"; }, 600); }
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest) return;
    if (e.target.closest("[data-collapse=ha]")) {
      if (panel && panel.dataset.squeezed === "true") { panel.dataset.squeezed = "false"; panel.dataset.peek = "true"; return; }
      ui.ha = !ui.ha; saveUi(); applyCollapsed(); requestAnimationFrame(placePanel); return;
    }
    if (e.target.closest(".eddo-task-refresh")) { refreshTasks(e.target.closest(".eddo-task-refresh")); return; }
    if (e.target.closest(".eddo-task-open")) { openLink(cfg.hatasksurl || "https://tasks.google.com/", e.target.closest(".eddo-task-open")); return; }
    if (e.target.closest(".wb-today .wb-heading")) { ui.tasks = !ui.tasks; saveUi(); applyCollapsed(); }
  });

  // ---------- extra workspace tabs (06 Game mode, 07 Jarvis, …) ----------
  const tabs = [];
  let activeTab = null;
  // number of the workspace's own tabs currently shown (05 Focus timer is hidden)
  const baseCount = () => document.querySelectorAll("#stage .wb-nav [data-wb-lane]:not([hidden])").length || 4;
  window.eddoTabs = {
    register(tab) { tabs.push(tab); tabs.sort((a, b) => (a.pos ?? 50) - (b.pos ?? 50)); },   // { id, label, pos?, render(contentEl), onShow?, onHide? }
    rerender(id) { if (activeTab && activeTab.id === id) renderTab(); },
    active: () => activeTab && activeTab.id,
  };
  const total = () => String(baseCount() + tabs.length).padStart(2, "0");
  function tabButtons() {
    const nav = document.querySelector("#stage .wb-nav"); if (!nav) return;
    tabs.forEach((t, i) => {
      let b = nav.querySelector(`[data-eddo-tab="${t.id}"]`);
      if (!b) {
        b = document.createElement("button");
        b.dataset.eddoTab = t.id; b.setAttribute("aria-pressed", "false");
        b.innerHTML = `<small></small>${t.label}<span>↗</span>`;
      }
      const num = String(baseCount() + 1 + i).padStart(2, "0");
      if (b.firstChild.textContent !== num) b.firstChild.textContent = num;
      if (b.parentNode !== nav) nav.append(b);
    });
    const now = [...nav.querySelectorAll("[data-eddo-tab]")].map((x) => x.dataset.eddoTab).join(), want = tabs.map((t) => t.id).join();
    if (now !== want) tabs.forEach((t) => nav.append(nav.querySelector(`[data-eddo-tab="${t.id}"]`)));
  }
  function renderTab() {
    const root = document.querySelector("#stage .workbench"); if (!root || !activeTab) return;
    const i = tabs.indexOf(activeTab);
    root.querySelector(".wb-title").textContent = activeTab.label;
    root.querySelector(".wb-index").textContent = `${String(baseCount() + 1 + i).padStart(2, "0")} / ${total()}`;
    root.querySelectorAll("[data-wb-lane]").forEach((x) => x.setAttribute("aria-pressed", "false"));
    root.querySelectorAll("[data-eddo-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.eddoTab === activeTab.id)));
    const content = root.querySelector(".wb-content");
    // the task list may be sitting inside the content (02 Today's tasks) — keep it safe
    const today = content.querySelector(".wb-today"); if (today) root.querySelector(".wb-overview").append(today);
    content.dataset.eddoTab = activeTab.id;
    activeTab.render(content);
  }
  function showTab(t) { if (activeTab && activeTab !== t) activeTab.onHide?.(); activeTab = t; renderTab(); t.onShow?.(); }
  function hideTab() {
    if (!activeTab) return; activeTab.onHide?.(); activeTab = null;
    document.querySelectorAll("#stage [data-eddo-tab]").forEach((x) => x.setAttribute("aria-pressed", "false"));
    const c = document.querySelector("#stage .wb-content"); if (c) delete c.dataset.eddoTab;
    window.dispatchEvent(new Event("rhine-language-change")); // makes the workspace redraw its own tab
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest) return;
    const tb = e.target.closest("[data-eddo-tab]");
    if (tb && tb.tagName === "BUTTON" && tb.closest(".wb-nav")) { const t = tabs.find((x) => x.id === tb.dataset.eddoTab); t && showTab(t); return; }
    if (e.target.closest("#stage [data-wb-lane]") && activeTab) hideTab();
  }, true);
  setInterval(() => {
    tabButtons();
    const idx = document.querySelector("#stage .wb-index"), content = document.querySelector("#stage .wb-content");
    if (activeTab) { if (!content || content.dataset.eddoTab !== activeTab.id || document.querySelector("#stage .wb-title")?.textContent !== activeTab.label) renderTab(); }
    else fixIndex();
  }, 500);
  // The app rewrites "01 / 03" every second; correct it in the same frame so it never flickers.
  function fixIndex() {
    const idx = document.querySelector("#stage .wb-index");
    if (idx && !activeTab && / \/ 0\d$/.test(idx.textContent) && !idx.textContent.endsWith("/ " + total())) idx.textContent = idx.textContent.replace(/\/ 0\d$/, "/ " + total());
  }
  (function watchIndex() {
    const stage = document.querySelector("#stage");
    if (!stage) return setTimeout(watchIndex, 500);
    new MutationObserver((muts) => { try { if (muts.some((m) => (m.target.nodeType === 3 ? m.target.parentNode : m.target)?.closest?.(".wb-index") || [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches(".wb-index") || n.querySelector?.(".wb-index"))))) fixIndex(); } catch (_) {} })
      .observe(stage, { subtree: true, childList: true, characterData: true });
  })();

  // 06 Game mode
  const GAME_LINKS = [["Open Steam", "steam://open/games", "Library"], ["Big Picture", "steam://open/bigpicture", "Controller / TV mode"], ["Friends", "steam://open/friends", "Who's online"]];
  if (!window.EDDO_WEB) window.eddoTabs.register({
    id: "game", label: "Game mode",
    render(c) {
      c.innerHTML = `<div class="wb-large">STEAM<small>GAME MODE</small></div>` +
        `<div class="eddo-game">${GAME_LINKS.map(([l, u, sub]) => `<button data-steam="${u}"><b>${l}</b><small>${sub}</small><span>↗</span></button>`).join("")}</div>` +
        `<p class="wb-muted eddo-game-note"></p>`;
    },
  });
  document.addEventListener("click", (e) => {
    const st = e.target.closest && e.target.closest("[data-steam]"); if (!st) return;
    const note = document.querySelector(".eddo-game-note");
    fetch(`${BRIDGE}/open?url=${encodeURIComponent(st.dataset.steam)}`).then((r) => { if (!r.ok) throw 0; note && (note.textContent = "Launching…"); })
      .catch(() => { note && (note.textContent = "Start the Loupedeck controller to launch Steam from the wallpaper."); });
  });

  // ---------- background darkening ----------
  // A black veil between the 3D scene / custom image and the interface.
  function applyDim() {
    const stage = document.querySelector("#stage"); if (!stage) return;
    let veil = stage.querySelector(".eddo-dim");
    if (!veil) {
      veil = document.createElement("div"); veil.className = "eddo-dim"; veil.setAttribute("aria-hidden", "true");
      const anchor = stage.querySelector(".scene-atmosphere") || stage.querySelector(".wallpaper-background") || stage.querySelector("#three-scene");
      if (anchor) anchor.after(veil); else stage.prepend(veil);
    }
    veil.style.opacity = String(Math.max(0, Math.min(90, cfg.bgdim)) / 100);
  }
  setInterval(() => { if (!document.querySelector("#stage .eddo-dim")) applyDim(); }, 3000);
  // ---------- start ----------
  function start() {
    readProps(window.rhineWallpaperHost && window.rhineWallpaperHost.properties);
    applyDim(); syncOutside(); render(); maybeConnect();
  }
  (window.rhineWallpaperPropertiesReady || Promise.resolve()).then(() => setTimeout(start, 0));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => render()); else render();
})();
