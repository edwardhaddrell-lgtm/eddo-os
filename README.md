# EDDO OS

Edward's interactive desktop: a Wallpaper Engine web wallpaper (rebuilt from *Rhine Lab · Interactive Desktop*) wired into Home Assistant, plus the Loupedeck controller that gives the wallpaper its PC-side powers.

| Folder | What it is |
|---|---|
| `wallpaper/EDDO OS/` | The Wallpaper Engine project. Copy this folder into `…\steamapps\common\wallpaper_engine\projects\myprojects\`. |
| `controller/` | The Loupedeck Live controller (Node + TypeScript). It also runs the local **bridge** on `127.0.0.1:47290` that the wallpaper uses for Chrome/Steam links, OPEN FILES, the Jarvis mic, camera relay, keyboard battery and EDDO-PC stats. |
| `tools/` | `patch.py` rebuilds the wallpaper bundle from the original files; `web/` builds the Mac / browser edition; `fake-home-assistant.py` is a stand-in HA for testing. |

## What the wallpaper does

- **Home Systems / Office panel:** lights (with scroll-wheel dimming and Hue colours), AC, coffee machine, scenes, inside/outside temperature.
- **Tabs:**
  - **01 Time & date** (big clock)
  - **02 Today's tasks** (Google Tasks "Top 3")
  - **03 Upcoming event** (haddrellwood calendar)
  - **04 Cameras** (Ring front door and garden, Nanit Fox's room, Bambu printer)
  - **05 House**: holographic 3D model of the house and garden office; rooms glow from their lights. The model is in `assets/eddo-house-data.js`.
  - **Game mode**
  - **Jarvis**
- **Left column:**
  - **Server / Eddo-NAS** (Unraid)
  - **EDDO-PC** (CPU, GPU, RAM, VRAM, CPU and coolant temperature)
  - **Printer / EDDO-PRINT** (Bambu)
- **Jarvis:** spoken morning briefing, question buttons, Talk to Jarvis (Elgato mic), cry and print announcements.
- **Footer:** keyboard battery (G915 via G HUB).
- **Screen care:** burn-in guard and idle clock for the OLED.

## Setting up on a new PC

1. **Wallpaper:** copy `wallpaper/EDDO OS` into Wallpaper Engine's `myprojects` folder, open Wallpaper Engine → Installed → EDDO OS. In its settings, enter the Home Assistant address and a **long-lived access token** (HA → Profile → Security).
2. **Controller:**
   ```
   cd controller
   npm install
   ```
   Create `controller/.env` with:
   ```
   HA_URL=http://192.168.4.81:8123
   HA_TOKEN=<long-lived token>
   ```
   Then run `npm run install-startup` so it starts at login, or `npm start` to run it now.
   - On first start it creates `bridge-key.txt` and writes `assets/bridge-key.js` into the wallpaper folder. Reload the wallpaper once after that.
3. **Optional extras:**
   - **iCUE → Settings → Enable SDK.**
   - **iCUE → Sensor Logging** into `controller/icue-log` every 5 seconds, for coolant and CPU temperature.
   - **G HUB** running, for the keyboard battery.
   - `controller/tools/` needs NirSoft **svcl.exe** and **MultiMonitorTool.exe** (not committed; see `controller/tools/README.md`).

## Never committed

`controller/.env` (HA token), `controller/bridge-key.txt` and `wallpaper/…/assets/bridge-key.js` (the bridge key), logs, `node_modules`, iCUE logs. Each machine makes its own.

## Updating the wallpaper bundle

The two big bundle files (`index-DGZ5gDxu.js`, `index-Bg7aiZZN.css`) are generated:

```
python tools/patch.py
```

This applies every EDDO change to the originals in `tools/original/`. Add new bundle edits to `patch.py` rather than editing the output by hand. The `eddo-*.js` and `eddo-ha.css` files are hand-written and edited directly.

**Mac / browser edition:** `python tools/web/build_web.py "wallpaper/EDDO OS" <output>`. See `tools/web/MAC-SETUP.md`.

## Credits

- Original wallpaper: *Rhine Lab · Interactive Desktop* by Uranium. MIT, © LBEILC; see `wallpaper/EDDO OS/LICENSE` and `THIRD-PARTY-NOTICES.txt`.
- MiSans font: Xiaomi, see `fonts/MiSans-license.pdf`.
- hls.js: Apache-2.0.
- Corsair iCUE SDK via the `cue-sdk` npm package.
