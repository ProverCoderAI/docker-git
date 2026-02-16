import type { TemplateConfig } from "../domain.js"

const renderEntrypointAutoUpdate = (): string =>
  `# 1) Keep Codex CLI up to date if requested (bun only)
if [[ "$CODEX_AUTO_UPDATE" == "1" ]]; then
  if command -v bun >/dev/null 2>&1; then
    echo "[codex] updating via bun..."
    BUN_INSTALL=/usr/local/bun script -q -e -c "bun add -g @openai/codex@latest" /dev/null || true
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

const renderCloneRemotes = (config: TemplateConfig): string =>
  `if [[ "$CLONE_OK" -eq 1 && -d "$TARGET_DIR/.git" ]]; then
  if [[ -n "$FORK_REPO_URL" && "$FORK_REPO_URL" != "$REPO_URL" ]]; then
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote set-url origin '$FORK_REPO_URL'" || true
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote add upstream '$REPO_URL' 2>/dev/null || git remote set-url upstream '$REPO_URL'" || true
  else
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote set-url origin '$REPO_URL'" || true
    su - ${config.sshUser} -c "cd '$TARGET_DIR' && git remote remove upstream >/dev/null 2>&1 || true" || true
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
  fi

  CLONE_CACHE_ARGS=""
  CACHE_REPO_DIR=""
  CACHE_ROOT="/home/${config.sshUser}/.docker-git/.cache/git-mirrors"
  if command -v sha256sum >/dev/null 2>&1; then
    REPO_CACHE_KEY="$(printf "%s" "$REPO_URL" | sha256sum | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    REPO_CACHE_KEY="$(printf "%s" "$REPO_URL" | shasum -a 256 | awk '{print $1}')"
  else
    REPO_CACHE_KEY="$(printf "%s" "$REPO_URL" | tr '/:@' '_' | tr -cd '[:alnum:]_.-')"
  fi

  if [[ -n "$REPO_CACHE_KEY" ]]; then
    CACHE_REPO_DIR="$CACHE_ROOT/$REPO_CACHE_KEY.git"
    mkdir -p "$CACHE_ROOT"
    chown 1000:1000 "$CACHE_ROOT" || true
    if [[ -d "$CACHE_REPO_DIR" ]]; then
      if su - ${config.sshUser} -c "git --git-dir '$CACHE_REPO_DIR' rev-parse --is-bare-repository >/dev/null 2>&1"; then
        if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git --git-dir '$CACHE_REPO_DIR' fetch --progress --prune '$REPO_URL' '+refs/*:refs/*'"; then
          echo "[clone-cache] mirror refresh failed for $REPO_URL"
        fi
        CLONE_CACHE_ARGS="--reference-if-able '$CACHE_REPO_DIR' --dissociate"
        echo "[clone-cache] using mirror: $CACHE_REPO_DIR"
      else
        echo "[clone-cache] invalid mirror removed: $CACHE_REPO_DIR"
        rm -rf "$CACHE_REPO_DIR"
      fi
    fi
  fi`

const renderCloneBodyRef = (config: TemplateConfig): string =>
  `  if [[ -n "$REPO_REF" ]]; then
    if [[ "$REPO_REF" == refs/pull/* ]]; then
      REF_BRANCH="pr-$(printf "%s" "$REPO_REF" | tr '/:' '--')"
      if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS '$AUTH_REPO_URL' '$TARGET_DIR'"; then
        echo "[clone] git clone failed for $REPO_URL"
        CLONE_OK=0
      else
        if ! su - ${config.sshUser} -c "cd '$TARGET_DIR' && GIT_TERMINAL_PROMPT=0 git fetch --progress origin '$REPO_REF':'$REF_BRANCH' && git checkout '$REF_BRANCH'"; then
          echo "[clone] git fetch failed for $REPO_REF"
          CLONE_OK=0
        fi
      fi
    else
      if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS --branch '$REPO_REF' '$AUTH_REPO_URL' '$TARGET_DIR'"; then
        DEFAULT_REF="$(git ls-remote --symref "$AUTH_REPO_URL" HEAD 2>/dev/null | awk '/^ref:/ {print $2}' | head -n 1 || true)"
        DEFAULT_BRANCH="$(printf "%s" "$DEFAULT_REF" | sed 's#^refs/heads/##')"
        if [[ -n "$DEFAULT_BRANCH" ]]; then
          echo "[clone] branch '$REPO_REF' missing; retrying with '$DEFAULT_BRANCH'"
          if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS --branch '$DEFAULT_BRANCH' '$AUTH_REPO_URL' '$TARGET_DIR'"; then
            echo "[clone] git clone failed for $REPO_URL"
            CLONE_OK=0
          elif [[ "$REPO_REF" == issue-* ]]; then
            if ! su - ${config.sshUser} -c "cd '$TARGET_DIR' && git checkout -B '$REPO_REF'"; then
              echo "[clone] failed to create local branch '$REPO_REF'"
              CLONE_OK=0
            fi
          fi
        else
          echo "[clone] git clone failed for $REPO_URL"
          CLONE_OK=0
        fi
      fi
    fi
  else
    if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS '$AUTH_REPO_URL' '$TARGET_DIR'"; then
      echo "[clone] git clone failed for $REPO_URL"
      CLONE_OK=0
    fi
  fi`

const renderCloneCacheFinalize = (config: TemplateConfig): string =>
  `if [[ "$CLONE_OK" -eq 1 && -d "$TARGET_DIR/.git" && -n "$CACHE_REPO_DIR" && ! -d "$CACHE_REPO_DIR" ]]; then
  CACHE_TMP_DIR="$CACHE_REPO_DIR.tmp-$$"
  if su - ${config.sshUser} -c "rm -rf '$CACHE_TMP_DIR' && GIT_TERMINAL_PROMPT=0 git clone --mirror --progress '$TARGET_DIR/.git' '$CACHE_TMP_DIR'"; then
    if mv "$CACHE_TMP_DIR" "$CACHE_REPO_DIR" 2>/dev/null; then
      echo "[clone-cache] mirror created: $CACHE_REPO_DIR"
    else
      rm -rf "$CACHE_TMP_DIR"
    fi
  else
    echo "[clone-cache] mirror bootstrap failed for $REPO_URL"
    rm -rf "$CACHE_TMP_DIR"
  fi
fi`

const renderIssueWorkspaceAgentsResolve = (): string =>
  `ISSUE_ID="$(printf "%s" "$REPO_REF" | sed -E 's#^issue-##')"
ISSUE_URL=""
if [[ "$REPO_URL" == https://github.com/* ]]; then
  ISSUE_REPO="$(printf "%s" "$REPO_URL" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##')"
  if [[ -n "$ISSUE_REPO" ]]; then
    ISSUE_URL="https://github.com/$ISSUE_REPO/issues/$ISSUE_ID"
  fi
fi
if [[ -z "$ISSUE_URL" ]]; then
  ISSUE_URL="n/a"
fi`

const renderIssueWorkspaceAgentsManagedBlock = (): string =>
  `ISSUE_AGENTS_PATH="$TARGET_DIR/AGENTS.md"
ISSUE_MANAGED_START="<!-- docker-git:issue-managed:start -->"
ISSUE_MANAGED_END="<!-- docker-git:issue-managed:end -->"
ISSUE_MANAGED_BLOCK="$(cat <<EOF
$ISSUE_MANAGED_START
Issue workspace: #$ISSUE_ID
Issue URL: $ISSUE_URL
Workspace path: $TARGET_DIR

Работай только над этим issue, если пользователь не попросил другое.
Если нужен первоисточник требований, открой Issue URL.
$ISSUE_MANAGED_END
EOF
)"`

const renderIssueWorkspaceAgentsWrite = (): string =>
  `if [[ ! -e "$ISSUE_AGENTS_PATH" ]]; then
  printf "%s\n" "$ISSUE_MANAGED_BLOCK" > "$ISSUE_AGENTS_PATH"
else
  TMP_ISSUE_AGENTS_PATH="$(mktemp)"
  if grep -qF "$ISSUE_MANAGED_START" "$ISSUE_AGENTS_PATH" && grep -qF "$ISSUE_MANAGED_END" "$ISSUE_AGENTS_PATH"; then
    awk -v start="$ISSUE_MANAGED_START" -v end="$ISSUE_MANAGED_END" -v repl="$ISSUE_MANAGED_BLOCK" '
      BEGIN { in_block = 0 }
      $0 == start { print repl; in_block = 1; next }
      $0 == end { in_block = 0; next }
      in_block == 0 { print }
    ' "$ISSUE_AGENTS_PATH" > "$TMP_ISSUE_AGENTS_PATH"
  else
    sed \
      -e '/^# docker-git issue workspace$/d' \
      -e '/^Issue workspace: #/d' \
      -e '/^Issue URL: /d' \
      -e '/^Workspace path: /d' \
      -e '/^Работай только над этим issue, если пользователь не попросил другое[.]$/d' \
      -e '/^Если нужен первоисточник требований, открой Issue URL[.]$/d' \
      "$ISSUE_AGENTS_PATH" > "$TMP_ISSUE_AGENTS_PATH"
    if [[ -s "$TMP_ISSUE_AGENTS_PATH" ]]; then
      printf "\n" >> "$TMP_ISSUE_AGENTS_PATH"
    fi
    printf "%s\n" "$ISSUE_MANAGED_BLOCK" >> "$TMP_ISSUE_AGENTS_PATH"
  fi
  mv "$TMP_ISSUE_AGENTS_PATH" "$ISSUE_AGENTS_PATH"
fi
if [[ -e "$ISSUE_AGENTS_PATH" ]]; then
  chown 1000:1000 "$ISSUE_AGENTS_PATH" || true
fi`

const renderIssueWorkspaceAgentsExclude = (): string =>
  `EXCLUDE_PATH="$TARGET_DIR/.git/info/exclude"
if [[ -f "$ISSUE_AGENTS_PATH" ]]; then
  touch "$EXCLUDE_PATH"
  if ! grep -qx "AGENTS.md" "$EXCLUDE_PATH"; then
    printf "%s\n" "AGENTS.md" >> "$EXCLUDE_PATH"
  fi
fi`

const renderIssueWorkspaceAgents = (): string =>
  [
    `if [[ "$CLONE_OK" -eq 1 && "$REPO_REF" == issue-* && -d "$TARGET_DIR/.git" ]]; then`,
    renderIssueWorkspaceAgentsResolve(),
    "",
    renderIssueWorkspaceAgentsManagedBlock(),
    "",
    renderIssueWorkspaceAgentsWrite(),
    "",
    renderIssueWorkspaceAgentsExclude(),
    "fi"
  ].join("\n")

const renderCloneBody = (config: TemplateConfig): string =>
  [
    renderCloneBodyStart(config),
    renderCloneBodyRef(config),
    "fi",
    "",
    renderCloneRemotes(config),
    "",
    renderCloneCacheFinalize(config),
    "",
    renderIssueWorkspaceAgents()
  ].join("\n")

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

export const renderEntrypointBackgroundTasks = (config: TemplateConfig): string =>
  `# 4) Start background tasks so SSH can come up immediately
(
${renderEntrypointAutoUpdate()}

${renderEntrypointClone(config)}
) &`
