import { NodeContext } from "@effect/platform-node"
import { Effect } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { MenuError } from "../../src/docker-git/menu-errors.js"
import type { MenuEnv } from "../../src/docker-git/menu-types.js"
import type { ProjectItem } from "../../src/docker-git/project-item.js"
import { makeProjectItem } from "./fixtures/project-item.js"

const openResolvedProjectSshViaControllerWithUpMock = vi.hoisted(() => vi.fn((_item: ProjectItem) => Effect.void))
const openResolvedProjectSshWithUpMock = vi.hoisted(() => vi.fn((_item: ProjectItem) => Effect.void))

vi.mock("../../src/docker-git/menu-api.js", () => ({
  deleteMenuProject: vi.fn(() => Effect.void),
  downMenuProject: vi.fn(() => Effect.void),
  listMenuRunningProjectItems: Effect.succeed([])
}))

vi.mock("../../src/docker-git/menu-errors.js", () => ({
  renderMenuError: vi.fn(() => "menu error")
}))

vi.mock("../../src/docker-git/menu-project-auth.js", () => ({
  openProjectAuthSelection: vi.fn()
}))

vi.mock("../../src/docker-git/menu-select-runtime.js", () => ({
  loadRuntimeByProject: vi.fn(() => Effect.succeed({}))
}))

vi.mock("../../src/docker-git/menu-select-view.js", () => ({
  startSelectView: vi.fn()
}))

vi.mock("../../src/docker-git/menu-shared.js", () => ({
  pauseOnError: vi.fn(() => {}),
  resetToMenu: vi.fn(),
  resumeSshWithSkipInputs: vi.fn(() => {}),
  resumeWithSkipInputs: vi.fn(() => {}),
  withSuspendedTui: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect
}))

vi.mock("../../src/docker-git/open-project.js", () => ({
  openResolvedProjectSshViaControllerWithUp: openResolvedProjectSshViaControllerWithUpMock,
  openResolvedProjectSshWithUp: openResolvedProjectSshWithUpMock
}))

const loadMenuSelectActions = Effect.tryPromise({
  try: () => import("../../src/docker-git/menu-select-actions.js"),
  catch: (error) => (error instanceof Error ? error : new Error(String(error)))
})

const makeContext = () => {
  const messages: Array<string | null> = []
  const sshActiveStates: Array<boolean> = []
  const runnerRunEffect = vi.fn(<E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) => {
    Effect.runSync(effect.pipe(Effect.provide(NodeContext.layer)))
  })
  const runnerRunInteractiveEffect = vi.fn(<E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) => {
    Effect.runSync(effect.pipe(Effect.provide(NodeContext.layer)))
  })

  return {
    activeDir: null,
    messages,
    runner: {
      runEffect: runnerRunEffect,
      runInteractiveEffect: runnerRunInteractiveEffect
    },
    runnerRunEffect,
    runnerRunInteractiveEffect,
    setActiveDir: vi.fn(),
    setMessage: (message: string | null) => {
      messages.push(message)
    },
    setSkipInputs: vi.fn(),
    setSshActive: (isActive: boolean) => {
      sshActiveStates.push(isActive)
    },
    setView: vi.fn(),
    sshActiveStates
  }
}

describe("menu-select-actions", () => {
  beforeEach(() => {
    openResolvedProjectSshViaControllerWithUpMock.mockReset()
    openResolvedProjectSshViaControllerWithUpMock.mockImplementation((_item: ProjectItem) => Effect.void)
    openResolvedProjectSshWithUpMock.mockReset()
    openResolvedProjectSshWithUpMock.mockImplementation((_item: ProjectItem) => Effect.void)
    vi.resetModules()
  })

  it("routes Connect + SSH through the controller session launcher", () =>
    Effect.gen(function*(_) {
      const { runConnectSelection } = yield* _(loadMenuSelectActions)
      const selected = makeProjectItem({
        projectDir: "/controller/provercoderai/docker-git/main"
      })
      const context = makeContext()

      runConnectSelection(selected, context, false)

      expect(openResolvedProjectSshViaControllerWithUpMock).toHaveBeenCalledTimes(1)
      expect(openResolvedProjectSshViaControllerWithUpMock).toHaveBeenCalledWith(selected)
      expect(openResolvedProjectSshWithUpMock).not.toHaveBeenCalled()
      expect(context.runnerRunInteractiveEffect).toHaveBeenCalledTimes(1)
      expect(context.runnerRunEffect).not.toHaveBeenCalled()
      expect(context.messages).toEqual([
        `Connecting to ${selected.displayName}...`,
        "SSH session ended. Press Esc to return to the menu."
      ])
      expect(context.sshActiveStates).toEqual([true, false])
    }).pipe(Effect.runPromise))
})
