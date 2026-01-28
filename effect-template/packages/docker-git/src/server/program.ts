import { HttpMiddleware, HttpServer, HttpServerRequest } from "@effect/platform"
import { NodeContext, NodeHttpServer } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import * as Option from "effect/Option"
import { createServer } from "node:http"

import { resolveProjectsRoot } from "./core/domain.js"
import { makeRouter } from "./http.js"
import { ensurePortsFree } from "./ports.js"
import { attachTerminalBridge } from "./terminal.js"

const resolvePort = (env: Record<string, string | undefined>): number => {
  const raw = env["DOCKER_GIT_PORT"] ?? env["PORT"]
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3333
}

const resolveTerminalPort = (env: Record<string, string | undefined>, httpPort: number): number => {
  const raw = env["DOCKER_GIT_TERM_PORT"] ?? env["DOCKER_GIT_WS_PORT"]
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  const candidate = Number.isFinite(parsed) && parsed > 0 ? parsed : httpPort + 1
  return candidate === httpPort ? httpPort + 1 : candidate
}

// CHANGE: compose the HTTP server layer for docker-git
// WHY: provide a backend runtime for the orchestration UI
// QUOTE(ТЗ): "Просто сделай сайт и бекенд приложение"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall port: launch(port) -> server_listening(port)
// PURITY: SHELL
// EFFECT: Effect<void, ServeError, HttpServer>
// INVARIANT: router is mounted before listening
// COMPLEXITY: O(1)
export const program = (() => {
  const cwd = process.cwd()
  const projectsRoot = resolveProjectsRoot(cwd, process.env)
  const webRoot = `${cwd}/web`
  const vendorRoot = `${cwd}/node_modules`
  const port = resolvePort(process.env)
  const terminalPort = resolveTerminalPort(process.env, port)

  // CHANGE: add per-request logging middleware
  // WHY: trace every API call to understand server behavior
  // QUOTE(ТЗ): "Добавь логи на вызов каждого апи ендпоинта"
  // REF: user-request-2026-01-15
  // SOURCE: n/a
  // FORMAT THEOREM: forall req: log(req) -> log(res)
  // PURITY: SHELL
  // EFFECT: Effect<HttpMiddleware, never, never>
  // INVARIANT: does not alter response semantics
  // COMPLEXITY: O(1)
  const requestLogger = HttpMiddleware.make((httpApp) =>
    Effect.gen(function* (_) {
      const request = yield* _(HttpServerRequest.HttpServerRequest)
      const start = Date.now()
      const id = `${start}-${Math.floor(Math.random() * 1e6)}`
      const remote = Option.getOrElse(request.remoteAddress, () => "unknown")
      const userAgent = request.headers["user-agent"] ?? ""
      const contentType = request.headers["content-type"] ?? ""
      const contentLength = request.headers["content-length"] ?? ""
      yield* _(
        Console.log(
          `[req ${id}] ${request.method} ${request.url} remote=${remote} ct="${contentType}" len="${contentLength}" ua="${userAgent}"`
        )
      )
      return yield* _(
        httpApp.pipe(
          Effect.tap((response) =>
            Console.log(
              `[res ${id}] ${request.method} ${request.url} status=${response.status} ms=${Date.now() - start}`
            )
          ),
          Effect.tapError((error) =>
            Console.error(
              `[err ${id}] ${request.method} ${request.url} ${String(error)}`
            )
          )
        )
      )
    })
  )

  const router = makeRouter({ cwd, projectsRoot, webRoot, vendorRoot, terminalPort })
  const app = router.pipe(HttpServer.serve(requestLogger), HttpServer.withLogAddress)
  const server = createServer()
  const serverLayer = NodeHttpServer.layer(() => server, { port })
  const preflight = ensurePortsFree([port, terminalPort], cwd).pipe(
    Effect.provide(NodeContext.layer)
  )

  const boot = Effect.scoped(
    preflight.pipe(
      Effect.tap(() =>
        Console.log(`docker-git ports ready http=${port} ws=${terminalPort}`)
      ),
      Effect.zipRight(
        attachTerminalBridge(terminalPort, projectsRoot, cwd).pipe(
          Effect.tap(() => Console.log(`Terminal bridge listening on ws://0.0.0.0:${terminalPort}`)),
          Effect.zipRight(Layer.launch(Layer.provide(app, serverLayer)))
        )
      )
    )
  )

  const startup = Console.log(
    `docker-git boot cwd=${cwd} root=${projectsRoot} web=${webRoot} vendor=${vendorRoot} http=${port} ws=${terminalPort}`
  )

  const formatError = (error: unknown): string =>
    error instanceof Error ? error.stack ?? error.message : String(error)

  return startup.pipe(
    Effect.zipRight(boot),
    Effect.tapError((error) => Console.error(`docker-git fatal: ${formatError(error)}`))
  )
})()
