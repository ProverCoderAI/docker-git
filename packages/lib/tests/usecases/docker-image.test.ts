import { describe, expect, it } from "@effect/vitest"
import { afterEach } from "vitest"

import { buildDockerImageBuildArgs, type DockerImageSpec } from "../../src/usecases/docker-image.js"

const buildNetworkEnvKey = "DOCKER_GIT_IMAGE_BUILD_NETWORK"
const originalBuildNetwork = process.env[buildNetworkEnvKey]

const imageSpec = (buildNetwork?: string): DockerImageSpec => ({
  imageName: "docker-git-auth:test",
  imageDir: ".docker-git/.orch/auth/test/.image",
  dockerfile: "FROM alpine\n",
  buildLabel: "test auth",
  ...(buildNetwork === undefined ? {} : { buildNetwork })
})

const restoreBuildNetworkEnv = (): void => {
  if (originalBuildNetwork === undefined) {
    delete process.env[buildNetworkEnvKey]
  } else {
    process.env[buildNetworkEnvKey] = originalBuildNetwork
  }
}

const withBuildNetworkEnv = (value: string | undefined, run: () => void): void => {
  if (value === undefined) {
    delete process.env[buildNetworkEnvKey]
  } else {
    process.env[buildNetworkEnvKey] = value
  }
  run()
}

afterEach(() => {
  restoreBuildNetworkEnv()
})

describe("buildDockerImageBuildArgs", () => {
  it("omits build network by default", () =>
    withBuildNetworkEnv(undefined, () => {
      expect(buildDockerImageBuildArgs(imageSpec(), "/tmp/image")).toEqual([
        "build",
        "-t",
        "docker-git-auth:test",
        "/tmp/image"
      ])
    }))

  it("adds trimmed explicit build network", () =>
    withBuildNetworkEnv(undefined, () => {
      expect(buildDockerImageBuildArgs(imageSpec(" host "), "/tmp/image")).toEqual([
        "build",
        "--network",
        "host",
        "-t",
        "docker-git-auth:test",
        "/tmp/image"
      ])
    }))

  it("uses build network env when spec is blank", () =>
    withBuildNetworkEnv("dg-build-net", () => {
      expect(buildDockerImageBuildArgs(imageSpec(" "), "/tmp/image")).toEqual([
        "build",
        "--network",
        "dg-build-net",
        "-t",
        "docker-git-auth:test",
        "/tmp/image"
      ])
    }))
})
