FROM ubuntu:26.04

ARG DOCKER_GIT_CONTROLLER_REV=unknown
ARG UBUNTU_APT_MIRROR=
LABEL io.prover-coder-ai.docker-git.controller-rev=$DOCKER_GIT_CONTROLLER_REV

ENV DEBIAN_FRONTEND=noninteractive
ENV DOCKER_GIT_CONTROLLER_REV=$DOCKER_GIT_CONTROLLER_REV
ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:$PATH
WORKDIR /workspace

RUN set -eu; \
  if [ -n "${UBUNTU_APT_MIRROR:-}" ]; then \
    sed -i \
      -e "s|http://archive.ubuntu.com/ubuntu|${UBUNTU_APT_MIRROR}|g" \
      -e "s|http://security.ubuntu.com/ubuntu|${UBUNTU_APT_MIRROR}|g" \
      /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true; \
  fi; \
  for attempt in 1 2 3; do \
    rm -rf /var/lib/apt/lists/*; \
    if apt-get -o Acquire::Retries=3 -o Acquire::By-Hash=force update; then \
      break; \
    fi; \
    if [ "$attempt" = "3" ]; then \
      echo "apt-get update failed after retries" >&2; \
      exit 1; \
    fi; \
    echo "apt-get update attempt ${attempt} failed; retrying..." >&2; \
    sleep $((attempt * 2)); \
  done; \
  apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    ca-certificates curl git docker.io docker-compose-v2 openssh-client sshpass python3 make g++ unzip \
    xvfb libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
    libnss3 libpango-1.0-0 libx11-xcb1 libxcb-dri3-0 libxcomposite1 libxdamage1 libxfixes3 \
    libxkbcommon0 libxrandr2 libxshmfence1 \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && curl -fsSL https://bun.sh/install | bash \
 && npm i -g node-gyp \
 && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY patches ./patches
COPY scripts ./scripts
COPY packages ./packages
COPY .gitmodules ./.gitmodules
COPY third_party ./third_party

RUN set -eu; \
    for attempt in 1 2 3 4 5; do \
      if bun install --frozen-lockfile --silent; then \
        exit 0; \
      fi; \
      echo "bun install attempt ${attempt} failed; retrying..." >&2; \
      rm -rf /root/.bun/install/cache; \
      sleep $((attempt * 2)); \
    done; \
    echo "bun install failed after retries" >&2; \
    exit 1
RUN bun run --cwd packages/lib build
RUN bun run --cwd packages/api build
RUN bun scripts/skiller-apply-docker-git-patches.mjs
RUN test -f third_party/skiller-desktop-skills-manager/package.json \
 && cd third_party/skiller-desktop-skills-manager \
 && bun install --frozen-lockfile --silent \
 && bun run build \
 && touch out/.docker-git-browser-folder-picker.patch \
 && mkdir -p out/preload \
 && ln -sf index.mjs out/preload/index.js

ENV DOCKER_GIT_API_PORT=3334
ENV DOCKER_GIT_DOCKER_RUNTIME=isolated
ENV DOCKER_HOST=unix:///var/run/docker.sock
EXPOSE 3334

CMD ["bash", "packages/api/scripts/start-controller.sh"]
