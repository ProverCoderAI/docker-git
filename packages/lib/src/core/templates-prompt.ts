import { renderZshConfig as renderZshConfigTemplate } from "./templates-zsh.js"

// CHANGE: standardize docker-git prompt script for interactive shells
// WHY: keep prompt consistent between Dockerfile and entrypoint
// QUOTE(ТЗ): "Промт должен создаваться нашим docker-git тулой"
// REF: user-request-2026-02-05-restore-prompt
// SOURCE: n/a
// FORMAT THEOREM: forall s in InteractiveShells: prompt(s) -> includes(time, path, branch|empty)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: script is deterministic and does not touch TTY state outside interactive shells
// COMPLEXITY: O(1)
const dockerGitTerminalSanitizeShell = String.raw`docker_git_terminal_write_escape() {
  if [ -c /dev/tty ]; then
    { printf "\033[0m\033[?25h\033[?1l\033>\033[?1000l\033[?1002l\033[?1003l\033[?1005l\033[?1006l\033[?1015l\033[?1007l\033[?1004l\033[?2004l\033[>4;0m\033[>4m\033[<u" > /dev/tty; } 2>/dev/null && return 0
  fi
  if [ -t 1 ]; then
    printf "\033[0m\033[?25h\033[?1l\033>\033[?1000l\033[?1002l\033[?1003l\033[?1005l\033[?1006l\033[?1015l\033[?1007l\033[?1004l\033[?2004l\033[>4;0m\033[>4m\033[<u"
    return 0
  fi
  return 1
}
docker_git_terminal_process_args() {
  ps -o args= -p "$1" 2>/dev/null || true
}
docker_git_terminal_parent_pid() {
  ps -o ppid= -p "$1" 2>/dev/null | tr -d '[:space:]'
}
docker_git_terminal_command_basename() {
  local command_line="$1"
  printf "%s\n" "$command_line" | awk '{ name = $1; sub(/^.*\//, "", name); print name; exit }'
}
docker_git_terminal_is_agent_command() {
  local command_name
  command_name="$(docker_git_terminal_command_basename "$1")"
  case "$command_name" in
    .docker-git-claude-real|claude|codex|opencode|gemini|grok)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}
docker_git_terminal_has_agent_ancestor() {
  local pid="$1"
  local depth=0
  local command_line=""
  local parent_pid=""
  if [ -z "$pid" ]; then
    pid="$$"
  fi
  while [ -n "$pid" ] && [ "$pid" != "0" ] && [ "$depth" -lt 32 ]; do
    command_line="$(docker_git_terminal_process_args "$pid")"
    if docker_git_terminal_is_agent_command "$command_line"; then
      return 0
    fi
    parent_pid="$(docker_git_terminal_parent_pid "$pid")"
    if [ -z "$parent_pid" ] || [ "$parent_pid" = "$pid" ]; then
      return 1
    fi
    pid="$parent_pid"
    depth=$((depth + 1))
  done
  return 1
}
docker_git_terminal_should_sanitize() {
  if [ -n "$(printenv DOCKER_GIT_TERMINAL_FORCE_SANITIZE 2>/dev/null)" ]; then
    return 0
  fi
  if [ -n "$(printenv DOCKER_GIT_TERMINAL_DISABLE_SANITIZE 2>/dev/null)" ]; then
    return 1
  fi
  if docker_git_terminal_has_agent_ancestor "$$"; then
    return 1
  fi
  return 0
}
docker_git_terminal_sanitize() {
  # Recover interactive TTY settings after abrupt exits from fullscreen/raw-mode tools.
  docker_git_terminal_should_sanitize || return 0
  if [ -c /dev/tty ]; then
    { stty sane < /dev/tty > /dev/tty; } 2>/dev/null || { stty sane < /dev/tty; } 2>/dev/null || true
  elif [ -t 0 ]; then
    stty sane 2>/dev/null || true
  fi
  docker_git_terminal_write_escape || true
}`

const dockerGitPromptScript = `${dockerGitTerminalSanitizeShell}
case "$-" in
  *i*) ;;
  *) return 0 2>/dev/null || exit 0 ;;
esac

docker_git_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }
docker_git_short_pwd() {
  local full_path
  full_path="\${PWD:-}"
  if [[ -z "$full_path" ]]; then
    printf "%s" "?"
    return
  fi

  local display="$full_path"
  if [[ -n "\${HOME:-}" && "$full_path" == "$HOME" ]]; then
    display="~"
  elif [[ -n "\${HOME:-}" && "$full_path" == "$HOME/"* ]]; then
    display="~/\${full_path#$HOME/}"
  fi

  if [[ "$display" == "~" || "$display" == "/" ]]; then
    printf "%s" "$display"
    return
  fi

  local prefix=""
  local body="$display"
  if [[ "$body" == "~/"* ]]; then
    prefix="~/"
    body="\${body#~/}"
  elif [[ "$body" == /* ]]; then
    prefix="/"
    body="\${body#/}"
  fi

  local result="$prefix"
  local segment=""
  local rest="$body"
  while [[ "$rest" == */* ]]; do
    segment="\${rest%%/*}"
    rest="\${rest#*/}"
    if [[ -n "$segment" ]]; then
      result+="\${segment:0:1}/"
    fi
  done

  if [[ -n "$rest" ]]; then
    result+="$rest"
  elif [[ "$result" == "~/" ]]; then
    result="~"
  elif [[ -z "$result" ]]; then
    result="/"
  fi

  printf "%s" "$result"
}
docker_git_prompt_apply() {
  docker_git_terminal_sanitize
  local b
  b="$(docker_git_branch)"
  local short_pwd
  short_pwd="$(docker_git_short_pwd)"
  local base="[\\t] $short_pwd"
  if [ -n "$b" ]; then
    PS1="\${base} (\${b})> "
  else
    PS1="\${base}> "
  fi
}
if [ -n "\${PROMPT_COMMAND-}" ]; then
  PROMPT_COMMAND="docker_git_prompt_apply;\${PROMPT_COMMAND}"
else
  PROMPT_COMMAND="docker_git_prompt_apply"
fi
docker_git_terminal_sanitize
trap 'docker_git_terminal_sanitize' EXIT`

export const renderPromptScript = (): string => dockerGitPromptScript

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
export const renderZshConfig = (): string => renderZshConfigTemplate(dockerGitTerminalSanitizeShell)

// CHANGE: add git branch info to interactive shell prompt
// WHY: restore docker-git prompt with time + path + branch
// QUOTE(ТЗ): "Промт должен создаваться нашим docker-git тулой"
// REF: user-request-2026-02-05-restore-prompt
// SOURCE: n/a
// FORMAT THEOREM: forall s in InteractiveShells: prompt(s) -> includes(time, path, branch|empty)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: only interactive shells mutate prompt or TTY state
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
// INVARIANT: /etc/profile.d/zz-prompt.sh is non-empty after entrypoint and inert for non-interactive shells
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
