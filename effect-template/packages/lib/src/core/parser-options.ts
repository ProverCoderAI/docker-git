import { Either, Match } from "effect"

import { type ParseError } from "./domain.js"

export interface RawOptions {
  readonly repoUrl?: string
  readonly repoRef?: string
  readonly targetDir?: string
  readonly sshPort?: string
  readonly sshUser?: string
  readonly containerName?: string
  readonly serviceName?: string
  readonly volumeName?: string
  readonly secretsRoot?: string
  readonly authorizedKeysPath?: string
  readonly envGlobalPath?: string
  readonly envProjectPath?: string
  readonly codexAuthPath?: string
  readonly codexHome?: string
  readonly label?: string
  readonly token?: string
  readonly authWeb?: boolean
  readonly outDir?: string
  readonly up?: boolean
  readonly force?: boolean
}

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
    | "outDir"
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
  { flag: "--out-dir", key: "outDir" }
]

const valueOptionSpecByFlag: ReadonlyMap<string, ValueOptionSpec> = new Map(
  valueOptionSpecs.map((spec) => [spec.flag, spec])
)

const booleanFlagUpdaters: Readonly<Record<string, (raw: RawOptions) => RawOptions>> = {
  "--up": (raw) => ({ ...raw, up: true }),
  "--no-up": (raw) => ({ ...raw, up: false }),
  "--force": (raw) => ({ ...raw, force: true }),
  "--web": (raw) => ({ ...raw, authWeb: true })
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

  return Either.right(
    Match.value(valueSpec.key).pipe(
      Match.when("repoUrl", () => ({ ...raw, repoUrl: value })),
      Match.when("repoRef", () => ({ ...raw, repoRef: value })),
      Match.when("targetDir", () => ({ ...raw, targetDir: value })),
      Match.when("sshPort", () => ({ ...raw, sshPort: value })),
      Match.when("sshUser", () => ({ ...raw, sshUser: value })),
      Match.when("containerName", () => ({ ...raw, containerName: value })),
      Match.when("serviceName", () => ({ ...raw, serviceName: value })),
      Match.when("volumeName", () => ({ ...raw, volumeName: value })),
      Match.when("secretsRoot", () => ({ ...raw, secretsRoot: value })),
      Match.when("authorizedKeysPath", () => ({ ...raw, authorizedKeysPath: value })),
      Match.when("envGlobalPath", () => ({ ...raw, envGlobalPath: value })),
      Match.when("envProjectPath", () => ({ ...raw, envProjectPath: value })),
      Match.when("codexAuthPath", () => ({ ...raw, codexAuthPath: value })),
      Match.when("codexHome", () => ({ ...raw, codexHome: value })),
      Match.when("label", () => ({ ...raw, label: value })),
      Match.when("token", () => ({ ...raw, token: value })),
      Match.when("outDir", () => ({ ...raw, outDir: value })),
      Match.exhaustive
    )
  )
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
