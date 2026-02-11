// CHANGE: standardize docker-git prompt script for interactive shells
// WHY: keep prompt consistent between Dockerfile and entrypoint
// QUOTE(ТЗ): "Промт должен создаваться нашим docker-git тулой"
// REF: user-request-2026-02-05-restore-prompt
// SOURCE: n/a
// FORMAT THEOREM: forall s in InteractiveShells: prompt(s) -> includes(time, path, branch|empty)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: script is deterministic
// COMPLEXITY: O(1)
export const renderPromptScript = (): string =>
  `docker_git_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }
docker_git_prompt_apply() {
  local b
  b="$(docker_git_branch)"
  local base="[\\t] \\w"
  if [ -n "$b" ]; then
    PS1="\${base} (\${b})> "
  else
    PS1="\${base}> "
  fi
}
if [ -n "$PROMPT_COMMAND" ]; then
  PROMPT_COMMAND="docker_git_prompt_apply;$PROMPT_COMMAND"
else
  PROMPT_COMMAND="docker_git_prompt_apply"
fi`

// CHANGE: enable bash completion for interactive shells
// WHY: allow tab completion for CLI tools in SSH terminals
// QUOTE(ТЗ): "А почему у меня не работает автодополенние в терминале?"
// REF: user-request-2026-02-05-bash-completion
// SOURCE: n/a
// FORMAT THEOREM: forall s in InteractiveShells: completion(s) -> enabled(s)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: only runs when bash completion files exist
// COMPLEXITY: O(1)
export const renderBashCompletionScript = (): string =>
  `if ! shopt -oq posix; then
  if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
  elif [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
  fi
fi`

// CHANGE: enable bash history persistence and prefix search
// WHY: keep command history between sessions and allow prefix-based navigation
// QUOTE(ТЗ): "Он не помнит прошлый вывод команд"
// REF: user-request-2026-02-05-bash-history
// SOURCE: n/a
// FORMAT THEOREM: forall s in InteractiveShells: history(s) -> persisted(s)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: PROMPT_COMMAND preserves existing prompt logic
// COMPLEXITY: O(1)
export const renderBashHistoryScript = (): string =>
  `if [ -n "$BASH_VERSION" ]; then
  case "$-" in
    *i*)
      HISTFILE="\${HISTFILE:-$HOME/.bash_history}"
      HISTSIZE="\${HISTSIZE:-10000}"
      HISTFILESIZE="\${HISTFILESIZE:-20000}"
      HISTCONTROL="\${HISTCONTROL:-ignoredups:erasedups}"
      export HISTFILE HISTSIZE HISTFILESIZE HISTCONTROL
      shopt -s histappend
      if [ -n "\${PROMPT_COMMAND-}" ]; then
        PROMPT_COMMAND="history -a; \${PROMPT_COMMAND}"
      else
        PROMPT_COMMAND="history -a"
      fi
      ;;
  esac
fi`

// CHANGE: add readline bindings for prefix history search
// WHY: allow up/down arrows to search history by current prefix
// QUOTE(ТЗ): "если я писал cd ... то он должен запомнить и когда я напишу cd он мне предложит"
// REF: user-request-2026-02-05-inputrc
// SOURCE: n/a
// FORMAT THEOREM: forall p: prefix(p) -> history_search(p)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: does not override user inputrc when already present
// COMPLEXITY: O(1)
export const renderInputRc = (): string =>
  String.raw`set show-all-if-ambiguous on
set completion-ignore-case on
"\e[A": history-search-backward
"\e[B": history-search-forward`

// CHANGE: configure zsh with autosuggestions, history search, and non-noisy completion UX
// WHY: avoid dumping completion candidates into the terminal scrollback on ambiguous prefixes
// QUOTE(ТЗ): "пусть будет zzh если он сделате то что я хочу" | "Почему при наборе текста он пишет в моём терминале какую-то билиберду?"
// REF: user-request-2026-02-05-zsh-autosuggest | user-request-2026-02-10-zsh-completion-noise
// SOURCE: n/a
// FORMAT THEOREM: forall s in ZshInteractive: autosuggest(s) -> enabled(s) ∧ completion(s) -> non_noisy(s)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: zsh config does not depend on user dotfiles
// COMPLEXITY: O(1)
const dockerGitZshConfig = `setopt PROMPT_SUBST

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

HISTFILE="\${HISTFILE:-$HOME/.zsh_history}"
HISTSIZE="\${HISTSIZE:-10000}"
SAVEHIST="\${SAVEHIST:-20000}"
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

if [[ "\${DOCKER_GIT_ZSH_AUTOSUGGEST:-1}" == "1" ]] && [ -f /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
  # Suggest from history first, then fall back to completion (commands + paths).
  # This gives "ghost text" suggestions without needing to press <Tab>.
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="\${DOCKER_GIT_ZSH_AUTOSUGGEST_STYLE:-fg=8,italic}"
  if [[ -n "\${DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY-}" ]]; then
    ZSH_AUTOSUGGEST_STRATEGY=(\${=DOCKER_GIT_ZSH_AUTOSUGGEST_STRATEGY})
  else
    ZSH_AUTOSUGGEST_STRATEGY=(history completion)
  fi
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi`

export const renderZshConfig = (): string => dockerGitZshConfig

// CHANGE: add git branch info to interactive shell prompt
// WHY: restore docker-git prompt with time + path + branch
// QUOTE(ТЗ): "Промт должен создаваться нашим docker-git тулой"
// REF: user-request-2026-02-05-restore-prompt
// SOURCE: n/a
// FORMAT THEOREM: forall s in InteractiveShells: prompt(s) -> includes(time, path, branch|empty)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: only interactive shells source /etc/profile.d/zz-prompt.sh
// COMPLEXITY: O(1)
export const renderDockerfilePrompt = (): string =>
  String.raw`# Shell prompt: show git branch for interactive sessions
RUN cat <<'EOF' > /etc/profile.d/zz-prompt.sh
${renderPromptScript()}
EOF
RUN chmod 0644 /etc/profile.d/zz-prompt.sh
RUN printf "%s\n" \
  "if [ -f /etc/profile.d/zz-prompt.sh ]; then . /etc/profile.d/zz-prompt.sh; fi" \
  >> /etc/bash.bashrc
RUN cat <<'EOF' > /etc/profile.d/zz-bash-completion.sh
${renderBashCompletionScript()}
EOF
RUN chmod 0644 /etc/profile.d/zz-bash-completion.sh
RUN printf "%s\n" \
  "if [ -f /etc/profile.d/zz-bash-completion.sh ]; then . /etc/profile.d/zz-bash-completion.sh; fi" \
  >> /etc/bash.bashrc
RUN cat <<'EOF' > /etc/profile.d/zz-bash-history.sh
${renderBashHistoryScript()}
EOF
RUN chmod 0644 /etc/profile.d/zz-bash-history.sh
RUN printf "%s\n" \
  "if [ -f /etc/profile.d/zz-bash-history.sh ]; then . /etc/profile.d/zz-bash-history.sh; fi" \
  >> /etc/bash.bashrc
RUN mkdir -p /etc/zsh
RUN cat <<'EOF' > /etc/zsh/zshrc
${renderZshConfig()}
EOF`

// CHANGE: ensure the docker-git prompt is always available at runtime
// WHY: --force rebuilds can reuse cached layers that left an empty prompt file
// QUOTE(ТЗ): "Промт должен создаваться нашим docker-git тулой"
// REF: user-request-2026-02-05-restore-prompt
// SOURCE: n/a
// FORMAT THEOREM: forall s in InteractiveShells: prompt(s) -> includes(time, path, branch|empty)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: /etc/profile.d/zz-prompt.sh is non-empty after entrypoint
// COMPLEXITY: O(1)
export const renderEntrypointPrompt = (): string =>
  String.raw`# Ensure docker-git prompt is configured for interactive shells
PROMPT_PATH="/etc/profile.d/zz-prompt.sh"
if [[ ! -s "$PROMPT_PATH" ]]; then
  cat <<'EOF' > "$PROMPT_PATH"
${renderPromptScript()}
EOF
  chmod 0644 "$PROMPT_PATH"
fi
if ! grep -q "zz-prompt.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-prompt.sh ]; then . /etc/profile.d/zz-prompt.sh; fi" >> /etc/bash.bashrc
fi`

export const renderEntrypointBashCompletion = (): string =>
  String.raw`# Ensure bash completion is configured for interactive shells
COMPLETION_PATH="/etc/profile.d/zz-bash-completion.sh"
if [[ ! -s "$COMPLETION_PATH" ]]; then
  cat <<'EOF' > "$COMPLETION_PATH"
${renderBashCompletionScript()}
EOF
  chmod 0644 "$COMPLETION_PATH"
fi
if ! grep -q "zz-bash-completion.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-bash-completion.sh ]; then . /etc/profile.d/zz-bash-completion.sh; fi" >> /etc/bash.bashrc
fi`

export const renderEntrypointBashHistory = (): string =>
  String.raw`# Ensure bash history is configured for interactive shells
HISTORY_PATH="/etc/profile.d/zz-bash-history.sh"
if [[ ! -s "$HISTORY_PATH" ]]; then
  cat <<'EOF' > "$HISTORY_PATH"
${renderBashHistoryScript()}
EOF
  chmod 0644 "$HISTORY_PATH"
fi
if ! grep -q "zz-bash-history.sh" /etc/bash.bashrc 2>/dev/null; then
  printf "%s\n" "if [ -f /etc/profile.d/zz-bash-history.sh ]; then . /etc/profile.d/zz-bash-history.sh; fi" >> /etc/bash.bashrc
fi`

export const renderEntrypointZshConfig = (): string =>
  String.raw`# Ensure zsh config exists for autosuggestions
ZSHRC_PATH="/etc/zsh/zshrc"
if [[ ! -s "$ZSHRC_PATH" ]]; then
  mkdir -p /etc/zsh
  cat <<'EOF' > "$ZSHRC_PATH"
${renderZshConfig()}
EOF
fi`
