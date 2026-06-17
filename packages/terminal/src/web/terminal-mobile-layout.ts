export const shouldShowTerminalTabs = (isMobileMode: boolean, sessionCount: number): boolean =>
  !isMobileMode || sessionCount > 1

export const isTerminalCompactHeaderMode = (isMobileMode: boolean): boolean => isMobileMode

export const isTerminalTypingMode = (isMobileMode: boolean, isKeyboardOpen: boolean): boolean =>
  isMobileMode && isKeyboardOpen
