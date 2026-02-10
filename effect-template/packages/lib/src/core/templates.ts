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
    make docker.io docker-compose bash-completion zsh zsh-autosuggestions xauth \
    ncurses-term \
 && rm -rf /var/lib/apt/lists/*

# Passwordless sudo for all users (container is disposable)
RUN printf "%s\\n" "ALL ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zz-all \
  && chmod 0440 /etc/sudoers.d/zz-all`

const renderDockerfileNode = (): string =>
  `# Tooling: Node 24 (NodeSource) + nvm
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && node -v \
  && npm -v \
  && corepack --version \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /usr/local/nvm \
  && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
RUN printf "export NVM_DIR=/usr/local/nvm\\n[ -s /usr/local/nvm/nvm.sh ] && . /usr/local/nvm/nvm.sh\\n" \
  > /etc/profile.d/nvm.sh && chmod 0644 /etc/profile.d/nvm.sh`

const renderDockerfileBun = (config: TemplateConfig): string =>
  `# Tooling: pnpm + Codex CLI (bun)
RUN corepack enable && corepack prepare pnpm@${config.pnpmVersion} --activate
ENV BUN_INSTALL=/usr/local/bun
ENV TERM=xterm-256color
ENV PATH="/usr/local/bun/bin:$PATH"
RUN curl -fsSL https://bun.sh/install | bash
RUN ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
RUN script -q -e -c "bun add -g @openai/codex@latest" /dev/null
RUN ln -sf /usr/local/bun/bin/codex /usr/local/bin/codex
${config.enableMcpPlaywright
    ? `RUN npm install -g @playwright/mcp@latest

# docker-git: wrapper that converts a CDP HTTP endpoint into a usable WS endpoint
# Some Chromium images return webSocketDebuggerUrl pointing at 127.0.0.1 (container-local).
RUN cat <<'EOF' > /usr/local/bin/docker-git-playwright-mcp
#!/usr/bin/env bash
set -euo pipefail

# Fast-path for help/version (avoid waiting for the browser sidecar).
for arg in "$@"; do
  case "$arg" in
    -h|--help|-V|--version)
      exec playwright-mcp "$@"
      ;;
  esac
done

CDP_ENDPOINT="\${MCP_PLAYWRIGHT_CDP_ENDPOINT:-}"
if [[ -z "$CDP_ENDPOINT" ]]; then
  CDP_ENDPOINT="http://${config.serviceName}-browser:9223"
fi

# kechangdev/browser-vnc binds Chromium CDP on 127.0.0.1:9222; it also host-checks HTTP requests.
JSON="$(curl -sSf --connect-timeout 3 --max-time 10 -H 'Host: 127.0.0.1:9222' "\${CDP_ENDPOINT%/}/json/version")"
WS_URL="$(printf "%s" "$JSON" | node -e 'const fs=require(\"fs\"); const j=JSON.parse(fs.readFileSync(0,\"utf8\")); process.stdout.write(j.webSocketDebuggerUrl || \"\")')"
if [[ -z "$WS_URL" ]]; then
  echo "docker-git-playwright-mcp: webSocketDebuggerUrl missing" >&2
  exit 1
fi

# Rewrite ws origin to match the CDP endpoint origin (docker DNS).
BASE_WS="$(CDP_ENDPOINT="$CDP_ENDPOINT" node -e 'const { URL } = require(\"url\"); const u=new URL(process.env.CDP_ENDPOINT); const proto=u.protocol===\"https:\"?\"wss:\":\"ws:\"; process.stdout.write(proto + \"//\" + u.host)')"
WS_REWRITTEN="$(BASE_WS="$BASE_WS" WS_URL="$WS_URL" node -e 'const { URL } = require(\"url\"); const base=new URL(process.env.BASE_WS); const ws=new URL(process.env.WS_URL); ws.protocol=base.protocol; ws.host=base.host; process.stdout.write(ws.toString())')"

exec playwright-mcp --cdp-endpoint "$WS_REWRITTEN" "$@"
EOF
RUN chmod +x /usr/local/bin/docker-git-playwright-mcp`
    : ""}
RUN printf "export BUN_INSTALL=/usr/local/bun\\nexport PATH=/usr/local/bun/bin:$PATH\\n" \
  > /etc/profile.d/bun.sh && chmod 0644 /etc/profile.d/bun.sh`

const renderPlaywrightBrowserDockerfile = (): string =>
  `FROM kechangdev/browser-vnc:latest

# bash for noVNC startup, procps for ps -p used by novnc_proxy, socat for CDP proxy
# python3/net-tools for diagnostics
RUN apk add --no-cache bash procps socat python3 net-tools

COPY mcp-playwright-start-extra.sh /usr/local/bin/mcp-playwright-start-extra.sh
RUN chmod +x /usr/local/bin/mcp-playwright-start-extra.sh

# Start extra services in background, keep base stack in foreground
# Clear stale Chromium profile locks before boot
ENTRYPOINT ["/bin/sh", "-lc", "rm -f /data/SingletonLock /data/SingletonCookie /data/SingletonSocket || true; /usr/local/bin/mcp-playwright-start-extra.sh & exec /start.sh"]`

const renderPlaywrightStartExtra = (): string =>
  `#!/bin/sh
set -eu

# Clear stale Chromium locks from previous container runs
rm -f /data/SingletonLock /data/SingletonCookie /data/SingletonSocket || true

# Wait for chromium/x11vnc/noVNC to come up
sleep 2

# CDP proxy: expose 9223 on the docker network, forward to 127.0.0.1:9222 inside the browser container
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/var/log/socat-9223.log 2>&1 &

# Optional VNC password disabling (useful if you publish VNC/noVNC ports)
if [ "\${VNC_NOPW:-1}" = "1" ]; then
  pkill x11vnc || true
  x11vnc -display :99 -rfbport 5900 -nopw -forever -shared -bg -o /var/log/x11vnc-nopw.log
fi

echo "extra services started"
exit 0
`

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
  "X11Forwarding yes" \
  "X11UseLocalhost yes" \
  "PermitUserEnvironment yes" \
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
  const forkRepoUrl = config.forkRepoUrl ?? ""

  const browserServiceName = `${config.serviceName}-browser`
  const browserContainerName = `${config.containerName}-browser`
  const browserVolumeName = `${config.volumeName}-browser`
  const browserDockerfile = "Dockerfile.browser"
  const browserCdpEndpoint = `http://${browserServiceName}:9223`

  const maybeDependsOn = config.enableMcpPlaywright
    ? `    depends_on:\n      - ${browserServiceName}\n`
    : ""
  const maybePlaywrightEnv = config.enableMcpPlaywright
    ? `      MCP_PLAYWRIGHT_ENABLE: "1"\n      MCP_PLAYWRIGHT_CDP_ENDPOINT: "${browserCdpEndpoint}"\n`
    : ""
  const maybeBrowserService = config.enableMcpPlaywright
    ? `\n  ${browserServiceName}:\n    build:\n      context: .\n      dockerfile: ${browserDockerfile}\n    container_name: ${browserContainerName}\n    environment:\n      VNC_NOPW: "1"\n    shm_size: "2gb"\n    expose:\n      - "9223"\n    volumes:\n      - ${browserVolumeName}:/data\n    networks:\n      - ${networkName}\n`
    : ""
  const maybeBrowserVolume = config.enableMcpPlaywright ? `  ${browserVolumeName}:\n` : ""

  return `services:
  ${config.serviceName}:
    build: .
    container_name: ${config.containerName}
    environment:
      REPO_URL: "${config.repoUrl}"
      REPO_REF: "${config.repoRef}"
      FORK_REPO_URL: "${forkRepoUrl}"
      TARGET_DIR: "${config.targetDir}"
      CODEX_HOME: "${config.codexHome}"
${maybePlaywrightEnv}${maybeDependsOn}    env_file:
      - ${config.envGlobalPath}
      - ${config.envProjectPath}
    ports:
      - "127.0.0.1:${config.sshPort}:22"
    volumes:
      - ${config.volumeName}:/home/${config.sshUser}
      - ${config.authorizedKeysPath}:/authorized_keys:ro
      - ${config.codexAuthPath}:${config.codexHome}
      - ${config.codexSharedAuthPath}:${config.codexHome}-shared
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ${networkName}
${maybeBrowserService}

networks:
  ${networkName}:
    driver: bridge

volumes:
  ${config.volumeName}:
${maybeBrowserVolume}`
}

const renderGitignore = (): string =>
  `# Local secrets and keys
authorized_keys
dev_ssh_key
dev_ssh_key.pub

# Local auth cache
.orch/
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
export const planFiles = (config: TemplateConfig): ReadonlyArray<FileSpec> => {
  const maybePlaywrightFiles = config.enableMcpPlaywright
    ? ([
        { _tag: "File", relativePath: "Dockerfile.browser", contents: renderPlaywrightBrowserDockerfile() },
        {
          _tag: "File",
          relativePath: "mcp-playwright-start-extra.sh",
          contents: renderPlaywrightStartExtra(),
          mode: 0o755
        }
      ] satisfies ReadonlyArray<FileSpec>)
    : ([] satisfies ReadonlyArray<FileSpec>)

  return [
    { _tag: "File", relativePath: "Dockerfile", contents: renderDockerfile(config) },
    { _tag: "File", relativePath: "entrypoint.sh", contents: renderEntrypoint(config), mode: 0o755 },
    { _tag: "File", relativePath: "docker-compose.yml", contents: renderDockerCompose(config) },
    { _tag: "File", relativePath: ".dockerignore", contents: renderDockerignore() },
    { _tag: "File", relativePath: "docker-git.json", contents: renderConfigJson(config) },
    { _tag: "File", relativePath: ".gitignore", contents: renderGitignore() },
    ...maybePlaywrightFiles,
    { _tag: "Dir", relativePath: ".orch/auth/codex" },
    { _tag: "Dir", relativePath: ".orch/env" }
  ]
}
