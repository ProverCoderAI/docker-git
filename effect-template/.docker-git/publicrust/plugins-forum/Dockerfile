FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NVM_DIR=/usr/local/nvm

RUN apt-get update && apt-get install -y --no-install-recommends     openssh-server git gh ca-certificates curl unzip bsdutils sudo     make docker.io docker-compose  && rm -rf /var/lib/apt/lists/*

# Passwordless sudo for all users (container is disposable)
RUN printf "%s\n" "ALL ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zz-all   && chmod 0440 /etc/sudoers.d/zz-all

# Shell prompt: show git branch for interactive sessions
RUN cat <<'EOF' > /etc/profile.d/zz-prompt.sh
docker_git_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }
docker_git_prompt_apply() {
  local b
  b="$(docker_git_branch)"
  local base="[\\t] \\w"
  if [ -n "$b" ]; then
    PS1="${base} (${b})> "
  else
    PS1="${base}> "
  fi
}
if [ -n "$PROMPT_COMMAND" ]; then
  PROMPT_COMMAND="docker_git_prompt_apply;$PROMPT_COMMAND"
else
  PROMPT_COMMAND="docker_git_prompt_apply"
fi
EOF
RUN chmod 0644 /etc/profile.d/zz-prompt.sh
RUN printf "%s\n" \
  "if [ -f /etc/profile.d/zz-prompt.sh ]; then . /etc/profile.d/zz-prompt.sh; fi" \
  >> /etc/bash.bashrc

# Tooling: Node 24 (NodeSource) + nvm
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash -   && apt-get install -y --no-install-recommends nodejs   && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /usr/local/nvm   && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
RUN printf "export NVM_DIR=/usr/local/nvm\n[ -s /usr/local/nvm/nvm.sh ] && . /usr/local/nvm/nvm.sh\n"   > /etc/profile.d/nvm.sh && chmod 0644 /etc/profile.d/nvm.sh

# Tooling: pnpm + Codex CLI (bun)
RUN npm i -g pnpm@10.27.0
ENV BUN_INSTALL=/usr/local/bun
ENV TERM=xterm-256color
ENV PATH="/usr/local/bun/bin:$PATH"
RUN curl -fsSL https://bun.sh/install | bash
RUN ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
RUN script -q -e -c "bun add -g @openai/codex@latest" /dev/null
RUN ln -sf /usr/local/bun/bin/codex /usr/local/bin/codex
RUN printf "export BUN_INSTALL=/usr/local/bun\nexport PATH=/usr/local/bun/bin:$PATH\n"   > /etc/profile.d/bun.sh && chmod 0644 /etc/profile.d/bun.sh

# Create non-root user for SSH (align UID/GID with host user 1000)
RUN if id -u ubuntu >/dev/null 2>&1; then       if getent group 1000 >/dev/null 2>&1; then         EXISTING_GROUP="$(getent group 1000 | cut -d: -f1)";         if [ "$EXISTING_GROUP" != "dev" ]; then groupmod -n dev "$EXISTING_GROUP" || true; fi;       fi;       usermod -l dev -d /home/dev -m ubuntu || true;     fi
RUN if id -u dev >/dev/null 2>&1; then       usermod -u 1000 -g 1000 -o dev;     else       groupadd -g 1000 dev || true;       useradd -m -s /bin/bash -u 1000 -g 1000 -o dev;     fi
RUN printf "%s\n" "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev   && chmod 0440 /etc/sudoers.d/dev

# sshd runtime dir
RUN mkdir -p /run/sshd

# Harden sshd: disable password auth and root login
RUN printf "%s\n"   "PasswordAuthentication no"   "PermitRootLogin no"   "PubkeyAuthentication yes"   "AllowUsers dev"   > /etc/ssh/sshd_config.d/dev.conf

# Workspace path (supports root-level dirs like /repo)
RUN mkdir -p /home/dev/publicrust/plugins-forum   && chown -R 1000:1000 /home/dev   && if [ "/home/dev/publicrust/plugins-forum" != "/" ]; then chown -R 1000:1000 "/home/dev/publicrust/plugins-forum"; fi

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]