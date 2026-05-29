import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const runtime = process.versions.bun === undefined ? "bun" : process.execPath
const forbiddenOutput = [
  {
    label: "Vite warning",
    pattern: /\[vite\]\s+warning:/iu
  },
  {
    label: "Rolldown invalid annotation warning",
    pattern: /\[INVALID_ANNOTATION\]/u
  },
  {
    label: "Deprecated build option warning",
    pattern: /(?:\[vite\]\s+warning:[^\n]*\bdeprecated\b|\(!\)[^\n]*\bdeprecated\b)/iu
  },
  {
    label: "Chunk size warning",
    pattern: /Some chunks are larger than/u
  }
]

const result = spawnSync(runtime, ["run", "--cwd", "packages/app", "build:web"], {
  cwd: repoRoot,
  encoding: "utf8"
})

if (result.error !== undefined) {
  console.error(result.error)
  process.exit(1)
}

const stdout = result.stdout ?? ""
const stderr = result.stderr ?? ""
if (stdout.length > 0) {
  process.stdout.write(stdout)
}
if (stderr.length > 0) {
  process.stderr.write(stderr)
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const output = `${stdout}\n${stderr}`
const matches = forbiddenOutput.filter(({ pattern }) => pattern.test(output))
if (matches.length > 0) {
  console.error("Web build emitted forbidden warning output:")
  for (const match of matches) {
    console.error(`- ${match.label}`)
  }
  process.exit(1)
}
