import type { TemplateConfig } from "../domain.js"

const renderEntrypointAuthEnvBridge = (config: TemplateConfig): string =>
  String.raw`# 2) Ensure GitHub auth vars are available for SSH sessions if provided
if [[ -n "$GH_TOKEN" || -n "$GITHUB_TOKEN" ]]; then
  EFFECTIVE_GITHUB_TOKEN="$GITHUB_TOKEN"
  if [[ -z "$EFFECTIVE_GITHUB_TOKEN" ]]; then
    EFFECTIVE_GITHUB_TOKEN="$GH_TOKEN"
  fi

  EFFECTIVE_GH_TOKEN="$GH_TOKEN"
  if [[ -z "$EFFECTIVE_GH_TOKEN" ]]; then
    EFFECTIVE_GH_TOKEN="$EFFECTIVE_GITHUB_TOKEN"
  fi

  printf "export GH_TOKEN=%q\n" "$EFFECTIVE_GH_TOKEN" > /etc/profile.d/gh-token.sh
  printf "export GITHUB_TOKEN=%q\n" "$EFFECTIVE_GITHUB_TOKEN" >> /etc/profile.d/gh-token.sh
  chmod 0644 /etc/profile.d/gh-token.sh
  docker_git_upsert_ssh_env "GH_TOKEN" "$EFFECTIVE_GH_TOKEN"
  docker_git_upsert_ssh_env "GITHUB_TOKEN" "$EFFECTIVE_GITHUB_TOKEN"

  SAFE_GH_TOKEN="$(printf "%q" "$GH_TOKEN")"
  # Keep git+https auth in sync with gh auth so push/pull works without manual setup.
  su - ${config.sshUser} -c "GH_TOKEN=$SAFE_GH_TOKEN gh auth setup-git --hostname github.com --force" || true

  GH_LOGIN="$(su - ${config.sshUser} -c "GH_TOKEN=$SAFE_GH_TOKEN gh api user --jq .login" 2>/dev/null || true)"
  GH_ID="$(su - ${config.sshUser} -c "GH_TOKEN=$SAFE_GH_TOKEN gh api user --jq .id" 2>/dev/null || true)"
  GH_LOGIN="$(printf "%s" "$GH_LOGIN" | tr -d '\r\n')"
  GH_ID="$(printf "%s" "$GH_ID" | tr -d '\r\n')"

  if [[ -z "$GIT_USER_NAME" && -n "$GH_LOGIN" ]]; then
    GIT_USER_NAME="$GH_LOGIN"
  fi
  if [[ -z "$GIT_USER_EMAIL" && -n "$GH_LOGIN" && -n "$GH_ID" ]]; then
    GIT_USER_EMAIL="${"${"}GH_ID}+${"${"}GH_LOGIN}@users.noreply.github.com"
  fi
fi`

const renderEntrypointGitCredentialHelper = (config: TemplateConfig): string =>
  String.raw`# 3) Configure git credential helper for HTTPS remotes
GIT_CREDENTIAL_HELPER_PATH="/usr/local/bin/docker-git-credential-helper"
cat <<'EOF' > "$GIT_CREDENTIAL_HELPER_PATH"
#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 || "$1" != "get" ]]; then
  exit 0
fi

token="$GITHUB_TOKEN"
if [[ -z "$token" ]]; then
  token="$GH_TOKEN"
fi

if [[ -z "$token" ]]; then
  exit 0
fi

printf "%s\n" "username=x-access-token"
printf "%s\n" "password=$token"
EOF
chmod 0755 "$GIT_CREDENTIAL_HELPER_PATH"
su - ${config.sshUser} -c "git config --global credential.helper '$GIT_CREDENTIAL_HELPER_PATH'"`

const renderEntrypointGitIdentity = (config: TemplateConfig): string =>
  String.raw`# 4) Configure git identity for the dev user if provided
if [[ -n "$GIT_USER_NAME" ]]; then
  SAFE_GIT_USER_NAME="$(printf "%q" "$GIT_USER_NAME")"
  su - ${config.sshUser} -c "git config --global user.name $SAFE_GIT_USER_NAME"
fi

if [[ -n "$GIT_USER_EMAIL" ]]; then
  SAFE_GIT_USER_EMAIL="$(printf "%q" "$GIT_USER_EMAIL")"
  su - ${config.sshUser} -c "git config --global user.email $SAFE_GIT_USER_EMAIL"
fi`

export const renderEntrypointGitConfig = (config: TemplateConfig): string =>
  [
    renderEntrypointAuthEnvBridge(config),
    renderEntrypointGitCredentialHelper(config),
    renderEntrypointGitIdentity(config)
  ].join("\n\n")

export const renderEntrypointGitHooks = (): string =>
  String.raw`# 3) Install global git hooks to protect main/master
HOOKS_DIR="/opt/docker-git/hooks"
PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"
mkdir -p "$HOOKS_DIR"
if [[ ! -f "$PRE_PUSH_HOOK" ]]; then
  cat <<'EOF' > "$PRE_PUSH_HOOK"
#!/usr/bin/env bash
set -euo pipefail

protected_branches=("refs/heads/main" "refs/heads/master")
allow_delete="${"${"}DOCKER_GIT_ALLOW_DELETE:-}"

while read -r local_ref local_sha remote_ref remote_sha; do
  if [[ -z "$remote_ref" ]]; then
    continue
  fi
  for protected in "${"${"}protected_branches[@]}"; do
    if [[ "$remote_ref" == "$protected" || "$local_ref" == "$protected" ]]; then
      echo "docker-git: push to protected branch '${"${"}protected##*/}' is disabled."
      echo "docker-git: create a new branch: git checkout -b <name>"
      exit 1
    fi
  done
  if [[ "$local_sha" == "0000000000000000000000000000000000000000" && "$remote_ref" == refs/heads/* ]]; then
    if [[ "$allow_delete" != "1" ]]; then
      echo "docker-git: deleting remote branches is disabled (set DOCKER_GIT_ALLOW_DELETE=1 to override)."
      exit 1
    fi
  fi
done
EOF
  chmod 0755 "$PRE_PUSH_HOOK"
fi
git config --system core.hooksPath "$HOOKS_DIR" || true
git config --global core.hooksPath "$HOOKS_DIR" || true`
