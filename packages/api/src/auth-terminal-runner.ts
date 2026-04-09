import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { authClaudeLogin, authGeminiLoginOauth } from "@effect-template/lib"
import { Effect, Match } from "effect"

type AuthTerminalRunnerFlow = "ClaudeOauth" | "GeminiOauth"

const parseFlow = (value: string | undefined): AuthTerminalRunnerFlow =>
  value === "ClaudeOauth" || value === "GeminiOauth" ? value : "ClaudeOauth"

const parseLabel = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length === 0 ? null : trimmed
}

const flow = parseFlow(process.argv[2])
const label = parseLabel(process.argv[3])

const program = Match.value(flow).pipe(
  Match.when("ClaudeOauth", () =>
    authClaudeLogin({
      _tag: "AuthClaudeLogin",
      label,
      claudeAuthPath: ".docker-git/.orch/auth/claude"
    })),
  Match.when("GeminiOauth", () =>
    authGeminiLoginOauth({
      _tag: "AuthGeminiLogin",
      label,
      geminiAuthPath: ".docker-git/.orch/auth/gemini",
      isWeb: false
    })),
  Match.exhaustive
)

NodeRuntime.runMain(program.pipe(Effect.provide(NodeContext.layer)))
