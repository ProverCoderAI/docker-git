import type { TemplateConfig } from "../domain.js"
import { renderDockerfilePrompt } from "../templates-prompt.js"

const renderDockerfilePrelude = (): string =>
  `FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NVM_DIR=/usr/local/nvm

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git gh ca-certificates curl unzip bsdutils sudo \
    make docker.io docker-compose-v2 bash-completion zsh zsh-autosuggestions xauth \
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

const renderDockerfileBunPrelude = (config: TemplateConfig): string =>
  `# Tooling: pnpm + Codex CLI (bun) + oh-my-opencode (npm + platform binary) + Claude Code CLI (npm)
RUN corepack enable && corepack prepare pnpm@${config.pnpmVersion} --activate
ENV TERM=xterm-256color
RUN set -eu; \
  for attempt in 1 2 3 4 5; do \
    if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 https://bun.sh/install -o /tmp/bun-install.sh \
      && BUN_INSTALL=/usr/local/bun bash /tmp/bun-install.sh; then \
      rm -f /tmp/bun-install.sh; \
      exit 0; \
    fi; \
    echo "bun install attempt \${attempt} failed; retrying..." >&2; \
      rm -f /tmp/bun-install.sh; \
    sleep $((attempt * 2)); \
  done; \
  echo "bun install failed after retries" >&2; \
  exit 1
RUN ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
RUN BUN_INSTALL=/usr/local/bun script -q -e -c "bun add -g @openai/codex@latest" /dev/null
RUN ln -sf /usr/local/bun/bin/codex /usr/local/bin/codex
RUN set -eu; \
  ARCH="$(uname -m)"; \
  case "$ARCH" in \
    x86_64|amd64) OH_MY_OPENCODE_ARCH="x64" ;; \
    aarch64|arm64) OH_MY_OPENCODE_ARCH="arm64" ;; \
    *) echo "Unsupported arch for oh-my-opencode: $ARCH" >&2; exit 1 ;; \
  esac; \
  npm install -g oh-my-opencode@latest "oh-my-opencode-linux-\${OH_MY_OPENCODE_ARCH}@latest"
RUN oh-my-opencode --version
RUN npm install -g @anthropic-ai/claude-code@latest
RUN claude --version
RUN npm install -g @google/gemini-cli@latest --force
RUN gemini --version`

const openCodeVersion = "1.2.27"

const renderDockerfileOpenCode = (): string =>
  `# Tooling: OpenCode (binary)
RUN set -eu; \
  for attempt in 1 2 3 4 5; do \
    if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 https://opencode.ai/install \
      | HOME=/usr/local bash -s -- --version ${openCodeVersion} --no-modify-path; then \
      exit 0; \
    fi; \
    echo "opencode install attempt \${attempt} failed; retrying..." >&2; \
    sleep $((attempt * 2)); \
  done; \
  echo "opencode install failed after retries" >&2; \
  exit 1
RUN ln -sf /usr/local/.opencode/bin/opencode /usr/local/bin/opencode
RUN opencode --version`

const gitleaksVersion = "8.28.0"

const renderDockerfileGitleaks = (): string =>
  `# Tooling: gitleaks (secret scanner for .knowledge/.knowlenge hooks)
RUN ARCH="$(uname -m)" \
  && case "$ARCH" in \
      x86_64|amd64) GITLEAKS_ARCH="x64" ;; \
      aarch64|arm64) GITLEAKS_ARCH="arm64" ;; \
      *) echo "Unsupported arch for gitleaks: $ARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaksVersion}/gitleaks_${gitleaksVersion}_linux_$GITLEAKS_ARCH.tar.gz" \
    | tar -xz -C /usr/local/bin gitleaks \
  && chmod +x /usr/local/bin/gitleaks \
  && gitleaks version`

const dockerfilePlaywrightMcpBlock = String.raw`RUN npm install -g @playwright/mcp@latest

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
  CDP_ENDPOINT="http://__SERVICE_NAME__-browser:9223"
fi

# CHANGE: add retry logic for browser sidecar startup wait
# WHY: the browser container may take time to initialize, causing MCP server to fail on first attempt
# QUOTE(issue-123): "Почему MCP сервер лежит с ошибкой?"
# REF: issue-123
# SOURCE: n/a
# FORMAT THEOREM: forall t in [1..max_attempts]: retry(t) -> eventually(cdp_ready) OR timeout_error
# PURITY: SHELL
# INVARIANT: script exits only after cdp_ready OR all retries exhausted
# COMPLEXITY: O(max_attempts * timeout_per_attempt)
MCP_PLAYWRIGHT_RETRY_ATTEMPTS="\${MCP_PLAYWRIGHT_RETRY_ATTEMPTS:-10}"
MCP_PLAYWRIGHT_RETRY_DELAY="\${MCP_PLAYWRIGHT_RETRY_DELAY:-2}"

fetch_cdp_version() {
  curl -sSf --connect-timeout 3 --max-time 10 -H 'Host: 127.0.0.1:9222' "\${CDP_ENDPOINT%/}/json/version" 2>/dev/null
}

JSON=""
for attempt in $(seq 1 "$MCP_PLAYWRIGHT_RETRY_ATTEMPTS"); do
  if JSON="$(fetch_cdp_version)"; then
    break
  fi
  if [[ "$attempt" -lt "$MCP_PLAYWRIGHT_RETRY_ATTEMPTS" ]]; then
    echo "docker-git-playwright-mcp: waiting for browser sidecar (attempt $attempt/$MCP_PLAYWRIGHT_RETRY_ATTEMPTS)..." >&2
    sleep "$MCP_PLAYWRIGHT_RETRY_DELAY"
  fi
done

if [[ -z "$JSON" ]]; then
  echo "docker-git-playwright-mcp: failed to connect to CDP endpoint $CDP_ENDPOINT after $MCP_PLAYWRIGHT_RETRY_ATTEMPTS attempts" >&2
  exit 1
fi

# kechangdev/browser-vnc binds Chromium CDP on 127.0.0.1:9222; it also host-checks HTTP requests.
WS_URL="$(printf "%s" "$JSON" | node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.webSocketDebuggerUrl || "")')"
if [[ -z "$WS_URL" ]]; then
  echo "docker-git-playwright-mcp: webSocketDebuggerUrl missing" >&2
  exit 1
fi

# Rewrite ws origin to match the CDP endpoint origin (docker DNS).
BASE_WS="$(CDP_ENDPOINT="$CDP_ENDPOINT" node -e 'const { URL } = require("url"); const u=new URL(process.env.CDP_ENDPOINT); const proto=u.protocol==="https:"?"wss:":"ws:"; process.stdout.write(proto + "//" + u.host)')"
WS_REWRITTEN="$(BASE_WS="$BASE_WS" WS_URL="$WS_URL" node -e 'const { URL } = require("url"); const base=new URL(process.env.BASE_WS); const ws=new URL(process.env.WS_URL); ws.protocol=base.protocol; ws.host=base.host; process.stdout.write(ws.toString())')"

EXTRA_ARGS=()
if [[ "\${MCP_PLAYWRIGHT_ISOLATED:-1}" == "1" ]]; then
  EXTRA_ARGS+=(--isolated)
fi

exec playwright-mcp --cdp-endpoint "$WS_REWRITTEN" "\${EXTRA_ARGS[@]}" "$@"
EOF
RUN chmod +x /usr/local/bin/docker-git-playwright-mcp`

const renderDockerfileBunProfile = (): string =>
  `RUN printf "export PATH=/usr/local/bun/bin:$PATH\\n" \
  > /etc/profile.d/bun.sh && chmod 0644 /etc/profile.d/bun.sh`

const renderDockerfileBun = (config: TemplateConfig): string =>
  [
    renderDockerfileBunPrelude(config),
    config.enableMcpPlaywright
      ? dockerfilePlaywrightMcpBlock
        .replaceAll("\\${", "${")
        .replaceAll("__SERVICE_NAME__", config.serviceName)
      : "",
    renderDockerfileBunProfile()
  ]
    .filter((chunk) => chunk.trim().length > 0)
    .join("\n")

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

# sshd: password auth enabled so users can connect without key setup
RUN printf "%s\\n" \
  "PasswordAuthentication yes" \
  "PermitRootLogin no" \
  "PubkeyAuthentication yes" \
  "X11Forwarding yes" \
  "X11UseLocalhost yes" \
  "PermitUserEnvironment yes" \
  "AllowUsers ${config.sshUser}" \
  > /etc/ssh/sshd_config.d/${config.sshUser}.conf

# Default password = username (works out of the box; key auth still accepted if authorized_keys provided)
RUN echo "${config.sshUser}:${config.sshUser}" | chpasswd`

// CHANGE: add docker-git scripts to Docker image at /opt/docker-git/scripts
// WHY: scripts (session-backup, pre-commit guards, knowledge splitter) must be available
//      inside the container for git hooks and docker-git module usage
// REF: issue-176
// PURITY: CORE (pure template renderer)
// INVARIANT: ∀ script ∈ scripts/: accessible(/opt/docker-git/scripts/{script})
const renderDockerfileScripts = (): string =>
  `# docker-git scripts (hooks, session backup, knowledge guards)
COPY scripts/ /opt/docker-git/scripts/
RUN find /opt/docker-git/scripts -type f -name '*.sh' -exec chmod +x {} + \
  && find /opt/docker-git/scripts -type f -name '*.js' -exec chmod +x {} +`

const renderDockerfileWorkspace = (config: TemplateConfig): string =>
  `# Workspace path (supports root-level dirs like /repo)
RUN mkdir -p ${config.targetDir} \
  && chown -R 1000:1000 /home/${config.sshUser} \
  && if [ "${config.targetDir}" != "/" ]; then chown -R 1000:1000 "${config.targetDir}"; fi

COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]`

export const renderDockerfile = (config: TemplateConfig): string =>
  [
    renderDockerfilePrelude(),
    renderDockerfilePrompt(),
    renderDockerfileNode(),
    renderDockerfileBun(config),
    renderDockerfileOpenCode(),
    renderDockerfileGitleaks(),
    renderDockerfileUsers(config),
    renderDockerfileScripts(),
    renderDockerfileWorkspace(config)
  ].join("\n\n")
