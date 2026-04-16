import { createServer } from "node:http"

import { describe, expect, it } from "vitest"

import { configureLongRunningRequestTimeouts } from "../src/program.js"

describe("api program", () => {
  it("does not abort long-running project creation requests", () => {
    const server = configureLongRunningRequestTimeouts(createServer())

    expect(server.requestTimeout).toBe(0)
    expect(server.timeout).toBe(0)
  })
})
