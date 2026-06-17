import type { JSX } from "react"

import {
  type CreateFlowContext,
  type CreateFlowView,
  type CreateSettingsChoiceDirection,
  isCreateFlowRepoStep,
  isDisplayModeFlowView,
  renderCreateStepLabel,
  renderCreateStepLabelWithBufferPreview,
  resolveCreateDisplaySteps,
  resolveCreateInputs,
  resolveCreateSettingsChoiceBuffer
} from "../docker-git/menu-create-shared.js"
import type { CreateStep } from "../docker-git/menu-types.js"
import { Box, Button, Text, TextInput } from "../ui/primitives.js"
import { HelpLines } from "../ui/shared.js"
import type { CreateSubmitMode } from "./app-ready-create.js"

type CreatePanelProps = {
  readonly compact: boolean
  readonly controllerCwd: string
  readonly createView: CreateFlowView
  readonly projectsRoot: string
  readonly onBufferChange: (buffer: string) => void
  readonly onCancel: () => void
  readonly onSubmit: (mode: CreateSubmitMode) => void
}

type CreatePanelModel = {
  readonly activeStep: CreateStep
  readonly isRepoStep: boolean
  readonly leftChoiceBuffer: string | null
  readonly prompt: ReturnType<typeof createPrompt>
  readonly rightChoiceBuffer: string | null
  readonly visibleSteps: ReadonlyArray<CreateStep>
}

const renderStepColor = (active: boolean): string => active ? "#56f39a" : "#8fa6c4"

const webCreateSettingsNavigationHint = "↑ - up, ↓ - down, Enter - apply + down"
const webCreateSettingsChoiceHint = "←/→ - choose yes/no or GPU"

const createPrompt = (
  createContext: CreateFlowContext,
  createView: CreateFlowView
): { readonly label: string; readonly defaults: ReturnType<typeof resolveCreateInputs> } => {
  const defaults = resolveCreateInputs(createContext, createView.values)
  const steps = resolveCreateDisplaySteps()
  const step = steps[createView.step] ?? steps[0] ?? "repoUrl"
  return {
    label: renderCreateStepLabelWithBufferPreview(step, defaults, createView.buffer),
    defaults
  }
}

const CreatePromptInput = (
  {
    createView,
    isRepoStep,
    onArrowLeft,
    onArrowRight,
    onBufferChange,
    onCancel,
    onSubmit,
    promptLabel
  }: {
    readonly createView: CreateFlowView
    readonly isRepoStep: boolean
    readonly onArrowLeft?: () => void
    readonly onArrowRight?: () => void
    readonly onBufferChange: (buffer: string) => void
    readonly onCancel: () => void
    readonly onSubmit: (mode: CreateSubmitMode) => void
    readonly promptLabel: string
  }
): JSX.Element => (
  <>
    <TextInput
      ariaLabel={promptLabel}
      autoFocus={true}
      onChange={(value) => {
        onBufferChange(value)
      }}
      {...(onArrowLeft === undefined ? {} : { onArrowLeft })}
      {...(onArrowRight === undefined ? {} : { onArrowRight })}
      onEnter={(shift) => {
        onSubmit(isRepoStep && shift ? "quick-create" : "advance")
      }}
      onEscape={onCancel}
      placeholder={isRepoStep ? "https://github.com/org/repo/tree/branch --force --mcp-playwright" : promptLabel}
      value={createView.buffer}
    />
    {createView.inputError === null || !isRepoStep
      ? null
      : <Text fg="#ff6b6b">{createView.inputError}</Text>}
  </>
)

const resolveCreatePanelModel = (
  { compact, controllerCwd, createView, projectsRoot }: Pick<
    CreatePanelProps,
    "compact" | "controllerCwd" | "createView" | "projectsRoot"
  >
): CreatePanelModel => {
  const prompt = createPrompt({ cwd: controllerCwd, projectsRoot }, createView)
  const steps = resolveCreateDisplaySteps()
  const activeStep = isDisplayModeFlowView(createView) ? steps[createView.step] ?? "repoUrl" : "repoUrl"
  const isRepoStep = isCreateFlowRepoStep(createView)

  return {
    activeStep,
    isRepoStep,
    leftChoiceBuffer: isDisplayModeFlowView(createView)
      ? resolveCreateSettingsChoiceBuffer(createView, "left")
      : null,
    prompt,
    rightChoiceBuffer: isDisplayModeFlowView(createView)
      ? resolveCreateSettingsChoiceBuffer(createView, "right")
      : null,
    visibleSteps: compact && isRepoStep ? [activeStep] : steps
  }
}

const createChoiceHandler = (
  createView: CreateFlowView,
  direction: CreateSettingsChoiceDirection,
  onBufferChange: (buffer: string) => void
): () => void =>
() => {
  if (!isDisplayModeFlowView(createView)) {
    return
  }
  const nextBuffer = resolveCreateSettingsChoiceBuffer(createView, direction)
  if (nextBuffer !== null) {
    onBufferChange(nextBuffer)
  }
}

const CreateSubmitButtons = (
  {
    isRepoStep,
    onSubmit
  }: {
    readonly isRepoStep: boolean
    readonly onSubmit: (mode: CreateSubmitMode) => void
  }
): JSX.Element => (
  isRepoStep
    ? (
      <Box gap={1} marginTop={1}>
        <Button
          label="Quick Create"
          onPress={() => {
            onSubmit("quick-create")
          }}
        />
        <Button
          label="Settings"
          onPress={() => {
            onSubmit("advance")
          }}
        />
      </Box>
    )
    : (
      <Box gap={1} marginTop={1}>
        <Button
          label="Done"
          onPress={() => {
            onSubmit("complete-settings")
          }}
        />
      </Box>
    )
)

export const CreatePanel = (
  props: CreatePanelProps
): JSX.Element => {
  const { compact: isCompact, controllerCwd, createView, onBufferChange, onCancel, onSubmit } = props
  const model = resolveCreatePanelModel(props)
  const leftChoiceAction = model.leftChoiceBuffer === null
    ? undefined
    : createChoiceHandler(createView, "left", onBufferChange)
  const rightChoiceAction = model.rightChoiceBuffer === null
    ? undefined
    : createChoiceHandler(createView, "right", onBufferChange)

  return (
    <Box flexDirection="column">
      <Text bold={true} fg="#8be9fd">docker-git / Create</Text>
      <CreateStepsList
        activeStep={model.activeStep}
        activeBuffer={createView.buffer}
        defaults={model.prompt.defaults}
        visibleSteps={model.visibleSteps}
      />
      <Box flexDirection="column" marginTop={1}>
        <Text fg="#d6e5f7">{model.prompt.label}:</Text>
        <CreatePromptInput
          createView={createView}
          isRepoStep={model.isRepoStep}
          {...(leftChoiceAction === undefined ? {} : { onArrowLeft: leftChoiceAction })}
          {...(rightChoiceAction === undefined ? {} : { onArrowRight: rightChoiceAction })}
          onBufferChange={onBufferChange}
          onCancel={onCancel}
          onSubmit={onSubmit}
          promptLabel={model.prompt.label}
        />
      </Box>
      <CreateSubmitButtons isRepoStep={model.isRepoStep} onSubmit={onSubmit} />
      <CreateHintBlock compact={isCompact} controllerCwd={controllerCwd} isRepoStep={model.isRepoStep} />
    </Box>
  )
}

const CreateStepsList = (
  {
    activeBuffer,
    activeStep,
    defaults,
    visibleSteps
  }: {
    readonly activeStep: CreateStep
    readonly activeBuffer: string
    readonly defaults: ReturnType<typeof resolveCreateInputs>
    readonly visibleSteps: ReadonlyArray<CreateStep>
  }
): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    {visibleSteps.map((step) => {
      const isActive = step === activeStep
      return (
        <Text key={step} fg={renderStepColor(isActive)}>
          {isActive ? "> " : "  "}
          {isActive
            ? renderCreateStepLabelWithBufferPreview(step, defaults, activeBuffer)
            : renderCreateStepLabel(step, defaults)}
        </Text>
      )
    })}
  </Box>
)

const CreateHintBlock = (
  {
    compact,
    controllerCwd,
    isRepoStep
  }: {
    readonly compact: boolean
    readonly controllerCwd: string
    readonly isRepoStep: boolean
  }
): JSX.Element => (
  <HelpLines
    lines={[
      ...(isRepoStep ? ["Repo URL or URL + CLI flags."] : []),
      ...(isRepoStep ? [] : [webCreateSettingsNavigationHint]),
      ...(isRepoStep ? [] : [webCreateSettingsChoiceHint]),
      ...(compact && isRepoStep ? ["↑/↓ = menu, ←/→ = project"] : []),
      `Current cwd: ${controllerCwd}`
    ]}
  />
)
