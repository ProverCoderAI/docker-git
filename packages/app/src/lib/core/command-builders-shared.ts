/* jscpd:ignore-start */
import { Either } from "effect"

import {
  type CreateCommand,
  defaultTemplateConfig,
  isDockerNetworkMode,
  isGpuMode,
  isUnixUserName,
  type ParseError,
  sshUserNamePatternDescription
} from "./domain.js"

const parsePort = (value: string): Either.Either<number, ParseError> => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return Either.left({
      _tag: "InvalidOption",
      option: "--ssh-port",
      reason: `expected integer, got: ${value}`
    })
  }
  if (parsed < 1 || parsed > 65_535) {
    return Either.left({
      _tag: "InvalidOption",
      option: "--ssh-port",
      reason: "must be between 1 and 65535"
    })
  }
  return Either.right(parsed)
}

export const parseSshPort = (value: string): Either.Either<number, ParseError> => parsePort(value)

export const parseSshUser = (
  value: string | undefined
): Either.Either<string, ParseError> => {
  const candidate = value?.trim() ?? defaultTemplateConfig.sshUser
  if (candidate.length === 0) {
    return Either.left({
      _tag: "MissingRequiredOption",
      option: "--ssh-user"
    })
  }
  if (!isUnixUserName(candidate)) {
    return Either.left({
      _tag: "InvalidOption",
      option: "--ssh-user",
      reason: `expected Linux user name matching ${sshUserNamePatternDescription}`
    })
  }
  return Either.right(candidate)
}

export const parseDockerNetworkMode = (
  value: string | undefined
): Either.Either<CreateCommand["config"]["dockerNetworkMode"], ParseError> => {
  const candidate = value?.trim() ?? defaultTemplateConfig.dockerNetworkMode
  if (isDockerNetworkMode(candidate)) {
    return Either.right(candidate)
  }
  return Either.left({
    _tag: "InvalidOption",
    option: "--network-mode",
    reason: "expected one of: shared, project"
  })
}

export const parseGpuMode = (
  value: string | undefined
): Either.Either<CreateCommand["config"]["gpu"], ParseError> => {
  const candidate = value?.trim() ?? defaultTemplateConfig.gpu
  if (isGpuMode(candidate)) {
    return Either.right(candidate)
  }
  return Either.left({
    _tag: "InvalidOption",
    option: "--gpu",
    reason: "expected one of: none, all"
  })
}

export const nonEmpty = (
  option: string,
  value: string | undefined,
  fallback?: string
): Either.Either<string, ParseError> => {
  const candidate = value?.trim() ?? fallback
  if (candidate === undefined || candidate.length === 0) {
    return Either.left({
      _tag: "MissingRequiredOption",
      option
    })
  }
  return Either.right(candidate)
}
/* jscpd:ignore-end */
