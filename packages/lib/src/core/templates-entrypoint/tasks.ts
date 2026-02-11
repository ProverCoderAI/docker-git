import type { TemplateConfig } from "../domain.js"

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
    if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress '$AUTH_REPO_URL' '$TARGET_DIR'"; then
      echo "[clone] git clone failed for $REPO_URL"
      CLONE_OK=0
    fi
  fi`

const renderIssueWorkspaceAgents = (): string =>
  `if [[ "$CLONE_OK" -eq 1 && "$REPO_REF" == issue-* && -d "$TARGET_DIR/.git" ]]; then
  ISSUE_ID="$(printf "%s" "$REPO_REF" | sed -E 's#^issue-##')"
  ISSUE_URL=""
  if [[ "$REPO_URL" == https://github.com/* ]]; then
    ISSUE_REPO="$(printf "%s" "$REPO_URL" | sed -E 's#^https://github.com/##; s#\.git$##; s#/*$##')"
    if [[ -n "$ISSUE_REPO" ]]; then
      ISSUE_URL="https://github.com/\${ISSUE_REPO}/issues/\${ISSUE_ID}"
    fi
  fi

  ISSUE_AGENTS_PATH="$TARGET_DIR/AGENTS.md"
  if [[ ! -e "$ISSUE_AGENTS_PATH" ]]; then
    cat <<EOF > "$ISSUE_AGENTS_PATH"
# docker-git issue workspace
Issue workspace: #\${ISSUE_ID}
Issue URL: \${ISSUE_URL:-n/a}
Workspace path: $TARGET_DIR

Работай только над этим issue, если пользователь не попросил другое.
Если нужен первоисточник требований, открой Issue URL.
EOF
    chown 1000:1000 "$ISSUE_AGENTS_PATH" || true
  fi

  EXCLUDE_PATH="$TARGET_DIR/.git/info/exclude"
  if [[ -f "$ISSUE_AGENTS_PATH" ]]; then
    touch "$EXCLUDE_PATH"
    if ! grep -qx "AGENTS.md" "$EXCLUDE_PATH"; then
      printf "%s\n" "AGENTS.md" >> "$EXCLUDE_PATH"
    fi
  fi
fi`

const renderCloneBody = (config: TemplateConfig): string =>
  [
    renderCloneBodyStart(config),
    renderCloneBodyRef(config),
    "",
    renderCloneRemotes(config),
    "",
    renderIssueWorkspaceAgents(),
    "fi"
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
