export const effectMigrationWarnings = [
  {
    selector: "SwitchStatement",
    message: "Effect migration blocker: use Match.exhaustive instead of switch."
  },
  {
    selector: "TryStatement",
    message: "Effect migration blocker: use Effect.try / Effect.catch* instead of try/catch."
  },
  {
    selector: "AwaitExpression",
    message: "Effect migration blocker: use Effect.gen / Effect.flatMap instead of await."
  },
  {
    selector: "FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]",
    message: "Effect migration blocker: use Effect.gen / Effect.tryPromise instead of async functions."
  },
  {
    selector: "NewExpression[callee.name='Promise']",
    message: "Effect migration blocker: use Effect.async / Effect.tryPromise instead of new Promise."
  },
  {
    selector: "CallExpression[callee.object.name='Promise']",
    message: "Effect migration blocker: use Effect combinators instead of Promise.*."
  }
]

export const effectPromiseRestrictedTypes = {
  types: {
    Promise: {
      message: "Effect migration blocker: avoid Promise in public types. Use Effect.Effect<A, E, R>."
    },
    "Promise<*>": {
      message: "Effect migration blocker: avoid Promise<T>. Use Effect.Effect<T, E, R>."
    }
  }
}
