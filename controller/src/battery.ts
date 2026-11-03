// Battery levels for the EDDO OS wallpaper footer.
//   Logitech (G915 etc.): G HUB's local websocket on ws://localhost:9010 — the
//     same unofficial channel G HUB's own window uses, so a G HUB update could
//     change it. G HUB must be running.
//   Corsair (M65 etc.): the iCUE SDK. iCUE must be running with
//     Settings → General → "Enable SDK" switched on.
// Both are read-only: nothing here changes any device settings.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import WebSocket from 'ws'
import { log } from './log.ts'

const require = createRequire(import.meta.url)

export type Kind = 'keyboard' | 'mouse' | 'headset' | 'other'
export type Battery = { name: string, kind: Kind, percent: number, charging: boolean, source: 'ghub' | 'icue', at: number }

const levels = new Map<string, Battery>()
const STALE = 15 * 60e3

export function batteries(): Battery[] {
    const now = Date.now()
    return [...levels.values()].filter(b => now - b.at < STALE).sort((a, b) => a.kind.localeCompare(b.kind))
}

const kindOf = (t: unknown): Kind => {
    const s = String(t ?? '').toLowerCase()
    return s.includes('keyboard') ? 'keyboard' : s.includes('mouse') ? 'mouse' : s.includes('headset') ? 'headset' : 'other'
}

// ---------------------------------------------------------------- G HUB
function startGhub() {
    let ws: WebSocket | null = null
    let warned = false
    const names = new Map<string, { name: string, kind: Kind }>()
    const send = (verb: string, path: string) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ msgId: '', verb, path })) }

    const connect = () => {
        ws = new WebSocket('ws://localhost:9010', 'json', { origin: 'file://' })
        ws.on('open', () => {
            warned = false
            log('Battery: connected to G HUB')
            send('SUBSCRIBE', '/devices/state/changed')
            send('SUBSCRIBE', '/battery/state/changed')
            send('GET', '/devices/list')
        })
        ws.on('message', raw => {
            let m: { path?: string, payload?: any }
            try { m = JSON.parse(String(raw)) } catch { return }
            const path = m.path ?? '', p = m.payload ?? {}
            if (path === '/devices/list') {
                for (const d of p.deviceInfos ?? []) {
                    if (!d?.id || d.capabilities?.hasBatteryStatus === false) continue
                    names.set(d.id, { name: String(d.extendedDisplayName || d.displayName || d.id), kind: kindOf(d.deviceType) })
                    send('GET', `/battery/${d.id}/state`)
                }
            } else if (path === '/devices/state/changed') {
                send('GET', '/devices/list')
            } else if (path === '/battery/state/changed' || /^\/battery\/[^/]+\/state$/.test(path)) {
                if (!p.deviceId || typeof p.percentage !== 'number') return
                const n = names.get(p.deviceId) ?? { name: String(p.deviceId), kind: 'other' as Kind }
                levels.set('ghub:' + p.deviceId, { ...n, percent: Math.round(p.percentage), charging: !!p.charging, source: 'ghub', at: Date.now() })
            }
        })
        ws.on('error', () => { /* handled on close */ })
        ws.on('close', () => {
            if (!warned) { log('Battery: G HUB not reachable (is it running?) — retrying'); warned = true }
            ws = null
            setTimeout(connect, 30e3)
        })
    }
    connect()
    // ask again every few minutes in case a change event was missed
    setInterval(() => { for (const id of names.keys()) send('GET', `/battery/${id}/state`) }, 5 * 60e3)
}

// ---------------------------------------------------------------- iCUE
function startIcue() {
    let koffi: any, dll: string
    try { koffi = require('koffi') } catch { return log('Battery: Corsair support needs "npm install" (koffi missing)') }
    try { dll = join(dirname(require.resolve('cue-sdk/package.json')), 'prebuilds', 'win32-x64', 'iCUESDK.x64_2019.dll') }
    catch { return log('Battery: Corsair support needs "npm install" (cue-sdk missing)') }

    let lib: any
    try { lib = koffi.load(dll) } catch (err) { return log(`Battery: couldn't load the iCUE SDK: ${(err as Error).message}`) }
    // iCUE reports its connection state through a callback (called on another thread; koffi queues it to us)
    const OnState = koffi.proto('void CorsairSessionStateChangedHandler(void *context, void *eventData)')
    const connect = lib.func('int CorsairConnect(CorsairSessionStateChangedHandler *onStateChanged, void *context)')
    const getDevices = lib.func('int CorsairGetDevices(void *filter, int sizeMax, void *devices, void *size)')
    const readProperty = lib.func('int CorsairReadDeviceProperty(const char *deviceId, int propertyId, unsigned int index, void *property)')

    const MAX = 64, STR = 128
    const seen = new Set<string>()
    const INFO = 4 + STR * 3 + 4 + 4            // CorsairDeviceInfo: type, id, serial, model, ledCount, channelCount
    const CDPI_BatteryLevel = 9, CT_Int32 = 1
    const TYPES: Record<number, Kind> = { 1: 'keyboard', 2: 'mouse', 8: 'headset' }
    const cstr = (b: Buffer, off: number) => { const end = b.indexOf(0, off); return b.toString('utf8', off, end < 0 || end > off + STR ? off + STR : end) }

    const STATES = ['invalid', 'closed', 'connecting', 'timeout', 'no server', 'server version too old', 'connected']
    let state = 0
    const onState = koffi.register((_ctx: unknown, data: unknown) => {
        const next = koffi.decode(data, 'int') as number
        if (next !== state) log(`Battery: iCUE ${STATES[next] ?? next}`)
        state = next
        if (state === 6) setTimeout(poll, 500)
    }, koffi.pointer(OnState))
    const started = connect(onState, null)
    if (started !== 0) log(`Battery: iCUE connect failed (error ${started})`)
    let warned = false
    const poll = () => {
        if (state !== 6) return                                       // not connected yet; the SDK keeps retrying itself
        const filter = Buffer.alloc(4); filter.writeInt32LE(-1)        // CDT_All
        const devs = Buffer.alloc(INFO * MAX), size = Buffer.alloc(4)
        const err = getDevices(filter, MAX, devs, size)
        if (err !== 0) {
            if (!warned) { log(`Battery: couldn't list iCUE devices (error ${err})`); warned = true }
            return
        }
        warned = false
        for (let i = 0; i < size.readInt32LE(0); i++) {
            const off = i * INFO
            const type = devs.readInt32LE(off), id = cstr(devs, off + 4), model = cstr(devs, off + 4 + STR * 2)
            const prop = Buffer.alloc(24)                               // CorsairProperty: type + 8-byte aligned union
            const e = readProperty(id, CDPI_BatteryLevel, 0, prop)
            if (e !== 0 || prop.readInt32LE(0) !== CT_Int32) { if (!seen.has(id)) log(`Battery: iCUE "${model}" has no battery reading (error ${e})`); seen.add(id); continue }
            if (!seen.has(id)) log(`Battery: iCUE "${model}" ${prop.readInt32LE(8)}%`)
            seen.add(id)
            levels.set('icue:' + id, { name: model, kind: TYPES[type] ?? 'other', percent: prop.readInt32LE(8), charging: false, source: 'icue', at: Date.now() })
        }
    }
    setTimeout(poll, 4e3)
    setInterval(poll, 60e3)
}

export function startBatteries() {
    try { startGhub() } catch (err) { log(`Battery: G HUB reader failed: ${(err as Error).message}`) }
    try { startIcue() } catch (err) { log(`Battery: iCUE reader failed: ${(err as Error).message}`) }
}
