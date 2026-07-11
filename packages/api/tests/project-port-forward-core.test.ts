import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  buildProjectDatabaseContainerName,
  buildProjectDatabaseForwardContainerName,
  buildStoredProfile,
  externalDatabaseConnectionString,
  dbGateEngine,
  dbGateServerForProfile,
  maskConnectionString,
  parseDatabaseConnectionString,
  parseProjectDatabaseForwardRows,
  parseProjectDatabaseProxyPath,
  parseProjectDatabaseStatefulProxyPath,
  projectDatabaseCookieName,
  renderProjectDatabaseProxyPath,
  rowToProjectDatabaseForward
} from "../src/services/project-databases-core.js"
import {
  buildForwardSshScript,
  buildPortForwardContainerName,
  normalizePortForwardRequest,
  parsePortForwardRows,
  rowToProjectPortForward,
  selectHostPort
} from "../src/services/project-port-forward-core.js"
import {
  parseProjectBrowserProxyPath,
  renderProjectBrowserCdpPath,
  renderProjectBrowserNoVncPath,
  renderProjectBrowserProxyPath,
  rewriteCdpVersionPayload,
  rewriteCdpWebSocketUrl
} from "../src/services/project-browser-core.js"
import {
  parseLinuxDefaultGatewayIp,
  parseProjectPortProxyPath,
  projectShortKey,
  renderForwardProxyPath,
  renderLegacyForwardProxyPath,
  rewriteProxyLocation
} from "../src/services/project-port-proxy-core.js"

describe("project port forward core", () => {
  it.effect("selects requested host ports only when free", () =>
    Effect.sync(() => {
      expect(selectHostPort(3000, 4000, new Set([3000]))).toBe(4000)
      expect(selectHostPort(3000, 4000, new Set([4000]))).toBeNull()
    }))

  it.effect("falls forward from occupied target port", () =>
    Effect.sync(() => {
      expect(selectHostPort(3000, undefined, new Set([3000, 3001]))).toBe(3002)
    }))

  it.effect("validates project port forward request ports", () =>
    Effect.sync(() => {
      expect(normalizePortForwardRequest(3000, undefined)).toEqual({
        ok: true,
        ports: { hostPort: undefined, targetPort: 3000 }
      })
      expect(normalizePortForwardRequest(0, undefined)).toEqual({
        ok: false,
        message: "targetPort must be an integer between 1 and 65535."
      })
    }))

  it.effect("builds stable Docker-safe forward container names", () =>
    Effect.sync(() => {
      const first = buildPortForwardContainerName("/home/dev/.docker-git/org/repo", 3000)
      const second = buildPortForwardContainerName("/home/dev/.docker-git/org/repo", 3000)

      expect(first).toBe(second)
      expect(first).toMatch(/^dg-port-[a-f0-9]{12}-3000$/u)
      expect(first.length).toBeLessThanOrEqual(63)
    }))

  it.effect("parses Docker label rows into port forwards", () =>
    Effect.sync(() => {
      const rows = parsePortForwardRows([
        "abc123",
        "dg-port-test-3000",
        "running",
        "2026-04-14 10:00:00 +0000 UTC",
        "project-a",
        "3000",
        "4000",
        "0.0.0.0",
        "dev.example.test",
        "dg-project"
      ].join("\t"))
      const row = rows[0]
      if (row === undefined) {
        throw new Error("Expected one parsed row")
      }
      const forward = rowToProjectPortForward(row)

      expect(forward.status).toBe("running")
      expect(forward.targetPort).toBe(3000)
      expect(forward.hostPort).toBe(4000)
      expect(forward.projectKey).toBe(projectShortKey("project-a"))
      expect(forward.proxyPath).toBe(`/p/${projectShortKey("project-a")}/3000/`)
      expect(forward.url).toBe("http://dev.example.test:4000")
    }))

  it.effect("parses project port proxy paths", () =>
    Effect.sync(() => {
      expect(parseProjectPortProxyPath("/projects/a%2Fb/ports/5173/proxy/src/main.ts")).toEqual({
        _tag: "ProjectId",
        projectId: "a/b",
        targetPort: 5173,
        upstreamPath: "/src/main.ts"
      })
      expect(parseProjectPortProxyPath(`/p/${projectShortKey("a/b")}/5173/src/main.ts`)).toEqual({
        _tag: "ProjectKey",
        projectKey: projectShortKey("a/b"),
        targetPort: 5173,
        upstreamPath: "/src/main.ts"
      })
      expect(renderForwardProxyPath("a/b", 5173)).toBe(`/p/${projectShortKey("a/b")}/5173/`)
      expect(renderLegacyForwardProxyPath("a/b", 5173)).toBe("/projects/a%2Fb/ports/5173/proxy/")
    }))

  it.effect("parses project browser proxy paths", () =>
    Effect.sync(() => {
      const key = projectShortKey("a/b")

      expect(parseProjectBrowserProxyPath(`/b/${key}/vnc.html`)).toEqual({
        _tag: "NoVnc",
        projectKey: key,
        upstreamPath: "/vnc.html"
      })
      expect(parseProjectBrowserProxyPath(`/b/${key}/websockify`)).toEqual({
        _tag: "NoVnc",
        projectKey: key,
        upstreamPath: "/websockify"
      })
      expect(parseProjectBrowserProxyPath(`/b/${key}/cdp/json/version`)).toEqual({
        _tag: "Cdp",
        projectKey: key,
        upstreamPath: "/json/version"
      })
      expect(renderProjectBrowserProxyPath("a/b")).toBe(`/b/${key}/`)
      expect(renderProjectBrowserCdpPath("a/b")).toBe(`/b/${key}/cdp/json/version`)
      expect(renderProjectBrowserNoVncPath("a/b")).toContain(`/b/${key}/vnc.html?`)
      expect(renderProjectBrowserNoVncPath("a/b")).toContain("resize=scale")
      expect(renderProjectBrowserNoVncPath("a/b")).toContain(`path=b%2F${key}%2Fwebsockify`)
    }))

  it.effect("normalizes database connection profiles", () =>
    Effect.sync(() => {
      const parsed = parseDatabaseConnectionString("postgres://dev:secret@localhost:5432/app")
      expect(parsed).toEqual({
        ok: true,
        parsed: {
          database: "app",
          engine: "postgres",
          host: "localhost",
          password: "secret",
          port: 5432,
          user: "dev"
        }
      })
      const profile = buildStoredProfile(
        "mysql://root:password@127.0.0.1/app",
        "",
        "2026-04-15T00:00:00.000Z"
      )
      if (!profile.ok) {
        throw new Error(profile.message)
      }
      expect(profile.profile.label).toBe("mysql 127.0.0.1:3306/app")
      expect(maskConnectionString(profile.profile.connectionString)).toContain("********")
      expect(dbGateEngine("mysql")).toBe("mysql@dbgate-plugin-mysql")
      expect(dbGateServerForProfile(profile.profile, "172.18.0.4")).toBe("172.18.0.4")
    }))

  it.effect("parses database proxy paths", () =>
    Effect.sync(() => {
      const key = projectShortKey("a/b")

      expect(renderProjectDatabaseProxyPath("a/b")).toBe(`/d/${key}/`)
      expect(parseProjectDatabaseProxyPath(`/d/${key}/connections`)).toEqual({
        projectKey: key,
        upstreamPath: "/connections"
      })
      expect(parseProjectDatabaseStatefulProxyPath("/connections", `http://localhost/d/${key}/`, undefined)).toEqual({
        projectKey: key,
        upstreamPath: "/connections"
      })
      expect(parseProjectDatabaseStatefulProxyPath("/storage", undefined, `${projectDatabaseCookieName}=${key}`)).toEqual({
        projectKey: key,
        upstreamPath: "/storage"
      })
      expect(buildProjectDatabaseContainerName("dg-project")).toBe("dg-project-dbgate")
    }))

  it.effect("renders database TCP forwards from Docker labels", () =>
    Effect.sync(() => {
      const profile = buildStoredProfile(
        "postgres://dev:secret@localhost:5432/app",
        "dev postgres",
        "2026-04-15T00:00:00.000Z"
      )
      if (!profile.ok) {
        throw new Error(profile.message)
      }
      const containerName = buildProjectDatabaseForwardContainerName("/home/dev/project", profile.profile.id)
      const rows = parseProjectDatabaseForwardRows([
        "abc123",
        containerName,
        "running",
        "2026-04-15 10:00:00 +0000 UTC",
        "/home/dev/project",
        profile.profile.id,
        "172.18.0.9",
        "5432",
        "15432",
        "0.0.0.0",
        "db.example.test"
      ].join("\t"))
      const row = rows[0]
      if (row === undefined) {
        throw new Error("Expected one parsed row")
      }
      const forward = rowToProjectDatabaseForward(row, profile.profile)

      expect(containerName.length).toBeLessThanOrEqual(63)
      expect(externalDatabaseConnectionString(profile.profile, "db.example.test", 15432)).toBe(
        "postgres://dev:secret@db.example.test:15432/app"
      )
      expect(forward.status).toBe("running")
      expect(forward.hostPort).toBe(15432)
      expect(forward.targetHost).toBe("172.18.0.9")
      expect(forward.maskedExternalConnectionString).toBe("postgres://dev:********@db.example.test:15432/app")
    }))

  it.effect("rewrites CDP websocket URLs into browser proxy paths", () =>
    Effect.sync(() => {
      const key = projectShortKey("a/b")
      expect(
        rewriteCdpWebSocketUrl(
          "ws://127.0.0.1:9222/devtools/browser/abc",
          "https://docker-git.example.test",
          "a/b"
        )
      ).toBe(`wss://docker-git.example.test/b/${key}/cdp/devtools/browser/abc`)

      expect(
        rewriteCdpVersionPayload(
          JSON.stringify({ Browser: "Chrome", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc" }),
          "http://localhost:4191",
          "a/b"
        )
      ).toBe(JSON.stringify({
        Browser: "Chrome",
        webSocketDebuggerUrl: `ws://localhost:4191/b/${key}/cdp/devtools/browser/abc`
      }))
    }))

  it.effect("parses Linux default gateway route", () =>
    Effect.sync(() => {
      const route = [
        "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
        "eth0\t00000000\t0112AC0A\t0003\t0\t0\t0\t00000000\t0\t0\t0"
      ].join("\n")

      expect(parseLinuxDefaultGatewayIp(route)).toBe("10.172.18.1")
    }))

  it.effect("rewrites upstream redirects into proxy paths", () =>
    Effect.sync(() => {
      expect(
        rewriteProxyLocation(
          "http://172.18.0.1:5173/login?next=/",
          `/p/${projectShortKey("a/b")}/5173/`,
          "http://172.18.0.1:5173",
          "/api"
        )
      ).toBe(`/api/p/${projectShortKey("a/b")}/5173/login?next=/`)
      expect(
        rewriteProxyLocation(
          "/login",
          `/p/${projectShortKey("a/b")}/5173/`,
          "http://172.18.0.1:5173",
          "/api"
        )
      ).toBe(`/api/p/${projectShortKey("a/b")}/5173/login`)
    }))

  it.effect("renders SSH local-forward script for localhost-only services", () =>
    Effect.sync(() => {
      const script = buildForwardSshScript("172.17.0.10", "dev", 5173)

      expect(script).toContain("-L 0.0.0.0:5173:127.0.0.1:5173")
      expect(script).toContain("-p 22 dev@172.17.0.10")
      expect(script).toContain("ExitOnForwardFailure=yes")
    }))
})
