import { describe, expect, it } from "@effect/vitest"

import {
  DockerAccessError,
  DockerCommandError,
  DockerIdentityConflictError,
  ScrapArchiveNotFoundError
} from "../../src/shell/errors.js"
import { renderError } from "../../src/usecases/errors.js"

describe("renderError", () => {
  it("includes docker daemon access hint for DockerCommandError", () => {
    const message = renderError(
      new DockerCommandError({
        exitCode: 1,
        details:
          'Error response from daemon: Conflict. The container name "/dg-openclaw_autodeployer-browser" is already in use.'
      })
    )

    expect(message).toContain("docker compose failed with exit code 1")
    expect(message).toContain("Docker output:")
    expect(message).toContain("already in use")
    expect(message).toContain("/var/run/docker.sock")
    expect(message).toContain("port is already allocated")
    expect(message).toContain("--ssh-port")
    expect(message).toContain("auth.docker.io")
  })

  it("includes NVIDIA runtime recovery hint for DockerCommandError", () => {
    const message = renderError(
      new DockerCommandError({
        exitCode: 1,
        details:
          "nvidia-container-cli: initialization error: load library failed: libnvidia-ml.so.1: cannot open shared object file"
      })
    )

    expect(message).toContain("NVIDIA GPU access is enabled")
    expect(message).toContain("--gpu none")
    expect(message).toContain("NVIDIA Container Toolkit")
  })

  it("renders actionable recovery for DockerAccessError", () => {
    const message = renderError(
      new DockerAccessError({
        issue: "PermissionDenied",
        details:
          'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock'
      })
    )

    expect(message).toContain("permission denied")
    expect(message).toContain("DOCKER_HOST")
    expect(message).toContain("Details:")
  })

  it("renders conflicting docker identity guidance", () => {
    const message = renderError(
      new DockerIdentityConflictError({
        projectDir: "/tmp/new-project",
        conflicts: [
          {
            conflictingProjectDir: "/tmp/old-project",
            kind: "containerName",
            name: "dg-openclaw_autodeployer"
          }
        ]
      })
    )

    expect(message).toContain("Refusing to create /tmp/new-project")
    expect(message).toContain('container name "dg-openclaw_autodeployer" already exists in /tmp/old-project')
    expect(message).toContain("--force")
    expect(message).toContain("--container-name")
  })

  it("renders scrap archive missing hint", () => {
    const message = renderError(new ScrapArchiveNotFoundError({ path: "/tmp/workspace.tar.gz" }))

    expect(message).toContain("Scrap archive not found")
    expect(message).toContain("docker-git scrap export")
  })
})
