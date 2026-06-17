import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { AuthSnapshot, GithubAuthStatus, ProjectAuthSnapshot, ProjectDetails, ProjectSummary } from "./api.js"
import type { CreateSubmitMode } from "./app-ready-create.js"
import type { BrowserMenuTag } from "./menu.js"

export type ContentPanelProps = {
  readonly actionPrompt: ActionPromptState | null
  readonly authSnapshot: AuthSnapshot | null
  readonly compact: boolean
  readonly controllerCwd: string
  readonly dashboardRefreshTick: number
  readonly projectsRoot: string
  readonly creationView: CreateFlowView
  readonly currentMenu: BrowserMenuTag
  readonly githubStatus: GithubAuthStatus | null
  readonly onActionPromptCancel: () => void
  readonly onActionPromptChange: (key: string, value: string) => void
  readonly onActionPromptSubmit: () => void
  readonly onAttachProjectTerminalSession: (
    projectId: string,
    projectKey: string,
    projectDisplayName: string,
    sessionId: string
  ) => void
  readonly onCreateBufferChange: (buffer: string) => void
  readonly onCreateCancel: () => void
  readonly onCreateSubmit: (mode: CreateSubmitMode) => void
  readonly onKillProjectTerminalSession: (projectId: string, projectKey: string, sessionId: string) => void
  readonly onOpenProjectTerminalById: (projectId: string, projectKey?: string) => void
  readonly onRunAuthAction: (index: number) => void
  readonly onRunProjectAuthAction: (index: number) => void
  readonly project: ProjectDetails | null
  readonly projectNavigationArmed: boolean
  readonly projectAuthSnapshot: ProjectAuthSnapshot | null
  readonly selectedProjectSummary: ProjectSummary | undefined
}
