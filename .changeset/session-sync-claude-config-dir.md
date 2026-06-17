---
"@prover-coder-ai/docker-git-session-sync": patch
---

Back up Claude Code sessions from the resolved `CLAUDE_CONFIG_DIR` (issue #422).

docker-git points Claude Code at a custom `CLAUDE_CONFIG_DIR`
(`~/.docker-git/.orch/auth/claude/<label>`), so Claude writes chat transcripts to
`$CLAUDE_CONFIG_DIR/projects` instead of `~/.claude/projects`. The session backup
only scanned the home-relative paths, so the `.claude` folder in the
`docker-git-sessions` backup repo stayed empty.

The backup now resolves each session root from its agent environment override
(`CLAUDE_CONFIG_DIR` for Claude, `CODEX_HOME` for Codex) and falls back to the
home-relative directory when the override is unset, keeping the logical
`.claude/projects` / `.codex/sessions` names stable in the backup repo.
