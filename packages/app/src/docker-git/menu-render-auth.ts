import { Box, Text } from "ink"
import React from "react"

import { authMenuLabels, authViewSteps, authViewTitle } from "./menu-auth-data.js"
import {
  renderMenuHelp,
  renderPromptLayout,
  renderSelectableMenuList,
  resolvePromptState
} from "./menu-render-common.js"
import { renderLayout } from "./menu-render-layout.js"
import type { AuthSnapshot, ViewState } from "./menu-types.js"

const renderCountLine = (title: string, count: number): string => `${title}: ${count}`

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
      el(Text, { color: "gray" }, renderCountLine("Entries", snapshot.totalEntries)),
      el(Text, { color: "gray" }, renderCountLine("GitHub tokens", snapshot.githubTokenEntries)),
      el(Text, { color: "gray" }, renderCountLine("Git tokens", snapshot.gitTokenEntries)),
      el(Text, { color: "gray" }, renderCountLine("Git users", snapshot.gitUserEntries)),
      el(Text, { color: "gray" }, renderCountLine("Claude keys", snapshot.claudeKeyEntries)),
      el(Box, { flexDirection: "column", marginTop: 1 }, ...list),
      renderMenuHelp("Use arrows + Enter, or type a number.")
    ],
    message
  )
}

export const renderAuthPrompt = (
  view: Extract<ViewState, { readonly _tag: "AuthPrompt" }>,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const { prompt, visibleBuffer } = resolvePromptState(authViewSteps(view.flow), view.step, view.buffer)
  const helpLine = view.flow === "GithubOauth" ? "Enter = start OAuth, Esc = cancel." : "Enter = next, Esc = cancel."
  return renderPromptLayout({
    title: `docker-git / Auth / ${authViewTitle(view.flow)}`,
    header: [el(Text, { color: "gray" }, `Global env: ${view.snapshot.globalEnvPath}`)],
    prompt,
    visibleBuffer,
    helpLine,
    message
  })
}
