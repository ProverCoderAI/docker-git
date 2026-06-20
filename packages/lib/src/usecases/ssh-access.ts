import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { TemplateConfig } from "../core/domain.js"
import { runDockerInspectContainerIp } from "../shell/docker.js"
import { findSshPrivateKey, resolveAuthorizedKeysPath } from "./path-helpers.js"

const sshOptions = "-tt -Y -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

const aliasCharPattern = /^[A-Za-z0-9._-]$/u

const isAliasChar = (value: string): boolean => aliasCharPattern.test(value)

const trimAliasEdges = (value: string): string => {
  let start = 0
  let end = value.length

  while (start < end && (value[start] === "." || value[start] === "-")) {
    start += 1
  }

  while (end > start && (value[end - 1] === "." || value[end - 1] === "-")) {
    end -= 1
  }

  return value.slice(start, end)
}

const sanitizeSshHostAlias = (value: string): string => {
  let normalized = ""
  let isPreviousWasDash = false

  for (const char of value.trim()) {
    if (isAliasChar(char)) {
      normalized += char
      isPreviousWasDash = false
      continue
    }

    if (!isPreviousWasDash) {
      normalized += "-"
      isPreviousWasDash = true
    }
  }

  normalized = trimAliasEdges(normalized)
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

/**
 * Formats a compact editor SSH access summary.
 *
 * @param access - Validated SSH access details for the project container.
 * @param clonedOnHostname - Optional clone-origin hostname used for first-hop guidance.
 * @returns Human-readable SSH access summary.
 * @pure true - deterministic formatting only.
 * @effect none
 * @invariant clonedOnHostname is rendered only when present.
 * @precondition access fields are already resolved by SSH access discovery.
 * @postcondition output contains no OS-derived hostname reads.
 * @complexity O(n)/O(n), where n is the rendered access text length.
 */
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

/**
 * Formats detailed editor SSH access instructions.
 *
 * @param access - Validated SSH access details for the project container.
 * @param clonedOnHostname - Optional clone-origin hostname used for first-hop guidance.
 * @returns Human-readable SSH access details.
 * @pure true - deterministic formatting only.
 * @effect none
 * @invariant clonedOnHostname is rendered only when present.
 * @precondition access fields are already resolved by SSH access discovery.
 * @postcondition output contains no OS-derived hostname reads.
 * @complexity O(n)/O(n), where n is the rendered access text length.
 */
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

// CHANGE: build SSH config for share links using external client host and mapped SSH port
// WHY: share link SSH config must route through the host's external IP + mapped port, not container IP
// QUOTE(ТЗ): "принимает ссылку на любой IP который стоит у пользователя в URL"
// REF: issue-428
// FORMAT THEOREM: ∀ item, host: buildShareLinkSshAccess(item, host) → configSnippet uses sshPort (not 22)
// PURITY: CORE
// INVARIANT: port is always item.sshPort (host-mapped), never 22 (container-direct)
// COMPLEXITY: O(n)/O(n) where n = |containerName|
export type ShareLinkSshAccess = {
  readonly alias: string
  readonly configSnippet: string
  readonly cfConfigSnippet: string | null
  readonly workspacePath: string
  readonly vscodeUri: string
  readonly cfVscodeUri: string | null
}

export const buildShareLinkSshAccess = (
  containerName: string,
  sshUser: string,
  sshPort: number,
  sshKeyPath: string | null,
  targetDir: string,
  clientHost: string,
  sshCfHostname: string | null
): ShareLinkSshAccess => {
  const alias = sanitizeSshHostAlias(containerName)
  // clientHost may carry a web port suffix (e.g. "192.168.0.206:4174") — strip it.
  // SSH port is provided separately via sshPort; HostName must be a bare hostname.
  const sshHostname = clientHost.includes(":") ? clientHost.slice(0, clientHost.lastIndexOf(":")) : clientHost
  const directLines = [
    `Host ${alias}`,
    `  HostName ${sshHostname}`,
    `  User ${sshUser}`,
    `  Port ${sshPort}`,
    `  LogLevel ERROR`,
    `  StrictHostKeyChecking no`,
    `  UserKnownHostsFile /dev/null`
  ]
  if (sshKeyPath !== null) {
    directLines.push(`  IdentityFile ${sshKeyPath}`, `  IdentitiesOnly yes`)
  }

  const cfAlias = `${alias}-cf`
  const cfLines = sshCfHostname === null
    ? null
    : [
      `Host ${cfAlias}`,
      `  HostName ${sshCfHostname}`,
      `  User ${sshUser}`,
      `  Port 22`,
      `  ProxyCommand cloudflared access ssh --hostname %h`,
      `  LogLevel ERROR`,
      `  StrictHostKeyChecking no`,
      `  UserKnownHostsFile /dev/null`,
      ...(sshKeyPath !== null ? [`  IdentityFile ${sshKeyPath}`, `  IdentitiesOnly yes`] : [])
    ]

  const encodedFolder = encodeURIComponent(targetDir)
  // CHANGE: use hostName=user@host:port so VS Code Remote SSH connects directly
  // WHY: alias-based URIs require the user to manually add SSH config — direct hostName format
  //      works without ~/.ssh/config because VS Code accepts user@host:port in Connect to Host
  // SOURCE: https://code.visualstudio.com/docs/remote/ssh#_connect-to-a-remote-host
  //   "You can also enter a user@host or user@host:port connection string if you don't want
  //    to use an SSH config file entry."
  const directHostName = `${sshUser}@${sshHostname}:${sshPort}`
  const cfHostName = sshCfHostname !== null ? `${sshUser}@${sshCfHostname}` : null
  return {
    alias,
    configSnippet: directLines.join("\n"),
    cfConfigSnippet: cfLines === null ? null : cfLines.join("\n"),
    workspacePath: targetDir,
    vscodeUri: `vscode://ms-vscode-remote.remote-ssh/open?hostName=${encodeURIComponent(directHostName)}&folder=${encodedFolder}`,
    cfVscodeUri: cfHostName === null
      ? null
      : `vscode://ms-vscode-remote.remote-ssh/open?hostName=${encodeURIComponent(cfHostName)}&folder=${encodedFolder}`
  }
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
    const isAuthorizedKeysExists = yield* _(fs.exists(authorizedKeysPath))
    const sshKeyPath = yield* _(findSshPrivateKey(fs, path, process.cwd()))
    const editor = buildEditorSshAccess(config, sshKeyPath, ipAddress)

    return {
      sshCommand: buildSshCommand(config, sshKeyPath, ipAddress),
      editor,
      authorizedKeysPath,
      authorizedKeysExists: isAuthorizedKeysExists,
      ipAddress
    }
  })
