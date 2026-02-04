import fs from "node:fs"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const infoFile = "/tmp/docker-git-terminal-ws.json"

export const GET = () => {
  try {
    const raw = fs.readFileSync(infoFile, "utf8")
    const parsed = JSON.parse(raw) as { port?: number }
    const port = typeof parsed.port === "number" ? parsed.port : 3001
    return NextResponse.json({ port })
  } catch {
    return NextResponse.json({ port: 3001 })
  }
}
