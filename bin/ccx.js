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
    // line may include trailing marker (;;) for the ;; trigger — strip it
    const toSend = line.endsWith(config.marker) ? line.slice(0, -config.marker.length) : line;
    handler.setBusy(true);
    spinnerStart();
    let improved;
    try {
      improved = await enhance(toSend, config);
    } catch (err) {
      let msg = 'Enhancement failed';
      if (err instanceof RateLimitError) msg = 'Quota exceeded';
      else if (err instanceof AuthError)  msg = 'Invalid key — run ccx init';
      else if (err instanceof ModelError) msg = 'Model not found — run ccx init';
      else if (err instanceof TimeoutError) msg = `Timed out after ${config.timeoutSeconds}s — original restored`;
      else if (err instanceof NetworkError) msg = 'No connection — original restored';
      await spinnerStop('error', msg);
      // Erase full echoed text (including marker if present), restore clean original
      ptyProcess.write(Buffer.alloc(line.length, 0x7f));
      ptyProcess.write(toSend);
      handler.setBusy(false);
      return;
    }
    await spinnerStop('success', 'Enhanced');
    // Erase full echoed text (including marker), write improved
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
