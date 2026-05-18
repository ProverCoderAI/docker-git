export const parseMenuIndex = (input: string): number | null => {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) {
    return null
  }
  const index = parsed - 1
  return index >= 0 ? index : null
}

type PromptStep = {
  readonly key: string
  readonly label: string
  readonly required: boolean
}

type PromptView = {
  readonly step: number
  readonly buffer: string
  readonly values: Readonly<Record<string, string>>
}

type PromptContext<V extends PromptView> = {
  readonly setView: (view: V) => void
  readonly setMessage: (message: string | null) => void
}

export const submitPromptStep = <V extends PromptView>(
  view: V,
  steps: ReadonlyArray<PromptStep>,
  context: PromptContext<V>,
  onCancel: () => void,
  onSubmit: (values: Readonly<Record<string, string>>) => void
): void => {
  const step = steps[view.step]
  if (!step) {
    onCancel()
    return
  }

  const value = view.buffer.trim()
  if (step.required && value.length === 0) {
    context.setMessage(`${step.label} is required.`)
    return
  }

  const nextValues: Readonly<Record<string, string>> = { ...view.values, [step.key]: value }
  const nextStep = view.step + 1
  if (nextStep < steps.length) {
    context.setView({ ...view, step: nextStep, buffer: "", values: nextValues })
    context.setMessage(null)
    return
  }

  onSubmit(nextValues)
}

type MenuNumberInputContext = {
  readonly setMessage: (message: string | null) => void
}

export const handleMenuNumberInput = <A>(
  input: string,
  context: MenuNumberInputContext,
  actionByIndex: (index: number) => A | null,
  runAction: (action: A) => void
): void => {
  const index = parseMenuIndex(input)
  if (index === null) {
    if (input.trim().length > 0) {
      context.setMessage("Use arrows + Enter, or type a number from the list.")
    }
    return
  }

  const action = actionByIndex(index)
  if (action === null) {
    context.setMessage(`Unknown action: ${input.trim()}`)
    return
  }
  runAction(action)
}
