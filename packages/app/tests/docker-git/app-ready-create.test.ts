import type { SetStateAction } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  type CreateFlowView,
  createInitialFlowView,
  resolveCreateFlowSteps
} from "../../src/docker-git/menu-create-shared.js"
import type { BrowserActionContext } from "../../src/web/actions.js"
import { submitCreateView } from "../../src/web/app-ready-create.js"

const createSetter = <A>() => vi.fn((_value: SetStateAction<A>) => {})

const createBrowserActionContext = (): BrowserActionContext => ({
  addTerminalSession: vi.fn(),
  databaseConnectionInput: "",
  databaseLabelInput: "",
  githubStatus: {
    summary: "ok",
    tokens: [{ key: "GITHUB_TOKEN", label: "default", login: "octocat", status: "valid" }]
  },
  portForwardInput: "",
  reloadDashboard: vi.fn(),
  selectedProjectId: null,
  selectedProjectKey: null,
  selectedProjectName: null,
  setActionPrompt: vi.fn(),
  setActiveScreen: createSetter(),
  setAuthSnapshot: createSetter(),
  setBusyLabel: createSetter(),
  setDatabaseConnectionInput: createSetter(),
  setDatabaseForwards: createSetter(),
  setDatabaseLabelInput: createSetter(),
  setDatabaseProfiles: createSetter(),
  setDatabaseSession: createSetter(),
  setGithubStatus: createSetter(),
  setMessage: vi.fn(),
  setOutput: createSetter(),
  setPortForwardInput: createSetter(),
  setPortForwards: createSetter(),
  setProjectAuthSnapshot: createSetter(),
  setProjectBrowser: createSetter(),
  setProjectTaskLogs: createSetter(),
  setProjectTasks: createSetter(),
  setSelectedMenuIndex: createSetter(),
  setSelectedProject: createSetter(),
  setSelectedProjectId: createSetter()
})

const submitCreateBuffer = (buffer: string) => {
  const context = createBrowserActionContext()
  const setCreateView = createSetter<CreateFlowView>()

  submitCreateView({
    context,
    controllerCwd: "/workspace",
    createView: createInitialFlowView(buffer),
    projectsRoot: "/home/dev/.docker-git",
    setCreateView
  })

  return { context, setCreateView }
}

describe("app-ready-create", () => {
  it("advances to the next create field on Enter for a repo URL", () => {
    const { context, setCreateView } = submitCreateBuffer("https://github.com/org/repo/tree/feature-x --force")

    expect(setCreateView).toHaveBeenCalledTimes(1)
    const nextViewAction = setCreateView.mock.calls[0]?.[0]
    if (nextViewAction === undefined || typeof nextViewAction === "function") {
      throw new Error("Expected create view object update")
    }
    const nextView = nextViewAction
    expect(nextView).toMatchObject({
      step: 1,
      values: {
        force: true,
        outDir: "/home/dev/.docker-git/org/repo",
        repoRef: "feature-x",
        repoUrl: "https://github.com/org/repo/tree/feature-x"
      }
    })
    expect(resolveCreateFlowSteps(nextView.values)).toEqual([
      "repoUrl",
      "cpuLimit",
      "ramLimit",
      "runUp",
      "mcpPlaywright"
    ])
    expect(context.setMessage).toHaveBeenCalledWith(null)
  })

  it("shows a parse error instead of submitting on invalid inline flags", () => {
    const { context, setCreateView } = submitCreateBuffer("https://github.com/org/repo --bogus")

    expect(setCreateView).not.toHaveBeenCalled()
    expect(context.setMessage).toHaveBeenCalledWith("Missing value for option: --bogus")
  })
})
