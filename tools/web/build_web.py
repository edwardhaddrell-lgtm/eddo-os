#!/usr/bin/env python3
"""Build the EDDO OS web edition from the Wallpaper Engine project folder.

    python build_web.py <wallpaper folder> <output folder>

The output folder is what Eddo-NAS serves (via the `web` branch, built by GitHub Actions).
"""
import json, re, shutil, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
src, out = Path(sys.argv[1]), Path(sys.argv[2])
SKIP = {"project.json", "preview.jpg", "bridge-key.js"}
SECRET = {"hatoken"}

out.mkdir(parents=True, exist_ok=True)
for p in src.rglob("*"):
    rel = p.relative_to(src)
    if p.is_dir() or p.name in SKIP:
        continue
    dst = out / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dst)

# 1. defaults from the wallpaper's settings (no token)
proj = json.loads((src / "project.json").read_text(encoding="utf-8-sig"))
props = proj["general"]["properties"]
defaults = {k: v["value"] for k, v in props.items() if v.get("type") != "group" and "value" in v and k not in SECRET}
boot = (HERE / "eddo-web.template.js").read_text()
boot = boot.replace("/*DEFAULTS*/{}", json.dumps(defaults, ensure_ascii=False, indent=None))
(out / "assets" / "eddo-web.js").write_text(boot)

# 2. shared settings file (from the repo; the HA token is never in it)
shutil.copy2(HERE / "eddo-web-settings.js", out / "eddo-web-settings.js")

# 3. entry page: feed settings straight after the host shim; no PC controller key
html = (src / "index.html").read_text()
html = re.sub(r'\s*<script src="\./assets/bridge-key\.js[^"]*"></script>', "", html)
v = int(time.time())
inject = f'\n    <script src="./eddo-web-settings.js?v={v}"></script>\n    <script src="./assets/eddo-web.js?v={v}"></script>\n'
first_close = html.index("</script>") + len("</script>")
html = html[:first_close] + inject + html[first_close:]
html = html.replace('<html lang="zh-CN">', '<html lang="en">')
(out / "index.html").write_text(html)
print(f"Built web edition in {out} ({sum(1 for _ in out.rglob('*') if _.is_file())} files)")
