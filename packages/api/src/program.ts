import { HttpMiddleware, HttpServer, HttpServerRequest } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Console, Effect, Layer, Option } from "effect"
import { createServer } from "node:http"

import { makeRouter } from "./http.js"
import { initializeAgentState } from "./services/agents.js"

const resolvePort = (env: Record<string, string | undefined>): number => {
  const raw = env["DOCKER_GIT_API_PORT"] ?? env["PORT"]
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3334
}

const requestLogger = HttpMiddleware.make((httpApp) =>
  Effect.gen(function*(_) {
    const request = yield* _(HttpServerRequest.HttpServerRequest)
    const startedAt = Date.now()
    const id = `${startedAt}-${Math.floor(Math.random() * 1e6)}`
    const remote = Option.getOrElse(request.remoteAddress, () => "unknown")

    yield* _(Console.log(`[api req ${id}] ${request.method} ${request.url} remote=${remote}`))

    return yield* _(
      httpApp.pipe(
        Effect.tap((response) =>
          Console.log(
            `[api res ${id}] ${request.method} ${request.url} status=${response.status} ms=${Date.now() - startedAt}`
          )
        ),
        Effect.tapError((error) =>
          Console.error(`[api err ${id}] ${request.method} ${request.url} ${String(error)}`)
        )
      )
    )
  })
)

export const program = (() => {
  const port = resolvePort(process.env)
  const router = makeRouter()
  const app = router.pipe(HttpServer.serve(requestLogger), HttpServer.withLogAddress)
  const server = createServer()
  const serverLayer = NodeHttpServer.layer(() => server, { port })

  return Effect.scoped(
    Console.log(`docker-git api boot port=${port}`).pipe(
      Effect.zipRight(initializeAgentState()),
      Effect.zipRight(Layer.launch(Layer.provide(app, serverLayer)))
    )
  )
})()
