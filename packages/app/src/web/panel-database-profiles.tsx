import type { JSX } from "react"

import { Box, Text } from "../ui/primitives.js"
import { projectDatabaseExternalUrl, type ProjectDatabaseForward, type ProjectDatabaseProfile } from "./api.js"

type DatabaseProfilesListProps = {
  readonly forwards: ReadonlyArray<ProjectDatabaseForward>
  readonly onCloseForward: (profile: ProjectDatabaseProfile) => void
  readonly onDeleteProfile: (profile: ProjectDatabaseProfile) => void
  readonly onExposeProfile: (profile: ProjectDatabaseProfile) => void
  readonly profiles: ReadonlyArray<ProjectDatabaseProfile>
}

const ProfileForwardState = (
  { forward }: { readonly forward: ProjectDatabaseForward | undefined }
): JSX.Element =>
  forward === undefined
    ? (
      <Text fg="#8fa6c4" wrap="wrap">
        External TCP access is closed.
      </Text>
    )
    : (
      <Box flexDirection="column" gap={1}>
        <Text fg="#78f0a3" wrap="truncate">external tcp: {projectDatabaseExternalUrl(forward)}</Text>
        <Text fg="#8fa6c4" wrap="truncate">dsn: {forward.maskedExternalConnectionString}</Text>
        <Text fg={forward.status === "running" ? "#56f39a" : "#ffd166"}>status: {forward.status}</Text>
      </Box>
    )

const ProfileActions = (
  {
    forward,
    onCloseForward,
    onDeleteProfile,
    onExposeProfile,
    profile
  }: {
    readonly forward: ProjectDatabaseForward | undefined
    readonly onCloseForward: (profile: ProjectDatabaseProfile) => void
    readonly onDeleteProfile: (profile: ProjectDatabaseProfile) => void
    readonly onExposeProfile: (profile: ProjectDatabaseProfile) => void
    readonly profile: ProjectDatabaseProfile
  }
): JSX.Element => (
  <Box flexWrap="wrap" gap={1}>
    <Box
      onClick={() => {
        if (forward === undefined) {
          onExposeProfile(profile)
        } else {
          onCloseForward(profile)
        }
      }}
      width="auto"
    >
      <Text bold={true} fg={forward === undefined ? "#78f0a3" : "#ffd166"}>
        {forward === undefined ? "expose tcp" : "close tcp"}
      </Text>
    </Box>
    <Box
      onClick={() => {
        onDeleteProfile(profile)
      }}
      width="auto"
    >
      <Text bold={true} fg="#ff8aa0">delete</Text>
    </Box>
  </Box>
)

const ProfileRow = (
  {
    forward,
    onCloseForward,
    onDeleteProfile,
    onExposeProfile,
    profile
  }: {
    readonly forward: ProjectDatabaseForward | undefined
    readonly onCloseForward: (profile: ProjectDatabaseProfile) => void
    readonly onDeleteProfile: (profile: ProjectDatabaseProfile) => void
    readonly onExposeProfile: (profile: ProjectDatabaseProfile) => void
    readonly profile: ProjectDatabaseProfile
  }
): JSX.Element => (
  <Box border={true} borderColor="#3a4652" flexDirection="column" gap={1} padding={1}>
    <Box alignItems="center" flexWrap="wrap" gap={1} justifyContent="space-between">
      <Text bold={true} fg="#d6e5f7">{profile.label}</Text>
      <Text fg="#8fa6c4">{profile.engine}</Text>
    </Box>
    <Text fg="#8fa6c4" wrap="truncate">
      {profile.user.length === 0 ? "anonymous" : profile.user}@{profile.host}:{profile.port}/{profile.database}
    </Text>
    <Text fg="#8fa6c4" wrap="truncate">{profile.maskedConnectionString}</Text>
    <ProfileForwardState forward={forward} />
    <ProfileActions
      forward={forward}
      onCloseForward={onCloseForward}
      onDeleteProfile={onDeleteProfile}
      onExposeProfile={onExposeProfile}
      profile={profile}
    />
  </Box>
)

export const DatabaseProfilesList = (
  { forwards, onCloseForward, onDeleteProfile, onExposeProfile, profiles }: DatabaseProfilesListProps
): JSX.Element => (
  <Box flexDirection="column" gap={1} marginTop={1}>
    <Text bold={true} fg="#d6e5f7">Saved connections</Text>
    {profiles.length === 0
      ? <Text fg="#8fa6c4">No database profiles yet.</Text>
      : profiles.map((profile) => (
        <ProfileRow
          forward={forwards.find((forward) => forward.profileId === profile.id)}
          key={profile.id}
          onCloseForward={onCloseForward}
          onDeleteProfile={onDeleteProfile}
          onExposeProfile={onExposeProfile}
          profile={profile}
        />
      ))}
  </Box>
)
