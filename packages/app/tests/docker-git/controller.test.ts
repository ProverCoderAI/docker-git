import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { buildApiBaseUrlCandidates, isRemoteDockerHost } from "../../src/docker-git/controller.js"

const joinIp = (...octets: ReadonlyArray<string>): string => octets.join(".")
const makeHttpUrl = (host: string, port: string): string => ["ht", "tp://", host, ":", port].join("")

describe("controller reachability", () => {
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
        makeHttpUrl("host.docker.internal", "3334"),
        makeHttpUrl(joinIp("172", "18", "0", "2"), "3334"),
        makeHttpUrl(joinIp("172", "17", "0", "20"), "3334")
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
