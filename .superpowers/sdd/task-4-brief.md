# Task 4: src/input.js — pure stdin parser with Alt+M and ;; triggers

## Context
ccx-relay is a Node.js PTY wrapper. This module is the pure stdin parser —
no Gemini calls, no terminal writes. It emits events via callbacks.

## Global Constraints
- Node.js >= 18, no new runtime dependencies
- ESM only (`export`, not `module.exports`)
- PURE PARSING ONLY — no fetch calls, no stderr writes, no process.exit
- Tests use node:test and node:assert only

## Requirements

### `src/input.js`

Export one function:

```js
export function createInputHandler({ marker, onEnhance, onSubmit, onPassthrough, onCtrlC })
```

Returns: `{ processChunk(chunk: Buffer): void, setBusy(b: boolean): void, reset(): void }`

**Internal state:**
- `lineBuffer`: string, accumulates printable chars
- `busy`: boolean, blocks enhance triggers when true

**`processChunk(chunk)` behavior:**

If `busy === true`: call `onPassthrough(chunk)` and return immediately.

Process chunk byte-by-byte:

1. **ESC byte (0x1b):** Try `parseWin32InputSeq(chunk, i)` first:
   - If it returns a sequence AND `seq.kd === 1`:
     - `seq.vk === 13` (Win32 Enter): if `lineBuffer.endsWith(marker) && lineBuffer.trim().length > marker.length` → call `onEnhance(lineBuffer.slice(0, -marker.length))` and return. Else call `onSubmit(lineBuffer)`, reset lineBuffer, call `onPassthrough(seq bytes)`.
     - `seq.vk === 8` (Win32 Backspace): pop last char from lineBuffer, call `onPassthrough(seq bytes)`.
     - `seq.vk === 77` with Alt bit set (`seq.cs & (0x0001 | 0x0002)`): if lineBuffer non-empty → call `onEnhance(lineBuffer)` and return. Else call `onPassthrough(seq bytes)`.
   - Call `onPassthrough(chunk.slice(i, i + seq.consumed))`, advance `i += seq.consumed`.
   - If no win32 sequence: check if next byte is `0x6d` (Alt+M standard):
     - If `i + 1 < chunk.length && chunk[i+1] === 0x6d`:
       - lineBuffer non-empty → call `onEnhance(lineBuffer)` and return
       - else call `onPassthrough(chunk.slice(i, i+2))`, advance i += 2
     - Else: call `onPassthrough(chunk.slice(i))` and return (forward rest untouched)

2. **Enter byte (0x0d):** if `lineBuffer.endsWith(marker) && lineBuffer.trim().length > marker.length` → call `onEnhance(lineBuffer.slice(0, -marker.length))` and return. Else call `onSubmit(lineBuffer)`, call `onPassthrough(Buffer.from([byte]))`, reset lineBuffer.

3. **Ctrl+C (0x03):** call `onCtrlC()`, call `onPassthrough(Buffer.from([byte]))`, reset lineBuffer.

4. **Backspace (0x7f or 0x08):** pop last char from lineBuffer, call `onPassthrough(Buffer.from([byte]))`.

5. **Printable char:** append `String.fromCharCode(byte)` to lineBuffer, call `onPassthrough(Buffer.from([byte]))`.

**`parseWin32InputSeq(chunk, i)` (internal helper, not exported):**
```js
// Parses ESC [ {digits/semicolons} _ sequences (win32-input-mode)
// Returns { consumed, vk, sc, uc, kd, cs, rc } or null
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
```

**`setBusy(b)`:** sets internal busy flag.
**`reset()`:** resets lineBuffer to '' and busy to false.

### `test/input.test.js`

11 tests — write them exactly:

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
  h.processChunk(Buffer.from('\x1b[13;0;13;1;0;1_'));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hello'));
});

test('win32-input-mode Alt+M (VK=77 kd=1 cs=2) triggers enhance', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('fix bug'));
  h.processChunk(Buffer.from('\x1b[77;50;109;1;2;1_'));
  assert.ok(events.find(e => e.type === 'enhance' && e.line === 'fix bug'));
});
```

## TDD Steps
1. Write test file
2. Run `node --test test/input.test.js` — expect failure
3. Implement src/input.js
4. Run tests — all 11 must pass
5. Commit

## Commit message
`feat: add src/input.js with Alt+M and ;; trigger parsing`

## Report
Write to: `.superpowers/sdd/task-4-report.md`

Return only: Status, commit hash, "11/11 passing", concerns.
