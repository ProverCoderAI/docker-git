import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import { openSkillerApp } from "../../src/web/actions-skiller.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const openSkillerMock = vi.hoisted(() => vi.fn())
const openUrlMock = vi.hoisted(() => vi.fn())

const skillerLaunch = (
  overrides: {
    readonly alreadyRunning?: boolean
    readonly scope?: null | {
      readonly containerHomePath: string
      readonly containerName: string
      readonly containerProjectPath: string
      readonly hostHomePath: string
      readonly hostProjectPath: string
      readonly projectId: string
      readonly projectKey: string
      readonly sshUser: string
    }
  } = {}
) => ({
  alreadyRunning: overrides.alreadyRunning ?? false,
  appPath: "/api/skiller/app/",
  logPath: "/home/dev/.docker-git/logs/skiller.log",
  ok: true,
  pid: 1234,
  scope: overrides.scope ?? null,
  startedAtIso: "2026-05-09T17:30:00.000Z",
  trpcBasePath: "/api/skiller",
  trpcPort: 17_888
})

vi.mock("../../src/web/api.js", () => ({
  openSkiller: openSkillerMock
}))

vi.mock("../../src/web/open-url.js", () => ({
  openUrl: openUrlMock
}))

describe("web Skiller actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.effect("opens Skiller through the docker-git API", () =>
    Effect.gen(function*(_) {
      openUrlMock.mockReturnValue(true)
      openSkillerMock.mockImplementation(() => Effect.succeed(skillerLaunch()))
      const { context, setMessage } = makeBrowserActionContext()

      openSkillerApp(context)

      yield* _(waitForAssertion(() => {
        expect(openSkillerMock).toHaveBeenCalledTimes(1)
      }))
      yield* _(waitForAssertion(() => {
        expect(openUrlMock).toHaveBeenCalledWith("/api/skiller/app/")
        expect(setMessage).toHaveBeenCalledWith(
          "Skiller launch started (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log. Opened /api/skiller/app/."
        )
      }))
      expect(context.setBusyLabel).toHaveBeenCalledWith("Opening Skiller")
      expect(context.setBusyLabel).toHaveBeenLastCalledWith(null)
    }))

  it.effect("opens Skiller for the selected project key", () =>
    Effect.gen(function*(_) {
      openUrlMock.mockReturnValue(true)
      openSkillerMock.mockImplementation(() =>
        Effect.succeed(skillerLaunch({
          alreadyRunning: true,
          scope: {
            containerHomePath: "/home/dev",
            containerName: "dg-project",
            containerProjectPath: "/home/dev/app",
            hostHomePath: "/var/lib/docker/volumes/dg-project-home/_data",
            hostProjectPath: "/var/lib/docker/volumes/dg-project-home/_data/app",
            projectId: "/home/dev/.docker-git/project",
            projectKey: "abc123",
            sshUser: "dev"
          }
        }))
      )
      const { context, setMessage } = makeBrowserActionContext({ selectedProjectKey: "abc123" })

      openSkillerApp(context)

      yield* _(waitForAssertion(() => {
        expect(openSkillerMock).toHaveBeenCalledWith("abc123")
      }))
      yield* _(waitForAssertion(() => {
        expect(setMessage).toHaveBeenCalledWith(
          "Skiller is already running (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log. Container FS: dg-project:/home/dev/app. Opened /api/skiller/app/."
        )
      }))
    }))
})
