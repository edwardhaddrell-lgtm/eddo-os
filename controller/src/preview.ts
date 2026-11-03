// Renders every page to preview/<page>.png (480×270, the whole device face)
// so layouts can be checked without the device. Run: npm run preview
import { mkdirSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createCanvas } from 'canvas'
import { loadConfig } from './config.ts'
import { PageEngine } from './pages/engine.ts'
import { refreshAudio, refreshMonitors } from './state/windows.ts'
import { ha, startHomeAssistant } from './ha/client.ts'

const OFFSETS = { left: [0, 60], center: [60, 360], right: [420, 60] } as const

class PreviewDeck extends EventEmitter {
    connected = true
    canvas = createCanvas(480, 270)
    ctx = this.canvas.getContext('2d')
    drawScreen(id: keyof typeof OFFSETS, cb: (ctx: any, w: number, h: number) => void) {
        const [x, w] = OFFSETS[id]
        this.ctx.save()
        this.ctx.translate(x, 0)
        this.ctx.beginPath()
        this.ctx.rect(0, 0, w, 270)
        this.ctx.clip()
        cb(this.ctx, w, 270)
        this.ctx.restore()
    }
    drawKey(i: number, cb: (ctx: any, w: number, h: number) => void) {
        this.ctx.save()
        this.ctx.translate(60 + (i % 4) * 90, Math.floor(i / 4) * 90)
        cb(this.ctx, 90, 90)
        this.ctx.restore()
    }
    setButtonColor() {}
    setBrightness() {}
    vibrate() {}
}

const config = loadConfig('config/deck.yaml')
// Live Windows state so active keys and volume labels show (read-only).
await Promise.all([refreshAudio(), refreshMonitors()]).catch(err => console.log(`(no live state: ${err.message})`))
if (startHomeAssistant()) await new Promise(r => { ha.once('status', r); setTimeout(r, 8000) })
const deck = new PreviewDeck()
const engine = new PageEngine(deck as any)
engine.setConfig(config)
mkdirSync('preview', { recursive: true })
for (const name of config.pages.keys()) {
    engine.goTo(name, { resetHistory: true })
    await engine.renderAll()
    writeFileSync(`preview/${name}.png`, deck.canvas.toBuffer('image/png'))
}
console.log(`Wrote ${config.pages.size} previews to preview/`)
ha.stop()
process.exit(0)
