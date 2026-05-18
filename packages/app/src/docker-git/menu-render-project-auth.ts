import React from "react"

import { Box, Text } from "../ui/primitives.js"
import { projectAuthMenuLabels, projectAuthViewSteps } from "./menu-project-auth-data.js"
import {
  renderMenuHelp,
  renderPromptLayout,
  renderSelectableMenuList,
  resolvePromptState
} from "./menu-render-common.js"
import { renderLayout } from "./menu-render-layout.js"
import type { ProjectAuthSnapshot, ViewState } from "./menu-types.js"

const renderActiveLabel = (value: string | null): string => value ?? "(not set)"

const renderCountLine = (title: string, count: number): string => `${title}: ${count}`

export const renderProjectAuthMenu = (
  snapshot: ProjectAuthSnapshot,
  selected: number,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const list = renderSelectableMenuList(projectAuthMenuLabels(), selected)

  return renderLayout(
    "docker-git / Project auth",
    [
      el(Text, null, `Project: ${snapshot.projectName}`),
      el(Text, { fg: "gray" }, `Dir: ${snapshot.projectDir}`),
      el(Text, { fg: "gray" }, `Project env: ${snapshot.envProjectPath}`),
      el(Text, { fg: "gray" }, `Global env: ${snapshot.envGlobalPath}`),
      el(Text, { fg: "gray" }, `Claude auth: ${snapshot.claudeAuthPath}`),
      el(
        Box,
        { marginTop: 1, flexDirection: "column" },
        el(Text, { fg: "gray" }, `GitHub label: ${renderActiveLabel(snapshot.activeGithubLabel)}`),
        el(Text, { fg: "gray" }, renderCountLine("Available GitHub tokens", snapshot.githubTokenEntries)),
        el(Text, { fg: "gray" }, `Git label: ${renderActiveLabel(snapshot.activeGitLabel)}`),
        el(Text, { fg: "gray" }, renderCountLine("Available Git tokens", snapshot.gitTokenEntries)),
        el(Text, { fg: "gray" }, `Claude label: ${renderActiveLabel(snapshot.activeClaudeLabel)}`),
        el(Text, { fg: "gray" }, renderCountLine("Available Claude logins", snapshot.claudeAuthEntries))
      ),
      el(Box, { flexDirection: "column", marginTop: 1 }, ...list),
      renderMenuHelp("Use arrows + Enter, or type a number from the list.")
    ],
    message
  )
}

export const renderProjectAuthPrompt = (
  view: Extract<ViewState, { readonly _tag: "ProjectAuthPrompt" }>,
  message: string | null
): React.ReactElement => {
  const el = React.createElement
  const { prompt, visibleBuffer } = resolvePromptState(projectAuthViewSteps(view.flow), view.step, view.buffer)

  return renderPromptLayout({
    title: "docker-git / Project auth / Set label",
    header: [
      el(Text, { fg: "gray" }, `Project: ${view.snapshot.projectName}`),
      el(Text, { fg: "gray" }, `Project env: ${view.snapshot.envProjectPath}`),
      el(Text, { fg: "gray" }, `Global env: ${view.snapshot.envGlobalPath}`)
    ],
    prompt,
    visibleBuffer,
    helpLine: "Enter = apply, Esc = cancel.",
    message
  })
}
