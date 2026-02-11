import { describe, expect, it } from "@effect/vitest"

import { dockerComposeUpRecreateArgs } from "../../src/shell/docker.js"

describe("docker compose args", () => {
  it("uses build when force-env recreates containers", () => {
    expect(dockerComposeUpRecreateArgs).toEqual(["up", "-d", "--build", "--force-recreate"])
  })
})
