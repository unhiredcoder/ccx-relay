# ccx-relay Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor ccx-relay into production-ready modules with Alt+M shortcut, animated spinner, typed errors, `ccx init` wizard, and GitHub Actions CI/CD for public npm release.

**Architecture:** Extract `bin/ccx.js` monolith into four focused `src/` modules (config, input, gemini, ui), wire them in a thin entry point, add a separate `bin/ccx-init.js` wizard binary, and add test + publish GitHub Actions workflows.

**Tech Stack:** Node.js >=18, node-pty, dotenv (dev only), node:test (built-in), node:readline (built-in), node:fs, node:path, node:os

## Global Constraints

- Node.js >= 18 (uses built-in `fetch`, `node:test`, `node:readline`)
- No new runtime dependencies — use only what is already in `package.json` plus Node built-ins
- Windows-first: all paths use `path.join`, config dir uses `%APPDATA%` on win32
- `ui.js` is the ONLY module that writes to stderr — all others call `ui.*` methods
- `input.js` must be pure parsing — no Gemini calls, no terminal writes
- Existing PTY spawn logic, `parseWin32InputSeq`, and Gemini prompt text unchanged
- All test files use Node built-in `node:test` and `node:assert` — no Jest, no Mocha

---

### Task 1: `src/config.js` — user config load/save

**Files:**
- Create: `src/config.js`
- Create: `test/config.test.js`

**Interfaces:**
- Produces:
  - `configPath(): string` — returns platform-specific path to `config.json`
  - `load(): { geminiApiKey: string|null, geminiModel: string, marker: string, timeoutSeconds: number }` — merges file + env vars + defaults
  - `save(patch: object): void` — deep-merges patch into existing config and writes

- [ ] **Step 1: Write failing tests**

Create `test/config.test.js`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { configPath, load, save } from '../src/config.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Override APPDATA/HOME for test isolation
const testDir = join(tmpdir(), 'ccx-test-' + process.pid);
process.env.APPDATA = testDir;
process.env.HOME = testDir;
// Clear any real env vars that would override
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.CCX_MARKER;
delete process.env.CCX_TIMEOUT;

test('configPath returns path ending in ccx/config.json', () => {
  const p = configPath();
  assert.ok(p.endsWith('config.json'));
  assert.ok(p.includes('ccx'));
});

test('load returns defaults when no config file exists', () => {
  const cfg = load();
  assert.equal(cfg.geminiApiKey, null);
  assert.equal(cfg.geminiModel, 'gemini-2.5-flash');
  assert.equal(cfg.marker, ';;');
  assert.equal(cfg.timeoutSeconds, 8);
});

test('load reads values from config file', () => {
  const dir = join(testDir, 'ccx');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    geminiApiKey: 'AIzaTEST',
    geminiModel: 'gemini-1.5-flash',
    marker: '!!',
    timeoutSeconds: 5
  }));
  const cfg = load();
  assert.equal(cfg.geminiApiKey, 'AIzaTEST');
  assert.equal(cfg.geminiModel, 'gemini-1.5-flash');
  assert.equal(cfg.marker, '!!');
  assert.equal(cfg.timeoutSeconds, 5);
  rmSync(dir, { recursive: true });
});

test('env vars override config file', () => {
  const dir = join(testDir, 'ccx');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ geminiApiKey: 'AIzaFILE' }));
  process.env.GEMINI_API_KEY = 'AIzaENV';
  const cfg = load();
  assert.equal(cfg.geminiApiKey, 'AIzaENV');
  delete process.env.GEMINI_API_KEY;
  rmSync(dir, { recursive: true });
});

test('save writes patch to config file', () => {
  save({ geminiApiKey: 'AIzaSAVED', geminiModel: 'gemini-2.5-flash' });
  const cfg = load();
  assert.equal(cfg.geminiApiKey, 'AIzaSAVED');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
node --test test/config.test.js
```
Expected: `ERR_MODULE_NOT_FOUND` — `src/config.js` does not exist yet.

- [ ] **Step 3: Implement `src/config.js`**

```js
'use strict';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULTS = {
  geminiApiKey: null,
  geminiModel: 'gemini-2.5-flash',
  marker: ';;',
  timeoutSeconds: 8,
};

export function configPath() {
  const base = process.platform === 'win32'
    ? (process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_CONFIG_HOME || join(homedir(), '.config'));
  return join(base, 'ccx', 'config.json');
}

export function load() {
  const p = configPath();
  let file = {};
  if (existsSync(p)) {
    try { file = JSON.parse(readFileSync(p, 'utf8')); } catch (_) {}
  }
  return {
    geminiApiKey:    process.env.GEMINI_API_KEY   || file.geminiApiKey    || DEFAULTS.geminiApiKey,
    geminiModel:     process.env.GEMINI_MODEL      || file.geminiModel     || DEFAULTS.geminiModel,
    marker:          process.env.CCX_MARKER        || file.marker          || DEFAULTS.marker,
    timeoutSeconds:  Number(process.env.CCX_TIMEOUT || file.timeoutSeconds || DEFAULTS.timeoutSeconds),
  };
}

export function save(patch) {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  let existing = {};
  if (existsSync(p)) {
    try { existing = JSON.parse(readFileSync(p, 'utf8')); } catch (_) {}
  }
  writeFileSync(p, JSON.stringify({ ...existing, ...patch }, null, 2));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
node --test test/config.test.js
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```
git add src/config.js test/config.test.js
git commit -m "feat: add src/config.js with user config load/save"
```

---

### Task 2: `src/ui.js` — spinner, status lines, ANSI output

**Files:**
- Create: `src/ui.js`

**Interfaces:**
- Produces:
  - `start(): void` — begin spinning animation on stderr
  - `stop(state: 'success'|'error', message: string): Promise<void>` — show final state 400ms then clear
  - `clear(): void` — immediately clear status line

- [ ] **Step 1: Implement `src/ui.js`**

No unit tests for UI — ANSI output is not meaningful to assert on in a terminal-less test runner. Visual verification in Step 2.

```js
'use strict';

const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';
const SAVE   = '\x1b[s';
const RESTORE= '\x1b[u';
const DOWN   = '\r\n';
const ERASE  = '\x1b[2K';

let _timer = null;
let _frame = 0;

function _draw(text) {
  process.stderr.write(SAVE + DOWN + ERASE + text + RESTORE);
}

export function start() {
  _frame = 0;
  _draw(FRAMES[0] + ' Enhancing prompt...');
  _timer = setInterval(() => {
    _frame = (_frame + 1) % FRAMES.length;
    _draw(FRAMES[_frame] + ' Enhancing prompt...');
  }, 80);
}

export function stop(state, message) {
  if (_timer) { clearInterval(_timer); _timer = null; }
  const color  = state === 'success' ? GREEN : RED;
  const symbol = state === 'success' ? '✓' : '✗';
  _draw(color + symbol + ' ' + message + RESET);
  return new Promise(resolve => setTimeout(() => { clear(); resolve(); }, 400));
}

export function clear() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  process.stderr.write(SAVE + DOWN + ERASE + RESTORE);
}
```

- [ ] **Step 2: Visual smoke test**

```
node -e "
import('./src/ui.js').then(async ({ start, stop }) => {
  start();
  await new Promise(r => setTimeout(r, 1500));
  await stop('success', 'Enhanced');
  console.log('done');
  process.exit(0);
});
"
```
Expected: spinner animates ~1.5s, flashes green `✓ Enhanced`, then clears.

- [ ] **Step 3: Commit**

```
git add src/ui.js
git commit -m "feat: add src/ui.js Braille spinner with ANSI status lines"
```

---

### Task 3: `src/gemini.js` — API client with typed errors and timeout

**Files:**
- Create: `src/gemini.js`
- Create: `test/gemini.test.js`

**Interfaces:**
- Consumes: `config` object from `load()` in Task 1 — shape `{ geminiApiKey, geminiModel, timeoutSeconds }`
- Produces:
  - `enhance(text: string, config: object): Promise<string>` — returns rewritten text
  - Error classes (all extend Error): `RateLimitError`, `AuthError`, `ModelError`, `TimeoutError`, `NetworkError`

- [ ] **Step 1: Write failing tests**

Create `test/gemini.test.js`:

```js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// Minimal mock config
const cfg = { geminiApiKey: 'AIzaTEST', geminiModel: 'gemini-2.5-flash', timeoutSeconds: 8 };

// Mock global fetch
function mockFetch(status, body) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

const { enhance, RateLimitError, AuthError, ModelError, TimeoutError, NetworkError } =
  await import('../src/gemini.js');

test('returns rewritten text on success', async () => {
  mockFetch(200, { candidates: [{ content: { parts: [{ text: 'Fixed text' }] } }] });
  const result = await enhance('fix teh bug', cfg);
  assert.equal(result, 'Fixed text');
});

test('throws RateLimitError on 429', async () => {
  mockFetch(429, { error: { message: 'quota' } });
  await assert.rejects(() => enhance('text', cfg), RateLimitError);
});

test('throws AuthError on 401', async () => {
  mockFetch(401, { error: { message: 'unauth' } });
  await assert.rejects(() => enhance('text', cfg), AuthError);
});

test('throws AuthError on 403', async () => {
  mockFetch(403, { error: { message: 'forbidden' } });
  await assert.rejects(() => enhance('text', cfg), AuthError);
});

test('throws ModelError on 404', async () => {
  mockFetch(404, { error: { message: 'not found' } });
  await assert.rejects(() => enhance('text', cfg), ModelError);
});

test('throws NetworkError on fetch rejection', async () => {
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(() => enhance('text', cfg), NetworkError);
});

test('throws TimeoutError when AbortController fires', async () => {
  global.fetch = () => new Promise(() => {}); // never resolves
  const fastCfg = { ...cfg, timeoutSeconds: 0.05 };
  await assert.rejects(() => enhance('text', fastCfg), TimeoutError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
node --test test/gemini.test.js
```
Expected: `ERR_MODULE_NOT_FOUND` — `src/gemini.js` does not exist yet.

- [ ] **Step 3: Implement `src/gemini.js`**

```js
'use strict';

export class RateLimitError extends Error {}
export class AuthError      extends Error {}
export class ModelError     extends Error {}
export class TimeoutError   extends Error {}
export class NetworkError   extends Error {}

const PROMPT_PREFIX =
  'Rewrite the following text to be grammatically correct and clearer, ' +
  'while preserving its original intent and meaning exactly. ' +
  'This is a single line typed into a terminal prompt, not a chat message - ' +
  'respond with EXACTLY ONE rewritten version as a single plain-text line. ' +
  'Do not offer multiple options or alternatives. Do not add headings, bullet ' +
  'points, markdown formatting, quotes, explanations, or any commentary. ' +
  'Output must contain nothing but the rewritten line itself.\n\nText:\n';

export async function enhance(text, config) {
  const { geminiApiKey, geminiModel, timeoutSeconds } = config;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT_PREFIX + text }] }] }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new TimeoutError(`Timed out after ${timeoutSeconds}s`);
    throw new NetworkError('No connection');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 429)              throw new RateLimitError('Quota exceeded');
    if (res.status === 401 || res.status === 403) throw new AuthError('Invalid key — run ccx init');
    if (res.status === 404)              throw new ModelError('Model not found — run ccx init');
    const body = await res.text();
    throw new NetworkError(`API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const result = parts?.map(p => p.text || '').join('').trim();
  if (!result) throw new NetworkError('Gemini returned empty response');
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
node --test test/gemini.test.js
```
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```
git add src/gemini.js test/gemini.test.js
git commit -m "feat: add src/gemini.js with typed errors and AbortController timeout"
```

---

### Task 4: `src/input.js` — pure stdin parser with Alt+M and ;; triggers

**Files:**
- Create: `src/input.js`
- Create: `test/input.test.js`

**Interfaces:**
- Produces:
  - `createInputHandler(opts: { marker: string, onEnhance: (line:string)=>void, onSubmit: (line:string)=>void, onPassthrough: (chunk:Buffer)=>void, onCtrlC: ()=>void }): { processChunk(chunk:Buffer):void, setBusy(b:boolean):void, reset():void }`

- [ ] **Step 1: Write failing tests**

Create `test/input.test.js`:

```js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createInputHandler } from '../src/input.js';

function makeHandler(overrides = {}) {
  const events = [];
  const h = createInputHandler({
    marker: ';;',
    onEnhance:    line  => events.push({ type: 'enhance', line }),
    onSubmit:     line  => events.push({ type: 'submit',  line }),
    onPassthrough:chunk => events.push({ type: 'pass',    chunk }),
    onCtrlC:      ()    => events.push({ type: 'ctrlc' }),
    ...overrides,
  });
  return { h, events };
}

test('printable chars build lineBuffer and passthrough', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('hello'));
  assert.equal(events.filter(e => e.type === 'pass').length, 5);
});

test('Enter submits plain line', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('hello'));
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hello'));
});

test(';; + Enter triggers enhance', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('fix bug;;'));
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'enhance' && e.line === 'fix bug'));
});

test(';; only (no content before) does not trigger enhance', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from(';;'));
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(!events.find(e => e.type === 'enhance'));
  assert.ok(events.find(e => e.type === 'submit'));
});

test('Alt+M (ESC m) triggers enhance on non-empty line', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('fix bug'));
  h.processChunk(Buffer.from([0x1b, 0x6d]));
  assert.ok(events.find(e => e.type === 'enhance' && e.line === 'fix bug'));
});

test('Alt+M on empty line does passthrough', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from([0x1b, 0x6d]));
  assert.ok(!events.find(e => e.type === 'enhance'));
  assert.ok(events.find(e => e.type === 'pass'));
});

test('Backspace pops last char from buffer', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('hello'));
  h.processChunk(Buffer.from([0x7f]));
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hell'));
});

test('Ctrl+C emits ctrlc', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from([0x03]));
  assert.ok(events.find(e => e.type === 'ctrlc'));
});

test('setBusy blocks enhance triggers', () => {
  const { h, events } = makeHandler();
  h.setBusy(true);
  h.processChunk(Buffer.from('fix bug;;'));
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(!events.find(e => e.type === 'enhance'));
});

test('win32-input-mode Enter (VK=13 kd=1) submits line', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('hello'));
  // ESC [ 1 3 ; 0 ; 1 3 ; 1 ; 0 ; 1 _
  h.processChunk(Buffer.from('\x1b[13;0;13;1;0;1_'));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hello'));
});

test('win32-input-mode Alt+M (VK=77 kd=1 cs=2) triggers enhance', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('fix bug'));
  // ESC [ 7 7 ; 5 0 ; 1 0 9 ; 1 ; 2 ; 1 _  (VK=77, Uc=109='m', kd=1, cs=2=Alt)
  h.processChunk(Buffer.from('\x1b[77;50;109;1;2;1_'));
  assert.ok(events.find(e => e.type === 'enhance' && e.line === 'fix bug'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
node --test test/input.test.js
```
Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `src/input.js`**

```js
'use strict';

function parseWin32InputSeq(chunk, i) {
  if (chunk[i + 1] !== 0x5b) return null;
  let j = i + 2;
  const start = j;
  while (j < chunk.length && ((chunk[j] >= 0x30 && chunk[j] <= 0x39) || chunk[j] === 0x3b)) j++;
  if (j >= chunk.length || chunk[j] !== 0x5f || j === start) return null;
  const parts = chunk.slice(start, j).toString('ascii').split(';').map(Number);
  if (parts.length !== 6 || parts.some(Number.isNaN)) return null;
  const [vk, sc, uc, kd, cs, rc] = parts;
  return { consumed: j + 1 - i, vk, sc, uc, kd, cs, rc };
}

const ALT_BIT = 0x0001 | 0x0002; // LEFT_ALT | RIGHT_ALT

export function createInputHandler({ marker, onEnhance, onSubmit, onPassthrough, onCtrlC }) {
  let lineBuffer = '';
  let busy = false;

  function tryEnhance() {
    const toSend = lineBuffer.slice(0, -marker.length);
    onEnhance(toSend);
  }

  function processChunk(chunk) {
    if (busy) { onPassthrough(chunk); return; }

    let i = 0;
    while (i < chunk.length) {
      const byte = chunk[i];

      if (byte === 0x1b) {
        // Check win32-input-mode sequence first
        const seq = parseWin32InputSeq(chunk, i);
        if (seq) {
          if (seq.kd === 1) {
            if (seq.vk === 13) {
              // Win32 Enter
              if (lineBuffer.endsWith(marker) && lineBuffer.trim().length > marker.length) {
                tryEnhance(); return;
              }
              onSubmit(lineBuffer);
              lineBuffer = '';
            } else if (seq.vk === 8) {
              // Win32 Backspace
              if (lineBuffer.length > 0) lineBuffer = lineBuffer.slice(0, -1);
            } else if (seq.vk === 77 && (seq.cs & ALT_BIT)) {
              // Win32 Alt+M
              if (lineBuffer.length > 0) { tryEnhance(); return; }
              onPassthrough(chunk.slice(i, i + seq.consumed));
            }
          }
          onPassthrough(chunk.slice(i, i + seq.consumed));
          i += seq.consumed;
          continue;
        }

        // Alt+M: ESC followed by 'm' (0x6d)
        if (i + 1 < chunk.length && chunk[i + 1] === 0x6d) {
          if (lineBuffer.length > 0) { tryEnhance(); return; }
          onPassthrough(chunk.slice(i, i + 2));
          i += 2;
          continue;
        }

        // Other escape sequence — forward rest of chunk untouched
        onPassthrough(chunk.slice(i));
        return;
      }

      if (byte === 0x0d) {
        // Enter
        if (lineBuffer.endsWith(marker) && lineBuffer.trim().length > marker.length) {
          tryEnhance(); return;
        }
        onSubmit(lineBuffer);
        onPassthrough(Buffer.from([byte]));
        lineBuffer = '';
        i++; continue;
      }

      if (byte === 0x03) {
        onCtrlC();
        onPassthrough(Buffer.from([byte]));
        lineBuffer = '';
        i++; continue;
      }

      if (byte === 0x7f || byte === 0x08) {
        if (lineBuffer.length > 0) lineBuffer = lineBuffer.slice(0, -1);
        onPassthrough(Buffer.from([byte]));
        i++; continue;
      }

      lineBuffer += String.fromCharCode(byte);
      onPassthrough(Buffer.from([byte]));
      i++;
    }
  }

  function setBusy(b) { busy = b; }
  function reset() { lineBuffer = ''; busy = false; }

  return { processChunk, setBusy, reset };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
node --test test/input.test.js
```
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```
git add src/input.js test/input.test.js
git commit -m "feat: add src/input.js with Alt+M and ;; trigger parsing"
```

---

### Task 5: Refactor `bin/ccx.js` — wire all modules, replace monolith

**Files:**
- Modify: `bin/ccx.js` (full rewrite)

**Interfaces:**
- Consumes:
  - `load()` from `src/config.js`
  - `enhance(text, config)` + error classes from `src/gemini.js`
  - `start(), stop(state, message), clear()` from `src/ui.js`
  - `createInputHandler(opts)` from `src/input.js`

- [ ] **Step 1: Rewrite `bin/ccx.js`**

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
      // Restore original line
      ptyProcess.write(line);
      handler.setBusy(false);
      return;
    }
    await spinnerStop('success', 'Enhanced');
    // Erase original, write improved
    ptyProcess.write(Buffer.alloc(line.length, 0x7f));
    ptyProcess.write(improved);
    handler.setBusy(false);
  },

  onSubmit: (_line) => {
    // Enter already forwarded by input.js passthrough for non-enhance case
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

- [ ] **Step 2: Add `"type": "module"` to package.json**

Edit `package.json` — add `"type": "module"` at top level so Node treats `.js` files as ESM:

```json
{
  "name": "ccx-relay",
  "version": "1.0.0",
  "type": "module",
  "description": "Transparent PTY wrapper for Claude Code that lets you refine prompts with Gemini AI before submitting.",
  "main": "bin/ccx.js",
  "bin": {
    "ccx": "bin/ccx.js",
    "ccx-init": "bin/ccx-init.js"
  },
  "files": ["bin", "src", "README.md", ".env.example"],
  "scripts": {
    "test": "node --test test/**/*.test.js",
    "prepublishOnly": "npm test"
  },
  "engines": { "node": ">=18" },
  "keywords": ["cli","claude","claude-code","gemini","pty","terminal","ai","prompt-engineering"],
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "dependencies": {
    "dotenv": "^16.4.5",
    "node-pty": "^1.0.0"
  }
}
```

- [ ] **Step 3: Smoke test end-to-end**

```
node --check bin/ccx.js
ccx powershell
```
Type `hello world` then press Enter. Should behave exactly as before.
Type `fix teh bug;;` then press Enter. Should show spinner then rewritten line.
Type `fix teh bug` then press `Alt+M`. Should show spinner then rewritten line.

- [ ] **Step 4: Commit**

```
git add bin/ccx.js package.json
git commit -m "refactor: wire src modules into thin bin/ccx.js entry point"
```

---

### Task 6: `bin/ccx-init.js` — interactive setup wizard

**Files:**
- Create: `bin/ccx-init.js`

**Interfaces:**
- Consumes: `load(), save(), configPath()` from `src/config.js`
- Consumes: `enhance()` from `src/gemini.js` (key validation test call)

- [ ] **Step 1: Implement `bin/ccx-init.js`**

```js
#!/usr/bin/env node
'use strict';

import { createInterface } from 'node:readline';
import { load, save, configPath } from '../src/config.js';
import { enhance } from '../src/gemini.js';

const args = process.argv.slice(2);

async function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

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
      } else if (ch === '') {
        if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (ch === '') {
        process.exit(0);
      } else {
        input += ch;
        process.stdout.write('*');
      }
    });
  });
}

async function pickFromList(rl, question, options, defaultIdx = 0) {
  console.log(question);
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o}${i === defaultIdx ? ' (default)' : ''}`));
  const answer = await prompt(rl, `Choice [${defaultIdx + 1}]: `);
  const n = parseInt(answer, 10);
  if (!answer.trim()) return options[defaultIdx];
  if (n >= 1 && n <= options.length) return options[n - 1];
  console.log('Invalid choice, using default.');
  return options[defaultIdx];
}

async function runInit() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  Welcome to ccx setup\n');

  const apiKey = await promptHidden('  Gemini API key: ');
  if (!apiKey.trim()) { console.log('No key entered. Aborting.'); rl.close(); process.exit(1); }

  process.stdout.write('  Testing key... ');
  try {
    await enhance('hello', { geminiApiKey: apiKey.trim(), geminiModel: 'gemini-2.5-flash', timeoutSeconds: 10 });
    console.log('\x1b[32m✓ Valid\x1b[0m');
  } catch (err) {
    console.log('\x1b[31m✗ Invalid key\x1b[0m —', err.message);
    rl.close(); process.exit(1);
  }

  const model = await pickFromList(rl, '\n  Model:', [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.5-pro',
  ], 0);

  const markerInput = await prompt(rl, '\n  Trigger marker [;;]: ');
  const marker = markerInput.trim() || ';;';

  const timeoutInput = await prompt(rl, '  Timeout seconds [8]: ');
  const timeoutSeconds = parseInt(timeoutInput.trim(), 10) || 8;

  save({ geminiApiKey: apiKey.trim(), geminiModel: model, marker, timeoutSeconds });

  console.log(`\n  Config saved to ${configPath()}`);
  console.log('  Run `ccx claude` to start.\n');
  rl.close();
}

async function runShow() {
  const cfg = load();
  const key = cfg.geminiApiKey
    ? cfg.geminiApiKey.slice(0, 6) + '****...'
    : '(not set)';
  console.log(`\nConfig: ${configPath()}\n`);
  console.log(`  geminiApiKey:   ${key}`);
  console.log(`  geminiModel:    ${cfg.geminiModel}`);
  console.log(`  marker:         ${cfg.marker}`);
  console.log(`  timeoutSeconds: ${cfg.timeoutSeconds}\n`);
}

async function runReset() {
  const { rmSync, existsSync } = await import('node:fs');
  const p = configPath();
  if (existsSync(p)) { rmSync(p); console.log('Config reset. Run `ccx init` to set up again.'); }
  else { console.log('No config file found — nothing to reset.'); }
}

if (args.includes('--show'))        await runShow();
else if (args.includes('--reset'))  await runReset();
else                                await runInit();
```

- [ ] **Step 2: Smoke test wizard**

```
node bin/ccx-init.js --show
```
Expected: prints current config with masked key.

```
node bin/ccx-init.js
```
Expected: prompts for key, validates it, asks model/marker/timeout, writes config.

- [ ] **Step 3: Commit**

```
git add bin/ccx-init.js
git commit -m "feat: add ccx-init wizard with key validation and model picker"
```

---

### Task 7: GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/test.yml`
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Create `.github/workflows/test.yml`**

```yaml
name: Test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    strategy:
      matrix:
        node: [18, 20, 22]
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm test
```

- [ ] **Step 2: Create `.github/workflows/publish.yml`**

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 3: Add NPM_TOKEN to GitHub**

In your GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
- Name: `NPM_TOKEN`
- Value: your npm token from `npm token create --type=publish`

- [ ] **Step 4: Commit**

```
git add .github/
git commit -m "ci: add test matrix and npm publish workflows"
```

---

### Task 8: Run full test suite + final checks

- [ ] **Step 1: Run all tests**

```
node --test test/**/*.test.js
```
Expected: all tests pass across config, gemini, input.

- [ ] **Step 2: End-to-end smoke test**

```
ccx powershell
```
- Type `hello;;` + Enter → spinner → rewritten line, no submit
- Press `Alt+M` mid-line → spinner → rewritten line
- Ctrl+C during enhancement → original restored
- `ccx init --show` → masked config printed

- [ ] **Step 3: Update README**

Replace install section with:
```md
## Install

npm install -g ccx-relay

## Setup

ccx init

## Usage

ccx claude
ccx claude --resume
```

- [ ] **Step 4: Bump version and tag**

```
npm version minor
git push && git push --tags
```
Expected: GitHub Actions runs tests then publishes to npm.

- [ ] **Step 5: Commit README**

```
git add README.md
git commit -m "docs: update README for production install and ccx init"
```
