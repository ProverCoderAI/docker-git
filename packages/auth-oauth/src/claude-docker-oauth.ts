import { chmod, mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

import {
  claudeOauthTokenFileMode,
  claudeOauthTokenPath,
  classifyClaudeSetupTokenResult,
  extractClaudeOauthToken,
  flushClaudeOauthTokenRedactionState,
  formatClaudeOauthTokenFile,
  initialClaudeOauthTokenRedactionState,
  redactClaudeOauthTokenChunk,
  type ClaudeOauthTokenRedactionState
} from "./claude-oauth-token.js"

export const defaultClaudeDockerOauthImage = "docker-git-auth-claude:latest"
export const defaultClaudeDockerOauthContainerHome = "/claude-home"
const claudeDockerOauthProbeConfigDir = "/tmp/docker-git-claude-probe"
export const claudeDockerOauthBaseImage =
  "node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc"
export const claudeDockerOauthClaudeCodeVersion = "2.1.195"

export type ClaudeDockerOauthOptions = {
  readonly cwd?: string
  readonly accountPath?: string
  readonly dockerHostPath?: string
  readonly image?: string
  readonly containerPath?: string
  readonly dockerCommand?: string
  readonly skipBuild?: boolean
  readonly keepAccountPath?: boolean
  readonly printToken?: boolean
  readonly redactLiveOutput?: boolean
  readonly runBuild?: (spec: ClaudeDockerBuildSpec) => Promise<number>
  readonly runSetupToken?: (spec: ClaudeDockerSetupTokenSpec) => Promise<ClaudeDockerSetupTokenRunResult>
  readonly runProbe?: (spec: ClaudeDockerProbeSpec) => Promise<number>
}

export type ClaudeDockerBuildSpec = {
  readonly dockerCommand: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
}

export type ClaudeDockerSetupTokenSpec = {
  readonly dockerCommand: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly redactLiveOutput: boolean
}

export type ClaudeDockerProbeSpec = {
  readonly dockerCommand: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
}

export type ClaudeDockerSetupTokenRunResult = {
  readonly exitCode: number
  readonly token: string | null
}

export type ClaudeDockerOauthResult =
  | {
    readonly _tag: "ClaudeDockerOauthTokenCaptured"
    readonly token: string
    readonly accountPath: string
    readonly image: string
    readonly exitCode: number
    readonly probeStatus: ClaudeDockerProbeStatus
  }
  | {
    readonly _tag: "ClaudeDockerOauthCommandFailed"
    readonly accountPath: string
    readonly image: string
    readonly exitCode: number
  }
  | {
    readonly _tag: "ClaudeDockerOauthTokenMissing"
    readonly accountPath: string
    readonly image: string
  }

export type ClaudeDockerProbeStatus =
  | { readonly _tag: "ClaudeDockerProbeSucceeded"; readonly exitCode: 0 }
  | { readonly _tag: "ClaudeDockerProbeFailed"; readonly exitCode: number }

const outputWindowSize = 262_144

export const renderClaudeDockerOauthDockerfile = (): string =>
  String.raw`FROM ${claudeDockerOauthBaseImage}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates bsdutils \
  && rm -rf /var/lib/apt/lists/*
RUN node -v \
  && npm -v \
  && npm install -g --no-audit --no-fund @anthropic-ai/claude-code@${claudeDockerOauthClaudeCodeVersion} \
  && claude --version
ENTRYPOINT ["claude"]
`

const appendOutputWindow = (outputWindow: string, chunk: string): string => {
  const next = `${outputWindow}${chunk}`
  return next.length > outputWindowSize ? next.slice(-outputWindowSize) : next
}

const resolveDefaultDockerUser = (): string | null => {
  const getUid = Reflect.get(process, "getuid")
  const getGid = Reflect.get(process, "getgid")
  if (typeof getUid !== "function" || typeof getGid !== "function") {
    return null
  }
  const uid = getUid.call(process)
  const gid = getGid.call(process)
  return typeof uid === "number" && typeof gid === "number" ? `${uid}:${gid}` : null
}

const buildDockerBindMountArg = (hostPath: string, containerPath: string): string =>
  `type=bind,source=${hostPath},target=${containerPath}`

const runDockerBuildInherited = (spec: ClaudeDockerBuildSpec): Promise<number> =>
  new Promise((resolveExitCode, reject) => {
    const child = spawn(spec.dockerCommand, [...spec.args], { cwd: spec.cwd, stdio: "inherit" })
    child.on("error", reject)
    child.on("close", (code) => {
      resolveExitCode(code ?? 1)
    })
  })

const ensureClaudeDockerImage = async (
  dockerCommand: string,
  image: string,
  cwd: string,
  skipBuild: boolean,
  runBuild: (spec: ClaudeDockerBuildSpec) => Promise<number>
): Promise<void> => {
  if (skipBuild) {
    return
  }
  const contextPath = await mkdtemp(join(tmpdir(), "docker-git-auth-oauth-image-"))
  try {
    await writeFile(join(contextPath, "Dockerfile"), renderClaudeDockerOauthDockerfile(), "utf8")
    const exitCode = await runBuild({
      dockerCommand,
      args: ["build", "-t", image, contextPath],
      cwd
    })
    if (exitCode !== 0) {
      throw new Error(`docker build failed with exit=${exitCode}`)
    }
  } finally {
    await rm(contextPath, { recursive: true, force: true })
  }
}

const buildDockerSetupTokenArgs = (
  image: string,
  hostPath: string,
  containerPath: string
): ReadonlyArray<string> => {
  const args: Array<string> = [
    "run",
    "--rm",
    "-i",
    "-t",
    "--mount",
    buildDockerBindMountArg(hostPath, containerPath)
  ]
  const dockerUser = resolveDefaultDockerUser()
  if (dockerUser !== null) {
    args.push("--user", dockerUser)
  }
  args.push(
    "-e",
    `CLAUDE_CONFIG_DIR=${containerPath}`,
    "-e",
    `HOME=${containerPath}`,
    "-e",
    "BROWSER=echo",
    image,
    "setup-token"
  )
  return args
}

// CHANGE: probe captured OAuth tokens without reading persisted account settings
// WHY: account settings may enable bypassPermissions for real sessions, but Claude rejects that mode in privileged probe contexts
// QUOTE(ТЗ): "почему не работает команда bun run docker-git auth claude login"
// REF: user-report-2026-07-01-claude-auth-login
// SOURCE: n/a
// FORMAT THEOREM: forall token: probe(token) uses env(token) and not account(settings.json)
// PURITY: CORE
// INVARIANT: setup-token validation cannot fail because of account permission settings
// COMPLEXITY: O(1)
const buildDockerProbeArgs = (
  image: string,
  hostPath: string,
  containerPath: string,
  oauthToken: string
): ReadonlyArray<string> => {
  const args: Array<string> = [
    "run",
    "--rm",
    "-i",
    "--mount",
    buildDockerBindMountArg(hostPath, containerPath)
  ]
  const dockerUser = resolveDefaultDockerUser()
  if (dockerUser !== null) {
    args.push("--user", dockerUser)
  }
  args.push(
    "-e",
    `CLAUDE_CONFIG_DIR=${claudeDockerOauthProbeConfigDir}`,
    "-e",
    `HOME=${claudeDockerOauthProbeConfigDir}`,
    "-e",
    `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`,
    image,
    "-p",
    "ping"
  )
  return args
}

const runDockerSetupToken = (spec: ClaudeDockerSetupTokenSpec): Promise<ClaudeDockerSetupTokenRunResult> =>
  new Promise((resolveResult, reject) => {
    const child = spawn(spec.dockerCommand, [...spec.args], {
      cwd: spec.cwd,
      stdio: ["inherit", "pipe", "pipe"]
    })
    const decoder = new TextDecoder("utf-8")
    let outputWindow = ""
    let token: string | null = null
    let stdoutRedactionState: ClaudeOauthTokenRedactionState = initialClaudeOauthTokenRedactionState
    let stderrRedactionState: ClaudeOauthTokenRedactionState = initialClaudeOauthTokenRedactionState

    const writeOutput = (fd: 1 | 2, output: string): void => {
      if (output.length === 0) {
        return
      }
      if (fd === 2) {
        process.stderr.write(output)
        return
      }
      process.stdout.write(output)
    }

    const capture = (chunk: Uint8Array, fd: 1 | 2): void => {
      const text = decoder.decode(chunk)
      outputWindow = appendOutputWindow(outputWindow, text)
      token = token ?? extractClaudeOauthToken(outputWindow)
      if (!spec.redactLiveOutput) {
        writeOutput(fd, text)
        return
      }
      const state = fd === 2 ? stderrRedactionState : stdoutRedactionState
      const redacted = redactClaudeOauthTokenChunk(state, text)
      if (fd === 2) {
        stderrRedactionState = redacted.state
      } else {
        stdoutRedactionState = redacted.state
      }
      writeOutput(fd, redacted.output)
    }

    child.stdout?.on("data", (chunk: Uint8Array) => {
      capture(chunk, 1)
    })
    child.stderr?.on("data", (chunk: Uint8Array) => {
      capture(chunk, 2)
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (spec.redactLiveOutput) {
        writeOutput(1, flushClaudeOauthTokenRedactionState(stdoutRedactionState))
        writeOutput(2, flushClaudeOauthTokenRedactionState(stderrRedactionState))
      }
      resolveResult({ exitCode: code ?? 1, token })
    })
  })

const runDockerProbe = (spec: ClaudeDockerProbeSpec): Promise<number> =>
  new Promise((resolveExitCode, reject) => {
    const child = spawn(spec.dockerCommand, [...spec.args], {
      cwd: spec.cwd,
      stdio: "inherit"
    })
    child.on("error", reject)
    child.on("close", (code) => {
      resolveExitCode(code ?? 1)
    })
  })

const writeCapturedToken = async (accountPath: string, token: string): Promise<void> => {
  const tokenPath = claudeOauthTokenPath(accountPath)
  const tempDir = await mkdtemp(join(accountPath, ".oauth-token-write-"))
  const tempPath = join(tempDir, ".oauth-token")
  let renamed = false
  try {
    await writeFile(tempPath, formatClaudeOauthTokenFile(token), {
      encoding: "utf8",
      mode: claudeOauthTokenFileMode
    })
    await chmod(tempPath, claudeOauthTokenFileMode)
    await rename(tempPath, tokenPath)
    renamed = true
  } finally {
    await rm(tempDir, { recursive: true, force: true })
    if (!renamed) {
      await rm(tempPath, { force: true })
    }
  }
}

const dockerProbeStatusFromExitCode = (exitCode: number): ClaudeDockerProbeStatus =>
  exitCode === 0
    ? { _tag: "ClaudeDockerProbeSucceeded", exitCode }
    : { _tag: "ClaudeDockerProbeFailed", exitCode }

export const runClaudeDockerOauth = async (
  options: ClaudeDockerOauthOptions = {}
): Promise<ClaudeDockerOauthResult> => {
  const cwd = options.cwd ?? process.cwd()
  const image = options.image ?? defaultClaudeDockerOauthImage
  const containerPath = options.containerPath ?? defaultClaudeDockerOauthContainerHome
  const dockerCommand = options.dockerCommand ?? "docker"
  const accountPath = resolve(options.accountPath ?? await mkdtemp(join(tmpdir(), "docker-git-auth-oauth-account-")))
  const dockerHostPath = resolve(options.dockerHostPath ?? accountPath)
  const keepAccountPath = options.keepAccountPath ?? options.accountPath !== undefined

  try {
    await mkdir(accountPath, { recursive: true })
    await ensureClaudeDockerImage(
      dockerCommand,
      image,
      cwd,
      options.skipBuild ?? false,
      options.runBuild ?? runDockerBuildInherited
    )
    const setup = await (options.runSetupToken ?? runDockerSetupToken)({
      dockerCommand,
      args: buildDockerSetupTokenArgs(image, dockerHostPath, containerPath),
      cwd,
      redactLiveOutput: options.redactLiveOutput ?? true
    }
    )
    const result = classifyClaudeSetupTokenResult(setup.token, setup.exitCode)
    if (result._tag === "ClaudeSetupTokenCaptured") {
      await writeCapturedToken(accountPath, result.token)
      const probeExitCode = await (options.runProbe ?? runDockerProbe)({
        dockerCommand,
        args: buildDockerProbeArgs(image, dockerHostPath, containerPath, result.token),
        cwd
      })
      return {
        _tag: "ClaudeDockerOauthTokenCaptured",
        token: result.token,
        accountPath,
        image,
        exitCode: result.exitCode,
        probeStatus: dockerProbeStatusFromExitCode(probeExitCode)
      }
    }
    if (result._tag === "ClaudeSetupTokenCommandFailed") {
      return {
        _tag: "ClaudeDockerOauthCommandFailed",
        accountPath,
        image,
        exitCode: result.exitCode
      }
    }
    return {
      _tag: "ClaudeDockerOauthTokenMissing",
      accountPath,
      image
    }
  } finally {
    if (!keepAccountPath) {
      await rm(accountPath, { recursive: true, force: true })
    }
  }
}

export const renderClaudeDockerOauthResult = (
  result: ClaudeDockerOauthResult,
  printToken: boolean
): string => {
  if (result._tag === "ClaudeDockerOauthTokenCaptured") {
    const probe = result.probeStatus._tag === "ClaudeDockerProbeSucceeded"
      ? "probe=ok"
      : `probe=failed exit=${result.probeStatus.exitCode}`
    return printToken
      ? `status=ClaudeDockerOauthTokenCaptured ${probe} token=${result.token}`
      : `status=ClaudeDockerOauthTokenCaptured ${probe}`
  }
  if (result._tag === "ClaudeDockerOauthCommandFailed") {
    return `status=ClaudeDockerOauthCommandFailed exit=${result.exitCode}`
  }
  return "status=ClaudeDockerOauthTokenMissing"
}

const readFlagValue = (argv: ReadonlyArray<string>, flag: string): string | null => {
  const prefix = `${flag}=`
  const match = argv.find((arg) => arg.startsWith(prefix))
  return match === undefined ? null : match.slice(prefix.length)
}

const isDirectExecution = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)
}

if (isDirectExecution()) {
  const printToken = process.argv.includes("--print-token")
  const accountPath = readFlagValue(process.argv, "--account-path")
  const dockerHostPath = readFlagValue(process.argv, "--docker-host-path")
  const image = readFlagValue(process.argv, "--image")
  const containerPath = readFlagValue(process.argv, "--container-path")
  const options: ClaudeDockerOauthOptions = {
    skipBuild: process.argv.includes("--skip-build"),
    keepAccountPath: process.argv.includes("--keep-account-path") || accountPath !== null,
    printToken,
    redactLiveOutput: !process.argv.includes("--no-redact-live-output")
  }
  if (accountPath !== null) {
    Object.assign(options, { accountPath })
  }
  if (dockerHostPath !== null) {
    Object.assign(options, { dockerHostPath })
  }
  if (image !== null) {
    Object.assign(options, { image })
  }
  if (containerPath !== null) {
    Object.assign(options, { containerPath })
  }
  runClaudeDockerOauth(options)
    .then((result) => {
      console.log(renderClaudeDockerOauthResult(result, printToken))
      process.exitCode = result._tag === "ClaudeDockerOauthTokenCaptured" ? 0 : 1
    })
    .catch((error: Error) => {
      console.error(`status=ClaudeDockerOauthError message=${error.message}`)
      process.exitCode = 1
    })
}
