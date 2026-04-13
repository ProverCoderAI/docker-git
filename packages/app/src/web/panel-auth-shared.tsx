import type { ActionPromptState } from "./action-prompt.js"

export type ActionPromptPanelProps = {
  readonly actionPrompt: ActionPromptState
  readonly onActionPromptCancel: () => void
  readonly onActionPromptChange: (key: string, value: string) => void
  readonly onActionPromptSubmit: () => void
}

export { ActionLine, ActionPromptPanel, SnapshotLine } from "../ui/shared.js"
