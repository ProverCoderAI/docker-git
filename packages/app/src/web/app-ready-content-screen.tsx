import type { JSX } from "react"

import type { MainPanelsProps } from "./app-ready-main-panels.js"
import { ScreenFrame, screenPadding } from "./app-ready-screen-frame.js"
import { Box } from "./elements.js"
import { ContentPanel } from "./panel-content.js"

type ContentScreenProps = {
  readonly props: MainPanelsProps
  readonly title: string
}

export const ContentScreen = ({ props, title }: ContentScreenProps): JSX.Element => (
  <ScreenFrame
    hint="Esc back, R refresh"
    onBack={props.onBackScreen}
    title={title}
  >
    <Box
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
      overflowY="auto"
      padding={screenPadding(props.viewportLayout.compact)}
    >
      <ContentPanel
        actionPrompt={props.actionPrompt}
        authSnapshot={props.authSnapshot}
        compact={props.viewportLayout.compact}
        controllerCwd={props.controllerCwd}
        createView={props.createView}
        currentMenu={props.currentMenu}
        githubStatus={props.githubStatus}
        onActionPromptCancel={props.onActionPromptCancel}
        onActionPromptChange={props.onActionPromptChange}
        onActionPromptSubmit={props.onActionPromptSubmit}
        onCreateBufferChange={props.onCreateBufferChange}
        onCreateCancel={props.onCreateCancel}
        onCreateSubmit={props.onCreateSubmit}
        onRunAuthAction={props.onRunAuthAction}
        onRunProjectAuthAction={props.onRunProjectAuthAction}
        project={props.project}
        projectAuthSnapshot={props.projectAuthSnapshot}
        projectNavigationArmed={true}
        projectsRoot={props.projectsRoot}
        selectedProjectSummary={props.selectedProjectSummary}
      />
    </Box>
  </ScreenFrame>
)
