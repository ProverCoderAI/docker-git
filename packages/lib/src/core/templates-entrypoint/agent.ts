import { Match } from "effect"
import type { TemplateConfig } from "../domain.js"

type AgentMode = "claude" | "codex" | "gemini"

const indentBlock = (block: string, size = 2): string => {
  const prefix = " ".repeat(size)

  return block
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n")
}

const renderAgentPrompt = (): string =>
  String.raw`AGENT_PROMPT=""
ISSUE_NUM=""
if [[ "$REPO_REF" =~ ^issue-([0-9]+)$ ]]; then
  ISSUE_NUM="${"${"}BASH_REMATCH[1]}"
fi

if [[ "$AGENT_AUTO" == "1" ]]; then
  if [[ -n "$ISSUE_NUM" ]]; then
    AGENT_PROMPT="Read GitHub issue #$ISSUE_NUM for this repository (use gh issue view $ISSUE_NUM). Implement the requested changes, commit them, create a PR that closes #$ISSUE_NUM, and push it."
  else
    AGENT_PROMPT="Analyze this repository, implement any pending tasks, commit changes, create a PR, and push it."
  fi
fi`

const renderAgentSetup = (): string =>
  [
    String.raw`AGENT_DONE_PATH="/run/docker-git/agent.done"
AGENT_FAIL_PATH="/run/docker-git/agent.failed"
AGENT_PROMPT_FILE="/run/docker-git/agent-prompt.txt"
rm -f "$AGENT_DONE_PATH" "$AGENT_FAIL_PATH" "$AGENT_PROMPT_FILE"`,
    String.raw`# Collect tokens for agent environment (su - dev does not always inherit profile.d)
AGENT_ENV_FILE="/run/docker-git/agent-env.sh"
{
  [[ -f /etc/profile.d/gh-token.sh ]] && cat /etc/profile.d/gh-token.sh
  [[ -f /etc/profile.d/claude-config.sh ]] && cat /etc/profile.d/claude-config.sh
  [[ -f /etc/profile.d/gemini-config.sh ]] && cat /etc/profile.d/gemini-config.sh
} > "$AGENT_ENV_FILE" 2>/dev/null || true
chmod 644 "$AGENT_ENV_FILE"`,
    renderAgentPrompt(),
    String.raw`AGENT_OK=0
if [[ -n "$AGENT_PROMPT" ]]; then
  printf "%s" "$AGENT_PROMPT" > "$AGENT_PROMPT_FILE"
  chmod 644 "$AGENT_PROMPT_FILE"
fi`
  ].join("\n\n")

const renderAgentPromptCommand = (mode: AgentMode): string =>
  Match.value(mode).pipe(
    Match.when("claude", () => String.raw`claude --dangerously-skip-permissions -p \"\$(cat \"$AGENT_PROMPT_FILE\")\"`),
    Match.when("codex", () => String.raw`codex exec \"\$(cat \"$AGENT_PROMPT_FILE\")\"`),
    Match.when("gemini", () => String.raw`gemini --approval-mode=yolo \"\$(cat \"$AGENT_PROMPT_FILE\")\"`),
    Match.exhaustive
  )

const renderAgentAutoLaunchCommand = (
  config: TemplateConfig,
  mode: AgentMode
): string =>
  String
    .raw`su - ${config.sshUser} -s /bin/bash -c "bash -lc '. /etc/profile 2>/dev/null || true; . \"$AGENT_ENV_FILE\" 2>/dev/null || true; cd \"$TARGET_DIR\" && ${
    renderAgentPromptCommand(mode)
  }'"`

const renderAgentModeBlock = (
  config: TemplateConfig,
  mode: AgentMode
): string => {
  const startMessage = `[agent] starting ${mode}...`
  const interactiveMessage = `[agent] ${mode} started in interactive mode (use SSH to connect)`

  return String.raw`"${mode}")
  echo "${startMessage}"
  if [[ -n "$AGENT_PROMPT" ]]; then
    if ${renderAgentAutoLaunchCommand(config, mode)}; then
      AGENT_OK=1
    fi
  else
    echo "${interactiveMessage}"
    AGENT_OK=1
  fi
  ;;`
}

const renderAgentModeCase = (config: TemplateConfig): string =>
  [
    String.raw`case "$AGENT_MODE" in`,
    indentBlock(renderAgentModeBlock(config, "claude")),
    indentBlock(renderAgentModeBlock(config, "codex")),
    indentBlock(renderAgentModeBlock(config, "gemini")),
    indentBlock(
      String.raw`*)
  echo "[agent] unknown agent mode: $AGENT_MODE"
  ;;`
    ),
    "esac"
  ].join("\n")

const renderAgentIssueComment = (config: TemplateConfig): string =>
  String.raw`echo "[agent] posting review comment to issue #$ISSUE_NUM..."

PR_BODY=""
PR_BODY=$(su - ${config.sshUser} -c ". /run/docker-git/agent-env.sh 2>/dev/null; cd '$TARGET_DIR' && gh pr list --head '$REPO_REF' --json body --jq '.[0].body'" 2>/dev/null) || true

if [[ -z "$PR_BODY" ]]; then
  PR_BODY=$(su - ${config.sshUser} -c ". /run/docker-git/agent-env.sh 2>/dev/null; cd '$TARGET_DIR' && git log --format='%B' -1" 2>/dev/null) || true
fi

if [[ -n "$PR_BODY" ]]; then
  COMMENT_FILE="/run/docker-git/agent-comment.txt"
  printf "%s" "$PR_BODY" > "$COMMENT_FILE"
  chmod 644 "$COMMENT_FILE"
  su - ${config.sshUser} -c ". /run/docker-git/agent-env.sh 2>/dev/null; cd '$TARGET_DIR' && gh issue comment '$ISSUE_NUM' --body-file '$COMMENT_FILE'" || echo "[agent] failed to comment on issue #$ISSUE_NUM"
else
  echo "[agent] no PR body or commit message found, skipping comment"
fi`

const renderProjectMoveScript = (): string =>
  String.raw`#!/bin/bash
. /run/docker-git/agent-env.sh 2>/dev/null || true
cd "$1" || exit 1
ISSUE_NUM="$2"

ISSUE_NODE_ID=$(gh issue view "$ISSUE_NUM" --json id --jq '.id' 2>/dev/null) || true
if [[ -z "$ISSUE_NODE_ID" ]]; then
  echo "[agent] could not get issue node ID, skipping move"
  exit 0
fi

GQL_QUERY='query($nodeId: ID!) { node(id: $nodeId) { ... on Issue { projectItems(first: 1) { nodes { id project { id field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } } } } } }'
ALL_IDS=$(gh api graphql -F nodeId="$ISSUE_NODE_ID" -f query="$GQL_QUERY" \
  --jq '(.data.node.projectItems.nodes // [])[0] // empty | [.id, .project.id, .project.field.id, ([.project.field.options[] | select(.name | test("review"; "i"))][0].id)] | @tsv' 2>/dev/null) || true

if [[ -z "$ALL_IDS" ]]; then
  echo "[agent] issue #$ISSUE_NUM is not in a project board, skipping move"
  exit 0
fi

ITEM_ID=$(printf "%s" "$ALL_IDS" | cut -f1)
PROJECT_ID=$(printf "%s" "$ALL_IDS" | cut -f2)
STATUS_FIELD_ID=$(printf "%s" "$ALL_IDS" | cut -f3)
REVIEW_OPTION_ID=$(printf "%s" "$ALL_IDS" | cut -f4)
if [[ -z "$STATUS_FIELD_ID" || -z "$REVIEW_OPTION_ID" || "$STATUS_FIELD_ID" == "null" || "$REVIEW_OPTION_ID" == "null" ]]; then
  echo "[agent] review status not found in project board, skipping move"
  exit 0
fi

MUTATION='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }'
MOVE_RESULT=$(gh api graphql \
  -F projectId="$PROJECT_ID" \
  -F itemId="$ITEM_ID" \
  -F fieldId="$STATUS_FIELD_ID" \
  -F optionId="$REVIEW_OPTION_ID" \
  -f query="$MUTATION" 2>&1) || true

if [[ "$MOVE_RESULT" == *"projectV2Item"* ]]; then
  echo "[agent] issue #$ISSUE_NUM moved to review"
else
  echo "[agent] failed to move issue #$ISSUE_NUM in project board"
fi`

const renderAgentIssueMove = (config: TemplateConfig): string =>
  [
    String.raw`echo "[agent] moving issue #$ISSUE_NUM to review..."
MOVE_SCRIPT="/run/docker-git/project-move.sh"`,
    String.raw`cat > "$MOVE_SCRIPT" << 'EOFMOVE'
${renderProjectMoveScript()}
EOFMOVE`,
    String.raw`chmod +x "$MOVE_SCRIPT"
su - ${config.sshUser} -c "$MOVE_SCRIPT '$TARGET_DIR' '$ISSUE_NUM'" || true`
  ].join("\n")

const renderAgentIssueReview = (config: TemplateConfig): string =>
  [
    String.raw`if [[ "$AGENT_OK" -eq 1 && "$AGENT_AUTO" == "1" && -n "$ISSUE_NUM" ]]; then`,
    indentBlock(renderAgentIssueComment(config)),
    "",
    renderAgentIssueMove(config),
    "fi"
  ].join("\n")

const renderAgentFinalize = (): string =>
  String.raw`if [[ "$AGENT_OK" -eq 1 ]]; then
  echo "[agent] done"
  touch "$AGENT_DONE_PATH"
else
  echo "[agent] failed"
  touch "$AGENT_FAIL_PATH"
fi`

export const renderAgentLaunch = (config: TemplateConfig): string =>
  [
    String.raw`# 3) Auto-launch agent if AGENT_MODE is set
if [[ "$CLONE_OK" -eq 1 && -n "$AGENT_MODE" ]]; then`,
    indentBlock(renderAgentSetup()),
    "",
    indentBlock(renderAgentModeCase(config)),
    "",
    renderAgentIssueReview(config),
    "",
    indentBlock(renderAgentFinalize()),
    "fi"
  ].join("\n")
