import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { TemplateConfig } from "../core/domain.js"
import { runDockerInspectContainerIp } from "../shell/docker.js"
import { findSshPrivateKey, resolveAuthorizedKeysPath } from "./path-helpers.js"

const sshOptions = "-tt -Y -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

const sanitizeSshHostAlias = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
  return normalized.length === 0 ? "docker-git" : normalized
}

export type EditorSshAccess = {
  readonly alias: string
  readonly host: string
  readonly port: number
  readonly workspacePath: string
  readonly configSnippet: string
  readonly terminalShortcut: string
}

export type ResolvedProjectSshAccess = {
  readonly sshCommand: string
  readonly editor: EditorSshAccess
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly ipAddress?: string | undefined
}

// CHANGE: centralize ssh command rendering for terminal access
// WHY: keep terminal ssh output and editor ssh output derived from the same topology
// QUOTE(ТЗ): "подключиться по SSH"
// REF: issue-196
// SOURCE: n/a
// FORMAT THEOREM: forall c: config(c) -> command(c) is deterministic
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: localhost uses configured sshPort; container IP uses port 22
// COMPLEXITY: O(1)
export const buildSshCommand = (
  config: TemplateConfig,
  sshKey: string | null,
  ipAddress?: string
): string => {
  const host = ipAddress ?? "localhost"
  const port = ipAddress ? 22 : config.sshPort
  return sshKey === null
    ? `ssh ${sshOptions} -p ${port} ${config.sshUser}@${host}`
    : `ssh -i ${sshKey} ${sshOptions} -p ${port} ${config.sshUser}@${host}`
}

// CHANGE: derive a stable Remote-SSH host alias and config snippet
// WHY: Cursor/VS Code Remote-SSH are more reliable with ~/.ssh/config aliases than inline nested ssh commands
// QUOTE(ТЗ): "Что бы можно было подключиться к SSH одной командой?"
// REF: issue-196
// SOURCE: n/a
// FORMAT THEOREM: forall c: config(c) -> alias(c) ∧ snippet(c)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: alias is shell-safe and derived from container identity
// COMPLEXITY: O(1)
export const buildEditorSshAccess = (
  config: TemplateConfig,
  sshKeyPath: string | null,
  ipAddress?: string
): EditorSshAccess => {
  const alias = sanitizeSshHostAlias(config.containerName)
  const host = ipAddress ?? "localhost"
  const port = ipAddress ? 22 : config.sshPort
  const configLines = [
    `Host ${alias}`,
    `  HostName ${host}`,
    `  User ${config.sshUser}`,
    `  Port ${port}`,
    "  LogLevel ERROR",
    "  StrictHostKeyChecking no",
    "  UserKnownHostsFile /dev/null"
  ]
  if (sshKeyPath !== null) {
    configLines.push(`  IdentityFile ${sshKeyPath}`, "  IdentitiesOnly yes")
  }
  return {
    alias,
    host,
    port,
    workspacePath: config.targetDir,
    configSnippet: configLines.join("\n"),
    terminalShortcut: `ssh ${alias}`
  }
}

export const formatEditorSshAccessSummary = (
  access: EditorSshAccess,
  clonedOnHostname?: string
): string => {
  const firstHopLine = clonedOnHostname === undefined
    ? ""
    : `\nFirst hop host: ${clonedOnHostname} (add ProxyJump/ProxyCommand when connecting from another machine)`
  return `Remote-SSH host: ${access.alias}
Terminal shortcut: ${access.terminalShortcut}
Remote workspace: ${access.workspacePath}${firstHopLine}`
}

export const formatEditorSshAccessDetails = (
  access: EditorSshAccess,
  clonedOnHostname?: string
): string => {
  const firstHopNote = clonedOnHostname === undefined
    ? ""
    : `\nIf your editor runs on another machine, keep this host block as the inner container target and add your own ProxyJump/ProxyCommand for the first hop to ${clonedOnHostname}.`
  return `Remote-SSH host: ${access.alias}
Terminal shortcut: ${access.terminalShortcut}
Remote workspace: ${access.workspacePath}
VS Code/Cursor: Connect to Host... -> ${access.alias}

Add to ~/.ssh/config:
${access.configSnippet}${firstHopNote}`
}

// CHANGE: resolve terminal/editor SSH access from the current runtime context
// WHY: create/clone and list flows need consistent access info without duplicating fs/docker probing
// QUOTE(ТЗ): "как подключиться к SSH к Cursor, VS code"
// REF: issue-196
// SOURCE: n/a
// FORMAT THEOREM: forall c: runtime(c) -> ssh(c) ∧ editor(c)
// PURITY: SHELL
// EFFECT: Effect<ResolvedProjectSshAccess, PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: authorized_keys path and ssh key are resolved against the same baseDir
// COMPLEXITY: O(1) + docker inspect
export const resolveProjectSshAccess = (
  baseDir: string,
  config: TemplateConfig
): Effect.Effect<
  ResolvedProjectSshAccess,
  PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)

    const isInsideContainer = yield* _(fs.exists("/.dockerenv"))
    const ipAddress = isInsideContainer
      ? yield* _(
        runDockerInspectContainerIp(baseDir, config.containerName).pipe(
          Effect.orElse(() => Effect.succeed("")),
          Effect.map((value) => (value.length > 0 ? value : undefined))
        )
      )
      : undefined

    const authorizedKeysPath = resolveAuthorizedKeysPath(path, baseDir, config.authorizedKeysPath)
    const authorizedKeysExists = yield* _(fs.exists(authorizedKeysPath))
    const sshKeyPath = yield* _(findSshPrivateKey(fs, path, process.cwd()))
    const editor = buildEditorSshAccess(config, sshKeyPath, ipAddress)

    return {
      sshCommand: buildSshCommand(config, sshKeyPath, ipAddress),
      editor,
      authorizedKeysPath,
      authorizedKeysExists,
      ipAddress
    }
  })
