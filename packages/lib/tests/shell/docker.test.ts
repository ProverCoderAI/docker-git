import { describe, expect, it } from "@effect/vitest"

import { dockerComposeUpRecreateArgs, parseDockerPublishedHostPorts } from "../../src/shell/docker.js"

describe("docker compose args", () => {
  it("uses build when force-env recreates containers", () => {
    expect(dockerComposeUpRecreateArgs).toEqual(["up", "-d", "--build", "--force-recreate"])
  })
})

describe("parseDockerPublishedHostPorts", () => {
  it("extracts unique published host ports from docker ps output", () => {
    const output = [
      "127.0.0.1:2222->22/tcp",
      "0.0.0.0:5672->5672/tcp, [::]:5672->5672/tcp",
      "5900/tcp, 6080/tcp, 9223/tcp",
      ":::8080->80/tcp"
    ].join("\n")

    expect(parseDockerPublishedHostPorts(output)).toEqual([2222, 5672, 8080])
  })

  it("returns empty array when no host ports are published", () => {
    expect(parseDockerPublishedHostPorts("5900/tcp, 6080/tcp")).toEqual([])
  })
})
