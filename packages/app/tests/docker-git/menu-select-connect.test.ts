import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import type { ProjectItem } from "@effect-template/lib/usecases/projects"

import { selectHint } from "../../src/docker-git/menu-render-select.js"
import { buildConnectEffect, isConnectMcpToggleInput } from "../../src/docker-git/menu-select-connect.js"
import { makeProjectItem } from "./fixtures/project-item.js"

const record = (events: Array<string>, entry: string): Effect.Effect<void> =>
  Effect.sync(() => {
    events.push(entry)
  })

const makeConnectDeps = (events: Array<string>) => ({
  connectWithUp: (selected: ProjectItem) => record(events, `connect:${selected.projectDir}`),
  enableMcpPlaywright: (projectDir: string) => record(events, `enable:${projectDir}`)
})

const workspaceProject = () =>
  makeProjectItem({
    projectDir: "/home/dev/provercoderai/docker-git/workspaces/org/repo",
    authorizedKeysPath: "/home/dev/provercoderai/docker-git/workspaces/org/repo/.docker-git/authorized_keys",
    envGlobalPath: "/home/dev/provercoderai/docker-git/.orch/env/global.env",
    envProjectPath: "/home/dev/provercoderai/docker-git/workspaces/org/repo/.orch/env/project.env",
    codexAuthPath: "/home/dev/provercoderai/docker-git/.orch/auth/codex"
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
    expect(selectHint("Connect", true)).toContain("toggle Playwright MCP (on)")
    expect(selectHint("Connect", false)).toContain("toggle Playwright MCP (off)")
  })
})
