import { Effect, pipe } from "effect"
import React, { useMemo } from "react"

import type { GridlandKeyEvent, GridlandModule, GridlandRenderer } from "@gridland/bun"

import { createGridlandPrimitives } from "../ui/primitives-gridland.js"
import { UiProvider } from "../ui/primitives.js"
import { handleUserInput, type MenuInputContext } from "./menu-input-handler.js"

type InputReadError = {
  readonly _tag: "InputReadError"
  readonly message: string
}

const blockedInputNames = new Set([
  "backspace",
  "del",
  "delete",
  "down",
  "enter",
  "escape",
  "pagedown",
  "pageup",
  "return",
  "tab",
  "up"
])

const isBlockedInputName = (name: string | undefined): boolean => blockedInputNames.has(name ?? "")

const resolveSequencedKeyboardInput = (event: GridlandKeyEvent): string | null => {
  if (typeof event.sequence !== "string" || event.sequence.length === 0 || isBlockedInputName(event.name)) {
    return null
  }
  return event.sequence
}

const resolveNamedKeyboardInput = (event: GridlandKeyEvent): string | null => {
  if (typeof event.name !== "string" || event.name.length !== 1 || isBlockedInputName(event.name)) {
    return null
  }
  return event.name
}

const resolveKeyboardInput = (event: GridlandKeyEvent): string => {
  if (event.ctrl || event.meta) {
    return ""
  }
  return resolveSequencedKeyboardInput(event) ?? resolveNamedKeyboardInput(event) ?? ""
}

const toMenuKeyInput = (event: GridlandKeyEvent) => {
  const name = event.name
  return {
    backspace: name === "backspace",
    delete: name === "delete" || name === "del",
    downArrow: name === "down",
    escape: name === "escape",
    return: name === "enter" || name === "return",
    shift: event.shift === true,
    upArrow: name === "up"
  } as const
}

const toInputReadError = (error: Error | string): InputReadError => ({
  _tag: "InputReadError",
  message: error instanceof Error ? error.message : error
})

const waitForRendererDestroy = (renderer: GridlandRenderer): Effect.Effect<void> =>
  Effect.async((resume) => {
    renderer.once("destroy", () => {
      resume(Effect.void)
    })
  })

const loadGridlandModule = (): Effect.Effect<GridlandModule, InputReadError> =>
  Effect.tryPromise({
    try: () => import("@gridland/bun"),
    catch: (error) => toInputReadError(error instanceof Error ? error : String(error))
  })

const createGridlandRenderer = (gridland: GridlandModule): Effect.Effect<GridlandRenderer, InputReadError> =>
  Effect.tryPromise({
    try: () =>
      gridland.createCliRenderer({
        exitOnCtrlC: false,
        useConsole: false,
        useMouse: false
      }),
    catch: (error) => toInputReadError(error instanceof Error ? error : String(error))
  })

type GridlandAppFactory = (args: {
  readonly exit: () => void
  readonly gridland: GridlandModule
}) => React.ReactElement

const runEmbeddedGridlandMenu = (renderApp: GridlandAppFactory): Effect.Effect<void, InputReadError> =>
  Effect.gen(function*() {
    const gridland = yield* loadGridlandModule()
    const renderer = yield* createGridlandRenderer(gridland)
    const root = gridland.createRoot(renderer)
    let isExiting = false

    const exit = () => {
      if (isExiting) {
        return
      }
      isExiting = true
      root.unmount()
      renderer.destroy()
    }

    root.render(
      renderApp({
        exit,
        gridland
      })
    )

    renderer.start()
    yield* pipe(
      waitForRendererDestroy(renderer),
      Effect.ensuring(
        Effect.sync(() => {
          if (!isExiting) {
            root.unmount()
          }
        })
      )
    )
  })

export const runGridlandMenu = (renderApp: GridlandAppFactory): Effect.Effect<void, InputReadError> =>
  runEmbeddedGridlandMenu(renderApp)

type GridlandMenuRuntimeContext =
  & Pick<
    MenuInputContext,
    | "busy"
    | "exit"
    | "inputStage"
    | "runner"
    | "selected"
    | "setActiveDir"
    | "setInputStage"
    | "setMessage"
    | "setSelected"
    | "setSkipInputs"
    | "setSshActive"
    | "setView"
    | "sshActive"
    | "state"
    | "view"
  >
  & {
    readonly ignoreUntil: number
    readonly ready: boolean
    readonly skipInputs: number
  }

const shouldIgnoreKeyEvent = (context: GridlandMenuRuntimeContext): boolean =>
  !context.ready || Date.now() < context.ignoreUntil

const shouldConsumeSkippedInput = (context: GridlandMenuRuntimeContext): boolean => context.skipInputs > 0

const consumeSkippedInput = (context: GridlandMenuRuntimeContext): void => {
  context.setSkipInputs((value) => (value > 0 ? value - 1 : 0))
}

const handleCtrlC = (event: GridlandKeyEvent, context: GridlandMenuRuntimeContext): boolean => {
  if (!(event.ctrl && event.name === "c")) {
    return false
  }
  if (!context.sshActive) {
    context.exit()
  }
  return true
}

export const useGridlandMenuInput = (gridland: GridlandModule, context: GridlandMenuRuntimeContext): void => {
  gridland.useKeyboard((event) => {
    if (handleCtrlC(event, context) || shouldIgnoreKeyEvent(context)) {
      return
    }
    if (shouldConsumeSkippedInput(context)) {
      consumeSkippedInput(context)
      return
    }
    handleUserInput(resolveKeyboardInput(event), toMenuKeyInput(event), context)
  })
}

export const GridlandMenuProvider = (
  {
    children,
    gridland
  }: {
    readonly children: React.ReactNode
    readonly gridland: GridlandModule
  }
): React.ReactElement => {
  const primitives = useMemo(() => createGridlandPrimitives(gridland), [gridland])
  return React.createElement(UiProvider, { primitives }, children)
}
