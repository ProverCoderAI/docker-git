export type AuthStreamMarkers = {
  readonly success: string
  readonly errorPrefix: string
}

export const codexLoginStreamMarkers: AuthStreamMarkers = {
  success: "__DOCKER_GIT_CODEX_LOGIN_STATUS__:ok",
  errorPrefix: "__DOCKER_GIT_CODEX_LOGIN_STATUS__:error:"
}

export const githubLoginStreamMarkers: AuthStreamMarkers = {
  success: "__DOCKER_GIT_GITHUB_LOGIN_STATUS__:ok",
  errorPrefix: "__DOCKER_GIT_GITHUB_LOGIN_STATUS__:error:"
}

export const isAuthStreamMarkerLine = (line: string, markers: AuthStreamMarkers): boolean =>
  line.startsWith(markers.success) || line.startsWith(markers.errorPrefix)

export const authStreamVisibleLines = (
  output: string,
  markers: AuthStreamMarkers
): ReadonlyArray<string> =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isAuthStreamMarkerLine(line, markers))

export const authStreamMarkerExitCode = (output: string, markers: AuthStreamMarkers): string | null => {
  const failureLine = output
    .split(/\r?\n/u)
    .find((line) => line.startsWith(markers.errorPrefix))

  return failureLine === undefined
    ? null
    : failureLine.slice(markers.errorPrefix.length)
}

export const authStreamSucceeded = (output: string, markers: AuthStreamMarkers): boolean =>
  output.includes(markers.success)

export const githubLoginFailureMessage = (output: string, exitCode: string | null): string => {
  const detailedLine = authStreamVisibleLines(output, githubLoginStreamMarkers)
    .findLast((line) => line.toLowerCase().includes("failed") || line.toLowerCase().includes("error"))
  if (detailedLine !== undefined) {
    return detailedLine
  }

  const lastLine = authStreamVisibleLines(output, githubLoginStreamMarkers).at(-1)
  if (lastLine !== undefined) {
    return lastLine
  }

  return exitCode === null
    ? "GitHub login stream ended without a completion marker."
    : `GitHub login failed (${exitCode}).`
}

export const makeVisibleAuthStreamWriter = (
  markers: AuthStreamMarkers,
  writeVisibleChunk: (chunk: string) => void
) => {
  let pending = ""
  const flushVisiblePending = () => {
    if (pending.length > 0 && !isAuthStreamMarkerLine(pending, markers)) {
      writeVisibleChunk(pending)
    }
    pending = ""
  }

  const writeChunk = (chunk: string) => {
    pending += chunk
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""

    for (const line of lines) {
      if (!isAuthStreamMarkerLine(line, markers)) {
        writeVisibleChunk(`${line}\n`)
      }
    }
  }

  return { flushVisiblePending, writeChunk }
}
