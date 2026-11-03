// Tray icon: runs scripts/tray.ps1 (WinForms NotifyIcon) as a child process.
// It prints menu commands on stdout; we keep a small status file it displays.

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createCanvas, loadImage } from 'canvas'
import { readFileSync } from 'node:fs'
import { log } from './log.ts'

const ICON_FILE = resolve('logs/tray-icon.png')
const STATUS_FILE = resolve('logs/status.json')

export type TrayCommand = 'reload' | 'config' | 'log' | 'restart' | 'quit'

async function renderIcon() {
    const size = 32
    const canvas = createCanvas(size, size)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#3b82f6'
    ctx.beginPath()
    ctx.roundRect(1, 1, size - 2, size - 2, 7)
    ctx.fill()
    const svg = readFileSync('assets/icons/rooms.svg', 'utf8').replace(/currentColor/g, '#ffffff')
    ctx.drawImage(await loadImage(Buffer.from(svg)), 5, 5, size - 10, size - 10)
    writeFileSync(ICON_FILE, canvas.toBuffer('image/png'))
}

export function setTrayStatus(status: { device: string; ha: string }) {
    try {
        writeFileSync(STATUS_FILE, JSON.stringify(status))
    } catch {}
}

export async function startTray(onCommand: (cmd: TrayCommand) => void) {
    try {
        await renderIcon()
    } catch (err) {
        log(`Tray icon render failed: ${(err as Error).message}`)
        return
    }
    const child = spawn('powershell.exe', [
        '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', resolve('scripts/tray.ps1'),
        '-IconFile', ICON_FILE, '-StatusFile', STATUS_FILE, '-ParentPid', String(process.pid),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    createInterface({ input: child.stdout }).on('line', line => {
        const cmd = line.trim() as TrayCommand
        if (['reload', 'config', 'log', 'restart', 'quit'].includes(cmd)) onCommand(cmd)
    })
    child.stderr.on('data', d => log(`Tray: ${String(d).trim()}`))
    child.on('exit', code => {
        if (code) log(`Tray icon exited (${code}).`)
    })
    return child
}
