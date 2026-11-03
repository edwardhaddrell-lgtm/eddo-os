// Home Assistant websocket client: authenticates with the long-lived token from
// .env, keeps a cache of entity states, calls services, and reconnects with
// backoff when HA restarts or the network drops. The token is never logged.

import { EventEmitter } from 'node:events'
import { log } from '../log.ts'

export interface EntityState {
    state: string
    attributes: Record<string, any>
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }

const MAX_BACKOFF_MS = 30000

class HomeAssistant extends EventEmitter<{ entity: [id: string]; status: [connected: boolean] }> {
    private ws?: WebSocket
    private nextId = 1
    private pending = new Map<number, Pending>()
    private backoff = 1000
    private url?: string
    private token?: string
    private stopped = false
    entities = new Map<string, EntityState>()
    connected = false

    start(baseUrl: string, token: string) {
        this.url = baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket'
        this.token = token
        this.open()
    }

    stop() {
        this.stopped = true
        this.ws?.close()
    }

    private open() {
        if (this.stopped || !this.url) return
        const ws = new WebSocket(this.url)
        this.ws = ws

        ws.addEventListener('message', ev => this.onMessage(JSON.parse(String(ev.data))))
        ws.addEventListener('close', () => this.onClose())
        ws.addEventListener('error', () => {}) // 'close' follows and handles reconnect
    }

    private async onMessage(msg: any) {
        switch (msg.type) {
            case 'auth_required':
                this.ws!.send(JSON.stringify({ type: 'auth', access_token: this.token }))
                return
            case 'auth_invalid':
                log(`Home Assistant rejected the token (${msg.message}). Create a new long-lived token and put it in .env.`)
                this.stopped = true
                this.ws!.close()
                return
            case 'auth_ok':
                await this.onAuthed(msg.ha_version)
                return
            case 'result': {
                const p = this.pending.get(msg.id)
                if (!p) return
                this.pending.delete(msg.id)
                if (msg.success) p.resolve(msg.result)
                else p.reject(new Error(msg.error?.message ?? 'Home Assistant error'))
                return
            }
            case 'event': {
                const data = msg.event?.data
                if (msg.event?.event_type !== 'state_changed' || !data) return
                if (data.new_state) this.entities.set(data.entity_id, { state: data.new_state.state, attributes: data.new_state.attributes })
                else this.entities.delete(data.entity_id)
                this.emit('entity', data.entity_id)
            }
        }
    }

    private async onAuthed(version: string) {
        try {
            await this.send({ type: 'subscribe_events', event_type: 'state_changed' })
            const states: any[] = await this.send({ type: 'get_states' })
            this.entities = new Map(states.map(s => [s.entity_id, { state: s.state, attributes: s.attributes }]))
            this.connected = true
            this.backoff = 1000
            log(`Home Assistant connected (${version}, ${states.length} entities).`)
            this.emit('status', true)
        } catch (err) {
            log(`Home Assistant setup failed: ${(err as Error).message}`)
            this.ws?.close()
        }
    }

    private onClose() {
        const was = this.connected
        this.connected = false
        for (const p of this.pending.values()) p.reject(new Error('Home Assistant connection closed'))
        this.pending.clear()
        if (was) {
            log('Home Assistant disconnected. Reconnecting…')
            this.emit('status', false)
        }
        if (this.stopped) return
        setTimeout(() => this.open(), this.backoff)
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    }

    // Scenes that touch many (or offline) devices can take HA a while to confirm.
    private send(payload: Record<string, unknown>, timeoutMs = 10000): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Home Assistant not connected'))
        const id = this.nextId++
        this.ws.send(JSON.stringify({ id, ...payload }))
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            setTimeout(() => {
                if (this.pending.delete(id)) reject(new Error(`Home Assistant did not confirm within ${timeoutMs / 1000} s (it may still have run)`))
            }, timeoutMs)
        })
    }

    callService(domain: string, service: string, data: Record<string, unknown> = {}, target?: Record<string, unknown>) {
        if (!this.connected) return Promise.reject(new Error('Home Assistant not connected'))
        return this.send({ type: 'call_service', domain, service, service_data: data, ...(target ? { target } : {}) }, 30000)
    }

    get(id: string) {
        return this.entities.get(id)
    }
}

export const ha = new HomeAssistant()

// Read HA_URL / HA_TOKEN from .env and connect. Returns false if not configured.
export function startHomeAssistant() {
    try {
        process.loadEnvFile('.env')
    } catch {}
    const url = process.env.HA_URL
    const token = process.env.HA_TOKEN
    if (!url || !token) {
        log('Home Assistant not configured (HA_URL / HA_TOKEN missing from .env); HA keys will show as unavailable.')
        return false
    }
    log(`Connecting to Home Assistant at ${url}`)
    ha.start(url, token)
    return true
}
