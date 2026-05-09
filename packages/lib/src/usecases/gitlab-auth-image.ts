import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import type { Effect } from "effect"

import type { CommandFailedError } from "../shell/errors.js"
import { ensureDockerImage } from "./docker-image.js"

export const gitlabAuthRoot = ".docker-git/.orch/auth/gitlab"
export const gitlabAuthDir = "/glab-auth"
export const gitlabImageName = "docker-git-auth-gitlab:latest"
export const gitlabImageDir = ".docker-git/.orch/auth/gitlab/.image"

const glabVersion = "1.93.0"
const glabPackageBaseUrl = `https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/${glabVersion}`

export const renderGlabDockerfile = (): string =>
  String.raw`FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git bsdutils \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in \
      amd64) GLAB_ARCH="amd64" ;; \
      arm64) GLAB_ARCH="arm64" ;; \
      armhf) GLAB_ARCH="armv6" ;; \
      i386) GLAB_ARCH="386" ;; \
      ppc64el) GLAB_ARCH="ppc64le" ;; \
      s390x) GLAB_ARCH="s390x" ;; \
      *) echo "Unsupported glab architecture: $ARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "${glabPackageBaseUrl}/glab_${glabVersion}_linux_$GLAB_ARCH.deb" -o /tmp/glab.deb \
  && apt-get install -y --no-install-recommends /tmp/glab.deb \
  && rm -f /tmp/glab.deb \
  && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["glab"]
`

// CHANGE: centralize glab auth image build for reuse
// WHY: GitLab OAuth login needs an isolated CLI container like GitHub auth
// REF: issue-252
// SOURCE: https://docs.gitlab.com/cli/
// PURITY: SHELL
export const ensureGlabAuthImage = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
  buildLabel: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  ensureDockerImage(fs, path, cwd, {
    imageName: gitlabImageName,
    imageDir: gitlabImageDir,
    dockerfile: renderGlabDockerfile(),
    buildLabel
  })
