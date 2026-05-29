FROM ubuntu:26.04 AS controller-base

ARG UBUNTU_APT_MIRROR=

ENV DEBIAN_FRONTEND=noninteractive
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
    ca-certificates curl gpg git docker.io docker-compose-v2 openssh-client sshpass python3 make g++ unzip \
    xvfb libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
    libnss3 libpango-1.0-0 libx11-xcb1 libxcb-dri3-0 libxcomposite1 libxdamage1 libxfixes3 \
    libxkbcommon0 libxrandr2 libxshmfence1 \
 && mkdir -p /usr/share/keyrings \
 && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list \
 && curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
 && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list \
 && apt-get -o Acquire::Retries=3 update \
 && apt-get -o Acquire::Retries=3 install -y --no-install-recommends cloudflared nvidia-container-toolkit \
 && nvidia-ctk runtime configure --runtime=docker \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && curl -fsSL https://bun.sh/install | bash \
 && npm i -g node-gyp \
 && rm -rf /var/lib/apt/lists/*

FROM controller-base AS workspace-deps

COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
RUN mkdir -p packages/api packages/app packages/docker-git-session-sync packages/lib
COPY packages/api/package.json ./packages/api/package.json
COPY packages/app/package.json ./packages/app/package.json
COPY packages/docker-git-session-sync/package.json ./packages/docker-git-session-sync/package.json
COPY packages/lib/package.json ./packages/lib/package.json

RUN set -eu; \
    for attempt in 1 2 3 4 5; do \
      if bun install \
        --frozen-lockfile \
        --silent \
        --filter @effect-template/api \
        --filter @effect-template/lib \
        --filter @prover-coder-ai/docker-git-session-sync; then \
        exit 0; \
      fi; \
      echo "bun install attempt ${attempt} failed; retrying..." >&2; \
      rm -rf /root/.bun/install/cache; \
      sleep $((attempt * 2)); \
    done; \
    echo "bun install failed after retries" >&2; \
    exit 1

FROM workspace-deps AS workspace-static

COPY patches ./patches
COPY scripts ./scripts
COPY packages/docker-git-session-sync ./packages/docker-git-session-sync
COPY packages/lib ./packages/lib

RUN bun run --cwd packages/docker-git-session-sync build
RUN bun run --cwd packages/lib build

FROM controller-base AS skiller-build

ARG DOCKER_GIT_CONTROLLER_BUILD_SKILLER=1

COPY patches ./patches
COPY scripts/skiller-apply-docker-git-patches.mjs ./scripts/skiller-apply-docker-git-patches.mjs
COPY .gitmodules ./.gitmodules
COPY third_party ./third_party

RUN if [ "$DOCKER_GIT_CONTROLLER_BUILD_SKILLER" = "1" ]; then \
      bun scripts/skiller-apply-docker-git-patches.mjs; \
    else \
      echo "Skipping Skiller build for controller image."; \
    fi
RUN if [ "$DOCKER_GIT_CONTROLLER_BUILD_SKILLER" = "1" ]; then \
      test -f third_party/skiller-desktop-skills-manager/package.json \
      && cd third_party/skiller-desktop-skills-manager \
      && for attempt in 1 2 3 4 5; do \
          if bun install --frozen-lockfile --silent; then \
            break; \
          fi; \
          if [ "$attempt" = "5" ]; then \
            echo "skiller bun install failed after retries" >&2; \
            exit 1; \
          fi; \
          echo "skiller bun install attempt ${attempt} failed; retrying..." >&2; \
          rm -rf /root/.bun/install/cache node_modules; \
          sleep $((attempt * 2)); \
        done \
      && bun run build \
      && touch out/.docker-git-browser-folder-picker.patch \
      && mkdir -p out/preload \
      && ln -sf index.mjs out/preload/index.js; \
    else \
      cd third_party/skiller-desktop-skills-manager \
      && mkdir -p node_modules/electron/dist out/main out/renderer out/preload \
      && printf '%s\n' '#!/usr/bin/env sh' 'echo "Skiller is not bundled in this controller image." >&2' 'exit 1' \
        > node_modules/electron/dist/electron \
      && chmod +x node_modules/electron/dist/electron \
      && printf '%s\n' 'throw new Error("Skiller is not bundled in this controller image.")' > out/main/index.js \
      && printf '%s\n' '<!doctype html><title>Skiller unavailable</title>' > out/renderer/index.html \
      && printf '%s\n' 'export {}' > out/preload/index.mjs \
      && touch out/.docker-git-browser-folder-picker.patch \
      && ln -sf index.mjs out/preload/index.js; \
    fi

FROM workspace-static AS controller-final

COPY .gitmodules ./.gitmodules
COPY --from=skiller-build /workspace/third_party/skiller-desktop-skills-manager ./third_party/skiller-desktop-skills-manager
COPY packages/api ./packages/api

RUN ./packages/api/node_modules/.bin/tsc -p packages/api/tsconfig.json

ARG DOCKER_GIT_CONTROLLER_REV=unknown
ARG DOCKER_GIT_CONTROLLER_BUILD_SKILLER=1
LABEL io.prover-coder-ai.docker-git.controller-rev=$DOCKER_GIT_CONTROLLER_REV
LABEL io.prover-coder-ai.docker-git.controller-build-skiller=$DOCKER_GIT_CONTROLLER_BUILD_SKILLER

ENV DOCKER_GIT_CONTROLLER_REV=$DOCKER_GIT_CONTROLLER_REV
ENV DOCKER_GIT_CONTROLLER_BUILD_SKILLER=$DOCKER_GIT_CONTROLLER_BUILD_SKILLER
ENV DOCKER_GIT_API_PORT=3334
ENV DOCKER_GIT_DOCKER_RUNTIME=host
ENV DOCKER_HOST=unix:///var/run/docker.sock
EXPOSE 3334

CMD ["bash", "packages/api/scripts/start-controller.sh"]
