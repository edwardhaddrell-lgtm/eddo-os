// PC stats for the EDDO OS wallpaper's "EDDO-PC" panel.
//   CPU load and RAM: from Windows via Node.
//   GPU: nvidia-smi (ships with the NVIDIA driver).
//   CPU temperature and coolant temperature: iCUE's Sensor Logging CSV (Settings →
//     Sensor Logging, saved into the controller's icue-log folder), or
//     LibreHardwareMonitor's
//     web server (Options → Remote Web Server → Run, port 8085). Windows doesn't
//     expose these without a hardware-monitor driver.
// Read-only.

import os from 'node:os'
import { execFile } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './log.ts'

export type PcStats = {
    cpu: number | null, ram: number | null, ramUsedGb: number | null, ramTotalGb: number | null,
    gpu: number | null, gpuTemp: number | null, vram: number | null, gpuWatts: number | null, gpuName: string,
    cpuTemp: number | null, coolant: number | null, at: number,
}

const stats: PcStats = { cpu: null, ram: null, ramUsedGb: null, ramTotalGb: null, gpu: null, gpuTemp: null, vram: null, gpuWatts: null, gpuName: '', cpuTemp: null, coolant: null, at: 0 }
export const pcStats = () => stats

let prev = os.cpus()
function cpuLoad() {
    const now = os.cpus()
    let idle = 0, total = 0
    now.forEach((c, i) => {
        const p = prev[i]?.times; if (!p) return
        const t = c.times
        const d = { user: t.user - p.user, nice: t.nice - p.nice, sys: t.sys - p.sys, idle: t.idle - p.idle, irq: t.irq - p.irq }
        idle += d.idle; total += d.user + d.nice + d.sys + d.idle + d.irq
    })
    prev = now
    return total > 0 ? Math.round(100 * (1 - idle / total)) : null
}

const num = (s: string) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }
let gpuWarned = false
function readGpu() {
    execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw', '--format=csv,noheader,nounits'],
        { timeout: 4000, windowsHide: true }, (err, out) => {
            if (err) { if (!gpuWarned) { log(`PC stats: nvidia-smi unavailable (${err.message})`); gpuWarned = true } return }
            const [name, util, temp, used, total, watts] = String(out).split('\n')[0].split(',').map(s => s.trim())
            stats.gpuName = name || ''
            stats.gpu = num(util); stats.gpuTemp = num(temp); stats.gpuWatts = num(watts)
            const u = num(used), t = num(total)
            stats.vram = u != null && t ? Math.round(100 * u / t) : null
        })
}

// LibreHardwareMonitor: walk its sensor tree for the CPU temperature and a coolant/liquid sensor.
type Node = { Text?: string, Value?: string, Type?: string, Children?: Node[] }
let lhmSeen = false
let lhm = { cpuTemp: null as number | null, coolant: null as number | null }
async function readLhm() {
    let root: Node
    try {
        const r = await fetch('http://localhost:8085/data.json', { signal: AbortSignal.timeout(2000) })
        root = await r.json() as Node
    } catch { lhm = { cpuTemp: null, coolant: null }; return }
    if (!lhmSeen) { log('PC stats: reading temperatures from LibreHardwareMonitor'); lhmSeen = true }
    const temps: { path: string, text: string, value: number }[] = []
    const walk = (n: Node, path: string) => {
        const here = path + ' / ' + (n.Text ?? '')
        if (!n.Children?.length && /°C/.test(n.Value ?? '')) { const v = num(n.Value!); if (v != null) temps.push({ path: here.toLowerCase(), text: (n.Text ?? '').toLowerCase(), value: v }) }
        for (const c of n.Children ?? []) walk(c, here)
    }
    walk(root, '')
    const cpu = temps.find(t => /tctl|tdie/.test(t.text)) ?? temps.find(t => /cpu package|core \(tctl/.test(t.text)) ?? temps.find(t => /ryzen|intel core/.test(t.path) && /package|cpu/.test(t.text))
    const coolant = temps.find(t => /coolant|liquid|water/.test(t.text))
    lhm = { cpuTemp: cpu ? Math.round(cpu.value * 10) / 10 : null, coolant: coolant ? Math.round(coolant.value * 10) / 10 : null }
}

// iCUE Sensor Logging: read the header and the newest line of the newest CSV.
const ICUE_DIR = process.env.ICUE_LOG_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'icue-log')
try { if (!existsSync(ICUE_DIR)) mkdirSync(ICUE_DIR, { recursive: true }) } catch { /* optional */ }
let icueSeen = '', fromIcue = { cpuTemp: null as number | null, coolant: null as number | null }
function readText(file: string, start: number, len: number) {
    const fd = openSync(file, 'r')
    try { const b = Buffer.alloc(len); const n = readSync(fd, b, 0, len, start); return b.subarray(0, n) } finally { closeSync(fd) }
}
const decode = (b: Buffer) => (b.length > 1 && (b[0] === 0xff || b[1] === 0) ? b.toString('utf16le') : b.toString('utf8')).replace(/^\uFEFF/, '')
function readIcue() {
    fromIcue = { cpuTemp: null, coolant: null }
    let files: { f: string, m: number, size: number }[]
    try { files = readdirSync(ICUE_DIR).filter(f => /\.csv$/i.test(f)).map(f => { const st = statSync(join(ICUE_DIR, f)); return { f: join(ICUE_DIR, f), m: st.mtimeMs, size: st.size } }) } catch { return }
    const latest = files.sort((a, b) => b.m - a.m)[0]
    if (!latest || Date.now() - latest.m > 60e3) return                 // logging stopped
    const head = decode(readText(latest.f, 0, 8192)).split(/\r?\n/)[0]
    const tail = decode(readText(latest.f, Math.max(0, latest.size - 8192), Math.min(8192, latest.size))).split(/\r?\n/).filter(l => l.trim())
    const last = tail[tail.length - 1]; if (!head || !last || last === head) return
    const sep = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ','
    const cols = head.split(sep).map(c => c.replace(/"/g, '').trim()), vals = last.split(sep).map(v => v.replace(/"/g, '').trim())
    const val = (re: RegExp) => { const i = cols.findIndex(c => re.test(c)); if (i < 0) return null; const v = parseFloat(String(vals[i]).replace(',', '.')); return Number.isFinite(v) ? v : null }
    fromIcue.coolant = val(/coolant|liquid/i)
    fromIcue.cpuTemp = val(/package.*(°|temp|\bc\b)|cpu.*temp|tctl|tdie/i) ?? val(/package/i)
    if (latest.f !== icueSeen) { icueSeen = latest.f; log(`PC stats: reading iCUE log ${latest.f} (coolant ${fromIcue.coolant ?? 'not found'}, CPU ${fromIcue.cpuTemp ?? 'not found'})`) }
}

function tick() {
    stats.cpu = cpuLoad()
    const total = os.totalmem(), free = os.freemem()
    stats.ram = Math.round(100 * (total - free) / total)
    stats.ramUsedGb = Math.round((total - free) / 1e8) / 10
    stats.ramTotalGb = Math.round(total / 1e9)
    try { readIcue() } catch { fromIcue = { cpuTemp: null, coolant: null } }
    stats.cpuTemp = fromIcue.cpuTemp ?? lhm.cpuTemp
    stats.coolant = fromIcue.coolant ?? lhm.coolant
    stats.at = Date.now()
}

export function startPcStats() {
    tick(); readGpu(); readLhm()
    setInterval(tick, 3000)
    setInterval(readGpu, 5000)
    setInterval(() => { readLhm().catch(() => {}) }, 5000)
}
