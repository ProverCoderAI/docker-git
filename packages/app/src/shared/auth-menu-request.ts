export type AuthMenuRequestBody = {
  readonly flow: string
  readonly label?: string | null
  readonly token?: string | null
  readonly user?: string | null
  readonly apiKey?: string | null
}

export type ProjectAuthMenuRequestBody = {
  readonly flow: string
  readonly label?: string | null
}
