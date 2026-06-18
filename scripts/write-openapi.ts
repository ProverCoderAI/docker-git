import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { buildDockerGitOpenApi } from "../packages/api/src/api/openapi.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repositoryRoot = resolve(__dirname, "..")
const outputPath = resolve(repositoryRoot, "packages/api/openapi.json")

const describeWriteError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

try {
  const spec = buildDockerGitOpenApi()
  const content = `${JSON.stringify(spec, null, 2)}\n`

  await Bun.write(outputPath, content)
  console.log(`OpenAPI spec written to ${outputPath}`)
} catch (error) {
  console.error(`Failed to write OpenAPI spec: ${describeWriteError(error)}`)
  process.exit(1)
}
