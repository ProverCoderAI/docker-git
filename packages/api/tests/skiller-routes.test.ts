import { describe, expect, it } from "@effect/vitest"
import { NodeContext } from "@effect/platform-node"
import { Effect } from "effect"

import {
  openSkiller,
  parseSkillerRoute,
  resolveSkillerBrowserScopeSelection,
  resolveSkillerRouteScopeSelection,
  runProcess,
  SkillerProcessTimeoutError,
  skillerLaunchCommand,
  type SkillerRoute
} from "../src/services/skiller.js"
import type { SkillerContainerScope } from "../src/services/skiller-core.js"

const appRoute = (path: string): Extract<SkillerRoute, { readonly _tag: "App" }> => {
  const route = parseSkillerRoute(path)
  if (route === null || route._tag !== "App") {
    throw new Error(`Expected app route for ${path}.`)
  }
  return route
}

const scope = (projectKey: string): SkillerContainerScope => ({
  containerCodexSkillsPath: "/home/dev/.codex/skills",
  containerHomePath: "/home/dev",
  containerName: `dg-${projectKey}`,
  containerProjectPath: "/home/dev/app",
  hostCodexSkillsPath: `/var/lib/docker/volumes/${projectKey}-home/_data/.codex/skills`,
  hostEnvGlobalPath: `/home/dev/.docker-git/${projectKey}/.docker-git/.orch/env/global.env`,
  hostHomePath: `/var/lib/docker/volumes/${projectKey}-home/_data`,
  hostProjectPath: `/var/lib/docker/volumes/${projectKey}-home/_data/app`,
  projectId: `/home/dev/.docker-git/${projectKey}`,
  projectKey,
  sshUser: "dev"
})

describe("skiller routes", () => {
  it("launches Electron through the Skiller launch script", () => {
    const launch = skillerLaunchCommand(null)
    const launchCommand = launch.args.join("\n")

    expect(launch.command).toBe("bash")
    expect(launch.args).toContain("-c")
    expect(launchCommand).toContain("xvfb-run -a ./node_modules/electron/dist/electron")
    expect(launchCommand).toContain("exec ./node_modules/electron/dist/electron")
    expect(launchCommand).toContain("--disable-dev-shm-usage")
  })

  it("launches scoped Skiller with the selected home owner credentials", () => {
    const launch = skillerLaunchCommand(
      { gid: 1000, uid: 1000 },
      (user) => ({ ...user, groupName: "ubuntu", userName: "ubuntu" })
    )

    expect(launch.command).toBe("runuser")
    expect(launch.args).toEqual(expect.arrayContaining([
      "--preserve-environment",
      "-u",
      "ubuntu",
      "-g",
      "ubuntu",
      "--",
      "bash",
      "-c"
    ]))
    expect(launch.gid).toBe(1000)
    expect(launch.groupName).toBe("ubuntu")
    expect(launch.uid).toBe(1000)
    expect(launch.userName).toBe("ubuntu")
  })

  it("uses deterministic scoped account names for missing local UID and GID entries", () => {
    const launch = skillerLaunchCommand({ gid: 2_147_483_002, uid: 2_147_483_001 })

    expect(launch.command).toBe("runuser")
    expect(launch.groupName).toBe("dg-skiller-g2147483002")
    expect(launch.userName).toBe("dg-skiller-u2147483001")
  })

  it("returns an external Skiller Web launch when DOCKER_GIT_SKILLER_WEB_URL is configured", async () => {
    const previous = process.env["DOCKER_GIT_SKILLER_WEB_URL"]
    process.env["DOCKER_GIT_SKILLER_WEB_URL"] = "https://skiller.example/ui"
    try {
      const launch = await Effect.runPromise(
        openSkiller(undefined, undefined, "https://docker-git.example").pipe(Effect.provide(NodeContext.layer))
      )
      const launchUrl = new URL(launch.appPath)

      expect(launch.mode).toBe("external")
      expect(launch.alreadyRunning).toBe(true)
      expect(launch.backendUrl).toBe("https://docker-git.example")
      expect(launch.pid).toBeNull()
      expect(launch.trpcPort).toBe(0)
      expect(launchUrl.pathname).toBe("/ui/launch")
      expect(launchUrl.searchParams.get("backendUrl")).toBe("https://docker-git.example")
      expect(launchUrl.searchParams.has("projectKey")).toBe(false)
      expect(launchUrl.searchParams.has("sessionId")).toBe(false)
    } finally {
      if (previous === undefined) {
        delete process.env["DOCKER_GIT_SKILLER_WEB_URL"]
      } else {
        process.env["DOCKER_GIT_SKILLER_WEB_URL"] = previous
      }
    }
  })

  it("fails stalled child processes with a distinct timeout error", () =>
    expect(runProcess(
      process.execPath,
      ["-e", "setTimeout(() => undefined, 1_000)"],
      {},
      25
    )).rejects.toBeInstanceOf(SkillerProcessTimeoutError))

  it("keeps the terminal session id on session-scoped app routes", () => {
    expect(parseSkillerRoute("/api/ssh/session/terminal-proof/skiller/app/")).toEqual({
      _tag: "App",
      relativePath: "/",
      sessionId: "terminal-proof"
    })
    expect(parseSkillerRoute("/ssh/session/terminal-proof/skiller/trpc/list_projects")).toEqual({
      _tag: "Trpc",
      sessionId: "terminal-proof",
      upstreamPath: "/trpc/list_projects"
    })
    expect(parseSkillerRoute("/api/skiller/app/")).toEqual({
      _tag: "App",
      relativePath: "/",
      sessionId: null
    })
  })

  it("uses the current project scope for non-session app routes", () => {
    const currentScope = scope("project-scope")

    expect(resolveSkillerBrowserScopeSelection(
      appRoute("/api/skiller/app/"),
      currentScope,
      () => null
    )).toEqual({
      scope: currentScope,
      sessionId: null
    })
  })

  it("uses the registered terminal scope for session app routes", () => {
    const currentScope = scope("current-scope")
    const terminalScope = scope("terminal-scope")

    expect(resolveSkillerBrowserScopeSelection(
      appRoute("/api/ssh/session/terminal-proof/skiller/app/"),
      currentScope,
      (sessionId) => sessionId === "terminal-proof" ? terminalScope : null
    )).toEqual({
      scope: terminalScope,
      sessionId: "terminal-proof"
    })
  })

  it("falls back to the current project scope for stale session app routes", () => {
    const currentScope = scope("current-scope")

    expect(resolveSkillerBrowserScopeSelection(
      appRoute("/api/ssh/session/stale-session/skiller/app/"),
      currentScope,
      () => undefined
    )).toEqual({
      scope: currentScope,
      sessionId: "stale-session"
    })
  })

  it("falls back to the current project scope for stale session trpc routes", () => {
    const currentScope = scope("current-scope")

    expect(resolveSkillerRouteScopeSelection(
      "stale-session",
      currentScope,
      () => undefined
    )).toEqual({
      scope: currentScope,
      sessionId: "stale-session"
    })
  })

  it("does not inject a browser scope for unscoped Skiller app routes", () => {
    expect(resolveSkillerBrowserScopeSelection(
      appRoute("/api/skiller/app/"),
      null,
      () => null
    )).toBeNull()
  })
})
