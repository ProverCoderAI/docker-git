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
      expect(entrypoint).toContain("AUTH_LABEL_RAW=\"${GIT_AUTH_LABEL:-${GITHUB_AUTH_LABEL:-}}\"")
      expect(entrypoint).toContain("LABELED_GITHUB_TOKEN_KEY=\"GITHUB_TOKEN__$RESOLVED_AUTH_LABEL\"")
      expect(entrypoint).toContain("LABELED_GIT_TOKEN_KEY=\"GIT_AUTH_TOKEN__$RESOLVED_AUTH_LABEL\"")
      expect(entrypoint).toContain("if [[ -n \"$EFFECTIVE_GH_TOKEN\" ]]; then")
      expect(entrypoint).toContain(String.raw`printf "export GITHUB_TOKEN=%q\n" "$EFFECTIVE_GITHUB_TOKEN"`)
      expect(entrypoint).toContain(String.raw`printf "export GH_TOKEN=%q\n" "$EFFECTIVE_GH_TOKEN"`)
      expect(entrypoint).toContain(String.raw`printf "export GIT_AUTH_TOKEN=%q\n" "$EFFECTIVE_GITHUB_TOKEN"`)
      expect(entrypoint).toContain("docker_git_upsert_ssh_env \"GITHUB_TOKEN\" \"$EFFECTIVE_GITHUB_TOKEN\"")
      expect(entrypoint).toContain("docker_git_upsert_ssh_env \"GH_TOKEN\" \"$EFFECTIVE_GH_TOKEN\"")
      expect(entrypoint).toContain("docker_git_upsert_ssh_env \"GIT_AUTH_TOKEN\" \"$EFFECTIVE_GITHUB_TOKEN\"")
      expect(entrypoint).toContain("GIT_CREDENTIAL_HELPER_PATH=\"/usr/local/bin/docker-git-credential-helper\"")
      expect(entrypoint).toContain("token=\"${GITHUB_TOKEN:-}\"")
      expect(entrypoint).toContain("token=\"${GH_TOKEN:-}\"")
      expect(entrypoint).toContain(String.raw`printf "%s\n" "password=$token"`)
      expect(entrypoint).toContain("git config --global credential.helper")
    }))
})
