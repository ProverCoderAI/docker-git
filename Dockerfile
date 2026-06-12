FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git ca-certificates curl unzip sshpass gnupg \
 && rm -rf /var/lib/apt/lists/*

# Tooling: Bun + Codex CLI
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && curl -fsSL https://bun.sh/install | bash \
 && npm i -g node-gyp@12.4.0 @openai/codex

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
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 22
EXPOSE 3334
ENTRYPOINT ["/entrypoint.sh"]
