import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  classifyDockerProbeFailure,
  type DockerAccessDeniedContext,
  renderDockerAccessDeniedMessage
} from "../../src/docker-git/controller-docker-diagnostics.js"

const apiBaseUrl = "http://127.0.0.1:3334"

const buildContext = (overrides: Partial<DockerAccessDeniedContext> = {}): DockerAccessDeniedContext => ({
  directProbe: { exitCode: 1, stderr: "" },
  sudoProbe: null,
  apiBaseUrl,
  dockerHost: null,
  ...overrides
})

describe("classifyDockerProbeFailure", () => {
  it.effect("classifies socket permission denied", () =>
    Effect.sync(() => {
      const kind = classifyDockerProbeFailure({
        exitCode: 1,
        stderr:
          "Got permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock"
      })
      expect(kind).toBe("socket-permission-denied")
    }))

  it.effect("classifies daemon unreachable when stderr says cannot connect", () =>
    Effect.sync(() => {
      const kind = classifyDockerProbeFailure({
        exitCode: 1,
        stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
      })
      expect(kind).toBe("daemon-unreachable")
    }))

  it.effect("classifies missing CLI when exit code is 127 and stderr says not found", () =>
    Effect.sync(() => {
      const kind = classifyDockerProbeFailure({
        exitCode: 127,
        stderr: "docker: command not found"
      })
      expect(kind).toBe("docker-cli-missing")
    }))

  it.effect("returns unknown for empty stderr and non-recognised exit code", () =>
    Effect.sync(() => {
      const kind = classifyDockerProbeFailure({ exitCode: 1, stderr: "" })
      expect(kind).toBe("unknown")
    }))

  it.effect("prefers permission denied over daemon unreachable when both markers appear", () =>
    Effect.sync(() => {
      const kind = classifyDockerProbeFailure({
        exitCode: 1,
        stderr: "permission denied: Cannot connect to the Docker daemon"
      })
      expect(kind).toBe("socket-permission-denied")
    }))
})

describe("renderDockerAccessDeniedMessage", () => {
  it.effect("explains permission mismatch and mentions the contract", () =>
    Effect.sync(() => {
      const message = renderDockerAccessDeniedMessage(
        buildContext({
          directProbe: {
            exitCode: 1,
            stderr: "Got permission denied while trying to connect to the Docker daemon socket"
          },
          sudoProbe: { exitCode: 1, stderr: "sudo: a password is required" }
        })
      )

      expect(message).toContain("Host Docker socket rejected this user")
      expect(message).toContain("Runtime contract: docker-git is host-Docker-backed")
      expect(message).toContain("docker group")
      expect(message).toContain(apiBaseUrl)
      expect(message).toContain("Direct probe: exit=1; Got permission denied")
      expect(message).toContain("Sudo probe: exit=1; sudo: a password is required")
    }))

  it.effect("explains daemon-down case differently", () =>
    Effect.sync(() => {
      const message = renderDockerAccessDeniedMessage(
        buildContext({
          directProbe: {
            exitCode: 1,
            stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
          },
          sudoProbe: {
            exitCode: 1,
            stderr: "Cannot connect to the Docker daemon"
          }
        })
      )

      expect(message).toContain("Host Docker daemon is not reachable")
      expect(message).toContain("systemctl start docker")
      expect(message).toContain("DOCKER_HOST: unset")
    }))

  it.effect("renders DOCKER_HOST when provided", () =>
    Effect.sync(() => {
      const message = renderDockerAccessDeniedMessage(
        buildContext({
          dockerHost: "tcp://docker.example:2376"
        })
      )

      expect(message).toContain("DOCKER_HOST: tcp://docker.example:2376")
    }))

  it.effect("marks sudo probe as skipped when not provided", () =>
    Effect.sync(() => {
      const message = renderDockerAccessDeniedMessage(buildContext({ sudoProbe: null }))
      expect(message).toContain("Sudo probe: skipped")
    }))

  it.effect("recommends installing Docker when CLI is missing", () =>
    Effect.sync(() => {
      const message = renderDockerAccessDeniedMessage(
        buildContext({
          directProbe: { exitCode: 127, stderr: "docker: command not found" },
          sudoProbe: { exitCode: 127, stderr: "sudo: docker: command not found" }
        })
      )

      expect(message).toContain("docker CLI was not found")
      expect(message).toContain("Install Docker Engine")
    }))
})
