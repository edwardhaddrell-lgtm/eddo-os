// Page engine: tracks the current page, routes input to actions, and draws the
// current page (keys, strips, button LEDs) from config + state.

import type { DeckConfig, KeyConfig, KnobConfig, KnobId, PageConfig } from '../config.ts'
import type { Deck } from '../device/deck.ts'
import { getAction, hasAction, type ActionContext, type ActionInput, type ActionState } from '../actions/index.ts'
import { store } from '../state/store.ts'
import { ha } from '../ha/client.ts'
import { drawKey, drawStrip, KEY_SIZE, shade, type KeyStatus, type KeyView, type KnobHint } from '../render/draw.ts'
import { getIcon } from '../render/icons.ts'
import { log } from '../log.ts'

const LEFT_KNOBS: KnobId[] = ['knobTL', 'knobCL', 'knobBL']
const RIGHT_KNOBS: KnobId[] = ['knobTR', 'knobCR', 'knobBR']
const NON_PARAM_FIELDS = new Set(['label', 'icon', 'color', 'action', 'press'])
const LED_IDLE = 0.12

function paramsOf(cfg: KeyConfig | KnobConfig) {
    return Object.fromEntries(Object.entries(cfg).filter(([k]) => !NON_PARAM_FIELDS.has(k)))
}

export class PageEngine {
    private config!: DeckConfig
    private current = ''
    private history: string[] = []
    private activeButton?: number
    private pressed?: { page: string; key: number }
    private errors = new Map<number, string>()
    private configError?: string
    private renderQueue: Promise<void> = Promise.resolve()
    // Idle dimming: 'awake' → 'dim' → 'off'. The input that wakes the deck is swallowed.
    private idleLevel: 'awake' | 'dim' | 'off' = 'awake'
    private lastInput = Date.now()
    private swallowKeyUp?: number

    constructor(private deck: Deck) {
        deck.on('ready', () => this.onReady())
        deck.on('button', id => this.wake() || this.onButton(id))
        deck.on('keyDown', key => {
            if (this.wake()) this.swallowKeyUp = key
            else this.onKeyDown(key)
        })
        deck.on('keyUp', (key, cancelled) => {
            if (this.swallowKeyUp === key) this.swallowKeyUp = undefined
            else this.onKeyUp(key, cancelled)
        })
        deck.on('knobTurn', (id, delta) => this.wake() || this.onKnob(id, 'turn', delta))
        deck.on('knobPress', id => this.wake() || this.onKnob(id, 'press'))
        deck.on('strip', () => this.wake())
        setInterval(() => this.checkIdle(), 5000).unref()
        // Live state changed (audio device, volume, monitors…): redraw, coalescing bursts.
        let stateTimer: NodeJS.Timeout | undefined
        const scheduleRedraw = () => {
            clearTimeout(stateTimer)
            stateTimer = setTimeout(() => this.config && this.renderAll(), 30)
        }
        store.on('change', scheduleRedraw)
        // HA sends a stream of changes for every entity; only redraw for ones on this page.
        ha.on('entity', id => {
            if (this.config && this.pageEntities().has(id)) scheduleRedraw()
        })
        ha.on('status', scheduleRedraw)
    }

    get page(): PageConfig {
        return this.config.pages.get(this.current)!
    }

    // ---- config ------------------------------------------------------------

    setConfig(config: DeckConfig) {
        const first = !this.config
        this.config = config
        this.configError = undefined
        if (!config.pages.has(this.current)) {
            if (!first) log(`Page "${this.current}" no longer exists; going to "${config.startPage}".`)
            this.current = config.startPage
            this.history = []
        }
        this.history = this.history.filter(p => config.pages.has(p))
        this.activeButton = this.page.button ?? this.activeButton
        this.errors.clear()
        this.reportUnknownActions()
        if (this.idleLevel === 'awake') this.deck.setBrightness(config.brightness)
        this.renderAll()
    }

    // ---- idle dimming ------------------------------------------------------

    // Record input; returns true if the deck was asleep (so the input only wakes it).
    private wake(): boolean {
        this.lastInput = Date.now()
        if (this.idleLevel === 'awake') return false
        log('Waking deck.')
        this.idleLevel = 'awake'
        this.deck.setBrightness(this.config.brightness)
        this.enqueue(() => this.renderLeds())
        this.deck.vibrate('SHORT')
        return true
    }

    private checkIdle() {
        if (!this.config || !this.deck.connected) return
        const { dimAfter, dimBrightness, offAfter } = this.config.idle
        const idleFor = (Date.now() - this.lastInput) / 1000
        if (offAfter && idleFor >= offAfter && this.idleLevel !== 'off') {
            this.idleLevel = 'off'
            this.deck.setBrightness(0)
            this.enqueue(() => this.renderLeds())
        } else if (dimAfter && idleFor >= dimAfter && this.idleLevel === 'awake') {
            this.idleLevel = 'dim'
            this.deck.setBrightness(dimBrightness)
        }
    }

    setConfigError(message: string | undefined) {
        this.configError = message
        this.enqueue(() => this.renderStrips())
    }

    private reportUnknownActions() {
        for (const page of this.config.pages.values()) {
            for (const [k, key] of page.keys) {
                if (key.action && !hasAction(key.action)) log(`Warning: pages.${page.name}.keys.${k} uses unknown action "${key.action}".`)
                if (key.action === 'nav.page' && !this.config.pages.has(String(key.page))) {
                    log(`Warning: pages.${page.name}.keys.${k} links to missing page "${key.page}".`)
                }
            }
            for (const [id, knob] of page.knobs) {
                for (const a of [knob.action, knob.press]) {
                    if (a && !hasAction(a)) log(`Warning: pages.${page.name}.knobs.${id} uses unknown action "${a}".`)
                }
            }
        }
    }

    // ---- navigation --------------------------------------------------------

    private navContext: ActionContext = {
        nav: {
            goTo: page => this.goTo(page),
            back: () => this.back(),
            home: () => this.goTo(this.config.startPage, { resetHistory: true }),
        },
    }

    goTo(name: string, { resetHistory = false, pushHistory = true } = {}) {
        if (!this.config.pages.has(name)) throw new Error(`No page called "${name}"`)
        if (resetHistory) this.history = []
        else if (pushHistory && name !== this.current) this.history.push(this.current)
        this.current = name
        this.activeButton = this.page.button ?? this.activeButton
        this.errors.clear()
        log(`Page → ${name}`)
        this.renderAll()
    }

    back() {
        const prev = this.history.pop()
        if (prev) this.goTo(prev, { pushHistory: false })
        else this.deck.vibrate('SHORT_LOW')
    }

    // ---- input -------------------------------------------------------------

    private onReady() {
        if (!this.config) return
        this.idleLevel = 'awake'
        this.lastInput = Date.now()
        this.deck.setBrightness(this.config.brightness)
        this.renderAll()
    }

    private onButton(id: number) {
        const page = [...this.config.pages.values()].find(p => p.button === id)
        if (!page) {
            log(`Round button ${id}: no page assigned`)
            return
        }
        this.deck.vibrate('SHORT')
        this.goTo(page.name, { resetHistory: true })
    }

    private onKeyDown(key: number) {
        const cfg = this.page.keys.get(key)
        if (!cfg) return
        this.pressed = { page: this.current, key }
        this.deck.vibrate('SHORT')
        this.enqueue(() => this.renderKey(key))
    }

    private onKeyUp(key: number, cancelled: boolean) {
        const pressed = this.pressed
        if (!pressed || pressed.key !== key) return
        this.pressed = undefined
        if (pressed.page !== this.current) return // page changed mid-press
        this.enqueue(() => this.renderKey(key))
        if (cancelled) return
        const cfg = this.page.keys.get(key)
        if (!cfg?.action) return
        log(`Key ${key} "${cfg.label ?? ''}" → ${cfg.action}`)
        this.run(cfg.action, paramsOf(cfg), {}, key)
    }

    private onKnob(id: KnobId, kind: 'turn' | 'press', delta = 0) {
        const cfg = this.page.knobs.get(id)
        const action = kind === 'turn' ? cfg?.action : cfg?.press
        if (!cfg || !action) return
        log(`Knob ${id} ${kind === 'turn' ? `turn ${delta > 0 ? '+' : ''}${delta}` : 'press'} → ${action}`)
        this.run(action, paramsOf(cfg), kind === 'turn' ? { delta } : {})
    }

    private async run(action: string, params: Record<string, unknown>, input: ActionInput, key?: number) {
        const page = this.current
        const def = getAction(action)
        try {
            if (!def) throw new Error(`Unknown action "${action}"`)
            await def.run(params, this.navContext, input)
            if (key !== undefined && this.current === page && this.errors.delete(key)) this.enqueue(() => this.renderKey(key))
        } catch (err) {
            const msg = (err as Error).message
            log(`  Action ${action} failed: ${msg}`)
            this.deck.vibrate('RUMBLE3')
            if (key !== undefined && this.current === page) {
                this.errors.set(key, msg)
                this.enqueue(() => this.renderKey(key))
            }
        }
    }

    // ---- rendering ---------------------------------------------------------

    // Draw calls are serialised so a burst of updates can't interleave.
    private enqueue(fn: () => Promise<unknown> | unknown) {
        this.renderQueue = this.renderQueue.then(async () => { await fn() }).catch(err => log(`Render failed: ${(err as Error).message}`))
        return this.renderQueue
    }

    renderAll() {
        // Collapse bursts (e.g. fast page flipping): drop work for pages we've already left.
        const page = this.current
        return this.enqueue(async () => {
            if (page !== this.current || !this.deck.connected) return
            await this.renderKeys()
            await this.renderStrips()
            await this.renderLeds()
        })
    }

    private pageEntities() {
        const ids = new Set<string>()
        for (const cfg of [...this.page.keys.values(), ...this.page.knobs.values()]) {
            if (typeof cfg.entity === 'string') ids.add(cfg.entity)
        }
        return ids
    }

    private actionState(action: string | undefined, params: Record<string, unknown>): ActionState | undefined {
        if (!action) return undefined
        try {
            return getAction(action)?.state?.(params)
        } catch {
            return undefined
        }
    }

    private async keyView(index: number): Promise<KeyView> {
        const cfg = this.page.keys.get(index)
        const colour = cfg?.color ?? this.page.color
        if (!cfg) return { colour, status: 'unset' }
        let status: KeyStatus = 'normal'
        if (!cfg.action) status = 'unset'
        else if (!hasAction(cfg.action)) status = 'unknown'
        let value: string | undefined
        if (cfg.action && hasAction(cfg.action)) {
            const st = this.actionState(cfg.action, paramsOf(cfg))
            value = st?.value
            if (st?.unavailable) status = 'unavailable'
            else if (st?.active) status = 'active'
        }
        if (this.errors.has(index)) status = 'error'
        if (this.pressed?.page === this.current && this.pressed.key === index) status = 'pressed'
        const iconColour = status === 'pressed' ? '#000000' : status === 'unset' || status === 'unavailable' ? '#6b7280' : colour
        const icon = cfg.icon ? await getIcon(cfg.icon, iconColour) : undefined
        return { label: cfg.label, icon: value ? undefined : icon, value, colour, status }
    }

    private async renderKeys() {
        const views = await Promise.all(Array.from({ length: 12 }, (_, i) => this.keyView(i)))
        await this.deck.drawScreen('center', ctx => {
            views.forEach((v, i) => drawKey(ctx, (i % 4) * KEY_SIZE, Math.floor(i / 4) * KEY_SIZE, v))
        })
    }

    private async renderKey(index: number) {
        if (!this.deck.connected) return
        const view = await this.keyView(index)
        await this.deck.drawKey(index, ctx => drawKey(ctx, 0, 0, view))
    }

    private hints(ids: KnobId[]): (KnobHint | undefined)[] {
        return ids.map(id => {
            const k = this.page.knobs.get(id)
            if (!k || (!k.action && !k.press)) return undefined
            const value = this.actionState(k.action, paramsOf(k))?.value
            return { label: k.label ?? k.action ?? k.press ?? '', value, colour: typeof k.color === 'string' ? k.color : this.page.color }
        })
    }

    private async renderStrips() {
        if (!this.deck.connected) return
        await this.deck.drawScreen('left', (ctx, w, h) => drawStrip(ctx, w, h, {
            hints: this.hints(LEFT_KNOBS),
            title: this.page.title,
            titleColour: this.page.color,
            message: this.configError ? 'CONFIG ERROR — see log' : undefined,
        }))
        await this.deck.drawScreen('right', (ctx, w, h) => drawStrip(ctx, w, h, { hints: this.hints(RIGHT_KNOBS) }))
    }

    private async renderLeds() {
        const owners = new Map([...this.config.pages.values()].filter(p => p.button !== undefined).map(p => [p.button!, p]))
        for (let id = 0; id < 8; id++) {
            const page = owners.get(id)
            const colour = !page || this.idleLevel === 'off' ? '#000000' : id === this.activeButton ? page.color : shade(page.color, LED_IDLE)
            await this.deck.setButtonColor(id, colour)
        }
    }
}
