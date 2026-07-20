# Task 1: src/config.js — user config load/save

## Context
ccx-relay is a Node.js PTY wrapper CLI being refactored into a production npm package.
This is the first task: create the config module that all other modules depend on.

## Global Constraints
- Node.js >= 18, no new runtime dependencies — built-ins only (node:fs, node:path, node:os)
- All files use ESM (package.json will have "type":"module") — use `export`, not `module.exports`
- Windows-first: config dir uses %APPDATA% on win32, ~/.config on other platforms
- All test files use Node built-in `node:test` and `node:assert` — no Jest, no Mocha

## Requirements

Create two files:

### `src/config.js`

Exports three functions:

**`configPath(): string`**
- Windows: `path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'ccx', 'config.json')`
- macOS/Linux: `path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'ccx', 'config.json')`

**`load(): object`**
Returns merged config with shape:
```js
{
  geminiApiKey: string|null,    // default: null
  geminiModel: string,          // default: 'gemini-2.5-flash'
  marker: string,               // default: ';;'
  timeoutSeconds: number,       // default: 8
}
```
Priority (highest first):
1. Env vars: GEMINI_API_KEY, GEMINI_MODEL, CCX_MARKER, CCX_TIMEOUT
2. config.json file (if exists, parsed JSON)
3. Hardcoded defaults above

If config.json doesn't exist or fails to parse, use defaults silently.
`timeoutSeconds` must be cast with `Number()`.

**`save(patch: object): void`**
- Creates directory if needed (`mkdirSync` with `{ recursive: true }`)
- Reads existing config.json (or uses `{}` if missing/corrupt)
- Deep-merges patch into existing with spread: `{ ...existing, ...patch }`
- Writes pretty-printed JSON (2-space indent)

### `test/config.test.js`

Five tests using `node:test` and `node:assert`:
1. `configPath()` returns path ending in `config.json` and containing `ccx`
2. `load()` returns defaults when no config file exists
3. `load()` reads values from config file
4. env vars override config file values
5. `save()` writes patch and `load()` reads it back

**Test isolation:** override `process.env.APPDATA` and `process.env.HOME` to a tmpdir, delete GEMINI_API_KEY/GEMINI_MODEL/CCX_MARKER/CCX_TIMEOUT from env.

## TDD Steps
1. Write test file first
2. Run `node --test test/config.test.js` — expect failure (file not found)
3. Implement src/config.js
4. Run tests again — all 5 must pass
5. Commit both files

## Commit message
`feat: add src/config.js with user config load/save`

## Report
Write your report to: `.superpowers/sdd/task-1-report.md`

Return only:
- Status: DONE / DONE_WITH_CONCERNS / BLOCKED
- Commits made (short hash)
- Test result: "5/5 passing"
- Any concerns
