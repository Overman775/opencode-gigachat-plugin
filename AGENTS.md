# AI Coding Assistant Guidelines (AGENTS.md)

Guidance for AI agents working with this repository.

## Overview

OpenCode plugin for GigaChat / GigaCode API. Intercepts fetch() calls to `api.gigachat.local` and `ngw.devices.sberbank.ru`, transforms them to Sberbank GigaChat format, and handles auth, Vision uploads, SSL/mTLS verification, quota recovery, and multi-account rotation.

---

## Build & Test Commands

```bash
npm install                                     # Install dependencies
npm run build                                   # Compile (tsc)
npm run watch                                   # Watch mode for auto-compilation
npm test                                        # Run all tests (vitest run)
npx vitest run src/plugin/request.test.ts       # Single test file
npx vitest run -t "should translate"            # Single test by name
npx vitest --watch src/plugin/request.test.ts   # Watch mode, single file
```

No linter or formatter is configured. Style is enforced by convention (see below).

---

## TypeScript Configuration

* `strict: true` with extra strictness: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`
* `verbatimModuleSyntax: true` — use `import type` / `export type` for type-only imports and exports
* `target: ES2022`, `module: node16`, `moduleResolution: node16`
* Use `.js` extensions in imports (since Node16 ESM requires `.js` extensions for relative file paths)
* No path aliases — all imports are relative

---

## Code Style

### Imports

* Use `import type { ... }` or `export type { ... }` for type-only imports/exports (enforced by `verbatimModuleSyntax`)
* Named imports only — no default imports in `src/`
* Relative paths with `.js` extensions: `import { foo } from "./bar.js"`
* **Order**: Node builtins (e.g. `fs`, `https`) > external packages (e.g. `axios`, `uuid`) > local modules (e.g. `../constants.js`)

### Exports

* Named exports only in `src/` — no default exports (except in `src/index.ts` to export the main plugin to the OpenCode engine)
* Barrel files (`index.ts`) for module surfaces

### Naming

* `camelCase` for functions, variables, parameters
* `PascalCase` for types, interfaces, classes, enums
* `UPPER_SNAKE_CASE` for constants
* `kebab-case` for file names (e.g., `request.ts`, `certs.ts`)
* Test files: `*.test.ts` colocated with source

### Types

* No `I` prefix on interfaces, no `Type` suffix
* Extract to separate files when shared, inline when local
* Discriminated unions preferred over boolean flags
* Never use `as any` (unless mapping untyped API payloads), `@ts-ignore`, or `@ts-expect-error`

### Functions

* `export function` for public APIs
* Arrow functions for callbacks, factories, and inline closures
* Async functions with targeted try/catch (not blanket)

### Error Handling

* Defensive try/catch with graceful degradation (fallback values, not crashes)
* Custom error handling inside interceptors to catch network errors
* Catch unknown, log, and convert to domain errors — never empty catch blocks
* Rate limit / quota errors (403, 429) trigger account rotation, not failure
* **Sanitization**: Always delete `"Authorization"` or Basic credentials headers from Axios errors (`err.config.headers`) inside catch blocks before logging or rethrowing them to prevent secrets leak

### Formatting

* 2-space indentation
* Double quotes for strings
* Trailing commas in multiline constructs
* Semicolons required (project convention)

### Logging

* Structured prefixes in console output (e.g., `[GigaCode-Fetch]`, `[GigaCode-Auth]`)
* `console.log` / `console.warn` for CLI/user-facing output and tracking interception states
