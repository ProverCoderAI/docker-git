import type { TemplateConfig } from "../domain.js"
import { shellSingleQuote } from "../shell-literals.js"
import { renderDockerfilePrompt } from "../templates-prompt.js"
import { renderDockerfilePrelude } from "./dockerfile-prelude.js"
import { renderDockerfileGlab } from "./glab.js"
import { renderDockerfileGitleaks, renderDockerfileOpenCode } from "./tools.js"

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

const grokCliInstallScriptUrl = "https://x.ai/cli/install.sh"
const grokCliVersion = "0.1.211"

const renderDockerfileBunPrelude = (config: TemplateConfig): string =>
  `# Tooling: Bun + Codex CLI (bun) + oh-my-opencode (npm + platform binary) + Claude Code CLI (npm) + Grok CLI (xAI installer)
ENV TERM=xterm-256color
RUN set -eu; \
  for attempt in 1 2 3 4 5; do \
    if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 https://bun.sh/install -o /tmp/bun-install.sh \
      && BUN_INSTALL=/usr/local/bun BUN_VERSION=${config.bunVersion} bash /tmp/bun-install.sh; then \
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
RUN gemini --version
RUN set -eu; \
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 ${grokCliInstallScriptUrl} -o /tmp/grok-install.sh; \
  HOME=/tmp/grok-install-home GROK_BIN_DIR=/usr/local/bin bash /tmp/grok-install.sh ${grokCliVersion}; \
  install -m 0755 "$(readlink -f /usr/local/bin/grok)" /usr/local/bin/grok.real; \
  install -m 0755 "$(readlink -f /usr/local/bin/agent)" /usr/local/bin/agent.real; \
  mv -f /usr/local/bin/grok.real /usr/local/bin/grok; \
  mv -f /usr/local/bin/agent.real /usr/local/bin/agent; \
  rm -rf /tmp/grok-install.sh /tmp/grok-install-home
RUN grok --version`

// CHANGE: install RTK as a real command-output optimizer in generated containers.
// WHY: issue-266 asks for out-of-the-box RTK behavior, not only a session-sync estimate.
// REF: issue-266
// SOURCE: https://github.com/rtk-ai/rtk/blob/develop/install.sh
// PURITY: CORE (pure template renderer)
// INVARIANT: rtk is available on PATH under /usr/local/bin during container runtime
// COMPLEXITY: O(1)
const renderDockerfileRtk = (): string =>
  `# Tooling: RTK (Rust Token Killer)
ARG RTK_VERSION=v0.39.0
RUN set -eu; \
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    https://raw.githubusercontent.com/rtk-ai/rtk/\${RTK_VERSION}/install.sh \
    -o /tmp/rtk-install.sh; \
  RTK_VERSION="\${RTK_VERSION}" RTK_INSTALL_DIR=/usr/local/bin sh /tmp/rtk-install.sh; \
  rm -f /tmp/rtk-install.sh; \
  rtk --version; \
  rtk gain >/dev/null 2>&1 || true`

// CHANGE: register the NVIDIA EGL vendor ICD in GPU-enabled dev images.
// WHY: with NVIDIA_DRIVER_CAPABILITIES=all the runtime injects libEGL_nvidia.so.0 at container
//      creation, but it does NOT install the glvnd vendor JSON that points EGL clients at it. Baking
//      the tiny static ICD into the image makes graphical EGL resolve without the manual file-copy
//      step issue-395 documents. The fragment is empty for non-GPU projects so their images stay lean.
// QUOTE(ТЗ): "ls /usr/share/glvnd/egl_vendor.d/10_nvidia.json"
// REF: issue-395
// SOURCE: https://github.com/NVIDIA/libglvnd/blob/master/src/EGL/icd_enumeration.md
// PURITY: CORE (pure template renderer)
// INVARIANT: gpu === "all" => rendered Dockerfile writes 10_nvidia.json; gpu === "none" => empty fragment
// COMPLEXITY: O(1)/O(1)
const renderDockerfileGpu = (config: TemplateConfig): string =>
  config.gpu === "all"
    ? `# GPU graphics: register the NVIDIA EGL vendor ICD so glvnd resolves libEGL_nvidia at runtime.
# The driver library itself is injected by the NVIDIA runtime (NVIDIA_DRIVER_CAPABILITIES=all).
RUN mkdir -p /usr/share/glvnd/egl_vendor.d \
  && printf '%s\\n' \
    '{' \
    '    "file_format_version" : "1.0.0",' \
    '    "ICD" : {' \
    '        "library_path" : "libEGL_nvidia.so.0"' \
    '    }' \
    '}' \
    > /usr/share/glvnd/egl_vendor.d/10_nvidia.json`
    : ""

const dockerGitSessionSyncPackage = "@prover-coder-ai/docker-git-session-sync@latest"

const renderDockerfilePlaywrightRuntime = (config: TemplateConfig): string =>
  config.enableMcpPlaywright
    ? `# Unified Rust browser (dg-*-browser) start/reuse is owned by browser-connection
# No more COPY of separate browser files — single session guaranteed by Rust module (see rust-browser-connection repo)
# Old browser-vnc + cdp-guard duplication removed per #347`
    : ""

/**
 * Renders /etc/profile.d/bun.sh with a runtime-relative PATH extension.
 *
 * @returns Dockerfile RUN directive that prepends Bun to PATH at container runtime.
 * @pure true
 * @effect none; CORE template renderer only constructs a string.
 * @invariant output contains /usr/local/bun/bin and escaped \$PATH, preserving shell-time expansion.
 * @precondition no inputs are required.
 * @postcondition returned Dockerfile command writes /etc/profile.d/bun.sh and chmods it to 0644.
 * @complexity O(1) time / O(1) space.
 */
const renderDockerfileBunProfile = (): string =>
  `RUN printf "export PATH=/usr/local/bun/bin:\\$PATH\\n" \
  > /etc/profile.d/bun.sh && chmod 0644 /etc/profile.d/bun.sh`

const renderDockerfileBun = (config: TemplateConfig): string =>
  [
    renderDockerfileBunPrelude(config),
    renderDockerfileBunProfile()
  ]
    .filter((chunk) => chunk.trim().length > 0)
    .join("\n")

// CHANGE: normalize inherited box image HOME/PATH/WORKDIR and moved login files after the SSH user rewrite
// WHY: box-js publishes HOME=/home/box and login rc files may contain absolute /home/box references; runtime user paths must be re-bound to the mounted /home/dev volume
// QUOTE(ТЗ): "юзать готовый репозиторий"
// REF: issue-267
// SOURCE: n/a
// FORMAT THEOREM: forall u = config.sshUser: HOME(rendered) = /home/u and forall p in login_rc(u): not contains(p, "/home/box")
// PURITY: CORE
// INVARIANT: tilde-expanded and login-shell runtime paths for the SSH user resolve inside the configured home volume
// COMPLEXITY: O(1)/O(1)
/**
 * Renders user, home, PATH, workdir, sudo, and sshd configuration for the project account.
 *
 * @param config - Template configuration whose sshUser is validated before rendering.
 * @returns Dockerfile fragment that creates or rewrites the non-root SSH user.
 * @pure true
 * @effect none; CORE template renderer only constructs a string.
 * @invariant rendered HOME, PATH, WORKDIR, sudoers, and AllowUsers entries target config.sshUser.
 * @precondition config.sshUser satisfies the Linux user-name invariant.
 * @postcondition inherited box or ubuntu accounts resolve to config.sshUser when present.
 * @complexity O(1) time / O(1) space.
 */
const renderDockerfileUsers = (config: TemplateConfig): string =>
  `# Create non-root user for SSH (align UID/GID with host user 1000)
RUN for BASE_USER in ubuntu box; do \
      if [ "$BASE_USER" != "${config.sshUser}" ] && id -u "$BASE_USER" >/dev/null 2>&1; then \
        if getent group 1000 >/dev/null 2>&1; then \
          EXISTING_GROUP="$(getent group 1000 | cut -d: -f1)"; \
          if [ "$EXISTING_GROUP" != "${config.sshUser}" ]; then groupmod -n ${config.sshUser} "$EXISTING_GROUP" || true; fi; \
        fi; \
        usermod -l ${config.sshUser} -d /home/${config.sshUser} -m -s /usr/bin/zsh "$BASE_USER" || true; \
        break; \
      fi; \
    done
RUN if id -u ${config.sshUser} >/dev/null 2>&1; then \
      usermod -u 1000 -g 1000 -o ${config.sshUser}; \
    else \
      groupadd -g 1000 ${config.sshUser} || true; \
      useradd -m -s /usr/bin/zsh -u 1000 -g 1000 -o ${config.sshUser}; \
    fi
RUN set -eu; \
    if [ -d /home/${config.sshUser} ]; then \
      find /home/${config.sshUser} -maxdepth 2 -type f \
        \\( -name ".profile" -o -name ".bash_profile" -o -name ".bashrc" -o -name ".zprofile" -o -name ".zshenv" -o -name ".zshrc" \\) \
        -exec sed -i -e "s|/home/box|/home/${config.sshUser}|g" -e "s|/home/ubuntu|/home/${config.sshUser}|g" {} +; \
    fi
ENV HOME=/home/${config.sshUser}
ENV PATH=/usr/local/bun/bin:/home/${config.sshUser}/.deno/bin:/home/${config.sshUser}/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /home/${config.sshUser}
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

// CHANGE: add docker-git scripts and install the published session sync CLI
// WHY: git hooks need embedded scripts, while session sync should come from npmjs when available
// REF: issue-176, issue-235
// PURITY: CORE (pure template renderer)
// INVARIANT: scripts are accessible under /opt/docker-git/scripts and session sync under PATH
const renderDockerfileScripts = (): string =>
  `# docker-git scripts (hooks, knowledge guards)
COPY scripts/ /opt/docker-git/scripts/
RUN find /opt/docker-git/scripts -type f -name '*.sh' -exec chmod +x {} + \
  && find /opt/docker-git/scripts -type f -name '*.js' -exec chmod +x {} +

# docker-git standalone tools
ARG DOCKER_GIT_SESSION_SYNC_PACKAGE="${dockerGitSessionSyncPackage}"
COPY .docker-git-tools/docker-git-session-sync /opt/docker-git/tools/docker-git-session-sync
RUN set -eu; \
  if npm install -g "$DOCKER_GIT_SESSION_SYNC_PACKAGE"; then \
    docker-git-session-sync --help >/dev/null; \
  else \
    echo "docker-git: npm install of $DOCKER_GIT_SESSION_SYNC_PACKAGE failed; using local session sync fallback" >&2; \
    install -m 0755 /opt/docker-git/tools/docker-git-session-sync /usr/local/bin/docker-git-session-sync; \
    docker-git-session-sync --help >/dev/null; \
  fi`

const renderDockerfileWorkspace = (config: TemplateConfig): string => {
  const targetDirLiteral = shellSingleQuote(config.targetDir)

  return `# Workspace path (supports root-level dirs like /repo)
RUN set -eu; \
    HOME_DIR="/home/${config.sshUser}"; \
    TARGET_DIR=${targetDirLiteral}; \
    HOME_DIR_CANON="$HOME_DIR"; \
    TARGET_DIR_CANON="$TARGET_DIR"; \
    while [ "\${HOME_DIR_CANON%/}" != "$HOME_DIR_CANON" ]; do HOME_DIR_CANON="\${HOME_DIR_CANON%/}"; done; \
    while [ "\${TARGET_DIR_CANON%/}" != "$TARGET_DIR_CANON" ]; do TARGET_DIR_CANON="\${TARGET_DIR_CANON%/}"; done; \
    [ -n "$HOME_DIR_CANON" ] || HOME_DIR_CANON="/"; \
    [ -n "$TARGET_DIR_CANON" ] || TARGET_DIR_CANON="/"; \
    mkdir -p "$HOME_DIR" "$TARGET_DIR"; \
    chown 1000:1000 "$HOME_DIR"; \
    if [ "$TARGET_DIR_CANON" != "/" ] && [ "$TARGET_DIR_CANON" != "$HOME_DIR_CANON" ]; then chown -R 1000:1000 "$TARGET_DIR"; fi

RUN mkdir -p /opt/docker-git/bootstrap/.orch/auth/codex \
  /opt/docker-git/bootstrap/.orch/auth/codex-shared \
  /opt/docker-git/bootstrap/.orch/auth/claude \
  /opt/docker-git/bootstrap/.orch/auth/gemini \
  /opt/docker-git/bootstrap/.orch/auth/grok \
  /opt/docker-git/bootstrap/.orch/env \
  && touch /opt/docker-git/bootstrap/authorized_keys \
  /opt/docker-git/bootstrap/.orch/env/global.env \
  /opt/docker-git/bootstrap/.orch/env/project.env

COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]`
}

export const renderDockerfile = (config: TemplateConfig): string =>
  [
    renderDockerfilePrelude(),
    renderDockerfileGlab(),
    renderDockerfilePrompt(),
    renderDockerfileNode(),
    renderDockerfileBun(config),
    renderDockerfilePlaywrightRuntime(config),
    renderDockerfileRtk(),
    renderDockerfileGpu(config),
    renderDockerfileOpenCode(),
    renderDockerfileGitleaks(),
    renderDockerfileUsers(config),
    renderDockerfileScripts(),
    renderDockerfileWorkspace(config)
  ].join("\n\n")
