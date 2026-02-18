import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { defaultTemplateConfig } from "@effect-template/lib/core/domain"
import { renderEntrypoint } from "@effect-template/lib/core/templates-entrypoint"

describe("renderEntrypoint auth bridge", () => {
  it.effect("maps GH token fallback to git auth and sets git credential helper", () =>
    Effect.sync(() => {
      const entrypoint = renderEntrypoint({
        ...defaultTemplateConfig,
        repoUrl: "https://github.com/org/repo.git",
        enableMcpPlaywright: false
      })

      expect(entrypoint).toContain(
        "GIT_AUTH_TOKEN=\"${GIT_AUTH_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}\""
      )
      expect(entrypoint).toContain("GITHUB_TOKEN=\"${GITHUB_TOKEN:-${GH_TOKEN:-}}\"")
      expect(entrypoint).toContain("if [[ -n \"$GH_TOKEN\" || -n \"$GITHUB_TOKEN\" ]]; then")
      expect(entrypoint).toContain(String.raw`printf "export GITHUB_TOKEN=%q\n" "$EFFECTIVE_GITHUB_TOKEN"`)
      expect(entrypoint).toContain("docker_git_upsert_ssh_env \"GITHUB_TOKEN\" \"$EFFECTIVE_GITHUB_TOKEN\"")
      expect(entrypoint).toContain("GIT_CREDENTIAL_HELPER_PATH=\"/usr/local/bin/docker-git-credential-helper\"")
      expect(entrypoint).toContain("token=\"$GITHUB_TOKEN\"")
      expect(entrypoint).toContain("token=\"$GH_TOKEN\"")
      expect(entrypoint).toContain(String.raw`printf "%s\n" "password=$token"`)
      expect(entrypoint).toContain("git config --global credential.helper")
    }))
})
