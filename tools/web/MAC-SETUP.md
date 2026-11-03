# EDDO OS · Mac edition (served from Eddo-NAS)

The same EDDO OS as the PC wallpaper, served as a web page from Eddo-NAS and shown on the MacBook's desktop with **Plash**. It also works in any browser on the home network (Frame TV, tablet, phone).

## 1. Put the files on Eddo-NAS (one time)

1. In Unraid: **Shares → Add Share**, name it `eddo-os`, and turn on SMB export so you can reach it from your PC.
2. From your PC, copy everything inside the `eddo-os-web` folder into `\\eddo-nas\eddo-os\`. `index.html` should sit directly in the share.

## 2. Add a small web server container (one time)

In Unraid go to **Docker → Add Container** and set:

| Field | Value |
|---|---|
| Name | `eddo-os-web` |
| Repository | `nginx:alpine` |
| Network type | Bridge |
| Port | Container port `80` → Host port `8095` |
| Path | Container path `/usr/share/nginx/html` → Host path `/mnt/user/eddo-os/`, access mode **Read Only** |

Click **Apply**. Then test it from any computer by opening `http://eddo-nas:8095`. If the name doesn't resolve, use the NAS's IP address instead, e.g. `http://192.168.4.x:8095`.

## 3. First run on the Mac

1. Open `http://eddo-nas:8095` in Safari once.
2. A **Connect to Home Assistant** card appears:
   - **Address:** already filled in (`http://192.168.4.81:8123`).
   - **Token:** in Home Assistant, open **your profile → Security → Long-lived access tokens → Create token**. Name it something like "MacBook EDDO OS", then paste it here.
   - **Layout:** `MAC`.
3. Click **SAVE & START**.

The token is stored on this Mac only, never on Eddo-NAS. To change it later, open the page with `?setup` on the end of the address.

## 4. Make it the desktop (Plash)

1. Install **Plash** (free) from the Mac App Store.
2. In Plash, choose **Add Website** and enter `http://eddo-nas:8095`.
3. Plash keeps its own storage, separate from Safari, so the setup card appears once more inside Plash. Fill it in the same way. To click on the wallpaper, turn on **Browsing Mode** from the Plash menu bar icon.
4. Recommended Plash settings:
   - **Launch at login.**
   - **Deactivate while on battery.** The 3D scene is heavy on a laptop.
   - A keyboard shortcut for **Browsing Mode**, so you can flick between clicking the panels and using the normal desktop.

## Differences from the PC wallpaper

- **Not on the Mac** (they need the PC's Loupedeck controller): OPEN FILES, Talk to Jarvis (mic), Game mode / Steam, and the Jarvis waveform.
- **Jarvis is silent:** Plash mutes all sound, so Jarvis replies appear as text in the Jarvis tab but aren't spoken. The same applies to the morning briefing and the cry and print announcements. In Safari or Chrome they're spoken as normal.
- **Fox's room** uses the fast picture feed rather than video.
- **Home only:** it works on your home network only, unless you later point it at your remote Home Assistant address.

## Changing settings

`eddo-web-settings.js` on the share holds the settings shared by every screen, plus per-screen layouts (`mac`, `tv`). It uses the same names as the Wallpaper Engine settings, such as `colortheme`, `bgdim`, `uimargintop` and `cameras`. Edit it, then reload the page (Plash menu → Reload).

## Updating

After any change to the PC wallpaper, rebuild and re-copy:

```
python build_web.py "<path to the EDDO OS wallpaper folder>" eddo-os-web
```

Then copy `eddo-os-web` onto the share again. Your edited `eddo-web-settings.js` is kept.
