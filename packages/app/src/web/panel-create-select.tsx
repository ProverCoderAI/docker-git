import type { JSX } from "react"

import {
  type CreateFlowContext,
  type CreateFlowView,
  type CreateSettingsChoiceDirection,
  createSettingsHint,
  renderCreateStepLabel,
  renderCreateStepLabelWithBufferPreview,
  resolveCreateDisplaySteps,
  resolveCreateSettingsChoiceBuffer,
  resolveCreateInputs
} from "../docker-git/menu-create-shared.js"
import type { CreateStep } from "../docker-git/menu-types.js"
import { Box, Button, Text, TextInput } from "../ui/primitives.js"
import { HelpLines } from "../ui/shared.js"

const renderStepColor = (active: boolean): string => active ? "#56f39a" : "#8fa6c4"

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
    readonly onSubmit: (quickCreate?: boolean) => void
    readonly promptLabel: string
  }
): JSX.Element => (
  <TextInput
    ariaLabel={promptLabel}
    autoFocus={true}
    onChange={(value) => {
      onBufferChange(value)
    }}
    {...(onArrowLeft === undefined ? {} : { onArrowLeft })}
    {...(onArrowRight === undefined ? {} : { onArrowRight })}
    onEnter={(shift) => {
      onSubmit(isRepoStep ? shift : undefined)
    }}
    onEscape={onCancel}
    placeholder={isRepoStep ? "https://github.com/org/repo/tree/branch --force --mcp-playwright" : promptLabel}
    value={createView.buffer}
  />
)

export const CreatePanel = (
  {
    compact,
    controllerCwd,
    createView,
    onBufferChange,
    onCancel,
    onSubmit,
    projectsRoot
  }: {
    readonly compact: boolean
    readonly controllerCwd: string
    readonly createView: CreateFlowView
    readonly projectsRoot: string
    readonly onBufferChange: (buffer: string) => void
    readonly onCancel: () => void
    readonly onSubmit: (quickCreate?: boolean) => void
  }
): JSX.Element => {
  const prompt = createPrompt({ cwd: controllerCwd, projectsRoot }, createView)
  const steps = resolveCreateDisplaySteps()
  const activeStep = steps[createView.step] ?? "repoUrl"
  const isRepoStep = activeStep === "repoUrl"
  const visibleSteps = compact && isRepoStep ? [activeStep] : steps
  const leftChoiceBuffer = resolveCreateSettingsChoiceBuffer(createView, "left")
  const rightChoiceBuffer = resolveCreateSettingsChoiceBuffer(createView, "right")
  const chooseSettingsBuffer = (direction: CreateSettingsChoiceDirection): void => {
    const nextBuffer = resolveCreateSettingsChoiceBuffer(createView, direction)
    if (nextBuffer !== null) {
      onBufferChange(nextBuffer)
    }
  }

  return (
    <Box flexDirection="column">
      <Text bold={true} fg="#8be9fd">docker-git / Create</Text>
      <CreateStepsList
        activeStep={activeStep}
        activeBuffer={createView.buffer}
        defaults={prompt.defaults}
        visibleSteps={visibleSteps}
      />
      <Box flexDirection="column" marginTop={1}>
        <Text fg="#d6e5f7">{prompt.label}:</Text>
        <CreatePromptInput
          createView={createView}
          isRepoStep={isRepoStep}
          {...(leftChoiceBuffer === null
            ? {}
            : { onArrowLeft: () => {
              chooseSettingsBuffer("left")
            } })}
          {...(rightChoiceBuffer === null
            ? {}
            : { onArrowRight: () => {
              chooseSettingsBuffer("right")
            } })}
          onBufferChange={onBufferChange}
          onCancel={onCancel}
          onSubmit={onSubmit}
          promptLabel={prompt.label}
        />
      </Box>
      {isRepoStep
        ? (
          <Box gap={1} marginTop={1}>
            <Button
              label="Quick Create"
              onPress={() => {
                onSubmit(true)
              }}
            />
            <Button
              label="Settings"
              onPress={() => {
                onSubmit(false)
              }}
            />
          </Box>
        )
        : (
          <Box gap={1} marginTop={1}>
            <Button
              label="Done"
              onPress={() => {
                onSubmit(false)
              }}
            />
          </Box>
        )}
      <CreateHintBlock compact={compact} controllerCwd={controllerCwd} isRepoStep={isRepoStep} />
    </Box>
  )
}

const CreateStepsList = (
  {
    activeStep,
    activeBuffer,
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
      const active = step === activeStep
      return (
        <Text key={step} fg={renderStepColor(active)}>
          {active ? "> " : "  "}
          {active
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
      ...(isRepoStep ? [] : [createSettingsHint]),
      ...(isRepoStep ? [] : [webCreateSettingsChoiceHint]),
      ...(compact && isRepoStep ? ["↑/↓ = menu, ←/→ = project"] : []),
      `Current cwd: ${controllerCwd}`
    ]}
  />
)
