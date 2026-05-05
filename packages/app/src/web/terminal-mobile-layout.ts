export const shouldShowTerminalTabs = (mobileMode: boolean, sessionCount: number): boolean =>
  !mobileMode || sessionCount > 1

export const resolveTerminalCompactHeaderMode = (mobileMode: boolean): boolean => mobileMode

export const resolveTerminalTypingMode = (mobileMode: boolean, keyboardOpen: boolean): boolean =>
  mobileMode && keyboardOpen
