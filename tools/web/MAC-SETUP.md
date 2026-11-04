# EDDO OS · Mac edition (served from Eddo-NAS)

The same EDDO OS as the PC wallpaper, served as a web page from Eddo-NAS and shown on the MacBook's desktop with **Plash**. It also works in any browser on the home network (Frame TV, tablet, phone).

## How it updates itself

The Mac edition is built automatically from the same repo as the PC wallpaper:

1. Any change pushed to `main` (wallpaper or `tools/web`) runs a GitHub Action, **Build web edition**.
2. It builds the site and publishes it to the repo's **`web` branch**. That branch only holds the built site, never tokens.
3. On Eddo-NAS, a small nginx container downloads the `web` branch when it starts, checks for updates every 5 minutes, and serves it on port 8095.

So after a change, the Mac picks it up within about 5 minutes. Reload Plash to see it.

## 1. Make a read-only GitHub key for Eddo-NAS (one time)

The repo is private, so Eddo-NAS needs a key that can only read it.

1. On GitHub: **your photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Name:** `eddo-nas read`. **Expiration:** the longest available.
3. **Repository access:** *Only select repositories* → `eddo-os`.
4. **Permissions → Repository permissions → Contents:** *Read-only*. Leave everything else as it is.
5. Click **Generate token** and copy it. It starts with `github_pat_`.

## 2. Add the web server container (one time)

In Unraid go to **Docker → Add Container**, switch on **Advanced View** (top right), and set:

| Field | Value |
|---|---|
| Name | `eddo-os-web` |
| Repository | `nginx:alpine` |
| Network type | Bridge |
| Post Arguments | *(paste the command below)* |

Then add three settings with **Add another Path, Port, Variable…**:

| Type | Name / Key | Value |
|---|---|---|
| Port | Container port `80` | Host port `8095` |
| Variable | `GH_TOKEN` | the `github_pat_…` key from step 1 (set **Display: Masked**) |
| Variable | `REPO` | `edwardhaddrell-lgtm/eddo-os` |

**Post Arguments** (one line, copy all of it):

```
sh -c 'apk add --no-cache git >/dev/null 2>&1; S=/usr/share/nginx/html; rm -rf $S /srv/git; git clone -q --depth 1 -b web --separate-git-dir=/srv/git "https://x-access-token:$GH_TOKEN@github.com/$REPO.git" $S; (while sleep 300; do git -C $S fetch -q --depth 1 origin web && git -C $S reset -q --hard FETCH_HEAD; done) & exec nginx -g "daemon off;"'
```

Click **Apply**. After about 30 seconds, open `http://eddo-nas:8095`. If the name doesn't resolve, use the NAS's IP address, e.g. `http://192.168.4.x:8095`. The GitHub key is stored outside the served folder, so it can't be read from the web page.

To pick up a change straight away instead of waiting 5 minutes, restart the container (**Docker → eddo-os-web → Restart**).

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

`tools/web/eddo-web-settings.js` in the repo holds the settings shared by every screen, plus per-screen layouts (`mac`, `tv`). It uses the same names as the Wallpaper Engine settings, such as `colortheme`, `bgdim`, `uimargintop` and `cameras`. Ask Claude to change it, or edit it on GitHub. Eddo-NAS picks it up within 5 minutes.

The Home Assistant token is never in the repo. It's entered once on each screen and stays there. Open the page with `?setup` on the end to change it.
