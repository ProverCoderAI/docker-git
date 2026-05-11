export type TerminalQuerySuppression = { readonly dispose: () => void }

type Disposable = { readonly dispose: () => void }

type CsiIdentifier = { readonly final: string; readonly prefix?: string }

export type TerminalQuerySuppressionTarget = {
  readonly parser: {
    readonly registerOscHandler: (
      ident: number,
      callback: (data: string) => boolean
    ) => Disposable
    readonly registerCsiHandler: (
      id: CsiIdentifier,
      callback: () => boolean
    ) => Disposable
  }
}

const isColorQuery = (data: string): boolean => {
  for (const segment of data.split(";")) {
    if (segment === "?") {
      return true
    }
  }
  return false
}

const registerOscColorQuerySuppressor = (
  terminal: TerminalQuerySuppressionTarget,
  identifier: number
): Disposable => terminal.parser.registerOscHandler(identifier, (data) => isColorQuery(data))

const registerCsiSuppressor = (
  terminal: TerminalQuerySuppressionTarget,
  identifier: CsiIdentifier
): Disposable => terminal.parser.registerCsiHandler(identifier, () => true)

export const installTerminalQuerySuppression = (
  terminal: TerminalQuerySuppressionTarget
): TerminalQuerySuppression => {
  const disposables: ReadonlyArray<Disposable> = [
    registerOscColorQuerySuppressor(terminal, 4),
    registerOscColorQuerySuppressor(terminal, 10),
    registerOscColorQuerySuppressor(terminal, 11),
    registerOscColorQuerySuppressor(terminal, 12),
    registerCsiSuppressor(terminal, { final: "c" }),
    registerCsiSuppressor(terminal, { final: "c", prefix: ">" }),
    registerCsiSuppressor(terminal, { final: "c", prefix: "=" }),
    registerCsiSuppressor(terminal, { final: "n" }),
    registerCsiSuppressor(terminal, { final: "n", prefix: "?" })
  ]
  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose()
      }
    }
  }
}

export const isTerminalColorQuery = isColorQuery
