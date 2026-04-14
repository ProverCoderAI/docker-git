import type { JSX } from "react"

import type { DashboardData, ProjectSummary } from "./api.js"
import { Box, Text } from "./elements.js"
import { browserMenuItems } from "./menu.js"
import { projectSelectionLabel } from "./panels.js"
import type { ViewportLayout } from "./viewport-layout.js"

type MainMenuScreenProps = {
  readonly dashboard: DashboardData
  readonly onOpenMenuScreen: (index: number) => void
  readonly onSelectMenu: (index: number) => void
  readonly selectedMenuIndex: number
  readonly selectedProjectSummary: ProjectSummary | undefined
  readonly viewportLayout: ViewportLayout
}

const menuGap = (compact: boolean): number | string => compact ? "4px" : 1

const menuPadding = (compact: boolean): number | string => compact ? "8px" : 2

const menuMaxWidth = (compact: boolean): string => compact ? "100%" : "720px"

const MenuStatusLines = (
  {
    dashboard,
    selectedProjectSummary
  }: Pick<MainMenuScreenProps, "dashboard" | "selectedProjectSummary">
): JSX.Element => (
  <Box flexDirection="column" gap="4px">
    <Text fg="#9bd6ff" wrap="truncate">
      selected project: {projectSelectionLabel(selectedProjectSummary)}
    </Text>
    <Text fg="#aab7c4">projects: {dashboard.projects.length}</Text>
  </Box>
)

const MainMenuItem = (
  {
    index,
    onOpenMenuScreen,
    onSelectMenu,
    selectedMenuIndex
  }: Pick<MainMenuScreenProps, "onOpenMenuScreen" | "onSelectMenu" | "selectedMenuIndex"> & {
    readonly index: number
  }
): JSX.Element => {
  const item = browserMenuItems[index]
  const selected = index === selectedMenuIndex
  return (
    <Box
      onClick={() => {
        onSelectMenu(index)
        onOpenMenuScreen(index)
      }}
    >
      <Text bold={selected} fg={selected ? "#78f0a3" : "#f4f7fb"}>
        {selected ? "> " : "  "}
        {index + 1}. {item?.label ?? index + 1}
      </Text>
    </Box>
  )
}

const MainMenuItems = (
  props: Pick<MainMenuScreenProps, "onOpenMenuScreen" | "onSelectMenu" | "selectedMenuIndex">
): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    {browserMenuItems.map((item, index) => (
      <MainMenuItem
        key={item.tag}
        index={index}
        onOpenMenuScreen={props.onOpenMenuScreen}
        onSelectMenu={props.onSelectMenu}
        selectedMenuIndex={props.selectedMenuIndex}
      />
    ))}
  </Box>
)

export const MainMenuScreen = (props: MainMenuScreenProps): JSX.Element => (
  <Box
    flexDirection="column"
    gap={menuGap(props.viewportLayout.compact)}
    maxWidth={menuMaxWidth(props.viewportLayout.compact)}
    overflowY="auto"
    padding={menuPadding(props.viewportLayout.compact)}
    width="100%"
  >
    <MenuStatusLines dashboard={props.dashboard} selectedProjectSummary={props.selectedProjectSummary} />
    <MainMenuItems
      onOpenMenuScreen={props.onOpenMenuScreen}
      onSelectMenu={props.onSelectMenu}
      selectedMenuIndex={props.selectedMenuIndex}
    />
  </Box>
)
