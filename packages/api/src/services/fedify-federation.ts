import { createFederation, MemoryKvStore } from "@fedify/fedify"
import {
  CryptographicKey,
  Endpoints,
  Follow,
  Object as ActivityObject,
  OrderedCollection,
  OrderedCollectionPage,
  Person
} from "@fedify/vocab"
import { Effect } from "effect"
import { createPublicKey, webcrypto } from "node:crypto"

import {
  activityStreamsJsonLdContext,
  actorJsonLdContext,
  type ActivityPubFollowActivity
} from "../api/contracts.js"
import { ApiInternalError } from "../api/errors.js"
import {
  listFollowSubscriptions,
  readLocalActorKeys,
  type FederationContext
} from "./federation.js"

const actorIdentifier = "actor"

type FedifyContextData = {
  readonly context: FederationContext
}

const url = (value: string): URL => new URL(value)

const importPublicKey = (publicKeyPem: string): Effect.Effect<CryptoKey, ApiInternalError> =>
  Effect.tryPromise({
    try: async () => {
      const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" })
      return await webcrypto.subtle.importKey(
        "jwk",
        jwk,
        {
          name: "RSASSA-PKCS1-v1_5",
          hash: "SHA-256"
        },
        true,
        ["verify"]
      )
    },
    catch: (cause) =>
      new ApiInternalError({
        message: "Failed to import federation public key for Fedify serialization.",
        cause
      })
  })

const makeFedifyPublicKey = (
  context: FederationContext
): Effect.Effect<CryptographicKey, ApiInternalError> =>
  Effect.gen(function*(_) {
    const keys = yield* _(readLocalActorKeys())
    const publicKey = yield* _(importPublicKey(keys.publicKeyPem))
    return new CryptographicKey({
      id: url(`${context.actorId}#main-key`),
      owner: url(context.actorId),
      publicKey
    })
  })

export const makeFedifyActor = (
  context: FederationContext
): Effect.Effect<Person, ApiInternalError> =>
  Effect.gen(function*(_) {
    const publicKey = yield* _(makeFedifyPublicKey(context))
    return new Person({
      id: url(context.actorId),
      name: "docker-git task feed",
      preferredUsername: context.actorUsername,
      summary: "docker-git ActivityPub actor for task and issue stream subscriptions.",
      inbox: url(context.inbox),
      outbox: url(context.outbox),
      followers: url(context.followers),
      following: url(context.following),
      liked: url(context.liked),
      publicKey,
      endpoints: new Endpoints({
        sharedInbox: url(context.inbox)
      })
    })
  })

const makeFedifyFollowActivity = (activity: ActivityPubFollowActivity): Follow =>
  new Follow({
    id: url(activity.id),
    actor: url(activity.actor),
    object: url(activity.object),
    tos: activity.to?.map(url) ?? []
  })

export const makeFedifyOutboxCollection = (
  context: FederationContext
): OrderedCollection => {
  const items = listFollowSubscriptions().map((subscription) =>
    makeFedifyFollowActivity(subscription.activity)
  )
  return new OrderedCollection({
    id: url(context.outbox),
    totalItems: items.length,
    items
  })
}

export const makeFedifyFollowersCollection = (
  context: FederationContext
): OrderedCollection =>
  new OrderedCollection({
    id: url(context.followers),
    totalItems: 0,
    first: url(`${context.followers}?page=1`),
    items: []
  })

export const makeFedifyFollowersPageCollection = (
  context: FederationContext
): OrderedCollectionPage =>
  new OrderedCollectionPage({
    id: url(`${context.followers}?page=1`),
    totalItems: 0,
    partOf: url(context.followers),
    items: []
  })

export const makeFedifyFollowingCollection = (
  context: FederationContext
): OrderedCollection => {
  const items = listFollowSubscriptions()
    .filter((subscription) => subscription.status === "accepted")
    .map((subscription) => url(subscription.object))

  return new OrderedCollection({
    id: url(context.following),
    totalItems: items.length,
    items
  })
}

export const makeFedifyLikedCollection = (
  context: FederationContext
): OrderedCollection =>
  new OrderedCollection({
    id: url(context.liked),
    totalItems: 0,
    items: []
  })

const serializeFedifyObject = (
  object: ActivityObject,
  context: string | ReadonlyArray<string>
): Effect.Effect<unknown, ApiInternalError> =>
  Effect.tryPromise({
    try: () => {
      const jsonLdContext: string | string[] =
        typeof context === "string" ? context : Array.from(context)
      return object.toJsonLd({
        format: "compact",
        context: jsonLdContext
      })
    },
    catch: (cause) =>
      new ApiInternalError({
        message: "Failed to serialize ActivityPub document with Fedify.",
        cause
      })
  })

export const makeFedifyActorJsonLd = (
  context: FederationContext
): Effect.Effect<unknown, ApiInternalError> =>
  makeFedifyActor(context).pipe(
    Effect.flatMap((actor) => serializeFedifyObject(actor, actorJsonLdContext))
  )

export const makeFedifyOutboxJsonLd = (
  context: FederationContext
): Effect.Effect<unknown, ApiInternalError> =>
  serializeFedifyObject(makeFedifyOutboxCollection(context), activityStreamsJsonLdContext)

export const makeFedifyFollowersJsonLd = (
  context: FederationContext
): Effect.Effect<unknown, ApiInternalError> =>
  serializeFedifyObject(makeFedifyFollowersCollection(context), activityStreamsJsonLdContext)

export const makeFedifyFollowersPageJsonLd = (
  context: FederationContext
): Effect.Effect<unknown, ApiInternalError> =>
  serializeFedifyObject(makeFedifyFollowersPageCollection(context), activityStreamsJsonLdContext)

export const makeFedifyFollowingJsonLd = (
  context: FederationContext
): Effect.Effect<unknown, ApiInternalError> =>
  serializeFedifyObject(makeFedifyFollowingCollection(context), activityStreamsJsonLdContext)

export const makeFedifyLikedJsonLd = (
  context: FederationContext
): Effect.Effect<unknown, ApiInternalError> =>
  serializeFedifyObject(makeFedifyLikedCollection(context), activityStreamsJsonLdContext)

const createWebFingerFederation = (context: FederationContext) => {
  const federation = createFederation<FedifyContextData>({
    kv: new MemoryKvStore(),
    manuallyStartQueue: true,
    origin: context.publicOrigin
  })

  federation
    .setActorDispatcher("/federation/{identifier}", (_ctx, identifier) =>
      identifier === actorIdentifier
        ? Effect.runPromise(makeFedifyActor(context))
        : null
    )
    .mapHandle((_ctx, username) =>
      username === context.actorUsername ? actorIdentifier : null
    )
    .mapAlias((_ctx, resource) =>
      resource.href === context.actorId
        ? { identifier: actorIdentifier }
        : null
    )

  return federation
}

export const fetchFedifyWebFinger = (
  request: Request,
  context: FederationContext
): Effect.Effect<Response, ApiInternalError> =>
  Effect.tryPromise({
    try: () =>
      createWebFingerFederation(context).fetch(request, {
        contextData: { context },
        onNotFound: () => new Response("Not found", { status: 404 })
      }),
    catch: (cause) =>
      new ApiInternalError({
        message: "Fedify WebFinger request failed.",
        cause
      })
  })
