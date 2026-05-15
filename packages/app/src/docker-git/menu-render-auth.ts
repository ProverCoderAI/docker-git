import React from "react"

import { Box, Text } from "../ui/primitives.js"
import { authMenuLabels, authViewSteps, authViewTitle } from "./menu-auth-data.js"
import {
  renderMenuHelp,
  renderPromptLayout,
  renderSelectableMenuList,
  resolvePromptState
} from "./menu-render-common.js"
import { renderLayout } from "./menu-render-layout.js"
import type { AuthSnapshot, ViewState } from "./menu-types.js"

type AuthPromptView = Extract<ViewState, { readonly _tag: "AuthPrompt" }>
type AuthPromptFlow = AuthPromptView["flow"]

const renderCountLine = (title: string, count: number): string => `${title}: ${count}`

const oauthPromptFlows: ReadonlySet<AuthPromptFlow> = new Set([
  "GithubOauth",
  "ClaudeOauth",
  "GeminiOauth",
  "GrokOauth"
])

const claudePromptFlows: ReadonlySet<AuthPromptFlow> = new Set(["ClaudeOauth", "ClaudeLogout"])
const geminiPromptFlows: ReadonlySet<AuthPromptFlow> = new Set(["GeminiOauth", "GeminiApiKey", "GeminiLogout"])
const grokPromptFlows: ReadonlySet<AuthPromptFlow> = new Set(["GrokOauth", "GrokApiKey", "GrokLogout"])

const authPromptHelpLine = (flow: AuthPromptFlow): string => {
  if (oauthPromptFlows.has(flow)) {
    return "Enter = start OAuth, Esc = cancel."
  }
  if (flow === "ClaudeLogout") {
    return "Enter = logout, Esc = cancel."
  }
  return "Enter = next, Esc = cancel."
}

const authPromptHeaderPaths = (view: AuthPromptView): ReadonlyArray<string> => [
  `Global env: ${view.snapshot.globalEnvPath}`,
  ...(claudePromptFlows.has(view.flow) ? [`Claude auth: ${view.snapshot.claudeAuthPath}`] : []),
  ...(geminiPromptFlows.has(view.flow) ? [`Gemini auth: ${view.snapshot.geminiAuthPath}`] : []),
  ...(grokPromptFlows.has(view.flow) ? [`Grok auth: ${view.snapshot.grokAuthPath}`] : [])
]

export const renderAuthMenu = (
  snapshot: AuthSnapshot,
  selected: number,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const list = renderSelectableMenuList(authMenuLabels(), selected)
  return renderLayout(
    "docker-git / Auth profiles",
    [
      el(Text, null, `Global env: ${snapshot.globalEnvPath}`),
      el(Text, null, `Claude auth: ${snapshot.claudeAuthPath}`),
      el(Text, null, `Gemini auth: ${snapshot.geminiAuthPath}`),
      el(Text, null, `Grok auth: ${snapshot.grokAuthPath}`),
      el(Text, { fg: "gray" }, renderCountLine("Entries", snapshot.totalEntries)),
      el(Text, { fg: "gray" }, renderCountLine("GitHub tokens", snapshot.githubTokenEntries)),
      el(Text, { fg: "gray" }, renderCountLine("Git tokens", snapshot.gitTokenEntries)),
      el(Text, { fg: "gray" }, renderCountLine("Git users", snapshot.gitUserEntries)),
      el(Text, { fg: "gray" }, renderCountLine("Claude logins", snapshot.claudeAuthEntries)),
      el(Text, { fg: "gray" }, renderCountLine("Gemini logins", snapshot.geminiAuthEntries)),
      el(Text, { fg: "gray" }, renderCountLine("Grok logins", snapshot.grokAuthEntries)),
      el(Box, { flexDirection: "column", marginTop: 1 }, ...list),
      renderMenuHelp("Use arrows + Enter, or type a number.")
    ],
    message
  )
}

export const renderAuthPrompt = (
  view: AuthPromptView,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const { prompt, visibleBuffer } = resolvePromptState(authViewSteps(view.flow), view.step, view.buffer)
  return renderPromptLayout({
    title: `docker-git / Auth / ${authViewTitle(view.flow)}`,
    header: authPromptHeaderPaths(view).map((line) => el(Text, { fg: "gray" }, line)),
    prompt,
    visibleBuffer,
    helpLine: authPromptHelpLine(view.flow),
    message
  })
}
