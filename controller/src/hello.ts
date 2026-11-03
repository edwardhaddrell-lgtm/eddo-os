// Phase 1: "Hello device".
// Connects to the Loupedeck Live, labels every key and strip, lights each round
// button a different colour, and logs every input event with its ID to the
// console and to logs/hello-events.log.

import { appendFileSync, mkdirSync } from 'node:fs'
import { discover, HAPTIC } from 'loupedeck'

const LOG_FILE = 'logs/hello-events.log'
mkdirSync('logs', { recursive: true })

function log(msg: string) {
    const line = `${new Date().toISOString()}  ${msg}`
    console.log(line)
    appendFileSync(LOG_FILE, line + '\n')
}

// One colour per round button 0–7.
const BUTTON_COLOURS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

function drawKeyLabel(device: any, index: number, highlight = false) {
    return device.drawKey(index, (ctx: any, w: number, h: number) => {
        ctx.fillStyle = highlight ? '#ffffff' : '#111827'
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = BUTTON_COLOURS[index % BUTTON_COLOURS.length]
        ctx.lineWidth = 4
        ctx.strokeRect(2, 2, w - 4, h - 4)
        ctx.fillStyle = highlight ? '#111827' : '#ffffff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = 'bold 34px sans-serif'
        ctx.fillText(String(index), w / 2, h / 2 - 8)
        ctx.font = '14px sans-serif'
        ctx.fillText(`key ${index}`, w / 2, h - 18)
    })
}

function drawStrip(device: any, id: 'left' | 'right', touchY?: number) {
    return device.drawScreen(id, (ctx: any, w: number, h: number) => {
        ctx.fillStyle = '#1f2937'
        ctx.fillRect(0, 0, w, h)
        if (touchY !== undefined) {
            ctx.fillStyle = '#3b82f6'
            ctx.fillRect(0, Math.max(0, touchY - 10), w, 20)
        }
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = 'bold 16px sans-serif'
        ctx.fillText(id.toUpperCase(), w / 2, h / 2)
    })
}

async function paintAll(device: any) {
    await device.setBrightness(0.8)
    for (let i = 0; i < 12; i++) await drawKeyLabel(device, i)
    await drawStrip(device, 'left')
    await drawStrip(device, 'right')
    for (let id = 0; id < 8; id++) await device.setButtonColor({ id, color: BUTTON_COLOURS[id] })
}

log('Looking for a Loupedeck...')
const device = await discover()

// If the previous session wasn't closed cleanly, the device ignores the
// handshake until it is power-cycled. Say so rather than hang silently.
const handshakeWatchdog = setTimeout(() => {
    log('No handshake reply after 5 s. Unplug the Loupedeck USB cable, plug it back in, then run again.')
}, 5000)

device.on('connect', async (info: any) => {
    clearTimeout(handshakeWatchdog)
    log(`CONNECT ${device.type} ${JSON.stringify(info)}`)
    try {
        const { serial, version } = await device.getInfo()
        log(`INFO serial=${serial} firmware=${version}`)
        await paintAll(device)
        log('Painted keys, strips and button LEDs. Press, turn and touch things. Ctrl+C to quit.')
    } catch (err) {
        log(`ERROR painting: ${(err as Error).message}`)
    }
})

device.on('disconnect', (err: Error | undefined) => {
    log(`DISCONNECT ${err ? err.message : '(clean)'}`)
})

device.on('down', ({ id }: { id: number | string }) => log(`DOWN    id=${id}`))
device.on('up', ({ id }: { id: number | string }) => log(`UP      id=${id}`))
device.on('rotate', ({ id, delta }: { id: string; delta: number }) => log(`ROTATE  id=${id} delta=${delta}`))

for (const evt of ['touchstart', 'touchmove', 'touchend'] as const) {
    device.on(evt, ({ changedTouches }: any) => {
        for (const t of changedTouches) {
            // touchmove is noisy; only log the strips for it (useful for sliders)
            if (evt === 'touchmove' && t.target.screen === 'center') continue
            log(`${evt.toUpperCase().padEnd(10)} screen=${t.target.screen} key=${t.target.key ?? '-'} x=${t.x} y=${t.y} touchId=${t.id}`)

            if (t.target.screen === 'center' && t.target.key !== undefined) {
                if (evt === 'touchstart') {
                    drawKeyLabel(device, t.target.key, true)
                    device.vibrate(HAPTIC.SHORT)
                } else if (evt === 'touchend') {
                    drawKeyLabel(device, t.target.key, false)
                }
            } else if (t.target.screen === 'left' || t.target.screen === 'right') {
                drawStrip(device, t.target.screen, evt === 'touchend' ? undefined : t.y)
            }
        }
    })
}

process.on('SIGINT', async () => {
    log('Shutting down: LEDs off.')
    try {
        for (let id = 0; id < 8; id++) await device.setButtonColor({ id, color: '#000000' })
    } catch {}
    await device.close()
    process.exit(0)
})
