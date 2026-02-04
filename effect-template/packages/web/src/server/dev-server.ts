import { Effect } from "effect"
import next from "next"
import { createServer } from "node:http"
import path from "node:path"
import { WebSocketServer } from "ws"

import { attachTerminalWs } from "./terminal-ws"

const dev = process.env.NODE_ENV !== "production"
const port = Number(process.env.PORT ?? "3000")
const appDir = path.resolve(__dirname, "..", "..")

const app = next({ dev, dir: appDir })
const handle = app.getRequestHandler()

const server = createServer((req, res) => {
  handle(req, res)
})

const wss = new WebSocketServer({ server, path: "/ws/terminal" })
attachTerminalWs(wss)

const startServer = Effect.tryPromise({
  try: () => app.prepare(),
  catch: (error) => error
}).pipe(
  Effect.tap(() =>
    Effect.sync(() => {
      server.listen(port, () => {
        console.log(`docker-git web ready on http://localhost:${port}`)
      })
    })
  )
)

Effect.runPromise(startServer).catch((error: unknown) => {
  console.error("Failed to start dev server", error)
  process.exit(1)
})
