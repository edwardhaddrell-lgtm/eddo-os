import { appendFileSync, mkdirSync } from 'node:fs'

const LOG_FILE = 'logs/deck.log'
mkdirSync('logs', { recursive: true })

export const debugEnabled = process.argv.includes('--debug')

export function log(msg: string) {
    const line = `${new Date().toISOString()}  ${msg}`
    console.log(line)
    try {
        appendFileSync(LOG_FILE, line + '\n')
    } catch {}
}

export function debug(msg: string) {
    if (debugEnabled) log(`[debug] ${msg}`)
}
