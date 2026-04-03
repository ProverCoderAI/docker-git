FROM ubuntu:24.04

ARG DOCKER_GIT_CONTROLLER_REV=unknown
LABEL io.prover-coder-ai.docker-git.controller-rev=$DOCKER_GIT_CONTROLLER_REV

ENV DEBIAN_FRONTEND=noninteractive
ENV DOCKER_GIT_CONTROLLER_REV=$DOCKER_GIT_CONTROLLER_REV
WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git docker.io docker-compose-v2 sshpass \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm i -g pnpm@10.28.0 \
 && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY patches ./patches
COPY scripts ./scripts
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter ./packages/lib build
RUN pnpm --filter ./packages/api build

ENV DOCKER_GIT_API_PORT=3334
EXPOSE 3334

CMD ["node", "packages/api/dist/src/main.js"]
