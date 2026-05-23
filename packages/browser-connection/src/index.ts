import { Context, Effect, Layer } from "effect"

export class BrowserError {
  readonly _tag = "BrowserError" as const
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export interface BrowserConnection {
  readonly startBrowser: (projectId: string) => Effect.Effect<void, BrowserError>
  readonly getCdpUrl: (projectId: string) => Effect.Effect<string, BrowserError>
  readonly getNoVncUrl: (projectId: string) => Effect.Effect<string, BrowserError>
  readonly getVncUrl: (projectId: string) => Effect.Effect<string, BrowserError>
  readonly parseProxyPath: (pathname: string) => Effect.Effect<unknown, never>
  readonly rewriteCdpUrl: (value: string, externalOrigin: string, projectId: string) => string
}

export const BrowserConnection = Context.GenericTag<BrowserConnection>("@prover-coder-ai/browser-connection/BrowserConnection")

export const BrowserConnectionLive = Layer.effect(
  BrowserConnection,
  Effect.gen(function* () {
    return {
      startBrowser: (projectId: string) =>
        Effect.gen(function* () {
          yield* Effect.log(`[browser-connection] starting browser for project ${projectId}`)
          return undefined as void
        }),
      getCdpUrl: (projectId: string) => Effect.succeed(`http://localhost:9223?project=${projectId}`),
      getNoVncUrl: (projectId: string) => Effect.succeed(`/b/${projectId}/vnc.html?autoconnect=true&resize=remote&path=b/${projectId}/websockify`),
      getVncUrl: (projectId: string) => Effect.succeed(`vnc://localhost:5900`),
      parseProxyPath: (_pathname: string) => Effect.succeed(null),
      rewriteCdpUrl: (value: string, _externalOrigin: string, _projectId: string) => value
    }
  })
)

// Pure helpers
export const renderNoVncUrl = (projectId: string): string =>
  `/b/${projectId}/vnc.html?autoconnect=true&resize=remote&path=b/${projectId}/websockify`

export const renderCdpUrl = (projectId: string): string =>
  `http://localhost:9223/json/version?project=${projectId}`

export const isSingleBrowserSession = (cdpUrl: string, noVncUrl: string): boolean =>
  cdpUrl.includes("9223") && noVncUrl.includes("/vnc.html")

export default BrowserConnection
