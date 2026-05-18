import type { HostError } from "./host-errors.js"
import { renderCliError } from "./host-errors.js"

export type MenuError = HostError

export const renderMenuError = (error: MenuError): string => renderCliError(error)
