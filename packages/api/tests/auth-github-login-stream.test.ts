import { describe, expect, it } from "vitest"

import { renderGithubPostLoginOutput } from "../src/services/auth-github-login-stream.js"

describe("GitHub auth login stream", () => {
  it("renders post-login state logs before the success marker", () => {
    const output = renderGithubPostLoginOutput([
      "Initializing state repository: https://github.com/octocat/.docker-git.git",
      "State dir ready."
    ], "ok")

    expect(output).toContain("Initializing state repository")
    expect(output).toContain("State dir ready")
    expect(output).toContain("GitHub login completed.")
    expect(output).toContain("__DOCKER_GIT_GITHUB_LOGIN_STATUS__:ok")
    expect(output.indexOf("State dir ready")).toBeLessThan(output.indexOf("GitHub login completed."))
  })

  it("renders post-login failure details before the failure marker", () => {
    const output = renderGithubPostLoginOutput([
      "GitHub login finished in browser, but post-login sync failed: git fetch failed"
    ], "post-login")

    expect(output).toContain("post-login sync failed")
    expect(output).toContain("__DOCKER_GIT_GITHUB_LOGIN_STATUS__:error:post-login")
    expect(output.indexOf("post-login sync failed")).toBeLessThan(output.indexOf("__DOCKER_GIT_GITHUB_LOGIN_STATUS__"))
  })
})
