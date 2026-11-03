// Pure drawing functions: given a canvas context and a description of what a
// key/strip should show, paint it. No device or config knowledge here.

import type { Image } from 'canvas'

export const KEY_SIZE = 90

export type KeyStatus = 'normal' | 'active' | 'pressed' | 'error' | 'unknown' | 'unset' | 'unavailable'

export interface KeyView {
    label?: string
    icon?: Image | null
    value?: string   // live value drawn large instead of the icon (e.g. "23.5°")
    colour: string
    status: KeyStatus
}

export interface KnobHint {
    label: string
    value?: string
    colour: string
}

const BG = '#000000'
const TEXT = '#ffffff'
const ERROR = '#ef4444'
const GREY = '#6b7280'

// Mix a hex colour towards black. amount 0 → black, 1 → original.
export function shade(hex: string, amount: number) {
    const [r, g, b] = hexToRgb(hex)
    const f = (v: number) => Math.round(v * amount)
    return `rgb(${f(r)}, ${f(g)}, ${f(b)})`
}

export function hexToRgb(hex: string): [number, number, number] {
    let h = hex.slice(1)
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const n = parseInt(h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
}

// Split text into at most `maxLines` lines that fit `maxWidth`, shrinking the
// font if needed. Returns the font size used.
function fitText(ctx: any, text: string, maxWidth: number, maxLines: number, startSize: number, minSize = 10) {
    for (let size = startSize; size >= minSize; size--) {
        ctx.font = `bold ${size}px sans-serif`
        const words = text.split(/\s+/)
        const lines: string[] = []
        let line = ''
        for (const w of words) {
            const test = line ? `${line} ${w}` : w
            if (ctx.measureText(test).width <= maxWidth) line = test
            else {
                if (line) lines.push(line)
                line = w
            }
        }
        if (line) lines.push(line)
        if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxWidth)) return { size, lines }
    }
    ctx.font = `bold ${minSize}px sans-serif`
    return { size: minSize, lines: [text] }
}

export function drawKey(ctx: any, x: number, y: number, view: KeyView) {
    const s = KEY_SIZE
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, s, s)

    if (view.status === 'unset' && !view.label && !view.icon) {
        ctx.restore()
        return
    }

    const accent = view.status === 'unknown' || view.status === 'unavailable' ? GREY : view.colour
    const pressed = view.status === 'pressed'
    const active = view.status === 'active'

    // Tile
    roundRect(ctx, 3, 3, s - 6, s - 6, 12)
    const dim = view.status === 'unset' || view.status === 'unavailable'
    ctx.fillStyle = pressed ? accent : shade(accent, dim ? 0.12 : active ? 0.5 : 0.22)
    ctx.fill()
    ctx.lineWidth = active ? 4 : 2
    ctx.strokeStyle = view.status === 'error' ? ERROR : shade(accent, pressed || active ? 1 : 0.55)
    ctx.stroke()

    const textColour = pressed ? '#000000' : dim ? GREY : TEXT
    ctx.fillStyle = textColour
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (view.value) {
        ctx.fillStyle = pressed ? '#000000' : dim ? GREY : accent
        fitText(ctx, view.value, s - 12, 1, 28, 12)
        ctx.fillText(view.value, s / 2, view.label ? 32 : s / 2)
        if (view.label) {
            ctx.fillStyle = textColour
            const { size, lines } = fitText(ctx, view.label, s - 12, 2, 14)
            const lineH = size + 1
            const baseY = lines.length === 1 ? 68 : 62
            lines.forEach((l, i) => ctx.fillText(l, s / 2, baseY + i * lineH))
        }
    } else if (view.icon) {
        const iconSize = view.label ? 40 : 56
        const iy = view.label ? 10 : (s - iconSize) / 2
        ctx.drawImage(view.icon, (s - iconSize) / 2, iy, iconSize, iconSize)
        if (view.label) {
            const { size, lines } = fitText(ctx, view.label, s - 12, 2, 14)
            const lineH = size + 1
            const baseY = lines.length === 1 ? 68 : 62
            lines.forEach((l, i) => ctx.fillText(l, s / 2, baseY + i * lineH))
        }
    } else if (view.label) {
        const { size, lines } = fitText(ctx, view.label, s - 14, 3, 18)
        const lineH = size + 2
        const top = s / 2 - ((lines.length - 1) * lineH) / 2
        lines.forEach((l, i) => ctx.fillText(l, s / 2, top + i * lineH))
    }

    // Offline device: strike through the tile
    if (view.status === 'unavailable') {
        ctx.strokeStyle = GREY
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(14, s - 14)
        ctx.lineTo(s - 14, 14)
        ctx.stroke()
    }

    // Status badge, top-right corner
    if (view.status === 'error' || view.status === 'unknown') {
        ctx.beginPath()
        ctx.arc(s - 16, 16, 9, 0, Math.PI * 2)
        ctx.fillStyle = view.status === 'error' ? ERROR : GREY
        ctx.fill()
        ctx.fillStyle = TEXT
        ctx.font = 'bold 13px sans-serif'
        ctx.fillText(view.status === 'error' ? '!' : '?', s - 16, 17)
    }
    ctx.restore()
}

// A side strip, 60×270. Three 90 px slots line up with the three knobs on that
// side. Slots with a hint show the knob's label; if no hints at all, show `title`
// vertically instead. `message` (e.g. a config error) overrides everything.
export function drawStrip(
    ctx: any, w: number, h: number,
    opts: { hints: (KnobHint | undefined)[]; title?: string; titleColour?: string; message?: string; messageColour?: string },
) {
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const vertical = (text: string, colour: string) => {
        ctx.save()
        ctx.translate(w / 2, h / 2)
        ctx.rotate(-Math.PI / 2)
        const { lines, size } = fitText(ctx, text, h - 20, 2, 20, 11)
        ctx.fillStyle = colour
        const lineH = size + 2
        lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * lineH))
        ctx.restore()
    }

    if (opts.message) {
        ctx.fillStyle = shade(opts.messageColour ?? ERROR, 0.25)
        ctx.fillRect(0, 0, w, h)
        vertical(opts.message, TEXT)
        return
    }

    if (opts.hints.some(Boolean)) {
        opts.hints.forEach((hint, slot) => {
            if (!hint) return
            const top = slot * 90
            roundRect(ctx, 4, top + 6, w - 8, 78, 8)
            ctx.fillStyle = shade(hint.colour, 0.22)
            ctx.fill()
            ctx.fillStyle = TEXT
            const { size, lines } = fitText(ctx, hint.label, w - 14, hint.value ? 2 : 3, 12, 9)
            const lineH = size + 2
            const mid = top + (hint.value ? 32 : 45)
            lines.forEach((l, i) => ctx.fillText(l, w / 2, mid + (i - (lines.length - 1) / 2) * lineH))
            if (hint.value) {
                ctx.fillStyle = hint.colour
                fitText(ctx, hint.value, w - 12, 1, 16, 9)
                ctx.fillText(hint.value, w / 2, top + 62)
            }
        })
        return
    }

    if (opts.title) vertical(opts.title, opts.titleColour ?? TEXT)
}
