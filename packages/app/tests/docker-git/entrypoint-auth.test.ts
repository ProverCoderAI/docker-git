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
      expect(entrypoint).toContain("CLAUDE_REAL_DIR=\"$(dirname \"$CURRENT_CLAUDE_BIN\")\"")
      expect(entrypoint).toContain("CLAUDE_REAL_BIN=\"$CLAUDE_REAL_DIR/.docker-git-claude-real\"")
      expect(entrypoint).toContain("CLAUDE_WRAPPER_BIN=\"/usr/local/bin/claude\"")
      expect(entrypoint).toContain("cat <<'EOF' > \"$CLAUDE_WRAPPER_BIN\"")
      expect(entrypoint).toContain("CLAUDE_REAL_BIN=\"__CLAUDE_REAL_BIN__\"")
      expect(entrypoint).toContain(
        "sed -i \"s#__CLAUDE_REAL_BIN__#$CLAUDE_REAL_BIN#g\" \"$CLAUDE_WRAPPER_BIN\" || true"
      )
      expect(entrypoint).toContain("CLAUDE_CONFIG_DIR=\"${CLAUDE_CONFIG_DIR:-$HOME/.claude}\"")
      expect(entrypoint).toContain("docker_git_ensure_claude_cli()")
      expect(entrypoint).toContain("claude cli.js not found under npm global root; skip shim restore")
      expect(entrypoint).toContain("CLAUDE_PERMISSION_SETTINGS_FILE=\"$CLAUDE_CONFIG_DIR/settings.json\"")
      expect(entrypoint).toContain("docker_git_sync_claude_permissions()")
      expect(entrypoint).toContain(
        "const currentPermissions = isRecord(settings.permissions) ? settings.permissions : {}"
      )
      expect(entrypoint).toContain("defaultMode: \"bypassPermissions\"")
      expect(entrypoint).toContain("CLAUDE_TOKEN_FILE=\"$CLAUDE_CONFIG_DIR/.oauth-token\"")
      expect(entrypoint).toContain("CLAUDE_CREDENTIALS_FILE=\"$CLAUDE_CONFIG_DIR/.credentials.json\"")
      expect(entrypoint).toContain("CLAUDE_NESTED_CREDENTIALS_FILE=\"$CLAUDE_CONFIG_DIR/.claude/.credentials.json\"")
      expect(entrypoint).toContain("docker_git_prepare_claude_auth_mode()")
      expect(entrypoint).toContain(
        "rm -f \"$CLAUDE_CREDENTIALS_FILE\" \"$CLAUDE_NESTED_CREDENTIALS_FILE\" \"$CLAUDE_HOME_DIR/.credentials.json\" || true"
      )
      expect(entrypoint).toContain("if [[ ! -s \"$CLAUDE_TOKEN_FILE\" ]]; then")
      expect(entrypoint).toContain("CLAUDE_SETTINGS_FILE=\"${CLAUDE_HOME_JSON:-$CLAUDE_CONFIG_DIR/.claude.json}\"")
      expect(entrypoint).toContain("nextServers.playwright = {")
      expect(entrypoint).toContain("command: \"docker-git-playwright-mcp\"")
      expect(entrypoint).toContain("CLAUDE_ROOT_TOKEN_FILE=\"$CLAUDE_AUTH_ROOT/.oauth-token\"")
      expect(entrypoint).toContain("CLAUDE_ROOT_CONFIG_FILE=\"$CLAUDE_AUTH_ROOT/.config.json\"")
      expect(entrypoint).toContain("CLAUDE_HOME_DIR=\"/home/dev/.claude\"")
      expect(entrypoint).toContain("CLAUDE_HOME_JSON=\"/home/dev/.claude.json\"")
      expect(entrypoint).toContain("docker_git_link_claude_home_file()")
      expect(entrypoint).toContain("docker_git_link_claude_home_file \".oauth-token\"")
      expect(entrypoint).toContain("docker_git_link_claude_home_file \".config.json\"")
      expect(entrypoint).toContain("docker_git_link_claude_home_file \".claude.json\"")
      expect(entrypoint).toContain("docker_git_link_claude_home_file \".credentials.json\"")
      expect(entrypoint).toContain(
        "docker_git_link_claude_file \"$CLAUDE_CONFIG_DIR/.claude.json\" \"$CLAUDE_HOME_JSON\""
      )
      expect(entrypoint).toContain("su - dev -s /bin/bash -c \"bash -lc")
      expect(entrypoint).toContain(". /etc/profile 2>/dev/null || true;")
      expect(entrypoint).toContain(String.raw`. \"$AGENT_ENV_FILE\" 2>/dev/null || true;`)
      expect(entrypoint).toContain(
        String.raw`claude --dangerously-skip-permissions -p \"\$(cat \"$AGENT_PROMPT_FILE\")\"`
      )
      expect(entrypoint).toContain(String.raw`codex exec \"\$(cat \"$AGENT_PROMPT_FILE\")\"`)
      expect(entrypoint).not.toContain("codex --approval-mode full-auto")
      expect(entrypoint).toContain("CLAUDE_GLOBAL_PROMPT_FILE=\"/home/dev/.claude/CLAUDE.md\"")
      expect(entrypoint).toContain("CLAUDE_AUTO_SYSTEM_PROMPT=\"${CLAUDE_AUTO_SYSTEM_PROMPT:-1}\"")
      expect(entrypoint).toContain("docker-git-managed:claude-md")
      expect(entrypoint).toContain("BEHAVIOR_BLOCK=")
      expect(entrypoint).toContain("SUBAGENTS (ОБЯЗАТЕЛЬНО):")
      expect(entrypoint).toContain("ОБЯЗАТЕЛЬНЫЙ КОНТРАКТ ОТВЕТА:")
      expect(entrypoint).toContain("DEEP RESEARCH:")
      expect(entrypoint).toContain("token=\"${GITHUB_TOKEN:-}\"")
      expect(entrypoint).toContain("token=\"${GH_TOKEN:-}\"")
      expect(entrypoint).toContain(String.raw`printf "%s\n" "password=$token"`)
      expect(entrypoint).toContain("git config --global credential.helper")
    }))
})
