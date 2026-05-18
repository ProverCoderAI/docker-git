import React from "react"

import { ScreenLayout } from "../ui/shared.js"

export const renderLayout = (
  title: string,
  body: ReadonlyArray<React.ReactElement>,
  message: string | null
): React.ReactElement => {
  return React.createElement(ScreenLayout, {
    body: [...body],
    message,
    title
  })
}
