// Home Assistant actions. Entities are referenced by entity_id, e.g.
// light.living_room. Key state comes from HA's live state stream.

import { ha } from '../ha/client.ts'
import { str, type ActionDef, type ActionState, type Params } from './index.ts'

const ON_STATES = new Set(['on', 'open', 'playing', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only', 'home'])

export function entityState(params: Params): ActionState {
    const id = typeof params.entity === 'string' ? params.entity : ''
    const e = ha.connected ? ha.get(id) : undefined
    if (!e || e.state === 'unavailable' || e.state === 'unknown') return { unavailable: true }
    return { active: ON_STATES.has(e.state) }
}

// "5_down" → "5 Down", "auto" → "Auto", "3" → "3"
function prettyMode(v: unknown) {
    if (v === undefined || v === null) return '—'
    return String(v).replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase())
}

function domainOf(id: string) {
    return id.split('.')[0]
}

// Knob turns arrive faster than round trips; add up clicks while a call is in flight.
const pending = new Map<string, number>()
const inFlight = new Set<string>()
async function coalesce(key: string, amount: number, send: (total: number) => Promise<unknown>) {
    pending.set(key, (pending.get(key) ?? 0) + amount)
    if (inFlight.has(key)) return
    inFlight.add(key)
    try {
        while (pending.get(key)) {
            const total = pending.get(key)!
            pending.set(key, 0)
            await send(total)
        }
    } finally {
        inFlight.delete(key)
        pending.delete(key)
    }
}

export const haActions: Record<string, ActionDef> = {
    // { action: ha.toggle, entity: light.living_room } — lights, switches, fans, climate…
    'ha.toggle': {
        run: async params => {
            const id = str(params, 'entity', 'ha.toggle')
            const domain = domainOf(id)
            if (domain === 'scene' || domain === 'script') await ha.callService(domain, 'turn_on', {}, { entity_id: id })
            else await ha.callService('homeassistant', 'toggle', {}, { entity_id: id })
        },
        state: entityState,
    },

    // { action: ha.scene, entity: scene.startup } — also runs scripts (script.xxx)
    'ha.scene': {
        run: params => {
            const id = str(params, 'entity', 'ha.scene')
            return ha.callService(domainOf(id) === 'script' ? 'script' : 'scene', 'turn_on', {}, { entity_id: id })
        },
        state: params => {
            const s = entityState(params)
            return { unavailable: s.unavailable }
        },
    },

    // Knob: { action: ha.brightness, entity: light.x, step: 5 } — press usually ha.toggle
    'ha.brightness': {
        run: async (params, _ctx, input) => {
            const id = str(params, 'entity', 'ha.brightness')
            const step = typeof params.step === 'number' ? params.step : 5
            if (!input.delta) return
            await coalesce(id, step * input.delta, total =>
                ha.callService('light', 'turn_on', { brightness_step_pct: total }, { entity_id: id }))
        },
        state: params => {
            const s = entityState(params)
            if (s.unavailable) return { ...s, value: 'n/a' }
            const e = ha.get(String(params.entity))!
            const b = e.attributes.brightness
            return { active: s.active, value: e.state !== 'on' ? 'Off' : typeof b === 'number' ? `${Math.round((b / 255) * 100)}%` : 'On' }
        },
    },

    // Knob: { action: ha.climate, entity: climate.dining_room, step: 0.5 } — target temperature.
    // On a key, `delta: 1` / `delta: -1` makes it a warmer/colder button; with no
    // delta the key just shows the target.
    'ha.climate': {
        run: async (params, _ctx, input) => {
            const id = str(params, 'entity', 'ha.climate')
            const step = typeof params.step === 'number' ? params.step : 0.5
            const delta = input.delta ?? (typeof params.delta === 'number' ? params.delta : 0)
            if (!delta) return
            await coalesce(id, step * delta, async total => {
                const e = ha.get(id)
                const current = e?.attributes.temperature
                if (typeof current !== 'number') throw new Error(`${id} has no target temperature (is it off?)`)
                const { min_temp: min = -Infinity, max_temp: max = Infinity } = e!.attributes
                const temperature = Math.max(min, Math.min(max, current + total))
                await ha.callService('climate', 'set_temperature', { temperature }, { entity_id: id })
            })
        },
        state: params => {
            const s = entityState(params)
            if (s.unavailable) return { ...s, value: 'n/a' }
            if (params.delta) return {} // a Warmer/Colder key: keep its icon
            const e = ha.get(String(params.entity))!
            const t = e.attributes.temperature
            return { active: s.active, value: e.state === 'off' ? 'Off' : typeof t === 'number' ? `${t}°` : e.state }
        },
    },

    // { action: ha.climateMode, entity: climate.x, mode: cool } — lit while in that mode
    'ha.climateMode': {
        run: params => ha.callService('climate', 'set_hvac_mode',
            { hvac_mode: str(params, 'mode', 'ha.climateMode') }, { entity_id: str(params, 'entity', 'ha.climateMode') }),
        state: params => {
            const s = entityState(params)
            if (s.unavailable) return s
            return { active: ha.get(String(params.entity))!.state === params.mode }
        },
    },

    // Knob or key: { action: ha.climateOption, entity: climate.x, option: fan | swing | swing_horizontal }
    // Turning steps through the entity's own list (fan_modes, swing_modes, …);
    // a press or key tap moves to the next one, wrapping round.
    'ha.climateOption': {
        run: async (params, _ctx, input) => {
            const id = str(params, 'entity', 'ha.climateOption')
            const option = str(params, 'option', 'ha.climateOption')
            const e = ha.get(id)
            const list: string[] | undefined = e?.attributes[`${option}_modes`]
            if (!list?.length) throw new Error(`${id} has no ${option}_modes`)
            const i = Math.max(0, list.indexOf(e!.attributes[`${option}_mode`]))
            const step = input.delta ?? 1
            const next = list[(((i + step) % list.length) + list.length) % list.length]
            await ha.callService('climate', `set_${option}_mode`, { [`${option}_mode`]: next }, { entity_id: id })
        },
        state: params => {
            const s = entityState(params)
            if (s.unavailable) return { ...s, value: 'n/a' }
            const v = ha.get(String(params.entity))!.attributes[`${params.option}_mode`]
            return { value: prettyMode(v) }
        },
    },

    // Display only: { action: ha.value, entity: climate.x, attribute?: current_temperature, unit?: "°" }
    'ha.value': {
        run: () => {},
        state: params => {
            const s = entityState(params)
            if (s.unavailable) return { ...s, value: 'n/a' }
            const e = ha.get(String(params.entity))!
            const raw = typeof params.attribute === 'string' ? e.attributes[params.attribute] : e.state
            const unit = typeof params.unit === 'string' ? params.unit : (e.attributes.unit_of_measurement ?? '')
            return { value: raw === undefined || raw === null ? '—' : `${raw}${unit}` }
        },
    },

    // { action: ha.service, service: media_player.media_play_pause, entity?: ..., data?: {...} }
    'ha.service': {
        run: params => {
            const [domain, service] = str(params, 'service', 'ha.service').split('.')
            if (!domain || !service) throw new Error('ha.service needs `service: domain.service`')
            const data = typeof params.data === 'object' && params.data ? (params.data as Record<string, unknown>) : {}
            const target = typeof params.entity === 'string' ? { entity_id: params.entity } : undefined
            return ha.callService(domain, service, data, target)
        },
        state: params => (typeof params.entity === 'string' ? entityState(params) : undefined),
    },
}
