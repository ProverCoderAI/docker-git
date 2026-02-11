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
    | "label"
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
  { flag: "--label", key: "label" },
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
  "--force": (raw) => ({ ...raw, force: true }),
  "--force-env": (raw) => ({ ...raw, forceEnv: true }),
  "--mcp-playwright": (raw) => ({ ...raw, enableMcpPlaywright: true }),
  "--no-mcp-playwright": (raw) => ({ ...raw, enableMcpPlaywright: false }),
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
  label: (raw, value) => ({ ...raw, label: value }),
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

export const parseRawOptions = (args: ReadonlyArray<string>): Either.Either<RawOptions, ParseError> => {
  let index = 0
  let raw: RawOptions = {}

  while (index < args.length) {
    const token = args[index] ?? ""
    const booleanApplied = applyCommandBooleanFlag(raw, token)
    if (booleanApplied !== null) {
      raw = booleanApplied
      index += 1
      continue
    }

    if (!token.startsWith("-")) {
      return Either.left({ _tag: "UnexpectedArgument", value: token })
    }

    const value = args[index + 1]
    if (value === undefined) {
      return Either.left({ _tag: "MissingOptionValue", option: token })
    }

    const nextRaw = applyCommandValueFlag(raw, token, value)
    if (Either.isLeft(nextRaw)) {
      return Either.left(nextRaw.left)
    }
    raw = nextRaw.right
    index += 2
  }

  return Either.right(raw)
}

export { type RawOptions } from "@effect-template/lib/core/command-options"
