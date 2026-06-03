import { describe, expect, it } from "@effect/vitest"

import {
  parseSkillerRoute,
  resolveSkillerBrowserScopeSelection,
  resolveSkillerRouteScopeSelection,
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
    const [command, args] = skillerLaunchCommand()
    const launchCommand = args.join("\n")

    expect(command).toBe("bash")
    expect(launchCommand).toContain("xvfb-run -a ./node_modules/electron/dist/electron")
    expect(launchCommand).toContain("exec ./node_modules/electron/dist/electron")
  })

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
