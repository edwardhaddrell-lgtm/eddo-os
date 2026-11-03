// If the app is killed without closing the device session (crash, Task Manager,
// power loss), the Loupedeck ignores the next handshake until it's replugged.
// Tested 2026-10-23: sending a websocket close frame first resets it, so patch
// the library's serial connect to always do that before the handshake.

import SerialConnection from 'loupedeck/connections/serial.js'
import { MagicByteLengthParser } from 'loupedeck/parser.js'
import { SerialPort } from 'serialport'

const WS_UPGRADE_HEADER = 'GET /index.html\nHTTP/1.1\nConnection: Upgrade\nUpgrade: websocket\nSec-WebSocket-Key: 123abc\n\n'
const WS_CLOSE_FRAME = Buffer.from([0x88, 0x80, 0x00, 0x00, 0x00, 0x00])
const HANDSHAKE_TIMEOUT_MS = 3000

SerialConnection.prototype.connect = async function connect(this: any) {
    this.connection = new SerialPort({ path: this.path, baudRate: 256000 })
    this.connection.on('error', this.onError.bind(this))
    this.connection.on('close', this.onDisconnect.bind(this))
    await new Promise(res => this.connection.once('open', res))

    // End any session a previous run left open, then let the device settle.
    this.connection.write(WS_CLOSE_FRAME)
    await new Promise(r => setTimeout(r, 300))
    this.connection.read() // drop anything it sent back

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Handshake timed out')), HANDSHAKE_TIMEOUT_MS)
        const onData = (buff: Buffer) => {
            if (!buff.toString().startsWith('HTTP/1.1')) return // ignore stray bytes
            clearTimeout(timer)
            this.connection.off('data', onData)
            resolve()
        }
        this.connection.on('data', onData)
        this.connection.write(WS_UPGRADE_HEADER)
    }).catch(err => {
        // Close and report it as an error disconnect so the library retries.
        this.connection.removeAllListeners('close')
        this.connection.close()
        this.onDisconnect(err)
        throw err
    })

    const parser = new MagicByteLengthParser({ magicByte: 0x82 })
    this.connection.pipe(parser)
    parser.on('data', this.emit.bind(this, 'message'))
    this.emit('connect', { address: this.path })
}
