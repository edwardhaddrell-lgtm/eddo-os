// Wraps the foxxyz Loupedeck device: finds it (waiting if unplugged), reconnects,
// and turns raw button/knob/touch events into simple normalised events.

import { EventEmitter } from 'node:events'
import { discover, HAPTIC } from 'loupedeck'
import './unstick.ts'
import { debug, log } from '../log.ts'
import type { KnobId } from '../config.ts'

export type DeckEvents = {
    ready: []
    lost: []
    button: [id: number]
    knobTurn: [id: KnobId, delta: number]
    knobPress: [id: KnobId]
    keyDown: [key: number]
    // cancelled = finger slid off the key before lifting
    keyUp: [key: number, cancelled: boolean]
    strip: [side: 'left' | 'right', y: number, phase: 'start' | 'move' | 'end']
}

// The library console.errors on every failed reconnect attempt. We report
// those failures ourselves (once, with advice), so send its lines to debug.
const consoleError = console.error
console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Loupedeck Serial Error')) debug(args.join(' '))
    else consoleError(...args)
}

const DISCOVER_RETRY_MS = 3000
const HANDSHAKE_TIMEOUT_MS = 8000

export class Deck extends EventEmitter<DeckEvents> {
    private device: any
    private touchStartKey = new Map<number, { key: number; cancelled: boolean }>()
    private watchdog?: NodeJS.Timeout
    private warnedBusy = false
    connected = false
    closing = false

    async start() {
        let warned = false
        while (!this.device && !this.closing) {
            try {
                this.device = await discover()
            } catch (err) {
                if (!warned) log(`Waiting for Loupedeck (${(err as Error).message}). Is it plugged in, with the Loupedeck app closed?`)
                warned = true
                await new Promise(r => setTimeout(r, DISCOVER_RETRY_MS))
            }
        }
        if (!this.device) return
        this.armWatchdog()
        this.wire()
    }

    // If the last session wasn't closed cleanly the device ignores handshakes
    // until it's power-cycled. Tell the user instead of hanging silently.
    private armWatchdog() {
        clearTimeout(this.watchdog)
        this.watchdog = setTimeout(() => {
            if (!this.connected && !this.closing) {
                log('Loupedeck not answering. Unplug its USB cable, plug it back in, and it will reconnect automatically.')
            }
        }, HANDSHAKE_TIMEOUT_MS)
    }

    private wire() {
        const d = this.device

        d.on('connect', async (info: unknown) => {
            clearTimeout(this.watchdog)
            this.connected = true
            this.warnedBusy = false
            this.touchStartKey.clear()
            try {
                const { serial, version } = await d.getInfo()
                log(`Connected: ${d.type} serial=${serial} firmware=${version} ${JSON.stringify(info)}`)
            } catch {
                log(`Connected: ${d.type}`)
            }
            this.emit('ready')
        })

        d.on('disconnect', (err?: Error) => {
            const was = this.connected
            this.connected = false
            if (this.closing) return
            if (!was && err?.message.includes('Access denied') && !this.warnedBusy) {
                this.warnedBusy = true
                log('The Loupedeck port is in use by another program: the Loupedeck app, or another copy of this one (e.g. `npm run hello`). Close it and this will connect by itself.')
            }
            if (was) log(`Device disconnected${err ? `: ${err.message}` : ''}. Will reconnect.`)
            this.armWatchdog()
            if (was) this.emit('lost')
        })

        d.on('down', ({ id }: { id: number | string }) => {
            debug(`down ${id}`)
            if (typeof id === 'number') this.emit('button', id)
            else if (id.startsWith('knob')) this.emit('knobPress', id as KnobId)
        })

        d.on('rotate', ({ id, delta }: { id: KnobId; delta: number }) => {
            debug(`rotate ${id} ${delta}`)
            this.emit('knobTurn', id, delta)
        })

        for (const evt of ['touchstart', 'touchmove', 'touchend'] as const) {
            d.on(evt, ({ changedTouches }: any) => {
                for (const t of changedTouches) this.onTouch(evt, t)
            })
        }
    }

    private onTouch(evt: 'touchstart' | 'touchmove' | 'touchend', t: any) {
        const { screen, key } = t.target as { screen: string; key?: number }
        if (evt !== 'touchmove') debug(`${evt} ${screen} key=${key ?? '-'} x=${t.x} y=${t.y}`)

        if (screen === 'left' || screen === 'right') {
            this.emit('strip', screen, t.y, evt === 'touchstart' ? 'start' : evt === 'touchend' ? 'end' : 'move')
        }

        const start = this.touchStartKey.get(t.id)
        if (evt === 'touchstart') {
            if (screen === 'center' && key !== undefined) {
                this.touchStartKey.set(t.id, { key, cancelled: false })
                this.emit('keyDown', key)
            }
        } else if (evt === 'touchmove') {
            if (start && (screen !== 'center' || key !== start.key)) start.cancelled = true
        } else {
            if (start) {
                const cancelled = start.cancelled || screen !== 'center' || key !== start.key
                this.touchStartKey.delete(t.id)
                this.emit('keyUp', start.key, cancelled)
            }
        }
    }

    // Drawing / output. All are no-ops while disconnected.
    drawKey(index: number, cb: (ctx: any, w: number, h: number) => void) {
        if (this.connected) return this.device.drawKey(index, cb)
    }
    drawScreen(id: 'left' | 'center' | 'right', cb: (ctx: any, w: number, h: number) => void) {
        if (this.connected) return this.device.drawScreen(id, cb)
    }
    setButtonColor(id: number, color: string) {
        if (this.connected) return this.device.setButtonColor({ id, color })
    }
    setBrightness(value: number) {
        if (this.connected) return this.device.setBrightness(value)
    }
    vibrate(pattern: keyof typeof HAPTIC = 'SHORT') {
        if (this.connected) return this.device.vibrate(HAPTIC[pattern])
    }

    // Blank everything and close the session cleanly so the next start can connect
    // without a replug.
    async close() {
        this.closing = true
        clearTimeout(this.watchdog)
        if (!this.device) return
        if (this.connected) {
            try {
                for (let id = 0; id < 8; id++) await this.device.setButtonColor({ id, color: '#000000' })
                for (const id of ['left', 'center', 'right']) {
                    await this.device.drawScreen(id, (ctx: any, w: number, h: number) => {
                        ctx.fillStyle = '#000000'
                        ctx.fillRect(0, 0, w, h)
                    })
                }
            } catch {}
        }
        try {
            await this.device.close()
        } catch {}
    }
}
