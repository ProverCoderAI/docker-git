import type { TemplateConfig } from "./domain.js"
import { renderEntrypointPrompt } from "./templates-prompt.js"

// CHANGE: ensure target dir ownership and git identity in entrypoint
// WHY: allow cloning into root-level workspaces + auto-config git for commits
// QUOTE(ТЗ): "Клонирует он в \"/\"" | "git config should be set automatically"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall env: name/email set -> gitconfig set for user
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: emits a deterministic entrypoint script
// COMPLEXITY: O(1)
const renderEntrypointHeader = (config: TemplateConfig): string =>
  `#!/usr/bin/env bash
set -euo pipefail

REPO_URL="\${REPO_URL:-}"
REPO_REF="\${REPO_REF:-}"
TARGET_DIR="\${TARGET_DIR:-${config.targetDir}}"
GIT_AUTH_USER="\${GIT_AUTH_USER:-\${GITHUB_USER:-x-access-token}}"
GIT_AUTH_TOKEN="\${GIT_AUTH_TOKEN:-\${GITHUB_TOKEN:-}}"
GH_TOKEN="\${GH_TOKEN:-\${GIT_AUTH_TOKEN:-}}"
GIT_USER_NAME="\${GIT_USER_NAME:-}"
GIT_USER_EMAIL="\${GIT_USER_EMAIL:-}"
CODEX_AUTO_UPDATE="\${CODEX_AUTO_UPDATE:-1}"`

const renderEntrypointAuthorizedKeys = (config: TemplateConfig): string =>
  `# 1) Authorized keys are mounted from host at /authorized_keys
mkdir -p /home/${config.sshUser}/.ssh
chmod 700 /home/${config.sshUser}/.ssh

if [[ -f /authorized_keys ]]; then
  cp /authorized_keys /home/${config.sshUser}/.ssh/authorized_keys
  chmod 600 /home/${config.sshUser}/.ssh/authorized_keys
fi

chown -R 1000:1000 /home/${config.sshUser}/.ssh`

const renderEntrypointCodexHome = (config: TemplateConfig): string =>
  `# Ensure Codex home exists if mounted
mkdir -p ${config.codexHome}
chown -R 1000:1000 ${config.codexHome}

# Ensure home ownership matches the dev UID/GID (volumes may be stale)
HOME_OWNER="$(stat -c "%u:%g" /home/${config.sshUser} 2>/dev/null || echo "")"
if [[ "$HOME_OWNER" != "1000:1000" ]]; then
  chown -R 1000:1000 /home/${config.sshUser} || true
fi`

// CHANGE: create a global AGENTS.md under the Codex home
// WHY: ensure agents read instructions from ~/.codex/AGENTS.md
// QUOTE(ТЗ): "он должен лежать в ~/.codex/"
// REF: user-request-2026-02-05-codex-agents-path
// SOURCE: n/a
// FORMAT THEOREM: ∀c: start(c) → exists(${config.codexHome}/AGENTS.md)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: does not overwrite AGENTS.md if user already created it
// COMPLEXITY: O(1)
const renderEntrypointAgentsNotice = (config: TemplateConfig): string =>
  String.raw`# Ensure global AGENTS.md exists for container context
AGENTS_PATH="${config.codexHome}/AGENTS.md"
LEGACY_AGENTS_PATH="/home/${config.sshUser}/AGENTS.md"
PROJECT_LINE="Рабочая папка проекта (git clone): ${config.targetDir}"
INTERNET_LINE="Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе."
if [[ ! -f "$AGENTS_PATH" ]]; then
  cat <<'AGENTS_EOF' > "$AGENTS_PATH"
Ты автономный агент, который имеет полностью все права управления контейнером. У тебя есть доступ к командам sudo, gh, codex, git, node, pnpm и всем остальным другим. Проекты с которыми идёт работа лежат по пути ~
Рабочая папка проекта (git clone): ${config.targetDir}
Доступ к интернету: есть. Если чего-то не знаешь — ищи в интернете или по кодовой базе.
Если ты видишь файлы AGENTS.md внутри проекта, ты обязан их читать и соблюдать инструкции.
AGENTS_EOF
  chown 1000:1000 "$AGENTS_PATH" || true
fi
if [[ -f "$AGENTS_PATH" ]]; then
  if grep -q "^Рабочая папка проекта (git clone):" "$AGENTS_PATH"; then
    sed -i "s|^Рабочая папка проекта (git clone):.*$|$PROJECT_LINE|" "$AGENTS_PATH"
  else
    printf "%s\n" "$PROJECT_LINE" >> "$AGENTS_PATH"
  fi
  if grep -q "^Доступ к интернету:" "$AGENTS_PATH"; then
    sed -i "s|^Доступ к интернету:.*$|$INTERNET_LINE|" "$AGENTS_PATH"
  else
    printf "%s\n" "$INTERNET_LINE" >> "$AGENTS_PATH"
  fi
fi
if [[ -f "$LEGACY_AGENTS_PATH" && -f "$AGENTS_PATH" ]]; then
  LEGACY_SUM="$(cksum "$LEGACY_AGENTS_PATH" 2>/dev/null | awk '{print $1 ":" $2}')"
  CODEX_SUM="$(cksum "$AGENTS_PATH" 2>/dev/null | awk '{print $1 ":" $2}')"
  if [[ -n "$LEGACY_SUM" && "$LEGACY_SUM" == "$CODEX_SUM" ]]; then
    rm -f "$LEGACY_AGENTS_PATH"
  fi
fi`

const renderEntrypointDockerSocket = (config: TemplateConfig): string =>
  `# Ensure docker socket access for ${config.sshUser}
if [[ -S /var/run/docker.sock ]]; then
  DOCKER_SOCK_GID="$(stat -c "%g" /var/run/docker.sock)"
  DOCKER_GROUP="$(getent group "$DOCKER_SOCK_GID" | cut -d: -f1 || true)"
  if [[ -z "$DOCKER_GROUP" ]]; then
    DOCKER_GROUP="docker"
    groupadd -g "$DOCKER_SOCK_GID" "$DOCKER_GROUP" || true
  fi
  usermod -aG "$DOCKER_GROUP" ${config.sshUser} || true
  printf "export DOCKER_HOST=unix:///var/run/docker.sock\n" > /etc/profile.d/docker-host.sh
fi`

const renderEntrypointAutoUpdate = (): string =>
  `# 1) Keep Codex CLI up to date if requested (bun only)
if [[ "$CODEX_AUTO_UPDATE" == "1" ]]; then
  if command -v bun >/dev/null 2>&1; then
    echo "[codex] updating via bun..."
    script -q -e -c "bun add -g @openai/codex@latest" /dev/null || true
  else
    echo "[codex] bun not found, skipping auto-update"
  fi
fi`

const renderClonePreamble = (): string =>
  `# 2) Auto-clone repo if not already present
mkdir -p /run/docker-git
CLONE_DONE_PATH="/run/docker-git/clone.done"
CLONE_FAIL_PATH="/run/docker-git/clone.failed"
rm -f "$CLONE_DONE_PATH" "$CLONE_FAIL_PATH"

CLONE_OK=1`

const renderCloneBody = (config: TemplateConfig): string =>
  `if [[ -z "$REPO_URL" ]]; then
  echo "[clone] skip (no repo url)"
elif [[ -d "$TARGET_DIR/.git" ]]; then
  echo "[clone] skip (already cloned)"
else
  mkdir -p "$TARGET_DIR"
  if [[ "$TARGET_DIR" != "/" ]]; then
    chown -R 1000:1000 "$TARGET_DIR"
  fi
  chown -R 1000:1000 /home/${config.sshUser}

  AUTH_REPO_URL="$REPO_URL"
  if [[ -n "$GIT_AUTH_TOKEN" && "$REPO_URL" == https://* ]]; then
    AUTH_REPO_URL="$(printf "%s" "$REPO_URL" | sed "s#^https://#https://\${GIT_AUTH_USER}:\${GIT_AUTH_TOKEN}@#")"
  fi

  if [[ -n "$REPO_REF" ]]; then
    if [[ "$REPO_REF" == refs/pull/* ]]; then
      REF_BRANCH="pr-$(printf "%s" "$REPO_REF" | tr '/:' '--')"
      if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress '$AUTH_REPO_URL' '$TARGET_DIR'"; then
        echo "[clone] git clone failed for $REPO_URL"
        CLONE_OK=0
      else
        if ! su - ${config.sshUser} -c "cd '$TARGET_DIR' && GIT_TERMINAL_PROMPT=0 git fetch --progress origin '$REPO_REF':'$REF_BRANCH' && git checkout '$REF_BRANCH'"; then
          echo "[clone] git fetch failed for $REPO_REF"
          CLONE_OK=0
        fi
      fi
    else
      if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress --branch '$REPO_REF' '$AUTH_REPO_URL' '$TARGET_DIR'"; then
        echo "[clone] git clone failed for $REPO_URL"
        CLONE_OK=0
      fi
    fi
  else
    if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress '$AUTH_REPO_URL' '$TARGET_DIR'"; then
      echo "[clone] git clone failed for $REPO_URL"
      CLONE_OK=0
    fi
  fi
fi`

const renderCloneFinalize = (): string =>
  `if [[ "$CLONE_OK" -eq 1 ]]; then
  echo "[clone] done"
  touch "$CLONE_DONE_PATH"
else
  echo "[clone] failed"
  touch "$CLONE_FAIL_PATH"
fi`

const renderEntrypointClone = (config: TemplateConfig): string =>
  [renderClonePreamble(), renderCloneBody(config), renderCloneFinalize()].join("\n\n")

const renderEntrypointGitConfig = (config: TemplateConfig): string =>
  String.raw`# 2) Ensure GH_TOKEN is available for SSH sessions if provided
if [[ -n "$GH_TOKEN" ]]; then
  printf "export GH_TOKEN=%q\n" "$GH_TOKEN" > /etc/profile.d/gh-token.sh
  chmod 0644 /etc/profile.d/gh-token.sh
fi

# 3) Configure git identity for the dev user if provided
if [[ -n "$GIT_USER_NAME" ]]; then
  SAFE_GIT_USER_NAME="$(printf "%q" "$GIT_USER_NAME")"
  su - ${config.sshUser} -c "git config --global user.name $SAFE_GIT_USER_NAME"
fi

if [[ -n "$GIT_USER_EMAIL" ]]; then
  SAFE_GIT_USER_EMAIL="$(printf "%q" "$GIT_USER_EMAIL")"
  su - ${config.sshUser} -c "git config --global user.email $SAFE_GIT_USER_EMAIL"
fi`

const renderEntrypointBackgroundTasks = (config: TemplateConfig): string =>
  `# 4) Start background tasks so SSH can come up immediately
(
${renderEntrypointAutoUpdate()}

${renderEntrypointClone(config)}
) &`

// CHANGE: snapshot baseline processes for terminal session filtering
// WHY: allow "sessions list" to hide default processes by default
// QUOTE(ТЗ): "Можно ли запомнить какие процессы изначально запущены и просто их не отображать как терминалы?"
// REF: user-request-2026-02-05-sessions-baseline
// SOURCE: n/a
// FORMAT THEOREM: ∀p: baseline(p) → stored(p)
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: baseline path is stable across container restarts
// COMPLEXITY: O(n) where n = number of processes
const renderEntrypointBaseline = (): string =>
  `# 4.5) Snapshot baseline processes for terminal session filtering
mkdir -p /run/docker-git
BASELINE_PATH="/run/docker-git/terminal-baseline.pids"
if [[ ! -f "$BASELINE_PATH" ]]; then
  ps -eo pid= > "$BASELINE_PATH" || true
fi`

const renderEntrypointSshd = (): string =>
  `# 5) Run sshd in foreground
exec /usr/sbin/sshd -D`

export const renderEntrypoint = (config: TemplateConfig): string =>
  [
    renderEntrypointHeader(config),
    renderEntrypointAuthorizedKeys(config),
    renderEntrypointCodexHome(config),
    renderEntrypointPrompt(),
    renderEntrypointAgentsNotice(config),
    renderEntrypointDockerSocket(config),
    renderEntrypointGitConfig(config),
    renderEntrypointBackgroundTasks(config),
    renderEntrypointBaseline(),
    renderEntrypointSshd()
  ].join("\n\n")
