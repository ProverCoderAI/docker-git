// eslint.config.mjs
// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import vitest from "@vitest/eslint-plugin";
import suggestMembers from "@prover-coder-ai/eslint-plugin-suggest-members";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import * as effectEslint from "@effect/eslint-plugin";
import { fixupPluginRules } from "@eslint/compat";
import codegen from "eslint-plugin-codegen";
import importPlugin from "eslint-plugin-import";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import sortDestructureKeys from "eslint-plugin-sort-destructure-keys";
import globals from "globals";
import eslintCommentsConfigs from "@eslint-community/eslint-plugin-eslint-comments/configs";

const codegenPlugin = fixupPluginRules(
	codegen as unknown as Parameters<typeof fixupPluginRules>[0],
);

const noFetchExample = [
	"Пример:",
	"  import { FetchHttpClient, HttpClient } from \"@effect/platform\"",
	"  import { Effect } from \"effect\"",
	"  const program = Effect.gen(function* () {",
	"    const client = yield* HttpClient.HttpClient",
	"    return yield* client.get(`${api}/robots`)",
	"  }).pipe(",
	"    Effect.scoped,",
	"    Effect.provide(FetchHttpClient.layer)",
	"  )",
].join("\n");

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  effectEslint.configs.dprint,
  suggestMembers.configs.recommended,
  eslintCommentsConfigs.recommended,
  {
    name: "analyzers",
    languageOptions: {
      parser: tseslint.parser,
	  globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,          
        tsconfigRootDir: import.meta.dirname,
      },
    },
	plugins: {
		sonarjs,
		unicorn,
		import: fixupPluginRules(importPlugin),
		"sort-destructure-keys": sortDestructureKeys,
		"simple-import-sort": simpleImportSort,
		codegen: codegenPlugin,
	},
	files: ["**/*.ts", '**/*.{test,spec}.{ts,tsx}', '**/tests/**', '**/__tests__/**'],
	settings: {
		"import/parsers": {
			"@typescript-eslint/parser": [".ts", ".tsx"],
		},
		"import/resolver": {
			typescript: {
				alwaysTryTypes: true,
			},
		},
	},
	rules: {
		...sonarjs.configs.recommended.rules,
		...unicorn.configs.recommended.rules,
		"no-restricted-imports": ["error", {
			paths: [
				{
					name: "ts-pattern",
					message: "Use Effect.Match instead of ts-pattern.",
				},
				{
					name: "zod",
					message: "Use @effect/schema for schemas and validation.",
				},
			],
		}],
		"codegen/codegen": "error",
		"import/first": "error",
		"import/newline-after-import": "error",
		"import/no-duplicates": "error",
		"import/no-unresolved": "off",
		"import/order": "off",
		"simple-import-sort/imports": "off",
		"sort-destructure-keys/sort-destructure-keys": "error",
		"no-fallthrough": "off",
		"no-irregular-whitespace": "off",
		"object-shorthand": "error",
		"prefer-destructuring": "off",
		"sort-imports": "off",
		"no-unused-vars": "off",
		"prefer-rest-params": "off",
		"prefer-spread": "off",
		"unicorn/prefer-top-level-await": "off",
		"unicorn/prevent-abbreviations": "off",
		"unicorn/no-null": "off",
		complexity: ["error", 8],
		"max-lines-per-function": [
			"error",
			{ max: 50, skipBlankLines: true, skipComments: true },
		],
		"max-params": ["error", 5],
		"max-depth": ["error", 4],
		"max-lines": [
			"error",
			{ max: 300, skipBlankLines: true, skipComments: true },
		],

		"@typescript-eslint/restrict-template-expressions": ["error", {
			allowNumber: true,
			allowBoolean: true,
			allowNullish: false,
			allowAny: false,
			allowRegExp: false
		}],
		"@eslint-community/eslint-comments/no-use": "error",
		"@eslint-community/eslint-comments/no-unlimited-disable": "error",
		"@eslint-community/eslint-comments/disable-enable-pair": "error",
		"@eslint-community/eslint-comments/no-unused-disable": "error",
		"no-restricted-syntax": [
				"error",
				{
					selector: "TSUnknownKeyword",
					message: "Запрещено 'unknown'.",
				},
				// CHANGE: запрет прямого fetch в коде
				// WHY: enforce Effect-TS httpClient as единственный источник сетевых эффектов
				// QUOTE(ТЗ): "Вместо fetch должно быть всегда написано httpClient от библиотеки Effect-TS"
				// REF: user-msg-1
				// SOURCE: n/a
				// FORMAT THEOREM: ∀call ∈ Calls: callee(call)=fetch → lint_error(call)
				// PURITY: SHELL
				// EFFECT: Effect<never, never, never>
				// INVARIANT: direct fetch calls are forbidden
				// COMPLEXITY: O(1)
				{
					selector: "CallExpression[callee.name='fetch']",
					message: `Запрещён fetch — используй HttpClient (Effect-TS).\n${noFetchExample}`,
				},
				{
					selector:
						"CallExpression[callee.object.name='window'][callee.property.name='fetch']",
					message: `Запрещён window.fetch — используй HttpClient (Effect-TS).\n${noFetchExample}`,
				},
				{
					selector:
						"CallExpression[callee.object.name='globalThis'][callee.property.name='fetch']",
					message: `Запрещён globalThis.fetch — используй HttpClient (Effect-TS).\n${noFetchExample}`,
				},
				{
					selector:
						"CallExpression[callee.object.name='self'][callee.property.name='fetch']",
					message: `Запрещён self.fetch — используй HttpClient (Effect-TS).\n${noFetchExample}`,
				},
				{
					selector:
						"CallExpression[callee.object.name='global'][callee.property.name='fetch']",
					message: `Запрещён global.fetch — используй HttpClient (Effect-TS).\n${noFetchExample}`,
				},
				{
					selector: "TryStatement",
					message: "Используй Effect.try / catchAll вместо try/catch в core/app/domain.",
				},
				{
					selector: "SwitchStatement",
					message: [
						"Switch statements are forbidden in functional programming paradigm.",
						"How to fix: Use Effect.Match instead.",
						"Example:",
						"  import { Match } from 'effect';",
						"  type Item = { type: 'this' } | { type: 'that' };",
						"  const result = Match.value(item).pipe(",
						"    Match.when({ type: 'this' }, (it) => processThis(it)),",
						"    Match.when({ type: 'that' }, (it) => processThat(it)),",
						"    Match.exhaustive,",
						"  );",
					].join("\n"),
				},
				{
					selector: 'CallExpression[callee.name="require"]',
					message: "Avoid using require(). Use ES6 imports instead.",
				},
				{
					selector: "ThrowStatement > Literal:not([value=/^\\w+Error:/])",
					message:
						'Do not throw string literals or non-Error objects. Throw new Error("...") instead.',
				},
				{
					selector:
						"FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]",
					message:
						"Запрещён async/await — используй Effect.gen / Effect.tryPromise.",
				},
				{
					selector: "NewExpression[callee.name='Promise']",
					message:
						"Запрещён new Promise — используй Effect.async / Effect.tryPromise.",
				},
				{
					selector: "CallExpression[callee.object.name='Promise']",
					message:
						"Запрещены Promise.* — используй комбинаторы Effect (all, forEach, etc.).",
				},
				{
					selector: "CallExpression[callee.property.name='push'] > SpreadElement.arguments",
					message: "Do not use spread arguments in Array.push",
				},
		],
		"no-throw-literal": "error",
		"@typescript-eslint/no-restricted-types": [
				"error",
				{
					types: {
						unknown: {
							message:
								"Не используем 'unknown'. Уточни тип или наведи порядок в источнике данных.",
						},
						Promise: {
							message: "Запрещён Promise — используй Effect.Effect<A, E, R>.",
							suggest: ["Effect.Effect"],
						},
						"Promise<*>": {
							message:
								"Запрещён Promise<T> — используй Effect.Effect<T, E, R>.",
							suggest: ["Effect.Effect<T, E, R>"],
						},
					},
				},
			],
		"@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
		// "no-throw-literal": "off",
		"@typescript-eslint/only-throw-error": [
			"error",
			{ allowThrowingUnknown: false, allowThrowingAny: false },
		],
		"@typescript-eslint/array-type": ["warn", {
			default: "generic",
			readonly: "generic"
		}],
		"@typescript-eslint/member-delimiter-style": 0,
		"@typescript-eslint/no-non-null-assertion": "off",
		"@typescript-eslint/ban-types": "off",
		"@typescript-eslint/no-explicit-any": "off",
		"@typescript-eslint/no-empty-interface": "off",
		"@typescript-eslint/consistent-type-imports": "warn",
		"@typescript-eslint/no-unused-vars": ["error", {
			argsIgnorePattern: "^_",
			varsIgnorePattern: "^_"
		}],
		"@typescript-eslint/ban-ts-comment": "off",
		"@typescript-eslint/camelcase": "off",
		"@typescript-eslint/explicit-function-return-type": "off",
		"@typescript-eslint/explicit-module-boundary-types": "off",
		"@typescript-eslint/interface-name-prefix": "off",
		"@typescript-eslint/no-array-constructor": "off",
		"@typescript-eslint/no-use-before-define": "off",
		"@typescript-eslint/no-namespace": "off",
		"@effect/dprint": ["error", {
			config: {
				indentWidth: 2,
				lineWidth: 120,
				semiColons: "asi",
				quoteStyle: "alwaysDouble",
				trailingCommas: "never",
				operatorPosition: "maintain",
				"arrowFunction.useParentheses": "force"
			}
		}]
	}
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'tests/**', '**/__tests__/**'],
    ...vitest.configs.all,
    languageOptions: {
      globals: {
        ...vitest.environments.env.globals,
      },
    },
    rules: {
      // Allow eslint-disable/enable comments in test files for fine-grained control
      '@eslint-community/eslint-comments/no-use': 'off',
      // Disable line count limit for E2E tests that contain multiple test cases
      'max-lines-per-function': 'off',
      // `it.effect` is not recognized by sonar rule; disable to avoid false positives
      'sonarjs/no-empty-test-file': 'off',
    },
  },

  // 3) Для JS-файлов отключим типо-зависимые проверки
  {
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // 4) Глобальные игноры
  { ignores: ['dist/**', 'build/**', 'coverage/**', '**/dist/**'] },
);
