import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

import { runCli } from "./cli.js"

const program = Effect.sync(() => {
  try {
    const exitCode = runCli(process.argv.slice(2), process.cwd())
    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
})

NodeRuntime.runMain(program)
