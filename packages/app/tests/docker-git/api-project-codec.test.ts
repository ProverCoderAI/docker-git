import { describe, expect, it } from "@effect/vitest"

import { decodeCreateProjectAccepted } from "../../src/docker-git/api-project-codec.js"

describe("api project codec", () => {
  it("decodes async create accepted responses", () => {
    const accepted = decodeCreateProjectAccepted({
      accepted: true,
      projectId: ".docker-git/org/repo",
      cursor: 0
    })

    expect(accepted).toEqual({
      accepted: true,
      projectId: ".docker-git/org/repo",
      cursor: 0
    })
  })

  it("rejects incomplete async create accepted responses", () => {
    expect(decodeCreateProjectAccepted({ accepted: true, projectId: ".docker-git/org/repo" })).toBeNull()
  })
})
