// Reads Windows audio + monitor state via the NirSoft tools and keeps the store
// up to date by polling.

import { readToolCsv } from '../tools.ts'
import { store, type AudioDevice, type Monitor } from './store.ts'
import { log } from '../log.ts'

export async function readAudio(): Promise<AudioDevice[]> {
    const rows = await readToolCsv('svcl', ['/Columns',
        'Name,Type,Direction,Device Name,Default,Device State,Volume Percent,Muted,Command-Line Friendly ID'])
    return rows
        .filter(r => r['Type'] === 'Device' && r['Direction'] === 'Render' && r['Device State'] === 'Active')
        .map(r => ({
            id: r['Command-Line Friendly ID'],
            name: r['Name'],
            deviceName: r['Device Name'],
            volume: parseFloat(r['Volume Percent']) || 0,
            muted: r['Muted'] === 'Yes',
            isDefault: r['Default'] === 'Render',
        }))
}

export async function readMonitors(): Promise<Monitor[]> {
    const rows = await readToolCsv('mmt')
    return rows
        .filter(r => r['Disconnected'] !== 'Yes')
        .map(r => ({
            id: r['Short Monitor ID'],
            name: r['Monitor Name'] || r['Short Monitor ID'],
            active: r['Active'] === 'Yes',
            primary: r['Primary'] === 'Yes',
        }))
}

export async function refreshAudio() {
    store.set('audio', await readAudio())
}

export async function refreshMonitors() {
    store.set('monitors', await readMonitors())
}

function poll(name: string, fn: () => Promise<void>, everyMs: number) {
    let failing = false
    const tick = async () => {
        try {
            await fn()
            if (failing) log(`${name} polling recovered.`)
            failing = false
        } catch (err) {
            if (!failing) log(`${name} polling failed: ${(err as Error).message}`)
            failing = true
        }
        setTimeout(tick, everyMs)
    }
    tick()
}

export function startWindowsPolling() {
    poll('Audio', refreshAudio, 2000)
    poll('Monitor', refreshMonitors, 4000)
}
