import type { JSX } from "react"

import {
  type CreateFlowContext,
  type CreateFlowView,
  renderCreateStepLabel,
  resolveCreateFlowSteps,
  resolveCreateInputs
} from "../docker-git/menu-create-shared.js"
import type { CreateStep } from "../docker-git/menu-types.js"
import { Box, Button, Text, TextInput } from "../ui/primitives.js"
import { HelpLines } from "../ui/shared.js"

const renderStepColor = (active: boolean): string => active ? "#56f39a" : "#8fa6c4"

const createPrompt = (
  createContext: CreateFlowContext,
  createView: CreateFlowView
): { readonly label: string; readonly defaults: ReturnType<typeof resolveCreateInputs> } => {
  const defaults = resolveCreateInputs(createContext, createView.values)
  const steps = resolveCreateFlowSteps(createView.values)
  const step = steps[createView.step] ?? steps[0] ?? "repoUrl"
  return {
    label: renderCreateStepLabel(step, defaults),
    defaults
  }
}

const createHint = (isRepoStep: boolean): string =>
  isRepoStep
    ? "Enter = next, Shift+Enter = quick create, Esc = cancel."
    : "Enter = next, Esc = cancel."

const CreatePromptInput = (
  {
    createView,
    isRepoStep,
    onBufferChange,
    onCancel,
    onSubmit,
    promptLabel
  }: {
    readonly createView: CreateFlowView
    readonly isRepoStep: boolean
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
    onEnter={(shift) => {
      onSubmit(shift)
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
  const steps = resolveCreateFlowSteps(createView.values)
  const visibleSteps = compact ? [steps[createView.step] ?? "repoUrl"] : steps
  const isRepoStep = (steps[createView.step] ?? "repoUrl") === "repoUrl"

  return (
    <Box flexDirection="column">
      <Text bold={true} fg="#8be9fd">docker-git / Create</Text>
      <CreateStepsList
        compact={compact}
        createView={createView}
        defaults={prompt.defaults}
        visibleSteps={visibleSteps}
      />
      <Box flexDirection="column" marginTop={1}>
        <Text fg="#d6e5f7">{prompt.label}:</Text>
        <CreatePromptInput
          createView={createView}
          isRepoStep={isRepoStep}
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
              label="Quick create"
              onPress={() => {
                onSubmit(true)
              }}
            />
          </Box>
        )
        : null}
      <CreateHintBlock compact={compact} controllerCwd={controllerCwd} isRepoStep={isRepoStep} />
    </Box>
  )
}

const CreateStepsList = (
  {
    compact,
    createView,
    defaults,
    visibleSteps
  }: {
    readonly compact: boolean
    readonly createView: CreateFlowView
    readonly defaults: ReturnType<typeof resolveCreateInputs>
    readonly visibleSteps: ReadonlyArray<CreateStep>
  }
): JSX.Element => (
  <Box flexDirection="column" marginTop={1}>
    {visibleSteps.map((step, index) => (
      <Text key={step} fg={renderStepColor(compact || index === createView.step)}>
        {compact || index === createView.step ? "> " : "  "}
        {renderCreateStepLabel(step, defaults)}
      </Text>
    ))}
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
      createHint(isRepoStep),
      ...(compact ? ["↑/↓ = menu, ←/→ = project"] : []),
      `Current cwd: ${controllerCwd}`
    ]}
  />
)
