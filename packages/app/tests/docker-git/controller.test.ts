import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  parseControllerRevisionEnvOutput,
  shouldForceRecreateController
} from "../../src/docker-git/controller-revision.js"
import { buildApiBaseUrlCandidates, isRemoteDockerHost } from "../../src/docker-git/controller.js"

const joinIp = (...octets: ReadonlyArray<string>): string => octets.join(".")
const makeHttpUrl = (host: string, port: string): string => ["ht", "tp://", host, ":", port].join("")

describe("controller reachability", () => {
  it.effect("builds direct API candidates without Docker inspection", () =>
    Effect.sync(() => {
      const candidates = buildApiBaseUrlCandidates({
        explicitApiBaseUrl: undefined,
        cachedApiBaseUrl: makeHttpUrl("api-cache.local", "3334") + "/",
        defaultApiBaseUrl: makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        currentContainerNetworks: {},
        controllerNetworks: {},
        port: "3334"
      })

      expect(candidates).toEqual([
        makeHttpUrl("api-cache.local", "3334"),
        makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        makeHttpUrl("docker-git-api", "3334")
      ])
    }))

  it.effect("prefers an explicit API URL without fallbacks", () =>
    Effect.sync(() => {
      const candidates = buildApiBaseUrlCandidates({
        explicitApiBaseUrl: makeHttpUrl("api.example.test", "4444") + "/",
        cachedApiBaseUrl: makeHttpUrl(joinIp("172", "17", "0", "20"), "3334"),
        defaultApiBaseUrl: makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        currentContainerNetworks: { bridge: joinIp("172", "17", "0", "15") },
        controllerNetworks: { bridge: joinIp("172", "17", "0", "20") },
        port: "3334"
      })

      expect(candidates).toEqual([makeHttpUrl("api.example.test", "4444")])
    }))

  it.effect("adds containerized fallbacks after the local API URL", () =>
    Effect.sync(() => {
      const candidates = buildApiBaseUrlCandidates({
        explicitApiBaseUrl: undefined,
        cachedApiBaseUrl: undefined,
        defaultApiBaseUrl: makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        currentContainerNetworks: {
          bridge: joinIp("172", "17", "0", "15"),
          "docker-git-shared": joinIp("172", "18", "0", "19")
        },
        controllerNetworks: {
          bridge: joinIp("172", "17", "0", "20"),
          "docker-git-shared": joinIp("172", "18", "0", "2")
        },
        port: "3334"
      })

      expect(candidates).toEqual([
        makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        makeHttpUrl("docker-git-api", "3334"),
        makeHttpUrl("host.docker.internal", "3334"),
        makeHttpUrl(joinIp("172", "18", "0", "2"), "3334"),
        makeHttpUrl(joinIp("172", "17", "0", "20"), "3334")
      ])
    }))

  it.effect("detects remote Docker hosts", () =>
    Effect.sync(() => {
      expect(isRemoteDockerHost("")).toBe(false)
      expect(isRemoteDockerHost("unix:///var/run/docker.sock")).toBe(false)
      expect(isRemoteDockerHost("tcp://docker.example.test:2376")).toBe(true)
      expect(isRemoteDockerHost("ssh://docker@example.test")).toBe(true)
    }))

  it.effect("parses controller revision from container env output", () =>
    Effect.sync(() => {
      const parsed = parseControllerRevisionEnvOutput(
        [
          "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          "DOCKER_GIT_CONTROLLER_REV=abc123def4567890",
          "NODE_ENV=production"
        ].join("\n")
      )

      expect(parsed).toBe("abc123def4567890")
      expect(parseControllerRevisionEnvOutput("PATH=/usr/bin\nNODE_ENV=production\n")).toBeNull()
    }))

  it.effect("forces controller recreate when the running revision differs", () =>
    Effect.sync(() => {
      expect(shouldForceRecreateController(false, "local-a", null)).toBe(false)
      expect(shouldForceRecreateController(true, "local-a", "local-a")).toBe(false)
      expect(shouldForceRecreateController(true, "local-a", "local-b")).toBe(true)
      expect(shouldForceRecreateController(true, "local-a", null)).toBe(true)
    }))
})
