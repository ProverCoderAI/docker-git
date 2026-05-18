import { defaultProjectsRoot } from "@effect-template/lib/usecases/path-helpers"
import { NodeContext } from "@effect/platform-node"
import { Duration, Effect } from "effect"
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign as signWithPrivateKey
} from "node:crypto"
import { promises as fs } from "node:fs"
import { dirname, join } from "node:path"

import type {
  ActivityPubFollowActivity,
  ActivityPubOrderedCollection,
  ActivityPubPerson,
  ActivityPubPublicKey,
  AgentProvider,
  AgentSession,
  CreateFollowRequest,
  CreateProjectAccepted,
  CreateProjectRequest,
  ExchangePollRequest,
  ExchangeSubscribeRequest,
  FederationExchangeEvent,
  FederationExchangeStatus,
  FederationInboxResult,
  FederationIssueRecord,
  FollowStatus,
  FollowSubscription,
  FollowSubscriptionCreated,
  ForgeFedTicket,
  ForgeFedTicketSource,
  ProjectDetails
} from "../api/contracts.js"
import {
  activityForgeFedJsonLdContext,
  activityStreamsJsonLdContext,
  actorJsonLdContext,
  federationJsonLdContentType,
  forgeFedJsonLdContext
} from "../api/contracts.js"
import { ApiBadRequestError, ApiConflictError, ApiNotFoundError } from "../api/errors.js"
import { getAgent, readAgentLogs, startAgent } from "./agents.js"
import { createProjectFromRequest } from "./projects.js"

type JsonRecord = { readonly [key: string]: unknown }

type LocalActorKeys = {
  readonly publicKeyPem: string
  readonly privateKeyPem: string
}

type StoredFederationState = {
  readonly version: 1
  readonly issues: ReadonlyArray<FederationIssueRecord>
  readonly follows: ReadonlyArray<FollowSubscription>
  readonly processedOutboxItems: ReadonlyArray<string>
  readonly exchangeEvents?: ReadonlyArray<FederationExchangeEvent> | undefined
  readonly localActorKeys?: LocalActorKeys | undefined
}

type RemoteActorDocument = {
  readonly id: string
  readonly inbox?: string | undefined
  readonly outbox: string
  readonly followers?: string | undefined
  readonly sharedInbox?: string | undefined
  readonly publicKeyId?: string | undefined
  readonly publicKeyPem?: string | undefined
}

type ExchangeTarget = {
  readonly name: string
  readonly remoteActor: string
  readonly candidateActors: ReadonlyArray<string>
  readonly queue: string
}

type IngestOptions = {
  readonly scheduleTask?: boolean | undefined
  readonly context?: FederationContext | undefined
  readonly subscription?: FollowSubscription | undefined
  readonly inheritedJsonLdContext?: unknown
}

export type FederationContextInput = {
  readonly publicOrigin: string
  readonly actorUsername?: string | undefined
}

export type FederationContext = {
  readonly publicOrigin: string
  readonly actorUsername: string
  readonly actorId: string
  readonly inbox: string
  readonly outbox: string
  readonly followers: string
  readonly following: string
  readonly liked: string
  readonly followsActivityPrefix: string
  readonly exchangeActivityPrefix: string
}

const defaultActorUsername = "docker-git"
const activityJsonContentType = "application/activity+json"
const activityAcceptHeader = `${federationJsonLdContentType}, ${activityJsonContentType}, application/json`
const defaultExchangeQueue = "code"
const exchangeEventLimit = 100

const issueStore: Map<string, FederationIssueRecord> = new Map()
const followStore: Map<string, FollowSubscription> = new Map()
const followByActivityId: Map<string, string> = new Map()
const followByActorObject: Map<string, string> = new Map()
const processedOutboxItems: Set<string> = new Set()
let exchangeEvents: ReadonlyArray<FederationExchangeEvent> = []
let localActorKeys: LocalActorKeys | null = null
let stateLoaded = false

const nowIso = (): string => new Date().toISOString()

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asRecord = (value: unknown): JsonRecord | null =>
  isRecord(value) ? value : null

/**
 * Extracts string JSON-LD context entries from a boundary value.
 *
 * @param value - Unknown ActivityPub or ForgeFed @context field value.
 * @returns Immutable set of string context identifiers; unsupported shapes produce an empty set.
 *
 * @pure true
 * @effect none
 * @invariant every returned element is a string from value, and no non-string value is introduced.
 * @precondition value may be any boundary value.
 * @postcondition result contains value iff value is a string; result contains each string item iff value is an array.
 * @complexity O(n) time and O(n) space where n is array length, or O(1) for non-array values.
 * @throws Never.
 */
const jsonLdContextValues = (value: unknown): ReadonlySet<string> => {
  if (typeof value === "string") {
    return new Set([value])
  }
  if (!Array.isArray(value)) {
    return new Set()
  }
  return new Set(value.filter((item): item is string => typeof item === "string"))
}

/**
 * Checks whether a JSON-LD context value contains both required federation contexts.
 *
 * @param value - Unknown @context value to validate.
 * @returns True when ActivityStreams and ForgeFed context identifiers are both present.
 *
 * @pure true
 * @effect none
 * @invariant result is true iff jsonLdContextValues(value) contains both required context URIs.
 * @precondition value may be any boundary value.
 * @postcondition result does not mutate or normalize the input value.
 * @complexity O(n) time and O(n) space where n is array length, or O(1) for non-array values.
 * @throws Never.
 */
const hasFederationJsonLdContext = (value: unknown): boolean => {
  const contexts = jsonLdContextValues(value)
  return contexts.has(activityStreamsJsonLdContext) && contexts.has(forgeFedJsonLdContext)
}

/**
 * Requires a top-level federation document to declare or inherit valid JSON-LD contexts.
 *
 * @param payload - Parsed JSON object representing the federation document being checked.
 * @param label - Human-readable document label used in the typed validation error.
 * @param inheritedContext - Optional parent @context accepted when payload omits its own @context.
 * @returns Effect that succeeds when ActivityStreams and ForgeFed contexts are available.
 *
 * @pure false
 * @effect Constructs a typed ApiBadRequestError in the Effect error channel when validation fails.
 * @invariant success implies payload.@context or inheritedContext contains ActivityStreams and ForgeFed contexts.
 * @precondition payload is a decoded JSON object at the federation boundary.
 * @postcondition failure message identifies the invalid document label.
 * @complexity O(n) time and O(n) space where n is the checked context array length.
 * @throws Never; validation failures are represented as ApiBadRequestError.
 */
const requireFederationJsonLdContext = (
  payload: JsonRecord,
  label: string,
  inheritedContext?: unknown
): Effect.Effect<void, ApiBadRequestError> => {
  const context = payload["@context"]
  const valid = context === undefined
    ? hasFederationJsonLdContext(inheritedContext)
    : hasFederationJsonLdContext(context)

  return valid
    ? Effect.void
    : Effect.fail(
      new ApiBadRequestError({
        message: `${label} must include JSON-LD @context with ActivityStreams and ForgeFed contexts.`
      })
    )
}

/**
 * Requires nested federation objects to use valid JSON-LD context only when they override inheritance.
 *
 * @param payload - Parsed nested JSON object being checked.
 * @param label - Human-readable nested object label used in the typed validation error.
 * @param inheritedContext - Parent @context available to nested objects that omit @context.
 * @returns Effect that succeeds when the nested object inherits context or declares a valid override.
 *
 * @pure false
 * @effect Delegates invalid explicit context failures to requireFederationJsonLdContext.
 * @invariant missing nested @context is accepted, explicit nested @context must contain ActivityStreams and ForgeFed contexts.
 * @precondition payload is a decoded nested JSON object and inheritedContext is the parent document context.
 * @postcondition success preserves JSON-LD inheritance semantics for nested ForgeFed objects.
 * @complexity O(n) time and O(n) space where n is the explicit nested context array length, or O(1) if omitted.
 * @throws Never; validation failures are represented as ApiBadRequestError.
 */
const requireNestedFederationJsonLdContext = (
  payload: JsonRecord,
  label: string,
  inheritedContext: unknown
): Effect.Effect<void, ApiBadRequestError> =>
  payload["@context"] === undefined
    ? Effect.void
    : requireFederationJsonLdContext(payload, label, inheritedContext)

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const readOptionalString = (record: JsonRecord, key: string): string | undefined =>
  asNonEmptyString(record[key]) ?? undefined

type FederationExchangeEventDraft = Omit<FederationExchangeEvent, "id" | "occurredAt"> & {
  readonly occurredAt?: string | undefined
}

const exchangeSubscriptionTarget = (subscription: FollowSubscription): string =>
  subscription.subscriptionName ?? subscription.remoteActor ?? subscription.object

const findExchangeSubscriptionByActor = (actor: string | undefined): FollowSubscription | undefined =>
  actor === undefined
    ? undefined
    : [...followStore.values()].find((subscription) =>
      subscription.remoteOutbox !== undefined &&
        (subscription.remoteActor === actor || subscription.object === actor)
    )

const recordExchangeEvent = (event: FederationExchangeEventDraft): FederationExchangeEvent => {
  const { occurredAt, ...details } = event
  const stored: FederationExchangeEvent = {
    id: randomUUID(),
    occurredAt: occurredAt ?? nowIso(),
    ...details
  }
  exchangeEvents = [...exchangeEvents, stored].slice(-exchangeEventLimit)
  persistFederationStateBestEffort()
  return stored
}

const readRequiredString = (
  record: JsonRecord,
  key: string,
  label: string
): Effect.Effect<string, ApiBadRequestError> => {
  const value = asNonEmptyString(record[key])
  return value !== null
    ? Effect.succeed(value)
    : Effect.fail(
      new ApiBadRequestError({
        message: `${label} must include a non-empty "${key}" field.`
      })
    )
}

const readTypeTags = (record: JsonRecord): ReadonlyArray<string> => {
  const raw = record["type"]
  if (typeof raw === "string") {
    const value = raw.trim()
    return value.length > 0 ? [value] : []
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }
  return []
}

const hasType = (record: JsonRecord, expected: string): boolean =>
  readTypeTags(record).includes(expected)

const readObjectRecord = (
  payload: JsonRecord,
  key: string,
  label: string
): Effect.Effect<JsonRecord, ApiBadRequestError> => {
  const objectRecord = asRecord(payload[key])
  return objectRecord !== null
    ? Effect.succeed(objectRecord)
    : Effect.fail(
      new ApiBadRequestError({
        message: `${label} must include an object "${key}" payload.`
      })
    )
}

const stateFilePath = (): string =>
  join(defaultProjectsRoot(process.cwd()), ".orch", "state", "federation.json")

const followKey = (actor: string, object: string): string => `${actor}\u0000${object}`

const cleanToRecipients = (
  raw: ReadonlyArray<string> | undefined
): ReadonlyArray<string> =>
  (raw ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

const looksLikeAbsoluteUrl = (value: string): boolean =>
  /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)

const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen: Set<string> = new Set()
  return values.filter((value) => {
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    return true
  })
}

const shellEscape = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const normalizeOrigin = (
  raw: string
): Effect.Effect<string, ApiBadRequestError> =>
  Effect.try({
    try: () => {
      const trimmed = raw.trim()
      if (trimmed.length === 0) {
        throw new Error("Public federation domain must be non-empty.")
      }
      const candidate = looksLikeAbsoluteUrl(trimmed) ? trimmed : `https://${trimmed}`
      const parsed = new URL(candidate)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Public federation domain must use http:// or https://.")
      }
      return `${parsed.protocol}//${parsed.host}`
    },
    catch: (cause) =>
      new ApiBadRequestError({
        message: cause instanceof Error ? cause.message : String(cause)
      })
  })

const normalizeActorUsername = (
  raw: string | undefined
): Effect.Effect<string, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    const value = raw?.trim() ?? defaultActorUsername
    const username = value.length === 0 ? defaultActorUsername : value
    if (/[\s/]/.test(username)) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "Federation actor username must not include spaces or slashes."
          })
        )
      )
    }
    return username
  })

const normalizeHttpUrl = (
  raw: string,
  context: FederationContext,
  label: string
): Effect.Effect<string, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    const value = raw.trim()
    if (value.length === 0) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: `${label} must be non-empty.`
          })
        )
      )
    }

    if (value.startsWith("/")) {
      return `${context.publicOrigin}${value}`
    }

    const candidate = looksLikeAbsoluteUrl(value)
      ? value
      : value.includes(".")
        ? `https://${value}`
        : null

    if (candidate === null) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: `${label} must be an absolute URL or "/path" relative to the configured domain.`
          })
        )
      )
    }

    return yield* _(
      Effect.try({
        try: () => {
          const parsed = new URL(candidate)
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error(`${label} must use http:// or https://.`)
          }

          if (parsed.hostname.endsWith(".example")) {
            const replacement = new URL(context.publicOrigin)
            parsed.protocol = replacement.protocol
            parsed.host = replacement.host
          }

          return parsed.toString()
        },
        catch: (cause) =>
          new ApiBadRequestError({
            message: cause instanceof Error ? cause.message : String(cause)
          })
      })
    )
  })

const serializeState = (): StoredFederationState => ({
  version: 1,
  issues: [...issueStore.values()],
  follows: [...followStore.values()],
  processedOutboxItems: [...processedOutboxItems],
  exchangeEvents,
  ...(localActorKeys === null ? {} : { localActorKeys })
})

const persistFederationState = (): Effect.Effect<void, unknown> => {
  const filePath = stateFilePath()
  const serialized = `${JSON.stringify(serializeState(), null, 2)}\n`
  return Effect.tryPromise({
    try: () => fs.mkdir(dirname(filePath), { recursive: true }),
    catch: (cause) => cause
  }).pipe(
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: () => fs.writeFile(filePath, serialized, "utf8"),
        catch: (cause) => cause
      })
    ),
    Effect.asVoid
  )
}

const persistFederationStateBestEffort = (): void => {
  Effect.runFork(persistFederationState().pipe(Effect.ignore))
}

const indexFollow = (subscription: FollowSubscription): void => {
  followStore.set(subscription.id, subscription)
  followByActivityId.set(subscription.activityId, subscription.id)
  followByActorObject.set(followKey(subscription.actor, subscription.object), subscription.id)
}

const upsertIssue = (issue: FederationIssueRecord): FederationIssueRecord => {
  issueStore.set(issue.issueId, issue)
  persistFederationStateBestEffort()
  return issue
}

const updateIssue = (
  issue: FederationIssueRecord,
  patch: Partial<FederationIssueRecord>
): FederationIssueRecord =>
  upsertIssue({
    ...issue,
    ...patch,
    updatedAt: nowIso()
  })

const ensureLocalActorKeys = (): LocalActorKeys => {
  if (localActorKeys !== null) {
    return localActorKeys
  }
  const generated = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "pkcs1",
      format: "pem"
    },
    privateKeyEncoding: {
      type: "pkcs1",
      format: "pem"
    }
  })
  localActorKeys = {
    publicKeyPem: generated.publicKey,
    privateKeyPem: generated.privateKey
  }
  persistFederationStateBestEffort()
  return localActorKeys
}

const hydrateState = (state: StoredFederationState): void => {
  issueStore.clear()
  followStore.clear()
  followByActivityId.clear()
  followByActorObject.clear()
  processedOutboxItems.clear()
  exchangeEvents = []

  for (const issue of state.issues ?? []) {
    issueStore.set(issue.issueId, issue)
  }
  for (const follow of state.follows ?? []) {
    indexFollow(follow)
  }
  for (const item of state.processedOutboxItems ?? []) {
    processedOutboxItems.add(item)
  }
  exchangeEvents = [...(state.exchangeEvents ?? [])].slice(-exchangeEventLimit)
  localActorKeys = state.localActorKeys ?? null
}

export const initializeFederationState = () =>
  Effect.tryPromise({
    try: () => fs.readFile(stateFilePath(), "utf8"),
    catch: () => new Error("Federation state not found or invalid.")
  }).pipe(
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => {
          const parsed = JSON.parse(raw) as StoredFederationState
          hydrateState(parsed)
          stateLoaded = true
        },
        catch: () => new Error("Federation state not found or invalid.")
      })
    ),
    Effect.catchAll(() =>
      Effect.sync(() => {
        stateLoaded = true
        ensureLocalActorKeys()
      })
    ),
    Effect.asVoid
  )

const ensureStateLoaded = () =>
  stateLoaded ? Effect.void : initializeFederationState()

export const makeFederationContext = (
  input: FederationContextInput
): Effect.Effect<FederationContext, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    const publicOrigin = yield* _(normalizeOrigin(input.publicOrigin))
    const actorUsername = yield* _(normalizeActorUsername(input.actorUsername))

    return {
      publicOrigin,
      actorUsername,
      actorId: `${publicOrigin}/federation/actor`,
      inbox: `${publicOrigin}/federation/inbox`,
      outbox: `${publicOrigin}/federation/outbox`,
      followers: `${publicOrigin}/federation/followers`,
      following: `${publicOrigin}/federation/following`,
      liked: `${publicOrigin}/federation/liked`,
      followsActivityPrefix: `${publicOrigin}/federation/activities/follows`,
      exchangeActivityPrefix: `${publicOrigin}/federation/activities/exchange`
    }
  })

const defaultFederationContext = () =>
  makeFederationContext({
    publicOrigin:
      process.env["DOCKER_GIT_FEDERATION_PUBLIC_ORIGIN"] ??
      process.env["DOCKER_GIT_API_PUBLIC_URL"] ??
      "http://localhost:3334",
    actorUsername: process.env["DOCKER_GIT_FEDERATION_ACTOR"] ?? defaultActorUsername
  })

const publicKeyForContext = (context: FederationContext): ActivityPubPublicKey => ({
  id: `${context.actorId}#main-key`,
  owner: context.actorId,
  publicKeyPem: ensureLocalActorKeys().publicKeyPem
})

export const makeFederationActorDocument = (
  context: FederationContext
): ActivityPubPerson => ({
  "@context": actorJsonLdContext,
  type: "Person",
  id: context.actorId,
  name: "docker-git task feed",
  preferredUsername: context.actorUsername,
  summary: "docker-git ActivityPub actor for task and issue stream subscriptions.",
  inbox: context.inbox,
  outbox: context.outbox,
  followers: context.followers,
  following: context.following,
  liked: context.liked,
  publicKey: publicKeyForContext(context),
  endpoints: {
    sharedInbox: context.inbox
  }
})

export const makeFederationOutboxCollection = (
  context: FederationContext
): ActivityPubOrderedCollection => {
  const orderedItems = listFollowSubscriptions().map((subscription) => subscription.activity)
  return {
    "@context": activityForgeFedJsonLdContext,
    type: "OrderedCollection",
    id: context.outbox,
    totalItems: orderedItems.length,
    orderedItems
  }
}

export const makeFederationFollowersCollection = (
  context: FederationContext
): ActivityPubOrderedCollection => ({
  "@context": activityForgeFedJsonLdContext,
  type: "OrderedCollection",
  id: context.followers,
  totalItems: 0,
  orderedItems: []
})

export const makeFederationFollowingCollection = (
  context: FederationContext
): ActivityPubOrderedCollection => {
  const orderedItems = listFollowSubscriptions()
    .filter((subscription) => subscription.status === "accepted")
    .map((subscription) => subscription.object)

  return {
    "@context": activityForgeFedJsonLdContext,
    type: "OrderedCollection",
    id: context.following,
    totalItems: orderedItems.length,
    orderedItems
  }
}

export const makeFederationLikedCollection = (
  context: FederationContext
): ActivityPubOrderedCollection => ({
  "@context": activityForgeFedJsonLdContext,
  type: "OrderedCollection",
  id: context.liked,
  totalItems: 0,
  orderedItems: []
})

const readTicketSource = (payload: JsonRecord): string | ForgeFedTicketSource | undefined => {
  const raw = payload["source"]
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim()
  }
  const record = asRecord(raw)
  if (record === null) {
    return undefined
  }
  const content = readOptionalString(record, "content")
  const mediaType = readOptionalString(record, "mediaType")
  return content === undefined && mediaType === undefined ? undefined : { content, mediaType }
}

const readTicketAttachment = (payload: JsonRecord): ReadonlyArray<unknown> | undefined => {
  const raw = payload["attachment"]
  return Array.isArray(raw) ? raw : undefined
}

const parseTicket = (
  payload: JsonRecord,
  inheritedJsonLdContext: unknown
): Effect.Effect<ForgeFedTicket, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    yield* _(requireNestedFederationJsonLdContext(payload, "ForgeFed ticket", inheritedJsonLdContext))
    if (!hasType(payload, "Ticket")) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "ForgeFed ticket payload must include type=\"Ticket\"."
          })
        )
      )
    }

    const attributedTo = yield* _(readRequiredString(payload, "attributedTo", "ForgeFed ticket"))
    const summary = yield* _(readRequiredString(payload, "summary", "ForgeFed ticket"))
    const content = yield* _(readRequiredString(payload, "content", "ForgeFed ticket"))
    const id = readOptionalString(payload, "id") ?? `urn:docker-git:forgefed:ticket:${randomUUID()}`

    return {
      id,
      attributedTo,
      summary,
      content,
      mediaType: readOptionalString(payload, "mediaType"),
      source: readTicketSource(payload),
      published: readOptionalString(payload, "published"),
      updated: readOptionalString(payload, "updated"),
      url: readOptionalString(payload, "url"),
      context: readOptionalString(payload, "context"),
      workType: readOptionalString(payload, "workType"),
      attachment: readTicketAttachment(payload),
      raw: payload
    }
  })

const lookupFollowByReference = (
  reference: string
): Effect.Effect<FollowSubscription, ApiNotFoundError> => {
  const byActivity = followByActivityId.get(reference)
  if (byActivity) {
    const stored = followStore.get(byActivity)
    if (stored) {
      return Effect.succeed(stored)
    }
  }

  const direct = followStore.get(reference)
  if (direct) {
    return Effect.succeed(direct)
  }

  return Effect.fail(
    new ApiNotFoundError({
      message: `Follow subscription not found for reference: ${reference}`
    })
  )
}

const updateFollowStatus = (
  subscription: FollowSubscription,
  status: FollowStatus
): FollowSubscription => {
  const updated: FollowSubscription = {
    ...subscription,
    status,
    updatedAt: nowIso()
  }
  indexFollow(updated)
  persistFederationStateBestEffort()
  return updated
}

const resolveFollowFromInbox = (
  payload: JsonRecord
): Effect.Effect<FollowSubscription, ApiBadRequestError | ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const objectValue = payload["object"]

    if (typeof objectValue === "string" && objectValue.trim().length > 0) {
      return yield* _(lookupFollowByReference(objectValue.trim()))
    }

    const objectRecord = asRecord(objectValue)
    if (objectRecord === null) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "Accept/Reject payload must include object reference as string or Follow object."
          })
        )
      )
    }

    const explicitId = readOptionalString(objectRecord, "id")
    if (explicitId !== undefined) {
      return yield* _(lookupFollowByReference(explicitId))
    }

    if (!hasType(objectRecord, "Follow")) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "Accept/Reject payload object must include type=\"Follow\" when no id is provided."
          })
        )
      )
    }

    const actor = yield* _(readRequiredString(objectRecord, "actor", "Follow object reference"))
    const object = yield* _(readRequiredString(objectRecord, "object", "Follow object reference"))
    const indexed = followByActorObject.get(followKey(actor, object))
    if (!indexed) {
      return yield* _(
        Effect.fail(
          new ApiNotFoundError({
            message: `Follow subscription not found for actor=${actor} object=${object}`
          })
        )
      )
    }
    return yield* _(lookupFollowByReference(indexed))
  })

const ingestOfferTicket = (
  payload: JsonRecord,
  inheritedJsonLdContext: unknown
): Effect.Effect<FederationIssueRecord, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    const objectPayload = yield* _(readObjectRecord(payload, "object", "ForgeFed offer"))
    yield* _(requireNestedFederationJsonLdContext(objectPayload, "ForgeFed offer Ticket", inheritedJsonLdContext))
    if (!hasType(objectPayload, "Ticket")) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "ForgeFed offer currently supports object.type=\"Ticket\" only."
          })
        )
      )
    }

    const ticket = yield* _(parseTicket(objectPayload, inheritedJsonLdContext))
    return upsertIssue({
      issueId: ticket.id,
      offerId: readOptionalString(payload, "id"),
      activityId: readOptionalString(payload, "id"),
      actor: readOptionalString(payload, "actor"),
      tracker: readOptionalString(payload, "target"),
      status: "offered",
      receivedAt: nowIso(),
      updatedAt: nowIso(),
      ticket
    })
  })

const ingestDirectTicket = (
  payload: JsonRecord,
  inheritedJsonLdContext: unknown
): Effect.Effect<FederationIssueRecord, ApiBadRequestError> =>
  Effect.map(parseTicket(payload, inheritedJsonLdContext), (ticket) =>
    upsertIssue({
      issueId: ticket.id,
      status: "accepted",
      receivedAt: nowIso(),
      updatedAt: nowIso(),
      ticket
    }))

const ingestCreateTicket = (
  payload: JsonRecord,
  options: IngestOptions,
  inheritedJsonLdContext: unknown
): Effect.Effect<FederationIssueRecord, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    const objectPayload = yield* _(readObjectRecord(payload, "object", "ActivityPub Create"))
    yield* _(requireNestedFederationJsonLdContext(objectPayload, "ActivityPub Create Ticket", inheritedJsonLdContext))
    if (!hasType(objectPayload, "Ticket")) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "ActivityPub Create currently supports object.type=\"Ticket\" only."
          })
        )
      )
    }

    const ticket = yield* _(parseTicket(objectPayload, inheritedJsonLdContext))
    const subscription = options.subscription
    const issue = upsertIssue({
      issueId: ticket.id,
      activityId: readOptionalString(payload, "id"),
      actor: readOptionalString(payload, "actor"),
      tracker: readOptionalString(objectPayload, "context"),
      status: "accepted",
      receivedAt: nowIso(),
      updatedAt: nowIso(),
      ticket,
      remoteInbox: subscription?.remoteInbox ?? subscription?.remoteSharedInbox ?? subscription?.inbox,
      remoteOutbox: subscription?.remoteOutbox
    })

    return issue
  })

const recordIssueReceivedEvent = (
  issue: FederationIssueRecord,
  options: IngestOptions
): void => {
  const remoteActor = issue.actor ?? issue.ticket.attributedTo
  const subscription = options.subscription ?? findExchangeSubscriptionByActor(remoteActor)
  recordExchangeEvent({
    kind: "inbox.issue.received",
    subscriptionId: subscription?.id,
    target: subscription === undefined ? undefined : exchangeSubscriptionTarget(subscription),
    queue: subscription?.queue,
    issueId: issue.issueId,
    remoteActor: subscription?.remoteActor ?? remoteActor
  })
}

// CHANGE: support ForgeFed issue inputs and ActivityPub inbox transitions in API mode.
// WHY: issue #233 requires ForgeFed/ActivityPub subscription and task intake.
// QUOTE(ТЗ): "Осталось forgefed допподержать" + "Законнектишь к exchange"
// REF: issue-233
// SOURCE: https://github.com/ProverCoderAI/docker-git/issues/233
// FORMAT THEOREM: ∀m: validInbox(m) → handled(m) ∈ {issue.offer, issue.ticket, issue.create, follow.accept, follow.reject}
// PURITY: SHELL
// EFFECT: Effect<FederationInboxResult, ApiBadRequestError | ApiNotFoundError>
// INVARIANT: state transitions are deterministic for identical references
// COMPLEXITY: O(1)
export const ingestFederationInbox = (
  payload: unknown,
  options: IngestOptions = {}
): Effect.Effect<FederationInboxResult, ApiBadRequestError | ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const record = asRecord(payload)
    if (record === null) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "Inbox payload must be a JSON object."
          })
        )
      )
    }

    yield* _(requireFederationJsonLdContext(record, "Federation inbox payload", options.inheritedJsonLdContext))
    const inheritedJsonLdContext = record["@context"] ?? options.inheritedJsonLdContext

    if (hasType(record, "Offer")) {
      const issue = yield* _(ingestOfferTicket(record, inheritedJsonLdContext))
      recordIssueReceivedEvent(issue, options)
      return { kind: "issue.offer", issue }
    }

    if (hasType(record, "Create")) {
      const issue = yield* _(ingestCreateTicket(record, options, inheritedJsonLdContext))
      recordIssueReceivedEvent(issue, options)
      return { kind: "issue.create", issue }
    }

    if (hasType(record, "Ticket")) {
      const issue = yield* _(ingestDirectTicket(record, inheritedJsonLdContext))
      recordIssueReceivedEvent(issue, options)
      return { kind: "issue.ticket", issue }
    }

    if (hasType(record, "Accept") || hasType(record, "Reject")) {
      const subscription = yield* _(resolveFollowFromInbox(record))
      const status: FollowStatus = hasType(record, "Accept") ? "accepted" : "rejected"
      const updated = updateFollowStatus(subscription, status)
      recordExchangeEvent({
        kind: status === "accepted" ? "inbox.follow.accept" : "inbox.follow.reject",
        subscriptionId: updated.id,
        target: exchangeSubscriptionTarget(updated),
        queue: updated.queue,
        status: updated.status,
        remoteActor: updated.remoteActor
      })
      return status === "accepted"
        ? { kind: "follow.accept", subscription: updated }
        : { kind: "follow.reject", subscription: updated }
    }

    return yield* _(
      Effect.fail(
        new ApiBadRequestError({
          message: "Unsupported inbox payload type. Expected Offer(Ticket), Create(Ticket), Ticket, Accept, or Reject."
        })
      )
    )
  })

const signRequestHeaders = (
  context: FederationContext,
  method: string,
  endpoint: string,
  body: string
): Record<string, string> => {
  const parsed = new URL(endpoint)
  const date = new Date().toUTCString()
  const digest = `SHA-256=${createHash("sha256").update(body).digest("base64")}`
  const target = `${parsed.pathname}${parsed.search}`
  const signingString = [
    `(request-target): ${method.toLowerCase()} ${target.length === 0 ? "/" : target}`,
    `host: ${parsed.host}`,
    `date: ${date}`,
    `digest: ${digest}`
  ].join("\n")
  const signature = signWithPrivateKey(
    "RSA-SHA256",
    Buffer.from(signingString),
    ensureLocalActorKeys().privateKeyPem
  ).toString("base64")

  return {
    accept: activityAcceptHeader,
    "content-type": federationJsonLdContentType,
    date,
    digest,
    signature: [
      `keyId="${context.actorId}#main-key"`,
      `algorithm="rsa-sha256"`,
      `headers="(request-target) host date digest"`,
      `signature="${signature}"`
    ].join(",")
  }
}

const sendJsonLd = (
  context: FederationContext,
  endpoint: string,
  payload: unknown
): Effect.Effect<void, ApiBadRequestError> => {
  const body = JSON.stringify(payload)
  return Effect.tryPromise({
    try: () =>
      fetch(endpoint, {
        method: "POST",
        headers: signRequestHeaders(context, "POST", endpoint, body),
        body
      }),
    catch: (cause) =>
      new ApiBadRequestError({
        message: cause instanceof Error ? cause.message : String(cause)
      })
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.void
        : Effect.fail(new ApiBadRequestError({ message: `HTTP ${response.status} POST ${endpoint}` }))
    )
  )
}

// CHANGE: build outgoing ActivityPub Follow subscriptions for task feeds.
// WHY: issue #233 requires subscribing to exchange queues before waiting for tasks.
// QUOTE(ТЗ): "для этого просто надо на него подписатся"
// REF: issue-233
// SOURCE: https://github.com/ProverCoderAI/docker-git/issues/233
// FORMAT THEOREM: ∀r: valid(r) → ∃s: s.status = pending ∧ s.object = r.object
// PURITY: SHELL
// EFFECT: Effect<FollowSubscriptionCreated, ApiBadRequestError | ApiConflictError>
// INVARIANT: non-rejected actor/object pairs are unique
// COMPLEXITY: O(1)
export const createFollowSubscription = (
  request: CreateFollowRequest,
  context: FederationContext
): Effect.Effect<FollowSubscriptionCreated, ApiBadRequestError | ApiConflictError> =>
  Effect.gen(function*(_) {
    yield* _(ensureStateLoaded())
    const actor = request.actor?.trim()
      ? yield* _(normalizeHttpUrl(request.actor, context, "Follow actor"))
      : context.actorId

    const object = yield* _(normalizeHttpUrl(request.object, context, "Follow object"))

    const key = followKey(actor, object)
    const existingId = followByActorObject.get(key)
    if (existingId) {
      const existing = followStore.get(existingId)
      if (existing && existing.status !== "rejected") {
        return yield* _(
          Effect.fail(
            new ApiConflictError({
              message: `Follow subscription already exists for actor=${actor} object=${object}.`
            })
          )
        )
      }
    }

    const to = cleanToRecipients(request.to)
    const capability = request.capability?.trim()
    const inbox = request.inbox?.trim()
    const normalizedInbox = inbox && inbox.length > 0
      ? yield* _(normalizeHttpUrl(inbox, context, "Follow inbox"))
      : undefined

    const id = randomUUID()
    const activityId = `${context.followsActivityPrefix}/${id}`
    const createdAt = nowIso()

    const activity: ActivityPubFollowActivity = {
      "@context": activityForgeFedJsonLdContext,
      id: activityId,
      type: "Follow",
      actor,
      object,
      ...(to.length === 0 ? {} : { to }),
      ...(capability && capability.length > 0 ? { capability } : {})
    }

    const subscription: FollowSubscription = {
      id,
      activityId,
      actor,
      object,
      inbox: normalizedInbox,
      to,
      capability: capability && capability.length > 0 ? capability : undefined,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      activity
    }

    indexFollow(subscription)
    persistFederationStateBestEffort()

    if (normalizedInbox) {
      yield* _(sendJsonLd(context, normalizedInbox, activity).pipe(Effect.ignore))
    }

    return { subscription, activity }
  })

const parseExchangeTarget = (
  raw: string
): Effect.Effect<ExchangeTarget, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    const normalized = raw.trim()
    if (normalized.length === 0) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: "Exchange target is required." })))
    }

    if (looksLikeAbsoluteUrl(normalized)) {
      const parsed = yield* _(
        Effect.try({
          try: () => new URL(normalized),
          catch: (cause) =>
            new ApiBadRequestError({
              message: cause instanceof Error ? cause.message : String(cause)
            })
        })
      )
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return yield* _(Effect.fail(new ApiBadRequestError({ message: "Exchange target URL must use http:// or https://." })))
      }
      const pathParts = parsed.pathname.split("/").filter((part) => part.length > 0)
      const isRootActorCollection = pathParts.length === 1 && (pathParts[0] === "actor" || pathParts[0] === "actors")
      const queue = pathParts.length === 0 || isRootActorCollection
        ? defaultExchangeQueue
        : inferQueueFromActor(normalized)
      const origin = `${parsed.protocol}//${parsed.host}`
      const candidateActors = pathParts.length === 0 || isRootActorCollection
        ? [`${origin}/actor/${queue}`, `${origin}/actors/${queue}`, `${origin}/actor`]
        : [
          normalized,
          `${origin}/actor/${queue}`,
          `${origin}/actors/${queue}`,
          `${origin}/actor`
        ]
      return {
        name: normalized,
        remoteActor: candidateActors[0] ?? normalized,
        candidateActors: uniqueStrings(candidateActors),
        queue
      }
    }

    const value = normalized.startsWith("@") ? normalized.slice(1) : normalized
    const separator = value.indexOf("@")
    const actor = separator > 0 ? value.slice(0, separator).trim() : defaultExchangeQueue
    const domain = separator > 0 ? value.slice(separator + 1).trim() : value.trim()
    if (
      actor.length === 0 ||
      domain.length === 0 ||
      domain.includes("@") ||
      domain.includes("/") ||
      domain.startsWith(".") ||
      domain.endsWith(".")
    ) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: `Invalid exchange target: ${raw}` })))
    }

    const candidateActors = [
      `https://${domain}/actor/${actor}`,
      `https://${domain}/actors/${actor}`,
      `https://${domain}/actor`
    ]
    return {
      name: normalized,
      remoteActor: candidateActors[0] ?? `https://${domain}/actor/${actor}`,
      candidateActors: uniqueStrings(candidateActors),
      queue: actor
    }
  })

const inferQueueFromActor = (remoteActor: string): string => {
  try {
    const parsed = new URL(remoteActor)
    const parts = parsed.pathname.split("/").filter((part) => part.length > 0)
    return parts.at(-1) ?? "exchange"
  } catch {
    return "exchange"
  }
}

const fetchJson = (
  url: string,
  label: string
): Effect.Effect<JsonRecord, ApiBadRequestError> =>
  Effect.tryPromise({
    try: () =>
      fetch(url, {
        method: "GET",
        headers: {
          accept: activityAcceptHeader
        }
      }),
    catch: (cause) =>
      new ApiBadRequestError({
        message: cause instanceof Error ? cause.message : String(cause)
      })
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(new ApiBadRequestError({ message: `HTTP ${response.status} GET ${url}` }))
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: (): Promise<unknown> => response.json(),
        catch: (cause) =>
          new ApiBadRequestError({
            message: cause instanceof Error ? cause.message : String(cause)
          })
      })
    ),
    Effect.flatMap((json) => {
      const record = asRecord(json)
      return record === null
        ? Effect.fail(new ApiBadRequestError({ message: `${label} returned a non-object JSON payload.` }))
        : Effect.succeed(record)
    })
  )

const parseRemoteActorDocument = (
  payload: JsonRecord,
  fallbackActor: string,
  inheritedJsonLdContext: unknown
): Effect.Effect<RemoteActorDocument, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    yield* _(requireFederationJsonLdContext(payload, "Exchange actor", inheritedJsonLdContext))
    const id = readOptionalString(payload, "id") ?? fallbackActor
    const outbox = readOptionalString(payload, "outbox")
    if (outbox === undefined) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: `Remote actor missing outbox: ${id}`
          })
        )
      )
    }

    const publicKey = asRecord(payload["publicKey"])
    const endpoints = asRecord(payload["endpoints"])

    return {
      id,
      inbox: readOptionalString(payload, "inbox"),
      outbox,
      followers: readOptionalString(payload, "followers"),
      sharedInbox: endpoints === null ? undefined : readOptionalString(endpoints, "sharedInbox"),
      publicKeyId: publicKey === null ? undefined : readOptionalString(publicKey, "id"),
      publicKeyPem: publicKey === null ? undefined : readOptionalString(publicKey, "publicKeyPem")
    }
  })

const collectionActorItems = (payload: JsonRecord): ReadonlyArray<JsonRecord> => {
  const rawItems = Array.isArray(payload["items"])
    ? payload["items"]
    : Array.isArray(payload["orderedItems"])
      ? payload["orderedItems"]
      : []
  return rawItems
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => item !== null)
}

const actorItemMatchesQueue = (item: JsonRecord, queue: string): boolean => {
  const preferredUsername = readOptionalString(item, "preferredUsername")
  const category = readOptionalString(item, "category")
  const id = readOptionalString(item, "id")
  return preferredUsername === queue || category === queue || (id !== undefined && inferQueueFromActor(id) === queue)
}

const parseExchangeActorPayload = (
  target: ExchangeTarget,
  candidateActor: string,
  payload: JsonRecord
): Effect.Effect<RemoteActorDocument, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    yield* _(requireFederationJsonLdContext(payload, "Exchange actor"))
    const inheritedJsonLdContext = payload["@context"]
    const collectionItems = collectionActorItems(payload)
    const outbox = readOptionalString(payload, "outbox")
    if (outbox === undefined && collectionItems.length > 0) {
      const selected = collectionItems.find((item) => actorItemMatchesQueue(item, target.queue))
      if (selected === undefined) {
        return yield* _(
          Effect.fail(
            new ApiBadRequestError({
              message: `Exchange actor collection did not include queue "${target.queue}".`
            })
          )
        )
      }
      return yield* _(
        parseRemoteActorDocument(
          selected,
          readOptionalString(selected, "id") ?? target.remoteActor,
          inheritedJsonLdContext
        )
      )
    }
    return yield* _(parseRemoteActorDocument(payload, candidateActor, inheritedJsonLdContext))
  })

const fetchExchangeActorDocument = (
  target: ExchangeTarget
): Effect.Effect<RemoteActorDocument, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    let lastError: ApiBadRequestError | undefined
    for (const candidateActor of target.candidateActors) {
      const result = yield* _(
        fetchJson(candidateActor, "Exchange actor").pipe(
          Effect.flatMap((payload) => parseExchangeActorPayload(target, candidateActor, payload)),
          Effect.either
        )
      )
      if (result._tag === "Right") {
        return result.right
      }
      lastError = result.left
    }
    return yield* _(
      Effect.fail(
        lastError ??
          new ApiBadRequestError({
            message: `No exchange actor candidates were available for target "${target.name}".`
          })
      )
    )
  })

const buildFollowActivity = (
  context: FederationContext,
  actor: string,
  object: string,
  to: ReadonlyArray<string>,
  capability: string | undefined
): ActivityPubFollowActivity => ({
  "@context": activityForgeFedJsonLdContext,
  id: `${context.followsActivityPrefix}/${randomUUID()}`,
  type: "Follow",
  actor,
  object,
  ...(to.length === 0 ? {} : { to }),
  ...(capability === undefined ? {} : { capability })
})

export const ensureExchangeSubscription = (
  request: ExchangeSubscribeRequest,
  context: FederationContext
): Effect.Effect<FollowSubscriptionCreated, ApiBadRequestError | ApiConflictError> =>
  Effect.gen(function*(_) {
    yield* _(ensureStateLoaded())
    const target = yield* _(parseExchangeTarget(request.target))
    const document = yield* _(fetchExchangeActorDocument(target))

    const actor = request.actor?.trim()
      ? yield* _(normalizeHttpUrl(request.actor, context, "Follow actor"))
      : context.actorId
    const object = document.id
    const key = followKey(actor, object)
    const existingId = followByActorObject.get(key)
    if (existingId) {
      const existing = followStore.get(existingId)
      if (existing && existing.status !== "rejected") {
        return { subscription: existing, activity: existing.activity }
      }
    }

    const inbox = request.inbox?.trim()
      ? yield* _(normalizeHttpUrl(request.inbox, context, "Follow inbox"))
      : document.inbox
    const to = document.followers === undefined ? [] : [document.followers]
    const activity = buildFollowActivity(context, actor, object, to, "ticket")
    const createdAt = nowIso()
    const subscription: FollowSubscription = {
      id: randomUUID(),
      activityId: activity.id,
      actor,
      object,
      inbox,
      remoteActor: document.id,
      remoteInbox: document.inbox,
      remoteOutbox: document.outbox,
      remoteFollowers: document.followers,
      remoteSharedInbox: document.sharedInbox,
      remotePublicKeyId: document.publicKeyId,
      remotePublicKeyPem: document.publicKeyPem,
      subscriptionName: target.name,
      queue: target.queue,
      projectRepoUrl: request.projectRepoUrl?.trim() || undefined,
      agentProvider: request.agentProvider,
      agentCommand: request.agentCommand?.trim() || undefined,
      to,
      capability: "ticket",
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      activity
    }

    indexFollow(subscription)
    persistFederationStateBestEffort()

    if (inbox !== undefined) {
      yield* _(sendJsonLd(context, inbox, activity).pipe(Effect.ignore))
    }
    recordExchangeEvent({
      kind: "follow.sent",
      subscriptionId: subscription.id,
      target: exchangeSubscriptionTarget(subscription),
      queue: subscription.queue,
      status: subscription.status,
      remoteActor: subscription.remoteActor
    })

    return { subscription, activity }
  })

export const listFederationIssues = (): ReadonlyArray<FederationIssueRecord> =>
  [...issueStore.values()].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))

export const listFollowSubscriptions = (): ReadonlyArray<FollowSubscription> =>
  [...followStore.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

export const listExchangeSubscriptions = (): ReadonlyArray<FollowSubscription> =>
  listFollowSubscriptions().filter((subscription) => subscription.remoteOutbox !== undefined)

const latestIso = (values: ReadonlyArray<string | undefined>): string | undefined =>
  values
    .filter((value): value is string => value !== undefined && value.length > 0)
    .sort()
    .at(-1)

export const makeFederationExchangeStatus = (
  context: FederationContext
): FederationExchangeStatus => {
  const subscriptions = listExchangeSubscriptions()
  const recentEvents = [...exchangeEvents].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
  const accepted = subscriptions.filter((subscription) => subscription.status === "accepted").length
  const pending = subscriptions.filter((subscription) => subscription.status === "pending").length
  const rejected = subscriptions.filter((subscription) => subscription.status === "rejected").length
  const inboxEventTimes = exchangeEvents
    .filter((event) => event.kind === "inbox.follow.accept" || event.kind === "inbox.follow.reject" || event.kind === "inbox.issue.received")
    .map((event) => event.occurredAt)
  const acceptedTransitionTimes = subscriptions
    .filter((subscription) => subscription.status === "accepted" || subscription.status === "rejected")
    .map((subscription) => subscription.updatedAt)

  return {
    publicActor: context.actorId,
    summary: {
      subscriptions: subscriptions.length,
      accepted,
      pending,
      rejected,
      issues: issueStore.size,
      processedOutboxItems: processedOutboxItems.size,
      lastInboxAt: latestIso([...inboxEventTimes, ...acceptedTransitionTimes]),
      lastPollAt: latestIso(
        exchangeEvents
          .filter((event) => event.kind === "poll.completed")
          .map((event) => event.occurredAt)
      )
    },
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      target: exchangeSubscriptionTarget(subscription),
      queue: subscription.queue,
      status: subscription.status,
      remoteActor: subscription.remoteActor,
      remoteInbox: subscription.remoteInbox,
      remoteOutbox: subscription.remoteOutbox,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt
    })),
    recentEvents
  }
}

export const clearFederationState = (): void => {
  issueStore.clear()
  followStore.clear()
  followByActivityId.clear()
  followByActorObject.clear()
  processedOutboxItems.clear()
  exchangeEvents = []
  localActorKeys = null
  stateLoaded = true
}

const configuredExchangeTargets = (): ReadonlyArray<string> =>
  (process.env["DOCKER_GIT_EXCHANGE_TARGETS"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

const ensureConfiguredExchangeSubscriptions = (
  context: FederationContext
): Effect.Effect<void, never> =>
  Effect.forEach(
    configuredExchangeTargets(),
    (target) =>
      ensureExchangeSubscription({ target }, context).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            console.warn("[ActivityPub] Failed to subscribe to exchange target:", target, error)
          })
        ),
        Effect.ignore
      ),
    { discard: true }
  )

const outboxItemId = (item: unknown, subscription: FollowSubscription): string => {
  const record = asRecord(item)
  const id = record === null ? undefined : readOptionalString(record, "id")
  if (id !== undefined) {
    return id
  }
  return `${subscription.id}:${createHash("sha256").update(JSON.stringify(item)).digest("hex")}`
}

const fetchOutbox = (
  url: string
): Effect.Effect<ActivityPubOrderedCollection, ApiBadRequestError> =>
  fetchJson(url, "Exchange outbox").pipe(
    Effect.flatMap((record) =>
      requireFederationJsonLdContext(record, "Exchange outbox").pipe(
        Effect.map((): ActivityPubOrderedCollection => ({
          "@context": activityForgeFedJsonLdContext,
          type: "OrderedCollection",
          id: readOptionalString(record, "id") ?? url,
          totalItems: typeof record["totalItems"] === "number" ? record["totalItems"] : 0,
          orderedItems: Array.isArray(record["orderedItems"]) ? record["orderedItems"] : []
        }))
      )
    )
  )

const matchesPollRequest = (subscription: FollowSubscription, request: ExchangePollRequest): boolean => {
  const target = request.target?.trim()
  return !target ||
    subscription.subscriptionName === target ||
    subscription.remoteActor === target ||
    subscription.object === target ||
    subscription.queue === target
}

export const pollExchangeOutboxes = (
  request: ExchangePollRequest = {},
  contextInput?: FederationContext | undefined
) =>
  Effect.gen(function*(_) {
    yield* _(ensureStateLoaded())
    const context = contextInput ?? (yield* _(defaultFederationContext()))
    const subscriptions = listExchangeSubscriptions()
      .filter((subscription) => subscription.status !== "rejected")
      .filter((subscription) => matchesPollRequest(subscription, request))

    let totalItems = 0
    let newItems = 0
    let processedItems = 0
    let failedItems = 0

    for (const subscription of subscriptions) {
      const remoteOutbox = subscription.remoteOutbox
      if (remoteOutbox === undefined) {
        continue
      }
      const collection = yield* _(fetchOutbox(remoteOutbox))
      totalItems += collection.orderedItems.length

      for (const item of collection.orderedItems) {
        const itemId = outboxItemId(item, subscription)
        if (processedOutboxItems.has(itemId)) {
          continue
        }
        newItems += 1
        const handled = yield* _(
          ingestFederationInbox(item, {
            scheduleTask: true,
            context,
            subscription,
            inheritedJsonLdContext: collection["@context"]
          }).pipe(Effect.either)
        )
        processedOutboxItems.add(itemId)
        persistFederationStateBestEffort()

        if (handled._tag === "Left") {
          failedItems += 1
        } else {
          if (handled.right.kind === "issue.create" && request.runTasks !== false) {
            yield* _(
              scheduleExchangeTask(handled.right.issue, {
                context,
                subscription
              })
            )
          }
          processedItems += 1
        }
      }
    }

    const polledAt = nowIso()
    recordExchangeEvent({
      kind: "poll.completed",
      occurredAt: polledAt,
      target: request.target,
      totalItems,
      newItems,
      processedItems,
      failedItems
    })

    return {
      polledAt,
      subscriptions: subscriptions.length,
      totalItems,
      newItems,
      processedItems,
      failedItems
    }
  })

const sourceContent = (source: ForgeFedTicket["source"]): string | undefined =>
  typeof source === "string" ? source : source?.content

const firstGithubUrl = (text: string | undefined): string | undefined => {
  if (text === undefined) {
    return undefined
  }
  const match = text.match(/https:\/\/github\.com\/[^\s"'<>]+/u)
  return match?.[0]
}

const resolveTaskRepoUrl = (
  issue: FederationIssueRecord,
  subscription: FollowSubscription | undefined
): string | undefined =>
  firstGithubUrl(issue.ticket.url) ??
  firstGithubUrl(sourceContent(issue.ticket.source)) ??
  firstGithubUrl(issue.ticket.content) ??
  firstGithubUrl(issue.ticket.summary) ??
  subscription?.projectRepoUrl ??
  process.env["DOCKER_GIT_EXCHANGE_PROJECT_REPO_URL"]?.trim()

const slugify = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized.length > 0 ? normalized.slice(0, 48) : randomUUID()
}

const issueSlug = (issue: FederationIssueRecord): string =>
  slugify(issue.issueId)

const isCreateProjectAccepted = (
  value: ProjectDetails | CreateProjectAccepted
): value is CreateProjectAccepted =>
  "accepted" in value

const resolveAgentProvider = (
  subscription: FollowSubscription | undefined
): AgentProvider => {
  const raw = subscription?.agentProvider ?? process.env["DOCKER_GIT_EXCHANGE_AGENT_PROVIDER"]
  return raw === "claude" || raw === "opencode" || raw === "grok" || raw === "custom" ? raw : "codex"
}

const buildTaskPrompt = (issue: FederationIssueRecord): string => {
  const source = sourceContent(issue.ticket.source)
  const parts = [
    `ForgeFed task: ${issue.ticket.summary}`,
    "",
    issue.ticket.content,
    source === undefined || source === issue.ticket.content ? "" : `Source:\n${source}`,
    "",
    `Ticket: ${issue.ticket.id}`,
    issue.activityId === undefined ? "" : `Activity: ${issue.activityId}`,
    "Implement the requested work in this repository. Commit the changes and provide a concise final summary."
  ].filter((part) => part.trim().length > 0)
  return parts.join("\n")
}

const buildAgentCommand = (
  provider: AgentProvider,
  prompt: string,
  subscription: FollowSubscription | undefined
): string => {
  const override = subscription?.agentCommand?.trim() ?? process.env["DOCKER_GIT_EXCHANGE_AGENT_COMMAND"]?.trim()
  if (override && override.length > 0) {
    return override.includes("{{prompt}}")
      ? override.replaceAll("{{prompt}}", shellEscape(prompt))
      : `${override} ${shellEscape(prompt)}`
  }
  if (provider === "claude") {
    return `MCP_PLAYWRIGHT_ISOLATED=1 claude --dangerously-skip-permissions -p ${shellEscape(prompt)}`
  }
  if (provider === "opencode") {
    return `opencode run ${shellEscape(prompt)}`
  }
  if (provider === "grok") {
    return `MCP_PLAYWRIGHT_ISOLATED=1 grok --no-sandbox -p ${shellEscape(prompt)}`
  }
  if (provider === "custom") {
    return `sh -lc ${shellEscape(`printf '%s\n' ${shellEscape(prompt)}`)}`
  }
  return `MCP_PLAYWRIGHT_ISOLATED=1 codex exec ${shellEscape(prompt)}`
}

const buildCreateProjectRequest = (
  issue: FederationIssueRecord,
  repoUrl: string
): CreateProjectRequest => {
  const slug = issueSlug(issue)
  return {
    repoUrl,
    outDir: `.docker-git/exchange/${slug}`,
    containerName: `dg-ex-${slug}`,
    serviceName: `dg-ex-${slug}`,
    volumeName: `dg-ex-${slug}-home`,
    up: true,
    waitForClone: true,
    openSsh: false
  }
}

const buildIssueUpdateActivity = (
  context: FederationContext,
  issue: FederationIssueRecord,
  status: FederationIssueRecord["status"],
  message: string
) => ({
  "@context": activityForgeFedJsonLdContext,
  id: `${context.exchangeActivityPrefix}/${issueSlug(issue)}/${status}/${randomUUID()}`,
  type: "Update",
  actor: context.actorId,
  object: {
    type: "Order",
    id: issue.issueId,
    status,
    chatResponse: message,
    projectId: issue.projectId,
    agentId: issue.agentId
  }
})

const deliverIssueUpdate = (
  context: FederationContext,
  issue: FederationIssueRecord,
  subscription: FollowSubscription | undefined,
  status: FederationIssueRecord["status"],
  message: string
) => {
  const endpoint = issue.remoteInbox ?? subscription?.remoteInbox ?? subscription?.remoteSharedInbox ?? subscription?.inbox
  if (endpoint === undefined) {
    return Effect.void
  }
  return sendJsonLd(context, endpoint, buildIssueUpdateActivity(context, issue, status, message)).pipe(Effect.ignore)
}

const waitForAgentCompletion = (
  session: AgentSession,
  timeoutMs: number
): Effect.Effect<AgentSession, ApiConflictError | ApiNotFoundError> => {
  const startedAt = Date.now()
  const loop = (): Effect.Effect<AgentSession, ApiConflictError | ApiNotFoundError> =>
    Effect.gen(function*(_) {
      const current = yield* _(getAgent(session.projectId, session.id))
      if (current.status === "exited" || current.status === "failed" || current.status === "stopped") {
        return current
      }
      if (Date.now() - startedAt > timeoutMs) {
        return yield* _(Effect.fail(new ApiConflictError({ message: `Exchange agent timed out after ${timeoutMs}ms.` })))
      }
      yield* _(Effect.sleep(Duration.millis(2_000)))
      return yield* _(loop())
    })
  return loop()
}

const runExchangeTask = (
  issue: FederationIssueRecord,
  subscription: FollowSubscription | undefined,
  context: FederationContext
) =>
  Effect.gen(function*(_) {
    const repoUrl = resolveTaskRepoUrl(issue, subscription)
    if (repoUrl === undefined || repoUrl.length === 0) {
      const failed = updateIssue(issue, {
        status: "failed",
        error: "Exchange task has no GitHub URL and DOCKER_GIT_EXCHANGE_PROJECT_REPO_URL is not configured."
      })
      yield* _(deliverIssueUpdate(context, failed, subscription, "failed", failed.error ?? "Missing repository."))
      return
    }

    const queued = updateIssue(issue, { status: "queued" })
    yield* _(deliverIssueUpdate(context, queued, subscription, "queued", "Task accepted by docker-git."))

    const result = yield* _(createProjectFromRequest(buildCreateProjectRequest(issue, repoUrl)).pipe(Effect.either))
    if (result._tag === "Left") {
      const failed = updateIssue(queued, {
        status: "failed",
        error: String(result.left)
      })
      yield* _(deliverIssueUpdate(context, failed, subscription, "failed", failed.error ?? "Project creation failed."))
      return
    }
    if (isCreateProjectAccepted(result.right)) {
      const failed = updateIssue(queued, {
        status: "failed",
        error: "Exchange project creation unexpectedly returned an async job."
      })
      yield* _(deliverIssueUpdate(context, failed, subscription, "failed", failed.error ?? "Project creation failed."))
      return
    }

    const project = result.right
    const provider = resolveAgentProvider(subscription)
    const prompt = buildTaskPrompt(issue)
    const session = yield* _(
      startAgent(project, {
        provider,
        command: buildAgentCommand(provider, prompt, subscription),
        label: `exchange:${issueSlug(issue)}`
      }).pipe(Effect.either)
    )
    if (session._tag === "Left") {
      const failed = updateIssue(queued, {
        status: "failed",
        projectId: project.id,
        error: String(session.left)
      })
      yield* _(deliverIssueUpdate(context, failed, subscription, "failed", failed.error ?? "Agent start failed."))
      return
    }

    const running = updateIssue(queued, {
      status: "running",
      projectId: project.id,
      agentId: session.right.id
    })
    yield* _(deliverIssueUpdate(context, running, subscription, "running", "Agent started."))

    const timeoutMs = Number(process.env["DOCKER_GIT_EXCHANGE_AGENT_TIMEOUT_MS"] ?? "3600000")
    const finalSession = yield* _(
      waitForAgentCompletion(session.right, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3_600_000)
        .pipe(Effect.either)
    )
    if (finalSession._tag === "Left") {
      const failed = updateIssue(running, {
        status: "failed",
        error: finalSession.left.message
      })
      yield* _(deliverIssueUpdate(context, failed, subscription, "failed", failed.error ?? "Agent failed."))
      return
    }

    const logs = yield* _(readAgentLogs(project.id, session.right.id, 80).pipe(Effect.orElseSucceed(() => [])))
    const resultText = logs.map((line) => line.line).join("\n").trim()
    const status = finalSession.right.status === "exited" && finalSession.right.exitCode === 0 ? "completed" : "failed"
    const finished = updateIssue(running, {
      status,
      result: resultText.length > 0 ? resultText : `Agent finished with status ${finalSession.right.status}.`,
      error: status === "failed" ? `Agent finished with status ${finalSession.right.status}.` : undefined
    })
    yield* _(
      deliverIssueUpdate(
        context,
        finished,
        subscription,
        status,
        finished.result ?? finished.error ?? `Agent finished with status ${finalSession.right.status}.`
      )
    )
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        const failed = updateIssue(issue, {
          status: "failed",
          error: String(error)
        })
        void failed
      })
    )
  )

const scheduleExchangeTask = (
  issue: FederationIssueRecord,
  options: IngestOptions
) =>
  Effect.gen(function*(_) {
    const context = options.context ?? (yield* _(defaultFederationContext()))
    const scheduled = issue.status === "running" || issue.status === "queued" || issue.status === "completed"
      ? issue
      : updateIssue(issue, { status: "accepted" })
    yield* _(
      Effect.sync(() => {
        Effect.runFork(runExchangeTask(scheduled, options.subscription, context).pipe(Effect.provide(NodeContext.layer)))
      })
    )
    return scheduled
  })

/**
 * Polls configured exchange outboxes for ForgeFed tasks.
 */
export const startOutboxPolling = (
  intervalMs: number = 5000
) =>
  Effect.gen(function*(_) {
    yield* _(initializeFederationState())
    const context = yield* _(defaultFederationContext().pipe(Effect.orElseSucceed(() => ({
      publicOrigin: "http://localhost:3334",
      actorUsername: defaultActorUsername,
      actorId: "http://localhost:3334/federation/actor",
      inbox: "http://localhost:3334/federation/inbox",
      outbox: "http://localhost:3334/federation/outbox",
      followers: "http://localhost:3334/federation/followers",
      following: "http://localhost:3334/federation/following",
      liked: "http://localhost:3334/federation/liked",
      followsActivityPrefix: "http://localhost:3334/federation/activities/follows",
      exchangeActivityPrefix: "http://localhost:3334/federation/activities/exchange"
    } satisfies FederationContext))))
    yield* _(ensureConfiguredExchangeSubscriptions(context))

    const poll = pollExchangeOutboxes({}, context).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          console.warn("[ActivityPub Polling] poll failed:", error)
        })
      ),
      Effect.ignore
    )

    while (true) {
      yield* _(poll)
      yield* _(Effect.sleep(Duration.millis(intervalMs)))
    }
  })
