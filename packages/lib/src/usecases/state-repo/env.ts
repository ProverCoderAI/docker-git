export const isTruthyEnv = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

export const isFalsyEnv = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off"
}

export const autoPullEnvKey = "DOCKER_GIT_STATE_AUTO_PULL"
export const autoSyncEnvKey = "DOCKER_GIT_STATE_AUTO_SYNC"
export const autoSyncStrictEnvKey = "DOCKER_GIT_STATE_AUTO_SYNC_STRICT"

export const defaultSyncMessage = "chore(state): sync"

// CHANGE: extract shared predicate for env-controlled feature flags with remote fallback
// WHY: both auto-pull and auto-sync use the same opt-in/opt-out logic; avoid lint duplication warning
// QUOTE(ТЗ): "Сделать что бы когда вызывается команда docker-git то происходит git pull для .docker-git папки"
// REF: issue-178
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returns true when remote exists and env var is not explicitly disabled
// COMPLEXITY: O(1)
const isFeatureEnabled = (envValue: string | undefined, hasRemote: boolean): boolean => {
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

export const isAutoPullEnabled = (envValue: string | undefined, hasRemote: boolean): boolean =>
  isFeatureEnabled(envValue, hasRemote)

export const isAutoSyncEnabled = (envValue: string | undefined, hasRemote: boolean): boolean =>
  isFeatureEnabled(envValue, hasRemote)
