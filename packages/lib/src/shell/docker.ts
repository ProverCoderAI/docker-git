import * as Command from "@effect/platform/Command"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, pipe } from "effect"

import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "./command-runner.js"
import { CommandFailedError, DockerCommandError } from "./errors.js"

export { classifyDockerAccessIssue, ensureDockerDaemonAccess } from "./docker-daemon-access.js"

const composeSpec = (cwd: string, args: ReadonlyArray<string>) => ({
  cwd,
  command: "docker",
  args: ["compose", "--ansi", "never", "--progress", "plain", ...args]
})

const parseInspectNetworkEntry = (line: string): ReadonlyArray<readonly [string, string]> => {
  const idx = line.indexOf("=")
  if (idx <= 0) {
    return []
  }
  const network = line.slice(0, idx).trim()
  const ip = line.slice(idx + 1).trim()
  if (network.length === 0 || ip.length === 0) {
    return []
  }
  const entry: readonly [string, string] = [network, ip]
  return [entry]
}

const runCompose = (
  cwd: string,
  args: ReadonlyArray<string>,
  okExitCodes: ReadonlyArray<number>
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    composeSpec(cwd, args),
    okExitCodes,
    (exitCode) => new DockerCommandError({ exitCode })
  )

const runComposeCapture = (
  cwd: string,
  args: ReadonlyArray<string>,
  okExitCodes: ReadonlyArray<number>
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    composeSpec(cwd, args),
    okExitCodes,
    (exitCode) => new DockerCommandError({ exitCode })
  )

// CHANGE: run docker compose up -d --build in the target directory
// WHY: provide a controlled shell effect for image creation
// QUOTE(ТЗ): "создавать докер образы"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) = 0 -> image_built(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposeUp = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["up", "-d", "--build"], [Number(ExitCode(0))])

export const dockerComposeUpRecreateArgs: ReadonlyArray<string> = [
  "up",
  "-d",
  "--build",
  "--force-recreate"
]

// CHANGE: recreate running containers and refresh images when needed
// WHY: apply env/template updates while preserving workspace volumes
// QUOTE(ТЗ): "сбросит только окружение"
// REF: user-request-2026-02-11-force-env
// SOURCE: n/a
// FORMAT THEOREM: ∀dir: up_force_recreate(dir) → recreated(containers(dir)) ∧ preserved(volumes(dir)) ∧ updated(images(dir))
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: may rebuild images but does not remove volumes
// COMPLEXITY: O(command)
export const runDockerComposeUpRecreate = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, dockerComposeUpRecreateArgs, [Number(ExitCode(0))])

// CHANGE: run docker compose down in the target directory
// WHY: allow stopping managed containers from the CLI/menu
// QUOTE(ТЗ): "Могу удалить / Отключить"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) = 0 -> containers_stopped(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposeDown = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["down"], [Number(ExitCode(0))])

// CHANGE: run docker compose down -v in the target directory
// WHY: allow a truly fresh environment by wiping the named volumes (e.g. /home/dev)
// QUOTE(ТЗ): "контейнер полностью должен же очищаться при --force"
// REF: user-request-2026-02-07-force-wipe-volumes
// SOURCE: n/a
// FORMAT THEOREM: ∀dir: down_v(dir) → removed(volumes(dir))
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: removes only resources within the compose project (containers, networks, volumes)
// COMPLEXITY: O(command)
export const runDockerComposeDownVolumes = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["down", "-v"], [Number(ExitCode(0))])

// CHANGE: recreate docker compose environment in the target directory
// WHY: allow a clean rebuild of the container from the UI
// QUOTE(ТЗ): "дропнул контейнер и заново его создал"
// REF: user-request-2026-01-13
// SOURCE: n/a
// FORMAT THEOREM: forall dir: down(dir) && up(dir) -> recreated(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: down completes before up starts
// COMPLEXITY: O(command)
export const runDockerComposeRecreate = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runDockerComposeDown(cwd),
    Effect.zipRight(runDockerComposeUp(cwd))
  )

// CHANGE: run docker compose ps in the target directory
// WHY: expose runtime status in the interactive menu
// QUOTE(ТЗ): "вижу всю инфу по ним"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) = 0 -> status_listed(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposePs = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["ps"], [Number(ExitCode(0))])

// CHANGE: capture docker compose ps output in a parseable format
// WHY: allow structured, readable status output for CLI
// QUOTE(ТЗ): "информация отображалиась удобно"
// REF: user-request-2026-01-28
// SOURCE: n/a
// FORMAT THEOREM: forall dir: ps_fmt(dir) -> tabbed_string
// PURITY: SHELL
// EFFECT: Effect<string, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: output is tab-delimited columns from docker compose ps
// COMPLEXITY: O(command)
export const runDockerComposePsFormatted = (
  cwd: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runComposeCapture(
    cwd,
    ["ps", "--format", "{{.Name}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"],
    [Number(ExitCode(0))]
  )

// CHANGE: run docker compose logs in the target directory
// WHY: allow quick inspection of container output without leaving the menu
// QUOTE(ТЗ): "вижу всю инфу по ним"
// REF: user-request-2026-01-07
// SOURCE: n/a
// FORMAT THEOREM: forall dir: exitCode(cmd(dir)) in {0,130} -> logs_shown(dir)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposeLogs = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["logs", "--tail", "200"], [Number(ExitCode(0)), 130])

// CHANGE: stream docker compose logs until interrupted
// WHY: allow synchronous clone flow to surface container output
// QUOTE(ТЗ): "должно работать синхронно отображая весь процесс"
// REF: user-request-2026-01-28
// SOURCE: n/a
// FORMAT THEOREM: forall dir: logs_follow(dir) -> stdout(stream)
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: command output is inherited from the parent process
// COMPLEXITY: O(command)
export const runDockerComposeLogsFollow = (
  cwd: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCompose(cwd, ["logs", "--follow", "--tail", "0"], [Number(ExitCode(0)), 130])

// CHANGE: run docker exec and return its exit code
// WHY: allow polling for clone completion markers inside the container
// QUOTE(ТЗ): "весь процесс от и до"
// REF: user-request-2026-01-28
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exitCode(docker exec cmd) = n -> deterministic(n)
// PURITY: SHELL
// EFFECT: Effect<number, PlatformError, CommandExecutor>
// INVARIANT: stdout/stderr are suppressed for polling commands
// COMPLEXITY: O(command)
export const runDockerExecExitCode = (
  cwd: string,
  containerName: string,
  args: ReadonlyArray<string>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const command = pipe(
      Command.make("docker", "exec", containerName, ...args),
      Command.workingDirectory(cwd),
      Command.stdout("pipe"),
      Command.stderr("pipe")
    )
    const exitCode = yield* _(Command.exitCode(command))
    return Number(exitCode)
  })

// CHANGE: inspect container IP address
// WHY: enable per-container DNS mapping on the host
// QUOTE(ТЗ): "У каждого контейнера свой IP т.е свой домен"
// REF: user-request-2026-01-30-dns
// SOURCE: n/a
// FORMAT THEOREM: forall c: inspect(c) -> ip(c)
// PURITY: SHELL
// EFFECT: Effect<string, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: returns empty string when not available
// COMPLEXITY: O(command)
export const runDockerInspectContainerIp = (
  cwd: string,
  containerName: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runCommandCapture(
      {
        cwd,
        command: "docker",
        args: [
          "inspect",
          "-f",
          // Prefer the built-in `bridge` network IP when present so the printed IP
          // works from "external" containers that default to `bridge`.
          // Example output:
          //   bridge=172.17.0.4
          //   <project>_dg-<repo>-net=192.168.64.3
          String.raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`,
          containerName
        ]
      },
      [Number(ExitCode(0))],
      (exitCode) => new DockerCommandError({ exitCode })
    ),
    Effect.map((output) => {
      const lines = output
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      const entries = lines.flatMap((line) => parseInspectNetworkEntry(line))

      if (entries.length === 0) {
        return ""
      }

      const map = new Map(entries)
      return map.get("bridge") ?? entries[0]![1]
    })
  )

// CHANGE: inspect the container IP address on the default `bridge` network
// WHY: allow callers to decide whether `docker network connect bridge` is needed
// QUOTE(ТЗ): "подключиться с внешнего контейнера"
// REF: user-request-2026-02-10-bridge-ip
// SOURCE: n/a
// FORMAT THEOREM: ∀c: bridge(c) → ip_bridge(c) ≠ ""
// PURITY: SHELL
// EFFECT: Effect<string, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: returns "" when the container is not connected to `bridge`
// COMPLEXITY: O(command)
export const runDockerInspectContainerBridgeIp = (
  cwd: string,
  containerName: string
): Effect.Effect<string, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runCommandCapture(
      {
        cwd,
        command: "docker",
        args: [
          "inspect",
          "-f",
          "{{with (index .NetworkSettings.Networks \"bridge\")}}{{.IPAddress}}{{end}}",
          containerName
        ]
      },
      [Number(ExitCode(0))],
      (exitCode) => new DockerCommandError({ exitCode })
    ),
    Effect.map((output) => output.trim())
  )

// CHANGE: connect an existing container to the default `bridge` network
// WHY: allow "external" containers (which default to `bridge`) to reach services by container IP
// QUOTE(ТЗ): "Всё что запущено в докере должно быть публично наружу"
// REF: user-request-2026-02-10-public-ports
// SOURCE: n/a
// FORMAT THEOREM: ∀c: up(c) → reachable(bridge_ip(c), ports(c))
// PURITY: SHELL
// EFFECT: Effect<void, DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: does not fail the overall flow when already connected (handled by caller)
// COMPLEXITY: O(command)
export const runDockerNetworkConnectBridge = (
  cwd: string,
  containerName: string
): Effect.Effect<void, DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runCommandCapture(
      {
        cwd,
        command: "docker",
        args: ["network", "connect", "bridge", containerName]
      },
      [Number(ExitCode(0))],
      (exitCode) => new DockerCommandError({ exitCode })
    ),
    Effect.asVoid
  )

// CHANGE: check whether a Docker network already exists
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

// CHANGE: list names of running Docker containers
// WHY: support TUI filtering (e.g. stop only running docker-git containers)
// QUOTE(ТЗ): "Если я выбираю остановку контейнера значит он мне должен показывать контейнеры которые запущены"
// REF: user-request-2026-02-07-stop-only-running
// SOURCE: n/a
// FORMAT THEOREM: forall c: c in ps -> running(c)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<string>, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: result contains only non-empty container names
// COMPLEXITY: O(command)
export const runDockerPsNames = (
  cwd: string
): Effect.Effect<ReadonlyArray<string>, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runCommandCapture(
      {
        cwd,
        command: "docker",
        args: ["ps", "--format", "{{.Names}}"]
      },
      [Number(ExitCode(0))],
      (exitCode) => new CommandFailedError({ command: "docker ps", exitCode })
    ),
    Effect.map((output) =>
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    )
  )

const publishedHostPortPattern = /:(\d+)->/g

const parsePublishedHostPortsFromLine = (line: string): ReadonlyArray<number> => {
  const parsed: Array<number> = []
  for (const match of line.matchAll(publishedHostPortPattern)) {
    const rawPort = match[1]
    if (rawPort === undefined) {
      continue
    }
    const value = Number.parseInt(rawPort, 10)
    if (Number.isInteger(value) && value > 0 && value <= 65_535) {
      parsed.push(value)
    }
  }
  return parsed
}

// CHANGE: decode published host ports from `docker ps --format "{{.Ports}}"` output
// WHY: Docker can reserve host ports via NAT even when no host TCP socket is visible
// QUOTE(ТЗ): "должен просто новый порт брать под себя"
// REF: user-request-2026-02-19-port-allocation
// SOURCE: n/a
// FORMAT THEOREM: forall p in parse(output): published_by_docker(p)
// PURITY: CORE
// EFFECT: Effect<ReadonlyArray<number>, never, never>
// INVARIANT: returns unique ports in encounter order
// COMPLEXITY: O(|output|)
export const parseDockerPublishedHostPorts = (output: string): ReadonlyArray<number> => {
  const unique = new Set<number>()
  const parsed: Array<number> = []

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    for (const port of parsePublishedHostPortsFromLine(trimmed)) {
      if (!unique.has(port)) {
        unique.add(port)
        parsed.push(port)
      }
    }
  }

  return parsed
}

// CHANGE: read currently published Docker host ports from running containers
// WHY: avoid false "free port" results when Docker reserves ports without userland proxy sockets
// QUOTE(ТЗ): "а не сражаться за старый"
// REF: user-request-2026-02-19-port-allocation
// SOURCE: n/a
// FORMAT THEOREM: forall p in result: published_by_running_container(p)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<number>, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: output ports are unique
// COMPLEXITY: O(command + |stdout|)
export const runDockerPsPublishedHostPorts = (
  cwd: string
): Effect.Effect<ReadonlyArray<number>, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  pipe(
    runCommandCapture(
      {
        cwd,
        command: "docker",
        args: ["ps", "--format", "{{.Ports}}"]
      },
      [Number(ExitCode(0))],
      (exitCode) => new CommandFailedError({ command: "docker ps", exitCode })
    ),
    Effect.map((output) => parseDockerPublishedHostPorts(output))
  )
