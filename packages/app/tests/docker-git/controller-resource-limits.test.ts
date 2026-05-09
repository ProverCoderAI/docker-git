import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "@effect/vitest"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..")

const readComposeFile = (relativePath: string): string => readFileSync(path.join(repoRoot, relativePath), "utf8")

const composeFiles = ["docker-compose.yml", "docker-compose.api.yml"] as const

describe("controller compose resource limits", () => {
  for (const composeFile of composeFiles) {
    describe(composeFile, () => {
      const contents = readComposeFile(composeFile)

      it("caps controller CPU usage", () => {
        expect(contents).toMatch(/cpus: \$\{DOCKER_GIT_CONTROLLER_CPUS:-\d+(?:\.\d+)?\}/u)
      })

      it("caps controller memory and swap together", () => {
        expect(contents).toMatch(/mem_limit: \$\{DOCKER_GIT_CONTROLLER_MEMORY:-\d+[a-zA-Z]+\}/u)
        expect(contents).toMatch(/memswap_limit: \$\{DOCKER_GIT_CONTROLLER_MEMORY:-\d+[a-zA-Z]+\}/u)
      })

      it("caps controller PIDs to prevent fork bombs", () => {
        expect(contents).toMatch(/pids_limit: \$\{DOCKER_GIT_CONTROLLER_PIDS:-\d+\}/u)
      })
    })
  }
})
