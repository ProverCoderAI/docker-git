import type { TemplateConfig } from "./domain.js"
import { renderEntrypoint } from "./templates-entrypoint.js"
import { renderDockerfilePrompt } from "./templates-prompt.js"

export type FileSpec =
  | { readonly _tag: "File"; readonly relativePath: string; readonly contents: string; readonly mode?: number }
  | { readonly _tag: "Dir"; readonly relativePath: string }

const renderDockerfilePrelude = (): string =>
  `FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NVM_DIR=/usr/local/nvm

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git gh ca-certificates curl unzip bsdutils sudo \
    make docker.io docker-compose bash-completion zsh zsh-autosuggestions \
 && rm -rf /var/lib/apt/lists/*

# Passwordless sudo for all users (container is disposable)
RUN printf "%s\\n" "ALL ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zz-all \
  && chmod 0440 /etc/sudoers.d/zz-all`

const renderDockerfileNode = (): string =>
  `# Tooling: Node 24 (NodeSource) + nvm
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
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

// CHANGE: normalize default ubuntu user to configured ssh user
// WHY: ensure ssh sessions show the configured username and prompt
// QUOTE(ТЗ): "Промт должен создаваться нашим docker-git тулой"
// REF: user-request-2026-02-05-restore-prompt
// SOURCE: n/a
// FORMAT THEOREM: forall u in Users: uid(u)=1000 -> username(u)=sshUser
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: ssh user exists with uid/gid 1000
// COMPLEXITY: O(1)
const renderDockerfileUsers = (config: TemplateConfig): string =>
  `# Create non-root user for SSH (align UID/GID with host user 1000)
RUN if id -u ubuntu >/dev/null 2>&1; then \
      if getent group 1000 >/dev/null 2>&1; then \
        EXISTING_GROUP="$(getent group 1000 | cut -d: -f1)"; \
        if [ "$EXISTING_GROUP" != "${config.sshUser}" ]; then groupmod -n ${config.sshUser} "$EXISTING_GROUP" || true; fi; \
      fi; \
      usermod -l ${config.sshUser} -d /home/${config.sshUser} -m -s /usr/bin/zsh ubuntu || true; \
    fi
RUN if id -u ${config.sshUser} >/dev/null 2>&1; then \
      usermod -u 1000 -g 1000 -o ${config.sshUser}; \
    else \
      groupadd -g 1000 ${config.sshUser} || true; \
      useradd -m -s /usr/bin/zsh -u 1000 -g 1000 -o ${config.sshUser}; \
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
    renderDockerfilePrompt(),
    renderDockerfileNode(),
    renderDockerfileBun(config),
    renderDockerfileUsers(config),
    renderDockerfileWorkspace(config)
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
