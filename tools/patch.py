"""Rebuild the EDDO OS bundle from the original Rhine Lab files.

    python tools/patch.py [original folder] [wallpaper folder] [logo.svg]

Defaults: tools/original, wallpaper/EDDO OS, tools/EDNET-logo.svg (run from the repo root).
Writes assets/index-DGZ5gDxu.js and assets/index-Bg7aiZZN.css into the wallpaper folder.
"""
import re, json, shutil, sys, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
ORIG = os.path.join(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'original'), '')
OUT = os.path.join(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'wallpaper', 'EDDO OS'), '')
os.makedirs(os.path.join(OUT, 'assets'), exist_ok=True)
LOGO_FILE = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, 'EDNET-logo.svg')
JS='assets/index-DGZ5gDxu.js'; CSS='assets/index-Bg7aiZZN.css'
s=open(ORIG+JS,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    n=s.count(old)
    assert n==count, (old[:80], n)
    s=s.replace(old,new)

# ---------- EDNET logo geometry ----------
svg=open(LOGO_FILE, encoding='utf-8').read()
parts=[]
for pts in re.findall(r'points="([^"]+)"',svg):
    nums=pts.split(); xy=[(nums[i],nums[i+1]) for i in range(0,len(nums),2)]
    parts.append('M'+' L'.join(f'{x} {y}' for x,y in xy)+'Z')
parts+= re.findall(r' d="([^"]+)"',svg)
LOGO=''.join(parts)
LW,LH=632.25,151.85
sc=280/LW; tx=(310-280)/2; ty=(145-LH*sc)/2
TR=f'translate({tx:.2f} {ty:.2f}) scale({sc:.5f})'
# hc: contour path (stroke-drawn during opening), a placeholder the opening code removes, then the filled mark
rep('''hc=`<svg viewBox="0 0 310 185" aria-label="Rhine Lab" role="img">${Vf}<text x="165" y="174" text-anchor="middle" font-family="MiSans,sans-serif" font-size="16" font-weight="700" letter-spacing="22">RHINE·LAB</text></svg>`''',
 f'''hc=`<svg viewBox="0 0 310 185" aria-label="EDNET" role="img"><path class="eddo-contour" transform="{TR}" vector-effect="non-scaling-stroke" d="{LOGO}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path class="eddo-placeholder"/><path class="eddo-fill" transform="{TR}" d="{LOGO}" fill="currentColor"/><text x="155" y="174" text-anchor="middle" font-family="MiSans,sans-serif" font-size="16" font-weight="700" letter-spacing="22">EDDO·LAB</text></svg>`''')
rep('ax="M295 73C295 41 273 15 240 15C221 15 207 23 192 38C186 43 181 47 176 52C127 96 103 128 70 128C38 128 15 101 15 70C15 39 37 15 70 15C103 15 127 48 156 75C182 99 208 128 240 128C273 128 295 105 295 73Z"', f'ax="{LOGO}"')
# thin outline instead of the thick infinity stroke
rep('strokeWidth:Et([[229,.25],[230,2.8],[231,8],[232,16],[233,23.5],[234,26]],n)','strokeWidth:Et([[229,.25],[230,.8],[232,1.4],[234,1.8]],n)')
# fade the filled EDNET mark in once the outline is complete
rep('this.contour.setAttribute("stroke-width",String(t.logo.strokeWidth)),',
    'this.contour.setAttribute("stroke-width",String(t.logo.strokeWidth)),this.contour.parentNode.querySelector(".eddo-fill")?.style.setProperty("opacity",String(t.logo.symbolScale)),')
rep('logoLetters:Os("RHINE·LAB",t,232,255)','logoLetters:Os("EDDO·LAB",t,232,255)')

# ---------- EDNET mark inline (for POWERED BY) ----------
MARK=f'<svg class="eddo-mark" viewBox="0 0 {LW} {LH}" aria-label="EDNET" role="img"><path fill="currentColor" d="{LOGO}"/></svg>'
rep('<div class="powered">POWERED BY <b>RHINE LAB</b><i></i></div>', f'<div class="powered">POWERED BY <b>{MARK}</b><i></i></div>')
rep('poweredLetters:Os("POWERED BY RHINE LAB",t,279,295)','poweredLetters:Os("POWERED BY EDNET",t,279,295)')
rep('<span>POWERED BY RHINE LAB</span></div>`}','<span>POWERED BY EDNET</span></div>`}')

# ---------- Wordmark: EDDO LAB in the original Bold outline lettering ----------
rep('my={access:ry,identity:ay,request:oy,processing:ly,processingGlitch:cy,permission:hy,brand:dy,welcome:uy,company:fy,database:py}',
 'my={access:ry,identity:ay,request:oy,processing:ly,processingGlitch:cy,permission:hy,brand:{text:"EDDO LAB",weight:"Bold",units:1e3,letters:[fy.letters[4],py.letters[9],py.letters[9],uy.letters[4],fy.letters[5],fy.letters[6],fy.letters[7],fy.letters[8]]},welcome:uy,company:{text:"EDDO LAB",weight:"Bold",units:1e3,letters:[fy.letters[4],py.letters[9],py.letters[9],uy.letters[4],...fy.letters.slice(5,9)]},database:py}')
rep('new Hr(this.brandLines[0],["brand"]).setText("RHINE LAB")','new Hr(this.brandLines[0],["brand"]).setText("EDDO LAB")')
rep('["company"]).setText("RHINE LAB.LLC."))','["company"]).setText("EDDO LAB"))')
rep('<strong>RHINE LAB.LLC.</strong><strong class="welcome-highlight" aria-hidden="true">RHINE LAB.LLC.</strong>','<strong>EDDO LAB</strong><strong class="welcome-highlight" aria-hidden="true">EDDO LAB</strong>')
rep('lx=`<h1>RHINE LAB</h1><div>SYNTHESIZE INFORMATION</div>','lx=`<h1>EDDO LAB</h1><div>INTEGRATED HOME SYSTEMS</div>')
rep('"SYNTHESIZE INFORMATION ANALYSIS OS"','"INTEGRATED HOME SYSTEMS ANALYSIS OS"')
rep('"RHINE LAB WELCOME TO INTERNAL DATABASE"','"EDDO LAB EDNET WELCOME TO INTERNAL DATABASE"')

# ---------- other Rhine Lab strings ----------
rep('<span>RHINE LAB / OBJECT STUDY</span>','<span>EDDO LAB / OBJECT STUDY</span>')
rep('<span>RHINE LAB / ${Qe==="settings"','<span>EDDO LAB / ${Qe==="settings"')
rep('t.fillText("RHINE LAB, LLC.",22,116)','t.fillText("EDDO LAB",22,116)')
# workspace heading: render "EDDO LAB / DAILY TERMINAL" with the outlined name glyphs
rep('function Xs(n,e){const t=q4[n];','function Xs(n,e){const t=q4[n];n==="daily"&&e===void 0&&(e="EDDO LAB / DAILY TERMINAL");')
rep('"en":"RHINE LAB, LLC."','"en":"EDDO LAB"',2)

# hover label on the 3D archive slabs: EDNET mark instead of the Rhine Lab infinity mark
rep('rx=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 310 145" color="#171713">${Vf}</svg>`',
    f'rx=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 310 145"><path transform="{TR}" d="{LOGO}" fill="#171713"/></svg>`')
rep('t.fillText("R L / I S",809,61)','t.fillText("E L / O S",809,61)')

# don't let the workspace redraw its own tab over an EDDO tab (06 Game mode, 07 Jarvis)
rep('renderPanel(){if(this.lane<0){','renderPanel(){if(window.eddoTabs&&window.eddoTabs.active())return;if(this.lane<0){')

# 05 Focus timer is replaced by the EDDO Cameras tab: hide that lane
rep('laneEnabled(e){return e>=0&&e<mc.length&&(this.expanded||this.properties[mc[e]]?.value!==!1)}','laneEnabled(e){return e>=0&&e<mc.length&&mc[e]!=="enablefocus"&&mc[e]!=="enablemedia"&&(this.expanded||this.properties[mc[e]]?.value!==!1)}')

# 02 Today's tasks: show the real task list in the tab (moved from the left column)
rep("""this.lane===1&&(t=$('<div class="wb-large">03<small>PRIORITIES</small></div><p class="wb-muted">把今天留给最重要的三件事。<br>点击左侧事项标记完成，再点一次撤销。完成状态每天重置。</p>')),""",
    """this.lane===1&&(t='<div class="eddo-today-slot"></div>'),""")
rep('Py(this.root.querySelector(".wb-content"),t,!this.stage.classList.contains("reduce-motion")),',
    '((__td,__tm)=>{__td&&__td.closest(".wb-content")&&this.root.querySelector(".wb-overview").append(__td);const __wt=this.root.querySelector(".wb-time");__tm.forEach(x=>x&&x.closest(".wb-content")&&__wt.append(x));Py(this.root.querySelector(".wb-content"),t,!this.stage.classList.contains("reduce-motion"));this.lane===1&&__td&&this.root.querySelector(".eddo-today-slot")?.append(__td);const __ts=this.lane===0&&this.root.querySelector(".eddo-time-slot");__ts&&__tm.forEach(x=>x&&__ts.append(x))})(this.root.querySelector(".wb-today"),[this.root.querySelector(".wb-clock"),this.root.querySelector(".wb-date")]),')
# 01 Time & date: the big clock and date move from the left column into the tab
rep('''a=(i.getTime()-r)/(s-r)*100;t=$`<div class="wb-large">''', '''a=(i.getTime()-r)/(s-r)*100;t='<div class="eddo-time-slot"></div>'+$`<div class="wb-large">''')
# default operator name
rep('const xh="JOYCE MOORE",$x=24;','const xh="EDDO",$x=24;')
open(OUT+JS,'w',encoding='utf-8').write(s)

# ---------- CSS ----------
c=open(ORIG+CSS,encoding='utf-8').read()
c+='''
/* EDDO OS */
.powered b{display:inline-flex;align-items:center}.powered .eddo-mark{height:17px;width:auto;display:block;transform:translateY(-1px)}
.boot-logo .eddo-fill{opacity:0}.welcome-logo .eddo-contour{display:none}.welcome-logo .eddo-fill{opacity:1!important}
.boot-logo svg>path[stroke-width="15"]{display:none}
'''
open(OUT+CSS,'w',encoding='utf-8').write(c)
print('ok')
