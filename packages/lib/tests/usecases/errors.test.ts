import { describe, expect, it } from "@effect/vitest"

import { DockerCommandError } from "../../src/shell/errors.js"
import { renderError } from "../../src/usecases/errors.js"

describe("renderError", () => {
  it("includes docker daemon access hint for DockerCommandError", () => {
    const message = renderError(new DockerCommandError({ exitCode: 1 }))

    expect(message).toContain("docker compose failed with exit code 1")
    expect(message).toContain("/var/run/docker.sock")
  })
})
