import { assertEquals, assertThrows, assert } from "jsr:@std/assert"
import { fetchSync, createSyncCaller } from "../main.js"

Deno.test("fetchSync - data URL", () => {
    const result = fetchSync("data:text/plain,hello%20world")
    assertEquals(result.ok, true)
    assertEquals(result.text, "hello world")
})

Deno.test("fetchSync - worker reuse (second call while worker is idle)", () => {
    assertEquals(fetchSync("data:text/plain,one").text, "one")
    assertEquals(fetchSync("data:text/plain,two").text, "two")
})

Deno.test("fetchSync - worker respawn (after idle self-close)", async () => {
    assertEquals(fetchSync("data:text/plain,before").text, "before")
    await new Promise((resolve) => setTimeout(resolve, 1500))
    assertEquals(fetchSync("data:text/plain,after").text, "after")
})

Deno.test("fetchSync - handler errors become thrown Errors", () => {
    assertThrows(() => fetchSync("not-a-valid-url"), Error)
})

Deno.test("fetchSync - real network round trip", () => {
    let result
    try {
        result = fetchSync("https://example.com")
    } catch (error) {
        console.warn("skipping network assertion (offline?):", error.message)
        return
    }
    assertEquals(result.status, 200)
    assert(result.text.includes("Example Domain"))
})

Deno.test("createSyncCaller - custom worker", () => {
    const workerCode = `
        import { serveSync } from "${new URL("../worker.js", import.meta.url)}"
        serveSync(async ({ a, b }) => a + b)
    `
    const callSync = createSyncCaller(`data:application/javascript,${encodeURIComponent(workerCode)}`)
    assertEquals(callSync({ a: 2, b: 3 }), 5)
})
