import {
  dockerGitClaudeOauthTokenEnvKey,
  readClaudeOauthTokenFromEnv
} from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"

// CHANGE: read the Docker Git Claude OAuth token only at the shell boundary
// WHY: usecases and shared runners should receive decoded boundary values explicitly
// QUOTE(ТЗ): "Исправь CI/CD и все правки от Rabbit Coder."
// REF: PR-440-CodeRabbit-env-boundary
// SOURCE: n/a
// FORMAT THEOREM: forall env: token(env) = Some(t) -> process_token() = Some(t)
// PURITY: SHELL
// EFFECT: reads process.env
// INVARIANT: only a normalized non-empty DOCKER_GIT_CLAUDE_OAUTH_TOKEN crosses into the login flow
// COMPLEXITY: O(1)
export const readDockerGitClaudeOauthTokenFromProcessEnv = (): string | null =>
  readClaudeOauthTokenFromEnv(process.env, [dockerGitClaudeOauthTokenEnvKey])
