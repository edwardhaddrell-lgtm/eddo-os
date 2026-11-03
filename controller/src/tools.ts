// Runs the bundled NirSoft command-line tools and parses their CSV output.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOOLS = {
    svcl: 'tools/svcl.exe',
    mmt: 'tools/MultiMonitorTool.exe',
} as const

// NirSoft tools use exit codes for results (svcl /GetPercent returns the volume),
// so a non-zero exit is not an error. Callers verify the effect by re-reading state.
export function runTool(tool: keyof typeof TOOLS, args: string[], timeoutMs = 8000): Promise<string> {
    const exe = TOOLS[tool]
    if (!existsSync(exe)) return Promise.reject(new Error(`${exe} is missing. See tools/README.md.`))
    return new Promise((resolve, reject) => {
        execFile(exe, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
            if (err && (err.killed || typeof err.code !== 'number')) {
                reject(new Error(`${exe} ${args.join(' ')} failed: ${err.message}`))
            } else resolve(stdout)
        })
    })
}

// Export the tool's table via /scomma to a temp file and parse it. (Passing an
// empty filename for stdout is unreliable: MultiMonitorTool sometimes opens its
// window instead.)
let seq = 0
export async function readToolCsv(tool: keyof typeof TOOLS, extraArgs: string[] = []) {
    const file = join(tmpdir(), `loupedeck-${tool}-${process.pid}-${seq++}.csv`)
    try {
        await runTool(tool, ['/scomma', file, ...extraArgs])
        if (!existsSync(file)) throw new Error(`${TOOLS[tool]} did not write its output`)
        const buf = readFileSync(file)
        const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')
        return parseCsv(text)
    } finally {
        rmSync(file, { force: true })
    }
}

// Minimal CSV parser (handles quoted fields and a leading BOM). Returns rows as
// objects keyed by the header line.
export function parseCsv(text: string): Record<string, string>[] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false
    text = text.replace(/^﻿/, '')
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"'
                i++
            } else if (c === '"') quoted = false
            else field += c
        } else if (c === '"') quoted = true
        else if (c === ',') {
            row.push(field)
            field = ''
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++
            row.push(field)
            field = ''
            if (row.some(f => f !== '')) rows.push(row)
            row = []
        } else field += c
    }
    if (field || row.length) {
        row.push(field)
        rows.push(row)
    }
    const [header, ...data] = rows
    if (!header) return []
    return data.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}
