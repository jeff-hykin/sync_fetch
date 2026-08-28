// Synchronous calls into async code for Deno, via a Web Worker +
// SharedArrayBuffer + Atomics.wait. The calling thread blocks while the worker
// thread does the async work (e.g. fetch), so this works even in places that
// can never await — like a synchronous interpreter mid-expression.
//
// Two things make this non-obvious in Deno (as of 2.5):
//   1. Worker.unref() doesn't exist, so a lingering idle worker would keep the
//      process alive forever. The worker therefore closes ITSELF after sitting
//      idle (see worker.js), and the caller re-spawns one on demand.
//   2. That self-close races with a new call claiming the worker. The claim is
//      an Atomics.compareExchange on a shared state slot, so exactly one side
//      wins: either the call marks the worker BUSY (timer sees BUSY, does
//      nothing) or the worker already closed (claim fails, spawn a fresh one).
//
// control buffer layout (Int32Array of 3):
//   [0] result-ready flag (the Atomics.wait target)
//   [1] result byte length
//   [2] worker state: 0 = closed, 1 = idle, 2 = busy

const STATE_IDLE = 1
const STATE_BUSY = 2

/**
 * @param {string|URL} workerUrl - module that calls serveSync() from worker.js
 * @param {{maxResultBytes?: number}} [options]
 * @returns {(payload: any) => any} blocks until the worker's handler resolves;
 *   returns the handler's (JSON-serializable) result or throws its error
 */
export function createSyncCaller(workerUrl, { maxResultBytes = 64 * 1024 * 1024 } = {}) {
    let worker = null
    let control = null
    let data = null
    return function callSync(payload) {
        if (worker == null || Atomics.compareExchange(control, 2, STATE_IDLE, STATE_BUSY) !== STATE_IDLE) {
            const controlBuffer = new SharedArrayBuffer(12)
            control = new Int32Array(controlBuffer)
            data = new SharedArrayBuffer(0, { maxByteLength: maxResultBytes })
            Atomics.store(control, 2, STATE_BUSY)
            worker = new Worker(workerUrl, { type: "module" })
            worker.postMessage({ kind: "init", controlBuffer, dataBuffer: data })
        }
        Atomics.store(control, 0, 0)
        worker.postMessage(payload)
        Atomics.wait(control, 0, 0)
        const result = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 0, control[1])))
        if (result.error != null) {
            throw new Error(result.error)
        }
        return result.value
    }
}

let fetchCaller = null

/**
 * Synchronous fetch. Blocks the calling thread until the response arrives.
 * @param {string} url
 * @param {RequestInit} [init] - must be JSON-serializable (no streams/signals)
 * @returns {{ok: boolean, status: number, statusText: string, headers: Record<string,string>, text: string}}
 */
export function fetchSync(url, init) {
    if (fetchCaller == null) {
        fetchCaller = createSyncCaller(new URL("./fetch_worker.js", import.meta.url))
    }
    return fetchCaller({ url, init })
}
