# sync_fetch

Synchronous `fetch`, cause sometimes its needed.

Implemented with web workers and `Atomics.wait` and a `SharedArrayBuffer`.

## Usage

```js
import { fetchSync } from "https://raw.esm.sh/gh/jeff-hykin/sync_fetch@v1.0.0/main.js"

const { ok, status, headers, text } = fetchSync("https://example.com")
```

Or run your own async code synchronously with an inline worker:

```js
import { createSyncCaller } from "https://raw.esm.sh/gh/jeff-hykin/sync_fetch@v1.0.0/main.js"

const workerCode = `
    import { serveSync } from "https://raw.esm.sh/gh/jeff-hykin/sync_fetch@v1.0.0/worker.js"

    serveSync(async (payload) => {
        // any async work; return value must be JSON-serializable
        return await somethingAsync(payload)
    })
`
const callSync = createSyncCaller(URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" })))
const result = callSync({ some: "payload" }) // blocks until the handler resolves
```

If the handler throws, `callSync` throws an `Error` with the same message.

## How it works (and why it's shaped this way)

- The caller and worker share a 12-byte control `SharedArrayBuffer` (ready
  flag, result length, worker state) plus a growable data buffer for the JSON
  result. The caller posts a payload and parks on `Atomics.wait`; the worker
  computes, writes, and `Atomics.notify`s.
- Deno (as of 2.5) has **no `Worker.unref()`**, so a worker left running would
  keep your process alive forever. Instead the worker closes itself after ~1s
  idle. A caller claims a live worker with `Atomics.compareExchange` on the
  state slot, so the claim and the self-close can't race: exactly one wins, and
  a lost claim just spawns a fresh worker (~70ms, vs ~10ms for a reused one).
- The main thread's event loop is fully blocked during a call — that is the
  point — so don't call this from code that something else is awaiting on.

## Caveats

- Payloads and results go through JSON: no streams, no binary (use base64 if
  you must), no `AbortSignal` in `init`.
- `Atomics.wait` is not allowed on the main thread in browsers; this is for
  Deno (works in workers and the main thread there).
