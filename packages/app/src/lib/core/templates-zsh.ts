const zshConfigPrefix = `setopt PROMPT_SUBST

# Terminal compatibility: if terminfo for $TERM is missing (common over SSH),
# fall back to xterm-256color so ZLE doesn't garble the display.
if command -v infocmp >/dev/null 2>&1; then
  if ! infocmp "$TERM" >/dev/null 2>&1; then
    export TERM=xterm-256color
  fi
fi
`

const zshConfigSuffix = `
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
docker_git_short_pwd() {
  local full_path="\${PWD:-}"
  if [[ -z "$full_path" ]]; then
    print -r -- "?"
    return
  fi

  local display="$full_path"
  if [[ -n "\${HOME:-}" && "$full_path" == "$HOME" ]]; then
    display="~"
  elif [[ -n "\${HOME:-}" && "$full_path" == "$HOME/"* ]]; then
    display="~/\${full_path#$HOME/}"
  fi

  if [[ "$display" == "~" || "$display" == "/" ]]; then
    print -r -- "$display"
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

  local -a parts
  local result="$prefix"
  parts=(\${(s:/:)body})
  local total=\${#parts[@]}
  local idx=1
  local part=""
  for part in "\${parts[@]}"; do
    if [[ -z "$part" ]]; then
      ((idx++))
      continue
    fi
    if (( idx < total )); then
      result+="\${part[1,1]}/"
    else
      result+="$part"
    fi
    ((idx++))
  done

  if [[ -z "$result" ]]; then
    result="/"
  elif [[ "$result" == "~/" ]]; then
    result="~"
  fi

  print -r -- "$result"
}
docker_git_prompt_apply() {
  docker_git_terminal_sanitize
  local b
  b="$(docker_git_branch)"
  local short_path
  short_path="$(docker_git_short_pwd)"
  local base="[%*] $short_path"
  if [[ -n "$b" ]]; then
    PROMPT="$base ($b)> "
  else
    PROMPT="$base> "
  fi
}
docker_git_terminal_on_exit() {
  docker_git_terminal_sanitize
}
docker_git_terminal_sanitize
add-zsh-hook precmd docker_git_prompt_apply
add-zsh-hook zshexit docker_git_terminal_on_exit

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

if [[ "\${DOCKER_GIT_ZSH_AUTOSUGGEST:-0}" == "1" ]] && [ -f /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
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

export const renderZshConfig = (terminalSanitizeShell: string): string =>
  `${zshConfigPrefix}${terminalSanitizeShell}${zshConfigSuffix}`
