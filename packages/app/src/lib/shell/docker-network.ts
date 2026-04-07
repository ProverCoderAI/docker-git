/* jscpd:ignore-start */
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "./command-runner.js"
import { DockerCommandError } from "./errors.js"

// CHANGE: check whether a named Docker network exists
// WHY: allow shared-network mode to create the network only when missing
// QUOTE(ТЗ): "Что бы текущие проекты не ложились"
// REF: user-request-2026-02-20-network-shared
// SOURCE: n/a
// FORMAT THEOREM: ∀n: exists(n) ∈ {true,false}
// PURITY: SHELL
// EFFECT: Effect<boolean, PlatformError, CommandExecutor>
// INVARIANT: returns false for non-zero inspect exit codes
// COMPLEXITY: O(command)
export const runDockerNetworkExists = (
  cwd: string,
  networkName: string
): Effect.Effect<boolean, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({
    cwd,
    command: "docker",
    args: ["network", "inspect", networkName]
  }).pipe(Effect.map((exitCode) => exitCode === 0))

// CHANGE: create a Docker bridge network with a deterministic name
// WHY: shared-network mode requires an external network before compose up
// QUOTE(ТЗ): "сделай что бы я эту ошибку больше не видел"
// REF: user-request-2026-02-20-network-shared
// SOURCE: n/a
// FORMAT THEOREM: ∀n: create(n)=0 -> network_exists(n)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: network driver is always `bridge`
// COMPLEXITY: O(command)
export const runDockerNetworkCreateBridge = (
  cwd: string,
  networkName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: ["network", "create", "--driver", "bridge", networkName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )

// CHANGE: create a Docker bridge network with an explicit subnet
// WHY: allow callers to bypass default address-pool allocation when it is exhausted
// QUOTE(ТЗ): "научилось создавать сети правильно"
// REF: user-request-2026-02-20-network-fallback
// SOURCE: n/a
// FORMAT THEOREM: ∀(n,s): create(n,s)=0 -> exists(n) ∧ subnet(n)=s
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: network driver is always `bridge`
// COMPLEXITY: O(command)
export const runDockerNetworkCreateBridgeWithSubnet = (
  cwd: string,
  networkName: string,
  subnet: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: ["network", "create", "--driver", "bridge", "--subnet", subnet, networkName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )

// CHANGE: inspect how many containers are attached to a network
// WHY: network GC must remove only detached networks
// QUOTE(ТЗ): "Только так что бы текущие проекты не ложились"
// REF: user-request-2026-02-20-network-gc
// SOURCE: n/a
// FORMAT THEOREM: ∀n: count(n) = |containers(n)|
// PURITY: SHELL
// EFFECT: Effect<number, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: parse fallback is 0 when docker inspect output is empty
// COMPLEXITY: O(command)
export const runDockerNetworkContainerCount = (
  cwd: string,
  networkName: string
): Effect.Effect<number, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    {
      cwd,
      command: "docker",
      args: ["network", "inspect", "-f", "{{len .Containers}}", networkName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  ).pipe(
    Effect.map((output) => {
      const parsed = Number.parseInt(output.trim(), 10)
      return Number.isNaN(parsed) ? 0 : parsed
    })
  )

// CHANGE: remove a Docker network by name
// WHY: network GC should reclaim detached project-scoped networks
// QUOTE(ТЗ): "убирать мусорные сети автоматически"
// REF: user-request-2026-02-20-network-gc
// SOURCE: n/a
// FORMAT THEOREM: ∀n: rm(n)=0 -> !exists(n)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: removes exactly the named network
// COMPLEXITY: O(command)
export const runDockerNetworkRemove = (
  cwd: string,
  networkName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd,
      command: "docker",
      args: ["network", "rm", networkName]
    },
    [Number(ExitCode(0))],
    (exitCode) => new DockerCommandError({ exitCode })
  )
/* jscpd:ignore-end */
