import {
  type ComponentType,
  createContext,
  type CSSProperties,
  type JSX,
  type MouseEventHandler,
  type ReactNode,
  useContext
} from "react"

export type UiBoxProps = {
  readonly alignItems?: CSSProperties["alignItems"]
  readonly backgroundColor?: string
  readonly border?: boolean
  readonly borderColor?: string
  readonly borderStyle?: "rounded" | "single"
  readonly children?: ReactNode
  readonly fg?: string
  readonly flexBasis?: CSSProperties["flexBasis"]
  readonly flexDirection?: CSSProperties["flexDirection"]
  readonly flexGrow?: number
  readonly flexShrink?: number
  readonly flexWrap?: CSSProperties["flexWrap"]
  readonly gap?: number | string
  readonly height?: number | string
  readonly justifyContent?: CSSProperties["justifyContent"]
  readonly marginBottom?: number | string
  readonly marginLeft?: number | string
  readonly marginRight?: number | string
  readonly marginTop?: number | string
  readonly maxHeight?: number | string
  readonly maxWidth?: number | string
  readonly minHeight?: number | string
  readonly minWidth?: number | string
  readonly onClick?: MouseEventHandler<HTMLElement> | (() => void)
  readonly overflow?: CSSProperties["overflow"]
  readonly overflowX?: CSSProperties["overflowX"]
  readonly overflowY?: CSSProperties["overflowY"]
  readonly padding?: number | string
  readonly width?: number | string
}

export type UiTextProps = UiBoxProps & {
  readonly bold?: boolean
  readonly wrap?: "truncate" | "wrap"
}

export type UiButtonProps = {
  readonly label: string
  readonly onPress: () => void
}

export type UiTextInputProps = {
  readonly ariaLabel: string
  readonly autoFocus?: boolean
  readonly minRows?: number
  readonly multiline?: boolean
  readonly onChange: (value: string) => void
  readonly onEnter?: (shift: boolean) => void
  readonly onEscape?: () => void
  readonly placeholder?: string
  readonly secret?: boolean
  readonly value: string
}

type UiPrimitives = {
  readonly Box: ComponentType<UiBoxProps>
  readonly Button: ComponentType<UiButtonProps>
  readonly Text: ComponentType<UiTextProps>
  readonly TextInput: ComponentType<UiTextInputProps>
}

const UiPrimitivesContext = createContext<UiPrimitives | null>(null)

const useUiPrimitives = (): UiPrimitives => {
  const primitives = useContext(UiPrimitivesContext)
  if (primitives === null) {
    throw new Error("UI primitives provider is missing.")
  }
  return primitives
}

export const UiProvider = (
  {
    children,
    primitives
  }: {
    readonly children?: ReactNode
    readonly primitives: UiPrimitives
  }
): JSX.Element => (
  <UiPrimitivesContext.Provider value={primitives}>
    {children}
  </UiPrimitivesContext.Provider>
)

export const Box = (props: UiBoxProps): JSX.Element => {
  const primitive = useUiPrimitives()
  return <primitive.Box {...props} />
}

export const Text = (props: UiTextProps): JSX.Element => {
  const primitive = useUiPrimitives()
  return <primitive.Text {...props} />
}

export const Button = (props: UiButtonProps): JSX.Element => {
  const primitive = useUiPrimitives()
  return <primitive.Button {...props} />
}

export const TextInput = (props: UiTextInputProps): JSX.Element => {
  const primitive = useUiPrimitives()
  return <primitive.TextInput {...props} />
}
