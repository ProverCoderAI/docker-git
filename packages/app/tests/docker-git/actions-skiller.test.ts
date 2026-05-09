import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import { openSkillerApp } from "../../src/web/actions-skiller.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const openSkillerMock = vi.hoisted(() => vi.fn())
const openUrlMock = vi.hoisted(() => vi.fn())

const proofScope = {
  containerCodexSkillsPath: "/home/dev/.codex/skills",
  containerHomePath: "/home/dev",
  containerName: "dg-project",
  containerProjectPath: "/home/dev/app",
  hostCodexSkillsPath: "/var/lib/docker/volumes/dg-project-home/_data/.codex/skills",
  hostHomePath: "/var/lib/docker/volumes/dg-project-home/_data",
  hostProjectPath: "/var/lib/docker/volumes/dg-project-home/_data/app",
  projectId: "/home/dev/.docker-git/project",
  projectKey: "abc123",
  sshUser: "dev"
}

const skillerLaunch = (
  overrides: {
    readonly alreadyRunning?: boolean
    readonly scope?: null | {
      readonly containerCodexSkillsPath: string
      readonly containerHomePath: string
      readonly containerName: string
      readonly containerProjectPath: string
      readonly hostCodexSkillsPath: string
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

const mockScopedSkillerLaunch = (): void => {
  openUrlMock.mockReturnValue(true)
  openSkillerMock.mockImplementation(() =>
    Effect.succeed(skillerLaunch({
      alreadyRunning: true,
      scope: proofScope
    }))
  )
}

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
        expect(openSkillerMock).toHaveBeenCalledWith(undefined, undefined)
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

  it.effect("opens the session-scoped Skiller URL immediately from a terminal session", () =>
    Effect.gen(function*(_) {
      mockScopedSkillerLaunch()
      const { context, setMessage } = makeBrowserActionContext()

      openSkillerApp(context, "abc123", "terminal-proof")

      expect(openUrlMock).toHaveBeenCalledWith("/api/ssh/session/terminal-proof/skiller/app/")
      yield* _(waitForAssertion(() => {
        expect(openSkillerMock).toHaveBeenCalledWith("abc123", "terminal-proof")
      }))
      yield* _(waitForAssertion(() => {
        expect(setMessage).toHaveBeenCalledWith(
          "Skiller is already running (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log. Container FS: dg-project:/home/dev/app. Opened /api/ssh/session/terminal-proof/skiller/app/."
        )
      }))
      expect(openUrlMock).toHaveBeenCalledTimes(1)
    }))
})
