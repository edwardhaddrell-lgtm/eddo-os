// Loads key icons from assets/icons. SVGs may use `currentColor`, which is
// replaced with the requested colour so one icon can be tinted per state.
// PNGs are drawn as-is.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadImage, type Image } from 'canvas'
import { log } from '../log.ts'

const ICON_DIR = 'assets/icons'
const cache = new Map<string, Promise<Image | null>>()
const warned = new Set<string>()

export function getIcon(name: string, colour: string): Promise<Image | null> {
    const cacheKey = `${name}|${colour}`
    let hit = cache.get(cacheKey)
    if (!hit) {
        hit = load(name, colour)
        cache.set(cacheKey, hit)
    }
    return hit
}

export function clearIconCache() {
    cache.clear()
    warned.clear()
}

async function load(name: string, colour: string): Promise<Image | null> {
    const svg = join(ICON_DIR, `${name}.svg`)
    const png = join(ICON_DIR, `${name}.png`)
    try {
        if (existsSync(svg)) {
            const src = readFileSync(svg, 'utf8').replace(/currentColor/g, colour)
            return await loadImage(Buffer.from(src))
        }
        if (existsSync(png)) return await loadImage(png)
    } catch (err) {
        log(`Icon "${name}" failed to load: ${(err as Error).message}`)
        return null
    }
    if (!warned.has(name)) {
        warned.add(name)
        log(`Icon "${name}" not found in ${ICON_DIR} (.svg or .png)`)
    }
    return null
}
