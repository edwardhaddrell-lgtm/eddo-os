// Local bridge for the EDDO OS wallpaper (Wallpaper Engine can't open a Chrome
// tab itself). Listens on 127.0.0.1 only, so nothing else on the network can
// reach it. Only http(s) links (opened in Chrome) and steam:// links are accepted.
//
//   GET http://127.0.0.1:47290/open?url=http%3A%2F%2Feddo-nas%2F   → new Chrome tab
//   GET http://127.0.0.1:47290/ping                                → "ok"

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.ts'
import { systemActions } from './actions/system.ts'
import { isBusy, listen, stopListening, voice } from './voice.ts'
import { batteries, startBatteries } from './battery.ts'
import { pcStats, startPcStats } from './pcstats.ts'

export const BRIDGE_PORT = 47290

// Secret key: every request must start with /k/<key>/. Web pages open in a browser
// on this PC can reach 127.0.0.1 too, but they can't know the key, so they're refused.
// The key is made once, kept in bridge-key.txt, and handed to the wallpaper by writing
// assets/bridge-key.js into its folder (EDDO_WALLPAPER_DIR in .env to override).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEY_FILE = join(ROOT, 'bridge-key.txt')
const WALLPAPER_DIR = process.env.EDDO_WALLPAPER_DIR || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\projects\\myprojects\\EDDO OS'
function loadKey(): string {
    try { const k = readFileSync(KEY_FILE, 'utf8').trim(); if (/^[a-f0-9]{32,}$/.test(k)) return k } catch { /* make one */ }
    const k = randomBytes(24).toString('hex')
    writeFileSync(KEY_FILE, k + '\n')
    log('Bridge: created a new key in bridge-key.txt')
    return k
}
const KEY = loadKey()
function shareKey() {
    const file = join(WALLPAPER_DIR, 'assets', 'bridge-key.js')
    const body = `window.EDDO_BRIDGE_KEY = "${KEY}";\n`
    try {
        if (!existsSync(dirname(file))) return log(`Bridge: wallpaper folder not found (${WALLPAPER_DIR}); set EDDO_WALLPAPER_DIR in .env`)
        if (existsSync(file) && readFileSync(file, 'utf8') === body) return
        writeFileSync(file, body)
        log('Bridge: key written to the wallpaper (reload it once)')
    } catch (err) { log(`Bridge: couldn't write the key to the wallpaper: ${(err as Error).message}`) }
}
function keyOk(given: string) {
    const a = Buffer.from(given), b = Buffer.from(KEY)
    return a.length === b.length && timingSafeEqual(a, b)
}

export function startBridge() {
    const server = createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${BRIDGE_PORT}`)
        const m = /^\/k\/([^/]+)(\/.*)$/.exec(url.pathname)
        if (!m || !keyOk(m[1])) { res.statusCode = 403; return void res.end('missing or wrong key') }
        url.pathname = m[2]
        try {
            if (url.pathname === '/ping') return void res.end('ok')
            // keyboard / mouse battery levels for the wallpaper footer
            if (url.pathname === '/pc') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
                return void res.end(JSON.stringify(pcStats()))
            }
            if (url.pathname === '/battery') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
                return void res.end(JSON.stringify(batteries()))
            }
            // Jarvis push-to-talk: start, stop early, and a live event stream
            if (url.pathname === '/jarvis/listen') {
                if (isBusy()) { res.statusCode = 409; return void res.end('busy') }
                listen(url.searchParams.get('pipeline') || undefined, url.searchParams.get('conversation_id') || undefined)
                    .then(() => res.end('ok'), err => { res.statusCode = 500; res.end((err as Error).message) })
                return
            }
            // Jarvis speech audio, relayed so the wallpaper can draw a waveform.
            // Only Home Assistant text-to-speech files are allowed through.
            if (url.pathname === '/proxy') {
                const target = new URL(url.searchParams.get('url') ?? '')
                if (!/^https?:$/.test(target.protocol) || !target.pathname.startsWith('/api/tts_proxy/')) throw new Error('only HA text-to-speech audio')
                fetch(target).then(async r => {
                    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'audio/mpeg', 'Access-Control-Allow-Origin': '*' })
                    res.end(Buffer.from(await r.arrayBuffer()))
                }, err => { res.statusCode = 502; res.end((err as Error).message) })
                return
            }
            // Camera live view (HLS) relayed from Home Assistant, which doesn't allow the
            // wallpaper to fetch it directly. Only HA's stream files are allowed through;
            // their URLs carry a short-lived token of their own.
            if (url.pathname.startsWith('/ha/api/hls/')) {
                const base = (process.env.HA_URL || 'http://192.168.4.81:8123').replace(/\/+$/, '')
                fetch(base + url.pathname.slice(3) + url.search).then(async r => {
                    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
                    res.end(Buffer.from(await r.arrayBuffer()))
                }, err => { res.statusCode = 502; res.end((err as Error).message) })
                return
            }
            // OPEN FILES button: a new File Explorer window. Takes no path, so a web page
            // can't use it to open or run anything else.
            if (url.pathname === '/files') {
                log('Bridge: open File Explorer')
                spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref()
                return void res.end('ok')
            }
            if (url.pathname === '/jarvis/stop') { stopListening(); return void res.end('ok') }
            if (url.pathname === '/jarvis/events') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' })
                res.write(': connected\n\n')
                const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`)
                const ping = setInterval(() => res.write(': ping\n\n'), 15000)
                voice.on('event', send)
                req.on('close', () => { clearInterval(ping); voice.off('event', send) })
                return
            }
            if (url.pathname === '/open') {
                const target = url.searchParams.get('url') ?? ''
                if (/^steam:\/\//i.test(target)) {
                    // Steam links go to Windows' registered handler (the Steam client)
                    log(`Bridge: steam ${target}`)
                    systemActions['system.url'].run({ url: target }, undefined as never, {})
                    return void res.end('ok')
                }
                if (!/^https?:\/\//i.test(target)) throw new Error('only http(s) and steam:// links')
                log(`Bridge: open ${target}`)
                systemActions['system.url'].run({ url: target, browser: 'chrome' }, undefined as never, {})
                return void res.end('ok')
            }
            res.statusCode = 404
            res.end('not found')
        } catch (err) {
            res.statusCode = 400
            res.end((err as Error).message)
        }
    })
    server.on('error', err => log(`Bridge not started: ${(err as Error).message}`))
    shareKey()
    startBatteries()
    startPcStats()
    server.listen(BRIDGE_PORT, '127.0.0.1', () => log(`Bridge listening on 127.0.0.1:${BRIDGE_PORT} (EDDO OS wallpaper).`))
}
