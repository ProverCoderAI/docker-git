import { NextResponse } from "next/server"

import { downProject } from "../../../../../server/docker-git"
import { runEffect } from "../../../../../server/runtime"

export const dynamic = "force-dynamic"

type RouteParams = {
  readonly params: {
    readonly projectId: string
  }
}

export const POST = async (_request: Request, { params }: RouteParams) => {
  const { projectId } = await Promise.resolve(params)
  const decodedProjectId = decodeURIComponent(projectId)
  return runEffect(downProject(decodedProjectId))
    .then(() => NextResponse.json({ status: "ok" }))
    .catch((error: unknown) =>
      NextResponse.json({ error: String(error) }, { status: 500 })
    )
}
