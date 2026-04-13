import { defaultTemplateConfig } from "@effect-template/lib/core/domain"
import { runCommandCapture, runCommandWithExitCodes } from "@effect-template/lib/shell/command-runner"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { defaultProjectsRoot, findSshPrivateKey, resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { withFsPathContext } from "@effect-template/lib/usecases/runtime"
import { Effect } from "effect"

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

const resolvePublicKeyFromPrivate = (privateKeyPath: string) =>
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

const ensurePrivateKeyPermissions = (privateKeyPath: string) =>
  withFsPathContext(({ fs }) =>
    fs.chmod(privateKeyPath, 0o600).pipe(Effect.orElseSucceed(() => void 0))
  )

const resolveHostPrivateKeyPath = () =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const existing = yield* _(findSshPrivateKey(fs, path, process.cwd()))
      if (existing !== null) {
        yield* _(ensurePrivateKeyPermissions(existing))
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

      yield* _(ensurePrivateKeyPermissions(managedKeyPath))
      return managedKeyPath
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

const readLocalAuthorizedKeysOverride = (
  projectDir: string,
  authorizedKeysPath: string
) =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      if (authorizedKeysPath === defaultTemplateConfig.authorizedKeysPath) {
        return ""
      }

      const resolved = resolvePathFromCwd(path, projectDir, authorizedKeysPath)
      const exists = yield* _(fs.exists(resolved))
      if (!exists) {
        return ""
      }

      return yield* _(fs.readFileString(resolved))
    })
  )

export const resolveManagedAuthorizedKeysContents = () =>
  Effect.gen(function*(_) {
    const { publicKey } = yield* _(resolveManagedHostPublicKey())
    return mergeAuthorizedKeys([], normalizeAuthorizedKeys(publicKey))
  })

export const resolveCreateAuthorizedKeysContents = (
  projectDir: string,
  authorizedKeysPath: string
) =>
  Effect.gen(function*(_) {
    const { publicKey } = yield* _(resolveManagedHostPublicKey())
    const authorizedKeysOverride = yield* _(readLocalAuthorizedKeysOverride(projectDir, authorizedKeysPath))
    return mergeAuthorizedKeys(
      normalizeAuthorizedKeys(authorizedKeysOverride),
      normalizeAuthorizedKeys(publicKey)
    )
  })
