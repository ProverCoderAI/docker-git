import type { TemplateConfig } from "../domain.js"
import { renderAgentLaunch } from "./agent.js"

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

const renderCloneGuard = (config: TemplateConfig): string =>
  `if [[ -z "$REPO_URL" ]]; then
  echo "[clone] skip (no repo url)"
elif [[ -d "$TARGET_DIR/.git" ]]; then
  echo "[clone] skip (already cloned)"
else
  mkdir -p "$TARGET_DIR"
  if [[ "$TARGET_DIR" != "/" ]]; then
    chown -R 1000:1000 "$TARGET_DIR"
  fi
  chown -R 1000:1000 /home/${config.sshUser}`

const cloneAuthLabelResolutionTemplate = `    RESOLVED_GIT_AUTH_LABEL=""
    GIT_TOKEN_LABEL_RAW="\${GIT_AUTH_LABEL:-\${GITHUB_AUTH_LABEL:-\${GITLAB_AUTH_LABEL:-}}}"

    if [[ -z "$GIT_TOKEN_LABEL_RAW" && "$REPO_URL" == https://github.com/* ]]; then
      GIT_TOKEN_LABEL_RAW="$(printf "%s" "$REPO_URL" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##' | cut -d/ -f1)"
    fi
    if [[ -z "$GIT_TOKEN_LABEL_RAW" && "$REPO_URL" == https://gitlab.com/* ]]; then
      GIT_TOKEN_LABEL_RAW="$(printf "%s" "$REPO_URL" | sed -E 's#^https://gitlab.com/##; s#[.]git$##; s#/*$##' | cut -d/ -f1)"
    fi

    if [[ -n "$GIT_TOKEN_LABEL_RAW" ]]; then
      RESOLVED_GIT_AUTH_LABEL="$(printf "%s" "$GIT_TOKEN_LABEL_RAW" | tr '[:lower:]' '[:upper:]' | sed -E 's/[^A-Z0-9]+/_/g; s/^_+//; s/_+$//')"
      if [[ "$RESOLVED_GIT_AUTH_LABEL" == "DEFAULT" ]]; then
        RESOLVED_GIT_AUTH_LABEL=""
      fi
    fi`

const cloneAuthLabeledTokenTemplate = `    if [[ -n "$RESOLVED_GIT_AUTH_LABEL" ]]; then
      LABELED_GIT_TOKEN_KEY="GIT_AUTH_TOKEN__$RESOLVED_GIT_AUTH_LABEL"
      LABELED_GITHUB_TOKEN_KEY="GITHUB_TOKEN__$RESOLVED_GIT_AUTH_LABEL"
      LABELED_GITLAB_TOKEN_KEY="GITLAB_TOKEN__$RESOLVED_GIT_AUTH_LABEL"
      LABELED_GIT_USER_KEY="GIT_AUTH_USER__$RESOLVED_GIT_AUTH_LABEL"

      LABELED_GIT_TOKEN="\${!LABELED_GIT_TOKEN_KEY-}"
      LABELED_GITHUB_TOKEN="\${!LABELED_GITHUB_TOKEN_KEY-}"
      LABELED_GITLAB_TOKEN="\${!LABELED_GITLAB_TOKEN_KEY-}"
      LABELED_GIT_USER="\${!LABELED_GIT_USER_KEY-}"

      if [[ -n "$LABELED_GIT_TOKEN" ]]; then
        RESOLVED_GIT_AUTH_TOKEN="$LABELED_GIT_TOKEN"
      elif [[ "$REPO_URL" == https://gitlab.com/* && -n "$LABELED_GITLAB_TOKEN" ]]; then
        RESOLVED_GIT_AUTH_TOKEN="$LABELED_GITLAB_TOKEN"
      elif [[ -n "$LABELED_GITHUB_TOKEN" ]]; then
        RESOLVED_GIT_AUTH_TOKEN="$LABELED_GITHUB_TOKEN"
      fi

      if [[ -n "$LABELED_GIT_USER" ]]; then
        RESOLVED_GIT_AUTH_USER="$LABELED_GIT_USER"
      fi
    fi

    if [[ -z "$RESOLVED_GIT_AUTH_USER" ]]; then
      if [[ "$REPO_URL" == https://gitlab.com/* ]]; then
        RESOLVED_GIT_AUTH_USER="oauth2"
      else
        RESOLVED_GIT_AUTH_USER="x-access-token"
      fi
    fi
`

const renderCloneAuthSelection = (): string =>
  `  if [[ "\${GITHUB_AUTH_SKIP:-0}" == "1" && "$REPO_URL" == https://github.com/* ]]; then
    RESOLVED_GIT_AUTH_USER=""
    RESOLVED_GIT_AUTH_TOKEN=""
    RESOLVED_GIT_AUTH_LABEL=""
  else
    RESOLVED_GIT_AUTH_USER="$GIT_AUTH_USER"
    RESOLVED_GIT_AUTH_TOKEN="$GIT_AUTH_TOKEN"
    if [[ "$REPO_URL" == https://gitlab.com/* && -n "\${GITLAB_TOKEN:-}" ]]; then
      RESOLVED_GIT_AUTH_TOKEN="$GITLAB_TOKEN"
    fi
${cloneAuthLabelResolutionTemplate}

${cloneAuthLabeledTokenTemplate}
  fi
`

const renderCloneAuthRepoUrl = (): string =>
  `  AUTH_REPO_URL="$REPO_URL"
  if [[ -n "$RESOLVED_GIT_AUTH_TOKEN" && "$REPO_URL" == https://* ]]; then
    AUTH_REPO_URL="$(printf "%s" "$REPO_URL" | sed "s#^https://#https://\${RESOLVED_GIT_AUTH_USER}:\${RESOLVED_GIT_AUTH_TOKEN}@#")"
  fi`

// CHANGE: refresh shared git mirrors with branch/tag refs only.
// WHY: GitHub exposes refs/pull/* under refs/*; fetching all refs is unbounded for public repos.
// QUOTE(TZ): n/a
// REF: issue-267
// SOURCE: n/a
// FORMAT THEOREM: forall r in fetchedRefs: r in refs/heads/* union refs/tags/*
// PURITY: SHELL
// EFFECT: generated shell performs git fetch through the configured container user
// INVARIANT: mirror refresh excludes refs/pull/* while preserving branch/tag object reuse.
// COMPLEXITY: O(|heads| + |tags|) remote refs
const renderCloneCacheInit = (config: TemplateConfig): string =>
  `  CLONE_CACHE_ARGS=""
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
        if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git --git-dir '$CACHE_REPO_DIR' fetch --progress --prune '$AUTH_REPO_URL' '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'"; then
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

const renderCloneBodyStart = (config: TemplateConfig): string =>
  [
    renderCloneGuard(config),
    renderCloneAuthSelection(),
    renderCloneAuthRepoUrl(),
    renderCloneCacheInit(config)
  ].join("\n\n")

const renderCloneBodyRef = (config: TemplateConfig): string =>
  String.raw`  if [[ -n "$REPO_REF" ]]; then
    if [[ "$REPO_REF" == refs/pull/* || "$REPO_REF" == refs/merge-requests/* ]]; then
      REF_BRANCH="$(printf "%s" "$REPO_REF" | sed -E 's#^refs/pull/([^/]+)/head$#pr-\1#; s#^refs/merge-requests/([^/]+)/head$#mr-\1#')"
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
        echo "[clone] branch '$REPO_REF' missing; retrying without --branch"
        if ! su - ${config.sshUser} -c "GIT_TERMINAL_PROMPT=0 git clone --progress $CLONE_CACHE_ARGS '$AUTH_REPO_URL' '$TARGET_DIR'"; then
          echo "[clone] git clone failed for $REPO_URL"
          CLONE_OK=0
        elif [[ "$REPO_REF" == issue-* ]]; then
          if ! su - ${config.sshUser} -c "cd '$TARGET_DIR' && git checkout -B '$REPO_REF'"; then
            echo "[clone] failed to create local branch '$REPO_REF'"
            CLONE_OK=0
          fi
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
  `CACHE_REPO_DIR="\${CACHE_REPO_DIR:-}"
if [[ "$CLONE_OK" -eq 1 && -d "$TARGET_DIR/.git" && -n "$CACHE_REPO_DIR" && ! -d "$CACHE_REPO_DIR" ]]; then
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

const renderCloneBody = (config: TemplateConfig): string =>
  [
    renderCloneBodyStart(config),
    renderCloneBodyRef(config),
    "fi",
    "",
    renderCloneRemotes(config),
    "",
    renderCloneCacheFinalize(config)
  ].join("\n")

// CHANGE: provision docker-git scripts into workspace after successful clone
// WHY: git hooks reference scripts/ relative to repo root;
//      symlinking embedded /opt/docker-git/scripts makes them available in any cloned repo
// REF: issue-176
// PURITY: SHELL
// INVARIANT: symlink created only when /opt/docker-git/scripts exists ∧ TARGET_DIR/scripts absent
// COMPLEXITY: O(1)
const renderCloneFinalize = (): string =>
  `if [[ "$CLONE_OK" -eq 1 ]]; then
  echo "[clone] done"
  touch "$CLONE_DONE_PATH"

  # Provision docker-git scripts into workspace (symlink if not already present)
  if [[ -d /opt/docker-git/scripts && -n "$TARGET_DIR" && "$TARGET_DIR" != "/" ]]; then
    if [[ ! -e "$TARGET_DIR/scripts" ]]; then
      ln -s /opt/docker-git/scripts "$TARGET_DIR/scripts" || true
      chown -h 1000:1000 "$TARGET_DIR/scripts" 2>/dev/null || true
      echo "[scripts] provisioned docker-git scripts into workspace"
    fi
  fi
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

if [[ "$CLONE_OK" -eq 1 ]]; then
  docker_git_prepare_active_agent_project_rules
fi

${renderAgentLaunch(config)}
) &`
