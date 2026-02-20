import { Either } from "effect"

import type { RawOptions } from "@effect-template/lib/core/command-options"
import type { ParseError } from "@effect-template/lib/core/domain"

interface ValueOptionSpec {
  readonly flag: string
  readonly key:
    | "repoUrl"
    | "repoRef"
    | "targetDir"
    | "sshPort"
    | "sshUser"
    | "containerName"
    | "serviceName"
    | "volumeName"
    | "secretsRoot"
    | "authorizedKeysPath"
    | "envGlobalPath"
    | "envProjectPath"
    | "codexAuthPath"
    | "codexHome"
    | "dockerNetworkMode"
    | "dockerSharedNetworkName"
    | "archivePath"
    | "scrapMode"
    | "label"
    | "gitTokenLabel"
    | "codexTokenLabel"
    | "claudeTokenLabel"
    | "token"
    | "scopes"
    | "message"
    | "outDir"
    | "projectDir"
    | "lines"
}

const valueOptionSpecs: ReadonlyArray<ValueOptionSpec> = [
  { flag: "--repo-url", key: "repoUrl" },
  { flag: "--repo-ref", key: "repoRef" },
  { flag: "--branch", key: "repoRef" },
  { flag: "-b", key: "repoRef" },
  { flag: "--target-dir", key: "targetDir" },
  { flag: "--ssh-port", key: "sshPort" },
  { flag: "--ssh-user", key: "sshUser" },
  { flag: "--container-name", key: "containerName" },
  { flag: "--service-name", key: "serviceName" },
  { flag: "--volume-name", key: "volumeName" },
  { flag: "--secrets-root", key: "secretsRoot" },
  { flag: "--authorized-keys", key: "authorizedKeysPath" },
  { flag: "--env-global", key: "envGlobalPath" },
  { flag: "--env-project", key: "envProjectPath" },
  { flag: "--codex-auth", key: "codexAuthPath" },
  { flag: "--codex-home", key: "codexHome" },
  { flag: "--network-mode", key: "dockerNetworkMode" },
  { flag: "--shared-network", key: "dockerSharedNetworkName" },
  { flag: "--archive", key: "archivePath" },
  { flag: "--mode", key: "scrapMode" },
  { flag: "--label", key: "label" },
  { flag: "--git-token", key: "gitTokenLabel" },
  { flag: "--codex-token", key: "codexTokenLabel" },
  { flag: "--claude-token", key: "claudeTokenLabel" },
  { flag: "--token", key: "token" },
  { flag: "--scopes", key: "scopes" },
  { flag: "--message", key: "message" },
  { flag: "-m", key: "message" },
  { flag: "--out-dir", key: "outDir" },
  { flag: "--project-dir", key: "projectDir" },
  { flag: "--lines", key: "lines" }
]

const valueOptionSpecByFlag: ReadonlyMap<string, ValueOptionSpec> = new Map(
  valueOptionSpecs.map((spec) => [spec.flag, spec])
)

type ValueKey = ValueOptionSpec["key"]

const booleanFlagUpdaters: Readonly<Record<string, (raw: RawOptions) => RawOptions>> = {
  "--up": (raw) => ({ ...raw, up: true }),
  "--no-up": (raw) => ({ ...raw, up: false }),
  "--ssh": (raw) => ({ ...raw, openSsh: true }),
  "--no-ssh": (raw) => ({ ...raw, openSsh: false }),
  "--force": (raw) => ({ ...raw, force: true }),
  "--force-env": (raw) => ({ ...raw, forceEnv: true }),
  "--mcp-playwright": (raw) => ({ ...raw, enableMcpPlaywright: true }),
  "--no-mcp-playwright": (raw) => ({ ...raw, enableMcpPlaywright: false }),
  "--wipe": (raw) => ({ ...raw, wipe: true }),
  "--no-wipe": (raw) => ({ ...raw, wipe: false }),
  "--web": (raw) => ({ ...raw, authWeb: true }),
  "--include-default": (raw) => ({ ...raw, includeDefault: true })
}

const valueFlagUpdaters: { readonly [K in ValueKey]: (raw: RawOptions, value: string) => RawOptions } = {
  repoUrl: (raw, value) => ({ ...raw, repoUrl: value }),
  repoRef: (raw, value) => ({ ...raw, repoRef: value }),
  targetDir: (raw, value) => ({ ...raw, targetDir: value }),
  sshPort: (raw, value) => ({ ...raw, sshPort: value }),
  sshUser: (raw, value) => ({ ...raw, sshUser: value }),
  containerName: (raw, value) => ({ ...raw, containerName: value }),
  serviceName: (raw, value) => ({ ...raw, serviceName: value }),
  volumeName: (raw, value) => ({ ...raw, volumeName: value }),
  secretsRoot: (raw, value) => ({ ...raw, secretsRoot: value }),
  authorizedKeysPath: (raw, value) => ({ ...raw, authorizedKeysPath: value }),
  envGlobalPath: (raw, value) => ({ ...raw, envGlobalPath: value }),
  envProjectPath: (raw, value) => ({ ...raw, envProjectPath: value }),
  codexAuthPath: (raw, value) => ({ ...raw, codexAuthPath: value }),
  codexHome: (raw, value) => ({ ...raw, codexHome: value }),
  dockerNetworkMode: (raw, value) => ({ ...raw, dockerNetworkMode: value }),
  dockerSharedNetworkName: (raw, value) => ({ ...raw, dockerSharedNetworkName: value }),
  archivePath: (raw, value) => ({ ...raw, archivePath: value }),
  scrapMode: (raw, value) => ({ ...raw, scrapMode: value }),
  label: (raw, value) => ({ ...raw, label: value }),
  gitTokenLabel: (raw, value) => ({ ...raw, gitTokenLabel: value }),
  codexTokenLabel: (raw, value) => ({ ...raw, codexTokenLabel: value }),
  claudeTokenLabel: (raw, value) => ({ ...raw, claudeTokenLabel: value }),
  token: (raw, value) => ({ ...raw, token: value }),
  scopes: (raw, value) => ({ ...raw, scopes: value }),
  message: (raw, value) => ({ ...raw, message: value }),
  outDir: (raw, value) => ({ ...raw, outDir: value }),
  projectDir: (raw, value) => ({ ...raw, projectDir: value }),
  lines: (raw, value) => ({ ...raw, lines: value })
}

export const applyCommandBooleanFlag = (raw: RawOptions, token: string): RawOptions | null => {
  const updater = booleanFlagUpdaters[token]
  return updater ? updater(raw) : null
}

export const applyCommandValueFlag = (
  raw: RawOptions,
  token: string,
  value: string
): Either.Either<RawOptions, ParseError> => {
  const valueSpec = valueOptionSpecByFlag.get(token)
  if (valueSpec === undefined) {
    return Either.left({ _tag: "UnknownOption", option: token })
  }

  const update = valueFlagUpdaters[valueSpec.key]
  return Either.right(update(raw, value))
}

type ParseRawOptionsStep =
  | { readonly _tag: "ok"; readonly raw: RawOptions; readonly nextIndex: number }
  | { readonly _tag: "error"; readonly error: ParseError }

const parseInlineValueToken = (
  raw: RawOptions,
  token: string
): Either.Either<RawOptions, ParseError> | null => {
  const equalIndex = token.indexOf("=")
  if (equalIndex <= 0 || !token.startsWith("-")) {
    return null
  }

  const flag = token.slice(0, equalIndex)
  const inlineValue = token.slice(equalIndex + 1)
  return applyCommandValueFlag(raw, flag, inlineValue)
}

const parseRawOptionsStep = (
  args: ReadonlyArray<string>,
  index: number,
  raw: RawOptions
): ParseRawOptionsStep => {
  const token = args[index] ?? ""
  const inlineApplied = parseInlineValueToken(raw, token)
  if (inlineApplied !== null) {
    return Either.isLeft(inlineApplied)
      ? { _tag: "error", error: inlineApplied.left }
      : { _tag: "ok", raw: inlineApplied.right, nextIndex: index + 1 }
  }

  const booleanApplied = applyCommandBooleanFlag(raw, token)
  if (booleanApplied !== null) {
    return { _tag: "ok", raw: booleanApplied, nextIndex: index + 1 }
  }

  if (!token.startsWith("-")) {
    return { _tag: "error", error: { _tag: "UnexpectedArgument", value: token } }
  }

  const value = args[index + 1]
  if (value === undefined) {
    return { _tag: "error", error: { _tag: "MissingOptionValue", option: token } }
  }

  const nextRaw = applyCommandValueFlag(raw, token, value)
  return Either.isLeft(nextRaw)
    ? { _tag: "error", error: nextRaw.left }
    : { _tag: "ok", raw: nextRaw.right, nextIndex: index + 2 }
}

export const parseRawOptions = (args: ReadonlyArray<string>): Either.Either<RawOptions, ParseError> => {
  let index = 0
  let raw: RawOptions = {}

  while (index < args.length) {
    const step = parseRawOptionsStep(args, index, raw)
    if (step._tag === "error") {
      return Either.left(step.error)
    }
    raw = step.raw
    index = step.nextIndex
  }

  return Either.right(raw)
}

export { type RawOptions } from "@effect-template/lib/core/command-options"
