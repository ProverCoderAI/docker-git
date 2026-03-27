// CHANGE: separate project rule preparation by active agent mode
// WHY: Codex, Claude Code, and Gemini CLI each have different native project-level config models
// REF: issue-207
// PURITY: CORE
// INVARIANT: Codex gets a bridge for skills that live outside CODEX_HOME; Claude/Gemini stay on native project-local discovery
// COMPLEXITY: O(1)
const entrypointProjectAgentRulesTemplate = String
  .raw`# Prepare project-local rules using each agent's native conventions.
docker_git_detect_claude_project_rules() {
  local project_dir="${"$"}{TARGET_DIR:-}"

  if [[ -z "$project_dir" || ! -d "$project_dir" ]]; then
    return 0
  fi

  if [[ -f "$project_dir/CLAUDE.md" \
    || -f "$project_dir/.claude/CLAUDE.md" \
    || -f "$project_dir/.claude/settings.json" \
    || -d "$project_dir/.claude/agents" \
    || -f "$project_dir/.mcp.json" ]]; then
    echo "[claude] project-local Claude rules available in $project_dir"
  fi
}

docker_git_detect_gemini_project_rules() {
  local project_dir="${"$"}{TARGET_DIR:-}"

  if [[ -z "$project_dir" || ! -d "$project_dir" ]]; then
    return 0
  fi

  if [[ -f "$project_dir/GEMINI.md" \
    || -f "$project_dir/.gemini/settings.json" \
    || -d "$project_dir/.gemini/commands" \
    || -d "$project_dir/.gemini/skills" \
    || -d "$project_dir/.agents/skills" ]]; then
    echo "[gemini] project-local Gemini rules available in $project_dir"
  fi
}

docker_git_prepare_active_agent_project_rules() {
  case "$AGENT_MODE" in
    "codex")
      docker_git_sync_project_codex_skills
      ;;
    "claude")
      docker_git_detect_claude_project_rules
      ;;
    "gemini")
      docker_git_detect_gemini_project_rules
      ;;
    *)
      docker_git_sync_project_codex_skills
      docker_git_detect_claude_project_rules
      docker_git_detect_gemini_project_rules
      ;;
  esac
}`

export const renderEntrypointProjectAgentRules = (): string => entrypointProjectAgentRulesTemplate
