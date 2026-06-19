declare module "@prover-coder-ai/openapi-effect" {
  import type { Effect } from "effect"
  import type {
    FilterKeys,
    HttpMethod,
    IsOperationRequestBodyOptional,
    OperationRequestBodyContent,
    PathsWithMethod,
    RequiredKeysOf,
    Writable
  } from "openapi-typescript-helpers"

  export type HeadersOptions =
    | Required<RequestInit>["headers"]
    | Readonly<
      Record<
        string,
        | string
        | number
        | boolean
        | ReadonlyArray<string | number | boolean>
        | null
        | undefined
      >
    >

  export type QuerySerializer<T> = (
    query: T extends { parameters: infer Parameters }
      ? Parameters extends { query?: infer Query } ? NonNullable<Query> : Record<string, unknown>
      : Record<string, unknown>
  ) => string

  export type QuerySerializerOptions = {
    readonly array?: {
      readonly style: "form" | "spaceDelimited" | "pipeDelimited"
      readonly explode: boolean
    }
    readonly object?: {
      readonly style: "form" | "deepObject"
      readonly explode: boolean
    }
    readonly allowReserved?: boolean
  }

  export type BodySerializer<T> = (
    body: Writable<OperationRequestBodyContent<T>> | BodyInit | object,
    headers?: Headers | HeadersOptions
  ) => BodyInit

  export type PathSerializer = (
    pathname: string,
    pathParams: Readonly<Record<string, unknown>>
  ) => string

  export type ParseAs = "json" | "text" | "blob" | "arrayBuffer" | "stream"

  export interface ClientOptions extends Omit<RequestInit, "headers"> {
    readonly baseUrl?: string
    readonly fetch?: (input: Request) => ReturnType<typeof globalThis.fetch>
    readonly Request?: typeof Request
    readonly querySerializer?: QuerySerializer<unknown> | QuerySerializerOptions
    readonly bodySerializer?: BodySerializer<unknown>
    readonly pathSerializer?: PathSerializer
    readonly headers?: HeadersOptions
    readonly requestInitExt?: Record<string, unknown>
  }

  export interface MiddlewareRequestParams {
    readonly query?: Record<string, unknown>
    readonly header?: Record<string, unknown>
    readonly path?: Record<string, unknown>
    readonly cookie?: Record<string, unknown>
  }

  export interface MiddlewareCallbackParams {
    readonly request: Request
    readonly schemaPath: string
    readonly params: MiddlewareRequestParams
    readonly id: string
    readonly options: {
      readonly baseUrl: string
      readonly parseAs: ParseAs
      readonly querySerializer: QuerySerializer<unknown>
      readonly bodySerializer: BodySerializer<unknown>
      readonly pathSerializer: PathSerializer
      readonly fetch: typeof globalThis.fetch
    }
  }

  export type Thenable<T> = {
    readonly then: (
      onFulfilled: (value: T) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => unknown
  }

  export type AsyncValue<T> = T | Thenable<T>

  export type MiddlewareOnRequest = (
    options: MiddlewareCallbackParams
  ) => AsyncValue<Request | Response | undefined>

  export type MiddlewareOnResponse = (
    options: MiddlewareCallbackParams & { readonly response: Response }
  ) => AsyncValue<Response | undefined>

  export type MiddlewareOnError = (
    options: MiddlewareCallbackParams & { readonly error: unknown }
  ) => AsyncValue<Response | Error | undefined>

  export type Middleware =
    | {
      readonly onRequest: MiddlewareOnRequest
      readonly onResponse?: MiddlewareOnResponse
      readonly onError?: MiddlewareOnError
    }
    | {
      readonly onRequest?: MiddlewareOnRequest
      readonly onResponse: MiddlewareOnResponse
      readonly onError?: MiddlewareOnError
    }
    | {
      readonly onRequest?: MiddlewareOnRequest
      readonly onResponse?: MiddlewareOnResponse
      readonly onError: MiddlewareOnError
    }

  export interface DefaultParamsOption {
    readonly params?: {
      readonly query?: Record<string, unknown>
    }
  }

  export type ParamsOption<T> = T extends { parameters: infer Parameters }
    ? RequiredKeysOf<Parameters> extends never ? { readonly params?: Parameters }
    : { readonly params: Parameters }
    : DefaultParamsOption

  export type RequestBodyOption<T> = Writable<OperationRequestBodyContent<T>> extends never
    ? { readonly body?: never }
    : IsOperationRequestBodyOptional<T> extends true
      ? { readonly body?: Writable<OperationRequestBodyContent<T>> }
      : { readonly body: Writable<OperationRequestBodyContent<T>> }

  export type RequestOptions<T> =
    & ParamsOption<T>
    & RequestBodyOption<T>
    & Omit<RequestInit, "body" | "headers" | "method">
    & {
      readonly baseUrl?: string
      readonly querySerializer?: QuerySerializer<T> | QuerySerializerOptions
      readonly bodySerializer?: BodySerializer<T>
      readonly pathSerializer?: PathSerializer
      readonly parseAs?: ParseAs
      readonly fetch?: ClientOptions["fetch"]
      readonly headers?: HeadersOptions
      readonly middleware?: ReadonlyArray<Middleware>
    }

  export type MaybeOptionalInit<Params, Location extends keyof Params> = RequiredKeysOf<
    RequestOptions<FilterKeys<Params, Location>>
  > extends never ? RequestOptions<FilterKeys<Params, Location>> | undefined
    : RequestOptions<FilterKeys<Params, Location>>

  export type InitParam<Init> = RequiredKeysOf<Init> extends never
    ? [(Init & { readonly [key: string]: unknown })?]
    : [Init & { readonly [key: string]: unknown }]

  export type OperationFor<
    Paths extends object,
    Path extends keyof Paths,
    Method extends HttpMethod
  > = Paths[Path] extends Record<Method, infer Operation> ? Operation & Record<string | number, unknown>
    : never

  export type MethodResult = Effect.Effect<
    {
      readonly data?: unknown
      readonly error?: unknown
      readonly response: Response
    },
    Error
  >

  export type ClientMethod<
    Paths extends object,
    Method extends HttpMethod
  > = <
    Path extends PathsWithMethod<Paths, Method>,
    Init extends MaybeOptionalInit<Paths[Path], Extract<Method, keyof Paths[Path]>>
  >(
    url: Path,
    ...init: InitParam<Init>
  ) => MethodResult

  export type ClientRequestMethod<Paths extends object> = <
    Method extends HttpMethod,
    Path extends PathsWithMethod<Paths, Method>,
    Init extends MaybeOptionalInit<Paths[Path], Extract<Method, keyof Paths[Path]>>
  >(
    method: Method,
    url: Path,
    ...init: InitParam<Init>
  ) => MethodResult

  export interface ClientEffect<Paths extends object> {
    readonly request: ClientRequestMethod<Paths>
    readonly GET: ClientMethod<Paths, "get">
    readonly PUT: ClientMethod<Paths, "put">
    readonly POST: ClientMethod<Paths, "post">
    readonly DELETE: ClientMethod<Paths, "delete">
    readonly OPTIONS: ClientMethod<Paths, "options">
    readonly HEAD: ClientMethod<Paths, "head">
    readonly PATCH: ClientMethod<Paths, "patch">
    readonly TRACE: ClientMethod<Paths, "trace">
    use(...middleware: ReadonlyArray<Middleware>): void
    eject(...middleware: ReadonlyArray<Middleware>): void
  }

  export const createClientEffect: <Paths extends object>(
    clientOptions?: ClientOptions
  ) => ClientEffect<Paths>
}
