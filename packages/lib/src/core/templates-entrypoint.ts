import type { TemplateConfig } from "./domain.js"
import {
  renderEntrypointBashCompletion,
  renderEntrypointBashHistory,
  renderEntrypointPrompt,
  renderEntrypointZshConfig,
  renderInputRc
} from "./templates-prompt.js"

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
FORK_REPO_URL="\${FORK_REPO_URL:-}"
TARGET_DIR="\${TARGET_DIR:-${config.targetDir}}"
GIT_AUTH_USER="\${GIT_AUTH_USER:-\${GITHUB_USER:-x-access-token}}"
GIT_AUTH_TOKEN="\${GIT_AUTH_TOKEN:-\${GITHUB_TOKEN:-}}"
GH_TOKEN="\${GH_TOKEN:-\${GIT_AUTH_TOKEN:-}}"
GIT_USER_NAME="\${GIT_USER_NAME:-}"
GIT_USER_EMAIL="\${GIT_USER_EMAIL:-}"
CODEX_AUTO_UPDATE="\${CODEX_AUTO_UPDATE:-1}"
MCP_PLAYWRIGHT_ENABLE="\${MCP_PLAYWRIGHT_ENABLE:-${config.enableMcpPlaywright ? "1" : "0"}}"
MCP_PLAYWRIGHT_CDP_ENDPOINT="\${MCP_PLAYWRIGHT_CDP_ENDPOINT:-}"
MCP_PLAYWRIGHT_ISOLATED="\${MCP_PLAYWRIGHT_ISOLATED:-1}"`

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

// CHANGE: share Codex credentials across projects while keeping per-project sessions
// WHY: ChatGPT refresh tokens are rotating; copying auth.json into each project causes stale refresh tokens
// QUOTE(ТЗ): "везде в контейнерах хотим использовать наши креды из .docker-git" | "каждый проект использовал бы свою папку .orch"
// REF: user-request-2026-02-09-orch-per-project-codex-shared-auth
// SOURCE: n/a
// FORMAT THEOREM: ∀p: start(p) → codex_auth(p)=shared ∧ codex_state(p)=local
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: CODEX_HOME/auth.json is a symlink into CODEX_HOME-shared/auth.json when enabled
// COMPLEXITY: O(1)
const renderEntrypointCodexSharedAuth = (config: TemplateConfig): string =>
  `# Share Codex auth.json across projects (avoids refresh_token_reused)
CODEX_SHARE_AUTH="\${CODEX_SHARE_AUTH:-1}"
if [[ "$CODEX_SHARE_AUTH" == "1" ]]; then
  CODEX_SHARED_HOME="${config.codexHome}-shared"
  mkdir -p "$CODEX_SHARED_HOME"
  chown -R 1000:1000 "$CODEX_SHARED_HOME" || true

  AUTH_FILE="${config.codexHome}/auth.json"
  SHARED_AUTH_FILE="$CODEX_SHARED_HOME/auth.json"

  # Guard against a bad bind mount creating a directory at auth.json.
  if [[ -d "$AUTH_FILE" ]]; then
    mv "$AUTH_FILE" "$AUTH_FILE.bak-$(date +%s)" || true
  fi
  if [[ -e "$AUTH_FILE" && ! -L "$AUTH_FILE" ]]; then
    rm -f "$AUTH_FILE" || true
  fi

  ln -sf "$SHARED_AUTH_FILE" "$AUTH_FILE"
fi`

// CHANGE: configure Playwright MCP inside Codex when enabled
// WHY: allow browser automation in containers via an MCP server connected to Chromium (CDP)
// QUOTE(ТЗ): "подключить mcp playright ... нужен хром браузер" | "подключать доп контейнеры с хромом"
// REF: user-request-2026-02-10-mcp-playwright
// SOURCE: n/a
// FORMAT THEOREM: ∀c: MCP_ENABLE(c) → ∃srv: mcp(playwright,srv) ∧ cdp(srv)=endpoint(c)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: config.toml is only appended once per container (idempotent)
// COMPLEXITY: O(1)
const renderEntrypointMcpPlaywright = (config: TemplateConfig): string =>
  String.raw`# Optional: configure Playwright MCP for Codex (browser automation)
CODEX_CONFIG_FILE="${config.codexHome}/config.toml"

# Keep config.toml consistent with the container build.
# If Playwright MCP is disabled for this container, remove the block so Codex
# doesn't try (and fail) to spawn docker-git-playwright-mcp.
if [[ "$MCP_PLAYWRIGHT_ENABLE" != "1" ]]; then
  if [[ -f "$CODEX_CONFIG_FILE" ]] && grep -q "^\[mcp_servers\.playwright" "$CODEX_CONFIG_FILE" 2>/dev/null; then
    awk '
      BEGIN { skip=0 }
      /^# docker-git: Playwright MCP/ { next }
      /^\[mcp_servers[.]playwright([.]|\])/ { skip=1; next }
      skip==1 && /^\[/ { skip=0 }
      skip==0 { print }
    ' "$CODEX_CONFIG_FILE" > "$CODEX_CONFIG_FILE.tmp"
    mv "$CODEX_CONFIG_FILE.tmp" "$CODEX_CONFIG_FILE"
  fi
else
  if [[ ! -f "$CODEX_CONFIG_FILE" ]]; then
    mkdir -p "$(dirname "$CODEX_CONFIG_FILE")" || true
    cat <<'EOF' > "$CODEX_CONFIG_FILE"
# docker-git codex config
model = "gpt-5.3-codex"
model_reasoning_effort = "xhigh"
personality = "pragmatic"

approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "live"

[features]
web_search_request = true
shell_snapshot = true
collab = true
apps = true
shell_tool = true
EOF
    chown 1000:1000 "$CODEX_CONFIG_FILE" || true
  fi

  if [[ -z "$MCP_PLAYWRIGHT_CDP_ENDPOINT" ]]; then
    MCP_PLAYWRIGHT_CDP_ENDPOINT="http://${config.serviceName}-browser:9223"
  fi

  # Replace the docker-git Playwright block to allow upgrades via --force without manual edits.
  if grep -q "^\[mcp_servers\.playwright" "$CODEX_CONFIG_FILE" 2>/dev/null; then
    awk '
      BEGIN { skip=0 }
      /^# docker-git: Playwright MCP/ { next }
      /^\[mcp_servers[.]playwright([.]|\])/ { skip=1; next }
      skip==1 && /^\[/ { skip=0 }
      skip==0 { print }
    ' "$CODEX_CONFIG_FILE" > "$CODEX_CONFIG_FILE.tmp"
    mv "$CODEX_CONFIG_FILE.tmp" "$CODEX_CONFIG_FILE"
  fi

  cat <<EOF >> "$CODEX_CONFIG_FILE"

# docker-git: Playwright MCP (connects to Chromium via CDP)
[mcp_servers.playwright]
command = "docker-git-playwright-mcp"
args = []
EOF
fi`

// CHANGE: ensure readline config exists for history search and completion
// WHY: provide prefix history search and predictable completion UX
// QUOTE(ТЗ): "когда я напишу cd он мне предложит"
// REF: user-request-2026-02-05-inputrc
// SOURCE: n/a
// FORMAT THEOREM: forall s in InteractiveShells: inputrc(s) -> history_search(s)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: does not overwrite existing ~/.inputrc
// COMPLEXITY: O(1)
const renderEntrypointInputRc = (config: TemplateConfig): string =>
  String.raw`# Ensure readline history search bindings for ${config.sshUser}
INPUTRC_PATH="/home/${config.sshUser}/.inputrc"
if [[ ! -f "$INPUTRC_PATH" ]]; then
  cat <<'EOF' > "$INPUTRC_PATH"
${renderInputRc()}
EOF
  chown 1000:1000 "$INPUTRC_PATH" || true
fi`

// CHANGE: show codex resume hint on interactive shells
// WHY: remind users how to resume older Codex sessions after SSH login
// QUOTE(ТЗ): "Старые сесси можно запустить с помощью codex resume или codex resume id если знаю айди"
// REF: user-request-2026-02-06-codex-resume-hint
// SOURCE: n/a
// FORMAT THEOREM: ∀s ∈ InteractiveShells: hint(s) → visible(s)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: hint prints at most once per shell session
// COMPLEXITY: O(1)
const renderEntrypointCodexResumeHint = (): string =>
  `# Ensure codex resume hint is shown for interactive shells
CODEX_HINT_PATH="/etc/profile.d/zz-codex-resume.sh"
if [[ ! -s "$CODEX_HINT_PATH" ]]; then
  cat <<'EOF' > "$CODEX_HINT_PATH"
if [ -n "$BASH_VERSION" ]; then
  case "$-" in
    *i*)
      if [ -z "\${CODEX_RESUME_HINT_SHOWN-}" ]; then
        echo "Старые сессии можно запустить с помощью codex resume или codex resume <id>, если знаешь айди."
        export CODEX_RESUME_HINT_SHOWN=1
      fi
      ;;
  esac
fi
if [ -n "$ZSH_VERSION" ]; then
  if [[ "$-" == *i* ]]; then
    if [[ -z "\${CODEX_RESUME_HINT_SHOWN-}" ]]; then
      echo "Старые сессии можно запустить с помощью codex resume или codex resume <id>, если знаешь айди."
      export CODEX_RESUME_HINT_SHOWN=1
    fi
  fi
fi
EOF
  chmod 0644 "$CODEX_HINT_PATH"
fi
if ! grep -q "zz-codex-resume.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\\n" "if [ -f /etc/profile.d/zz-codex-resume.sh ]; then . /etc/profile.d/zz-codex-resume.sh; fi" >> /etc/bash.bashrc
fi
if [[ -s /etc/zsh/zshrc ]] && ! grep -q "zz-codex-resume.sh" /etc/zsh/zshrc 2>/dev/null; then
  printf "%s\\n" "if [ -f /etc/profile.d/zz-codex-resume.sh ]; then source /etc/profile.d/zz-codex-resume.sh; fi" >> /etc/zsh/zshrc
fi`

// CHANGE: ensure the ssh user defaults to zsh when available
// WHY: enable autosuggestions and zsh prompt for interactive sessions
// QUOTE(ТЗ): "пусть будет zzh если он сделате то что я хочу"
// REF: user-request-2026-02-05-zsh-autosuggest
// SOURCE: n/a
// FORMAT THEOREM: ∀u: zsh(u) -> shell(u)=zsh
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: only changes shell if zsh exists
// COMPLEXITY: O(1)
const renderEntrypointZshShell = (config: TemplateConfig): string =>
  String.raw`# Prefer zsh for ${config.sshUser} when available
if command -v zsh >/dev/null 2>&1; then
  usermod -s /usr/bin/zsh ${config.sshUser} || true
fi`

// CHANGE: prevent zsh new-user wizard and ensure user zshrc exists
// WHY: avoid interactive zsh-newuser-install prompt on SSH login
// QUOTE(ТЗ): "Что за дичь меня встречает при подключение через SSH?"
// REF: user-request-2026-02-05-zsh-newuser
// SOURCE: n/a
// FORMAT THEOREM: ∀u: zsh(u) → exists(u/.zshrc)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: does not overwrite existing ~/.zshrc
// COMPLEXITY: O(1)
const renderEntrypointZshUserRc = (config: TemplateConfig): string =>
  String.raw`# Ensure ${config.sshUser} has a zshrc and disable newuser wizard
ZSHENV_PATH="/etc/zsh/zshenv"
if [[ -f "$ZSHENV_PATH" ]]; then
  if ! grep -q "ZSH_DISABLE_NEWUSER_INSTALL" "$ZSHENV_PATH"; then
    printf "%s\n" "export ZSH_DISABLE_NEWUSER_INSTALL=1" >> "$ZSHENV_PATH"
  fi
else
  printf "%s\n" "export ZSH_DISABLE_NEWUSER_INSTALL=1" > "$ZSHENV_PATH"
fi
USER_ZSHRC="/home/${config.sshUser}/.zshrc"
if [[ ! -f "$USER_ZSHRC" ]]; then
  cat <<'EOF' > "$USER_ZSHRC"
# docker-git default zshrc
if [ -f /etc/zsh/zshrc ]; then
  source /etc/zsh/zshrc
fi
EOF
  chown 1000:1000 "$USER_ZSHRC" || true
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

// CHANGE: configure fork/upstream remotes after clone
// WHY: allow auto-fork to become the default push target
// QUOTE(ТЗ): "Сразу на issues и он бы делал форк репы если это надо"
// REF: user-request-2026-02-05-issues-fork
// SOURCE: n/a
// FORMAT THEOREM: ∀r: fork(r) → origin=fork ∧ upstream=repo
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: only runs when clone succeeded
// COMPLEXITY: O(1)
const renderCloneRemotes = (config: TemplateConfig): string =>
  `if [[ "$CLONE_OK" -eq 1 && -n "$FORK_REPO_URL" && -d "$TARGET_DIR/.git" ]]; then
  AUTH_FORK_URL="$FORK_REPO_URL"
  if [[ -n "$GIT_AUTH_TOKEN" && "$FORK_REPO_URL" == https://* ]]; then
    AUTH_FORK_URL="$(printf "%s" "$FORK_REPO_URL" | sed "s#^https://#https://\${GIT_AUTH_USER}:\${GIT_AUTH_TOKEN}@#")"
  fi
  if [[ "$FORK_REPO_URL" != "$REPO_URL" ]]; then
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote set-url origin '$AUTH_FORK_URL'" || true
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote add upstream '$AUTH_REPO_URL' 2>/dev/null || git remote set-url upstream '$AUTH_REPO_URL'" || true
  fi
fi`

const renderCloneBodyStart = (config: TemplateConfig): string =>
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
  fi`

// CHANGE: fallback to the remote default branch when requested branch is missing
// WHY: allow cloning repos whose default branch is not "main"
// QUOTE(ТЗ): "fatal: Remote branch main not found in upstream origin"
// REF: user-request-2026-02-05-default-branch
// SOURCE: n/a
// FORMAT THEOREM: ∀r: missing(ref) → clone(default_ref)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: fallback only runs after a failed branch clone
// COMPLEXITY: O(1)
const renderCloneBodyRef = (config: TemplateConfig): string =>
  `  if [[ -n "$REPO_REF" ]]; then
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
        DEFAULT_REF="$(git ls-remote --symref "$AUTH_REPO_URL" HEAD 2>/dev/null | awk '/^ref:/ {print $2}' | head -n 1 || true)"
        DEFAULT_BRANCH="$(printf "%s" "$DEFAULT_REF" | sed 's#^refs/heads/##')"
        if [[ -n "$DEFAULT_BRANCH" ]]; then
          echo "[clone] branch '$REPO_REF' missing; retrying with '$DEFAULT_BRANCH'"
          if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress --branch '$DEFAULT_BRANCH' '$AUTH_REPO_URL' '$TARGET_DIR'"; then
            echo "[clone] git clone failed for $REPO_URL"
            CLONE_OK=0
          fi
        else
          echo "[clone] git clone failed for $REPO_URL"
          CLONE_OK=0
        fi
      fi
    fi
  else
    if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress '$AUTH_REPO_URL' '$TARGET_DIR'"; then
      echo "[clone] git clone failed for $REPO_URL"
      CLONE_OK=0
    fi
  fi`

const renderCloneBody = (config: TemplateConfig): string =>
  [renderCloneBodyStart(config), renderCloneBodyRef(config), "", renderCloneRemotes(config), "fi"].join("\n")

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

// CHANGE: propagate GitHub tokens into SSH sessions for gh/git usage
// WHY: ensure gh and git can authenticate using configured tokens
// QUOTE(ТЗ): "git, gh должны получать наши ключи которые у нас заданы"
// REF: user-request-2026-02-05-gh-auth-env
// SOURCE: n/a
// FORMAT THEOREM: ∀t: token(t) → env(GH_TOKEN)=t
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: does not write env files when token is empty
// COMPLEXITY: O(1)
const renderEntrypointGitConfig = (config: TemplateConfig): string =>
  String.raw`# 2) Ensure GH_TOKEN is available for SSH sessions if provided
if [[ -n "$GH_TOKEN" ]]; then
  printf "export GH_TOKEN=%q\n" "$GH_TOKEN" > /etc/profile.d/gh-token.sh
  chmod 0644 /etc/profile.d/gh-token.sh
  SSH_ENV_PATH="/home/${config.sshUser}/.ssh/environment"
  printf "%s\n" "GH_TOKEN=$GH_TOKEN" > "$SSH_ENV_PATH"
  if [[ -n "$GITHUB_TOKEN" ]]; then
    printf "%s\n" "GITHUB_TOKEN=$GITHUB_TOKEN" >> "$SSH_ENV_PATH"
  fi
  chmod 600 "$SSH_ENV_PATH"
  chown 1000:1000 "$SSH_ENV_PATH" || true
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

// CHANGE: enforce protected branches via global git hooks in container
// WHY: prevent AI from pushing to main/master or deleting branches
// QUOTE(ТЗ): "Пусть создаёт ветки"
// REF: user-request-2026-02-05-git-hooks
// SOURCE: n/a
// FORMAT THEOREM: ∀p: push(p) ∧ protected(p) → reject(p)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: hook is installed once and is executable
// COMPLEXITY: O(1)
const renderEntrypointGitHooks = (): string =>
  String.raw`# 3) Install global git hooks to protect main/master
HOOKS_DIR="/opt/docker-git/hooks"
PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"
mkdir -p "$HOOKS_DIR"
if [[ ! -f "$PRE_PUSH_HOOK" ]]; then
  cat <<'EOF' > "$PRE_PUSH_HOOK"
#!/usr/bin/env bash
set -euo pipefail

protected_branches=("refs/heads/main" "refs/heads/master")
allow_delete="${"${"}DOCKER_GIT_ALLOW_DELETE:-}"

while read -r local_ref local_sha remote_ref remote_sha; do
  if [[ -z "$remote_ref" ]]; then
    continue
  fi
  for protected in "${"${"}protected_branches[@]}"; do
    if [[ "$remote_ref" == "$protected" || "$local_ref" == "$protected" ]]; then
      echo "docker-git: push to protected branch '${"${"}protected##*/}' is disabled."
      echo "docker-git: create a new branch: git checkout -b <name>"
      exit 1
    fi
  done
  if [[ "$local_sha" == "0000000000000000000000000000000000000000" && "$remote_ref" == refs/heads/* ]]; then
    if [[ "$allow_delete" != "1" ]]; then
      echo "docker-git: deleting remote branches is disabled (set DOCKER_GIT_ALLOW_DELETE=1 to override)."
      exit 1
    fi
  fi
done
EOF
  chmod 0755 "$PRE_PUSH_HOOK"
fi
git config --system core.hooksPath "$HOOKS_DIR" || true
git config --global core.hooksPath "$HOOKS_DIR" || true`

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

// CHANGE: disable noisy Ubuntu MOTD for SSH logins
// WHY: keep SSH login clean, docker-git shows its own UX hints
// QUOTE(ТЗ): "Нашей информации не вижу ЗА то вижу кучу мусора"
// REF: user-request-2026-02-06-disable-motd
// SOURCE: n/a
// FORMAT THEOREM: ∀login: motd_disabled(login) → ¬ubuntu_banner(login)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: edits /etc/pam.d/sshd idempotently (comments only)
// COMPLEXITY: O(n) where n = number of pam lines
const renderEntrypointDisableMotd = (): string =>
  String.raw`# 4.75) Disable Ubuntu MOTD noise for SSH sessions
PAM_SSHD="/etc/pam.d/sshd"
if [[ -f "$PAM_SSHD" ]]; then
  sed -i 's/^[[:space:]]*session[[:space:]]\+optional[[:space:]]\+pam_motd\.so/#&/' "$PAM_SSHD" || true
  sed -i 's/^[[:space:]]*session[[:space:]]\+optional[[:space:]]\+pam_lastlog\.so/#&/' "$PAM_SSHD" || true
fi

# Also disable sshd's own banners (e.g. "Last login")
mkdir -p /etc/ssh/sshd_config.d || true
DOCKER_GIT_SSHD_CONF="/etc/ssh/sshd_config.d/zz-docker-git-clean.conf"
cat <<'EOF' > "$DOCKER_GIT_SSHD_CONF"
PrintMotd no
PrintLastLog no
EOF
chmod 0644 "$DOCKER_GIT_SSHD_CONF" || true`

const renderEntrypointSshd = (): string => `# 5) Run sshd in foreground\nexec /usr/sbin/sshd -D`

export const renderEntrypoint = (config: TemplateConfig): string =>
  [
    renderEntrypointHeader(config),
    renderEntrypointAuthorizedKeys(config),
    renderEntrypointCodexHome(config),
    renderEntrypointCodexSharedAuth(config),
    renderEntrypointMcpPlaywright(config),
    renderEntrypointZshShell(config),
    renderEntrypointZshUserRc(config),
    renderEntrypointPrompt(),
    renderEntrypointBashCompletion(),
    renderEntrypointBashHistory(),
    renderEntrypointInputRc(config),
    renderEntrypointZshConfig(),
    renderEntrypointCodexResumeHint(),
    renderEntrypointAgentsNotice(config),
    renderEntrypointDockerSocket(config),
    renderEntrypointGitConfig(config),
    renderEntrypointGitHooks(),
    renderEntrypointBackgroundTasks(config),
    renderEntrypointBaseline(),
    renderEntrypointDisableMotd(),
    renderEntrypointSshd()
  ].join("\n\n")
