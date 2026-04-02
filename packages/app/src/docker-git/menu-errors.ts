import type { AppError } from "@lib/usecases/errors"
import { renderError } from "@lib/usecases/errors"

import type { HostError } from "./host-errors.js"
import { renderCliError } from "./host-errors.js"

export type MenuError = AppError | HostError

const isHostError = (error: MenuError): error is HostError =>
  error._tag === "ControllerBootstrapError" ||
  error._tag === "ApiRequestError" ||
  error._tag === "ApiAuthRequiredError" ||
  error._tag === "ProjectResolutionError" ||
  error._tag === "UnsupportedCommandError"

export const renderMenuError = (error: MenuError): string =>
  isHostError(error) ? renderCliError(error) : renderError(error)
