#!/usr/bin/env node
'use strict';

import { load } from '../src/config.js';
import { enhance, RateLimitError, AuthError, ModelError, TimeoutError, NetworkError } from '../src/gemini.js';
import { start as spinnerStart, stop as spinnerStop } from '../src/ui.js';
import { openPopup } from '../src/popup.js';

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
  if (shell === 'bash')       process.stdout.write('# eval "$(ccx completion bash)"\n');
  else if (shell === 'zsh')   process.stdout.write('# eval "$(ccx completion zsh)"\n');
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
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\r/g, '');
}

ptyProcess.onData(data => {
  process.stdout.write(data);
  for (const ln of stripAnsi(data).split('\n')) {
    if (ln.trim()) {
      contextLines.push(ln.trim());
      if (contextLines.length > CONTEXT_MAX) contextLines.shift();
    }
  }
});

process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns, process.stdout.rows);
});

// ── Alt+M detection ────────────────────────────────────────────────────────────
// Returns true if this chunk is an Alt+M keypress (standard or win32-input-mode).
function isAltM(chunk) {
  // Standard: ESC m (0x1b 0x6d)
  if (chunk.length >= 2 && chunk[0] === 0x1b && chunk[1] === 0x6d) return true;
  // Win32 input mode: ESC [ vk;sc;uc;kd;cs;rc _  where vk=77 (M), kd=1 (keydown), Alt bit in cs
  if (chunk.length >= 2 && chunk[0] === 0x1b && chunk[1] === 0x5b) {
    const m = chunk.toString('ascii').match(/^\x1b\[(\d+);\d+;\d+;(\d+);(\d+);\d+_/);
    if (m) {
      const vk = +m[1], kd = +m[2], cs = +m[3];
      if (vk === 77 && kd === 1 && (cs & 0x0003) && !(cs & 0x000c)) return true;
    }
  }
  return false;
}

// ── Enhancement flow ───────────────────────────────────────────────────────────
let busy = false;

async function handleEnhance() {
  busy = true;

  const text = await openPopup();
  if (!text) { busy = false; return; }

  spinnerStart();
  let improved;
  try {
    const context = contextLines.length > 0 ? contextLines.join('\n') : null;
    improved = await enhance(text, config, context);
  } catch (err) {
    let msg = 'Enhancement failed';
    if (err instanceof RateLimitError) msg = 'Quota exceeded';
    else if (err instanceof AuthError)    msg = 'Invalid key — run ccx-init';
    else if (err instanceof ModelError)   msg = 'Model not found — run ccx-init';
    else if (err instanceof TimeoutError) msg = `Timed out after ${config.timeoutSeconds}s`;
    else if (err instanceof NetworkError) msg = 'No connection';
    await spinnerStop('error', msg);
    busy = false;
    return;
  }

  await spinnerStop('success', 'Enhanced');

  // Clear any existing text in Claude Code's input line, then inject enhanced text
  ptyProcess.write('\x15'); // Ctrl+U = kill line (clears Claude Code's current input)
  // Small pause so Claude Code processes the Ctrl+U before we type the new text
  await new Promise(r => setTimeout(r, 30));
  ptyProcess.write(improved);
  busy = false;
}

// ── Stdin routing ──────────────────────────────────────────────────────────────
process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('data', chunk => {
  if (busy) return; // swallow input during enhancement
  if (isAltM(chunk)) { handleEnhance(); return; }
  ptyProcess.write(chunk);
});

// ── Cleanup ────────────────────────────────────────────────────────────────────
function cleanupAndExit(code) {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch (_) {}
  process.exit(code == null ? 0 : code);
}

ptyProcess.onExit(({ exitCode }) => cleanupAndExit(exitCode));
process.on('SIGINT', () => {});
