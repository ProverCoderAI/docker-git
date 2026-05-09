import { describe, expect, it } from "vitest"

import { renderGitlabPostLoginOutput } from "../src/services/auth-gitlab-login-stream.js"

describe("GitLab auth login stream", () => {
  it("renders post-login state logs before the success marker", () => {
    const output = renderGitlabPostLoginOutput([
      "GitLab token stored (default) in /home/dev/.docker-git/.orch/env/global.env"
    ], "ok")

    expect(output).toContain("GitLab token stored")
    expect(output).toContain("GitLab login completed.")
    expect(output).toContain("__DOCKER_GIT_GITLAB_LOGIN_STATUS__:ok")
    expect(output.indexOf("GitLab token stored")).toBeLessThan(output.indexOf("GitLab login completed."))
  })

  it("renders post-login failure details before the failure marker", () => {
    const output = renderGitlabPostLoginOutput([
      "GitLab login finished in browser, but post-login sync failed: glab auth status failed"
    ], "post-login")

    expect(output).toContain("post-login sync failed")
    expect(output).toContain("__DOCKER_GIT_GITLAB_LOGIN_STATUS__:error:post-login")
    expect(output.indexOf("post-login sync failed")).toBeLessThan(output.indexOf("__DOCKER_GIT_GITLAB_LOGIN_STATUS__"))
  })
})
