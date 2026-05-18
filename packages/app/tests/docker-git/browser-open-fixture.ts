import { vi } from "vitest"

export type BrowserOpenMockWindow = {
  readonly close: ReturnType<typeof vi.fn>
  readonly focus: ReturnType<typeof vi.fn>
  readonly location: {
    href: string
  }
  opener: object | null
}

export const makeBrowserOpenMockWindow = (): BrowserOpenMockWindow => ({
  close: vi.fn(),
  focus: vi.fn(),
  location: {
    href: ""
  },
  opener: {}
})

export const stubBrowserOpen = (openedWindow: BrowserOpenMockWindow): ReturnType<typeof vi.fn> => {
  const open = vi.fn(() => openedWindow)
  vi.stubGlobal("open", open)
  return open
}
