import * as Schema from "effect/Schema"

const ProjectStatusSchema = Schema.Literal("running", "stopped", "unknown")
const RecreatePhaseSchema = Schema.Literal("idle", "running", "success", "error")

const RecreateStatusSchema = Schema.Struct({
  phase: RecreatePhaseSchema,
  message: Schema.String,
  updatedAt: Schema.String
})

const ProjectSummarySchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  repoUrl: Schema.String,
  repoRef: Schema.String,
  status: ProjectStatusSchema,
  statusLabel: Schema.String
})

const PortSchema = Schema.Struct({
  port: Schema.Number,
  label: Schema.String
})

const JobSchema = Schema.Struct({
  pid: Schema.Number,
  tty: Schema.String,
  cmd: Schema.String,
  elapsed: Schema.String
})

const ErrorResponseSchema = Schema.Struct({
  error: Schema.String
})

const ProjectDetailsSchema = Schema.Union(
  ErrorResponseSchema,
  Schema.Struct({
    id: Schema.String,
    displayName: Schema.String,
    repoUrl: Schema.String,
    repoRef: Schema.String,
    status: ProjectStatusSchema,
    statusLabel: Schema.String,
    recreateStatus: Schema.optional(RecreateStatusSchema),
    ssh: Schema.String,
    sshCommand: Schema.String,
    projectDir: Schema.String,
    containerName: Schema.String,
    serviceName: Schema.String,
    targetDir: Schema.String,
    ip: Schema.String,
    ports: Schema.Array(PortSchema),
    jobs: Schema.Array(JobSchema),
    logs: Schema.Array(Schema.String)
  })
)

const ProjectListResponseSchema = Schema.Union(
  ErrorResponseSchema,
  Schema.Struct({
    projects: Schema.Array(ProjectSummarySchema)
  })
)

const ExecResponseSchema = Schema.Union(
  ErrorResponseSchema,
  Schema.Struct({
    output: Schema.String
  })
)

const TtySessionSchema = Schema.Struct({
  user: Schema.String,
  tty: Schema.String,
  date: Schema.String,
  time: Schema.String,
  idle: Schema.String,
  pid: Schema.Number,
  host: Schema.String
})

const ProcessInfoSchema = Schema.Struct({
  pid: Schema.Number,
  ppid: Schema.Number,
  tty: Schema.String,
  stat: Schema.String,
  start: Schema.String,
  command: Schema.String
})

const ProjectProcessSnapshotSchema = Schema.Union(
  ErrorResponseSchema,
  Schema.Struct({
    capturedAt: Schema.String,
    ttySessions: Schema.Array(TtySessionSchema),
    ttyProcesses: Schema.Array(ProcessInfoSchema),
    backgroundProcesses: Schema.Array(ProcessInfoSchema)
  })
)

const TerminalSessionStatusSchema = Schema.Literal("connecting", "connected", "detached")

const TerminalSessionModeSchema = Schema.Literal("default", "recreate")

const TerminalSessionSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  displayName: Schema.String,
  containerName: Schema.optional(Schema.String),
  mode: TerminalSessionModeSchema,
  source: Schema.String,
  status: TerminalSessionStatusSchema,
  connectedAt: Schema.String,
  updatedAt: Schema.String
})

const TerminalSessionsResponseSchema = Schema.Union(
  ErrorResponseSchema,
  Schema.Struct({
    sessions: Schema.Array(TerminalSessionSchema)
  })
)

export const ApiSchema = {
  ProjectListResponse: ProjectListResponseSchema,
  ProjectDetails: ProjectDetailsSchema,
  ExecResponse: ExecResponseSchema,
  ErrorResponse: ErrorResponseSchema,
  TerminalSessions: TerminalSessionsResponseSchema,
  ProjectProcessSnapshot: ProjectProcessSnapshotSchema
}
