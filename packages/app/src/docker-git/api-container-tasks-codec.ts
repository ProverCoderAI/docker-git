import { asArray, asObject, asString, type JsonValue } from "./api-json.js"

export type ApiContainerTaskKind = "ssh" | "web-terminal" | "agent" | "background" | "system"

export type ApiContainerTask = {
  readonly pid: number
  readonly ppid: number
  readonly user: string
  readonly tty: string
  readonly etime: string
  readonly etimes: number
  readonly command: string
  readonly kind: ApiContainerTaskKind
  readonly managedId?: string | undefined
  readonly logAvailable: boolean
}

export type ApiContainerTaskSnapshot = {
  readonly projectId: string
  readonly containerName: string
  readonly generatedAt: string
  readonly sshConnections: number
  readonly tasks: ReadonlyArray<ApiContainerTask>
}

const readNumber = (value: JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const readBoolean = (value: JsonValue | undefined): boolean | null => typeof value === "boolean" ? value : null

const isTaskKind = (value: string): value is ApiContainerTaskKind =>
  ["ssh", "web-terminal", "agent", "background", "system"].includes(value)

type DecodedContainerTaskFields = {
  readonly command: string | null
  readonly etime: string | null
  readonly etimes: number | null
  readonly kind: string | null
  readonly logAvailable: boolean | null
  readonly managedId: string | undefined
  readonly pid: number | null
  readonly ppid: number | null
  readonly tty: string | null
  readonly user: string | null
}

const readContainerTaskFields = (object: NonNullable<ReturnType<typeof asObject>>): DecodedContainerTaskFields => ({
  command: asString(object["command"]),
  etime: asString(object["etime"]),
  etimes: readNumber(object["etimes"]),
  kind: asString(object["kind"]),
  logAvailable: readBoolean(object["logAvailable"]),
  managedId: asString(object["managedId"]) ?? undefined,
  pid: readNumber(object["pid"]),
  ppid: readNumber(object["ppid"]),
  tty: asString(object["tty"]),
  user: asString(object["user"])
})

const hasCompleteContainerTaskFields = (
  fields: DecodedContainerTaskFields
): fields is DecodedContainerTaskFields & {
  readonly command: string
  readonly etime: string
  readonly etimes: number
  readonly kind: ApiContainerTaskKind
  readonly logAvailable: boolean
  readonly pid: number
  readonly ppid: number
  readonly tty: string
  readonly user: string
} =>
  [
    fields.command,
    fields.etime,
    fields.etimes,
    fields.logAvailable,
    fields.pid,
    fields.ppid,
    fields.tty,
    fields.user
  ].every((field) => field !== null) &&
  fields.kind !== null &&
  isTaskKind(fields.kind)

const decodeContainerTask = (value: JsonValue): ApiContainerTask | null => {
  const object = asObject(value)
  if (object === null) {
    return null
  }
  const fields = readContainerTaskFields(object)
  if (!hasCompleteContainerTaskFields(fields)) {
    return null
  }

  return {
    command: fields.command,
    etime: fields.etime,
    etimes: fields.etimes,
    kind: fields.kind,
    logAvailable: fields.logAvailable,
    managedId: fields.managedId,
    pid: fields.pid,
    ppid: fields.ppid,
    tty: fields.tty,
    user: fields.user
  }
}

export const decodeContainerTaskSnapshot = (payload: JsonValue): ApiContainerTaskSnapshot | null => {
  const outer = asObject(payload)
  const value = outer?.["snapshot"] ?? payload
  const object = asObject(value)
  if (object === null) {
    return null
  }

  const projectId = asString(object["projectId"])
  const containerName = asString(object["containerName"])
  const generatedAt = asString(object["generatedAt"])
  const sshConnections = readNumber(object["sshConnections"])
  if (projectId === null || containerName === null || generatedAt === null || sshConnections === null) {
    return null
  }

  return {
    projectId,
    containerName,
    generatedAt,
    sshConnections,
    tasks: asArray(object["tasks"])
      .map((item) => decodeContainerTask(item))
      .filter((task): task is ApiContainerTask => task !== null)
  }
}

const padRight = (value: string, width: number): string =>
  value.length >= width ? value.slice(0, width) : `${value}${" ".repeat(width - value.length)}`

const truncate = (value: string, width: number): string =>
  value.length <= width ? value : `${value.slice(0, Math.max(0, width - 3))}...`

const taskRow = (task: ApiContainerTask): string =>
  [
    padRight(String(task.pid), 7),
    padRight(task.kind, 12),
    padRight(truncate(task.tty, 10), 10),
    padRight(truncate(task.etime, 10), 10),
    padRight(task.logAvailable ? "yes" : "no", 4),
    task.command
  ].join(" ")

// CHANGE: render the shared task snapshot for host CLI `sessions`.
// WHY: CLI and WEB must expose the same runtime task-manager semantics.
// QUOTE(ТЗ): "мы можем иметь 1 в 1 логику что в CLI что на WEB?"
// REF: user-message-2026-04-22-container-task-manager
// SOURCE: n/a
// FORMAT THEOREM: forall snapshot: render(snapshot) is deterministic
// PURITY: CORE
// EFFECT: none
// INVARIANT: every rendered row corresponds to exactly one decoded task
// COMPLEXITY: O(n)
export const renderContainerTaskSnapshot = (snapshot: ApiContainerTaskSnapshot): string => {
  const header = [
    `Project: ${snapshot.projectId}`,
    `Container: ${snapshot.containerName}`,
    `SSH connections: ${snapshot.sshConnections}`,
    "",
    `${padRight("PID", 7)} ${padRight("KIND", 12)} ${padRight("TTY", 10)} ${padRight("ETIME", 10)} ${
      padRight("LOG", 4)
    } COMMAND`
  ]
  const rows = snapshot.tasks.length === 0
    ? ["(no user tasks)"]
    : snapshot.tasks.map((task) => taskRow(task))
  return [...header, ...rows].join("\n")
}
