# Task 6: bin/ccx-init.js — interactive setup wizard

## Context
ccx-relay is a Node.js PTY wrapper CLI. This is the one-time setup wizard users run before
first use. It writes config to the user's home config dir (handled by src/config.js).

## Global Constraints
- Node.js >= 18, no new runtime dependencies — use node:readline, node:fs built-ins
- ESM only (`export` not needed — this is a CLI entry point, not a module)
- Uses src/config.js (load, save, configPath) and src/gemini.js (enhance) from this project
- No unit tests — this is an interactive CLI, smoke test only

## Interfaces to use

**src/config.js:**
```js
import { load, save, configPath } from '../src/config.js';
// configPath(): string
// load(): { geminiApiKey, geminiModel, marker, timeoutSeconds }
// save(patch: object): void
```

**src/gemini.js:**
```js
import { enhance } from '../src/gemini.js';
// enhance(text, config): Promise<string>  -- use for key validation
```

## Requirements

### `bin/ccx-init.js`

Three subcommands based on `process.argv.slice(2)`:
- `ccx init` (no args) → run interactive wizard
- `ccx init --show` → print current config with masked key
- `ccx init --reset` → delete config file

#### `--show` behavior
```
Config: /path/to/config.json

  geminiApiKey:   AIzaS****...
  geminiModel:    gemini-2.5-flash
  marker:         ;;
  timeoutSeconds: 8
```
Key masked: first 6 chars + `****...`
If key is null: show `(not set)`

#### `--reset` behavior
- If config file exists: delete it, print `Config reset. Run \`ccx init\` to set up again.`
- If not: print `No config file found — nothing to reset.`
- Use `import { rmSync, existsSync } from 'node:fs'`

#### Interactive wizard (`ccx init`) flow

1. Print: `\n  Welcome to ccx setup\n`
2. Prompt for API key with hidden input (replace typed chars with `*`)
   - If empty, print `No key entered. Aborting.` and exit 1
3. Test the key: `process.stdout.write('  Testing key... ')`
   - Call `enhance('hello', { geminiApiKey: key, geminiModel: 'gemini-2.5-flash', timeoutSeconds: 10 })`
   - Success: print `\x1b[32m✓ Valid\x1b[0m\n`
   - Failure: print `\x1b[31m✗ Invalid key\x1b[0m — {err.message}\n` and exit 1
4. Model picker — numbered list:
   ```
     Model:
     1) gemini-2.5-flash (default)
     2) gemini-1.5-flash
     3) gemini-2.5-pro
   ```
   Prompt `  Choice [1]: ` — enter or `1` selects default, `2` or `3` select others
5. Prompt `  Trigger marker [;;]: ` — Enter keeps default `;;`
6. Prompt `  Timeout seconds [8]: ` — Enter keeps default `8`, parse with parseInt
7. Call `save({ geminiApiKey: key, geminiModel: model, marker, timeoutSeconds })`
8. Print `\n  Config saved to {configPath()}`
9. Print `  Run \`ccx claude\` to start.\n`

#### Hidden input implementation
Use `node:readline` with raw mode:

```js
async function promptHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    const rl = createInterface({ input: process.stdin, output: null, terminal: false });
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    let input = '';
    process.stdin.on('data', function onData(ch) {
      ch = ch.toString();
      if (ch === '\r' || ch === '\n') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.stdin.removeListener('data', onData);
        rl.close();
        resolve(input);
      } else if (ch === '\x7f' || ch === '\x08') {
        if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (ch === '\x03') {
        process.exit(0);
      } else {
        input += ch;
        process.stdout.write('*');
      }
    });
  });
}
```

#### Regular prompt helper
```js
async function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}
```

#### After wizard, add ccx-init to package.json bin
After creating `bin/ccx-init.js`, also update `package.json` to add `ccx-init` back to the bin field:
```json
"bin": {
  "ccx": "bin/ccx.js",
  "ccx-init": "bin/ccx-init.js"
},
```

## Smoke test
```
node bin/ccx-init.js --show
```
Expected: prints config path and current settings with masked key.

## Commit message
`feat: add ccx-init wizard with key validation and model picker`

## Report
Write to: `.superpowers/sdd/task-6-report.md`

Return only: Status, commit hash, smoke test result, concerns.
