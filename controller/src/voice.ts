// Push-to-talk Jarvis for the EDDO OS wallpaper.
// Records the Elgato Wave:XLR mic, streams it to a Home Assistant Assist
// pipeline (speech-to-text → Jarvis → text-to-speech) and reports progress to
// the wallpaper over the local bridge. HA decides when you've stopped talking.
//
// Needs: npm install audify   (prebuilt Windows binaries; no build tools)

import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { log } from './log.ts'

const require = createRequire(import.meta.url)
const MAX_LISTEN_MS = 12000
const TARGET_RATE = 16000

export type VoiceEvent =
    | { type: 'listening'; mic: string }
    | { type: 'level'; value: number }
    | { type: 'heard'; text: string }
    | { type: 'thinking' }
    | { type: 'reply'; text: string; conversation_id?: string }
    | { type: 'tts'; url: string }
    | { type: 'error'; message: string }
    | { type: 'done' }

export const voice = new EventEmitter<{ event: [VoiceEvent] }>()
let busy = false
let stopNow: (() => void) | undefined

export function isBusy() { return busy }
export function stopListening() { stopNow?.() }

function emit(e: VoiceEvent) { voice.emit('event', e) }

function loadAudify(): any {
    try { return require('audify') } catch (err) {
        const msg = (err as Error).message || String(err)
        log(`Jarvis: could not load audify: ${msg}`)
        if (/Cannot find module 'audify'/.test(msg)) throw new Error('Microphone support is not installed. In the loupedeck-controller folder run: npm install, then restart the controller.')
        throw new Error(`Microphone library failed to load: ${msg.split('\n')[0]}`)
    }
}

// Pick the Elgato (or VOICE_MIC from .env), falling back to the default input.
function pickMic(rt: any) {
    const want = (process.env.VOICE_MIC || 'elgato|wave').toLowerCase()
    const inputs = rt.getDevices().filter((d: any) => d.inputChannels > 0)
    const re = new RegExp(want, 'i')
    return inputs.find((d: any) => re.test(d.name)) ?? inputs.find((d: any) => d.id === rt.getDefaultInputDevice()) ?? inputs[0]
}

// 16-bit mono PCM at `rate` → 16 kHz.
function resample(buf: Buffer, rate: number): Buffer {
    const src = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1)
    if (rate === TARGET_RATE) return Buffer.from(src.buffer, src.byteOffset, src.byteLength)
    const ratio = rate / TARGET_RATE, n = Math.floor(src.length / ratio), out = new Int16Array(n)
    for (let i = 0; i < n; i++) {
        const start = Math.floor(i * ratio), end = Math.min(src.length, Math.floor((i + 1) * ratio))
        let sum = 0
        for (let j = start; j < end; j++) sum += src[j]
        out[i] = end > start ? sum / (end - start) : src[start] ?? 0
    }
    return Buffer.from(out.buffer)
}

export async function listen(pipeline?: string, conversationId?: string) {
    if (busy) throw new Error('Jarvis is already listening')
    const url = process.env.HA_URL, token = process.env.HA_TOKEN
    if (!url || !token) throw new Error('HA_URL / HA_TOKEN missing from .env')
    const audify = loadAudify()
    busy = true

    const rt = new audify.RtAudio(audify.RtAudioApi.WINDOWS_WASAPI)
    const mic = pickMic(rt)
    if (!mic) { busy = false; throw new Error('No microphone found') }
    const rate = mic.preferredSampleRate || 48000
    log(`Jarvis: listening on "${mic.name}" (${rate} Hz)`)

    const ws = new WebSocket(url.replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket')
    ws.binaryType = 'arraybuffer'
    let handler: number | undefined, recording = false, ended = false, lastLevel = 0
    let timer: NodeJS.Timeout | undefined

    const finishAudio = () => {
        if (ended) return
        ended = true
        clearTimeout(timer)
        try { if (rt.isStreamRunning()) rt.stop(); if (rt.isStreamOpen()) rt.closeStream() } catch {}
        recording = false
        if (handler !== undefined && ws.readyState === WebSocket.OPEN) ws.send(Uint8Array.of(handler)) // end of audio
    }
    const close = () => {
        finishAudio()
        busy = false
        stopNow = undefined
        setTimeout(() => { try { ws.close() } catch {} }, 500)
        emit({ type: 'done' })
    }
    stopNow = finishAudio

    const startMic = () => {
        rt.openStream(null, { deviceId: mic.id, nChannels: 1, firstChannel: 0 }, audify.RtAudioFormat.RTAUDIO_SINT16, rate, Math.round(rate / 50), 'EDDO Jarvis',
            (pcm: Buffer) => {
                if (!recording || handler === undefined || ws.readyState !== WebSocket.OPEN) return
                const chunk = resample(pcm, rate)
                ws.send(Buffer.concat([Buffer.from([handler]), chunk]))
                const now = Date.now()
                if (now - lastLevel > 80) {
                    lastLevel = now
                    const s = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length >> 1)
                    let sum = 0; for (const v of s) sum += v * v
                    emit({ type: 'level', value: Math.min(1, Math.sqrt(sum / Math.max(1, s.length)) / 6000) })
                }
            }, null)
        rt.start()
        recording = true
        emit({ type: 'listening', mic: mic.name })
        timer = setTimeout(finishAudio, MAX_LISTEN_MS)
    }

    ws.addEventListener('message', ev => {
        const msg = JSON.parse(String(ev.data))
        if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }))
        else if (msg.type === 'auth_invalid') { emit({ type: 'error', message: 'Home Assistant rejected the token' }); close() }
        else if (msg.type === 'auth_ok') {
            ws.send(JSON.stringify({
                id: 1, type: 'assist_pipeline/run', start_stage: 'stt', end_stage: 'tts',
                input: { sample_rate: TARGET_RATE }, timeout: 60,
                ...(pipeline ? { pipeline } : {}), ...(conversationId ? { conversation_id: conversationId } : {}),
            }))
        } else if (msg.type === 'result' && !msg.success) { emit({ type: 'error', message: msg.error?.message ?? 'Pipeline failed to start' }); close() }
        else if (msg.type === 'event') {
            const { type, data } = msg.event ?? {}
            if (type === 'run-start') {
                handler = data?.runner_data?.stt_binary_handler_id
                try { startMic() } catch (err) { emit({ type: 'error', message: `Microphone: ${(err as Error).message}` }); close() }
            } else if (type === 'stt-vad-end') finishAudio()
            else if (type === 'stt-end') { finishAudio(); emit({ type: 'heard', text: data?.stt_output?.text ?? '' }); emit({ type: 'thinking' }) }
            else if (type === 'intent-end') {
                const out = data?.intent_output ?? {}
                emit({ type: 'reply', text: out.response?.speech?.plain?.speech ?? '', conversation_id: out.conversation_id })
            } else if (type === 'tts-end') { const u = data?.tts_output?.url; if (u) emit({ type: 'tts', url: u }) }
            else if (type === 'error') { emit({ type: 'error', message: data?.message ?? data?.code ?? 'Jarvis error' }); close() }
            else if (type === 'run-end') close()
        }
    })
    ws.addEventListener('close', () => { if (busy) { emit({ type: 'error', message: 'Lost connection to Home Assistant' }); close() } })
    ws.addEventListener('error', () => {})
}
