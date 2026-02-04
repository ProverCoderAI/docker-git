import { NextResponse } from "next/server"

import { getProjectDetails } from "../../../../server/docker-git"
import { runEffect } from "../../../../server/runtime"

export const dynamic = "force-dynamic"

type RouteParams = {
  readonly params: {
    readonly projectId: string
  }
}

export const GET = async (_request: Request, { params }: RouteParams) => {
  const { projectId } = await Promise.resolve(params)
  const decodedProjectId = decodeURIComponent(projectId)
  return runEffect(getProjectDetails(decodedProjectId))
    .then((project) => NextResponse.json(project))
    .catch((error: unknown) =>
      NextResponse.json({ error: String(error) }, { status: 500 })
    )
}
