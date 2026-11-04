// EDDO OS · extras: Server / Eddo-NAS panel and the 07 Jarvis tab.
// Uses the Home Assistant connection from eddo-ha.js (window.eddoHA).
(() => {
  "use strict";
  const HA = () => window.eddoHA;
  const cfg = () => (window.eddoHA ? window.eddoHA.cfg : {});
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // =====================================================================
  // Server / Eddo-NAS — found automatically from HA entities whose name,
  // entity id or device matches the keywords (default: unraid, eddo_nas).
  // =====================================================================
  const srv = { ids: [], role: new Map(), names: new Map(), states: new Map(), found: false, ready: false };
  let srvEl = null;

  function classify(id, name, unit, dom) {
    const t = (id + " " + name).toLowerCase();
    const pct = unit === "%", deg = /°|c$/i.test(unit || "") && /°/.test(unit || "");
    if (dom === "switch" || dom === "update" || /docker|container|update/.test(t) && !unit) return null;
    if (/array/.test(t) && pct) return "array_pct";
    if (/array/.test(t) && !unit) return "array_state";
    if (/cache|pool/.test(t) && pct) return "cache_pct";
    if (/cpu|processor/.test(t) && pct && !/temp/.test(t)) return "cpu_pct";
    if (/(memory|ram)\b/.test(t) && pct) return "ram_pct";
    if (deg && /cpu|processor|package|motherboard|core/.test(t)) return "cpu_temp";
    if (deg && /disk|parity|cache|nvme|ssd|hdd/.test(t)) return "disk_temp";
    if (/uptime/.test(t)) return "uptime";
    if (/parity/.test(t) && !unit) return "parity";
    return null;
  }

  window.addEventListener("eddo-ha-ready", (e) => {
    const { allStates, devices, ents } = e.detail;
    const words = String(cfg().haunraid || "").toLowerCase().split(",").map((w) => w.trim()).filter(Boolean);
    srv.ids = []; srv.role.clear(); srv.names.clear(); srv.states.clear(); srv.ready = true;
    if (!words.length || cfg().showunraid === false) { srv.found = false; renderSrv(); return; }
    const devName = new Map(devices.map((d) => [d.id, (d.name_by_user || d.name || "") + " " + (d.manufacturer || "") + " " + (d.model || "")]));
    const reg = new Map(ents.map((x) => [x.entity_id, x]));
    const hit = (txt) => words.some((w) => txt.includes(w) || txt.includes(w.replace(/[-_ ]/g, "")));
    for (const st of allStates) {
      const r = reg.get(st.entity_id), dn = (r && devName.get(r.device_id) || "").toLowerCase();
      const name = st.attributes.friendly_name || st.entity_id;
      if (r && (r.disabled_by || r.hidden_by)) continue;
      if (!hit((st.entity_id + " " + name).toLowerCase()) && !hit(dn)) continue;
      const role = classify(st.entity_id, name, st.attributes.unit_of_measurement, st.entity_id.split(".")[0]);
      if (!role) continue;
      srv.ids.push(st.entity_id); srv.role.set(st.entity_id, role);
      srv.names.set(st.entity_id, name.replace(/^(unraid|eddo[-_ ]?nas)\s*/i, "").replace(/\b(docker|container)\b\s*/ig, "").trim() || name);
      srv.states.set(st.entity_id, { s: st.state, a: st.attributes });
    }
    srv.found = srv.ids.length > 0;
    if (srv.found) HA().subscribe({ type: "subscribe_entities", entity_ids: srv.ids }, (ev) => {
      for (const [id, v] of Object.entries(ev.a || {})) srv.states.set(id, { s: v.s, a: v.a || {} });
      for (const [id, v] of Object.entries(ev.c || {})) {
        const cur = srv.states.get(id) || { s: "", a: {} };
        if (v["+"]) { if ("s" in v["+"]) cur.s = v["+"].s; if (v["+"].a) Object.assign(cur.a, v["+"].a); }
        srv.states.set(id, cur);
      }
      renderSrv();
    }).catch(() => {});
    renderSrv();
  });

  function ensureSrv() {
    if (srvEl && srvEl.isConnected) return true;
    const ov = document.querySelector("#stage .wb-overview"); if (!ov) return false;
    srvEl = document.createElement("section");
    srvEl.className = "eddo-srv";
    ov.append(srvEl);
    return true;
  }
  const byRole = (role) => srv.ids.filter((id) => srv.role.get(id) === role);
  const num = (id) => { const v = parseFloat(srv.states.get(id)?.s); return Number.isFinite(v) ? v : null; };
  function renderSrv() {
    if (!ensureSrv()) return;
    srvEl.hidden = cfg().showunraid === false || !srv.ready;
    if (srvEl.hidden) return;
    let collapsed = false; try { collapsed = !!JSON.parse(localStorage.getItem("eddo-os-ui") || "{}").srv; } catch (_) {}
    srvEl.dataset.collapsed = String(collapsed);
    const head = `<button class="eddo-srv-head" data-srv-toggle><span>SERVER / <b>EDDO-NAS</b></span><span class="eddo-ha-right"><i class="eddo-caret"></i><span class="eddo-srv-dot" data-ok="${srvOk()}"></span></span></button>`;
    if (!srv.found) { srvEl.innerHTML = head + `<p class="wb-muted">No Unraid entities found in Home Assistant. Add the Unraid integration (or set the server keywords in Wallpaper Engine settings).</p>`; return; }
    const bar = (label, id) => { const v = num(id); return v == null ? "" : `<div class="eddo-srv-bar"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"${v >= 90 ? ' data-hot="true"' : ""}></b></i><em>${Math.round(v)}%</em></div>`; };
    const first = (r) => byRole(r)[0];
    const arr = first("array_state"), up = first("uptime");
    const temps = [];
    const ct = first("cpu_temp"); if (ct && num(ct) != null) temps.push(`CPU ${Math.round(num(ct))}°`);
    const dts = byRole("disk_temp").map(num).filter((v) => v != null); if (dts.length) temps.push(`DISKS ≤ ${Math.round(Math.max(...dts))}°`);
    const line = [arr ? "ARRAY " + String(srv.states.get(arr).s).toUpperCase() : "", up ? "UP " + fmtUptime(srv.states.get(up)) : "", ...temps].filter(Boolean).join("  ·  ");
    srvEl.innerHTML = head + `<div class="eddo-srv-body">` +
      bar("CPU", first("cpu_pct")) + bar("RAM", first("ram_pct")) + bar("ARRAY", first("array_pct")) + bar("CACHE", first("cache_pct")) +
      `</div>`;
  }
  function srvOk() {
    const arr = byRole("array_state")[0]; if (!arr) return srv.found;
    return /start|online|ok|normal/i.test(srv.states.get(arr)?.s || "");
  }
  function fmtUptime(st) {
    const v = st && st.s; if (!v) return "";
    const d = Date.parse(v); if (Number.isFinite(d) && /T|-/.test(v)) { const days = (Date.now() - d) / 864e5; return days >= 1 ? Math.floor(days) + "D" : Math.floor(days * 24) + "H"; }
    const n = parseFloat(v), u = (st.a && st.a.unit_of_measurement || "").toLowerCase();
    if (!Number.isFinite(n)) return String(v).toUpperCase();
    const hours = u.startsWith("d") ? n * 24 : u.startsWith("h") ? n : u.startsWith("min") ? n / 60 : n / 3600;
    return hours >= 24 ? Math.floor(hours / 24) + "D" : Math.floor(hours) + "H";
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest("[data-srv-toggle]")) return;
    let ui = {}; try { ui = JSON.parse(localStorage.getItem("eddo-os-ui") || "{}") || {}; } catch (_) {}
    ui.srv = !ui.srv; try { localStorage.setItem("eddo-os-ui", JSON.stringify(ui)); } catch (_) {}
    renderSrv();
  });
  setInterval(() => { if (!srvEl || !srvEl.isConnected) renderSrv(); }, 2000);
  window.addEventListener("eddo-config", renderSrv);

  // =====================================================================
  // EDDO-PC — this PC's load and temperatures, from the PC controller
  // (CPU/RAM from Windows, GPU from nvidia-smi, CPU + coolant temperature
  // from LibreHardwareMonitor when it's running).
  // =====================================================================
  let pcEl = null, pcData = null, pcHtml = "";
  function ensurePc() {
    const ov = document.querySelector("#stage .wb-overview"); if (!ov) return false;
    if (!pcEl) { pcEl = document.createElement("section"); pcEl.className = "eddo-srv eddo-pc"; }
    if (srvEl && srvEl.isConnected && srvEl.parentNode === ov) { if (srvEl.nextElementSibling !== pcEl) srvEl.after(pcEl); }
    else if (pcEl.parentNode !== ov) ov.append(pcEl);
    return true;
  }
  function renderPc() {
    if (!ensurePc()) return;
    pcEl.hidden = cfg().showpc === false || !!window.EDDO_WEB || !pcData;
    if (pcEl.hidden) return;
    let collapsed = false; try { collapsed = !!JSON.parse(localStorage.getItem("eddo-os-ui") || "{}").pc; } catch (_) {}
    pcEl.dataset.collapsed = String(collapsed);
    const d = pcData, r = (v) => Math.round(v);
    const hot = d.cpuTemp >= 85 || d.gpuTemp >= 83 || d.coolant >= 45;
    const bar = (label, v) => v == null ? "" : `<div class="eddo-srv-bar"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"${v >= 90 ? ' data-hot="true"' : ""}></b></i><em>${r(v)}%</em></div>`;
    const temps = [d.cpuTemp != null ? `CPU ${r(d.cpuTemp)}°` : "", d.gpuTemp != null ? `GPU ${r(d.gpuTemp)}°` : "", d.coolant != null ? `COOLANT ${d.coolant.toFixed(1)}°` : "", d.gpuWatts != null ? `${r(d.gpuWatts)}W` : ""].filter(Boolean).join("  ·  ");
    const html = `<button class="eddo-srv-head" data-pc-toggle><span>PC / <b>EDDO-PC</b></span><span class="eddo-ha-right"><i class="eddo-caret"></i><span class="eddo-srv-dot" data-ok="${!hot}"${hot ? ' data-hot="true"' : ""}></span></span></button>` +
      `<div class="eddo-srv-body">${bar("CPU", d.cpu)}${bar("GPU", d.gpu)}${bar("RAM", d.ram)}${bar("VRAM", d.vram)}` +
      (temps ? `<p class="eddo-srv-line">${temps}</p>` : "") + `</div>`;
    if (html !== pcHtml || !pcEl.firstChild) { pcHtml = html; pcEl.innerHTML = html; }
  }
  async function pollPc() {
    if (window.EDDO_WEB) return;
    const base = (window.eddoHA && window.eddoHA.bridge) || ("http://127.0.0.1:47290" + (window.EDDO_BRIDGE_KEY ? "/k/" + window.EDDO_BRIDGE_KEY : ""));
    try { const res = await fetch(base + "/pc"); pcData = res.ok ? await res.json() : null; } catch (_) { pcData = null; }
    renderPc();
  }
  pollPc(); setInterval(pollPc, 5000);
  setInterval(() => { if (!pcEl || !pcEl.isConnected) { pcHtml = ""; renderPc(); } }, 2000);
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest("[data-pc-toggle]")) return;
    let ui = {}; try { ui = JSON.parse(localStorage.getItem("eddo-os-ui") || "{}") || {}; } catch (_) {}
    ui.pc = !ui.pc; try { localStorage.setItem("eddo-os-ui", JSON.stringify(ui)); } catch (_) {}
    pcHtml = ""; renderPc();
  });

  // =====================================================================
  // Printer / Bambu Lab — found from the ha-bambulab integration (device
  // manufacturer "Bambu Lab"). Sits under the Server panel.
  // =====================================================================
  const prn = { diag: "", dev: "", name: "", ids: [], role: new Map(), states: new Map(), found: false, ready: false, last: "" };
  let prnEl = null, prnImg = null, prnHtml = "";
  function prnRole(dom, key) {
    if (dom === "image" && /cover/.test(key)) return "cover";
    if (dom === "light" && /chamber|light/.test(key)) return "light";
    if (dom === "button" && /pause/.test(key)) return "pause";
    if (dom === "button" && /resume/.test(key)) return "resume";
    if (dom !== "sensor") return null;
    if (/print_status/.test(key)) return "status";
    if (/current_stage|print_stage/.test(key)) return "stage";
    if (/print_progress/.test(key)) return "progress";
    if (/remaining_time/.test(key)) return "remaining";
    if (/end_time/.test(key)) return "end";
    if (/target/.test(key)) return null;
    if (/nozzle_temp/.test(key)) return "nozzle";
    if (/bed_temp/.test(key)) return "bed";
    if (/current_layer/.test(key)) return "layer";
    if (/total_layer/.test(key)) return "layers";
    if (/subtask_name|task_name/.test(key)) return "task";
    if (/gcode_file$/.test(key)) return "file";
    if (/active_tray$/.test(key)) return "tray";
    return null;
  }
  window.addEventListener("eddo-ha-ready", (e) => {
    const { allStates, devices, ents } = e.detail;
    prn.ids = []; prn.role.clear(); prn.states.clear(); prn.ready = true; prn.found = false;
    const words = String(cfg().haprinter || "bambu").toLowerCase().split(",").map((w) => w.trim()).filter(Boolean);
    let cand = devices.filter((d) => words.some((w) => ((d.manufacturer || "") + " " + (d.name_by_user || d.name || "") + " " + (d.model || "")).toLowerCase().includes(w)));
    // Fallback: any device that owns a print progress / status sensor.
    const printy = ents.filter((x) => /print_progress|print_status|printer_state|current_print|print_job/.test(((x.translation_key || "") + " " + x.entity_id).toLowerCase()) && x.device_id);
    if (!cand.length) { const ids = new Set(printy.map((x) => x.device_id)); cand = devices.filter((d) => ids.has(d.id)); }
    prn.diag = cand.length ? "" : "No printer device found. Printer-like entities: " + (printy.slice(0, 4).map((x) => x.entity_id).join(", ") || "none") + ".";
    const byDev = new Map(cand.map((d) => [d.id, []]));
    for (const x of ents) if (byDev.has(x.device_id) && !x.disabled_by) byDev.get(x.device_id).push(x);
    let best = null; for (const d of cand) if (!best || byDev.get(d.id).length > byDev.get(best.id).length) best = d;
    if (!best || !byDev.get(best.id).length) { renderPrn(); return; }
    prn.diag = "Found " + (best.name_by_user || best.name) + " (" + (best.manufacturer || "") + " " + (best.model || "") + ") but couldn't read its sensors: " + byDev.get(best.id).slice(0, 6).map((x) => x.entity_id).join(", ");
    prn.dev = best.id; prn.name = cfg().printername || "EDDO-PRINT";
    const stMap = new Map(allStates.map((s) => [s.entity_id, s]));
    for (const x of byDev.get(best.id)) {
      const dom = x.entity_id.split(".")[0], key = ((x.translation_key || "") + " " + x.entity_id).toLowerCase();
      const role = prnRole(dom, key); if (!role) continue;
      if ([...prn.role.values()].includes(role) && role !== "light") continue;
      if (role === "light" && [...prn.role.values()].includes("light") && !/chamber/.test(key)) continue;
      prn.ids.push(x.entity_id); prn.role.set(x.entity_id, role);
      const st = stMap.get(x.entity_id); if (st) prn.states.set(x.entity_id, { s: st.state, a: st.attributes });
    }
    prn.found = prn.ids.length > 0;
    prn.last = String(prnVal("status") || "").toLowerCase();
    if (prn.found) HA().subscribe({ type: "subscribe_entities", entity_ids: prn.ids }, (ev) => {
      for (const [id, v] of Object.entries(ev.a || {})) prn.states.set(id, { s: v.s, a: v.a || {} });
      for (const [id, v] of Object.entries(ev.c || {})) {
        const cur = prn.states.get(id) || { s: "", a: {} };
        if (v["+"]) { if ("s" in v["+"]) cur.s = v["+"].s; if (v["+"].a) Object.assign(cur.a, v["+"].a); }
        prn.states.set(id, cur);
      }
      prnWatch(); renderPrn();
    }).catch(() => {});
    renderPrn();
  });
  const prnId = (role) => prn.ids.find((id) => prn.role.get(id) === role);
  const prnSt = (role) => { const id = prnId(role); return id ? prn.states.get(id) : null; };
  const prnVal = (role) => { const s = prnSt(role); return s && !/^(unknown|unavailable)$/.test(s.s) ? s.s : null; };
  const prnNum = (role) => { const v = parseFloat(prnVal(role)); return Number.isFinite(v) ? v : null; };
  function prnPhase() {
    const s = String(prnVal("status") || "").toLowerCase();
    if (/running|printing|prepare|slicing|init/.test(s)) return "printing";
    if (/pause/.test(s)) return "paused";
    if (/fail/.test(s)) return "failed";
    if (/finish/.test(s)) return "finished";
    if (/offline/.test(s) || (prnSt("status") && /unavailable/.test(prnSt("status").s))) return "offline";
    return "idle";
  }
  function prnMinutes() {
    const st = prnSt("remaining"); const n = prnNum("remaining"); if (n == null) return null;
    const u = String(st.a.unit_of_measurement || "min").toLowerCase();
    return u.startsWith("h") ? n * 60 : u === "s" ? n / 60 : u.startsWith("d") ? n * 1440 : n;
  }
  const prnTask = () => String(prnVal("task") || prnVal("file") || "").replace(/\.(gcode|3mf)$/i, "").replace(/_/g, " ").trim();
  function fmtMins(m) { m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h}H ${m % 60}M` : `${m}M`; }
  function prnDone() {
    const e = prnVal("end"); let t = e && Date.parse(e);
    if (!Number.isFinite(t)) { const m = prnMinutes(); if (m == null) return ""; t = Date.now() + m * 60e3; }
    const d = new Date(t); return (d.toDateString() !== new Date().toDateString() ? "TMRW " : "") + d.toTimeString().slice(0, 5);
  }
  function ensurePrn() {
    const ov = document.querySelector("#stage .wb-overview"); if (!ov) return false;
    if (!prnEl) { prnEl = document.createElement("section"); prnEl.className = "eddo-srv eddo-prn"; }
    const anchor = pcEl && pcEl.isConnected && pcEl.parentNode === ov ? pcEl : srvEl && srvEl.isConnected && srvEl.parentNode === ov ? srvEl : null;
    if (anchor) { if (anchor.nextElementSibling !== prnEl) anchor.after(prnEl); }
    else if (prnEl.parentNode !== ov) ov.append(prnEl);
    return true;
  }
  function renderPrn() {
    if (!ensurePrn()) return;
    prnEl.hidden = cfg().showprinter === false || !prn.ready;
    if (prnEl.hidden) return;
    if (!prn.found) { prnEl.dataset.phase = "offline"; prnHtml = ""; prnEl.innerHTML = `<button class="eddo-srv-head"><span>PRINTER / <b>BAMBU LAB</b></span><span class="eddo-ha-right"><span class="eddo-prn-dot"></span></span></button><p class="wb-muted eddo-prn-diag">${esc(prn.diag || "No printer found in Home Assistant.")}</p>`; return; }
    let collapsed = false; try { collapsed = !!JSON.parse(localStorage.getItem("eddo-os-ui") || "{}").prn; } catch (_) {}
    prnEl.dataset.collapsed = String(collapsed);
    const ph = prnPhase(); prnEl.dataset.phase = ph;
    const label = { printing: "PRINTING", paused: "PAUSED", failed: "FAILED", finished: "FINISHED", offline: "OFFLINE", idle: "IDLE" }[ph];
    const head = `<button class="eddo-srv-head" data-prn-toggle><span>PRINTER / <b>${esc(String(prn.name).toUpperCase())}</b></span><span class="eddo-ha-right"><em class="eddo-prn-label">${label}</em><i class="eddo-caret"></i><span class="eddo-prn-dot"></span></span></button>`;
    const nz = prnNum("nozzle"), bd = prnNum("bed");
    const temps = [nz != null ? `NOZZLE ${Math.round(nz)}°` : "", bd != null ? `BED ${Math.round(bd)}°` : ""].filter(Boolean).join("  ·  ");
    const tray = prnSt("tray"), col = tray && tray.a && (tray.a.color || tray.a.colour);
    const swatch = col ? `<i class="eddo-prn-fil" style="background:${esc(String(col).slice(0, 7))}" title="${esc(tray.a.name || tray.s || "")}"></i>` : "";
    const acts = "";
    let body;
    if (ph === "printing" || ph === "paused") {
      const p = prnNum("progress") ?? 0, m = prnMinutes(), l = prnNum("layer"), L = prnNum("layers");
      const cover = prnSt("cover"), pic = cover && cover.a && cover.a.entity_picture;
      const stage = String(prnVal("stage") || "").replace(/_/g, " ");
      const meta = [l != null && L ? `LAYER ${l}/${L}` : "", m != null && ph === "printing" ? `${fmtMins(m)} LEFT` : "", ph === "printing" && prnDone() ? `DONE ${prnDone()}` : ""].filter(Boolean).join("  ·  ");
      body = `<div class="eddo-prn-job">` +
        (pic ? `<span class="eddo-prn-cover-slot" data-src="${esc(HA().baseUrl() + pic)}"></span>` : "") +
        `<div class="eddo-prn-info"><b>${esc(prnTask() || "Print job")}</b><span>${swatch}${esc(stage && !/printing/i.test(stage) ? stage.toUpperCase() : (ph === "paused" ? "PAUSED" : "PRINTING"))}</span></div></div>` +
        `<div class="eddo-srv-bar"><span>JOB</span><i><b style="width:${Math.max(0, Math.min(100, p))}%"></b></i><em>${Math.round(p)}%</em></div>` +
        (meta ? `<p class="eddo-srv-line">${meta}</p>` : "") +
        `<div class="eddo-prn-foot"><p class="eddo-srv-line">${temps}</p><div>${acts}</div></div>`;
    } else {
      const t = ph === "finished" || ph === "failed" ? `<p class="eddo-prn-last">${ph === "failed" ? "Failed" : "Finished"}${prnTask() ? ": " + esc(prnTask()) : ""}</p>` : "";
      body = t + `<div class="eddo-prn-foot"><p class="eddo-srv-line">${swatch}${temps || label}</p><div>${acts}</div></div>`;
    }
    const html = head + `<div class="eddo-srv-body">${body}</div>`;
    if (html === prnHtml && prnEl.firstChild) return;
    prnHtml = html; prnEl.innerHTML = html;
    const slot = prnEl.querySelector(".eddo-prn-cover-slot");
    if (slot) {
      const src = slot.dataset.src;
      if (!prnImg || prnImg.dataset.src !== src) {
        prnImg = new Image(); prnImg.className = "eddo-prn-cover"; prnImg.alt = ""; prnImg.dataset.src = src;
        prnImg.onerror = () => { prnImg.style.visibility = "hidden"; };
        prnImg.src = src;
      }
      slot.replaceWith(prnImg);
    }
  }
  // Jarvis tells you when a print finishes or fails.
  function prnWatch() {
    const now = String(prnVal("status") || "").toLowerCase(), was = prn.last;
    if (!now || now === was) return;
    prn.last = now;
    if (cfg().printannounce === false || !/running|printing|pause/.test(was)) return;
    const task = prnTask();
    if (/finish/.test(now)) speakText(`Your print${task ? ", " + task + "," : ""} has finished.`).catch(() => {});
    else if (/fail/.test(now)) speakText(`Heads up. The print${task ? ", " + task + "," : ""} has failed.`).catch(() => {});
  }
  function printerLine() {
    if (!prn.found) return "";
    const ph = prnPhase(), task = prnTask(), p = prnNum("progress"), m = prnMinutes();
    if (ph === "printing") {
      let left = "";
      if (m != null) { const h = Math.floor(m / 60), mm = Math.round(m % 60); left = h ? ` with about ${h === 1 ? "an hour" : h + " hours"}${mm >= 10 ? " and " + mm + " minutes" : ""} to go` : ` with about ${Math.max(1, mm)} minutes to go`; }
      return `The printer's ${p != null ? Math.round(p) + " percent" : "part way"} through ${task ? task : "its job"}${left}.`;
    }
    if (ph === "paused") return `Your print${task ? ", " + task + "," : ""} is paused.`;
    if (ph === "failed") return `Your last print${task ? ", " + task + "," : ""} failed.`;
    return "";
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("[data-prn-toggle]"); if (!t) return;
    {
      let ui = {}; try { ui = JSON.parse(localStorage.getItem("eddo-os-ui") || "{}") || {}; } catch (_) {}
      ui.prn = !ui.prn; try { localStorage.setItem("eddo-os-ui", JSON.stringify(ui)); } catch (_) {}
      return renderPrn();
    }
  });
  setInterval(() => { const a = pcEl && pcEl.isConnected ? pcEl : srvEl; if (!prnEl || !prnEl.isConnected || (a && a.isConnected && a.nextElementSibling !== prnEl)) renderPrn(); }, 2000);
  setInterval(() => { if (prn.found && prnPhase() === "printing") renderPrn(); }, 60e3);
  window.addEventListener("eddo-config", renderPrn);

  // =====================================================================
  // 07 Jarvis — one-click prompts sent to the HA Assist pipeline; the
  // reply is shown here and spoken through the PC speakers.
  // =====================================================================
  const J = { pipeline: null, convo: null, busy: false, asked: "", reply: "", error: "", speaking: false, history: [] };
  let audio = null;

  async function findPipeline() {
    const r = await HA().send({ type: "assist_pipeline/pipeline/list" });
    const want = String(cfg().jarvispipeline || "").toLowerCase();
    const hit = want && r.pipelines.find((p) => p.name.toLowerCase().includes(want));
    return (hit || r.pipelines.find((p) => p.id === r.preferred_pipeline) || r.pipelines[0] || {}).id || null;
  }
  async function ask(text) {
    if (J.busy) return;
    J.busy = true; J.asked = text; J.reply = ""; J.error = ""; draw();
    try {
      if (!J.pipeline) J.pipeline = await findPipeline();
      const speak = cfg().jarvisspeak !== false;
      await HA().subscribe({ type: "assist_pipeline/run", start_stage: "intent", end_stage: speak ? "tts" : "intent", input: { text }, pipeline: J.pipeline, conversation_id: J.convo }, (ev) => {
        const d = ev.data || {};
        if (ev.type === "intent-end") {
          const out = d.intent_output || {};
          J.convo = out.conversation_id || J.convo;
          J.reply = out.response?.speech?.plain?.speech || "(no reply)";
          J.history.unshift({ q: text, a: J.reply }); J.history = J.history.slice(0, 4);
          if (!speak) J.busy = false;
          draw();
        } else if (ev.type === "tts-end") {
          const url = d.tts_output?.url; if (url) play(/^https?:/.test(url) ? url : HA().baseUrl() + url);
          J.busy = false; draw();
        } else if (ev.type === "error") {
          J.error = d.message || d.code || "Jarvis error"; J.busy = false; draw();
        } else if (ev.type === "run-end") { J.busy = false; draw(); }
      });
    } catch (err) { J.error = String(err.message || err); J.busy = false; draw(); }
  }
  // Jarvis speech. The audio is fetched through the Loupedeck bridge (HA doesn't
  // allow the wallpaper to read it directly) so it can be analysed for the
  // waveform; if that fails it plays normally with a simulated wave.
  let actx = null, analyser = null, srcNode = null, blobUrl = null;
  const rate = () => { const r = +cfg().jarvisrate; return Number.isFinite(r) && r > 40 ? r / 100 : 0.92; };
  async function play(url, onStart) {
    stopSpeech();
    const BRG = (window.eddoHA && window.eddoHA.bridge) || ("http://127.0.0.1:47290" + (window.EDDO_BRIDGE_KEY ? "/k/" + window.EDDO_BRIDGE_KEY : ""));
    let src = url, analysed = false;
    try {
      const r = await fetch(`${BRG}/proxy?url=${encodeURIComponent(url)}`); if (!r.ok) throw 0;
      const blob = await r.blob(); blobUrl = URL.createObjectURL(blob); src = blobUrl; analysed = true;
    } catch (_) {}
    try {
      audio = new Audio(src);
      audio.preservesPitch = true; audio.playbackRate = rate();
      analyser = null;
      if (analysed) {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === "suspended") await actx.resume().catch(() => {});
        srcNode = actx.createMediaElementSource(audio);
        analyser = actx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6;
        srcNode.connect(analyser); analyser.connect(actx.destination);
      }
      audio.onplay = () => { onStart && onStart(); speakStart(); };
      audio.onended = audio.onerror = () => speakEnd();
      await audio.play();
    } catch (_) { speakEnd(); }
  }
  function stopSpeech() { try { audio && audio.pause(); } catch (_) {} audio = null; try { srcNode && srcNode.disconnect(); } catch (_) {} srcNode = null; if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; } }
  function speakStart() { J.speaking = true; draw(); document.querySelector("#stage")?.setAttribute("data-jarvis-speaking", "true"); waveLoop(); }
  function speakEnd() { J.speaking = false; draw(); document.querySelector("#stage")?.removeAttribute("data-jarvis-speaking"); window.dispatchEvent(new Event("eddo-speech-end")); }

  // Waveform: drawn on every visible .eddo-wave canvas while Jarvis speaks.
  let waveRunning = false; const wavebuf = new Uint8Array(1024);
  function waveLoop() {
    if (waveRunning) return; waveRunning = true;
    const step = () => {
      const canvases = [...document.querySelectorAll("#stage .eddo-wave")].filter((c) => c.offsetWidth);
      const t = performance.now() / 1000;
      if (analyser) analyser.getByteTimeDomainData(wavebuf);
      for (const c of canvases) {
        const w = c.width = c.offsetWidth * 2, h = c.height = c.offsetHeight * 2, g = c.getContext("2d");
        g.clearRect(0, 0, w, h);
        g.strokeStyle = getComputedStyle(c).color; g.lineWidth = 2.5; g.beginPath();
        const n = 160;
        for (let i = 0; i <= n; i++) {
          let v;
          if (analyser) v = (wavebuf[Math.floor(i / n * (wavebuf.length - 1))] - 128) / 128;
          else v = J.speaking ? Math.sin(i * 0.35 + t * 9) * Math.sin(i * 0.05 + t * 2) * (0.35 + 0.25 * Math.sin(t * 5)) : 0;
          const env = Math.sin(Math.PI * i / n);                       // taper at the ends
          const x = i / n * w, y = h / 2 + v * env * h * 0.9;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      if (J.speaking) requestAnimationFrame(step); else { waveRunning = false; canvases.forEach((c) => c.getContext("2d").clearRect(0, 0, c.width, c.height)); }
    };
    requestAnimationFrame(step);
  }
  const prompts = () => String(cfg().jarvisprompts || "").split("|").map((x) => x.trim()).filter(Boolean);
  let jEl = null;
  function draw() { if (window.eddoTabs && window.eddoTabs.active() === "jarvis") window.eddoTabs.rerender("jarvis"); }
  // the web edition (Mac / TV) has no Jarvis: the mic needs the PC controller and Plash mutes speech
  if (!window.EDDO_WEB) window.eddoTabs && window.eddoTabs.register({
    id: "jarvis", label: "Jarvis",
    render(c) {
      jEl = c;
      const state = J.busy ? "THINKING…" : J.speaking ? "SPEAKING" : J.error ? "ERROR" : "READY";
      c.innerHTML =
        `<div class="eddo-jarvis" data-busy="${J.busy}" data-speaking="${J.speaking}">` +
        `<p class="eddo-j-state"><i></i>${state}${J.asked ? ` <span>“${esc(J.asked)}”</span>` : ""}</p>` +
        `<canvas class="eddo-wave eddo-j-wave"></canvas>` +
        `<p class="eddo-j-reply">${esc(J.error || J.reply || "Pick a question below. Replies are spoken through the PC speakers.")}</p>` +
        `<button class="eddo-j-talk" data-talk>◉ Talk to Jarvis<span>MIC</span></button>` +
        `<div class="eddo-j-prompts">${prompts().map((p) => `<button data-jarvis="${esc(p)}"${J.busy ? " disabled" : ""}>${esc(p)}<span>↗</span></button>`).join("")}</div>` +
        (J.history.length > 1 ? `<div class="eddo-j-history">${J.history.slice(1).map((h) => `<p><b>${esc(h.q)}</b> ${esc(h.a)}</p>`).join("")}</div>` : "") +
        `</div>`;
    },
    onHide() { /* keep the conversation going between visits */ },
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-jarvis]"); if (!b || b.disabled) return;
    ask(b.dataset.jarvis);
  });
  window.addEventListener("eddo-config", () => { J.pipeline = null; draw(); });

  // =====================================================================
  // Talk to Jarvis — a dialog that listens on the Elgato mic. The Loupedeck
  // controller (running on this PC) records the mic and talks to HA; this
  // side shows progress and plays the spoken reply.
  // =====================================================================
  const BR = () => (window.eddoHA && window.eddoHA.bridge) || ("http://127.0.0.1:47290" + (window.EDDO_BRIDGE_KEY ? "/k/" + window.EDDO_BRIDGE_KEY : ""));
  let dlg = null, es = null, talkBtn = null, quick = null, filesBtn = null;
  const D = { state: "idle", heard: "", reply: "", error: "", level: 0, mic: "" };

  function ensureTalkButton() {
    const stage = document.querySelector("#stage"); if (!stage) return;
    if (!quick || !quick.isConnected) {
      quick = document.createElement("div"); quick.className = "eddo-quick";
      filesBtn = document.createElement("button");
      filesBtn.className = "eddo-talk eddo-files"; filesBtn.dataset.files = "";
      filesBtn.innerHTML = '<i></i>OPEN FILES';
      talkBtn = document.createElement("button");
      talkBtn.className = "eddo-talk"; talkBtn.dataset.talk = "";
      talkBtn.innerHTML = '<i></i>TALK TO JARVIS';
      quick.append(filesBtn, talkBtn);
      stage.append(quick);
    }
    const wb = stage.querySelector(".workbench");
    const v = String(stage.dataset.mode !== "boot" && !!wb && !wb.hidden);
    if (quick.dataset.visible !== v) quick.dataset.visible = v;
    talkBtn.hidden = cfg().jarvistalk === false;
  }
  setInterval(ensureTalkButton, 1000);
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-files]"); if (!b) return;
    b.dataset.busy = "true";
    fetch(BR() + "/files").then((r) => { if (!r.ok) throw 0; }).catch(() => { b.innerHTML = "<i></i>CONTROLLER OFF"; setTimeout(() => { b.innerHTML = "<i></i>OPEN FILES"; }, 2500); })
      .finally(() => setTimeout(() => { b.dataset.busy = "false"; }, 800));
  });

  // Footer: keyboard / mouse battery, read by the PC controller (G HUB + iCUE)
  let battEl = null, battData = [];
  const BATT_LABEL = { keyboard: "KEYBOARD", mouse: "MOUSE", headset: "HEADSET" };
  function renderBatt() {
    const host = document.querySelector("#stage .system-footer > span:first-child"); if (!host) return;
    if (!battEl || !battEl.isConnected) { battEl = document.createElement("span"); battEl.className = "eddo-batt"; host.append(battEl); }
    const items = battData.filter((b) => BATT_LABEL[b.kind]);
    const html = items.map((b) => `<b data-low="${b.percent <= 20}" title="${esc(b.name)}">${BATT_LABEL[b.kind]} ${b.percent}%${b.charging ? " CHG" : ""}</b>`).join("<i>·</i>");
    battEl.hidden = cfg().showbattery === false || !items.length;
    if (battEl.innerHTML !== html) battEl.innerHTML = html;
  }
  async function pollBatt() {
    if (window.EDDO_WEB) return;
    try { const r = await fetch(BR() + "/battery"); battData = r.ok ? await r.json() : []; } catch (_) { battData = []; }
    renderBatt();
  }
  pollBatt(); setInterval(pollBatt, 60e3); setInterval(renderBatt, 3000);

  function drawDialog() {
    if (!dlg) return;
    const label = { idle: "READY", starting: "CONNECTING…", listening: "LISTENING", thinking: "THINKING…", replied: J.speaking ? "SPEAKING" : "DONE", error: "ERROR" }[D.state] || D.state.toUpperCase();
    const bars = Array.from({ length: 12 }, (_, i) => `<b style="height:${Math.max(8, Math.min(100, (D.level * 140) * (0.55 + 0.45 * Math.sin(i * 1.7 + Date.now() / 120) ** 2)))}%"></b>`).join("");
    dlg.querySelector(".eddo-dlg-card").dataset.state = D.state;
    dlg.querySelector(".eddo-dlg-state").innerHTML = `<i></i>${label}${D.mic ? ` <span>${esc(D.mic)}</span>` : ""}`;
    dlg.querySelector(".eddo-dlg-meter").innerHTML = bars;
    dlg.querySelector(".eddo-dlg-heard").textContent = D.heard || (D.state === "listening" ? "Go ahead — I'm listening." : "");
    dlg.querySelector(".eddo-dlg-reply").textContent = D.error || D.reply;
    dlg.querySelector("[data-dlg=stop]").hidden = D.state !== "listening";
    dlg.querySelector("[data-dlg=again]").hidden = !["replied", "error"].includes(D.state);
  }
  function openDialog() {
    const stage = document.querySelector("#stage"); if (!stage) return;
    if (!dlg || !dlg.isConnected) {
      dlg = document.createElement("div");
      dlg.className = "eddo-dlg";
      dlg.innerHTML = `<div class="eddo-dlg-card"><div class="eddo-dlg-top"><span>EDDO LAB / JARVIS</span><button data-dlg="close" aria-label="Close">CLOSE ✕</button></div>
        <p class="eddo-dlg-state"></p><div class="eddo-dlg-meter"></div><canvas class="eddo-wave eddo-dlg-wave"></canvas>
        <p class="eddo-dlg-label">YOU</p><p class="eddo-dlg-heard"></p>
        <p class="eddo-dlg-label">JARVIS</p><p class="eddo-dlg-reply"></p>
        <div class="eddo-dlg-actions"><button data-dlg="stop">STOP LISTENING</button><button data-dlg="again">ASK AGAIN ↗</button></div></div>`;
      stage.append(dlg);
    }
    dlg.dataset.open = "true";
    startTalk();
  }
  function closeDialog() {
    stopSpeech(); speakEnd();
    if (dlg) dlg.dataset.open = "false";
    if (D.state === "listening") fetch(`${BR()}/jarvis/stop`).catch(() => {});
    if (es) { es.close(); es = null; }
    D.state = "idle";
  }
  async function startTalk() {
    Object.assign(D, { state: "starting", heard: "", reply: "", error: "", level: 0, mic: "" }); drawDialog();
    try { if (!J.pipeline) J.pipeline = await findPipeline(); } catch (_) {}
    if (es) es.close();
    es = new EventSource(`${BR()}/jarvis/events`);
    es.onmessage = (m) => {
      let e; try { e = JSON.parse(m.data); } catch (_) { return; }
      if (e.type === "listening") { D.state = "listening"; D.mic = e.mic; }
      else if (e.type === "level") D.level = e.value;
      else if (e.type === "heard") { D.heard = e.text; D.level = 0; }
      else if (e.type === "thinking") D.state = "thinking";
      else if (e.type === "reply") { D.reply = e.text; D.state = "replied"; J.convo = e.conversation_id || J.convo; J.history.unshift({ q: D.heard, a: e.text }); J.history = J.history.slice(0, 4); J.asked = D.heard; J.reply = e.text; draw(); }
      else if (e.type === "tts") { if (cfg().jarvisspeak !== false) play(/^https?:/.test(e.url) ? e.url : HA().baseUrl() + e.url); }
      else if (e.type === "error") { D.error = e.message; D.state = "error"; }
      else if (e.type === "done" && D.state !== "error" && !D.reply) { D.state = "error"; D.error = D.heard ? "Jarvis didn't reply." : "I didn't catch anything — try again."; }
      drawDialog();
    };
    es.onopen = () => {
      const q = new URLSearchParams(); if (J.pipeline) q.set("pipeline", J.pipeline); if (J.convo) q.set("conversation_id", J.convo);
      fetch(`${BR()}/jarvis/listen?${q}`).then(async (r) => { if (!r.ok) { const t = await r.text(); throw new Error(t === "busy" ? "Jarvis is already listening." : t); } })
        .catch((err) => { D.state = "error"; D.error = err.message || "Couldn't start the mic."; drawDialog(); });
    };
    es.onerror = () => {
      if (D.state === "starting") { D.state = "error"; D.error = "Can't reach the Loupedeck controller. Make sure it's running (tray icon → Restart)."; drawDialog(); es && es.close(); es = null; }
    };
  }
  setInterval(() => { if (dlg && dlg.dataset.open === "true" && D.state === "listening") drawDialog(); }, 90);
  document.addEventListener("click", (e) => {
    if (!e.target.closest) return;
    if (e.target.closest("[data-talk]")) { openDialog(); return; }
    const a = e.target.closest("[data-dlg]");
    if (a) { const k = a.dataset.dlg; if (k === "close") closeDialog(); else if (k === "stop") fetch(`${BR()}/jarvis/stop`).catch(() => {}); else if (k === "again") startTalk(); return; }
    if (dlg && dlg.dataset.open === "true" && e.target === dlg) closeDialog();
  });

  // =====================================================================
  // 05 Cameras — Ring cameras from Home Assistant. Stills from the "last
  // recording"/snapshot entity; click Live for a WebRTC stream from the
  // "live view" entity (straight from HA, no extra software). Live view stops
  // when you leave the tab, go idle, or after 3 minutes.
  // =====================================================================
  const CAMS = { list: [], loaded: false, error: "", live: null };
  // "Label" matches by name; "Label=keyword" matches the keyword against the entity, its device or its integration.
  const camWords = () => String(cfg().cameras || "Front door, Garden, Shed=side:ring, Living room, Fox's room=camera.nanit_nursery:auto, EDDO-PRINT=bambu").split(",").map((w) => w.trim()).filter(Boolean);
  const camMeta = new Map();   // camera entity -> "platform device manufacturer model" (from the HA registries)
  window.addEventListener("eddo-ha-ready", (e) => {
    const { devices, ents } = e.detail; const dev = new Map(devices.map((d) => [d.id, d]));
    camMeta.clear();
    for (const x of ents) if (x.entity_id.startsWith("camera.")) { const d = dev.get(x.device_id) || {}; camMeta.set(x.entity_id, [x.platform, d.name, d.name_by_user, d.manufacturer, d.model].filter(Boolean).join(" ").toLowerCase()); }
  });
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  async function loadCameras() {
    try {
      const states = await HA().send({ type: "get_states" });
      const cams = states.filter((x) => x.entity_id.startsWith("camera."));
      CAMS.list = camWords().map((entry) => {
        const [w, kwRaw] = entry.split("=").map((t) => t.trim());
        const [kw, ...flags] = String(kwRaw || "").split(":").map((t) => t.trim().toLowerCase());
        const k = slug(w);
        if (kw && flags.includes("ring")) {
          const kk = slug(kw), mine = cams.filter((x) => x.entity_id.includes(kk) || slug(x.attributes.friendly_name || "").includes(kk));
          const live = mine.find((x) => /live/.test(x.entity_id)) || null;
          const still = mine.find((x) => /last_recording|recording|snapshot/.test(x.entity_id)) || mine.find((x) => x !== live) || live;
          const pics = [still && still.attributes.entity_picture, live && live.attributes.entity_picture, ...mine.map((x) => x.attributes.entity_picture)].filter(Boolean);
          return { key: k, label: w, rtc: true, live: live && live.entity_id, still: still && still.entity_id, pics: [...new Set(pics)], picture: pics[0] };
        }
        if (kw) {
          const q = kw.toLowerCase(), cam = q.startsWith("camera.") ? cams.find((x) => x.entity_id === q) : cams.find((x) => x.entity_id.includes(slug(q)) || slug(x.attributes.friendly_name || "").includes(slug(q)) || (camMeta.get(x.entity_id) || "").includes(q));
          const pic = cam && cam.attributes.entity_picture;
          // stream-capable cameras go live over WebRTC; image-only ones (e.g. the Bambu) use a motion-JPEG feed
          return { key: k, label: w, other: true, hls: flags.includes("hls"), auto: flags.includes("auto"), live: cam && cam.entity_id, still: cam && cam.entity_id, rtc: !!(cam && cam.attributes.frontend_stream_type), pics: pic ? [pic] : [], picture: pic };
        }
        const mine = cams.filter((x) => x.entity_id.includes(k) || slug(x.attributes.friendly_name || "").includes(k));
        const live = mine.find((x) => /live/.test(x.entity_id)) || null;
        const still = mine.find((x) => /last_recording|recording|snapshot/.test(x.entity_id)) || mine.find((x) => x !== live) || live;
        const pics = [still && still.attributes.entity_picture, live && live.attributes.entity_picture, ...mine.map((x) => x.attributes.entity_picture)].filter(Boolean);
        return { key: k, label: w.replace(/\b\w/g, (c) => c.toUpperCase()), rtc: true, live: live && live.entity_id, still: still && still.entity_id, pics: [...new Set(pics)], picture: pics[0] };
      });
      await Promise.all(CAMS.list.filter((c) => c.other && c.live && !c.rtc).map((c) =>
        HA().send({ type: "camera/capabilities", entity_id: c.live }).then((r) => { c.rtc = !!(r && r.frontend_stream_types && r.frontend_stream_types.length); }).catch(() => {})));
      CAMS.loaded = true; const missing = CAMS.list.filter((c) => !c.live && !c.still).map((c) => c.label);
      CAMS.error = missing.length ? "Not found in Home Assistant: " + missing.join(", ") + "." : "";
    } catch (e) { CAMS.error = "Couldn't read cameras from Home Assistant."; }
  }
  const lastFrame = new Map();   // key -> dataURL of the last live frame
  const picUrl = (p) => `${HA().baseUrl()}${p}${p.includes("?") ? "&" : "?"}t=${Date.now()}`;
  // try each snapshot source in turn; fall back to the last live frame, then a placeholder
  function loadStill(c, img) {
    let srcs = c.pics.map(picUrl); if (lastFrame.has(c.key)) srcs.push(lastFrame.get(c.key));
    let i = 0, tries = 3;
    const empty = () => { img.removeAttribute("src"); img.closest(".eddo-cam-media")?.setAttribute("data-empty", "true"); };
    // every camera gets a few retries; each retry asks Home Assistant for fresh picture links (they expire)
    const retry = async () => {
      try {
        const states = await HA().send({ type: "get_states" });
        const fresh = [c.still, c.live].map((id) => id && states.find((x) => x.entity_id === id)).filter(Boolean).map((x) => x.attributes.entity_picture).filter(Boolean);
        if (fresh.length) c.pics = [...new Set(fresh)];
      } catch (_) {}
      srcs = c.pics.map(picUrl);
      i = 0;
    };
    const next = () => {
      if (i < srcs.length) { img.src = srcs[i++]; return; }
      if (tries-- > 0) { setTimeout(async () => { if (!img.isConnected || (CAMS.live && CAMS.live.key === c.key)) return; await retry(); next(); }, 3000); return; }
      empty();
    };
    img.onerror = next;
    img.onload = () => {
      img.closest(".eddo-cam-media")?.setAttribute("data-empty", "false");
    };
    next();
  }
  function grabFrame(key) {
    const v = camMedia(key)?.querySelector("video");
    if (!v || !v.videoWidth) return;
    try { const cv = document.createElement("canvas"); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext("2d").drawImage(v, 0, 0); lastFrame.set(key, cv.toDataURL("image/jpeg", 0.85)); } catch (_) {}
  }
  function camCard(c) {
    const pic = "";
    return `<div class="eddo-cam" data-cam="${c.key}">` +
      `<div class="eddo-cam-head"><span>${esc(c.label.toUpperCase())}</span><em class="eddo-cam-state">${c.live ? "READY" : "NO LIVE VIEW"}</em></div>` +
      `<div class="eddo-cam-media" data-cam-expand="${c.key}" data-empty="true"><div class="eddo-cam-empty">NO SNAPSHOT</div><img alt=""><video muted playsinline autoplay></video><i class="eddo-cam-zoom">⤢</i></div>` +
      `<button class="eddo-cam-btn" data-cam-live="${c.key}"${c.live ? "" : " disabled"}>◉ LIVE</button></div>`;
  }
  function camEl(key) { return document.querySelector(`#stage [data-cam="${key}"]`); }
  // the picture/video box can be inside the card or moved into the big view
  const camMedia = (key) => document.querySelector(`#stage [data-cam-expand="${key}"]`);
  function camState(key, text, live) {
    const el = camEl(key); if (!el) return;
    el.querySelector(".eddo-cam-state").textContent = text; el.dataset.live = String(!!live);
    el.querySelector(".eddo-cam-btn").textContent = live === "on" || live === true ? "■ STOP" : "◉ LIVE";
  }
  async function stopLive() {
    const L = CAMS.live; if (!L) return;
    grabFrame(L.key);
    CAMS.live = null;
    clearTimeout(L.timer);
    try { L.pc && L.pc.close(); } catch (_) {}
    try { L.hls && L.hls.destroy(); } catch (_) {}
    if (L.subId) HA().unsubscribe(L.subId);
    const el = camEl(L.key), media = camMedia(L.key);
    if (el) el.dataset.playing = "false";
    if (media) { const v = media.querySelector("video"); if (v) { v.srcObject = null; if (L.hls || v.getAttribute("src")) { v.removeAttribute("src"); v.load(); } } const img = media.querySelector("img"); const c = CAMS.list.find((x) => x.key === L.key); if (img && c) loadStill(c, img); }
    camState(L.key, "READY", false);
  }
  function startMjpeg(c) {
    const L = { key: c.key, mjpeg: true, timer: null };
    CAMS.live = L;
    const media = camMedia(c.key), img = media && media.querySelector("img"), el = camEl(c.key);
    const pic = c.pics[0] || "";
    if (!img || !pic) { camState(c.key, "NO LIVE VIEW", false); CAMS.live = null; return; }
    img.onerror = () => { if (CAMS.live === L) { camState(c.key, "ERROR", false); stopLive(); } };
    img.onload = () => { media.setAttribute("data-empty", "false"); if (CAMS.live === L && el) { el.dataset.playing = "true"; camState(c.key, "● LIVE", "on"); } };
    img.src = HA().baseUrl() + pic.replace("/api/camera_proxy/", "/api/camera_proxy_stream/");
    if (el) el.dataset.playing = "false";
    camState(c.key, "CONNECTING…", "on");
    L.timer = setTimeout(() => { if (CAMS.live === L) stopLive(); }, 180000);
  }
  // Baby monitor: Jarvis speaks up when the Nanit hears crying (or noise, if the
  // integration only reports sound). At most once every 5 minutes.
  const BABY = { ids: [], last: 0, seen: new Map() };
  window.addEventListener("eddo-ha-ready", (e) => {
    const { ents, allStates } = e.detail;
    if (BABY.sub) { HA().unsubscribe(BABY.sub); BABY.sub = null; }
    BABY.ids = ents.filter((x) => !x.disabled_by && /nanit/.test((x.platform || "") + " " + x.entity_id) && /^(binary_sensor|event)\./.test(x.entity_id) && /cry|sound/.test(((x.translation_key || "") + " " + x.entity_id).toLowerCase())).map((x) => x.entity_id);
    // prefer a dedicated cry sensor over a general sound one
    if (BABY.ids.some((id) => /cry/.test(id))) BABY.ids = BABY.ids.filter((id) => /cry/.test(id));
    BABY.seen.clear();
    for (const st of allStates) if (BABY.ids.includes(st.entity_id)) BABY.seen.set(st.entity_id, st.state);
    if (!BABY.ids.length) return;
    HA().subscribe({ type: "subscribe_entities", entity_ids: BABY.ids }, (ev) => {
      for (const [id, v] of Object.entries(ev.c || {})) {
        const now = v["+"] && v["+"].s; if (now == null) continue;
        const was = BABY.seen.get(id); BABY.seen.set(id, now);
        const fired = id.startsWith("event.") ? (was != null && now !== was && !/unavailable|unknown/.test(now)) : (now === "on" && was !== "on");
        if (fired) babyAlert(/cry/.test(id));
      }
    }).then((sub) => { BABY.sub = sub && sub.id; }).catch(() => {});
  });
  function babyAlert(crying) {
    if (cfg().babyannounce === false || Date.now() - BABY.last < 5 * 60e3) return;
    BABY.last = Date.now();
    const name = cfg().babyname || "Fox";
    speakText(crying ? `Heads up, ${name} is crying.` : `Heads up, there's noise in ${name}'s room.`).catch(() => {});
  }
  let hlsLib = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    return hlsLib || (hlsLib = new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "./assets/hls.min.js"; sc.onload = () => ok(window.Hls); sc.onerror = no; document.head.append(sc); }));
  }
  // HLS through the PC bridge — the same way Home Assistant's own dashboard plays cameras it can't do over WebRTC
  async function startHls(c) {
    if (window.EDDO_WEB) return c.pics.length ? startMjpeg(c) : camState(c.key, "NO LIVE VIEW", false);   // no PC controller to relay HLS
    const L = { key: c.key, hls: null, timer: null };
    CAMS.live = L;
    camState(c.key, "CONNECTING (HLS)…", "on");
    try {
      try { const p = await fetch(HA().bridge + "/ping"); if (!p.ok) throw 0; }
      catch (_) { camState(c.key, "BRIDGE OFFLINE", false); showCamError("Live view for " + c.label + " needs the Loupedeck controller running, and the wallpaper reloaded once after it starts."); CAMS.live = null; return; }
      const r = await HA().send({ type: "camera/stream", entity_id: c.live, format: "hls" });
      if (CAMS.live !== L) return;
      const v = camMedia(c.key)?.querySelector("video"), el = camEl(c.key); if (!v) return;
      const src = HA().bridge + "/ha" + r.url;
      v.muted = true;
      v.onplaying = () => { if (CAMS.live === L) { if (el) el.dataset.playing = "true"; camState(c.key, "● LIVE", "on"); } };
      const Hls = await loadHls().catch(() => null);
      if (CAMS.live !== L) return;
      if (Hls && Hls.isSupported()) {
        const h = L.hls = new Hls({ liveSyncDurationCount: 2, manifestLoadingMaxRetry: 8, manifestLoadingRetryDelay: 1500, levelLoadingMaxRetry: 8, fragLoadingMaxRetry: 8 });
        h.on(Hls.Events.MANIFEST_PARSED, () => { if (CAMS.live === L) camState(c.key, "BUFFERING…", "on"); });
        h.on(Hls.Events.ERROR, (_, d) => {
          if (!d.fatal || CAMS.live !== L) return;
          const why = [d.type, d.details, d.response && d.response.code].filter(Boolean).join(" / ");
          if (c.other && c.pics.length) { stopLive().then(() => startMjpeg(c)); return; }   // e.g. a video format this player can't decode
          camState(c.key, "STREAM FAILED", false); showCamError(c.label + " live view failed: " + why); stopLive();
        });
        h.loadSource(src); h.attachMedia(v); v.play().catch(() => {});
      } else { v.src = src; v.play().catch(() => {}); }
      L.timer = setTimeout(() => { if (CAMS.live === L) stopLive(); }, 180000);
    } catch (err) { camState(c.key, "ERROR", false); showCamError(String(err.message || err)); stopLive(); }
  }
  async function startLive(c) {
    await stopLive();
    showCamError("");
    if (c.hls) return startHls(c);
    if (c.other && !c.rtc) return startMjpeg(c);
    const L = { key: c.key, pc: null, subId: null, session: null, queue: [], timer: null };
    CAMS.live = L;
    camState(c.key, "CONNECTING…", "on");
    try {
      let conf = {}; try { conf = (await HA().send({ type: "camera/webrtc/get_client_config", entity_id: c.live })).configuration || {}; } catch (_) {}
      const pc = L.pc = new RTCPeerConnection(conf);
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: c.other ? "recvonly" : "sendrecv" });   // Ring expects a two-way audio line
      pc.ontrack = (e) => {
        const el = camEl(c.key), v = camMedia(c.key)?.querySelector("video"); if (!el || !v) return;
        if (e.track.kind === "video") { v.srcObject = e.streams[0] || new MediaStream([e.track]); v.muted = true; v.play().catch(() => {}); }
        v.onplaying = () => { if (CAMS.live === L && (!c.other || v.videoWidth)) { el.dataset.playing = "true"; camState(c.key, "● LIVE", "on"); } };
        v.onresize = () => { if (CAMS.live === L && v.videoWidth && !v.paused) { el.dataset.playing = "true"; camState(c.key, "● LIVE", "on"); } };
      };
      const sendCand = (cand) => HA().send({ type: "camera/webrtc/candidate", entity_id: c.live, session_id: L.session, candidate: { candidate: cand.candidate, sdpMid: cand.sdpMid, sdpMLineIndex: cand.sdpMLineIndex } }).catch(() => {});
      pc.onicecandidate = (e) => { if (!e.candidate) return; L.session ? sendCand(e.candidate) : L.queue.push(e.candidate); };
      pc.onconnectionstatechange = () => { if (CAMS.live === L && ["failed", "closed"].includes(pc.connectionState)) { camState(c.key, "CONNECTION LOST", false); stopLive(); } };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const sub = await HA().subscribe({ type: "camera/webrtc/offer", entity_id: c.live, offer: offer.sdp }, (ev) => {
        if (CAMS.live !== L) return;
        if (ev.type === "session") { L.session = ev.session_id; L.queue.splice(0).forEach(sendCand); }
        else if (ev.type === "answer") pc.setRemoteDescription({ type: "answer", sdp: ev.answer }).catch((err) => { camState(c.key, "ERROR", false); CAMS.error = String(err.message || err); stopLive(); });
        else if (ev.type === "candidate" && ev.candidate) pc.addIceCandidate({ candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid ?? ev.candidate.sdp_mid ?? "0", sdpMLineIndex: ev.candidate.sdpMLineIndex ?? ev.candidate.sdp_m_line_index ?? 0 }).catch(() => {});
        else if (ev.type === "error") { if (c.other) { stopLive().then(() => startHls(c)); return; } camState(c.key, "ERROR", false); showCamError(ev.message || ev.code); stopLive(); }
      });
      L.subId = sub && sub.id;
      if (c.other) { camState(c.key, "CONNECTING (WEBRTC)…", "on"); setTimeout(() => { if (CAMS.live === L && camEl(c.key)?.dataset.playing !== "true") stopLive().then(() => startHls(c)); }, 8000); }
      L.timer = setTimeout(() => { if (CAMS.live === L) stopLive(); }, 180000);   // save battery
    } catch (err) { if (c.other) { await stopLive(); return startHls(c); } showCamError(String(err.message || err)); camState(c.key, "ERROR", false); stopLive(); }
  }
  let overlay = null, expandedKey = null;
  function expandCam(key) {
    const stage = document.querySelector("#stage"), card = camEl(key); if (!stage || !card) return;
    if (!overlay || !overlay.isConnected) {
      overlay = document.createElement("div"); overlay.className = "eddo-cam-overlay";
      overlay.innerHTML = `<div class="eddo-cam-big" data-cam=""><div class="eddo-cam-head"><span></span><em class="eddo-cam-state"></em><button class="eddo-cam-close" aria-label="Close">✕</button></div><div class="eddo-cam-slot"></div><button class="eddo-cam-btn"></button></div>`;
      stage.append(overlay);
    }
    collapseCam();
    const c = CAMS.list.find((x) => x.key === key); if (!c) return;
    expandedKey = key;
    const big = overlay.querySelector(".eddo-cam-big");
    big.dataset.bigFor = key;
    big.querySelector(".eddo-cam-head span").textContent = c.label.toUpperCase();
    big.querySelector(".eddo-cam-state").textContent = card.querySelector(".eddo-cam-state").textContent;
    big.querySelector(".eddo-cam-btn").dataset.camLive = key;
    big.querySelector(".eddo-cam-btn").textContent = card.querySelector(".eddo-cam-btn").textContent;
    const media = card.querySelector(".eddo-cam-media");
    big.querySelector(".eddo-cam-slot").append(media);
    big.dataset.live = card.dataset.live || "false"; big.dataset.playing = card.dataset.playing || "false";
    media.querySelector("video")?.play().catch(() => {});
    overlay.dataset.open = "true";
    if (!(CAMS.live && CAMS.live.key === key) && c.live) startLive(c);   // expanding goes live
  }
  function collapseCam() {
    if (!overlay || !expandedKey) return;
    const media = overlay.querySelector(".eddo-cam-slot .eddo-cam-media"), card = document.querySelector(`#stage .wb-content [data-cam="${expandedKey}"]`);
    if (media && card) { card.querySelector(".eddo-cam-head").after(media); media.querySelector("video")?.play().catch(() => {}); }
    overlay.dataset.open = "false"; expandedKey = null;
    if (holderMode) { holderMode = false; stopLive(); document.querySelectorAll("#stage .eddo-cam-holder").forEach((h) => h.remove()); }
  }
  // Open a camera's big view from elsewhere (the House tab): its card lives in a
  // hidden holder inside the current tab so the usual big-view code can use it.
  let holderMode = false;
  window.eddoCams = {
    async open(key) {
      if (!CAMS.loaded) await loadCameras();
      const c = CAMS.list.find((x) => x.key === key); const content = document.querySelector("#stage .wb-content");
      if (!c || !content) return false;
      collapseCam();
      let holder = content.querySelector(".eddo-cam-holder");
      if (!holder) { holder = document.createElement("div"); holder.className = "eddo-cam-holder"; holder.hidden = true; content.append(holder); }
      holder.innerHTML = camCard(c);
      const img = holder.querySelector("img"); if (img) loadStill(c, img);
      expandCam(key); holderMode = true;
      return true;
    },
    keys: () => CAMS.list.map((c) => c.key),
    // a motion-JPEG URL for a small live preview (fresh token each time), or a still if the camera has no stream
    async feed(key) {
      if (!CAMS.loaded) await loadCameras();
      const c = CAMS.list.find((x) => x.key === key); if (!c) return null;
      const ids = [c.live, c.still].filter(Boolean); if (!ids.length) return null;
      try {
        const states = await HA().send({ type: "get_states" });
        for (const id of ids) {
          const st = states.find((x) => x.entity_id === id), pic = st && st.attributes.entity_picture;
          if (pic) return { stream: HA().baseUrl() + pic.replace("/api/camera_proxy/", "/api/camera_proxy_stream/"), still: picUrl(pic), label: c.label };
        }
      } catch (_) {}
      return c.pics[0] ? { stream: null, still: picUrl(c.pics[0]), label: c.label } : null;
    },
  };
  // keep the big view's labels in step with the card
  setInterval(() => {
    if (!overlay || !expandedKey) return;
    const card = document.querySelector(`#stage .wb-content [data-cam="${expandedKey}"]`), big = overlay.querySelector(".eddo-cam-big");
    if (!card) return collapseCam();
    big.querySelector(".eddo-cam-state").textContent = card.querySelector(".eddo-cam-state").textContent;
    big.querySelector(".eddo-cam-btn").textContent = card.querySelector(".eddo-cam-btn").textContent;
    big.dataset.live = card.dataset.live || "false"; big.dataset.playing = card.dataset.playing || "false";
  }, 300);
  document.addEventListener("click", (e) => {
    if (!e.target.closest) return;
    if (e.target.closest(".eddo-cam-close") || e.target === overlay) { collapseCam(); return; }
    const m = e.target.closest("[data-cam-expand]");
    if (m && !overlay?.contains(m)) expandCam(m.dataset.camExpand);
  });
  function showCamError(t) { const n = document.querySelector("#stage .eddo-cam-note"); if (n) n.textContent = t || ""; }
  window.eddoTabs && window.eddoTabs.register({
    id: "cameras", label: "Cameras", pos: 0,
    render(c) {
      c.innerHTML = `<div class="eddo-cams"><p class="wb-muted eddo-cam-note">${CAMS.loaded ? esc(CAMS.error) : "Loading cameras…"}</p></div>`;
      const go = () => {
        if (window.eddoTabs.active() !== "cameras") return;
        c.querySelector(".eddo-cams").dataset.count = CAMS.list.length;
        c.querySelector(".eddo-cams").innerHTML = CAMS.list.map(camCard).join("") + `<p class="wb-muted eddo-cam-note">${esc(CAMS.error)}</p>`;
        for (const cam of CAMS.list) { const img = camMedia(cam.key)?.querySelector("img"); if (img) loadStill(cam, img); }
        // the baby monitor plays live in its tile while the tab is open
        const auto = !CAMS.live && CAMS.list.find((x) => x.auto && x.live);
        if (auto) setTimeout(() => { if (!CAMS.live && window.eddoTabs.active() === "cameras") startLive(auto); }, 400);
      };
      if (CAMS.loaded) go(); else loadCameras().then(go);
    },
    onShow() { loadCameras().then(() => window.eddoTabs.rerender("cameras")); },
    onHide() { collapseCam(); stopLive(); },
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-cam-live]"); if (!b || b.disabled) return;
    const c = CAMS.list.find((x) => x.key === b.dataset.camLive); if (!c) return;
    if (CAMS.live && CAMS.live.key === c.key) stopLive(); else startLive(c);
  });
  // refresh stills every minute while the tab is open (tokens rotate); stop live view when idle
  setInterval(() => {
    if (window.eddoTabs && window.eddoTabs.active() === "cameras" && !CAMS.live) loadCameras().then(() => {
      for (const c of CAMS.list) { const img = camMedia(c.key)?.querySelector("img"); if (img) loadStill(c, img); }
    });
    if (CAMS.live && document.querySelector("#stage")?.dataset.eddoIdle === "true") stopLive();
  }, 60000);

  // =====================================================================
  // Spoken greeting after the opening sequence (at most every few hours).
  // Spoken with the Jarvis pipeline's own voice (text-to-speech only).
  // =====================================================================
  const GREET_KEY = "eddo-os-greeted";
  let toast = null, greetTimer = null;
  // ---- daily briefing script ----
  const WEATHER = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "foggy", 51: "drizzly", 53: "drizzly", 55: "drizzly", 61: "rainy", 63: "rainy", 65: "very wet", 66: "sleety", 67: "sleety", 71: "snowy", 73: "snowy", 75: "very snowy", 80: "showery", 81: "showery", 82: "stormy", 95: "thundery", 96: "thundery", 99: "thundery" };
  const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  function sayTime(d) {
    const h = d.getHours(), m = d.getMinutes(), h12 = ((h + 11) % 12) + 1, next = ((h + 12) % 12) + 1;
    const ap = h < 12 ? "in the morning" : h < 17 ? "in the afternoon" : "in the evening";
    if (m === 0) return h === 12 ? "midday" : `${h12} o'clock ${ap}`;
    if (m === 15) return `quarter past ${h12}`;
    if (m === 30) return `half past ${h12}`;
    if (m === 45) return `quarter to ${next}`;
    return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
  }
  const list = (items) => items.length <= 1 ? (items[0] || "") : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  async function todaysEvents(calEntity) {
    if (!calEntity) return null;
    const start = new Date(), end = new Date(); end.setHours(23, 59, 59, 0);
    const iso = (d) => { const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:00`; };
    start.setHours(0, 0, 0, 0);
    try {
      const r = await HA().send({ type: "call_service", domain: "calendar", service: "get_events", target: { entity_id: calEntity }, service_data: { start_date_time: iso(start), end_date_time: iso(end) }, return_response: true });
      const evs = (r && r.response && r.response[calEntity] && r.response[calEntity].events) || [];
      return evs.map((e) => ({ name: e.summary || "an event", allDay: !/T|\d:\d/.test(String(e.start)), start: new Date(String(e.start).replace(" ", "T")) }))
        .sort((x, y) => x.start - y.start);
    } catch (_) { return null; }
  }
  // Parcels arriving today — works with any HA parcel/mail integration: looks for
  // entities about parcels/deliveries that are "out for delivery" or counting
  // deliveries due today. Says nothing if there aren't any.
  const CARRIERS = { amazon: "Amazon", royal_mail: "Royal Mail", royalmail: "Royal Mail", evri: "Evri", hermes: "Evri", dpd: "DPD", dhl: "DHL", ups: "UPS", fedex: "FedEx", yodel: "Yodel", inpost: "InPost", parcelforce: "Parcelforce", apc: "APC" };
  const carrierOf = (txt) => { const t = txt.toLowerCase().replace(/[\s-]/g, "_"); for (const k in CARRIERS) if (t.includes(k)) return CARRIERS[k]; return null; };
  async function deliveriesToday() {
    let states; try { states = await HA().send({ type: "get_states" }); } catch (_) { return []; }
    const out = [];
    const today = new Date().toDateString();
    for (const st of states) {
      const id = st.entity_id, dom = id.split(".")[0], a = st.attributes || {};
      if (dom !== "sensor" && dom !== "binary_sensor") continue;
      const label = (id + " " + (a.friendly_name || "")).toLowerCase();
      if (!/parcel|package|deliver|shipment|tracking|mail_|courier/.test(label)) continue;
      if (/delivered|returned|exception|last_update|updated/.test(id)) continue;
      const carrier = a.carrier || a.courier || carrierOf(label);
      const from = a.sender || a.retailer || a.shop || a.merchant || a.from || null;
      const n = parseFloat(st.state);
      if (Number.isFinite(n) && n > 0 && /deliver(ing|ies)?_?today|out_?for|arriving|today|in_?transit_?today|deliverin/.test(id)) {
        out.push({ count: Math.round(n), carrier, from }); continue;
      }
      const s = String(st.state).toLowerCase();
      const eta = a.expected_delivery || a.delivery_date || a.eta || a.estimated_delivery;
      const etaToday = eta && new Date(String(eta).replace(" ", "T")).toDateString() === today;
      if (/out for delivery|out_for_delivery|delivering today|arriving today|with (the )?(driver|courier)|on (its|it's) way to you today/.test(s) || etaToday && !/deliver(ed)/.test(s)) out.push({ count: 1, carrier, from });
    }
    return out;
  }
  function deliveryLine(items) {
    const total = items.reduce((t, x) => t + x.count, 0); if (!total) return "";
    const src = (x) => x.from ? `from ${x.from}` : x.carrier ? `with ${x.carrier}` : "";
    // group by where it's from
    const groups = new Map();
    for (const x of items) { const k = src(x); groups.set(k, (groups.get(k) || 0) + x.count); }
    const named = [...groups].filter(([k]) => k);
    if (total === 1) return `You've got a parcel ${named.length ? named[0][0] + " " : ""}out for delivery today.`;
    const head = `You've got ${NUM[total] || total} parcels out for delivery today`;
    if (!named.length) return head + ".";
    if (named.length === 1 && groups.size === 1) return `${head}, all ${named[0][0]}.`;
    return `${head}: ${list([...groups].map(([k, c]) => `${NUM[c] || c}${k ? " " + k : " more"}`))}.`;
  }
  async function briefingText() {
    const i = window.eddoInfo ? window.eddoInfo() : {}, now = new Date();
    const h = now.getHours();
    const hello = h < 5 ? "You're up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const raw = (cfg().sessionname || "Eddo").toString(), name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    const parts = [`${hello}, ${name}. It's ${sayTime(now)} on ${now.toLocaleDateString("en-GB", { weekday: "long" })} the ${ordinal(now.getDate())}.`];
    // weather and the office
    const f = i.forecast || {};
    if (i.outside != null) {
      let w = `Outside in ${i.outsideLabel || "Bromley"} it's ${Math.round(i.outside)} degrees`;
      if (WEATHER[i.outsideCode]) w += ` and ${WEATHER[i.outsideCode]}`;
      if (f.max != null) w += `, heading for a high of ${Math.round(f.max)}`;
      w += ".";
      if (f.rain != null && f.rain >= 40) w += ` There's a ${Math.round(f.rain / 10) * 10} percent chance of rain today, so you might want a coat.`;
      parts.push(w);
    }
    if (i.inside != null) parts.push(`The office is sitting at ${Math.round(i.inside)} degrees.`);
    { const pl = printerLine(); if (pl) parts.push(pl); }
    // tasks — all of them
    const tasks = i.tasks || [];
    if (tasks.length) parts.push(tasks.length === 1 ? `You've got one thing on your list today: ${lowerFirst(tasks[0])}.` : `You've got ${NUM[tasks.length] || tasks.length} things on your list today: ${list(tasks.map(lowerFirst))}.`);
    else if (i.tasksLoaded) parts.push("Your task list is clear.");
    // calendar — everything today, then a look ahead
    const evs = await todaysEvents(i.calEntity);
    if (evs && evs.length) {
      const rest = evs.filter((e) => e.allDay || e.start > now);
      const said = rest.map((e) => e.allDay ? lowerFirst(e.name) : `${lowerFirst(e.name)} at ${sayTime(e.start)}`);
      if (said.length) parts.push(said.length === 1 ? `On the calendar today, there's ${said[0]}.` : `On the calendar today, you've got ${list(said)}.`);
      else parts.push("That's everything on the calendar for today.");
    } else if (i.event && i.event.start) {
      const d = new Date(String(i.event.start).replace(" ", "T"));
      const days = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
      const when = days <= 0 ? (i.event.allDay ? "today" : `today at ${sayTime(d)}`) : days === 1 ? "tomorrow" : days < 7 ? `on ${d.toLocaleDateString("en-GB", { weekday: "long" })}` : `on the ${ordinal(d.getDate())}`;
      parts.push(evs ? `Nothing else on the calendar today. Looking ahead, ${lowerFirst(i.event.name)} is ${when}.` : `Next on the calendar, ${lowerFirst(i.event.name)} is ${when}.`);
    }
    // parcels arriving today (only mentioned when there are some)
    if (cfg().briefdeliveries !== false) { const d = deliveryLine(await deliveriesToday()); if (d) parts.push(d); }
    parts.push(tasks.length || (evs && evs.length) ? "Have a good one." : "All systems are online.");
    return parts.join(" ");
  }
  function showToast(text) {
    const stage = document.querySelector("#stage"); if (!stage) return;
    if (!toast || !toast.isConnected) {
      toast = document.createElement("div"); toast.className = "eddo-toast";
      toast.innerHTML = `<p class="eddo-toast-k"><i></i>JARVIS</p><p class="eddo-toast-t"></p><canvas class="eddo-wave eddo-toast-wave"></canvas>`;
      stage.append(toast);
    }
    toast.querySelector(".eddo-toast-t").textContent = text;
    toast.dataset.open = "true";
    clearTimeout(toast._t);
  }
  function hideToastSoon(ms = 2500) { if (toast) { clearTimeout(toast._t); toast._t = setTimeout(() => { toast.dataset.open = "false"; }, ms); } }
  window.addEventListener("eddo-speech-end", () => hideToastSoon());
  async function speakText(text, onStart) {
    if (window.EDDO_WEB) return false;   // no Jarvis voice in the web edition
    if (!J.pipeline) J.pipeline = await findPipeline().catch(() => null);
    return new Promise((resolve) => {
      let done = false; const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      HA().subscribe({ type: "assist_pipeline/run", start_stage: "tts", end_stage: "tts", input: { text }, pipeline: J.pipeline }, (ev) => {
        if (ev.type === "tts-end" && ev.data && ev.data.tts_output && ev.data.tts_output.url) { const u = ev.data.tts_output.url; play(/^https?:/.test(u) ? u : HA().baseUrl() + u, onStart); finish(true); }
        else if (ev.type === "error" || ev.type === "run-end") finish(false);
      }).catch(() => finish(false));
      setTimeout(() => finish(false), 20000);
    });
  }
  let greeting = false;
  async function greet(force) {
    if (greeting) return;
    if (!force) {
      if (cfg().jarvisgreet === false || window.EDDO_WEB) return;
      let last = 0; try { last = +localStorage.getItem(GREET_KEY) || 0; } catch (_) {}
      const hrs = Number.isFinite(+cfg().greethours) ? +cfg().greethours : 4;
      if (hrs > 0 && Date.now() - last < hrs * 3600e3) return;
    }
    greeting = true;
    try { localStorage.setItem(GREET_KEY, String(Date.now())); } catch (_) {}
    const text = await briefingText();
    // voice only — no on-screen card for the briefing
    if (cfg().jarvisspeak !== false) await speakText(text);
    greeting = false;
  }
  // Start as soon as the data is in, even during the opening animation — the
  // audio is prepared while the animation plays and starts the moment it's ready.
  (function waitForGreeting() {
    let n = 0;
    const iv = setInterval(() => {
      const info = window.eddoInfo ? window.eddoInfo() : {};
      n++;
      if (info.live && ((info.inside != null && info.tasksLoaded) || n > 8)) { clearInterval(iv); greet(false); }
      if (n > 60) clearInterval(iv);
    }, 500);
  })();
  window.eddoGreet = () => greet(true);
  // REINITIALIZE replays the opening; the briefing is prepared and spoken over it.
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest('[data-action="replay"]')) return;
    stopSpeech(); if (toast) toast.dataset.open = "false";
    setTimeout(() => greet(true), 300);
  }, true);

  // =====================================================================
  // OLED burn-in guard: slow pixel shift of the interface, plus an idle
  // mode that fades everything to a dim drifting clock.
  // =====================================================================
  const ORBIT = [[0, 0], [3, 0], [3, -3], [0, -3], [-3, -3], [-3, 0], [-3, 3], [0, 3], [3, 3]];
  let orbitIx = 0;
  setInterval(() => {
    const stage = document.querySelector("#stage"); if (!stage) return;
    const on = cfg().burnin !== false;
    orbitIx = on ? (orbitIx + 1) % ORBIT.length : 0;
    stage.style.setProperty("--eddo-shift-x", ORBIT[orbitIx][0] + "px");
    stage.style.setProperty("--eddo-shift-y", ORBIT[orbitIx][1] + "px");
  }, 180000);

  let lastMove = Date.now(), idle = false, idleClock = null;
  const wake = () => { lastMove = Date.now(); if (idle) setIdle(false); };
  ["mousemove", "mousedown", "wheel", "keydown", "touchstart"].forEach((ev) => window.addEventListener(ev, wake, { passive: true, capture: true }));
  function setIdle(v) {
    idle = v;
    const stage = document.querySelector("#stage"); if (!stage) return;
    if (v) {
      if (!idleClock || !idleClock.isConnected) {
        idleClock = document.createElement("div"); idleClock.className = "eddo-idle";
        idleClock.innerHTML = `<b></b><span></span>`; stage.append(idleClock);
      }
      tickIdle(true);
    }
    stage.dataset.eddoIdle = String(v);
  }
  function tickIdle(move) {
    if (!idle || !idleClock) return;
    const d = new Date();
    idleClock.querySelector("b").textContent = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    idleClock.querySelector("span").textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
    if (move) { idleClock.style.left = Math.round(160 + Math.random() * 1200) + "px"; idleClock.style.top = Math.round(140 + Math.random() * 640) + "px"; }
  }
  let idleMinute = -1;
  setInterval(() => {
    const mins = +cfg().idleminutes || 0, stage = document.querySelector("#stage");
    const busy = J.speaking || J.busy || (dlg && dlg.dataset.open === "true") || !stage || stage.dataset.mode === "boot";
    if (!idle && mins > 0 && !busy && Date.now() - lastMove > mins * 60000) setIdle(true);
    if (idle && (mins === 0 || busy)) setIdle(false);
    const m = new Date().getMinutes();
    if (idle && m !== idleMinute) { idleMinute = m; tickIdle(m % 2 === 0); }
  }, 5000);
})();
