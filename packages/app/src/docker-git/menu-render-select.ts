import type React from "react"

import type { ProjectItem } from "@lib/usecases/projects"
import { Text } from "../ui/primitives.js"
import { buildSelectDetailsModel, type SelectPurpose } from "./menu-select-presenter.js"
import type { SelectProjectRuntime } from "./menu-types.js"

const computeListWidth = (labels: ReadonlyArray<string>): number => {
  const maxLabelWidth = labels.length > 0 ? Math.max(...labels.map((label) => label.length)) : 24
  return Math.min(Math.max(maxLabelWidth + 2, 28), 54)
}

const readStdoutRows = (): number | null => {
  const rows = process.stdout.rows
  if (typeof rows !== "number" || !Number.isFinite(rows) || rows <= 0) {
    return null
  }
  return rows
}

const computeSelectListMaxRows = (): number => {
  const rows = readStdoutRows()
  if (rows === null) {
    return 12
  }
  return Math.max(6, rows - 14)
}

export const renderSelectDetails = (
  el: typeof React.createElement,
  purpose: SelectPurpose,
  item: ProjectItem | undefined,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>,
  connectEnableMcpPlaywright: boolean
): ReadonlyArray<React.ReactElement> => {
  const runtime = item === undefined
    ? { running: false, sshSessions: 0, startedAtIso: null, startedAtEpochMs: null }
    : (runtimeByProject[item.projectDir] ?? {
      running: false,
      sshSessions: 0,
      startedAtIso: null,
      startedAtEpochMs: null
    })
  const details = buildSelectDetailsModel(purpose, item, runtime, connectEnableMcpPlaywright)
  return [
    el(Text, { fg: "cyan", bold: true, wrap: "truncate" }, details.title),
    ...details.lines.map((line, index) => el(Text, { key: `${details.title}-${index}`, wrap: "wrap" }, line))
  ]
}

export { computeListWidth, computeSelectListMaxRows }

export {
  buildSelectLabels,
  buildSelectListWindow,
  selectHint,
  type SelectPurpose,
  selectTitle
} from "./menu-select-presenter.js"
