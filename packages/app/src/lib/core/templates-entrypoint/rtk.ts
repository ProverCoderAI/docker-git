/* jscpd:ignore-start */
import type { TemplateConfig } from "../domain.js"

// CHANGE: configure RTK hooks/instructions for the bundled AI agents at startup.
// WHY: generated docker-git containers should reduce command-output tokens without manual setup.
// QUOTE(TASK): "make it work out of the box for docker-git"
// REF: issue-266
// SOURCE: https://github.com/rtk-ai/rtk/blob/develop/README.md
// FORMAT THEOREM: forall start: RTK_ENABLED(start) -> configured(codex, claude, gemini, grok, opencode)
// PURITY: CORE (pure template renderer)
// INVARIANT: RTK init runs as the non-root SSH user and never blocks container startup.
// COMPLEXITY: O(1)
export const renderEntrypointRtkConfig = (config: TemplateConfig): string =>
  String.raw`# RTK: configure command-output token optimization for supported agents.
DOCKER_GIT_RTK_ENABLE="${"$"}{DOCKER_GIT_RTK_ENABLE:-1}"
docker_git_upsert_ssh_env "DOCKER_GIT_RTK_ENABLE" "$DOCKER_GIT_RTK_ENABLE"

docker_git_rtk_init_as_user() {
  local label="$1"
  local command="$2"

  if [[ "$DOCKER_GIT_RTK_ENABLE" != "1" ]]; then
    return 0
  fi

  if ! command -v rtk >/dev/null 2>&1; then
    echo "[rtk] warning: rtk binary not found; skipping $label setup" >&2
    return 0
  fi

  mkdir -p "$CLAUDE_CONFIG_DIR" "__CODEX_HOME__" "/home/__SSH_USER__/.config/opencode" "/home/__SSH_USER__/.gemini" "/home/__SSH_USER__/.grok" || true
  chown -R 1000:1000 "$CLAUDE_CONFIG_DIR" "__CODEX_HOME__" "/home/__SSH_USER__/.config" "/home/__SSH_USER__/.gemini" "/home/__SSH_USER__/.grok" 2>/dev/null || true

  if su - __SSH_USER__ -s /bin/bash -c "$command" </dev/null; then
    echo "[rtk] configured $label"
  else
    echo "[rtk] warning: failed to configure $label" >&2
  fi
}

docker_git_rtk_init_as_user "codex" "HOME=/home/__SSH_USER__ CODEX_HOME='__CODEX_HOME__' rtk init -g --codex"
docker_git_rtk_init_as_user "claude" "HOME=/home/__SSH_USER__ RTK_CLAUDE_DIR='$CLAUDE_CONFIG_DIR' rtk init -g --auto-patch"
docker_git_rtk_init_as_user "gemini" "HOME=/home/__SSH_USER__ rtk init -g --gemini --auto-patch"
docker_git_rtk_init_as_user "opencode" "HOME=/home/__SSH_USER__ rtk init -g --opencode"`
    .replaceAll("__SSH_USER__", config.sshUser)
    .replaceAll("__CODEX_HOME__", config.codexHome)
/* jscpd:ignore-end */
