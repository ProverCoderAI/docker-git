import { describe, expect, it } from "@effect/vitest"

import { classifyDockerAccessIssue } from "../../src/shell/docker.js"

describe("classifyDockerAccessIssue", () => {
  it("classifies socket permission failures as PermissionDenied", () => {
    const issue = classifyDockerAccessIssue(
      'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.51/info": dial unix /var/run/docker.sock: connect: permission denied'
    )

    expect(issue).toBe("PermissionDenied")
  })

  it("classifies non-permission docker access failures as DaemonUnavailable", () => {
    const issue = classifyDockerAccessIssue(
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
    )

    expect(issue).toBe("DaemonUnavailable")
  })
})
