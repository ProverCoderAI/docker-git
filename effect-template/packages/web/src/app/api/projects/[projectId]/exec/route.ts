import { NextResponse } from "next/server"
import { Either } from "effect"
import * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"

import { execProjectCommand } from "../../../../../server/docker-git"
import { runEffect } from "../../../../../server/runtime"

export const dynamic = "force-dynamic"

const CommandSchema = Schema.Struct({
  command: Schema.String
})

type RouteParams = {
  readonly params: {
    readonly projectId: string
  }
}

const formatParseError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatIssueSync(error.issue)

export const POST = async (request: Request, { params }: RouteParams) => {
  const { projectId } = await Promise.resolve(params)
  const decodedProjectId = decodeURIComponent(projectId)

  return request.json()
    .then((body) =>
      Either.match(Schema.decodeUnknownEither(CommandSchema)(body), {
        onLeft: (error) =>
          NextResponse.json(
            { error: formatParseError(error) },
            { status: 400 }
          ),
        onRight: ({ command }) =>
          runEffect(execProjectCommand(decodedProjectId, command))
            .then((output) => NextResponse.json({ output }))
            .catch((error: unknown) =>
              NextResponse.json({ error: String(error) }, { status: 500 })
            )
      })
    )
    .catch((error: unknown) =>
      NextResponse.json({ error: String(error) }, { status: 500 })
    )
}
