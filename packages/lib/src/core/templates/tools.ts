const openCodeVersion = "1.2.27"

export const renderDockerfileOpenCode = (): string =>
  `# Tooling: OpenCode (binary)
RUN set -eu; \
  ARCH="$(uname -m)"; \
  case "$ARCH" in \
    x86_64|amd64) OPENCODE_ARCH="x64" ;; \
    aarch64|arm64) OPENCODE_ARCH="arm64" ;; \
    *) echo "Unsupported arch for OpenCode: $ARCH" >&2; exit 1 ;; \
  esac; \
  OPENCODE_TARGET="linux-$OPENCODE_ARCH"; \
  if [ "$OPENCODE_ARCH" = "x64" ] && ! grep -qwi avx2 /proc/cpuinfo 2>/dev/null; then \
    OPENCODE_TARGET="$OPENCODE_TARGET-baseline"; \
  fi; \
  if [ -f /etc/alpine-release ] || { command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; }; then \
    OPENCODE_TARGET="$OPENCODE_TARGET-musl"; \
  fi; \
  OPENCODE_ARCHIVE="opencode-$OPENCODE_TARGET.tar.gz"; \
  mkdir -p /usr/local/.opencode/bin; \
  for attempt in 1 2 3 4 5; do \
    tmp_archive="$(mktemp)"; \
    if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      "https://github.com/anomalyco/opencode/releases/download/v${openCodeVersion}/$OPENCODE_ARCHIVE" \
      -o "$tmp_archive" \
      && tar -xzf "$tmp_archive" -C /usr/local/.opencode/bin opencode; then \
      rm -f "$tmp_archive"; \
      exit 0; \
    fi; \
    rm -f "$tmp_archive"; \
    echo "opencode install attempt \${attempt} failed; retrying..." >&2; \
    sleep $((attempt * 2)); \
  done; \
  echo "opencode install failed after retries" >&2; \
  exit 1
RUN ln -sf /usr/local/.opencode/bin/opencode /usr/local/bin/opencode
RUN opencode --version`

const gitleaksVersion = "8.28.0"

export const renderDockerfileGitleaks = (): string =>
  `# Tooling: gitleaks (secret scanner for .knowledge/.knowlenge hooks)
RUN ARCH="$(uname -m)" \
  && case "$ARCH" in \
      x86_64|amd64) GITLEAKS_ARCH="x64" ;; \
      aarch64|arm64) GITLEAKS_ARCH="arm64" ;; \
      *) echo "Unsupported arch for gitleaks: $ARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaksVersion}/gitleaks_${gitleaksVersion}_linux_$GITLEAKS_ARCH.tar.gz" \
    | tar -xz -C /usr/local/bin gitleaks \
  && chmod +x /usr/local/bin/gitleaks \
  && gitleaks version`
