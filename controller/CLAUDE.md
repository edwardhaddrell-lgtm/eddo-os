# Loupedeck Live Controller — Project Rules

Custom replacement for the official Loupedeck software. A background service on Edward's Windows PC drives a Loupedeck Live: Windows controls (audio output, monitors) plus live Home Assistant pages. This file is the single source of truth for decisions. Update the **Decisions log** whenever something is settled.

---

## 1. Hardware

- **Device:** Loupedeck Live, serial `LDD20010142148070011 5B0010`
- **Firmware:** 0.2.5 (one of the versions the foxxyz library is tested with)
- **Connection:** USB to the Windows PC (exposed as a serial device)
- **Controls:**
  - 12 touch keys on the centre screen, 4×3 grid, 90×90 px each (key index 0–11)
  - Left and right touch strips, 60×270 px screens each
  - 6 knobs (3 left, 3 right). Each turns and pushes to click.
  - 8 round buttons along the bottom, each with an RGB LED (button IDs 0–7)
  - Haptic vibration and screen brightness control
- **Rule:** the official Loupedeck / Logi software must be fully quit and disabled at startup. It conflicts with direct device access.

### Confirmed IDs (phase 1, tested on the real device 2026-10-23)

- **USB:** VID `2EC2`, PID `0004`, shows up as "USB Serial Device" on **COM5**. The library finds it automatically by vendor ID, so don't hard-code the COM port. Device serial reported over the protocol: `LDD2001014021480700115B0010`.
- **Round buttons:** event `down` / `up` with `id` = number `0`–`7`, left to right. LEDs set with `setButtonColor({ id, color })` using the same IDs.
- **Knobs:** turning emits `rotate` with `{ id, delta }`. `delta` is `+1` per clockwise click and `-1` per anticlockwise click. Pushing emits `down` / `up` with the same knob `id`.

  | | Left | Right |
  |---|---|---|
  | Top | `knobTL` | `knobTR` |
  | Centre | `knobCL` | `knobCR` |
  | Bottom | `knobBL` | `knobBR` |

- **Keys:** `touchstart` / `touchmove` / `touchend`, each touch has `target: { screen: 'center', key: 0–11 }`. Numbered in reading order: 0–3 top row, 4–7 middle, 8–11 bottom. Drawn with `drawKey(index, cb)`.
- **Strips:** the same touch events with `target.screen` = `'left'` or `'right'` (no `key`). All three screens share one coordinate space, 480×270: left strip x 0–59, keys x 60–419, right strip x 420–479. The y axis runs 0 at the top to about 270 at the bottom. Drawn with `drawScreen('left' | 'right', cb)`.
- **Haptics / brightness:** `vibrate(HAPTIC.SHORT)` and `setBrightness(0–1)` both work.
- **Clean shutdown matters:** if the process is killed without `device.close()`, the device ignores the next handshake until the USB cable is replugged. The service must always close on exit, and should detect a stalled handshake (`src/hello.ts` warns after 5 s).

## 2. Stack

- **Runtime:** Node.js LTS (20+), TypeScript run with `tsx`, ES modules
- **Device library:** [`loupedeck`](https://github.com/foxxyz/loupedeck) (foxxyz). No reverse engineering needed; the protocol is already handled.
- **Windows audio:** NirSoft `svcl.exe` (SoundVolumeCommandLine, 64-bit), bundled in `tools/`
- **Windows displays:** NirSoft `MultiMonitorTool.exe` and the built-in `DisplaySwitch.exe`, bundled in `tools/` (DisplaySwitch ships with Windows)
- **Home Assistant:** websocket API (`/api/websocket`) with a long-lived access token
- **Web editor:** small HTTP + websocket server on `localhost` (Fastify or Express), plain HTML/JS front end
- **Config:** `config/deck.yaml`, hot-reloaded on save
- **Secrets:** `.env` (HA URL, HA token). Never committed, never printed in logs.

## 3. Architecture

```
src/
  main.ts              entry: load config, connect device, start web server, tray
  device/              connect/reconnect, input events → normalised events
  render/              draw keys and strips (icon + label + state colour), button LEDs
  pages/               page engine: current page, key → action map, knob bindings
  actions/
    audio.ts           set default output, toggle, volume, mute (svcl)
    display.ts         set primary, extend/duplicate, move window (TBC)
    ha.ts              call_service, toggle, brightness, scenes
    system.ts          run program, open URL, send hotkey
    nav.ts             go to page, back
  state/               live state cache (HA entities, current audio device, primary monitor)
  web/                 editor server + static UI
config/deck.yaml       pages, keys, knobs (source of truth)
assets/icons/          key icons (PNG/SVG)
tools/                 svcl.exe, MultiMonitorTool.exe
```

Principles:
- Every key's appearance comes from **config + live state**. Nothing is hard-coded per key.
- Actions are small, independent and testable without the device. Add a CLI so `npm run action -- audio.toggle` works on its own.
- The service must survive USB unplug/replug, HA restarts and sleep/wake, reconnecting automatically.

## 4. Config format (draft)

```yaml
device:
  brightness: 0.8

pages:
  windows:
    button: 0              # round button that opens this page
    led: "#3b82f6"
    keys:
      0: { label: "Speakers", icon: speaker, action: audio.set, device: "SPEAKERS_ID" }
      1: { label: "Headphones", icon: headphones, action: audio.set, device: "HEADPHONES_ID" }
      2: { label: "Swap", icon: swap, action: audio.toggle, devices: ["SPEAKERS_ID", "HEADPHONES_ID"] }
      4: { label: "Main: Left", icon: monitor, action: display.primary, monitor: "LEFT_ID" }
      5: { label: "Main: Right", icon: monitor, action: display.primary, monitor: "RIGHT_ID" }
    knobs:
      left1: { action: audio.volume, step: 2, press: audio.mute }

  living_room:
    button: 3
    led: "#f59e0b"
    keys:
      0: { label: "Lamp", entity: light.living_room_lamp, action: ha.toggle }
    knobs:
      left1: { entity: light.living_room_lamp, action: ha.brightness, step: 5 }
```

Key appearance rules: state "on" → lit colour; state "off" → dim; unavailable → grey with a strike-through. Device IDs come from `svcl.exe /scomma` ("Command-Line Friendly ID" column) and from MultiMonitorTool's monitor IDs. Never use display numbers, because they change.

## 5. Page plan (default — confirm with Edward)

| Round button | Page |
|---|---|
| 0 | Windows: displays + audio |
| 1 | Audio menu: each output device, volume, mute |
| 2 | Scenes & Actions (HA) |
| 3 | Rooms launcher: keys open room sub-pages |
| 4 | Media / Plex |
| 5–7 | Favourite rooms (Edward to pick) |

The HA structure starts from the iPod click wheel remote menu tree: Scenes & Actions, Living Room, Kitchen, Office (Start Up / Shut Down → `scene.startup` / `scene.shutdown`), Bedroom, Master Bedroom, Dining Room (climate), Garden (AC), Bathroom, Guest Room, Fox's Room, Audiobooks, Plex. Regenerate the entity lists from live HA areas rather than trusting old IDs.

## 6. Build phases

Each phase ends with Edward testing on the real device.

1. **Hello device.** Connect, log every button/knob/touch event with its ID, draw text on each key, light each round button a different colour. Confirm the real IDs and update section 1.
2. **Page engine + config.** Load `deck.yaml`, switch pages with the round buttons, hot-reload config, render icon + label.
3. **Windows page.** Audio set/toggle/volume/mute with the current device shown live; primary monitor switching plus the other display actions from the open questions.
4. **Home Assistant.** Connect, subscribe to state, toggle/brightness/scenes, live key colours, reconnect handling.
5. ~~**Web editor.**~~ Skipped (2026-10-23): Edward asks Claude to edit `deck.yaml` instead.
6. **Polish.** Tray icon, run at login (Task Scheduler or Startup folder), custom icon set, brightness dimming when idle.

## 7. Working rules

1. This file is the source of truth. Record every settled decision in the Decisions log.
2. Test each phase on the real device before starting the next one.
3. Secrets live only in `.env`. Never commit or log them.
4. Ask before installing anything globally or changing Windows settings.
5. Keep actions usable from the CLI, so they can be debugged without the deck.
6. When something Windows-specific is flaky (MultiMonitorTool on Win 11 24H2 has a known quirk where all actions fail until display settings are touched or a monitor is replugged), detect it and show an error state on the key rather than failing silently.
7. Use git and commit at the end of each working phase.

## 8. Open questions

- [x] **Monitors:** two keys only: **Extend** (both on) and **Dell only** (Asus off). Decided 2026-10-23.
- [x] **Audio:** outputs are Speakers (KEF LSX II LT), Headphones (Elgato Wave:XLR), and the Asus monitor's audio. Mic is never switched.
- [x] **Look:** full colour (decided 2026-10-23).
- [x] **HA:** same LAN, `http://homeassistant.local:8123`, long-lived token in `.env` (HA 2026.10).
- [ ] **Scope:** Windows-only forever, or might the deck move to a Mac later?
- [ ] **Knobs:** what should the 6 knobs do on each page?

## 9. Decisions log

- 2026-10-23: Build a custom app (Option B) rather than use Bitfocus Companion.
- 2026-10-23: No reverse engineering needed; use the foxxyz `loupedeck` library.
- 2026-10-23: Firmware confirmed as 0.2.5.
- 2026-10-23: Phase 1 done. `loupedeck@7.0.3` installed locally (native scripts approved for `canvas`, `@serialport/bindings-cpp` and `esbuild` only). All buttons, knobs (turn + push), keys, strips and LEDs confirmed on the device; IDs are recorded in section 1. Run with `npm run hello`.
- 2026-10-23: Look is **full colour**. Each page has an accent colour, and keys can override it. Keys are dark tiles tinted with their colour, with the icon in that colour and a white label. A pressed key fills solid. Keys with no action are grey. Unknown actions get a grey "?" badge and failed actions a red "!" badge. Icons are SVGs in `assets/icons` using `currentColor`, recoloured per state at render time. PNGs also work.
- 2026-10-23: Phase 2 starts from the default page plan with placeholder keys (TODOs in `deck.yaml`). Buttons 5–7 temporarily open Living Room, Office and Bedroom.
- 2026-10-23: A key's action fires on **release**, and only if the finger lifts on the same key. Touch-down highlights the key and buzzes. Knob labels show on the side strip beside each knob (strip slots line up with the knobs). If the left knobs have no labels, the left strip shows the page title instead.
- 2026-10-23: Round button LEDs: the active page's button is lit full, other assigned buttons dimly in their page colour, and unassigned buttons are off. Sub-pages (e.g. a room opened from Rooms) keep the launcher's button lit, unless the sub-page has its own button.
- 2026-10-23: Phase 2 done and tested on the device. Run with `npm start`; `npm run preview` renders pages to `preview/*.png`.
- 2026-10-23: Switching audio output does **not** change the default microphone.
- 2026-10-23: Monitors are an **Asus ROG PG32UCDM** (`DISPLAY\AUS32F2`, 4K at 125% scaling, currently primary) and a **Dell P2719HC** (`DISPLAY\DEL4188`, 1080p, to the left). Monitor keys: **Extend** (both on, Asus primary) and **Dell only** (Asus disabled). `DisplaySwitch /internal` can't do "Dell only" because it keeps the primary (Asus), so this needs MultiMonitorTool to disable/enable the Asus by its monitor ID. Identify monitors by ID, never by display number.
- 2026-10-23: NirSoft `svcl.exe` and `MultiMonitorTool.exe` (64-bit) downloaded from nirsoft.net into `tools/`. They're gitignored because the licence asks for the full zip when redistributing; `tools/README.md` says where to get them.
- 2026-10-23: Read the NirSoft tools' tables via `/scomma <temp file>`, **never** an empty filename for stdout. With an empty filename, MultiMonitorTool sometimes opens its GUI window, and svcl shows an error dialog when PowerShell drops the empty argument. Their exit codes carry results, not errors, so success is checked by re-reading state.
- 2026-10-23: Audio outputs (svcl Command-Line Friendly IDs): Speakers `2- LSX II LT\Device\Speakers\Render`, Headphones `Elgato Wave:XLR\Device\Headphones\Render`, Asus `NVIDIA High Definition Audio\Device\PG32UCDM\Render`. `audio.set` sets the default for all roles (console, multimedia, communications) on the output side only.
- 2026-10-23: "Dell only" = `display.disable AUS32F2` (MultiMonitorTool), which works. "Extend" was first `display.layout` (MultiMonitorTool `/LoadConfig config/monitors-extend.cfg`), but tested on the device, **neither `/LoadConfig` nor `/enable` can turn the Asus back on** once disabled. Windows' built-in `DisplaySwitch.exe /extend` restores the exact remembered layout (Asus primary, 4K 240 Hz, Dell on the left), so "Extend" is now `display.extend` (DisplaySwitch, then `/SetPrimary` only if the wrong screen ends up main). `monitors-extend.cfg` is kept as a backup. Display actions re-read monitor state for up to 6 s and show a red "!" with a fix-it hint if Windows ignored them (the 24H2 quirk).
- 2026-10-23: Windows state is polled (audio every 2 s, monitors every 4 s) and refreshed immediately after each action. Keys light up when their state is active (current output, muted, layout in effect). Knob strips show live volume. Rapid knob turns are batched into one svcl call. CLI: `npm run action -- list` / `actions` / `<action> key=value --delta N`.
- 2026-10-23: Phase 3 done and tested on the device: audio set/swap/mute/volume with live state, Dell Only and Extend. Code changes need a restart of `npm start` (only `deck.yaml` hot-reloads).
- 2026-10-23: Home Assistant over the websocket API using Node's built-in `WebSocket` (no extra package). `HA_URL` / `HA_TOKEN` are loaded from `.env` via `process.loadEnvFile`. The token is never logged. Reconnects with backoff (1 s to 30 s), re-reads all states on reconnect, and stops retrying if the token is rejected. The engine only redraws for state changes to entities on the current page.
- 2026-10-23: HA actions: `ha.toggle` (`homeassistant.toggle`; scenes and scripts are turned on), `ha.scene` (scene or script), `ha.brightness` knob (`brightness_step_pct`), `ha.climate` knob (target temperature step), `ha.service` (any service). Unavailable or unknown entities, or HA being disconnected, draw grey with a strike-through. Room pages were built from live HA areas on 2026-10-23. Note that HA's dining room names look swapped: `dining_room_wall_lights_light` is called 'Dining Room Light' in HA.
- 2026-10-23: The token was pasted into chat once. Edward may want to rotate it.
- 2026-10-23: Office AC key opens an `office_ac` sub-page: power, mode keys (`ha.climateMode`), target/room temperature shown on keys (keys can display an action's live value), Colder/Warmer keys (`ha.climate` with `delta: ±1`), and fan/vane knobs (`ha.climateOption`, cycling through HA's own `*_modes` lists). A `nav.page` key with an `entity` lights up while that entity is on.
- 2026-10-23: Windows page launchers (keys 6–11): Spotify and Claude are Microsoft Store apps, launched with `system.app` (`explorer shell:AppsFolder\<PackageFamilyName>!<AppId>`). Home Assistant, Unraid (`http://eddo-nas/`, 192.168.7.56) and Plex web (`http://eddo-nas:32400/web`) open as Chrome tabs via `system.url` with `browser: chrome`. Lock PC uses `system.lock`.
- 2026-10-23: **Phase 5 (web editor) skipped.** Changes are made by asking Claude to edit `deck.yaml` or the code.
- 2026-10-23: **Stuck-device fix:** after an unclean exit the deck ignores the handshake, but sending a websocket close frame (`88 80 00 00 00 00`) first resets it. `src/device/unstick.ts` patches the library's serial `connect` to always send it, then handshake with a 3 s timeout (a timeout counts as an error disconnect, so the library retries). Tested by force-killing the app twice: it reconnected in about 0.4 s each time with no replug.
- 2026-10-23: Phase 6 design: `scripts/run.ps1` runs the app hidden and restarts it (exit 0 = quit, 3 = already running, 75 = restart, other = crash; it backs off after 5 crashes in 2 minutes). Output goes to `logs/service.log`. Started at login by a shortcut in the user's Startup folder (`npm run install-startup` / `remove-startup`), with no admin rights or Task Scheduler. Only one copy can run, enforced by `logs/deck.pid`.
- 2026-10-23: Tray icon = `scripts/tray.ps1` (WinForms NotifyIcon in a child PowerShell). Menu clicks arrive as stdout lines. Status is read from `logs/status.json`. It exits by itself when the app dies.
- 2026-10-23: Idle dimming (`device.idle`): dim to 10% after 5 min, screens and LEDs off after 30 min. The first touch, press or turn only wakes the deck.
- 2026-10-23: Startup shortcut installed at `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Loupedeck Controller.lnk`. Phase 6 done.
- 2026-10-23: **Never start the background service from Claude's own shell** (Start-Process / npm run service). It becomes part of the Claude app's process group and is killed when Claude restarts. That happened once: the deck died silently with nothing logged. To (re)start it, run `explorer.exe "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Loupedeck Controller.lnk"` so Explorer owns it, or ask Edward to use the tray's Restart.
- 2026-10-23: Shortcuts: Startup folder (runs at login) and Start menu, both named 'Loupedeck Controller' and using `assets/app.ico` (made by `scripts/make-icon.ts`). Running the Start menu one while the app is already running does nothing (exit 3).
