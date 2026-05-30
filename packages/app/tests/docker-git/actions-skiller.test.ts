import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { afterEach, beforeEach, vi } from "vitest"

import { openSkillerApp } from "../../src/web/actions-skiller.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"
import { type BrowserOpenMockWindow, makeBrowserOpenMockWindow, stubBrowserOpen } from "./browser-open-fixture.js"

const openSkillerMock = vi.hoisted(() => vi.fn())

const proofScope = {
  containerCodexSkillsPath: "/home/dev/.codex/skills",
  containerHomePath: "/home/dev",
  containerName: "dg-project",
  containerProjectPath: "/home/dev/app",
  hostCodexSkillsPath: "/var/lib/docker/volumes/dg-project-home/_data/.codex/skills",
  hostEnvGlobalPath: "/home/dev/.docker-git/project/.docker-git/.orch/env/global.env",
  hostHomePath: "/var/lib/docker/volumes/dg-project-home/_data",
  hostProjectPath: "/var/lib/docker/volumes/dg-project-home/_data/app",
  projectId: "/home/dev/.docker-git/project",
  projectKey: "abc123",
  sshUser: "dev"
}

const skillerLaunch = (
  overrides: {
    readonly alreadyRunning?: boolean
    readonly appPath?: string
    readonly scope?: null | {
      readonly containerCodexSkillsPath: string
      readonly containerHomePath: string
      readonly containerName: string
      readonly containerProjectPath: string
      readonly hostCodexSkillsPath: string
      readonly hostEnvGlobalPath: string
      readonly hostHomePath: string
      readonly hostProjectPath: string
      readonly projectId: string
      readonly projectKey: string
      readonly sshUser: string
    }
    readonly trpcBasePath?: string
  } = {}
) => ({
  alreadyRunning: overrides.alreadyRunning ?? false,
  appPath: overrides.appPath ?? "/api/skiller/app/",
  logPath: "/home/dev/.docker-git/logs/skiller.log",
  ok: true,
  pid: 1234,
  scope: overrides.scope ?? null,
  startedAtIso: "2026-05-09T17:30:00.000Z",
  trpcBasePath: overrides.trpcBasePath ?? "/api/skiller",
  trpcPort: 17_888
})

const mockScopedSkillerLaunch = (): void => {
  openSkillerMock.mockImplementation(() =>
    Effect.succeed(skillerLaunch({
      alreadyRunning: true,
      scope: proofScope
    }))
  )
}

const skillerPathCharArbitrary = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("")
)
const skillerPathArbitrary = fc
  .array(skillerPathCharArbitrary, { minLength: 1, maxLength: 24 })
  .map((chars) => `/api/skiller/app/${chars.join("")}/`)
const projectKeyArbitrary = fc
  .array(skillerPathCharArbitrary, { minLength: 1, maxLength: 18 })
  .map((chars) => chars.join(""))

vi.mock("../../src/web/api.js", () => ({
  openSkiller: openSkillerMock
}))

describe("web Skiller actions", () => {
  let openedWindow: BrowserOpenMockWindow = makeBrowserOpenMockWindow()
  let browserOpenMock: ReturnType<typeof vi.fn> = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    openedWindow = makeBrowserOpenMockWindow()
    browserOpenMock = stubBrowserOpen(openedWindow)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect("opens Skiller through the docker-git API", () =>
    Effect.gen(function*(_) {
      openSkillerMock.mockImplementation(() => Effect.succeed(skillerLaunch()))
      const { context, setMessage } = makeBrowserActionContext()

      openSkillerApp(context)

      expect(browserOpenMock).toHaveBeenCalledWith("about:blank", "_blank")
      expect(setMessage).toHaveBeenCalledWith("Opening Skiller...")
      yield* _(waitForAssertion(() => {
        expect(openSkillerMock).toHaveBeenCalledWith(undefined, undefined)
      }))
      yield* _(waitForAssertion(() => {
        expect(openedWindow.location.href).toBe("/api/skiller/app/")
        expect(openedWindow.focus).toHaveBeenCalledOnce()
        expect(setMessage).toHaveBeenCalledWith(
          "Skiller launch started (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log. Opened /api/skiller/app/."
        )
      }))
      expect(context.setBusyLabel).toHaveBeenCalledWith("Opening Skiller")
      expect(context.setBusyLabel).toHaveBeenLastCalledWith(null)
    }))

  it.effect("opens Skiller for the selected project key", () =>
    Effect.gen(function*(_) {
      mockScopedSkillerLaunch()
      const { context, setMessage } = makeBrowserActionContext({ selectedProjectKey: "abc123" })

      openSkillerApp(context)

      yield* _(waitForAssertion(() => {
        expect(openSkillerMock).toHaveBeenCalledWith("abc123", undefined)
      }))
      yield* _(waitForAssertion(() => {
        expect(setMessage).toHaveBeenCalledWith(
          "Skiller is already running (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log. Container FS: dg-project:/home/dev/app. Opened /api/skiller/app/."
        )
      }))
    }))

  it.effect("opens the session-scoped Skiller URL after the backend registers the scope", () =>
    Effect.gen(function*(_) {
      let completeLaunch = (_launch: ReturnType<typeof skillerLaunch>): void => {
        throw new Error("Expected Skiller launch effect to be subscribed.")
      }
      openSkillerMock.mockImplementation(() =>
        Effect.async<ReturnType<typeof skillerLaunch>>((resume) => {
          completeLaunch = (launch) => {
            resume(Effect.succeed(launch))
          }
        })
      )
      const { context, setMessage } = makeBrowserActionContext()

      openSkillerApp(context, "abc123", "terminal-proof")

      expect(browserOpenMock).toHaveBeenCalledOnce()
      expect(openedWindow.location.href).toBe("")
      yield* _(waitForAssertion(() => {
        expect(openSkillerMock).toHaveBeenCalledWith("abc123", "terminal-proof")
      }))
      completeLaunch(skillerLaunch({
        alreadyRunning: true,
        appPath: "/api/ssh/session/terminal-proof/skiller/app/",
        scope: proofScope,
        trpcBasePath: "/api/ssh/session/terminal-proof/skiller"
      }))
      yield* _(waitForAssertion(() => {
        expect(openedWindow.location.href).toBe("/api/ssh/session/terminal-proof/skiller/app/")
        expect(setMessage).toHaveBeenCalledWith(
          "Skiller is already running (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log. Container FS: dg-project:/home/dev/app. Opened /api/ssh/session/terminal-proof/skiller/app/."
        )
      }))
      expect(openedWindow.focus).toHaveBeenCalledOnce()
    }))

  it.effect("closes the prepared Skiller popup when launch fails", () =>
    Effect.gen(function*(_) {
      openSkillerMock.mockImplementation(() => Effect.fail("Skiller failed"))
      const { context, setMessage } = makeBrowserActionContext()

      openSkillerApp(context, "abc123", "terminal-proof")

      yield* _(waitForAssertion(() => {
        expect(openedWindow.close).toHaveBeenCalledOnce()
        expect(openedWindow.location.href).toBe("")
        expect(setMessage).toHaveBeenCalledWith("Skiller failed")
      }))
    }))

  it.effect("keeps Skiller popup URL and launch message consistent for generated app paths", () =>
    Effect.tryPromise({
      catch: (error) => error,
      try: () =>
        fc.assert(
          fc.asyncProperty(skillerPathArbitrary, projectKeyArbitrary, (appPath, projectKey) =>
            Effect.runPromise(
              Effect.gen(function*(_) {
                vi.unstubAllGlobals()
                vi.clearAllMocks()
                openedWindow = makeBrowserOpenMockWindow()
                browserOpenMock = stubBrowserOpen(openedWindow)
                const scopedLaunch = skillerLaunch({
                  appPath,
                  scope: {
                    ...proofScope,
                    projectKey
                  }
                })
                openSkillerMock.mockImplementation(() => Effect.succeed(scopedLaunch))
                const { context, setMessage } = makeBrowserActionContext({ selectedProjectKey: projectKey })

                openSkillerApp(context)

                expect(browserOpenMock).toHaveBeenCalledWith("about:blank", "_blank")
                yield* _(waitForAssertion(() => {
                  expect(openSkillerMock).toHaveBeenCalledWith(projectKey, undefined)
                }))
                yield* _(waitForAssertion(() => {
                  expect(openedWindow.location.href).toBe(appPath)
                  expect(openedWindow.focus).toHaveBeenCalledOnce()
                  expect(setMessage).toHaveBeenCalledWith(
                    `Skiller launch started (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log. ` +
                      `Container FS: dg-project:/home/dev/app. Opened ${appPath}.`
                  )
                }))
                expect(context.setBusyLabel).toHaveBeenCalledWith("Opening Skiller")
                expect(context.setBusyLabel).toHaveBeenLastCalledWith(null)
              }).pipe(
                Effect.ensuring(Effect.sync(() => {
                  vi.unstubAllGlobals()
                }))
              )
            )
          ),
          { numRuns: 20 }
        )
    }))
})
