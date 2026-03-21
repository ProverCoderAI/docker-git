import { describe, expect, it } from "@effect/vitest"
import { buildDockerGeminiAuthArgs } from "../../src/usecases/auth-gemini-oauth.js"

describe("buildDockerGeminiAuthArgs", () => {
  it("builds correct docker run arguments for Gemini OAuth", () => {
    const spec = {
      cwd: "/test",
      hostPath: "/host/path",
      containerPath: "/container/path",
      callbackPort: 38751,
      image: "test-image:latest",
      env: ["FOO=bar", "BAZ=qux"]
    }

    const args = buildDockerGeminiAuthArgs(spec)

    expect(args).toEqual([
      "run",
      "--rm",
      "--init",
      "-i",
      "-t",
      "-v",
      "/host/path:/container/path",
      "-p",
      "38751:38751",
      "-w",
      "/container/path",
      "-e",
      "FOO=bar",
      "-e",
      "BAZ=qux",
      "test-image:latest",
      "gemini",
      "mcp",
      "list",
      "--debug"
    ])
  })
})
