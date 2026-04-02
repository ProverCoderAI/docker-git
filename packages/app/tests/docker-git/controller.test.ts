import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { buildApiBaseUrlCandidates, isRemoteDockerHost } from "../../src/docker-git/controller.js"

describe("controller reachability", () => {
  it.effect("prefers an explicit API URL without fallbacks", () =>
    Effect.sync(() => {
      const candidates = buildApiBaseUrlCandidates({
        explicitApiBaseUrl: "http://api.example.test:4444/",
        cachedApiBaseUrl: "http://172.17.0.20:3334",
        defaultApiBaseUrl: "http://127.0.0.1:3334",
        currentContainerNetworks: { bridge: "172.17.0.15" },
        controllerNetworks: { bridge: "172.17.0.20" },
        port: "3334"
      })

      expect(candidates).toEqual(["http://api.example.test:4444"])
    }))

  it.effect("adds containerized fallbacks after the local API URL", () =>
    Effect.sync(() => {
      const candidates = buildApiBaseUrlCandidates({
        explicitApiBaseUrl: undefined,
        cachedApiBaseUrl: undefined,
        defaultApiBaseUrl: "http://127.0.0.1:3334",
        currentContainerNetworks: {
          bridge: "172.17.0.15",
          "docker-git-shared": "172.18.0.19"
        },
        controllerNetworks: {
          bridge: "172.17.0.20",
          "docker-git-shared": "172.18.0.2"
        },
        port: "3334"
      })

      expect(candidates).toEqual([
        "http://127.0.0.1:3334",
        "http://host.docker.internal:3334",
        "http://172.18.0.2:3334",
        "http://172.17.0.20:3334"
      ])
    }))

  it.effect("detects remote Docker hosts", () =>
    Effect.sync(() => {
      expect(isRemoteDockerHost()).toBe(false)
      expect(isRemoteDockerHost("unix:///var/run/docker.sock")).toBe(false)
      expect(isRemoteDockerHost("tcp://docker.example.test:2376")).toBe(true)
      expect(isRemoteDockerHost("ssh://docker@example.test")).toBe(true)
    }))
})
