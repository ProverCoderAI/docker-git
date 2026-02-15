FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NVM_DIR=/usr/local/nvm

RUN apt-get update && apt-get install -y --no-install-recommends     openssh-server git gh ca-certificates curl unzip bsdutils sudo     make docker.io docker-compose-v2 bash-completion zsh zsh-autosuggestions xauth     ncurses-term  && rm -rf /var/lib/apt/lists/*

# Passwordless sudo for all users (container is disposable)
RUN printf "%s\n" "ALL ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/zz-all   && chmod 0440 /etc/sudoers.d/zz-all

# Shell prompt: show git branch for interactive sessions
RUN cat <<'EOF' > /etc/profile.d/zz-prompt.sh
docker_git_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }
docker_git_prompt_apply() {
  local b
  b="$(docker_git_branch)"
  local base="[\t] \w"
  if [ -n "$b" ]; then
    PS1="${base} (${b})> "
  else
    PS1="${base}> "
  fi
}
if [ -n "$PROMPT_COMMAND" ]; then
  PROMPT_COMMAND="docker_git_prompt_apply;$PROMPT_COMMAND"
else
  PROMPT_COMMAND="docker_git_prompt_apply"
fi
EOF
RUN chmod 0644 /etc/profile.d/zz-prompt.sh
RUN printf "%s\n" \
  "if [ -f /etc/profile.d/zz-prompt.sh ]; then . /etc/profile.d/zz-prompt.sh; fi" \
  >> /etc/bash.bashrc
RUN cat <<'EOF' > /etc/profile.d/zz-bash-completion.sh
if ! shopt -oq posix; then
  if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
  elif [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
  fi
fi
EOF
RUN chmod 0644 /etc/profile.d/zz-bash-completion.sh
RUN printf "%s\n" \
  "if [ -f /etc/profile.d/zz-bash-completion.sh ]; then . /etc/profile.d/zz-bash-completion.sh; fi" \
  >> /etc/bash.bashrc
RUN cat <<'EOF' > /etc/profile.d/zz-bash-history.sh
if [ -n "$BASH_VERSION" ]; then
  case "$-" in
    *i*)
      HISTFILE="${HISTFILE:-$HOME/.bash_history}"
      HISTSIZE="${HISTSIZE:-10000}"
      HISTFILESIZE="${HISTFILESIZE:-20000}"
      HISTCONTROL="${HISTCONTROL:-ignoredups:erasedups}"
      export HISTFILE HISTSIZE HISTFILESIZE HISTCONTROL
      shopt -s histappend
      if [ -n "${PROMPT_COMMAND-}" ]; then
        PROMPT_COMMAND="history -a; ${PROMPT_COMMAND}"
      else
        PROMPT_COMMAND="history -a"
      fi
      ;;
  esac
fi
EOF
RUN chmod 0644 /etc/profile.d/zz-bash-history.sh
RUN printf "%s\n" \
  "if [ -f /etc/profile.d/zz-bash-history.sh ]; then . /etc/profile.d/zz-bash-history.sh; fi" \
  >> /etc/bash.bashrc
RUN mkdir -p /etc/zsh
RUN cat <<'EOF' > /etc/zsh/zshrc
setopt PROMPT_SUBST

# Terminal compatibility: if terminfo for $TERM is missing (common over SSH),
# fall back to xterm-256color so ZLE doesn't garble the display.
if command -v infocmp >/dev/null 2>&1; then
  if ! infocmp "$TERM" >/dev/null 2>&1; then
    export TERM=xterm-256color
  fi
fi

autoload -Uz compinit
compinit

# Completion UX: cycle matches instead of listing them into scrollback.
setopt AUTO_MENU
setopt MENU_COMPLETE
unsetopt AUTO_LIST
unsetopt LIST_BEEP

# Command completion ordering: prefer real commands/builtins over internal helper functions.
zstyle ':completion:*' tag-order builtins commands aliases reserved-words functions

autoload -Uz add-zsh-hook
docker_git_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }
docker_git_prompt_apply() {
  local b
  b="$(docker_git_branch)"
  local base="[%*] %~"
  if [[ -n "$b" ]]; then
    PROMPT="$base ($b)> "
  else
    PROMPT="$base> "
  fi
}
add-zsh-hook precmd docker_git_prompt_apply

HISTFILE="${HISTFILE:-$HOME/.zsh_history}"
HISTSIZE="${HISTSIZE:-10000}"
SAVEHIST="${SAVEHIST:-20000}"
setopt HIST_IGNORE_ALL_DUPS
setopt SHARE_HISTORY
setopt INC_APPEND_HISTORY

if [ -f "$HISTFILE" ]; then
  fc -R "$HISTFILE" 2>/dev/null || true
fi
if [ -f "$HOME/.bash_history" ] && [ "$HISTFILE" != "$HOME/.bash_history" ]; then
  fc -R "$HOME/.bash_history" 2>/dev/null || true
fi

bindkey '^[[A' history-search-backward
bindkey '^[[B' history-search-forward

if [[ "${DOCKER_GIT_ZSH_AUTOSUGGEST:-1}" == "1" ]] && [ -f /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
  # Suggest from history first, then fall back to completion (commands + paths).
  # This gives "ghost text" suggestions without needing to press <Tab>.
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="${DOCKER_GIT_ZSH_AUTOSUGGEST_STYLE:-fg=8,italic}"
  if [[ -n "${DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY-}" ]]; then
    ZSH_AUTOSUGGEST_STRATEGY=(${=DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY})
  else
    ZSH_AUTOSUGGEST_STRATEGY=(history completion)
  fi
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi
EOF

# Tooling: Node 24 (NodeSource) + nvm
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash -   && apt-get install -y --no-install-recommends nodejs   && node -v   && npm -v   && corepack --version   && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /usr/local/nvm   && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
RUN printf "export NVM_DIR=/usr/local/nvm\n[ -s /usr/local/nvm/nvm.sh ] && . /usr/local/nvm/nvm.sh\n"   > /etc/profile.d/nvm.sh && chmod 0644 /etc/profile.d/nvm.sh

# Tooling: pnpm + Codex CLI (bun)
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
ENV BUN_INSTALL=/usr/local/bun
ENV TERM=xterm-256color
ENV PATH="/usr/local/bun/bin:$PATH"
RUN curl -fsSL https://bun.sh/install | bash
RUN ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
RUN script -q -e -c "bun add -g @openai/codex@latest" /dev/null
RUN ln -sf /usr/local/bun/bin/codex /usr/local/bin/codex
RUN printf "export BUN_INSTALL=/usr/local/bun\nexport PATH=/usr/local/bun/bin:$PATH\n"   > /etc/profile.d/bun.sh && chmod 0644 /etc/profile.d/bun.sh

# Create non-root user for SSH (align UID/GID with host user 1000)
RUN if id -u ubuntu >/dev/null 2>&1; then       if getent group 1000 >/dev/null 2>&1; then         EXISTING_GROUP="$(getent group 1000 | cut -d: -f1)";         if [ "$EXISTING_GROUP" != "dev" ]; then groupmod -n dev "$EXISTING_GROUP" || true; fi;       fi;       usermod -l dev -d /home/dev -m -s /usr/bin/zsh ubuntu || true;     fi
RUN if id -u dev >/dev/null 2>&1; then       usermod -u 1000 -g 1000 -o dev;     else       groupadd -g 1000 dev || true;       useradd -m -s /usr/bin/zsh -u 1000 -g 1000 -o dev;     fi
RUN printf "%s\n" "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev   && chmod 0440 /etc/sudoers.d/dev

# sshd runtime dir
RUN mkdir -p /run/sshd

# Harden sshd: disable password auth and root login
RUN printf "%s\n"   "PasswordAuthentication no"   "PermitRootLogin no"   "PubkeyAuthentication yes"   "X11Forwarding yes"   "X11UseLocalhost yes"   "PermitUserEnvironment yes"   "AllowUsers dev"   > /etc/ssh/sshd_config.d/dev.conf

# Workspace path (supports root-level dirs like /repo)
RUN mkdir -p /home/dev/octocat/hello-world/issue-1   && chown -R 1000:1000 /home/dev   && if [ "/home/dev/octocat/hello-world/issue-1" != "/" ]; then chown -R 1000:1000 "/home/dev/octocat/hello-world/issue-1"; fi

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]