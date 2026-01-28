FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends     openssh-server git gh ca-certificates nodejs npm curl unzip bsdutils sudo  && rm -rf /var/lib/apt/lists/*

# Passwordless sudo for all users (container is disposable)
RUN printf "%s\n" "ALL ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zz-all   && chmod 0440 /etc/sudoers.d/zz-all

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
RUN groupadd -g 1000 dev || true
RUN if id -u dev >/dev/null 2>&1; then       usermod -u 1000 -g 1000 -o dev;     else       useradd -m -s /bin/bash -u 1000 -g 1000 -o dev;     fi
RUN printf "%s\n" "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev   && chmod 0440 /etc/sudoers.d/dev

# sshd runtime dir
RUN mkdir -p /run/sshd

# Harden sshd: disable password auth and root login
RUN printf "%s\n"   "PasswordAuthentication no"   "PermitRootLogin no"   "PubkeyAuthentication yes"   "AllowUsers dev"   > /etc/ssh/sshd_config.d/dev.conf

# Workspace path (supports root-level dirs like /repo)
RUN mkdir -p /provercoderai/eslint-plugin-suggest-members   && chown -R 1000:1000 /home/dev   && if [ "/provercoderai/eslint-plugin-suggest-members" != "/" ]; then chown -R 1000:1000 "/provercoderai/eslint-plugin-suggest-members"; fi

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
