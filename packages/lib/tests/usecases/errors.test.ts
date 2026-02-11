import { describe, expect, it } from "@effect/vitest"

import { DockerAccessError, DockerCommandError } from "../../src/shell/errors.js"
import { renderError } from "../../src/usecases/errors.js"

describe("renderError", () => {
  it("includes docker daemon access hint for DockerCommandError", () => {
    const message = renderError(new DockerCommandError({ exitCode: 1 }))

    expect(message).toContain("docker compose failed with exit code 1")
    expect(message).toContain("/var/run/docker.sock")
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
})
