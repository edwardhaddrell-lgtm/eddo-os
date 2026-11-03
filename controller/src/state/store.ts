// Live state cache. Pollers write snapshots here; the page engine redraws when
// anything actually changes.

import { EventEmitter } from 'node:events'

export interface AudioDevice {
    id: string          // svcl "Command-Line Friendly ID"
    name: string        // e.g. "Speakers"
    deviceName: string  // e.g. "2- LSX II LT"
    volume: number      // 0–100
    muted: boolean
    isDefault: boolean
}

export interface Monitor {
    id: string          // MultiMonitorTool "Short Monitor ID", e.g. AUS32F2
    name: string
    active: boolean
    primary: boolean
}

export interface StateShape {
    audio?: AudioDevice[]
    monitors?: Monitor[]
}

class Store extends EventEmitter<{ change: [key: keyof StateShape] }> {
    private data: StateShape = {}

    get<K extends keyof StateShape>(key: K): StateShape[K] {
        return this.data[key]
    }

    set<K extends keyof StateShape>(key: K, value: StateShape[K]) {
        if (JSON.stringify(this.data[key]) === JSON.stringify(value)) return
        this.data[key] = value
        this.emit('change', key)
    }
}

export const store = new Store()
