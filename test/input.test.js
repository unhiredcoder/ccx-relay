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
