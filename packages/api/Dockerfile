FROM ubuntu:24.04

ARG DOCKER_GIT_CONTROLLER_REV=unknown
LABEL io.prover-coder-ai.docker-git.controller-rev=$DOCKER_GIT_CONTROLLER_REV

ENV DEBIAN_FRONTEND=noninteractive
ENV DOCKER_GIT_CONTROLLER_REV=$DOCKER_GIT_CONTROLLER_REV
ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:$PATH
WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git docker.io docker-compose-v2 sshpass python3 make g++ unzip \
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

RUN bun install --frozen-lockfile --silent
RUN bun run --cwd packages/lib build
RUN bun run --cwd packages/api build

ENV DOCKER_GIT_API_PORT=3334
EXPOSE 3334

CMD ["bun", "packages/api/dist/src/main.js"]
