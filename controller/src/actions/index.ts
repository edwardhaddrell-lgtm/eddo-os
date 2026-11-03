// Action registry. Each action is a small function taking the key/knob's config
// params. An action may also report live state for its key (lit when active,
// a value like "23%" for knob labels). Actions planned for later phases are
// registered as placeholders so config can reference them now.

import { log } from '../log.ts'
import { navActions } from './nav.ts'
import { audioActions } from './audio.ts'
import { displayActions } from './display.ts'
import { systemActions } from './system.ts'
import { haActions } from './ha.ts'

export interface ActionContext {
    nav: {
        goTo(page: string): void
        back(): void
        home(): void
    }
}

export interface ActionInput {
    // Knob rotation in clicks: +1 per clockwise click.
    delta?: number
}

export type Params = Record<string, unknown>

export interface ActionState {
    active?: boolean   // draw the key lit (e.g. the current audio device)
    value?: string     // short live value, shown under knob labels (e.g. "23%")
    unavailable?: boolean  // device offline: draw grey with a strike-through
}

export interface ActionDef {
    run(params: Params, ctx: ActionContext, input: ActionInput): void | Promise<void>
    state?(params: Params): ActionState | undefined
}

const registry = new Map<string, ActionDef>()

export function register(actions: Record<string, ActionDef>) {
    for (const [name, def] of Object.entries(actions)) registry.set(name, def)
}

function placeholder(phase: number): ActionDef {
    return { run: params => log(`  (not implemented yet — phase ${phase}) params=${JSON.stringify(params)}`) }
}

register(navActions)
register(audioActions)
register(displayActions)
register(systemActions)
register(haActions)
register({ 'system.hotkey': placeholder(6) })

export function hasAction(name: string) {
    return registry.has(name)
}

export function getAction(name: string) {
    return registry.get(name)
}

export function actionNames() {
    return [...registry.keys()].sort()
}

// Helpers for action modules
export function str(params: Params, key: string, action: string): string {
    const v = params[key]
    if (typeof v !== 'string' || !v) throw new Error(`${action} needs \`${key}\``)
    return v
}
