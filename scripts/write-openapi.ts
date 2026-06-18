import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { buildDockerGitOpenApi } from "../packages/api/src/api/openapi.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repositoryRoot = resolve(__dirname, "..")
const outputPath = resolve(repositoryRoot, "packages/api/openapi.json")

await Bun.write(outputPath, `${JSON.stringify(buildDockerGitOpenApi(), null, 2)}\n`)
