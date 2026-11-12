// EDDO OS · web edition (MacBook via Plash, or any browser on the home network).
// Wallpaper Engine normally hands the page its settings; here this script does it,
// from three layers (later ones win):
//   1. the wallpaper's own defaults (built in below)
//   2. eddo-web-settings.js on the server: shared choices + per-device presets
//   3. this device only: Home Assistant address + token, entered once in the setup
//      card and kept in this browser's storage (never on the server)
// Open the page with ?setup to change this device's details again.
(() => {
  "use strict";
  const DEFAULTS = {"archivecoverage": "standard", "audioreactive": true, "autotheme": false, "boot": true, "breakminutes": 5, "clicksound": true, "colortheme": "light", "customwallpaper": false, "customwallpaperfile": "", "customwallpapermask": 100, "darkstarthour": 19, "darkstartminute": 0, "desktopmode": "workbench", "enableevent": true, "enablefocus": true, "enablemedia": true, "enabletasks": true, "enabletime": true, "eventdate": "", "eventname": "", "focusminutes": 25, "focusreminder": true, "gamepace": "normal", "huddepth": 20, "hudparallax": false, "hudtracking": true, "idlebreathing": true, "language": "en-US", "lightstarthour": 7, "lightstartminute": 0, "load3donstartup": true, "modelprecision": "high", "music": true, "musicvolume": 50, "openingdetail": "auto", "qualityanisotropy": "16", "qualityantialias": "off", "qualityaoresolution": "1", "qualityaosamples": "32", "qualitydepthoffield": 100, "qualitypixelratio": "1.5", "qualityscale": 100, "qualityshadows": "2048", "qualitytransmission": "1", "reactiveintensity": 100, "reactivemute": true, "reduced": false, "renderquality": "original", "rhythmstyle": "legacy", "schemecolor": "0 0 0", "screenfinish": false, "screenfringe": 20, "screengrain": 20, "screengrainsize": 20, "screenvignette": 20, "selectedindexaccent": false, "selectionstyle": "music-flat", "sessionname": "EDDO", "showbrand": true, "showclock": true, "showfooter": true, "showfooterclock": true, "showgame": true, "showmodebutton": false, "showmodule": true, "shownavigation": true, "showtasks": true, "showworkbenchbutton": true, "sound": true, "soundvolume": 55, "superperformance": false, "task1": "", "task2": "", "task3": "", "uifrost": false, "uifroststrength": 55, "uimarginbottom": 0, "uimarginleft": 0, "uimarginright": 0, "uimargintop": 0, "wbmodulex": 0, "wbmoduley": 0, "wbnavigationx": 0, "wbnavigationy": 0, "wboverviewx": 0, "wboverviewy": 0, "showha": true, "hatasks": true, "haurl": "http://192.168.4.81:8123", "haarea": "Office", "hakeywords": "coffee", "hatodo": "Top 3", "haentities": "scene.startup=Start Up, scene.shutdown=Shut Down, climate.garden_office=Office AC, light.garden_office_lights=Office Lights, light.deskhue=Desk Hue, switch.ed_skadis_plug_localbytes_plug_pm_d5f029=Ed Skadis, switch.office_lamp_2=Jules Skadis, switch.office_draw_light_socket_1=Coffee Machine", "bgdim": 0, "halinks": "Unraid=http://eddo-nas/", "hacalendar": "haddrellwood", "hainside": "climate.garden_office", "haoutside": "Bromley=51.4057,0.0158", "showunraid": true, "haunraid": "unraid, eddo_nas, eddo-nas", "jarvispipeline": "jarvis", "jarvisspeak": true, "jarvisprompts": "What's on my calendar today?|How warm is the office?|Turn on the office lights|Turn everything off in the office|Good morning, Jarvis", "jarvistalk": true, "jarvisgreet": true, "greethours": 4, "burnin": true, "idleminutes": 10, "jarvisrate": 92, "briefdeliveries": true};
  const LOCAL_KEY = "eddo-web-local";
  const site = window.EDDO_WEB_SETTINGS || {};
  const q = new URLSearchParams(location.search);
  let local = {};
  try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}") || {}; } catch (_) {}
  const device = String(q.get("device") || local.device || "mac").toLowerCase();

  const values = Object.assign({}, DEFAULTS, site.all || {}, (site.devices || {})[device] || {});
  if (local.haurl) values.haurl = local.haurl;
  if (local.hatoken) values.hatoken = local.hatoken;

  const props = {};
  for (const [k, v] of Object.entries(values)) props[k] = { value: v };
  window.EDDO_WEB = true;
  window.EDDO_DEVICE = device;
  document.documentElement.classList.add("eddo-web");
  document.documentElement.dataset.eddoDevice = device;
  document.documentElement.lang = "en";
  // same call Wallpaper Engine makes; also releases the app's "wait for settings"
  window.wallpaperPropertyListener.applyUserProperties(props);

  // ---------- one-time setup card ----------
  const needSetup = !local.hatoken || q.has("setup");
  if (!needSetup) return;
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function show() {
    const box = document.createElement("div");
    box.className = "eddo-web-setup";
    box.innerHTML = `
      <form>
        <p class="k">EDDO OS · THIS DEVICE</p>
        <h2>Connect to Home Assistant</h2>
        <p class="m">Saved on this device only. Open the page with <b>?setup</b> to change it later.</p>
        <label>Home Assistant address<input name="haurl" value="${esc(local.haurl || values.haurl || "")}" autocomplete="off" spellcheck="false"></label>
        <label>Long-lived access token<input name="hatoken" type="password" value="${esc(local.hatoken || "")}" placeholder="Profile → Security → Long-lived access tokens" autocomplete="off" spellcheck="false"></label>
        <label>Layout<select name="device">${Object.keys(Object.assign({ mac: 1 }, site.devices || {})).map((d) => `<option value="${esc(d)}"${d === device ? " selected" : ""}>${esc(d.toUpperCase())}</option>`).join("")}</select></label>
        <div class="a"><button type="submit">SAVE &amp; START</button></div>
      </form>`;
    const css = document.createElement("style");
    css.textContent = `.eddo-web-setup{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(8,10,8,.82);font-family:MiSans,system-ui,sans-serif;color:#ece9e2}
      .eddo-web-setup form{width:min(520px,90vw);padding:26px 28px;background:#151816;border-top:5px solid #ece9e2;box-shadow:0 30px 80px rgba(0,0,0,.5)}
      .eddo-web-setup .k{margin:0 0 10px;font-size:11px;letter-spacing:1.8px;color:#a9a69c}
      .eddo-web-setup h2{margin:0 0 6px;font-size:26px;font-weight:400}
      .eddo-web-setup .m{margin:0 0 18px;font-size:13px;color:#a9a69c}
      .eddo-web-setup label{display:block;margin:0 0 14px;font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#a9a69c}
      .eddo-web-setup input,.eddo-web-setup select{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;background:#0e100f;border:1px solid #3a3d3a;color:#ece9e2;font:14px MiSans,system-ui,sans-serif;letter-spacing:.3px;text-transform:none}
      .eddo-web-setup .a{display:flex;justify-content:flex-end;margin-top:6px}
      .eddo-web-setup button{padding:10px 18px;border:1px solid #ece9e2;background:none;color:#ece9e2;font-size:11px;letter-spacing:1.8px;cursor:pointer}
      .eddo-web-setup button:hover{background:#ece9e2;color:#151816}`;
    document.head.append(css);
    document.body.append(box);
    box.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const next = { haurl: String(f.get("haurl") || "").trim(), hatoken: String(f.get("hatoken") || "").trim(), device: String(f.get("device") || "mac") };
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch (_) {}
      location.href = location.pathname;   // reload without ?setup
    });
    setTimeout(() => box.querySelector("input[name=hatoken]").focus(), 50);
  }
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
})();
