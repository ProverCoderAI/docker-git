import { Effect } from "effect"

import type { CreateCommand } from "@lib/core/domain"
import { defaultTemplateConfig } from "@lib/core/domain"
import { runCommandCapture, runCommandWithExitCodes } from "@lib/shell/command-runner"
import { CommandFailedError } from "@lib/shell/errors"
import { defaultProjectsRoot, findSshPrivateKey, resolvePathFromCwd } from "@lib/usecases/path-helpers"
import { withFsPathContext } from "@lib/usecases/runtime"

export type HostSshMaterial = {
  readonly privateKeyPath: string
  readonly authorizedKeysContents: string
}

const normalizeAuthorizedKeys = (value: string): ReadonlyArray<string> =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const mergeAuthorizedKeys = (
  base: ReadonlyArray<string>,
  required: ReadonlyArray<string>
): string => {
  const merged = [...base]
  for (const line of required) {
    if (!merged.includes(line)) {
      merged.push(line)
    }
  }
  return merged.length === 0 ? "" : `${merged.join("\n")}\n`
}

const resolvePublicKeyFromPrivate = (
  privateKeyPath: string
) =>
  withFsPathContext(({ fs }) =>
    Effect.gen(function*(_) {
      const publicKeyPath = `${privateKeyPath}.pub`
      const publicKeyExists = yield* _(fs.exists(publicKeyPath))
      if (publicKeyExists) {
        return yield* _(fs.readFileString(publicKeyPath))
      }

      return yield* _(
        runCommandCapture(
          {
            cwd: process.cwd(),
            command: "ssh-keygen",
            args: ["-y", "-f", privateKeyPath]
          },
          [0],
          (exitCode) => new CommandFailedError({ command: "ssh-keygen -y", exitCode })
        ).pipe(Effect.map((value) => `${value.trim()}\n`))
      )
    })
  )

export const resolveHostPrivateKeyPath = () =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const existing = yield* _(findSshPrivateKey(fs, path, process.cwd()))
      if (existing !== null) {
        return existing
      }

      const projectsRoot = defaultProjectsRoot(process.cwd())
      const managedKeyPath = path.join(projectsRoot, "dev_ssh_key")
      const managedPublicKeyPath = `${managedKeyPath}.pub`

      yield* _(fs.makeDirectory(path.dirname(managedKeyPath), { recursive: true }))

      const stalePublicKeyExists = yield* _(fs.exists(managedPublicKeyPath))
      if (stalePublicKeyExists) {
        yield* _(fs.remove(managedPublicKeyPath))
      }

      yield* _(
        runCommandWithExitCodes(
          {
            cwd: process.cwd(),
            command: "ssh-keygen",
            args: ["-q", "-t", "ed25519", "-N", "", "-C", "docker-git", "-f", managedKeyPath]
          },
          [0],
          (exitCode) => new CommandFailedError({ command: "ssh-keygen", exitCode })
        )
      )

      return managedKeyPath
    })
  )

const readLocalAuthorizedKeysOverride = (
  command: CreateCommand
) =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      if (command.config.authorizedKeysPath === defaultTemplateConfig.authorizedKeysPath) {
        return ""
      }

      const resolved = resolvePathFromCwd(path, process.cwd(), command.config.authorizedKeysPath)
      const exists = yield* _(fs.exists(resolved))
      if (!exists) {
        return ""
      }

      return yield* _(fs.readFileString(resolved))
    })
  )

const resolveManagedHostPublicKey = () =>
  Effect.gen(function*(_) {
    const privateKeyPath = yield* _(resolveHostPrivateKeyPath())
    const publicKey = yield* _(resolvePublicKeyFromPrivate(privateKeyPath))

    return {
      privateKeyPath,
      publicKey
    }
  })

export const resolveHostSshMaterial = (
  command: CreateCommand
) =>
  Effect.gen(function*(_) {
    const { privateKeyPath, publicKey } = yield* _(resolveManagedHostPublicKey())
    const authorizedKeysOverride = yield* _(readLocalAuthorizedKeysOverride(command))

    return {
      privateKeyPath,
      authorizedKeysContents: mergeAuthorizedKeys(
        normalizeAuthorizedKeys(authorizedKeysOverride),
        normalizeAuthorizedKeys(publicKey)
      )
    }
  })

export const resolveManagedHostSshMaterial = () =>
  Effect.gen(function*(_) {
    const { privateKeyPath, publicKey } = yield* _(resolveManagedHostPublicKey())

    return {
      privateKeyPath,
      authorizedKeysContents: mergeAuthorizedKeys(
        [],
        normalizeAuthorizedKeys(publicKey)
      )
    }
  })
