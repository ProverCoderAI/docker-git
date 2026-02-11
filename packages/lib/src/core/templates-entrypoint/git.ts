import type { TemplateConfig } from "../domain.js"

export const renderEntrypointGitConfig = (config: TemplateConfig): string =>
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
  SSH_ENV_PATH="/home/${config.sshUser}/.ssh/environment"
  printf "%s\n" "GH_TOKEN=$EFFECTIVE_GH_TOKEN" > "$SSH_ENV_PATH"
  printf "%s\n" "GITHUB_TOKEN=$EFFECTIVE_GITHUB_TOKEN" >> "$SSH_ENV_PATH"
  chmod 600 "$SSH_ENV_PATH"
  chown 1000:1000 "$SSH_ENV_PATH" || true
fi

# 3) Configure git credential helper for HTTPS remotes
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
su - ${config.sshUser} -c "git config --global credential.helper '$GIT_CREDENTIAL_HELPER_PATH'"

# 4) Configure git identity for the dev user if provided
if [[ -n "$GIT_USER_NAME" ]]; then
  SAFE_GIT_USER_NAME="$(printf "%q" "$GIT_USER_NAME")"
  su - ${config.sshUser} -c "git config --global user.name $SAFE_GIT_USER_NAME"
fi

if [[ -n "$GIT_USER_EMAIL" ]]; then
  SAFE_GIT_USER_EMAIL="$(printf "%q" "$GIT_USER_EMAIL")"
  su - ${config.sshUser} -c "git config --global user.email $SAFE_GIT_USER_EMAIL"
fi`

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
