import type { TemplateConfig } from "./domain.js"

export type FileSpec =
  | { readonly _tag: "File"; readonly relativePath: string; readonly contents: string; readonly mode?: number }
  | { readonly _tag: "Dir"; readonly relativePath: string }

const renderDockerfilePrelude = (): string =>
  `FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NVM_DIR=/usr/local/nvm

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git gh ca-certificates curl unzip bsdutils sudo \
    make docker.io docker-compose \
 && rm -rf /var/lib/apt/lists/*

# Passwordless sudo for all users (container is disposable)
RUN printf "%s\\n" "ALL ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zz-all \
  && chmod 0440 /etc/sudoers.d/zz-all`

const renderDockerfileNode = (config: TemplateConfig): string =>
  `# Tooling: Node 24 (NodeSource) + nvm
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p ${config.targetDir}
RUN mkdir -p /usr/local/nvm \
  && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
RUN printf "export NVM_DIR=/usr/local/nvm\\n[ -s /usr/local/nvm/nvm.sh ] && . /usr/local/nvm/nvm.sh\\n" \
  > /etc/profile.d/nvm.sh && chmod 0644 /etc/profile.d/nvm.sh`

const renderDockerfileBun = (config: TemplateConfig): string =>
  `# Tooling: pnpm + Codex CLI (bun)
RUN npm i -g pnpm@${config.pnpmVersion}
ENV BUN_INSTALL=/usr/local/bun
ENV TERM=xterm-256color
ENV PATH="/usr/local/bun/bin:$PATH"
RUN curl -fsSL https://bun.sh/install | bash
RUN ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
RUN script -q -e -c "bun add -g @openai/codex@latest" /dev/null
RUN ln -sf /usr/local/bun/bin/codex /usr/local/bin/codex
RUN printf "export BUN_INSTALL=/usr/local/bun\\nexport PATH=/usr/local/bun/bin:$PATH\\n" \
  > /etc/profile.d/bun.sh && chmod 0644 /etc/profile.d/bun.sh`

const renderDockerfileUsers = (config: TemplateConfig): string =>
  `# Create non-root user for SSH (align UID/GID with host user 1000)
RUN groupadd -g 1000 ${config.sshUser} || true
RUN if id -u ${config.sshUser} >/dev/null 2>&1; then \
      usermod -u 1000 -g 1000 -o ${config.sshUser}; \
    else \
      useradd -m -s /bin/bash -u 1000 -g 1000 -o ${config.sshUser}; \
    fi
RUN printf "%s\\n" "${config.sshUser} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${config.sshUser} \
  && chmod 0440 /etc/sudoers.d/${config.sshUser}

# sshd runtime dir
RUN mkdir -p /run/sshd

# Harden sshd: disable password auth and root login
RUN printf "%s\\n" \
  "PasswordAuthentication no" \
  "PermitRootLogin no" \
  "PubkeyAuthentication yes" \
  "AllowUsers ${config.sshUser}" \
  > /etc/ssh/sshd_config.d/${config.sshUser}.conf`

const renderDockerfileWorkspace = (config: TemplateConfig): string =>
  `# Workspace path (supports root-level dirs like /repo)
RUN mkdir -p ${config.targetDir} \
  && chown -R 1000:1000 /home/${config.sshUser} \
  && if [ "${config.targetDir}" != "/" ]; then chown -R 1000:1000 "${config.targetDir}"; fi

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]`

// CHANGE: install bun+codex and ensure workspace ownership inside the container
// WHY: allow tooling + cloning into root-level workspaces outside /home
// QUOTE(ТЗ): "Клонирует он в \"/\""
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall cfg: dockerfile(cfg) exposes bun+codex in PATH
// PURITY: CORE
// EFFECT: Effect<string, never, never>
// INVARIANT: base image and ssh setup preserved
// COMPLEXITY: O(1)
const renderDockerfile = (config: TemplateConfig): string =>
  [
    renderDockerfilePrelude(),
    renderDockerfileNode(config),
    renderDockerfileBun(config),
    renderDockerfileUsers(config),
    renderDockerfileWorkspace(config)
  ].join("\n\n")

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

const renderEntrypointSshd = (): string =>
  `# 5) Run sshd in foreground
exec /usr/sbin/sshd -D`

const renderEntrypoint = (config: TemplateConfig): string =>
  [
    renderEntrypointHeader(config),
    renderEntrypointAuthorizedKeys(config),
    renderEntrypointCodexHome(config),
    renderEntrypointDockerSocket(config),
    renderEntrypointGitConfig(config),
    renderEntrypointBackgroundTasks(config),
    renderEntrypointSshd()
  ].join("\n\n")

const renderDockerCompose = (config: TemplateConfig): string => {
  const networkName = `${config.serviceName}-net`

  return `services:
  ${config.serviceName}:
    build: .
    container_name: ${config.containerName}
    environment:
      REPO_URL: "${config.repoUrl}"
      REPO_REF: "${config.repoRef}"
      TARGET_DIR: "${config.targetDir}"
      CODEX_HOME: "${config.codexHome}"
    env_file:
      - ${config.envGlobalPath}
      - ${config.envProjectPath}
    ports:
      - "127.0.0.1:${config.sshPort}:22"
    volumes:
      - ${config.volumeName}:/home/${config.sshUser}
      - ${config.authorizedKeysPath}:/authorized_keys:ro
      - ${config.codexAuthPath}:${config.codexHome}
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ${networkName}

networks:
  ${networkName}:
    driver: bridge

volumes:
  ${config.volumeName}:
`
}

const renderGitignore = (): string =>
  `# Local secrets and keys
authorized_keys
dev_ssh_key
dev_ssh_key.pub

# Local auth cache
.orch/

# Local docker-git config
docker-git.json
`

// CHANGE: ignore local secrets in docker build context
// WHY: avoid build failures on unreadable auth files and keep secrets out of images
// QUOTE(ТЗ): "What is wrong?"
// REF: user-request-2026-01-14
// SOURCE: n/a
// FORMAT THEOREM: forall p in ignored: p not in build_context
// PURITY: CORE
// EFFECT:U: Effect<string, never, never>
// INVARIANT: excludes .orch and authorized_keys from build context
// COMPLEXITY: O(1)
const renderDockerignore = (): string =>
  `# docker-git build context
.orch/
authorized_keys
`

const renderConfigJson = (config: TemplateConfig): string =>
  `${JSON.stringify({ schemaVersion: 1, template: config }, null, 2)}
`

// CHANGE: generate the file plan for a docker-git project
// WHY: keep templates pure and deterministic for testability
// QUOTE(ТЗ): "Надо написать CLI команду с помощью которой мы будем создавать докер образы"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall cfg: plan(cfg) -> deterministic(files(cfg))
// PURITY: CORE
// EFFECT: Effect<ReadonlyArray<FileSpec>, never, never>
// INVARIANT: same cfg yields identical file specs
// COMPLEXITY: O(1)
export const planFiles = (config: TemplateConfig): ReadonlyArray<FileSpec> => [
  { _tag: "File", relativePath: "Dockerfile", contents: renderDockerfile(config) },
  { _tag: "File", relativePath: "entrypoint.sh", contents: renderEntrypoint(config), mode: 0o755 },
  { _tag: "File", relativePath: "docker-compose.yml", contents: renderDockerCompose(config) },
  { _tag: "File", relativePath: ".dockerignore", contents: renderDockerignore() },
  { _tag: "File", relativePath: "docker-git.json", contents: renderConfigJson(config) },
  { _tag: "File", relativePath: ".gitignore", contents: renderGitignore() },
  { _tag: "Dir", relativePath: ".orch/auth/codex" },
  { _tag: "Dir", relativePath: ".orch/env" }
]
