import type { JSX } from "react"

import { renderAuthContent, renderContentBody, renderProjectAuthContent } from "./panel-content-renderers.js"
import type { ContentPanelProps } from "./panel-content-types.js"

export const ContentPanel = (props: ContentPanelProps): JSX.Element => {
  if (props.currentMenu === "Auth") {
    return renderAuthContent(props)
  }
  if (props.currentMenu === "ProjectAuth") {
    return renderProjectAuthContent(props)
  }
  return renderContentBody(props)
}
