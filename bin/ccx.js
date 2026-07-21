#!/usr/bin/env node
'use strict';

import { load } from '../src/config.js';
import { enhance, RateLimitError, AuthError, ModelError, TimeoutError, NetworkError } from '../src/gemini.js';
import { start as spinnerStart, stop as spinnerStop, clear as spinnerClear } from '../src/ui.js';
import { createInputHandler } from '../src/input.js';

const argv = process.argv.slice(2);

// ── Shell tab-completion ───────────────────────────────────────────────────────
if (argv[0] === 'completion') {
  const shell = argv[1] || 'bash';
  const scripts = {
    bash: [
      '_ccx_completion() {',
      '    local cur="${COMP_WORDS[COMP_CWORD]}"',
      '    COMPREPLY=($(compgen -W "claude bash zsh powershell cmd completion" -- "$cur"))',
      '}',
      'complete -F _ccx_completion ccx',
    ].join('\n'),
    zsh: [
      '#compdef ccx',
      '_ccx() {',
      '    local -a cmds',
      '    cmds=(claude bash zsh powershell cmd completion)',
      '    _describe \'command\' cmds',
      '}',
      '_ccx',
    ].join('\n'),
    powershell: [
      'Register-ArgumentCompleter -Native -CommandName ccx -ScriptBlock {',
      '    param($wordToComplete, $commandAst, $cursorPosition)',
      '    @(\'claude\',\'bash\',\'zsh\',\'powershell\',\'cmd\',\'completion\') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
      '        [System.Management.Automation.CompletionResult]::new($_, $_, \'ParameterValue\', $_)',
      '    }',
      '}',
    ].join('\n'),
  };
  if (!scripts[shell]) {
    process.stderr.write(`Unknown shell: ${shell}. Use: bash, zsh, powershell\n`);
    process.exit(1);
  }
  process.stdout.write(scripts[shell] + '\n');
  if (shell === 'bash')            process.stdout.write('# eval "$(ccx completion bash)"\n');
  else if (shell === 'zsh')        process.stdout.write('# eval "$(ccx completion zsh)"\n');
  else if (shell === 'powershell') process.stdout.write('# Invoke-Expression (ccx completion powershell)\n');
  process.exit(0);
}

// ── Load node-pty ──────────────────────────────────────────────────────────────
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
  process.stderr.write('[ccx] No API key found. Run `ccx-init` to set up.\n');
  process.exit(1);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write('[ccx] Must be run in an interactive terminal.\n');
  process.exit(1);
}

// ── Spawn PTY ──────────────────────────────────────────────────────────────────
const targetCmd  = argv[0] || 'claude';
const targetArgs = argv.slice(1);
const isWindows  = process.platform === 'win32';
const shellFile  = isWindows ? (process.env.COMSPEC || 'cmd.exe') : targetCmd;
const shellArgs  = isWindows ? ['/d', '/s', '/c', [targetCmd, ...targetArgs].join(' ')] : targetArgs;

const ptyProcess = pty.spawn(shellFile, shellArgs, {
  name: 'xterm-color',
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows   || 24,
  cwd:  process.cwd(),
  env:  process.env,
});

// ── Context ring buffer ────────────────────────────────────────────────────────
const CONTEXT_MAX = 20;
const contextLines = [];

function stripAnsi(s) {
  return s
    .replace(/\x1b\[[\d;?]*[A-Za-z]/g, '')  // CSI (including ?-prefixed private modes)
    .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC
    .replace(/\x1b[()#;?][A-Za-z]/g, '')      // other 2-byte ESC sequences
    .replace(/\r/g, '');
}

// Prefixes that indicate Claude Code UI output, not user content
const UI_PREFIXES = ['>', '◆', '◇', '│', '└', '✓', '✗', '⚠', '?', '!', '·', '▸', '▶', '↓', '↑'];

function isUiLine(t) {
  if (UI_PREFIXES.some(p => t.startsWith(p))) return true;
  // Claude Code spinner / status lines
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(t)) return true;
  // Lines that are mostly punctuation/symbols (borders, separators)
  if (/^[-─═╌┄]{3,}$/.test(t)) return true;
  return false;
}

ptyProcess.onData(data => {
  process.stdout.write(data);
  for (const ln of stripAnsi(data).split('\n')) {
    const t = ln.trim();
    if (t.length > 12 && !isUiLine(t)) {
      contextLines.push(t);
      if (contextLines.length > CONTEXT_MAX) contextLines.shift();
    }
  }
});

process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns, process.stdout.rows);
});

// ── Erase current input ───────────────────────────────────────────────────────
// Pure backspace approach — avoids Ctrl+U (\x15) which toggles Claude Code's
// manual mode, and Ctrl+D (\x04) which sends EOF on empty lines.
// For multi-line (Shift+Enter blocks): ANSI line-clear sequence per line.
function eraseInput(line, cursor) {
  const parts = line.split('\n');
  if (parts.length > 1) {
    // Move to end of last line first, then clear upward
    const lastLineLen = parts[parts.length - 1].length;
    const cursorOnLastLine = cursor - (line.length - lastLineLen);
    const afterOnLast = lastLineLen - Math.max(0, cursorOnLastLine);
    if (afterOnLast > 0) ptyProcess.write(`\x1b[${afterOnLast}C`);
    ptyProcess.write('\x1b[2K');
    for (let i = 1; i < parts.length; i++) ptyProcess.write('\x1b[1A\x1b[2K');
    ptyProcess.write('\x1b[G');
  } else {
    const after = line.length - cursor;
    if (after > 0) ptyProcess.write(`\x1b[${after}C`);
    ptyProcess.write(Buffer.alloc(line.length, 0x7f));
  }
}

// ── Input handler ──────────────────────────────────────────────────────────────
process.stdin.setRawMode(true);
process.stdin.resume();

const handler = createInputHandler({
  marker: config.marker,

  onEnhance: async (line, cursor) => {
    const toSend = line.endsWith(config.marker)
      ? line.slice(0, -config.marker.length)
      : line;

    handler.setBusy(true);
    spinnerStart();

    let improved;
    try {
      const context = contextLines.length > 0 ? contextLines.join('\n') : null;
      improved = await enhance(toSend, config, context);
    } catch (err) {
      let msg = 'Enhancement failed';
      if (err instanceof RateLimitError) msg = 'Quota exceeded';
      else if (err instanceof AuthError)    msg = 'Invalid key — run ccx-init';
      else if (err instanceof ModelError)   msg = 'Model not found — run ccx-init';
      else if (err instanceof TimeoutError) msg = `Timed out after ${config.timeoutSeconds}s — original restored`;
      else if (err instanceof NetworkError) msg = 'No connection — original restored';
      await spinnerStop('error', msg);
      eraseInput(line, cursor);
      ptyProcess.write(toSend);
      handler.setBusy(false);
      handler.setLine(toSend);
      return;
    }

    await spinnerStop('success', 'Enhanced');
    eraseInput(line, cursor);
    ptyProcess.write(improved);
    handler.setBusy(false);
    handler.setLine(improved);
  },

  onSubmit: () => {},

  onPassthrough: (chunk) => ptyProcess.write(chunk),

  onCtrlC: () => {
    spinnerClear();
    handler.reset();
  },
});

process.stdin.on('data', chunk => handler.processChunk(chunk));

// ── Cleanup ────────────────────────────────────────────────────────────────────
function cleanupAndExit(code) {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch (_) {}
  process.exit(code == null ? 0 : code);
}

ptyProcess.onExit(({ exitCode }) => cleanupAndExit(exitCode));
process.on('SIGINT', () => {});
