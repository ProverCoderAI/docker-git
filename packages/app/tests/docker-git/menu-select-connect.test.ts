import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import type { ProjectItem } from "../../src/docker-git/project-item.js"

import { selectHint } from "../../src/docker-git/menu-render-select.js"
import { buildConnectEffect, isConnectMcpToggleInput } from "../../src/docker-git/menu-select-connect.js"
import { recordEvent } from "./fixtures/event-recorder.js"
import { makeProjectItem } from "./fixtures/project-item.js"

const makeConnectDeps = (events: Array<string>) => ({
  connectWithUp: (selected: ProjectItem) => recordEvent(events, `connect:${selected.projectDir}`),
  enableMcpPlaywright: (projectDir: string) => recordEvent(events, `enable:${projectDir}`)
})

const workspaceProject = () =>
  makeProjectItem({
    projectDir: "/home/dev/provercoderai/docker-git/workspaces/org/repo",
    authorizedKeysPath: "/home/dev/provercoderai/docker-git/workspaces/org/repo/authorized_keys",
    envGlobalPath: "/home/dev/provercoderai/docker-git/workspaces/org/repo/.orch/env/global.env",
    envProjectPath: "/home/dev/provercoderai/docker-git/workspaces/org/repo/.orch/env/project.env",
    codexAuthPath: "/home/dev/provercoderai/docker-git/workspaces/org/repo/.orch/auth/codex"
  })

describe("menu-select-connect", () => {
  it("runs Playwright enable before SSH when toggle is ON", () => {
    const item = workspaceProject()
    const events: Array<string> = []
    Effect.runSync(buildConnectEffect(item, true, makeConnectDeps(events)))
    expect(events).toEqual([`enable:${item.projectDir}`, `connect:${item.projectDir}`])
  })

  it("skips Playwright enable when toggle is OFF", () => {
    const item = workspaceProject()
    const events: Array<string> = []
    Effect.runSync(buildConnectEffect(item, false, makeConnectDeps(events)))
    expect(events).toEqual([`connect:${item.projectDir}`])
  })

  it("parses connect toggle key from user input", () => {
    expect(isConnectMcpToggleInput("p")).toBe(true)
    expect(isConnectMcpToggleInput(" P ")).toBe(true)
    expect(isConnectMcpToggleInput("x")).toBe(false)
    expect(isConnectMcpToggleInput("")).toBe(false)
  })

  it("renders connect hint with current Playwright toggle state", () => {
    expect(selectHint("Connect", true)).toBe("Enter = start if needed + SSH, Esc = back")
    expect(selectHint("Connect", false)).toBe("Enter = start if needed + SSH, Esc = back")
  })
})
