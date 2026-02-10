import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import type { Effect } from "effect"

import type { CommandFailedError } from "../shell/errors.js"
import { ensureDockerImage } from "./docker-image.js"

export const ghAuthRoot = ".docker-git/.orch/auth/gh"
export const ghAuthDir = "/root/.config/gh"
export const ghImageName = "docker-git-auth-gh:latest"
export const ghImageDir = ".docker-git/.orch/auth/gh/.image"

export const renderGhDockerfile = (): string =>
  String.raw`FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg bsdutils \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh git \
  && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["gh"]
`

// CHANGE: centralize gh auth image build for reuse
// WHY: avoid duplicated docker image logic across gh workflows
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: ∀l: ensure(l) → image_exists(gh)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: dockerfile content is stable
// COMPLEXITY: O(command)
export const ensureGhAuthImage = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
  buildLabel: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  ensureDockerImage(fs, path, cwd, {
    imageName: ghImageName,
    imageDir: ghImageDir,
    dockerfile: renderGhDockerfile(),
    buildLabel
  })
