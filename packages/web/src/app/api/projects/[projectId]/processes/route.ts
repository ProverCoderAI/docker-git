import { NextResponse } from "next/server"
import { Either } from "effect"
import * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"

import { execProjectCommand } from "../../../../../server/docker-git"
import { runEffect } from "../../../../../server/runtime"

export const dynamic = "force-dynamic"

type RouteParams = {
  readonly params: {
    readonly projectId: string
  }
}

type TtySession = {
  readonly user: string
  readonly tty: string
  readonly date: string
  readonly time: string
  readonly idle: string
  readonly pid: number
  readonly host: string
}

type ProcessInfo = {
  readonly pid: number
  readonly ppid: number
  readonly tty: string
  readonly stat: string
  readonly start: string
  readonly command: string
}

const EmptySchema = Schema.Struct({})

const formatParseError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatIssueSync(error.issue)

const parseWho = (raw: string): ReadonlyArray<TtySession> => {
  const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
  const sessions: TtySession[] = []
  for (const line of lines) {
    const match = /^(?<user>\S+)\s+(?<tty>\S+)\s+(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2})\s+(?<idle>\S+)\s+(?<pid>\d+)\s+\((?<host>[^)]*)\)$/u.exec(line)
    if (!match?.groups) {
      continue
    }
    sessions.push({
      user: match.groups.user,
      tty: match.groups.tty,
      date: match.groups.date,
      time: match.groups.time,
      idle: match.groups.idle,
      pid: Number(match.groups.pid),
      host: match.groups.host
    })
  }
  return sessions
}

const parsePs = (raw: string): ReadonlyArray<ProcessInfo> => {
  const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
  const processes: ProcessInfo[] = []
  for (const line of lines) {
    const match =
      /^\s*(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<tty>\S+)\s+(?<stat>\S+)\s+(?<start>\S+)\s+(?<command>.+)$/u.exec(
        line
      )
    if (!match?.groups) {
      continue
    }
    processes.push({
      pid: Number(match.groups.pid),
      ppid: Number(match.groups.ppid),
      tty: match.groups.tty,
      stat: match.groups.stat,
      start: match.groups.start,
      command: match.groups.command
    })
  }
  return processes
}

const isBackgroundDevProcess = (process: ProcessInfo): boolean => {
  if (process.tty !== "?") {
    return false
  }
  return /vite|next dev|npm run dev|pnpm run dev|bunx?\s+vite|esbuild/u.test(process.command)
}

// CHANGE: expose live SSH TTY sessions and background dev processes
// WHY: allow the UI to show agent-run terminals and background servers
// QUOTE(ТЗ): "Мне надо иметь возможность это видеть"
// REF: user-request-2026-02-04-process-visibility
// SOURCE: n/a
// FORMAT THEOREM: ∀p: processes(p) → visible(p)
// PURITY: SHELL
// EFFECT: Effect<unknown, string, never>
// INVARIANT: ids are numeric
// COMPLEXITY: O(n)
export const GET = async (_request: Request, { params }: RouteParams) => {
  const { projectId } = await Promise.resolve(params)
  const decodedProjectId = decodeURIComponent(projectId)

  return Either.match(Schema.decodeUnknownEither(EmptySchema)({}), {
    onLeft: (error) =>
      NextResponse.json(
        { error: formatParseError(error) },
        { status: 400 }
      ),
    onRight: async () => {
      try {
        const whoRaw = await runEffect(
          execProjectCommand(decodedProjectId, "who -u --time-format=iso || who -u")
        )
        const psRaw = await runEffect(
          execProjectCommand(
            decodedProjectId,
            "ps -eo pid,ppid,tty,stat,start,command --sort=start_time"
          )
        )
        const ttySessions = parseWho(whoRaw)
        const processes = parsePs(psRaw)
        const ttyProcesses = processes.filter((item) => item.tty !== "?")
        const backgroundProcesses = processes.filter(isBackgroundDevProcess)

        return NextResponse.json({
          capturedAt: new Date().toISOString(),
          ttySessions,
          ttyProcesses,
          backgroundProcesses
        })
      } catch (error: unknown) {
        return NextResponse.json({ error: String(error) }, { status: 500 })
      }
    }
  })
}
