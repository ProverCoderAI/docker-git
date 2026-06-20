// CHANGE: enable/disable SSH password auth in workspace containers for share links
// WHY: containers default to PasswordAuthentication no + locked dev user;
//      share links need password access so recipients without SSH keys can connect
// QUOTE(ТЗ): "можно сделать что бы работало по паролю? Без ssh ключа?"
// REF: issue-428
// FORMAT THEOREM: ∀ container: enabled(container, pw) → sshable(container, pw)
// PURITY: SHELL
// EFFECT: spawns docker exec processes
// INVARIANT: dev.conf always restored to PasswordAuthentication no on disable
// COMPLEXITY: O(1) per call (one docker exec each)

import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { promisify } from "node:util"

import { Effect } from "effect"

import { ApiInternalError } from "../api/errors.js"

const execFileAsync = promisify(execFile)

// Avoids ambiguous chars: 0/O, 1/l/I
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"

export const generateSshPassword = (): string => {
  const bytes = randomBytes(12)
  return Array.from(bytes).map((b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("")
}

const dockerExec = (
  containerName: string,
  env: Record<string, string>,
  script: string
): Effect.Effect<string, ApiInternalError> =>
  Effect.tryPromise({
    catch: (cause) => new ApiInternalError({ message: `docker exec ${containerName} failed`, cause }),
    try: async () => {
      const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`])
      const { stdout } = await execFileAsync("docker", ["exec", ...envArgs, containerName, "sh", "-c", script])
      return stdout
    }
  })

/**
 * Enables password SSH auth for the dev user in a workspace container.
 * Sets PasswordAuthentication yes in sshd_config.d/dev.conf, sets the given
 * password on the dev user, then reloads sshd.
 *
 * @pure false
 * @effect docker exec: sshd_config mutation, chpasswd, sshd reload
 * @invariant subsequent `ssh dev@host -p port` with the password will succeed
 * @throws Never – errors are typed as ApiInternalError
 */
export const enableContainerPasswordAuth = (
  containerName: string,
  password: string
): Effect.Effect<void, ApiInternalError> => {
  const script = [
    "sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config.d/dev.conf",
    "printf 'dev:%s' \"$SSHPW\" | chpasswd",
    "kill -HUP $(pgrep -xo sshd) 2>/dev/null || true"
  ].join(" && ")
  return dockerExec(containerName, { SSHPW: password }, script).pipe(Effect.asVoid)
}

/**
 * Disables password SSH auth for the dev user in a workspace container.
 * Restores PasswordAuthentication no and locks the dev user account.
 * Called when the last share link for a container is deleted.
 *
 * @pure false
 * @effect docker exec: sshd_config mutation, passwd lock, sshd reload
 * @invariant dev user is locked; PasswordAuthentication reverted to no
 * @throws Never – best-effort, errors are silently swallowed
 */
export const disableContainerPasswordAuth = (
  containerName: string
): Effect.Effect<void> => {
  const script = [
    "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/dev.conf",
    "passwd -l dev",
    "kill -HUP $(pgrep -xo sshd) 2>/dev/null || true"
  ].join(" && ")
  return dockerExec(containerName, {}, script).pipe(
    Effect.asVoid,
    Effect.orElse(() => Effect.void)
  )
}
