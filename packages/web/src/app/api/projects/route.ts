import { NextResponse } from "next/server"

import { listProjects } from "../../../server/docker-git"
import { runEffect } from "../../../server/runtime"

export const dynamic = "force-dynamic"

export const GET = () =>
  runEffect(listProjects())
    .then((projects) => NextResponse.json({ projects }))
    .catch((error: unknown) =>
      NextResponse.json({ error: String(error) }, { status: 500 })
    )
