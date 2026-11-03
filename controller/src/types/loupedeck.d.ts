// Minimal typings for the untyped foxxyz `loupedeck` package.
declare module 'loupedeck' {
    export function discover(args?: Record<string, unknown>): Promise<any>
    export const HAPTIC: Record<string, number>
}
declare module 'loupedeck/connections/serial.js' {
    const SerialConnection: any
    export default SerialConnection
}
declare module 'loupedeck/parser.js' {
    export const MagicByteLengthParser: any
}
