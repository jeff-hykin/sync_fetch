// Worker-side half of the protocol — see main.js for the full picture.
// Usage, inside the worker module you point createSyncCaller() at:
//
//     import { serveSync } from ".../worker.js"
//     serveSync(async (payload) => { ... return jsonSerializable })

const STATE_CLOSED = 0
const STATE_IDLE = 1

/**
 * @param {(payload: any) => Promise<any>|any} handler
 * @param {{idleMs?: number}} [options] - how long to sit idle before the
 *   worker closes itself (nothing can unref a Deno worker, so an idle one
 *   would otherwise keep the whole process alive)
 */
export function serveSync(handler, { idleMs = 1000 } = {}) {
    let control = null
    let dataBuffer = null
    self.onmessage = async (event) => {
        const payload = event.data
        if (payload && payload.kind === "init") {
            control = new Int32Array(payload.controlBuffer)
            dataBuffer = payload.dataBuffer
            return
        }
        let result
        try {
            result = { value: await handler(payload) }
        } catch (error) {
            result = { error: error?.message || String(error) }
        }
        const bytes = new TextEncoder().encode(JSON.stringify(result))
        if (dataBuffer.byteLength < bytes.length) {
            dataBuffer.grow(bytes.length)
        }
        new Uint8Array(dataBuffer).set(bytes)
        control[1] = bytes.length
        Atomics.store(control, 2, STATE_IDLE)
        Atomics.store(control, 0, 1)
        Atomics.notify(control, 0)

        // the compare-exchange loses to a caller that has already claimed us
        // (BUSY), in which case the next response re-arms the timer
        setTimeout(() => {
            if (Atomics.compareExchange(control, 2, STATE_IDLE, STATE_CLOSED) === STATE_IDLE) {
                self.close()
            }
        }, idleMs)
    }
}
