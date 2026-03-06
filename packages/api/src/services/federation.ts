import { Duration, Effect } from "effect"
import { randomUUID } from "node:crypto"

import type {
  ActivityPubFollowActivity,
  ActivityPubOrderedCollection,
  ActivityPubPerson,
  CreateFollowRequest,
  FederationInboxResult,
  FederationIssueRecord,
  FollowStatus,
  FollowSubscription,
  FollowSubscriptionCreated,
  ForgeFedTicket
} from "../api/contracts.js"
import { ApiBadRequestError, ApiConflictError, ApiNotFoundError } from "../api/errors.js"

type JsonRecord = { readonly [key: string]: unknown }

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
}

const defaultActorUsername = "docker-git"

const issueStore: Map<string, FederationIssueRecord> = new Map()
const followStore: Map<string, FollowSubscription> = new Map()
const followByActivityId: Map<string, string> = new Map()
const followByActorObject: Map<string, string> = new Map()
const processedOutboxItems: Set<string> = new Set()

const nowIso = (): string => new Date().toISOString()

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asRecord = (value: unknown): JsonRecord | null =>
  isRecord(value) ? value : null

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const readOptionalString = (record: JsonRecord, key: string): string | undefined =>
  asNonEmptyString(record[key]) ?? undefined

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

const parseTicket = (
  payload: JsonRecord
): Effect.Effect<ForgeFedTicket, ApiBadRequestError> =>
  Effect.gen(function*(_) {
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
      source: readOptionalString(payload, "source"),
      published: readOptionalString(payload, "published"),
      updated: readOptionalString(payload, "updated"),
      url: readOptionalString(payload, "url")
    }
  })

const upsertIssue = (issue: FederationIssueRecord): FederationIssueRecord => {
  issueStore.set(issue.issueId, issue)
  return issue
}

const followKey = (actor: string, object: string): string => `${actor}\u0000${object}`

const cleanToRecipients = (
  raw: ReadonlyArray<string> | undefined
): ReadonlyArray<string> =>
  (raw ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

const looksLikeAbsoluteUrl = (value: string): boolean =>
  /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)

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
      followsActivityPrefix: `${publicOrigin}/federation/activities/follows`
    }
  })

export const makeFederationActorDocument = (
  context: FederationContext
): ActivityPubPerson => ({
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Person",
  id: context.actorId,
  name: "docker-git task feed",
  preferredUsername: context.actorUsername,
  summary: "docker-git ActivityPub actor for task and issue stream subscriptions.",
  inbox: context.inbox,
  outbox: context.outbox,
  followers: context.followers,
  following: context.following,
  liked: context.liked
})

export const makeFederationOutboxCollection = (
  context: FederationContext
): ActivityPubOrderedCollection => {
  const orderedItems = listFollowSubscriptions().map((subscription) => subscription.activity)
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "OrderedCollection",
    id: context.outbox,
    totalItems: orderedItems.length,
    orderedItems
  }
}

export const makeFederationFollowersCollection = (
  context: FederationContext
): ActivityPubOrderedCollection => ({
  "@context": "https://www.w3.org/ns/activitystreams",
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
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "OrderedCollection",
    id: context.following,
    totalItems: orderedItems.length,
    orderedItems
  }
}

export const makeFederationLikedCollection = (
  context: FederationContext
): ActivityPubOrderedCollection => ({
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "OrderedCollection",
  id: context.liked,
  totalItems: 0,
  orderedItems: []
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
  followStore.set(updated.id, updated)
  followByActivityId.set(updated.activityId, updated.id)
  followByActorObject.set(followKey(updated.actor, updated.object), updated.id)
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
  payload: JsonRecord
): Effect.Effect<FederationIssueRecord, ApiBadRequestError> =>
  Effect.gen(function*(_) {
    const objectPayload = yield* _(readObjectRecord(payload, "object", "ForgeFed offer"))
    if (!hasType(objectPayload, "Ticket")) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "ForgeFed offer currently supports object.type=\"Ticket\" only."
          })
        )
      )
    }

    const ticket = yield* _(parseTicket(objectPayload))
    const issueId = ticket.id
    const issue = upsertIssue({
      issueId,
      offerId: readOptionalString(payload, "id"),
      tracker: readOptionalString(payload, "target"),
      status: "offered",
      receivedAt: nowIso(),
      ticket
    })
    
    // Пересылаем задачу в OrderQue через JSON-LD
    const orderQueUrl = process.env["DOCKER_GIT_ORDERQUE_URL"] ?? "http://localhost:7277"
    const apiPublicUrl = process.env["DOCKER_GIT_API_PUBLIC_URL"] ?? "http://localhost:3334"
    
    yield* _(Effect.tryPromise({
      try: async () => {
        console.log("[ActivityPub] Пересылка Offer(Ticket) в OrderQue:", orderQueUrl)
        
        // JSON-LD формат для ActivityPub Offer с Ticket
        const orderQuePayload = {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://forgefed.org/ns"
          ],
          type: "Offer",
          id: issueId,
          actor: `${apiPublicUrl}/federation/actor`,
          object: {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://forgefed.org/ns"
            ],
            type: "Ticket",
            id: issueId,
            attributedTo: `${apiPublicUrl}/federation/actor`,
            summary: ticket.summary,
            content: ticket.content,
            workType: "standard"
          }
        }
        
        console.log("[ActivityPub] JSON-LD:", JSON.stringify(orderQuePayload, null, 2))
        
        const response = await fetch(`${orderQueUrl}/federation/inbox`, {
          method: "POST",
          headers: {
            "Content-Type": "application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\""
          },
          body: JSON.stringify(orderQuePayload)
        })
        
        const text = await response.text()
        let json: unknown
        try {
          json = text ? JSON.parse(text) : { raw: text }
        } catch {
          json = { raw: text }
        }
        
        console.log("[ActivityPub] OrderQue ответ:", response.status, json)
        
        if (!response.ok) {
          console.warn("[ActivityPub] OrderQue вернул ошибку:", response.status, json)
          return
        }
        
        const orderId = (json as Record<string, unknown>)["id"] as number | undefined
        if (orderId) {
          console.log("[ActivityPub] Отправка результата для заказа #", orderId)
          
          // JSON-LD для результата
          const resultPayload = {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://forgefed.org/ns"
            ],
            type: "Update",
            id: `${apiPublicUrl}/orders/${orderId}/result`,
            actor: `${apiPublicUrl}/federation/actor`,
            object: {
              type: "Order",
              id: `${orderQueUrl}/orders/${orderId}`,
              status: "completed",
              chatResponse: "complit task",
              agentId: 1
            }
          }
          
          console.log("[ActivityPub] Результат JSON-LD:", JSON.stringify(resultPayload, null, 2))
          
          const resultResponse = await fetch(`${orderQueUrl}/orders/${orderId}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\""
            },
            body: JSON.stringify({
              status: "completed",
              chatResponse: "complit task",
              agentId: 1
            })
          })
          
          const resultText = await resultResponse.text()
          let resultJson: unknown
          try {
            resultJson = resultText ? JSON.parse(resultText) : { raw: resultText }
          } catch {
            resultJson = { raw: resultText }
          }
          
          console.log("[ActivityPub] Результат отправлен:", resultResponse.status, resultJson)
        }
      },
      catch: (error) => {
        console.warn("[ActivityPub] Ошибка пересылки в OrderQue:", error)
      }
    })).pipe(Effect.ignore)
    
    return issue
  })

const ingestDirectTicket = (
  payload: JsonRecord
): Effect.Effect<FederationIssueRecord, ApiBadRequestError> =>
  Effect.map(parseTicket(payload), (ticket) =>
    upsertIssue({
      issueId: ticket.id,
      status: "accepted",
      receivedAt: nowIso(),
      ticket
    }))

// CHANGE: support ForgeFed issue inputs and ActivityPub inbox transitions in API mode.
// WHY: Konrad requested ForgeFed Issue intake and Follow workflow support in PR discussion.
// QUOTE(ТЗ): "А сможешь на вход поддержать ... #issues" + "добавить поддержку follow"
// REF: pr-88-konrad-request
// SOURCE: n/a
// FORMAT THEOREM: ∀m: validInbox(m) → handled(m) ∈ {issue.offer, issue.ticket, follow.accept, follow.reject}
// PURITY: SHELL
// EFFECT: Effect<FederationInboxResult, ApiBadRequestError | ApiNotFoundError>
// INVARIANT: state transitions are deterministic for identical references
// COMPLEXITY: O(1)
export const ingestFederationInbox = (
  payload: unknown
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

    if (hasType(record, "Offer")) {
      const issue = yield* _(ingestOfferTicket(record))
      return { kind: "issue.offer", issue }
    }

    if (hasType(record, "Ticket")) {
      const issue = yield* _(ingestDirectTicket(record))
      return { kind: "issue.ticket", issue }
    }

    if (hasType(record, "Accept") || hasType(record, "Reject")) {
      const subscription = yield* _(resolveFollowFromInbox(record))
      const status: FollowStatus = hasType(record, "Accept") ? "accepted" : "rejected"
      const updated = updateFollowStatus(subscription, status)
      return status === "accepted"
        ? { kind: "follow.accept", subscription: updated }
        : { kind: "follow.reject", subscription: updated }
    }

    return yield* _(
      Effect.fail(
        new ApiBadRequestError({
          message: "Unsupported inbox payload type. Expected Offer(Ticket), Ticket, Accept, or Reject."
        })
      )
    )
  })

// CHANGE: build outgoing ActivityPub Follow subscriptions for task feeds.
// WHY: requested to subscribe to issue/task distribution via ActivityPub Follow.
// QUOTE(ТЗ): "добавить поддержку follow, чтобы можно было подписатся на отдачу задач"
// REF: pr-88-konrad-request
// SOURCE: n/a
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

    // JSON-LD формат для ActivityPub Follow
    const activity: ActivityPubFollowActivity = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://forgefed.org/ns"
      ],
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

    followStore.set(id, subscription)
    followByActivityId.set(activityId, id)
    followByActorObject.set(key, id)

    // Отправляем Follow активность в target inbox (OrderQue)
    if (normalizedInbox) {
      yield* _(Effect.tryPromise({
        try: async () => {
          console.log("[ActivityPub] Отправка Follow в inbox:", normalizedInbox)
          console.log("[ActivityPub] JSON-LD:", JSON.stringify(activity, null, 2))
          
          const response = await fetch(normalizedInbox, {
            method: "POST",
            headers: {
              "Content-Type": "application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\""
            },
            body: JSON.stringify(activity)
          })
          
          const text = await response.text()
          let json: unknown
          try {
            json = text ? JSON.parse(text) : { raw: text }
          } catch {
            json = { raw: text }
          }
          
          console.log("[ActivityPub] Ответ:", response.status, json)
          
          // Если получили Accept автоматически - обновляем статус
          if (response.ok) {
            subscription.status = "accepted"
            subscription.updatedAt = nowIso()
            followStore.set(id, subscription)
            console.log("[ActivityPub] Подписка подтверждена (status=accepted)")
          }
        },
        catch: (error) => {
          console.warn("[ActivityPub] Ошибка отправки Follow:", error)
        }
      })).pipe(Effect.ignore)
    }

    return { subscription, activity }
  })

export const listFederationIssues = (): ReadonlyArray<FederationIssueRecord> =>
  [...issueStore.values()].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))

export const listFollowSubscriptions = (): ReadonlyArray<FollowSubscription> =>
  [...followStore.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

export const clearFederationState = (): void => {
  issueStore.clear()
  followStore.clear()
  followByActivityId.clear()
  followByActorObject.clear()
  processedOutboxItems.clear()
}

/**
 * Polling outbox из OrderQue для получения новых задач
 * Запускается как фоновый процесс
 * URL определяется из активных Follow подписок
 */
export const startOutboxPolling = (
  intervalMs: number = 5000
): Effect.Effect<void, never, never> =>
  Effect.gen(function*(_) {
    console.log("[ActivityPub Polling] Запуск polling outbox")
    console.log("[ActivityPub Polling] Интервал:", intervalMs, "мс")
    
    const poll = Effect.gen(function*(_) {
      // Получаем активные подписки
      const subscriptions = listFollowSubscriptions().filter(s => s.status === "accepted")
      
      if (subscriptions.length === 0) {
        console.log("[ActivityPub Polling] Нет активных подписок, ждем...")
        return 0
      }
      
      let totalItems = 0
      
      for (const sub of subscriptions) {
        // Извлекаем OrderQue URL из object (followers URL)
        const orderQueUrl = sub.object.replace("/federation/followers", "")
        const outboxUrl = `${orderQueUrl}/federation/outbox`
        
        console.log("[ActivityPub Polling] Запрос outbox:", outboxUrl, "подписка:", sub.id)
        
        const result = yield* _(
          Effect.tryPromise({
            try: async () => {
              const response = await fetch(outboxUrl, {
                method: "GET",
                headers: {
                  "Accept": "application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\""
                }
              })
              
              if (!response.ok) {
                throw new Error(`OrderQue вернул ${response.status}`)
              }
              
              const json = await response.json()
              return json as ActivityPubOrderedCollection
            },
            catch: (error) =>
              new ApiBadRequestError({
                message: `Ошибка polling outbox: ${error instanceof Error ? error.message : String(error)}`
              })
          })
        )
        
        const orderedItems = Array.isArray(result.orderedItems) ? result.orderedItems : []
        console.log("[ActivityPub Polling] Получено задач из", outboxUrl, ":", orderedItems.length)
        totalItems += orderedItems.length
        
        for (const item of orderedItems) {
          const itemId = (item as Record<string, unknown>)["id"] as string | undefined
          
          if (itemId && !processedOutboxItems.has(itemId)) {
            console.log("[ActivityPub Polling] Обработка задачи:", itemId)
            console.log("[ActivityPub Polling] JSON-LD:", JSON.stringify(item, null, 2))
            
            // Отправляем задачу в свой inbox для обработки
            yield* _(
              ingestFederationInbox(item).pipe(
                Effect.tapBoth({
                  onSuccess: (result) =>
                    Effect.sync(() => {
                      console.log("[ActivityPub Polling] Задача обработана:", result.kind)
                      processedOutboxItems.add(itemId)
                    }),
                  onFailure: (error) =>
                    Effect.sync(() => {
                      console.warn("[ActivityPub Polling] Ошибка обработки задачи:", error)
                    })
                })
              )
            )
          }
        }
      }
      
      return totalItems
    }).pipe(Effect.ignore)
    
    // Бесконечный цикл с интервалом
    while (true) {
      yield* _(poll)
      yield* _(Effect.sleep(Duration.millis(intervalMs)))
    }
  })
