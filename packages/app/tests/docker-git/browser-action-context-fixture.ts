import { Effect } from "effect"
import { vi } from "vitest"

import type { BrowserActionContext } from "../../src/web/actions-shared.js"

export const waitForAssertion = (assertion: () => void) =>
  Effect.tryPromise({
    catch: (error) => error,
    try: () => vi.waitFor(assertion)
  })

export const makeBrowserActionContext = (
  overrides: Partial<BrowserActionContext> = {}
) => {
  let output = ""
  const setOutput: BrowserActionContext["setOutput"] = (next) => {
    output = typeof next === "function" ? next(output) : next
  }
  const reloadDashboard = vi.fn()
  const setMessage = vi.fn()
  const setProjectBrowser = vi.fn()

  return {
    context: {
      githubStatus: null,
      portForwardInput: "",
      reloadDashboard,
      selectedProjectId: null,
      selectedProjectName: null,
      setActionPrompt: vi.fn(),
      setActiveScreen: vi.fn(),
      setAuthSnapshot: vi.fn(),
      setBusyLabel: vi.fn(),
      setGithubStatus: vi.fn(),
      setMessage,
      setOutput,
      setPortForwardInput: vi.fn(),
      setPortForwards: vi.fn(),
      setProjectAuthSnapshot: vi.fn(),
      setProjectBrowser,
      setSelectedMenuIndex: vi.fn(),
      setSelectedProject: vi.fn(),
      setSelectedProjectId: vi.fn(),
      setTerminalSession: vi.fn(),
      ...overrides
    } satisfies BrowserActionContext,
    output: () => output,
    reloadDashboard,
    setMessage,
    setProjectBrowser
  }
}
