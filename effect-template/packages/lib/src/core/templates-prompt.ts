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
  >> /etc/bash.bashrc`

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
