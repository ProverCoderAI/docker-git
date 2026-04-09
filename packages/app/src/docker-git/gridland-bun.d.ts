declare module "@gridland/bun" {
  import type { ComponentType, CSSProperties, ReactNode } from "react"

  type GridlandSize = number | string
  type GridlandMaybe<A> = A | undefined

  export type GridlandBoxProps = {
    readonly alignItems?: GridlandMaybe<CSSProperties["alignItems"]>
    readonly backgroundColor?: GridlandMaybe<string>
    readonly border?: GridlandMaybe<boolean>
    readonly borderColor?: GridlandMaybe<string>
    readonly borderStyle?: GridlandMaybe<"rounded" | "single">
    readonly children?: ReactNode
    readonly color?: GridlandMaybe<string>
    readonly flexDirection?: GridlandMaybe<CSSProperties["flexDirection"]>
    readonly flexGrow?: GridlandMaybe<number>
    readonly flexWrap?: GridlandMaybe<CSSProperties["flexWrap"]>
    readonly gap?: GridlandMaybe<GridlandSize>
    readonly height?: GridlandMaybe<GridlandSize>
    readonly justifyContent?: GridlandMaybe<CSSProperties["justifyContent"]>
    readonly marginBottom?: GridlandMaybe<GridlandSize>
    readonly marginLeft?: GridlandMaybe<GridlandSize>
    readonly marginRight?: GridlandMaybe<GridlandSize>
    readonly marginTop?: GridlandMaybe<GridlandSize>
    readonly padding?: GridlandMaybe<GridlandSize>
    readonly width?: GridlandMaybe<GridlandSize>
  }

  export type GridlandKeyEvent = {
    readonly ctrl?: boolean
    readonly meta?: boolean
    readonly name?: string
    readonly raw?: string
    readonly sequence?: string
    readonly shift?: boolean
  }

  export type GridlandRenderer = {
    readonly destroy: () => void
    readonly once: (event: string, listener: () => void) => void
    readonly start: () => void
  }

  export type GridlandRoot = {
    readonly render: (node: ReactNode) => void
    readonly unmount: () => void
  }

  export type GridlandKeyboardOptions = {
    readonly focusId?: GridlandMaybe<string>
    readonly global?: GridlandMaybe<boolean>
    readonly release?: GridlandMaybe<boolean>
    readonly selectedOnly?: GridlandMaybe<boolean>
  }

  export type GridlandRendererOptions = {
    readonly exitOnCtrlC?: GridlandMaybe<boolean>
    readonly useConsole?: GridlandMaybe<boolean>
    readonly useMouse?: GridlandMaybe<boolean>
  }

  export type GridlandInputProps = {
    readonly ariaLabel?: GridlandMaybe<string>
    readonly autoFocus?: GridlandMaybe<boolean>
    readonly placeholder?: GridlandMaybe<string>
    readonly value: string
  }

  export type GridlandTextProps = GridlandBoxProps & {
    readonly bold?: GridlandMaybe<boolean>
    readonly truncate?: GridlandMaybe<boolean>
  }

  export const Box: ComponentType<GridlandBoxProps>
  export const Input: ComponentType<GridlandInputProps>
  export const Text: ComponentType<GridlandTextProps>

  export const createCliRenderer: (config?: GridlandRendererOptions) => PromiseLike<GridlandRenderer>
  export const createRoot: (renderer: GridlandRenderer) => GridlandRoot
  export const useKeyboard: (
    handler: (key: GridlandKeyEvent) => void,
    options?: GridlandKeyboardOptions
  ) => void

  export type GridlandModule = {
    readonly Box: typeof Box
    readonly Input: typeof Input
    readonly Text: typeof Text
    readonly createCliRenderer: typeof createCliRenderer
    readonly createRoot: typeof createRoot
    readonly useKeyboard: typeof useKeyboard
  }
}
