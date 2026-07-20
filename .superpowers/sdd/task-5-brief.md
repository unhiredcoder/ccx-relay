# Task 5: Refactor bin/ccx.js — wire all modules + update package.json

## Context
ccx-relay is a Node.js PTY wrapper. All four src/ modules are now implemented.
This task replaces the monolithic bin/ccx.js with a thin entry point that wires them together,
and updates package.json for ESM and the new binary.

## Global Constraints
- Node.js >= 18, no new runtime dependencies
- ESM only — use dynamic `await import()` for node-pty (CommonJS module)
- package.json must have `"type": "module"`
- bin/ccx.js must NOT write to stderr directly — use ui.* methods
- bin/ccx.js must NOT call Gemini directly — use enhance() from src/gemini.js

## Interfaces from prior tasks (use exactly as specified)

**src/config.js:**
```js
load(): { geminiApiKey, geminiModel, marker, timeoutSeconds }
```

**src/gemini.js:**
```js
enhance(text, config): Promise<string>
// Error classes: RateLimitError, AuthError, ModelError, TimeoutError, NetworkError
```

**src/ui.js:**
```js
start(): void
stop(state: 'success'|'error', message: string): Promise<void>
clear(): void
```

**src/input.js:**
```js
createInputHandler({ marker, onEnhance, onSubmit, onPassthrough, onCtrlC })
// Returns: { processChunk(chunk:Buffer):void, setBusy(b:boolean):void, reset():void }
```

## Requirements

### `bin/ccx.js` (full rewrite)

```js
#!/usr/bin/env node
'use strict';

import { load } from '../src/config.js';
import { enhance, RateLimitError, AuthError, ModelError, TimeoutError, NetworkError } from '../src/gemini.js';
import { start as spinnerStart, stop as spinnerStop, clear as spinnerClear } from '../src/ui.js';
import { createInputHandler } from '../src/input.js';

let pty;
try {
  pty = (await import('node-pty')).default;
} catch (err) {
  process.stderr.write(
    '[ccx] Failed to load node-pty. On Windows install "Desktop development with C++"\n' +
    'workload (Visual Studio Build Tools) and Python, then run: npm rebuild node-pty\n' +
    `Original error: ${err.message}\n`
  );
  process.exit(1);
}

const config = load();

if (!config.geminiApiKey) {
  process.stderr.write('[ccx] No API key found. Run `ccx init` to set up.\n');
  process.exit(1);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write('[ccx] ccx must be run in an interactive terminal.\n');
  process.exit(1);
}

const argv      = process.argv.slice(2);
const targetCmd = argv[0] || 'claude';
const targetArgs= argv.slice(1);

const isWindows = process.platform === 'win32';
const shellFile = isWindows ? (process.env.COMSPEC || 'cmd.exe') : targetCmd;
const shellArgs = isWindows ? ['/d', '/s', '/c', [targetCmd, ...targetArgs].join(' ')] : targetArgs;

const ptyProcess = pty.spawn(shellFile, shellArgs, {
  name: 'xterm-color',
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows   || 24,
  cwd:  process.cwd(),
  env:  process.env,
});

ptyProcess.onData(data => process.stdout.write(data));

process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns, process.stdout.rows);
});

process.stdin.setRawMode(true);
process.stdin.resume();

const handler = createInputHandler({
  marker: config.marker,

  onEnhance: async (line) => {
    handler.setBusy(true);
    spinnerStart();
    let improved;
    try {
      improved = await enhance(line, config);
    } catch (err) {
      let msg = 'Enhancement failed';
      if (err instanceof RateLimitError) msg = 'Quota exceeded';
      else if (err instanceof AuthError)  msg = 'Invalid key — run ccx init';
      else if (err instanceof ModelError) msg = 'Model not found — run ccx init';
      else if (err instanceof TimeoutError) msg = `Timed out after ${config.timeoutSeconds}s — original restored`;
      else if (err instanceof NetworkError) msg = 'No connection — original restored';
      await spinnerStop('error', msg);
      ptyProcess.write(line);
      handler.setBusy(false);
      return;
    }
    await spinnerStop('success', 'Enhanced');
    ptyProcess.write(Buffer.alloc(line.length, 0x7f));
    ptyProcess.write(improved);
    handler.setBusy(false);
  },

  onSubmit: (_line) => {
    // Enter already forwarded by input.js passthrough
  },

  onPassthrough: (chunk) => ptyProcess.write(chunk),

  onCtrlC: () => {
    spinnerClear();
    handler.reset();
  },
});

process.stdin.on('data', chunk => handler.processChunk(chunk));

function cleanupAndExit(code) {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch (_) {}
  process.exit(code == null ? 0 : code);
}

ptyProcess.onExit(({ exitCode }) => cleanupAndExit(exitCode));
process.on('SIGINT', () => {});
```

### `package.json` changes

Update package.json to add/change these fields (keep all existing fields, just update/add):
```json
{
  "type": "module",
  "bin": {
    "ccx": "bin/ccx.js",
    "ccx-init": "bin/ccx-init.js"
  },
  "files": ["bin", "src", "README.md", ".env.example"],
  "scripts": {
    "test": "node --test test/**/*.test.js",
    "prepublishOnly": "npm test"
  },
  "engines": { "node": ">=18" }
}
```

## Verification
After rewriting:
1. Run `node --check bin/ccx.js` — must pass with no errors
2. Run existing tests: `node --test test/**/*.test.js` — all must still pass

## Commit message
`refactor: wire src modules into thin bin/ccx.js entry point`

## Report
Write to: `.superpowers/sdd/task-5-report.md`

Return only: Status, commit hash, verification results, concerns.
