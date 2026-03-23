FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git ca-certificates nodejs npm sshpass \
 && rm -rf /var/lib/apt/lists/*

# Tooling: pnpm + Codex CLI
RUN npm i -g pnpm@10.27.0 @openai/codex

# Create non-root user for SSH
RUN useradd -m -s /bin/bash dev

# sshd runtime dir
RUN mkdir -p /run/sshd

# sshd: password auth enabled so users can connect without key setup
RUN printf "%s\n" \
  "PasswordAuthentication yes" \
  "PermitRootLogin no" \
  "PubkeyAuthentication yes" \
  "AllowUsers dev" \
  > /etc/ssh/sshd_config.d/dev.conf

# Default password = username (works out of the box; key auth still accepted if authorized_keys provided)
RUN echo "dev:dev" | chpasswd

# Workspace in dev home
RUN mkdir -p /home/dev/app && chown -R dev:dev /home/dev

COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 22
EXPOSE 3334
ENTRYPOINT ["/entrypoint.sh"]
