import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createInputHandler } from '../src/input.js';

function makeHandler(overrides = {}) {
  const events = [];
  const h = createInputHandler({
    marker: ';;',
    onEnhance:    (line, cursor) => events.push({ type: 'enhance', line, cursor }),
    onSubmit:     line           => events.push({ type: 'submit',  line }),
    onPassthrough:chunk          => events.push({ type: 'pass',    chunk }),
    onCtrlC:      ()             => events.push({ type: 'ctrlc' }),
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

test(';; + Enter triggers enhance with full lineBuffer (including marker)', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('fix bug;;'));
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'enhance' && e.line === 'fix bug;;'));
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

// Cursor tracking tests

test('left arrow moves cursor: insert at cursor inserts mid-buffer', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('helo'));           // buffer='helo', cursor=4
  h.processChunk(Buffer.from([0x1b, 0x5b, 0x44])); // ESC[D = left, cursor=3
  h.processChunk(Buffer.from('l'));              // insert at 3 → 'hello', cursor=4
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hello'));
});

test('Home key moves cursor to start', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('ello'));           // buffer='ello', cursor=4
  h.processChunk(Buffer.from([0x1b, 0x5b, 0x48])); // ESC[H = Home, cursor=0
  h.processChunk(Buffer.from('h'));              // insert at 0 → 'hello'
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hello'));
});

test('End key moves cursor to end', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('hello'));
  h.processChunk(Buffer.from([0x1b, 0x5b, 0x48])); // Home → cursor=0
  h.processChunk(Buffer.from([0x1b, 0x5b, 0x46])); // ESC[F = End → cursor=5
  h.processChunk(Buffer.from(' world'));
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hello world'));
});

test('backspace at cursor deletes char before cursor', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('helllo'));          // buffer='helllo', cursor=6
  h.processChunk(Buffer.from([0x1b, 0x5b, 0x44])); // left, cursor=5
  h.processChunk(Buffer.from([0x1b, 0x5b, 0x44])); // left, cursor=4
  h.processChunk(Buffer.from([0x7f]));            // backspace at 4 → 'hello', cursor=3
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hello'));
});

test('setLine syncs internal buffer and cursor', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('rough text'));
  h.setLine('improved text');
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'improved text'));
});

test('win32 left arrow tracks cursor: insert mid-buffer', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('helo'));
  // Win32 Left: VK=37, SC=0, UC=0, kd=1, cs=0, rc=1
  h.processChunk(Buffer.from('\x1b[37;0;0;1;0;1_'));
  h.processChunk(Buffer.from('l'));
  h.processChunk(Buffer.from([0x0d]));
  assert.ok(events.find(e => e.type === 'submit' && e.line === 'hello'));
});

test('enhance passes cursor position', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('fix bug'));         // cursor=7
  h.processChunk(Buffer.from([0x1b, 0x6d]));      // Alt+M
  const ev = events.find(e => e.type === 'enhance');
  assert.ok(ev);
  assert.equal(ev.cursor, 7);
});

test('bracketed paste: CRLF lines accumulate as newlines, ;; triggers enhance', () => {
  const { h, events } = makeHandler();
  // ESC[200~ starts paste, ESC[201~ ends paste
  const pasteStart = Buffer.from('\x1b[200~');
  const pasteEnd   = Buffer.from('\x1b[201~');
  const content    = Buffer.from('line one\r\nline two\r\nfix this;;');
  h.processChunk(pasteStart);
  h.processChunk(content);
  h.processChunk(pasteEnd);
  // No enhance yet — paste end doesn't trigger
  assert.equal(events.filter(e => e.type === 'enhance').length, 0);
  // Plain Enter triggers enhance on full multi-line buffer
  h.processChunk(Buffer.from([0x0d]));
  const ev = events.find(e => e.type === 'enhance');
  assert.ok(ev, 'should trigger enhance');
  assert.equal(ev.line, 'line one\nline two\nfix this;;');
});

test('win32 Shift+Enter appends newline and accumulates multi-line buffer', () => {
  const { h, events } = makeHandler();
  h.processChunk(Buffer.from('line one'));
  // Win32 Shift+Enter: VK=13, SC=28, UC=13, kd=1, cs=16 (0x0010=SHIFT), rc=1
  h.processChunk(Buffer.from('\x1b[13;28;13;1;16;1_'));
  assert.equal(events.filter(e => e.type === 'submit').length, 0);
  assert.equal(events.filter(e => e.type === 'enhance').length, 0);
  // Now type second line with marker and plain Enter
  h.processChunk(Buffer.from('line two;;'));
  h.processChunk(Buffer.from('\x1b[13;0;13;1;0;1_'));
  const ev = events.find(e => e.type === 'enhance');
  assert.ok(ev, 'should trigger enhance');
  assert.equal(ev.line, 'line one\nline two;;');
});
