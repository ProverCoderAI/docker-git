FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NVM_DIR=/usr/local/nvm

RUN apt-get update && apt-get install -y --no-install-recommends     openssh-server git gh ca-certificates curl unzip bsdutils sudo     make docker.io docker-compose bash-completion zsh zsh-autosuggestions xauth  && rm -rf /var/lib/apt/lists/*

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
autoload -Uz compinit
compinit

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

if [ -f /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=244"
  ZSH_AUTOSUGGEST_STRATEGY=(history completion)
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi
EOF

# Tooling: Node 24 (NodeSource) + nvm
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash -   && apt-get install -y --no-install-recommends nodejs   && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /usr/local/nvm   && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
RUN printf "export NVM_DIR=/usr/local/nvm\n[ -s /usr/local/nvm/nvm.sh ] && . /usr/local/nvm/nvm.sh\n"   > /etc/profile.d/nvm.sh && chmod 0644 /etc/profile.d/nvm.sh

# Tooling: pnpm + Codex CLI (bun)
RUN npm i -g pnpm@10.27.0
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
RUN mkdir -p /provercoderai/effect-template   && chown -R 1000:1000 /home/dev   && if [ "/provercoderai/effect-template" != "/" ]; then chown -R 1000:1000 "/provercoderai/effect-template"; fi

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]