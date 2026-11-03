// Generates assets/app.ico (used by the Start menu and Startup shortcuts):
// the tray icon design at several sizes, stored as PNGs inside an .ico.
// Run: npx tsx scripts/make-icon.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from 'canvas'

const sizes = [16, 24, 32, 48, 64, 256]
const svg = readFileSync('assets/icons/rooms.svg', 'utf8').replace(/currentColor/g, '#ffffff')
const glyph = await loadImage(Buffer.from(svg))

const pngs = sizes.map(size => {
    const canvas = createCanvas(size, size)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#3b82f6'
    ctx.beginPath()
    ctx.roundRect(size * 0.03, size * 0.03, size * 0.94, size * 0.94, size * 0.22)
    ctx.fill()
    const pad = size * 0.16
    ctx.drawImage(glyph, pad, pad, size - pad * 2, size - pad * 2)
    return canvas.toBuffer('image/png')
})

// ICO = 6-byte header + 16-byte entry per image + image data
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const entries = sizes.map((size, i) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4)  // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8)
    e.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    return e
})
writeFileSync('assets/app.ico', Buffer.concat([header, ...entries, ...pngs]))
console.log('Wrote assets/app.ico')
