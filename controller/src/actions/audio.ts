// Windows audio output via svcl.exe. Devices are identified by svcl's
// "Command-Line Friendly ID" (run `npm run action -- list` to see them).
// Switching output sets the default for all roles; the microphone is never touched.

import { runTool } from '../tools.ts'
import { refreshAudio } from '../state/windows.ts'
import { store } from '../state/store.ts'
import { str, type ActionDef, type Params } from './index.ts'

const DEFAULT = 'DefaultRenderDevice'

const target = (params: Params) => (typeof params.device === 'string' && params.device ? params.device : DEFAULT)

function findDevice(id: string) {
    const devices = store.get('audio') ?? []
    return id === DEFAULT ? devices.find(d => d.isDefault) : devices.find(d => d.id === id)
}

async function setDefault(id: string) {
    await runTool('svcl', ['/SetDefault', id, 'all'])
    await refreshAudio()
    if (!findDevice(DEFAULT) || findDevice(DEFAULT)!.id !== id) {
        throw new Error(`Output didn't switch to "${id}". Is the device connected?`)
    }
}

// Knob turns arrive faster than svcl can run, so add up clicks while a change
// is in flight and send them as one step.
const pending = new Map<string, number>()
const inFlight = new Set<string>()

async function changeVolume(id: string, amount: number) {
    pending.set(id, (pending.get(id) ?? 0) + amount)
    // Optimistic update so the strip label follows the knob immediately
    const dev = findDevice(id)
    if (dev) {
        const devices = (store.get('audio') ?? []).map(d =>
            d.id === dev.id ? { ...d, volume: Math.max(0, Math.min(100, d.volume + amount)) } : d)
        store.set('audio', devices)
    }
    if (inFlight.has(id)) return
    inFlight.add(id)
    try {
        while (pending.get(id)) {
            const step = pending.get(id)!
            pending.set(id, 0)
            await runTool('svcl', ['/ChangeVolume', id, String(step)])
        }
    } finally {
        inFlight.delete(id)
        pending.delete(id)
    }
    await refreshAudio()
}

export const audioActions: Record<string, ActionDef> = {
    // { action: audio.set, device: '<friendly id>' }
    'audio.set': {
        run: params => setDefault(str(params, 'device', 'audio.set')),
        state: params => ({ active: findDevice(DEFAULT)?.id === params.device }),
    },

    // { action: audio.toggle, devices: [id1, id2, ...] } — cycles through the list
    'audio.toggle': {
        run: async params => {
            const list = params.devices
            if (!Array.isArray(list) || list.length < 2) throw new Error('audio.toggle needs `devices: [id1, id2]`')
            const current = findDevice(DEFAULT)?.id
            const i = list.indexOf(current)
            await setDefault(String(list[(i + 1) % list.length]))
        },
    },

    // Knob: { action: audio.volume, step: 2, device?: id } — default output if no device
    'audio.volume': {
        run: async (params, _ctx, input) => {
            const step = typeof params.step === 'number' ? params.step : 2
            if (!input.delta) return
            await changeVolume(target(params), step * input.delta)
        },
        state: params => {
            const d = findDevice(target(params))
            if (!d) return { value: '—' }
            return { value: d.muted ? 'Muted' : `${Math.round(d.volume)}%`, active: !d.muted }
        },
    },

    // { action: audio.mute, device?: id } — toggles mute
    'audio.mute': {
        run: async params => {
            await runTool('svcl', ['/Switch', target(params)])
            await refreshAudio()
        },
        state: params => ({ active: findDevice(target(params))?.muted ?? false }),
    },
}
