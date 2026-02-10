export const isTruthyEnv = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

export const isFalsyEnv = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off"
}

export const autoSyncEnvKey = "DOCKER_GIT_STATE_AUTO_SYNC"
export const autoSyncStrictEnvKey = "DOCKER_GIT_STATE_AUTO_SYNC_STRICT"

export const defaultSyncMessage = "chore(state): sync"

export const isAutoSyncEnabled = (envValue: string | undefined, hasRemote: boolean): boolean => {
  if (envValue === undefined) {
    return hasRemote
  }
  if (envValue.trim().length === 0) {
    return hasRemote
  }
  if (isFalsyEnv(envValue)) {
    return false
  }
  if (isTruthyEnv(envValue)) {
    return true
  }
  // Non-empty values default to enabled.
  return true
}
