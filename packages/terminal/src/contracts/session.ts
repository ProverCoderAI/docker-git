import * as Schema from "@effect/schema/Schema"

/**
 * Terminal lifecycle status literals shared by server and clients.
 *
 * @pure true
 * @invariant status ∈ {"ready","attached","exited","failed"}
 * @complexity O(1)
 */
// CHANGE: expose shared terminal session status schema.
// WHY: API, browser, and CLI must decode one status vocabulary.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: decode(status) succeeds ⇔ status ∈ TerminalSessionStatus
// PURITY: CORE
// INVARIANT: status schema is a closed literal union.
// COMPLEXITY: O(1)/O(1)
export const TerminalSessionStatusSchema = Schema.Union(
  Schema.Literal("ready"),
  Schema.Literal("attached"),
  Schema.Literal("exited"),
  Schema.Literal("failed")
)

/**
 * Terminal session state exchanged over HTTP/WebSocket boundaries.
 *
 * @pure true
 * @invariant id, projectId, sshCommand, createdAt are required strings.
 * @invariant optional lifecycle fields may be absent but keep their declared type when present.
 * @complexity O(n) where n = encoded field count.
 */
// CHANGE: define the shared terminal session schema.
// WHY: API and UI should not maintain duplicate session contracts.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: decode(session) succeeds → session.status ∈ TerminalSessionStatus
// PURITY: CORE
// INVARIANT: decoded sessions have a known lifecycle status.
// COMPLEXITY: O(n)/O(n)
export const TerminalSessionSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  sshCommand: Schema.String,
  status: TerminalSessionStatusSchema,
  createdAt: Schema.String,
  attachedClients: Schema.optional(Schema.Number),
  startedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  signal: Schema.optional(Schema.Number)
})

/**
 * Client-to-server terminal message payload schema.
 *
 * @pure true
 * @invariant message.type determines the exact required payload fields.
 * @complexity O(n) where n = encoded field count.
 */
// CHANGE: define shared terminal client message payloads.
// WHY: browser/CLI input, resize, image, and close messages need one decoder.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: decode(clientMessage) succeeds → type ∈ {"input","resize","image","close"}
// PURITY: CORE
// INVARIANT: client message schema is a discriminated union by type.
// COMPLEXITY: O(n)/O(n)
export const TerminalClientMessagePayloadSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("input"),
    data: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal("resize"),
    cols: Schema.Number,
    rows: Schema.Number
  }),
  Schema.Struct({
    type: Schema.Literal("image"),
    data: Schema.String,
    mediaType: Schema.String,
    name: Schema.String,
    size: Schema.Number
  }),
  Schema.Struct({
    type: Schema.Literal("close")
  })
)

/**
 * Server-to-client terminal message payload schema.
 *
 * @pure true
 * @invariant message.type determines the exact required payload fields.
 * @complexity O(n) where n = encoded field count.
 */
const TerminalServerMessagePayloadSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("ready"),
    session: TerminalSessionSchema
  }),
  Schema.Struct({
    type: Schema.Literal("output"),
    data: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal("exit"),
    exitCode: Schema.NullOr(Schema.Number),
    signal: Schema.NullOr(Schema.Number)
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    message: Schema.String
  })
)

/**
 * JSON decoder for client terminal messages.
 *
 * @pure true
 * @invariant successful decode returns TerminalClientMessage.
 * @complexity O(n) where n = JSON input length.
 */
// CHANGE: expose JSON codec for terminal client messages.
// WHY: WebSocket adapters should share one parser.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: parseJson(clientPayloadJson) = TerminalClientMessage | ParseError
// PURITY: CORE
// INVARIANT: codec parses only the shared client payload schema.
// COMPLEXITY: O(n)/O(n)
export const TerminalClientMessageSchema = Schema.parseJson(
  TerminalClientMessagePayloadSchema
)

/**
 * JSON decoder for server terminal messages.
 *
 * @pure true
 * @invariant successful decode returns TerminalServerMessage.
 * @complexity O(n) where n = JSON input length.
 */
// CHANGE: expose JSON codec for terminal server messages.
// WHY: clients should share one parser for ready/output/exit/error events.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: parseJson(serverPayloadJson) = TerminalServerMessage | ParseError
// PURITY: CORE
// INVARIANT: codec parses only the shared server payload schema.
// COMPLEXITY: O(n)/O(n)
export const TerminalServerMessageSchema = Schema.parseJson(
  TerminalServerMessagePayloadSchema
)

/** Shared terminal session status type derived from TerminalSessionStatusSchema. */
export type TerminalSessionStatus = Schema.Schema.Type<
  typeof TerminalSessionStatusSchema
>
/** Shared terminal session type derived from TerminalSessionSchema. */
export type TerminalSession = Schema.Schema.Type<typeof TerminalSessionSchema>
/** Shared client message type derived from TerminalClientMessagePayloadSchema. */
export type TerminalClientMessage = Schema.Schema.Type<
  typeof TerminalClientMessagePayloadSchema
>
/** Shared server message type derived from TerminalServerMessagePayloadSchema. */
export type TerminalServerMessage = Schema.Schema.Type<
  typeof TerminalServerMessagePayloadSchema
>
