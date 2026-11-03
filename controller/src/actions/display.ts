// Monitor control via MultiMonitorTool. Monitors are identified by their
// "Short Monitor ID" (e.g. AUS32F2), never by display number.
//
// After every change we re-read the monitor state and fail loudly if nothing
// happened: on Windows 11 24H2 MultiMonitorTool sometimes silently does nothing
// until display settings are opened or a monitor is replugged.

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runTool } from '../tools.ts'
import { readMonitors, refreshMonitors } from '../state/windows.ts'
import { store, type Monitor } from '../state/store.ts'
import { str, type ActionDef } from './index.ts'

const VERIFY_TIMEOUT_MS = 6000
const QUIRK_HINT = 'Windows ignored the display change. Open Settings → System → Display once (or replug a monitor), then try again.'

let busy = false

// Windows' built-in display switcher. `/extend` re-enables every monitor using
// Windows' remembered extended layout (positions, refresh rate, primary).
function displaySwitch(mode: '/extend' | '/clone' | '/internal' | '/external') {
    return new Promise<void>((resolve, reject) => {
        execFile(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'DisplaySwitch.exe'), [mode], { timeout: 10000 }, err =>
            err && typeof err.code !== 'number' ? reject(err) : resolve())
    })
}

async function change(command: string[] | (() => Promise<void>), done: (monitors: Monitor[]) => boolean) {
    if (busy) return
    busy = true
    try {
        if (typeof command === 'function') await command()
        else await runTool('mmt', command, 15000)
        const deadline = Date.now() + VERIFY_TIMEOUT_MS
        while (Date.now() < deadline) {
            const monitors = await readMonitors()
            store.set('monitors', monitors)
            if (done(monitors)) return
            await new Promise(r => setTimeout(r, 500))
        }
        throw new Error(QUIRK_HINT)
    } finally {
        busy = false
        refreshMonitors().catch(() => {})
    }
}

const monitor = (id: string) => store.get('monitors')?.find(m => m.id === id)

// Short monitor IDs listed in a MultiMonitorTool /SaveConfig file
const layoutCache = new Map<string, string[]>()
function layoutMonitors(file: string) {
    let ids = layoutCache.get(file)
    if (!ids) {
        ids = [...readFileSync(file, 'utf8').matchAll(/^MonitorID=MONITOR\\([^\\]+)\\/gm)].map(m => m[1])
        layoutCache.set(file, ids)
    }
    return ids
}

export const displayActions: Record<string, ActionDef> = {
    // { action: display.extend, primary?: AUS32F2 }
    // Turns all monitors back on in Windows' remembered extended layout. If
    // `primary` is given and Windows picked a different main screen, fix it.
    // (MultiMonitorTool /enable and /LoadConfig can't re-enable a monitor it
    // disabled on this PC; DisplaySwitch can.)
    'display.extend': {
        run: async params => {
            await change(() => displaySwitch('/extend'), ms => ms.length > 1 && ms.every(m => m.active))
            const primary = typeof params.primary === 'string' ? params.primary : undefined
            if (primary && !monitor(primary)?.primary) {
                await change(['/SetPrimary', primary], ms => ms.find(m => m.id === primary)?.primary === true)
            }
        },
        state: () => {
            const ms = store.get('monitors') ?? []
            return { active: ms.length > 1 && ms.every(m => m.active) }
        },
    },

    // { action: display.layout, file: config/monitors-extend.cfg }
    // Restores a layout saved with: tools\MultiMonitorTool.exe /SaveConfig <file>
    'display.layout': {
        run: params => {
            const file = str(params, 'file', 'display.layout')
            const ids = layoutMonitors(file)
            return change(['/LoadConfig', file], ms => ids.every(id => ms.find(m => m.id === id)?.active))
        },
        state: params => {
            try {
                const ids = layoutMonitors(str(params, 'file', 'display.layout'))
                return { active: ids.every(id => monitor(id)?.active) }
            } catch {
                return undefined
            }
        },
    },

    // { action: display.disable, monitor: AUS32F2 } — turn one monitor off
    'display.disable': {
        run: params => {
            const id = str(params, 'monitor', 'display.disable')
            return change(['/disable', id], ms => ms.find(m => m.id === id)?.active === false || !ms.find(m => m.id === id))
        },
        state: params => ({ active: monitor(String(params.monitor))?.active === false }),
    },

    // { action: display.enable, monitor: AUS32F2 }
    'display.enable': {
        run: params => {
            const id = str(params, 'monitor', 'display.enable')
            return change(['/enable', id], ms => ms.find(m => m.id === id)?.active === true)
        },
        state: params => ({ active: monitor(String(params.monitor))?.active === true }),
    },

    // { action: display.primary, monitor: DEL4188 }
    'display.primary': {
        run: params => {
            const id = str(params, 'monitor', 'display.primary')
            return change(['/SetPrimary', id], ms => ms.find(m => m.id === id)?.primary === true)
        },
        state: params => ({ active: monitor(String(params.monitor))?.primary === true }),
    },
}
