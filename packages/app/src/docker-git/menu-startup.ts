import type { ProjectItem } from "@effect-template/lib/usecases/projects"

export type MenuStartupSnapshot = {
  readonly activeDir: string | null
  readonly runningDockerGitContainers: number
  readonly message: string | null
}

const dockerGitContainerPrefix = "dg-"

const emptySnapshot = (): MenuStartupSnapshot => ({
  activeDir: null,
  runningDockerGitContainers: 0,
  message: null
})

const uniqueDockerGitContainerNames = (
  runningContainerNames: ReadonlyArray<string>
): ReadonlyArray<string> => [
  ...new Set(runningContainerNames.filter((name) => name.startsWith(dockerGitContainerPrefix)))
]

const detectKnownRunningProjects = (
  items: ReadonlyArray<ProjectItem>,
  runningDockerGitNames: ReadonlyArray<string>
): ReadonlyArray<ProjectItem> => {
  const runningSet = new Set(runningDockerGitNames)
  return items.filter((item) => runningSet.has(item.containerName))
}

const renderRunningHint = (runningCount: number): string =>
  runningCount === 1
    ? "Detected 1 running docker-git container."
    : `Detected ${runningCount} running docker-git containers.`

// CHANGE: infer initial menu state from currently running docker-git containers
// WHY: avoid "(none)" confusion when containers are already up outside this TUI session
// QUOTE(ISSUE): "У меня запущены контейнеры от docker-git но он говорит что они не запущены"
// REF: issue-13
// SOURCE: n/a
// FORMAT THEOREM: forall startupState: snapshot(startupState) -> deterministic(menuState)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: activeDir is set only when exactly one known project is running
// COMPLEXITY: O(|containers| + |projects|)
export const resolveMenuStartupSnapshot = (
  items: ReadonlyArray<ProjectItem>,
  runningContainerNames: ReadonlyArray<string>
): MenuStartupSnapshot => {
  const runningDockerGitNames = uniqueDockerGitContainerNames(runningContainerNames)
  if (runningDockerGitNames.length === 0) {
    return emptySnapshot()
  }

  const knownRunningProjects = detectKnownRunningProjects(items, runningDockerGitNames)
  if (knownRunningProjects.length === 1 && runningDockerGitNames.length === 1) {
    const selected = knownRunningProjects[0]
    if (!selected) {
      return emptySnapshot()
    }
    return {
      activeDir: selected.projectDir,
      runningDockerGitContainers: 1,
      message: `Auto-selected active project: ${selected.displayName}.`
    }
  }

  if (knownRunningProjects.length === 0) {
    return {
      activeDir: null,
      runningDockerGitContainers: runningDockerGitNames.length,
      message: `${renderRunningHint(runningDockerGitNames.length)} No matching project config found.`
    }
  }

  return {
    activeDir: null,
    runningDockerGitContainers: runningDockerGitNames.length,
    message: `${renderRunningHint(runningDockerGitNames.length)} Use Select project to choose active.`
  }
}

export const defaultMenuStartupSnapshot = emptySnapshot
