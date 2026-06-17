import type { JSX } from "react"

import { Box, Text, TextInput } from "../ui/primitives.js"
import {
  projectDatabaseEditorUrl,
  type ProjectDatabaseForward,
  type ProjectDatabaseProfile,
  type ProjectDatabaseSession,
  type ProjectDetails,
  type ProjectSummary
} from "./api.js"
import { didOpenUrl } from "./open-url.js"
import { DatabaseProfilesList } from "./panel-database-profiles.js"

type DatabasePanelProps = {
  readonly connectionInput: string
  readonly labelInput: string
  readonly onConnectionInputChange: (value: string) => void
  readonly onCloseForward: (profile: ProjectDatabaseProfile) => void
  readonly onDeleteProfile: (profile: ProjectDatabaseProfile) => void
  readonly onExposeProfile: (profile: ProjectDatabaseProfile) => void
  readonly onLabelInputChange: (value: string) => void
  readonly onOpenEditor: () => void
  readonly onRefreshDatabases: () => void
  readonly onRestartEditor: () => void
  readonly onSaveProfile: () => void
  readonly profiles: ReadonlyArray<ProjectDatabaseProfile>
  readonly forwards: ReadonlyArray<ProjectDatabaseForward>
  readonly project: ProjectDetails | null
  readonly selectedProjectSummary: ProjectSummary | undefined
  readonly session: ProjectDatabaseSession | null
}

type ConnectionFormProps = Pick<
  DatabasePanelProps,
  | "connectionInput"
  | "labelInput"
  | "onConnectionInputChange"
  | "onLabelInputChange"
  | "onOpenEditor"
  | "onRefreshDatabases"
  | "onRestartEditor"
  | "onSaveProfile"
>

const statusColor = (status: ProjectDatabaseSession["status"]): string => {
  if (status === "running") {
    return "#56f39a"
  }
  if (status === "stopped") {
    return "#ffb86c"
  }
  if (status === "missing") {
    return "#8fa6c4"
  }
  return "#ffd166"
}

const SessionStatus = (
  { session }: Pick<DatabasePanelProps, "session">
): JSX.Element => {
  const editorUrl = session === null ? "" : projectDatabaseEditorUrl(session)
  return (
    <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} marginTop={1} padding={1}>
      <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
        <Text bold={true} fg="#d6e5f7">SQL editor</Text>
        <Text fg={session === null ? "#8fa6c4" : statusColor(session.status)}>
          {session?.status ?? "not loaded"}
        </Text>
      </Box>
      {session === null
        ? <Text fg="#8fa6c4">Refresh to read the DbGate sidecar status.</Text>
        : (
          <>
            <Text fg="#8fa6c4" wrap="truncate">container: {session.containerName}</Text>
            {session.status === "running"
              ? (
                <Box
                  onClick={() => {
                    didOpenUrl(editorUrl)
                  }}
                >
                  <Text fg="#7fdfff" wrap="truncate">{editorUrl}</Text>
                </Box>
              )
              : <Text fg="#8fa6c4">Save a profile, then use open SQL editor to start DbGate.</Text>}
          </>
        )}
    </Box>
  )
}

const ConnectionFormActions = (
  {
    onOpenEditor,
    onRefreshDatabases,
    onRestartEditor,
    onSaveProfile
  }: Pick<ConnectionFormProps, "onOpenEditor" | "onRefreshDatabases" | "onRestartEditor" | "onSaveProfile">
): JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    <Box onClick={onSaveProfile} width="auto">
      <Text bold={true} fg="#78f0a3">save profile</Text>
    </Box>
    <Box onClick={onOpenEditor} width="auto">
      <Text bold={true} fg="#78f0a3">open SQL editor</Text>
    </Box>
    <Box onClick={onRestartEditor} width="auto">
      <Text bold={true} fg="#ffd166">restart editor</Text>
    </Box>
    <Box onClick={onRefreshDatabases} width="auto">
      <Text bold={true} fg="#7fdfff">refresh</Text>
    </Box>
  </Box>
)

const ConnectionForm = (
  {
    connectionInput,
    labelInput,
    onConnectionInputChange,
    onLabelInputChange,
    onOpenEditor,
    onRefreshDatabases,
    onRestartEditor,
    onSaveProfile
  }: ConnectionFormProps
): JSX.Element => (
  <Box flexDirection="column" gap={1} marginTop={1}>
    <Text fg="#d6e5f7">CONNECTION_STRING</Text>
    <TextInput
      ariaLabel="Database connection string"
      onChange={onConnectionInputChange}
      onEnter={() => {
        onSaveProfile()
      }}
      placeholder="postgres://user:password@localhost:5432/app"
      secret={true}
      value={connectionInput}
    />
    <Text fg="#d6e5f7">Label</Text>
    <TextInput
      ariaLabel="Database profile label"
      onChange={onLabelInputChange}
      onEnter={() => {
        onSaveProfile()
      }}
      placeholder="dev postgres"
      value={labelInput}
    />
    <ConnectionFormActions
      onOpenEditor={onOpenEditor}
      onRefreshDatabases={onRefreshDatabases}
      onRestartEditor={onRestartEditor}
      onSaveProfile={onSaveProfile}
    />
  </Box>
)

export const DatabasePanel = (props: DatabasePanelProps): JSX.Element => (
  <Box flexDirection="column">
    <Text bold={true} fg="#8be9fd">Databases</Text>
    <Text fg="#d6e5f7" wrap="wrap">
      Open DbGate for local SQL databases reachable from this project container.
    </Text>
    <Text fg="#8fa6c4" marginTop={1} wrap="wrap">
      External TCP access publishes a host port on the docker-git machine. HTTP tunnel URLs do not carry native database
      protocols.
    </Text>
    <Text fg="#8fa6c4" marginTop={1} wrap="truncate">
      Project: {props.selectedProjectSummary?.displayName ?? "not selected"}
    </Text>
    <Text fg="#8fa6c4" wrap="truncate">
      Container: {props.project?.containerName ?? "load project info first"}
    </Text>
    <Text fg="#ffd166" marginTop={1} wrap="wrap">
      Profiles are stored in the synced docker-git state, including credentials.
    </Text>
    <ConnectionForm
      connectionInput={props.connectionInput}
      labelInput={props.labelInput}
      onConnectionInputChange={props.onConnectionInputChange}
      onLabelInputChange={props.onLabelInputChange}
      onOpenEditor={props.onOpenEditor}
      onRefreshDatabases={props.onRefreshDatabases}
      onRestartEditor={props.onRestartEditor}
      onSaveProfile={props.onSaveProfile}
    />
    <SessionStatus session={props.session} />
    <DatabaseProfilesList
      forwards={props.forwards}
      onCloseForward={props.onCloseForward}
      onDeleteProfile={props.onDeleteProfile}
      onExposeProfile={props.onExposeProfile}
      profiles={props.profiles}
    />
  </Box>
)
