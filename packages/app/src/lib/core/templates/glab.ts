const glabVersion = "1.93.0"

export const renderDockerfileGlab = (): string =>
  `# Tooling: GitLab CLI (glab)
RUN set -eu; \
  ARCH="$(dpkg --print-architecture)"; \
  case "$ARCH" in \
    amd64) GLAB_ARCH="amd64" ;; \
    arm64) GLAB_ARCH="arm64" ;; \
    armhf) GLAB_ARCH="armv6" ;; \
    i386) GLAB_ARCH="386" ;; \
    ppc64el) GLAB_ARCH="ppc64le" ;; \
    s390x) GLAB_ARCH="s390x" ;; \
    *) echo "Unsupported glab architecture: $ARCH" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v${glabVersion}/downloads/glab_${glabVersion}_linux_\\$GLAB_ARCH.deb" -o /tmp/glab.deb; \
  apt-get update; \
  apt-get install -y --no-install-recommends /tmp/glab.deb; \
  rm -f /tmp/glab.deb; \
  rm -rf /var/lib/apt/lists/*; \
  glab --version`
