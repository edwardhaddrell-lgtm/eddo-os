import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { str, type ActionDef } from './index.ts'

const CHROME_PATHS = [
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
]

function launch(cmd: string, args: string[]) {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', () => {})
    child.unref()
}

export const systemActions: Record<string, ActionDef> = {
    // { action: system.run, path: 'C:\Program Files\...\app.exe', args: [...] }
    'system.run': {
        run: params => {
            const args = Array.isArray(params.args) ? params.args.map(String) : []
            launch(str(params, 'path', 'system.run'), args)
        },
    },
    // { action: system.url, url: 'https://...', browser?: chrome }
    // Opens in the default browser, or as a new tab in Chrome with `browser: chrome`.
    'system.url': {
        run: params => {
            const url = str(params, 'url', 'system.url')
            if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) throw new Error('system.url needs a full URL like https://…')
            if (params.browser === 'chrome') {
                const chrome = CHROME_PATHS.find(p => existsSync(p))
                if (!chrome) throw new Error('Chrome not found')
                launch(chrome, [url])
            } else launch('rundll32.exe', ['url.dll,FileProtocolHandler', url])
        },
    },
    // { action: system.app, app: 'PackageFamilyName!AppId' } — Microsoft Store apps
    // (IDs from PowerShell: Get-AppxPackage / Get-AppxPackageManifest)
    'system.app': {
        run: params => launch('explorer.exe', [`shell:AppsFolder\\${str(params, 'app', 'system.app')}`]),
    },
    // { action: system.lock } — lock the PC (same as Win+L)
    'system.lock': {
        run: () => launch('rundll32.exe', ['user32.dll,LockWorkStation']),
    },
}
