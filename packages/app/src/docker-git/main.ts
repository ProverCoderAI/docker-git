#!/usr/bin/env node

import { NodeContext, NodeRuntime } from "@effect/platform-node"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import { Effect, Layer } from "effect"

import { program } from "./program.js"

// CHANGE: run docker-git CLI through the Node runtime with FetchHttpClient for API calls
// WHY: FetchHttpClient.layer provides HttpClient.HttpClient service required by api-client.ts
// QUOTE(ТЗ): "CLI → DOCKER_GIT_API_URL → REST API"
// PURITY: SHELL
// EFFECT: Effect<void, unknown, NodeContext | HttpClient>
// INVARIANT: program runs with NodeContext.layer + FetchHttpClient.layer
// COMPLEXITY: O(n)
const mainLayer = Layer.merge(NodeContext.layer, FetchHttpClient.layer)
const main = Effect.provide(program, mainLayer)

NodeRuntime.runMain(main)
