#!/usr/bin/env node
'use strict';

import { load } from '../src/config.js';
import { enhance, RateLimitError, AuthError, ModelError, TimeoutError, NetworkError } from '../src/gemini.js';
import { start as spinnerStart, stop as spinnerStop, clear as spinnerClear } from '../src/ui.js';
import { createInputHandler } from '../src/input.js';

const argv = process.argv.slice(2);

// Shell tab-completion scripts
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
  process.stdout.write('\n# To activate, add to your shell profile:\n');
  if (shell === 'bash') process.stdout.write('# eval "$(ccx completion bash)"\n');
  else if (shell === 'zsh') process.stdout.write('# eval "$(ccx completion zsh)"\n');
  else if (shell === 'powershell') process.stdout.write('# Invoke-Expression (ccx completion powershell)\n');
  process.exit(0);
}

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
  process.stderr.write('[ccx] ccx must be run in an interactive terminal.\n');
  process.exit(1);
}

const targetCmd  = argv[0] || 'claude';
const targetArgs = argv.slice(1);

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

// Ring buffer of recent PTY output lines for context-aware enhancement
const CONTEXT_MAX = 20;
const contextLines = [];

function stripAnsi(s) {
  return s
    .replace(/\x1b\[[\d;?]*[A-Za-z]/g, '')  // CSI including ?-prefixed private modes
    .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC
    .replace(/\x1b[()#;?][A-Za-z]/g, '')      // other 2-byte ESC sequences
    .replace(/\r/g, '');
}

const UI_PREFIXES = ['>', '◆', '◇', '│', '└', '✓', '✗', '⚠', '?', '!', '·', '▸', '▶', '↓', '↑'];
function isUiLine(t) {
  if (UI_PREFIXES.some(p => t.startsWith(p))) return true;
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(t)) return true;
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

process.stdin.setRawMode(true);
process.stdin.resume();

// Windows Console API CONTROL_KEY_STATE flag (see README's win32-input-mode notes;
// must match SHIFT_PRESSED in src/input.js).
const SHIFT_PRESSED = 0x0010;

function win32KeyEvent(vk, uc, keyDown, cs) {
  return `\x1b[${vk};0;${uc};${keyDown ? 1 : 0};${cs};1_`;
}

// Erase current input — handles both single-line and multi-line (Shift+Enter) buffers.
// Safe: pure backspace/ANSI-clear only — no Ctrl+U (manual mode toggle) or Ctrl+D (EOF risk).
function eraseInput(line, cursor) {
  // Backspace is the ONLY reliable way to clear Claude Code's readline buffer.
  // ANSI output sequences (ESC[2K, ESC[1A) go to Claude Code's stdin and are
  // ignored — they are terminal output sequences, not input commands.
  // Backspace works for both single-line and multi-line (readline merges lines).
  const after = line.length - cursor;
  if (after > 0) ptyProcess.write(`\x1b[${after}C`); // move cursor to end
  ptyProcess.write(Buffer.alloc(line.length, 0x7f));   // backspace all chars
}

// A raw '\r'/'\n' byte written into the pty reads to the wrapped app as a plain
// Enter keypress, which submits instead of inserting a line break — so a
// multi-line rewrite (or the original multi-line prompt, on restore-after-error)
// would get cut off mid-line and the remainder typed as a new, separately
// submitted line. Encode each embedded newline as a synthetic Shift+Enter
// win32-input-mode sequence instead, matching how a real Shift+Enter keypress
// already arrives (see the SHIFT_PRESSED branch in src/input.js).
function writeTextPreservingLines(text) {
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (line) ptyProcess.write(line);
    if (idx < lines.length - 1) {
      if (isWindows) {
        ptyProcess.write(win32KeyEvent(13, 13, true, SHIFT_PRESSED));
        ptyProcess.write(win32KeyEvent(13, 13, false, SHIFT_PRESSED));
      } else {
        ptyProcess.write('\n');
      }
    }
  });
}

const handler = createInputHandler({
  marker: config.marker,

  onEnhance: async (line, cursor, token) => {
    const toSend = line.endsWith(config.marker) ? line.slice(0, -config.marker.length) : line;
    handler.setBusy(true);
    spinnerStart();
    let improved;
    try {
      const context = contextLines.length > 0 ? contextLines.join('\n') : null;
      improved = await enhance(toSend, config, context);
    } catch (err) {
      // The user may have Ctrl+C'd out (or otherwise moved on) while this was
      // in flight — reset() bumps the epoch, so an old token here means
      // whatever we'd write back no longer belongs on the current line.
      if (!handler.isCurrent(token)) return;
      let msg = 'Enhancement failed';
      if (err instanceof RateLimitError) msg = 'Quota exceeded';
      else if (err instanceof AuthError)    msg = 'Invalid key — run ccx-init';
      else if (err instanceof ModelError)   msg = 'Model not found — run ccx-init';
      else if (err instanceof TimeoutError) msg = `Timed out after ${config.timeoutSeconds}s — original restored`;
      else if (err instanceof NetworkError) msg = 'No connection — original restored';
      await spinnerStop('error', msg);
      eraseInput(line, cursor);
      writeTextPreservingLines(toSend);
      handler.setLine(toSend);
      handler.setBusy(false);
      return;
    }
    if (!handler.isCurrent(token)) return;
    await spinnerStop('success', 'Enhanced');
    eraseInput(line, cursor);
    writeTextPreservingLines(improved);
    handler.setLine(improved);
    handler.setBusy(false);
    // Force Claude Code to redraw after writing — clears any visual artifacts
    // from long lines that wrapped across multiple terminal rows.
    setTimeout(() => ptyProcess.resize(process.stdout.columns, process.stdout.rows), 50);
  },

  onSubmit: (_line) => {},

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
