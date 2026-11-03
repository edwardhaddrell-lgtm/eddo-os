// Run an action without the deck, for debugging.
//
//   npm run action -- list                         audio devices + monitors with their IDs
//   npm run action -- actions                      all action names
//   npm run action -- audio.mute
//   npm run action -- audio.set device="2- LSX II LT\Device\Speakers\Render"
//   npm run action -- audio.volume step=2 --delta -3
//   npm run action -- audio.toggle devices='["id1","id2"]'
//
// Values are parsed as JSON when possible (numbers, arrays), otherwise strings.

import { actionNames, getAction, type Params } from './actions/index.ts'
import { readAudio, readMonitors, refreshAudio, refreshMonitors } from './state/windows.ts'
import { ha, startHomeAssistant } from './ha/client.ts'

const [name, ...rest] = process.argv.slice(2)

if (!name || name === 'help') {
    console.log('Usage: npm run action -- <action|list|actions> [key=value ...] [--delta N]')
    process.exit(0)
}

if (name === 'list') {
    console.log('Audio outputs (use the ID with audio.set / audio.toggle / device=):')
    for (const d of await readAudio()) {
        console.log(`  ${d.isDefault ? '*' : ' '} ${d.name} (${d.deviceName}) ${Math.round(d.volume)}%${d.muted ? ' muted' : ''}\n      ID: ${d.id}`)
    }
    console.log('\nMonitors (use the ID with display.* monitor=):')
    for (const m of await readMonitors()) {
        console.log(`    ${m.name}  ID: ${m.id}  ${m.active ? 'on' : 'off'}${m.primary ? ', primary' : ''}`)
    }
    process.exit(0)
}

if (name === 'actions') {
    console.log(actionNames().join('\n'))
    process.exit(0)
}

const def = getAction(name)
if (!def) {
    console.error(`Unknown action "${name}". Try: npm run action -- actions`)
    process.exit(1)
}

const params: Params = {}
let delta: number | undefined
for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--delta') {
        delta = Number(rest[++i])
        continue
    }
    const eq = rest[i].indexOf('=')
    if (eq < 1) {
        console.error(`Expected key=value, got "${rest[i]}"`)
        process.exit(1)
    }
    const key = rest[i].slice(0, eq)
    const raw = rest[i].slice(eq + 1)
    try {
        params[key] = JSON.parse(raw)
    } catch {
        params[key] = raw
    }
}

await Promise.all([refreshAudio(), refreshMonitors()])
if (name.startsWith('ha.')) {
    if (!startHomeAssistant()) process.exit(1)
    await new Promise<void>((resolve, reject) => {
        ha.once('status', ok => (ok ? resolve() : reject(new Error('HA disconnected'))))
        setTimeout(() => reject(new Error('Timed out connecting to Home Assistant')), 10000)
    })
}
const ctx = { nav: { goTo: (p: string) => console.log(`(nav → ${p})`), back: () => console.log('(nav back)'), home: () => console.log('(nav home)') } }
try {
    await def.run(params, ctx, { delta })
    await Promise.all([refreshAudio(), refreshMonitors()])
    const state = def.state?.(params)
    console.log(`OK${state ? ` — state: ${JSON.stringify(state)}` : ''}`)
    ha.stop()
    process.exit(0)
} catch (err) {
    console.error(`Failed: ${(err as Error).message}`)
    process.exit(1)
}
