FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git ca-certificates nodejs npm \
 && rm -rf /var/lib/apt/lists/*

# Tooling: pnpm + Codex CLI
RUN npm i -g pnpm@10.27.0 @openai/codex

# Create non-root user for SSH
RUN useradd -m -s /bin/bash dev

# sshd runtime dir
RUN mkdir -p /run/sshd

# Harden sshd: disable password auth and root login
RUN printf "%s\n" \
  "PasswordAuthentication no" \
  "PermitRootLogin no" \
  "PubkeyAuthentication yes" \
  "AllowUsers dev" \
  > /etc/ssh/sshd_config.d/dev.conf

# Workspace in dev home
RUN mkdir -p /home/dev/app && chown -R dev:dev /home/dev

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
