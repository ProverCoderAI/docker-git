import { NextResponse } from "next/server"

import { markRecreateStatus } from "../../../../../../server/recreate-state"
import { runEffect } from "../../../../../../server/runtime"
import { Effect } from "effect"

export const dynamic = "force-dynamic"

type RouteParams = {
  readonly params: {
    readonly projectId: string
  }
}

type Phase = "idle" | "running" | "success" | "error"

const isPhase = (value: unknown): value is Phase =>
  value === "idle" || value === "running" || value === "success" || value === "error"

const decodeBody = (input: unknown): { readonly phase: Phase; readonly message: string } | null => {
  if (!input || typeof input !== "object") {
    return null
  }
  const phase = Reflect.get(input, "phase")
  const message = Reflect.get(input, "message")
  if (!isPhase(phase)) {
    return null
  }
  if (typeof message !== "string") {
    return null
  }
  return { phase, message }
}

export const POST = async (request: Request, { params }: RouteParams) => {
  const { projectId } = await Promise.resolve(params)
  const decodedProjectId = decodeURIComponent(projectId)
  const body = await request.json().catch(() => null)
  const decoded = decodeBody(body)
  if (!decoded) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  return runEffect(
    Effect.sync(() => {
      const status = markRecreateStatus(decodedProjectId, decoded.phase, decoded.message)
      return status
    })
  )
    .then((status) => NextResponse.json({ status }))
    .catch((error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }))
}
