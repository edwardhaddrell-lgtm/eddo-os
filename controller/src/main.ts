// Entry point: load config, connect to the deck, run the page engine,
// hot-reload config/deck.yaml on save, and show a tray icon.
//
// Exit codes (read by scripts/run.ps1): 0 = quit, 3 = another copy is already
// running, 75 = restart requested, anything else = crash (restarted).

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { ConfigError, loadConfig } from './config.ts'
import { Deck } from './device/deck.ts'
import { PageEngine } from './pages/engine.ts'
import { clearIconCache } from './render/icons.ts'
import { log } from './log.ts'
import { startWindowsPolling } from './state/windows.ts'
import { ha, startHomeAssistant } from './ha/client.ts'
import { setTrayStatus, startTray } from './tray.ts'
import { startBridge } from './bridge.ts'

const CONFIG_DIR = 'config'
const CONFIG_FILE = 'deck.yaml'
const CONFIG_PATH = `${CONFIG_DIR}/${CONFIG_FILE}`
const PID_FILE = 'logs/deck.pid'
const EXIT_ALREADY_RUNNING = 3
const EXIT_RESTART = 75

// ---- single instance ---------------------------------------------------------

function isRunning(pid: number) {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

if (existsSync(PID_FILE)) {
    const other = Number(readFileSync(PID_FILE, 'utf8'))
    if (other && other !== process.pid && isRunning(other)) {
        log(`Already running (process ${other}); use the tray icon to restart or quit it.`)
        process.exit(EXIT_ALREADY_RUNNING)
    }
}
writeFileSync(PID_FILE, String(process.pid))

// ---- config ------------------------------------------------------------------

function load() {
    try {
        return loadConfig(CONFIG_PATH)
    } catch (err) {
        log(err instanceof ConfigError ? err.message : `Config failed: ${(err as Error).message}`)
        return undefined
    }
}

const initial = load()
if (!initial) {
    log(`Fix ${CONFIG_PATH} and start again.`)
    rmSync(PID_FILE, { force: true })
    process.exit(1)
}
log(`Loaded ${CONFIG_PATH}: ${initial.pages.size} pages, start page "${initial.startPage}".`)

const deck = new Deck()
const engine = new PageEngine(deck)
engine.setConfig(initial)

function reload() {
    const next = load()
    if (!next) {
        log('Keeping the previous config until the file is fixed.')
        engine.setConfigError('config error')
        return
    }
    clearIconCache()
    log(`Reloaded ${CONFIG_PATH}.`)
    engine.setConfig(next)
}

// Hot reload. Editors often fire several events per save, so debounce.
let reloadTimer: NodeJS.Timeout | undefined
watch(CONFIG_DIR, (_event, filename) => {
    if (filename !== CONFIG_FILE) return
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(reload, 250)
})

// ---- shutdown ----------------------------------------------------------------

// Always close the device session cleanly; otherwise it needs a USB replug.
let shuttingDown = false
async function shutdown(reason: string, code = 0) {
    if (shuttingDown) return
    shuttingDown = true
    log(`${reason}: shutting down.`)
    const force = setTimeout(() => process.exit(code), 3000)
    ha.stop()
    await deck.close()
    clearTimeout(force)
    rmSync(PID_FILE, { force: true })
    process.exit(code)
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(sig, () => shutdown(sig))

// ---- tray --------------------------------------------------------------------

function updateTray() {
    setTrayStatus({
        device: deck.connected ? 'connected' : 'waiting for device',
        ha: ha.connected ? 'connected' : 'disconnected',
    })
}
deck.on('ready', updateTray)
deck.on('lost', updateTray)
ha.on('status', updateTray)
updateTray()

const open = (file: string) => spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' }).unref()

await startTray(cmd => {
    log(`Tray: ${cmd}`)
    if (cmd === 'reload') reload()
    else if (cmd === 'config') open(CONFIG_PATH)
    else if (cmd === 'log') open('logs/deck.log')
    else if (cmd === 'restart') shutdown('Restart requested', EXIT_RESTART)
    else if (cmd === 'quit') shutdown('Quit from tray')
})

// ---- go ----------------------------------------------------------------------

log('Starting. Ctrl+C or the tray icon to quit.')
startWindowsPolling()
startHomeAssistant()
startBridge()
await deck.start()
