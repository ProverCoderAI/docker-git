import type React from "react"

import { Text } from "../ui/primitives.js"
import { buildSelectDetailsModel, type SelectPurpose } from "./menu-select-presenter.js"
import type { SelectProjectRuntime } from "./menu-types.js"
import type { ProjectItem } from "./project-item.js"

const computeListWidth = (labels: ReadonlyArray<string>): number => {
  const maxLabelWidth = labels.length > 0 ? Math.max(...labels.map((label) => label.length)) : 24
  return Math.min(Math.max(maxLabelWidth + 2, 28), 54)
}

const readStdoutColumns = (): number | null => {
  const columns = process.stdout.columns
  if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0) {
    return null
  }
  return columns
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

export type SelectColumnWidths = {
  readonly detailsWidth: number | null
  readonly listWidth: number
}

export const computeSelectColumnWidths = (labels: ReadonlyArray<string>): SelectColumnWidths => {
  const preferredListWidth = computeListWidth(labels)
  const columns = readStdoutColumns()
  if (columns === null) {
    return { detailsWidth: null, listWidth: preferredListWidth }
  }

  const layoutFrameWidth = 4
  const columnGapWidth = 2
  const minimumListWidth = 12
  const comfortableDetailsWidth = 24
  const innerWidth = Math.max(2, columns - layoutFrameWidth)
  const availableColumns = Math.max(2, innerWidth - columnGapWidth)
  const maxListWidth = Math.max(minimumListWidth, availableColumns - comfortableDetailsWidth)
  const listWidth = Math.max(minimumListWidth, Math.min(preferredListWidth, maxListWidth))
  const detailsWidth = Math.max(1, availableColumns - listWidth)

  return { detailsWidth, listWidth }
}

export const renderSelectDetails = (
  el: typeof React.createElement,
  purpose: SelectPurpose,
  item: ProjectItem | undefined,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>,
  connectEnableMcpPlaywright: boolean,
  detailsWidth: number | null
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
  const widthProps = detailsWidth === null ? {} : { width: detailsWidth }
  return [
    el(Text, { fg: "cyan", bold: true, wrap: "truncate", ...widthProps }, details.title),
    ...details.lines.map((line, index) => el(Text, { key: `${details.title}-${index}`, wrap: "wrap", ...widthProps }, line))
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
