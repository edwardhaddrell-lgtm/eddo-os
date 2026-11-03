// Loads and validates config/deck.yaml into a normalised DeckConfig.
// Throws ConfigError listing every problem so a bad save can be fixed in one go.

import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

export const KNOB_IDS = ['knobTL', 'knobCL', 'knobBL', 'knobTR', 'knobCR', 'knobBR'] as const
export type KnobId = (typeof KNOB_IDS)[number]

// Friendlier names allowed in deck.yaml. 1 = top, 3 = bottom.
const KNOB_ALIASES: Record<string, KnobId> = {
    left1: 'knobTL', left2: 'knobCL', left3: 'knobBL',
    right1: 'knobTR', right2: 'knobCR', right3: 'knobBR',
}

export interface KeyConfig {
    label?: string
    icon?: string
    color?: string
    action?: string
    [param: string]: unknown
}

export interface KnobConfig {
    label?: string
    action?: string
    press?: string
    [param: string]: unknown
}

export interface PageConfig {
    name: string
    title: string
    button?: number
    color: string
    keys: Map<number, KeyConfig>
    knobs: Map<KnobId, KnobConfig>
}

export interface IdleConfig {
    dimAfter: number       // seconds without input before dimming (0 = never)
    dimBrightness: number  // 0–1
    offAfter: number       // seconds without input before screens + LEDs go dark (0 = never)
}

export interface DeckConfig {
    brightness: number
    idle: IdleConfig
    startPage: string
    pages: Map<string, PageConfig>
}

export class ConfigError extends Error {
    constructor(public problems: string[]) {
        super(`Config has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`)
    }
}

const DEFAULT_COLOUR = '#3b82f6'
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

function titleFromName(name: string) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function loadConfig(path: string): DeckConfig {
    let raw: unknown
    try {
        raw = parse(readFileSync(path, 'utf8'))
    } catch (err) {
        throw new ConfigError([`Could not read/parse ${path}: ${(err as Error).message}`])
    }
    return validateConfig(raw)
}

export function validateConfig(raw: unknown): DeckConfig {
    const problems: string[] = []
    if (!isObject(raw)) throw new ConfigError(['Top level must be a mapping with `device` and `pages`.'])

    const device = isObject(raw.device) ? raw.device : {}
    let brightness = 0.8
    if (device.brightness !== undefined) {
        if (typeof device.brightness === 'number' && device.brightness >= 0 && device.brightness <= 1) brightness = device.brightness
        else problems.push('device.brightness must be a number from 0 to 1.')
    }

    const idle: IdleConfig = { dimAfter: 300, dimBrightness: 0.1, offAfter: 1800 }
    if (device.idle !== undefined) {
        if (!isObject(device.idle)) problems.push('device.idle must be a mapping like { dimAfter: 300, dimBrightness: 0.1, offAfter: 1800 }.')
        else {
            for (const k of ['dimAfter', 'offAfter'] as const) {
                const v = device.idle[k]
                if (v === undefined) continue
                if (typeof v === 'number' && v >= 0) idle[k] = v
                else problems.push(`device.idle.${k} must be a number of seconds (0 = never).`)
            }
            const b = device.idle.dimBrightness
            if (b !== undefined) {
                if (typeof b === 'number' && b >= 0 && b <= 1) idle.dimBrightness = b
                else problems.push('device.idle.dimBrightness must be a number from 0 to 1.')
            }
        }
    }

    const pages = new Map<string, PageConfig>()
    const buttonOwners = new Map<number, string>()

    if (!isObject(raw.pages) || Object.keys(raw.pages).length === 0) {
        throw new ConfigError([...problems, '`pages` must contain at least one page.'])
    }

    for (const [name, rawPage] of Object.entries(raw.pages)) {
        const where = `pages.${name}`
        if (!isObject(rawPage)) {
            problems.push(`${where} must be a mapping.`)
            continue
        }

        let button: number | undefined
        if (rawPage.button !== undefined) {
            const b = rawPage.button
            if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 7) {
                problems.push(`${where}.button must be a round button number 0–7.`)
            } else if (buttonOwners.has(b)) {
                problems.push(`${where}.button ${b} is already used by page "${buttonOwners.get(b)}".`)
            } else {
                button = b
                buttonOwners.set(b, name)
            }
        }

        const colourRaw = rawPage.color ?? rawPage.led ?? DEFAULT_COLOUR
        let color = DEFAULT_COLOUR
        if (typeof colourRaw === 'string' && HEX.test(colourRaw)) color = colourRaw
        else problems.push(`${where}.color must be a hex colour like "#3b82f6".`)

        const keys = new Map<number, KeyConfig>()
        if (rawPage.keys !== undefined && !isObject(rawPage.keys)) problems.push(`${where}.keys must be a mapping of key number → key.`)
        for (const [k, rawKey] of Object.entries(isObject(rawPage.keys) ? rawPage.keys : {})) {
            const index = Number(k)
            if (!Number.isInteger(index) || index < 0 || index > 11) {
                problems.push(`${where}.keys.${k}: key number must be 0–11.`)
                continue
            }
            if (rawKey === null) continue // explicitly empty
            if (!isObject(rawKey)) {
                problems.push(`${where}.keys.${k} must be a mapping like { label: ..., action: ... }.`)
                continue
            }
            if (rawKey.color !== undefined && !(typeof rawKey.color === 'string' && HEX.test(rawKey.color))) {
                problems.push(`${where}.keys.${k}.color must be a hex colour.`)
            }
            if (rawKey.action !== undefined && typeof rawKey.action !== 'string') {
                problems.push(`${where}.keys.${k}.action must be a string like "audio.toggle".`)
            }
            keys.set(index, { ...rawKey, label: rawKey.label === undefined ? undefined : String(rawKey.label) } as KeyConfig)
        }

        const knobs = new Map<KnobId, KnobConfig>()
        if (rawPage.knobs !== undefined && !isObject(rawPage.knobs)) problems.push(`${where}.knobs must be a mapping of knob → binding.`)
        for (const [k, rawKnob] of Object.entries(isObject(rawPage.knobs) ? rawPage.knobs : {})) {
            const id = (KNOB_IDS as readonly string[]).includes(k) ? (k as KnobId) : KNOB_ALIASES[k]
            if (!id) {
                problems.push(`${where}.knobs.${k}: unknown knob. Use left1–3 / right1–3 (top to bottom) or ${KNOB_IDS.join(', ')}.`)
                continue
            }
            if (rawKnob === null) continue
            if (!isObject(rawKnob)) {
                problems.push(`${where}.knobs.${k} must be a mapping like { action: ..., press: ... }.`)
                continue
            }
            knobs.set(id, rawKnob as KnobConfig)
        }

        pages.set(name, {
            name,
            title: typeof rawPage.title === 'string' ? rawPage.title : titleFromName(name),
            button,
            color,
            keys,
            knobs,
        })
    }

    let startPage = typeof device.startPage === 'string' ? device.startPage : undefined
    if (startPage && !pages.has(startPage)) {
        problems.push(`device.startPage "${startPage}" is not a page.`)
        startPage = undefined
    }
    startPage ??= [...pages.values()].find(p => p.button === 0)?.name ?? [...pages.keys()][0]

    if (problems.length) throw new ConfigError(problems)
    return { brightness, idle, startPage, pages }
}
