import { Either } from "effect"

import {
  type CreateCommand,
  defaultTemplateConfig,
  isDockerNetworkMode,
  isGpuMode,
  isUnixUsername,
  type ParseError,
  sshUsernamePatternDescription
} from "./domain.js"

const parsePort = (value: string): Either.Either<number, ParseError> => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
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

const isAsciiLetterCode = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122)

const isPathSeparator = (value: string | undefined): boolean => value === "/" || value === "\\"

const rootPathLength = (value: string): number => {
  if (isPathSeparator(value.at(0))) {
    return 1
  }
  if (
    value.length >= 3 &&
    isAsciiLetterCode(value.codePointAt(0) ?? 0) &&
    value.at(1) === ":" &&
    isPathSeparator(value.at(2))
  ) {
    return 3
  }
  return 0
}

/**
 * Removes redundant trailing path separators while preserving filesystem roots.
 *
 * @param value - Path text decoded from CLI/config input.
 * @returns The input without trailing `/` or `\\` separators unless the input is a root path.
 * @pure true
 * @effect none; CORE helper only scans the provided string.
 * @invariant roots `/`, `\\`, `C:\\`, and `C:/` remain non-empty root paths.
 * @precondition value is a string and may be empty or contain mixed separators.
 * @postcondition non-root results do not end with `/` or `\\`; root results are preserved.
 * @complexity O(n) time / O(1) space where n = |value|.
 */
export const trimTrailingPathSeparators = (value: string): string => {
  let end = value.length
  const minEnd = rootPathLength(value)
  while (end > minEnd && isPathSeparator(value[end - 1])) {
    end -= 1
  }
  return value.slice(0, end)
}

/**
 * Expands POSIX home shorthand for paths inside the generated project container.
 *
 * @param sshUser - Validated container user name.
 * @param value - Raw target path candidate.
 * @returns The path with `~` expanded to `/home/${sshUser}`.
 * @pure true
 * @effect none; CORE helper only transforms provided strings.
 * @invariant result is a deterministic function of `(sshUser, value)`.
 * @precondition sshUser was validated by parseSshUser.
 * @postcondition `~` and `~/x` no longer contain home shorthand.
 * @complexity O(n) time / O(n) space where n = |value|.
 */
export const expandContainerHome = (sshUser: string, value: string): string => {
  if (value === "~") {
    return `/home/${sshUser}`
  }
  if (value.startsWith("~/")) {
    return `/home/${sshUser}${value.slice(1)}`
  }
  return value
}

/**
 * Parses a raw SSH port value into the valid Docker host-port range.
 *
 * @param value - Raw textual value for `--ssh-port`.
 * @returns Either a valid integer port or a typed parse error for `--ssh-port`.
 * @pure true
 * @effect none; CORE parser only evaluates the provided string.
 * @invariant Right(port) implies Number.isInteger(port) and 1 <= port <= 65535.
 * @precondition value is untrusted CLI or config text.
 * @postcondition the function returns a typed Either and never throws.
 * @complexity O(1) time / O(1) space.
 */
export const parseSshPort = (value: string): Either.Either<number, ParseError> => parsePort(value)

/**
 * Parses and validates the SSH user used by generated Dockerfiles and entrypoints.
 *
 * @param value - Optional raw value for `--ssh-user`; undefined falls back to the default template user.
 * @returns Either a Linux user name matching the docker-git invariant or a typed parse error.
 * @pure true
 * @effect none; CORE parser only trims and validates the candidate string.
 * @invariant Right(user) implies user matches ^[a-z_][a-z0-9_-]{0,31}$.
 * @precondition value is untrusted CLI or config text.
 * @postcondition empty candidates fail as MissingRequiredOption; unsafe candidates fail as InvalidOption.
 * @complexity O(n) time / O(1) space where n = |value|.
 */
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
  if (!isUnixUsername(candidate)) {
    return Either.left({
      _tag: "InvalidOption",
      option: "--ssh-user",
      reason: `expected Linux user name matching ${sshUsernamePatternDescription}`
    })
  }
  return Either.right(candidate)
}

/**
 * Parses the Docker network mode selector used by generated compose files.
 *
 * @param value - Optional raw value for `--network-mode`; undefined falls back to the template default.
 * @returns Either a supported network mode or a typed parse error for `--network-mode`.
 * @pure true
 * @effect none; CORE parser only trims and checks a finite domain.
 * @invariant Right(mode) implies mode is either "shared" or "project".
 * @precondition value is untrusted CLI or config text.
 * @postcondition unsupported modes fail as InvalidOption.
 * @complexity O(n) time / O(1) space where n = |value|.
 */
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

/**
 * Parses the GPU mode selector used by generated compose files.
 *
 * @param value - Optional raw value for `--gpu`; undefined falls back to the template default.
 * @returns Either a supported GPU mode or a typed parse error for `--gpu`.
 * @pure true
 * @effect none; CORE parser only trims and checks a finite domain.
 * @invariant Right(mode) implies mode is either "none" or "all".
 * @precondition value is untrusted CLI or config text.
 * @postcondition unsupported modes fail as InvalidOption.
 * @complexity O(n) time / O(1) space where n = |value|.
 */
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

/**
 * Parses a required non-empty string option with an optional fallback.
 *
 * @param option - CLI option name reported in typed parse errors.
 * @param value - Optional raw value supplied by the user.
 * @param fallback - Optional default used when value is undefined.
 * @returns Either the trimmed non-empty candidate or a typed missing-option error.
 * @pure true
 * @effect none; CORE parser only trims and checks string length.
 * @invariant Right(candidate) implies candidate.length > 0.
 * @precondition option names the boundary field being decoded.
 * @postcondition missing or empty candidates fail as MissingRequiredOption.
 * @complexity O(n) time / O(1) space where n = |value|.
 */
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
