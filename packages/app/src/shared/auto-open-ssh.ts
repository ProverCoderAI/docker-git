import { Effect } from "effect"

type AutoOpenSshOptions = {
  readonly shouldOpen: boolean
  readonly runUp: boolean
}

const isInteractiveTty = (): boolean => process.stdin.isTTY && process.stdout.isTTY

export const shouldAutoOpenSsh = ({
  runUp,
  shouldOpen
}: AutoOpenSshOptions): Effect.Effect<boolean> =>
  Effect.gen(function*(_) {
    if (!shouldOpen) {
      return false
    }
    if (!runUp) {
      yield* _(Effect.logWarning("Skipping SSH auto-open: docker compose up disabled (--no-up)."))
      return false
    }
    if (!isInteractiveTty()) {
      yield* _(Effect.logWarning("Skipping SSH auto-open: not running in an interactive TTY."))
      return false
    }
    return true
  })
