import type { TemplateConfig } from "../domain.js"

const renderAuthLabelResolution = (): string =>
  String.raw`# 2) Ensure GitHub/GitLab auth vars are available for SSH sessions.
# Prefer a label-selected token (same selection model as clone/create) when present.
GITHUB_AUTH_SKIP="${"${"}GITHUB_AUTH_SKIP:-0}"
RESOLVED_AUTH_LABEL=""
AUTH_LABEL_RAW="${"${"}GIT_AUTH_LABEL:-${"${"}GITHUB_AUTH_LABEL:-${"${"}GITLAB_AUTH_LABEL:-}}}"

if [[ "$GITHUB_AUTH_SKIP" != "1" && -z "$AUTH_LABEL_RAW" && "$REPO_URL" == https://github.com/* ]]; then
  AUTH_LABEL_RAW="$(printf "%s" "$REPO_URL" | sed -E 's#^https://github.com/##; s#[.]git$##; s#/*$##' | cut -d/ -f1)"
fi
if [[ -z "$AUTH_LABEL_RAW" && "$REPO_URL" == https://gitlab.com/* ]]; then
  AUTH_LABEL_RAW="$(printf "%s" "$REPO_URL" | sed -E 's#^https://gitlab.com/##; s#[.]git$##; s#/*$##' | cut -d/ -f1)"
fi

if [[ -n "$AUTH_LABEL_RAW" ]]; then
  RESOLVED_AUTH_LABEL="$(printf "%s" "$AUTH_LABEL_RAW" | tr '[:lower:]' '[:upper:]' | sed -E 's/[^A-Z0-9]+/_/g; s/^_+//; s/_+$//')"
  if [[ "$RESOLVED_AUTH_LABEL" == "DEFAULT" ]]; then
    RESOLVED_AUTH_LABEL=""
  fi
fi`

const renderEffectiveTokenResolution = (): string =>
  String.raw`EFFECTIVE_GITHUB_TOKEN=""
EFFECTIVE_GITLAB_TOKEN=""
if [[ "$GITHUB_AUTH_SKIP" != "1" ]]; then
  EFFECTIVE_GITHUB_TOKEN="$GITHUB_TOKEN"
  if [[ -z "$EFFECTIVE_GITHUB_TOKEN" ]]; then
    EFFECTIVE_GITHUB_TOKEN="$GH_TOKEN"
  fi
  if [[ -z "$EFFECTIVE_GITHUB_TOKEN" ]]; then
    EFFECTIVE_GITHUB_TOKEN="$GIT_AUTH_TOKEN"
  fi
fi

EFFECTIVE_GITLAB_TOKEN="$GITLAB_TOKEN"
if [[ -z "$EFFECTIVE_GITLAB_TOKEN" && "$REPO_URL" == https://gitlab.com/* ]]; then
  EFFECTIVE_GITLAB_TOKEN="$GIT_AUTH_TOKEN"
fi

if [[ -n "$RESOLVED_AUTH_LABEL" ]]; then
  LABELED_GIT_TOKEN_KEY="GIT_AUTH_TOKEN__$RESOLVED_AUTH_LABEL"
  LABELED_GITHUB_TOKEN_KEY="GITHUB_TOKEN__$RESOLVED_AUTH_LABEL"
  LABELED_GH_TOKEN_KEY="GH_TOKEN__$RESOLVED_AUTH_LABEL"
  LABELED_GITLAB_TOKEN_KEY="GITLAB_TOKEN__$RESOLVED_AUTH_LABEL"

  LABELED_GIT_TOKEN="${"${"}!LABELED_GIT_TOKEN_KEY-}"
  LABELED_GITHUB_TOKEN="${"${"}!LABELED_GITHUB_TOKEN_KEY-}"
  LABELED_GH_TOKEN="${"${"}!LABELED_GH_TOKEN_KEY-}"
  LABELED_GITLAB_TOKEN="${"${"}!LABELED_GITLAB_TOKEN_KEY-}"

  if [[ "$REPO_URL" == https://gitlab.com/* ]]; then
    if [[ -n "$LABELED_GIT_TOKEN" ]]; then
      EFFECTIVE_GITLAB_TOKEN="$LABELED_GIT_TOKEN"
    elif [[ -n "$LABELED_GITLAB_TOKEN" ]]; then
      EFFECTIVE_GITLAB_TOKEN="$LABELED_GITLAB_TOKEN"
    fi
  elif [[ "$GITHUB_AUTH_SKIP" != "1" ]]; then
    if [[ -n "$LABELED_GIT_TOKEN" ]]; then
      EFFECTIVE_GITHUB_TOKEN="$LABELED_GIT_TOKEN"
    elif [[ -n "$LABELED_GITHUB_TOKEN" ]]; then
      EFFECTIVE_GITHUB_TOKEN="$LABELED_GITHUB_TOKEN"
    elif [[ -n "$LABELED_GH_TOKEN" ]]; then
      EFFECTIVE_GITHUB_TOKEN="$LABELED_GH_TOKEN"
    fi
  fi
fi`

const renderAuthBridgeFinalize = (config: TemplateConfig): string =>
  String.raw`EFFECTIVE_GH_TOKEN="$EFFECTIVE_GITHUB_TOKEN"
EFFECTIVE_GIT_AUTH_TOKEN="$EFFECTIVE_GITHUB_TOKEN"
if [[ "$REPO_URL" == https://gitlab.com/* ]]; then
  EFFECTIVE_GIT_AUTH_TOKEN="$EFFECTIVE_GITLAB_TOKEN"
fi

if [[ -n "$EFFECTIVE_GH_TOKEN" ]]; then
  printf "export GH_TOKEN=%q\n" "$EFFECTIVE_GH_TOKEN" > /etc/profile.d/gh-token.sh
  printf "export GITHUB_TOKEN=%q\n" "$EFFECTIVE_GITHUB_TOKEN" >> /etc/profile.d/gh-token.sh
  chmod 0644 /etc/profile.d/gh-token.sh
  docker_git_upsert_ssh_env "GH_TOKEN" "$EFFECTIVE_GH_TOKEN"
  docker_git_upsert_ssh_env "GITHUB_TOKEN" "$EFFECTIVE_GITHUB_TOKEN"

  SAFE_GH_TOKEN="$(printf "%q" "$EFFECTIVE_GH_TOKEN")"
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
fi

if [[ -n "$EFFECTIVE_GITLAB_TOKEN" ]]; then
  printf "export GITLAB_TOKEN=%q\n" "$EFFECTIVE_GITLAB_TOKEN" > /etc/profile.d/gitlab-token.sh
  chmod 0644 /etc/profile.d/gitlab-token.sh
  docker_git_upsert_ssh_env "GITLAB_TOKEN" "$EFFECTIVE_GITLAB_TOKEN"
fi

if [[ -n "$EFFECTIVE_GIT_AUTH_TOKEN" ]]; then
  printf "export GIT_AUTH_TOKEN=%q\n" "$EFFECTIVE_GIT_AUTH_TOKEN" > /etc/profile.d/git-auth-token.sh
  chmod 0644 /etc/profile.d/git-auth-token.sh
  docker_git_upsert_ssh_env "GIT_AUTH_TOKEN" "$EFFECTIVE_GIT_AUTH_TOKEN"
fi`

const renderEntrypointAuthEnvBridge = (config: TemplateConfig): string =>
  [
    renderAuthLabelResolution(),
    renderEffectiveTokenResolution(),
    renderAuthBridgeFinalize(config)
  ].join("\n\n")

const renderEntrypointGitCredentialHelper = (config: TemplateConfig): string =>
  String.raw`# 3) Configure git credential helper for HTTPS remotes
GIT_CREDENTIAL_HELPER_PATH="/usr/local/bin/docker-git-credential-helper"
cat <<'EOF' > "$GIT_CREDENTIAL_HELPER_PATH"
#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 || "$1" != "get" ]]; then
  exit 0
fi

protocol=""
host=""
while IFS= read -r line; do
  case "$line" in
    protocol=*) protocol="${"${"}line#protocol=}" ;;
    host=*) host="${"${"}line#host=}" ;;
    "") break ;;
  esac
done

token=""
username="${"${"}GIT_AUTH_USER:-}"
if [[ "$protocol" == "https" && "$host" == "gitlab.com" ]]; then
  token="${"${"}GITLAB_TOKEN:-}"
  if [[ -z "$username" ]]; then
    username="oauth2"
  fi
elif [[ "$protocol" == "https" && "$host" == "github.com" ]]; then
  token="${"${"}GITHUB_TOKEN:-}"
  if [[ -z "$token" ]]; then
    token="${"${"}GH_TOKEN:-}"
  fi
  if [[ -z "$username" ]]; then
    username="x-access-token"
  fi
fi

if [[ -z "$token" ]]; then
  token="${"${"}GIT_AUTH_TOKEN:-}"
fi
if [[ -z "$username" ]]; then
  username="x-access-token"
fi

if [[ -z "$token" ]]; then
  exit 0
fi

printf "%s\n" "username=$username"
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

export { renderEntrypointGitHooks } from "./git-hooks.js"
