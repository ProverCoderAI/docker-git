import { describe, expect, it } from "@effect/vitest"
import { afterEach } from "vitest"

import {
  buildDockerAuthArgs,
  buildDockerBindMountArg,
  remapDockerBindHostPathFromMounts,
  type DockerAuthSpec
} from "../../src/shell/docker-auth.js"

const authNetworkEnvKey = "DOCKER_GIT_AUTH_DOCKER_NETWORK"
const originalAuthNetwork = process.env[authNetworkEnvKey]

const baseAuthSpec = (overrides: Partial<DockerAuthSpec> = {}): DockerAuthSpec => ({
  cwd: "/workspace",
  image: "docker-git-auth:test",
  volume: {
    hostPath: "/home/user/.docker-git/.orch/auth/gh",
    containerPath: "/auth"
  },
  user: "1000:1000",
  args: ["status"],
  interactive: false,
  ...overrides
})

const restoreAuthNetworkEnv = (): void => {
  if (originalAuthNetwork === undefined) {
    delete process.env[authNetworkEnvKey]
  } else {
    process.env[authNetworkEnvKey] = originalAuthNetwork
  }
}

const withAuthNetworkEnv = (value: string | undefined, run: () => void): void => {
  if (value === undefined) {
    delete process.env[authNetworkEnvKey]
  } else {
    process.env[authNetworkEnvKey] = value
  }
  run()
}

afterEach(() => {
  restoreAuthNetworkEnv()
})

describe("remapDockerBindHostPathFromMounts", () => {
  it("maps nested bind paths through the current container mount source", () => {
    const next = remapDockerBindHostPathFromMounts("/home/dev/.docker-git/.orch/auth/claude/default", [
      {
        source: "/home/user/.docker-git",
        destination: "/home/dev/.docker-git"
      }
    ])

    expect(next).toBe("/home/user/.docker-git/.orch/auth/claude/default")
  })

  it("prefers the longest matching destination prefix", () => {
    const next = remapDockerBindHostPathFromMounts("/home/dev/.docker-git/provercoderai/repo/.orch/auth/gh", [
      {
        source: "/home/user/.docker-git",
        destination: "/home/dev/.docker-git"
      },
      {
        source: "/srv/docker-git/provercoderai/repo",
        destination: "/home/dev/.docker-git/provercoderai/repo"
      }
    ])

    expect(next).toBe("/srv/docker-git/provercoderai/repo/.orch/auth/gh")
  })

  it("keeps the original path when no mount matches", () => {
    const hostPath = "/tmp/docker-git-auth"

    expect(remapDockerBindHostPathFromMounts(hostPath, [])).toBe(hostPath)
  })

  it("matches Windows drive-letter paths case-insensitively", () => {
    const next = remapDockerBindHostPathFromMounts("c:\\Users\\Dev\\.docker-git\\repo\\.orch\\auth\\gh", [
      {
        source: "D:\\DockerGit",
        destination: "C:\\Users\\Dev\\.docker-git\\"
      }
    ])

    expect(next).toBe("D:\\DockerGit\\repo\\.orch\\auth\\gh")
  })
})

describe("buildDockerAuthArgs", () => {
  it("does not force host networking by default", () =>
    withAuthNetworkEnv(undefined, () => {
      const args = buildDockerAuthArgs(baseAuthSpec())

      expect(args).not.toContain("--network")
      expect(args).toContain("--mount")
      expect(args).toContain("type=bind,source=/home/user/.docker-git/.orch/auth/gh,target=/auth")
      expect(args).not.toContain("-v")
    }))

  it("adds explicit auth network from spec", () =>
    withAuthNetworkEnv(undefined, () => {
      const args = buildDockerAuthArgs(baseAuthSpec({ network: " dg-auth-net " }))

      expect(args.slice(0, 4)).toEqual(["run", "--rm", "--network", "dg-auth-net"])
    }))

  it("falls back to auth network env and ignores blank spec values", () =>
    withAuthNetworkEnv("dg-env-net", () => {
      const args = buildDockerAuthArgs(baseAuthSpec({ network: " " }))

      expect(args.slice(0, 4)).toEqual(["run", "--rm", "--network", "dg-env-net"])
    }))
})

describe("buildDockerBindMountArg", () => {
  it("keeps Windows drive letters inside a single --mount value", () => {
    expect(
      buildDockerBindMountArg({
        hostPath: "C:\\Users\\Dev\\Docker Git\\auth",
        containerPath: "/auth"
      })
    ).toBe("type=bind,source=C:\\Users\\Dev\\Docker Git\\auth,target=/auth")
  })
})
