// CHANGE: use the shared link-foundation JS box as the generated project base image
// WHY: issue #267 asks docker-git to reuse unified box containers instead of maintaining a raw Ubuntu workspace base; the Docker Hub JS image is public and version-pinned to avoid latest drift
// QUOTE(ТЗ): "Что бы не зависить только от своих обновлений, а иметь единую инфраструктру есть смысл юзать готовый репозиторий"
// REF: issue-267
// SOURCE: https://github.com/link-foundation/box#docker-hub---combo-boxes
// FORMAT THEOREM: renderDockerfile(config) -> base_image_default(rendered) = konard/box-js:2.1.1
// PURITY: CORE
// INVARIANT: the rendered Dockerfile inherits JS/runtime tooling from link-foundation/box while preserving docker-git bootstrap layers
// COMPLEXITY: O(1)/O(1)
const dockerGitBaseImage = "konard/box-js:2.1.1"

// CHANGE: include tmux and build-essential in generated project images for durable sessions and Rust crate installation.
// WHY: stable project SSH links need persisted tmux sessions, and cargo install of proc-macro/build-script dependencies requires a C linker.
// QUOTE(ТЗ): n/a
// REF: PR-309
// SOURCE: n/a
// PURITY: CORE
// INVARIANT: generated base image contains both the terminal multiplexer and cc toolchain required before Rust browser CLI installation.
// COMPLEXITY: O(1)/O(1)
const renderDockerfileBase = (): string =>
  `ARG DOCKER_GIT_BASE_IMAGE=${dockerGitBaseImage}
FROM \${DOCKER_GIT_BASE_IMAGE}

#checkov:skip=CKV_DOCKER_8: docker-git entrypoint must start as root to prepare SSH/auth/bootstrap and run sshd
USER root
ARG UBUNTU_APT_MIRROR=
ENV DEBIAN_FRONTEND=noninteractive
ENV NVM_DIR=/usr/local/nvm

RUN set -eu; \
  if [ -n "\${UBUNTU_APT_MIRROR:-}" ]; then \
    sed -i \
      -e "s|http://archive.ubuntu.com/ubuntu|\${UBUNTU_APT_MIRROR}|g" \
      -e "s|http://security.ubuntu.com/ubuntu|\${UBUNTU_APT_MIRROR}|g" \
      /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true; \
  fi; \
  for attempt in 1 2 3 4 5; do \
    rm -rf /var/lib/apt/lists/*; \
    if apt-get -o Acquire::Retries=3 -o Acquire::By-Hash=force update; then \
      break; \
    fi; \
    if [ "$attempt" = "5" ]; then \
      echo "apt-get update failed after retries" >&2; \
      exit 1; \
    fi; \
    echo "apt-get update attempt \${attempt} failed; retrying..." >&2; \
    sleep $((attempt * 2)); \
  done; \
  apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    openssh-server git gh ca-certificates curl unzip bsdutils sudo tmux \
    make build-essential docker.io docker-compose-v2 bash-completion zsh zsh-autosuggestions xauth \
    ncurses-term jq \
  && rm -rf /var/lib/apt/lists/*`

// CHANGE: install the unified Rust browser connection with a current Rust toolchain.
// WHY: rust-browser-connection uses modern Cargo metadata; Ubuntu apt cargo 1.75 cannot resolve edition-2024 dependencies pulled by current crates.
// QUOTE(ТЗ): "Rust-only отдельный модуль для noVNC/browser, без TS-дублирования"
// REF: issue-347
// SOURCE: n/a
// FORMAT THEOREM: image_build_success -> executables(/usr/local/bin/docker-git-browser-connection, /usr/local/bin/browser-connection)
// PURITY: SHELL
// EFFECT: Docker build downloads rustup and installs a pinned Git revision of the Rust crate.
// INVARIANT: generated images use rustup stable and expose both Rust lifecycle and MCP stdio binaries from an immutable upstream revision on runtime PATH.
// COMPLEXITY: O(network + cargo_build)
const renderDockerfileRustBrowserConnection = (): string =>
  `ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH="/usr/local/cargo/bin:/root/.cargo/bin:/home/box/.cargo/bin:\${PATH}"
RUN set -eu; \
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh; \
  HOME=/root sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain stable --no-modify-path; \
  rm -f /tmp/rustup-init.sh; \
  rustc --version; \
  cargo --version

# Install unified Rust browser connection (noVNC + CDP + single dg-*-browser guarantee)
# Replaces all previous TS/MCP browser-connection duplication (per issue #347)
RUN cargo install --git https://github.com/ProverCoderAI/rust-browser-connection --rev c36f263ebc5d0acdf155113914f08cafefa69c56 --locked --bins --root /usr/local \
  && /usr/local/bin/docker-git-browser-connection --version \
  && /usr/local/bin/browser-connection --version

# Passwordless sudo for all users (container is disposable)
RUN printf "%s\\n" "ALL ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zz-all \
  && chmod 0440 /etc/sudoers.d/zz-all`

/**
 * Renders the base image, package prelude, Rust toolchain, and browser module install.
 *
 * @returns Dockerfile fragment that establishes the shared project container base.
 * @pure true
 * @effect none; CORE template renderer only constructs a string.
 * @invariant the returned fragment starts from the configured shared JS box image and installs the Rust browser lifecycle + MCP CLIs.
 * @precondition docker-git generated entrypoint remains the container entrypoint.
 * @postcondition the fragment keeps root available for setup and publishes both Rust browser binaries on PATH.
 * @complexity O(1) time / O(1) space.
 */
export const renderDockerfilePrelude = (): string =>
  [renderDockerfileBase(), renderDockerfileRustBrowserConnection()].join("\n\n")
