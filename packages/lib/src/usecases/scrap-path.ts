import { Either } from "effect"

import { ScrapTargetDirUnsupportedError } from "../shell/errors.js"

const normalizeContainerPath = (value: string): string => value.replaceAll("\\", "/").trim()

export const expandContainerHome = (sshUser: string, value: string): string => {
  if (value === "~") {
    return `/home/${sshUser}`
  }
  if (value.startsWith("~/")) {
    return `/home/${sshUser}${value.slice(1)}`
  }
  return value
}

const trimTrailingPosixSlashes = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") {
    end -= 1
  }
  return value.slice(0, end)
}

const hasParentTraversalSegment = (value: string): boolean => value.split("/").includes("..")

const unsupportedTargetDir = (
  sshUser: string,
  targetDir: string,
  reason: string
): ScrapTargetDirUnsupportedError => new ScrapTargetDirUnsupportedError({ sshUser, targetDir, reason })

export const deriveScrapWorkspaceRelativePath = (
  sshUser: string,
  targetDir: string
): Either.Either<string, ScrapTargetDirUnsupportedError> => {
  const normalizedTarget = trimTrailingPosixSlashes(
    normalizeContainerPath(expandContainerHome(sshUser, targetDir))
  )
  const normalizedHome = trimTrailingPosixSlashes(`/home/${sshUser}`)

  if (hasParentTraversalSegment(normalizedTarget)) {
    return Either.left(unsupportedTargetDir(sshUser, targetDir, "targetDir must not contain '..' path segments"))
  }

  if (normalizedTarget === normalizedHome) {
    return Either.right("")
  }

  const prefix = `${normalizedHome}/`
  if (!normalizedTarget.startsWith(prefix)) {
    return Either.left(unsupportedTargetDir(sshUser, targetDir, `targetDir must be under ${normalizedHome}`))
  }

  const relative = normalizedTarget
    .slice(prefix.length)
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/")

  if (relative.length === 0) {
    return Either.right("")
  }

  if (hasParentTraversalSegment(relative)) {
    return Either.left(unsupportedTargetDir(sshUser, targetDir, "targetDir must not contain '..' path segments"))
  }

  return Either.right(relative)
}
