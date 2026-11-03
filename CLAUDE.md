# Notes for Claude: EDDO OS

Read `README.md` first. The controller has its own `controller/CLAUDE.md`.

## How Edward works
- He wants speed: no slow headless-browser testing unless asked. Push the change, say exactly what to reload, and fix from his feedback and screenshots.
- He's not a terminal user. Give click-by-click steps, or a one-click `.cmd` he can double-click.

## Where things live on his PC (edwardspc)
- Wallpaper: `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\projects\myprojects\EDDO OS`
- Controller: `C:\Users\Eddar\Documents\loupedeck-controller`. It runs via `scripts/run.ps1`, which restarts it if it exits; `update.cmd` = npm install + restart.
- Home Assistant: `http://192.168.4.81:8123`.

## Gotchas
- **Wallpaper Engine rewrites `project.json` from memory.** It must be fully quit before editing that file.
- **Cache busting:** bump the `?v=` numbers in `index.html` after editing any `eddo-*` file or the bundle.
- **Never force-kill or relaunch Wallpaper Engine from a script.** A restart script did that once (`restart-wallpaper.cmd`), WE then wouldn't start until the PC was rebooted. Prefer reloading the wallpaper.
- **Bridge requests carry the key:** `http://127.0.0.1:47290/k/<key>/…`; the wallpaper reads it from `assets/bridge-key.js`.
- **The original app re-renders lanes every second.** Anything EDDO puts into `.wb-content` must survive that; see the slot pattern in `patch.py` for tab 01 (clock) and tab 02 (tasks).
- **Newer HA dropped `frontend_stream_type`:** use `camera/capabilities`. The Nanit's video codec doesn't decode in WE's browser, so it falls back to the MJPEG picture feed.
- **iCUE's SDK doesn't share the M65 mouse or any sensors.** Coolant temperature comes from iCUE's Sensor Logging CSV instead.
- **Uploading files to the PC through the device tools:** copy each changed file into a fresh folder before committing it (re-using the same staged path can push a stale copy), then re-stage and compare to confirm what landed.
