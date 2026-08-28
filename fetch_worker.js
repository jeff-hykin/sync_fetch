import { serveSync } from "./worker.js"

serveSync(async ({ url, init }) => {
    const response = await fetch(url, init)
    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        text: await response.text(),
    }
})
