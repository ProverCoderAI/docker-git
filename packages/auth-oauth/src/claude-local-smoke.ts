import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

import {
  claudeCodeOauthTokenEnvKey,
  claudeOauthTokenFileMode,
  claudeOauthTokenPath,
  classifyClaudeSetupTokenResult,
  dockerGitClaudeOauthTokenEnvKey,
  extractClaudeOauthToken,
  formatClaudeOauthTokenFile,
  type OAuthEnvironment,
  readClaudeOauthTokenFromEnv
} from "./claude-oauth-token.js"

export type ClaudeLocalOauthSmokeMode = "env-token" | "setup-token"

export type ClaudeLocalOauthProbeSpec = {
  readonly cwd: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: NodeJS.ProcessEnv
}

export type ClaudeLocalOauthSetupTokenResult = {
  readonly exitCode: number
  readonly token: string | null
}

export type ClaudeLocalOauthSmokeResult =
  | {
    readonly _tag: "ClaudeLocalOauthSmokeMissingToken"
    readonly envKeys: ReadonlyArray<string>
  }
  | {
    readonly _tag: "ClaudeLocalOauthSmokeSucceeded"
    readonly accountPath: string
  }
  | {
    readonly _tag: "ClaudeLocalOauthSmokeProbeFailed"
    readonly accountPath: string
    readonly exitCode: number
  }
  | {
    readonly _tag: "ClaudeLocalOauthSmokeSetupTokenFailed"
    readonly accountPath: string
    readonly exitCode: number
  }
  | {
    readonly _tag: "ClaudeLocalOauthSmokeSetupTokenMissingToken"
    readonly accountPath: string
    readonly exitCode: 0
  }

export type ClaudeLocalOauthSmokeOptions = {
  readonly mode?: ClaudeLocalOauthSmokeMode
  readonly env?: OAuthEnvironment & NodeJS.ProcessEnv
  readonly cwd?: string
  readonly command?: string
  readonly args?: ReadonlyArray<string>
  readonly keepTemp?: boolean
  readonly runProbe?: (spec: ClaudeLocalOauthProbeSpec) => Promise<number>
  readonly runSetupToken?: (spec: ClaudeLocalOauthProbeSpec) => Promise<ClaudeLocalOauthSetupTokenResult>
}

export const claudeLocalOauthSmokeEnvKeys = [
  dockerGitClaudeOauthTokenEnvKey,
  claudeCodeOauthTokenEnvKey
] as const

export const buildClaudeLocalOauthEnv = (
  baseEnv: NodeJS.ProcessEnv,
  accountPath: string,
  oauthToken: string
): NodeJS.ProcessEnv => ({
  ...baseEnv,
  CLAUDE_CONFIG_DIR: accountPath,
  CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
  HOME: accountPath
})

export const persistClaudeLocalOauthToken = async (
  accountPath: string,
  token: string
): Promise<void> => {
  const tokenPath = claudeOauthTokenPath(accountPath)
  await writeFile(tokenPath, formatClaudeOauthTokenFile(token), "utf8")
  await chmod(tokenPath, claudeOauthTokenFileMode).catch(() => undefined)
}

const redactedOauthTokenText = (text: string): string =>
  text.replaceAll(/sk-ant-[A-Za-z0-9._-]+/gu, "<redacted-oauth-token>")

const defaultClaudeLocalOauthProbe = (spec: ClaudeLocalOauthProbeSpec): Promise<number> =>
  new Promise((resolveExitCode, reject) => {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: "inherit"
    })

    child.on("error", reject)
    child.on("close", (code) => {
      resolveExitCode(code ?? 1)
    })
  })

const appendOutputWindow = (outputWindow: string, chunk: string): string => {
  const next = `${outputWindow}${chunk}`
  return next.length > 262_144 ? next.slice(-262_144) : next
}

const defaultClaudeSetupToken = (
  spec: ClaudeLocalOauthProbeSpec
): Promise<ClaudeLocalOauthSetupTokenResult> =>
  new Promise((resolveResult, reject) => {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["inherit", "pipe", "pipe"]
    })
    const decoder = new TextDecoder("utf-8")
    let outputWindow = ""
    let token: string | null = null

    const capture = (chunk: Uint8Array, fd: 1 | 2): void => {
      const text = decoder.decode(chunk)
      outputWindow = appendOutputWindow(outputWindow, text)
      token = token ?? extractClaudeOauthToken(outputWindow)
      const redacted = redactedOauthTokenText(text)
      if (fd === 2) {
        process.stderr.write(redacted)
        return
      }
      process.stdout.write(redacted)
    }

    child.stdout?.on("data", (chunk: Uint8Array) => {
      capture(chunk, 1)
    })
    child.stderr?.on("data", (chunk: Uint8Array) => {
      capture(chunk, 2)
    })
    child.on("error", reject)
    child.on("close", (code) => {
      resolveResult({ exitCode: code ?? 1, token })
    })
  })

const removeTempRoot = (root: string, keepTemp: boolean): Promise<void> =>
  keepTemp ? Promise.resolve() : rm(root, { recursive: true, force: true })

const buildClaudeSetupTokenEnv = (
  baseEnv: NodeJS.ProcessEnv,
  accountPath: string
): NodeJS.ProcessEnv => ({
  ...baseEnv,
  CLAUDE_CONFIG_DIR: accountPath,
  HOME: accountPath
})

const readTokenFromEnv = (env: OAuthEnvironment): ClaudeLocalOauthSmokeResult | string => {
  const token = readClaudeOauthTokenFromEnv(env, claudeLocalOauthSmokeEnvKeys)
  return token === null
    ? {
      _tag: "ClaudeLocalOauthSmokeMissingToken",
      envKeys: claudeLocalOauthSmokeEnvKeys
    }
    : token
}

const readTokenFromSetupToken = async (
  accountPath: string,
  spec: ClaudeLocalOauthProbeSpec,
  runSetupToken: (spec: ClaudeLocalOauthProbeSpec) => Promise<ClaudeLocalOauthSetupTokenResult>
): Promise<ClaudeLocalOauthSmokeResult | string> => {
  const setup = await runSetupToken(spec)
  const result = classifyClaudeSetupTokenResult(setup.token, setup.exitCode)
  if (result._tag === "ClaudeSetupTokenCaptured") {
    return result.token
  }
  if (result._tag === "ClaudeSetupTokenCommandFailed") {
    return {
      _tag: "ClaudeLocalOauthSmokeSetupTokenFailed",
      accountPath,
      exitCode: result.exitCode
    }
  }
  return {
    _tag: "ClaudeLocalOauthSmokeSetupTokenMissingToken",
    accountPath,
    exitCode: result.exitCode
  }
}

const isSmokeResult = (value: ClaudeLocalOauthSmokeResult | string): value is ClaudeLocalOauthSmokeResult =>
  typeof value !== "string"

export const runClaudeLocalOauthSmoke = async (
  options: ClaudeLocalOauthSmokeOptions = {}
): Promise<ClaudeLocalOauthSmokeResult> => {
  const env = options.env ?? process.env
  const mode = options.mode ?? "env-token"

  if (mode === "env-token") {
    const envToken = readTokenFromEnv(env)
    if (isSmokeResult(envToken)) {
      return envToken
    }
  }

  const root = await mkdtemp(join(tmpdir(), "docker-git-auth-oauth-smoke-"))
  const accountPath = join(root, "default")
  const keepTemp = options.keepTemp ?? false
  try {
    await mkdir(accountPath, { recursive: true })
    const command = options.command ?? "claude"
    const cwd = options.cwd ?? process.cwd()
    const setupEnv = buildClaudeSetupTokenEnv(env, accountPath)
    const token = mode === "setup-token"
      ? await readTokenFromSetupToken(accountPath, {
        cwd,
        command,
        args: ["setup-token"],
        env: setupEnv
      }, options.runSetupToken ?? defaultClaudeSetupToken)
      : readTokenFromEnv(env)
    if (isSmokeResult(token)) {
      return token
    }
    await persistClaudeLocalOauthToken(accountPath, token)
    const exitCode = await (options.runProbe ?? defaultClaudeLocalOauthProbe)({
      cwd,
      command,
      args: options.args ?? ["-p", "ping"],
      env: buildClaudeLocalOauthEnv(env, accountPath, token)
    })

    return exitCode === 0
      ? { _tag: "ClaudeLocalOauthSmokeSucceeded", accountPath }
      : { _tag: "ClaudeLocalOauthSmokeProbeFailed", accountPath, exitCode }
  } finally {
    await removeTempRoot(root, keepTemp)
  }
}

export const renderClaudeLocalOauthSmokeResult = (result: ClaudeLocalOauthSmokeResult): string => {
  if (result._tag === "ClaudeLocalOauthSmokeSucceeded") {
    return "smoke=ClaudeLocalOauthSmokeSucceeded"
  }
  if (result._tag === "ClaudeLocalOauthSmokeProbeFailed") {
    return `smoke=ClaudeLocalOauthSmokeProbeFailed exit=${result.exitCode}`
  }
  if (result._tag === "ClaudeLocalOauthSmokeSetupTokenFailed") {
    return `smoke=ClaudeLocalOauthSmokeSetupTokenFailed exit=${result.exitCode}`
  }
  if (result._tag === "ClaudeLocalOauthSmokeSetupTokenMissingToken") {
    return "smoke=ClaudeLocalOauthSmokeSetupTokenMissingToken"
  }
  return `smoke=ClaudeLocalOauthSmokeMissingToken env=${result.envKeys.join("|")}`
}

const modeFromArgv = (argv: ReadonlyArray<string>): ClaudeLocalOauthSmokeMode => {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="))
  return modeArg === "--mode=setup-token" ? "setup-token" : "env-token"
}

const isDirectExecution = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)
}

if (isDirectExecution()) {
  const keepTemp = process.argv.includes("--keep-temp")
  runClaudeLocalOauthSmoke({ keepTemp, mode: modeFromArgv(process.argv) })
    .then((result) => {
      console.log(renderClaudeLocalOauthSmokeResult(result))
      process.exitCode = result._tag === "ClaudeLocalOauthSmokeSucceeded" ? 0 : 1
    })
    .catch((error: Error) => {
      console.error(`smoke=ClaudeLocalOauthSmokeError message=${error.message}`)
      process.exitCode = 1
    })
}
