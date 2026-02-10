import fs from "node:fs"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const sessionsFile = "/tmp/docker-git-terminal-sessions.json"

export const GET = () => {
  try {
    const raw = fs.readFileSync(sessionsFile, "utf8")
    const parsed = JSON.parse(raw) as { sessions?: unknown }
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : []
    return NextResponse.json({ sessions })
  } catch {
    return NextResponse.json({ sessions: [] })
  }
}
