import { NextResponse } from "next/server"

import { startRecreateProject } from "../../../../../server/docker-git"
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
  return runEffect(startRecreateProject(decodedProjectId))
    .then((status) => NextResponse.json({ status }, { status: 202 }))
    .catch((error: unknown) =>
      NextResponse.json({ error: String(error) }, { status: 500 })
    )
}
