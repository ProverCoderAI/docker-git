// CHANGE: Migrate from Jest to Vitest with mathematical equivalence
// WHY: Faster execution, native ESM, Effect integration via @effect/vitest
// QUOTE(ТЗ): "Проект использует Effect + функциональную парадигму"
// REF: Migration from jest.config.mjs
// PURITY: SHELL (configuration only)
// INVARIANT: ∀ test: behavior_jest ≡ behavior_vitest
// EFFECT: Effect<TestReport, never, TestEnvironment>
// COMPLEXITY: O(n) test execution where n = |test_files|

import path from "node:path"
import { fileURLToPath } from "node:url"
import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [tsconfigPaths()], // Resolves @/* paths from tsconfig
  test: {
    // CHANGE: Native ESM support without experimental flags
    // WHY: Vitest designed for ESM, no need for --experimental-vm-modules
    // INVARIANT: Deterministic test execution without side effects
    globals: false, // IMPORTANT: Use explicit imports for type safety
    environment: "node",

    // CHANGE: Match Jest's test file patterns
    // INVARIANT: Same test discovery as Jest
    include: ["tests/**/*.{test,spec}.ts"],
    exclude: ["node_modules", "dist", "dist-test"],

    // CHANGE: Coverage with 100% threshold for CORE (same as Jest)
    // WHY: CORE must maintain mathematical guarantees via complete coverage
    // INVARIANT: coverage_vitest ≥ coverage_jest ∧ ∀ f ∈ CORE: coverage(f) = 100%
    coverage: {
      provider: "v8", // Faster than babel (istanbul), native V8 coverage
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/__tests__/**",
        "scripts/**/*.ts"
      ],
      // CHANGE: Maintain exact same thresholds as Jest
      // WHY: Enforce 100% coverage for CORE, 10% minimum for SHELL
      // INVARIANT: ∀ f ∈ src/core/**/*.ts: all_metrics(f) = 100%
      // NOTE: Vitest v8 provider collects coverage for all matched files by default
      thresholds: {
        "src/core/**/*.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100
        },
        global: {
          branches: 10,
          functions: 10,
          lines: 10,
          statements: 10
        }
      }
    },

    // CHANGE: Faster test execution via thread pooling
    // WHY: Vitest uses worker threads by default (faster than Jest's processes)
    // COMPLEXITY: O(n/k) where n = tests, k = worker_count
    // NOTE: Vitest runs tests in parallel by default, no additional config needed

    // CHANGE: Clear mocks between tests (Jest equivalence)
    // WHY: Prevent test contamination, ensure test independence
    // INVARIANT: ∀ test_i, test_j: independent(test_i, test_j) ⇒ no_shared_state
    clearMocks: true,
    mockReset: true,
    restoreMocks: true
    // CHANGE: Disable globals to enforce explicit imports
    // WHY: Type safety, explicit dependencies, functional purity
    // NOTE: Tests must import { describe, it, expect } from "vitest"
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  }
})
