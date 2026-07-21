#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { rmSync, existsSync } from 'node:fs';
import { load, save, configPath } from '../src/config.js';
import { enhance, listModels, RateLimitError } from '../src/gemini.js';

const args = process.argv.slice(2);

// ── ANSI ──────────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',  dim:   '\x1b[2m',   bold:  '\x1b[1m',
  green: '\x1b[32m', red:   '\x1b[31m',  cyan:  '\x1b[36m', gray:  '\x1b[90m',
};
const s = {
  active: `${c.cyan}◆${c.reset}`,  done: `${c.gray}◇${c.reset}`,
  pipe:   `${c.gray}│${c.reset}`,   end:  `${c.gray}└${c.reset}`,
  ok:     `${c.green}✓${c.reset}`,  err:  `${c.red}✗${c.reset}`,
};

// ── Banner ────────────────────────────────────────────────────────────────────
function banner() {
  const title = '  ccx-relay  ·  prompt relay setup  ';
  const bar = '─'.repeat(title.length);
  console.log(`\n   ╭${bar}╮`);
  console.log(`   │${title}│`);
  console.log(`   ╰${bar}╯\n`);
}

// ── Primitives ────────────────────────────────────────────────────────────────
const pipe = () => console.log(s.pipe);
const info = (m) => console.log(`${s.pipe}  ${c.dim}${m}${c.reset}`);
const good = (m) => console.log(`${s.pipe}  ${s.ok}  ${m}`);
const bad  = (m) => console.log(`${s.pipe}  ${s.err}  ${c.red}${m}${c.reset}`);
const head = (label) => console.log(`${s.active}  ${c.bold}${label}${c.reset}`);

// ── Hidden input (●●● masking) ────────────────────────────────────────────────
async function promptHidden() {
  return new Promise(resolve => {
    process.stdout.write(`${s.pipe}  `);
    const rl = createInterface({ input: process.stdin, output: null, terminal: false });
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    let input = '';
    process.stdin.on('data', function onData(buf) {
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b === 0x0d || b === 0x0a) {
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.stdin.removeListener('data', onData);
          rl.close();
          resolve(input);
          return;
        } else if (b === 0x7f || b === 0x08) {
          if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (b === 0x03) {
          process.exit(0);
        } else if (b >= 0x20) {
          input += String.fromCharCode(b);
          process.stdout.write(`${c.dim}●${c.reset}`);
        }
      }
    });
  });
}

// ── Plain prompt ──────────────────────────────────────────────────────────────
async function ask(question, defaultVal = '') {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

// ── Spinner ───────────────────────────────────────────────────────────────────
const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
function spin(msg) {
  let f = 0;
  process.stdout.write(`${s.pipe}  `);
  const id = setInterval(() => {
    process.stdout.write(`\r${s.pipe}  ${c.dim}${FRAMES[f++ % FRAMES.length]}${c.reset}  ${msg}`);
  }, 80);
  return () => { clearInterval(id); process.stdout.write('\r\x1b[2K'); };
}

// ── Model metadata ────────────────────────────────────────────────────────────
const MODEL_META = {
  'llama-3.1-8b-instant':    { note: 'fastest',  quota: '14,400/day' },
  'llama-3.3-70b-versatile': { note: 'smarter',  quota: ' 1,000/day' },
  'gemma2-9b-it':            { note: 'balanced', quota: '14,400/day' },
  'llama3-8b-8192':          { note: 'classic',  quota: '14,400/day' },
  'llama-3.1-70b-versatile': { note: 'large',    quota: ' 1,000/day' },
  'gemini-2.5-flash':        { note: 'latest',   quota: 'limited'    },
  'gemini-2.0-flash-lite':   { note: 'fast',     quota: 'limited'    },
  'gemini-1.5-flash':        { note: 'stable',   quota: '1,500/day'  },
  'gemini-2.5-pro':          { note: 'powerful', quota: 'limited'    },
};

function modelRow(m, i, isDefault) {
  const meta = MODEL_META[m] || { note: '', quota: '' };
  const num  = `${i + 1}`.padStart(2);
  const name = m.padEnd(34);
  const note = meta.note.padEnd(10);
  const tag  = isDefault ? `  ${c.dim}← default${c.reset}` : '';
  return `${s.pipe}  ${c.dim}${num}${c.reset}  ${name}${c.dim}${note}  ${meta.quota}${c.reset}${tag}`;
}

// ── Wizard ────────────────────────────────────────────────────────────────────
async function runWizard() {
  banner();

  // ── Key ──
  head('API key');
  info('Groq (gsk_...)   → 14,400 req/day free  ← recommended');
  info('Gemini (AIza...) → limited free tier');
  pipe();

  const key = await promptHidden();
  if (!key) { bad('No key entered.'); process.exit(1); }
  const provider = key.startsWith('gsk_') ? 'Groq' : 'Gemini';
  pipe();

  // ── Validate ──
  head(`Validating ${provider} key`);
  const stopValidate = spin('Connecting...');
  const testModel = key.startsWith('gsk_') ? 'llama-3.1-8b-instant' : 'gemini-2.5-flash';
  try {
    await enhance('hello', { geminiApiKey: key, geminiModel: testModel, timeoutSeconds: 10 });
    stopValidate();
    good(`${provider} key valid`);
  } catch (err) {
    if (err instanceof RateLimitError) {
      stopValidate();
      good(`${provider} key valid  ${c.dim}(quota hit — authenticated)${c.reset}`);
    } else {
      stopValidate();
      bad(`Invalid key — ${err.message}`);
      console.log(`${s.end}  Run ${c.bold}ccx-init${c.reset} again with a valid key.\n`);
      process.exit(1);
    }
  }
  pipe();

  // ── Models ──
  head('Model');
  const stopFetch = spin('Fetching available models...');
  let models;
  try {
    const all = await listModels(key);
    models = all.slice(0, 8);
    if (!models.length) throw new Error('empty');
    stopFetch();
  } catch (_) {
    stopFetch();
    models = key.startsWith('gsk_')
      ? ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'gemma2-9b-it', 'llama3-8b-8192']
      : ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-2.5-pro'];
  }

  models.forEach((m, i) => console.log(modelRow(m, i, i === 0)));
  pipe();

  const modelInput = await ask(`${s.pipe}  Choice ${c.dim}[1]${c.reset}: `, '1');
  const mIdx = parseInt(modelInput, 10);
  const modelIndex = (!mIdx || mIdx < 1 || mIdx > models.length) ? 0 : mIdx - 1;
  const model = models[modelIndex];
  good(model);
  pipe();

  // ── Marker ──
  head('Trigger marker');
  info('Type at end of your prompt + Enter to enhance  (Alt+M also works anywhere)');
  const marker = await ask(`${s.pipe}  Default ${c.dim}[;;]${c.reset}: `, ';;');
  pipe();

  // ── Timeout ──
  head('Request timeout');
  info('Seconds before giving up and restoring original text');
  const timeoutInput = await ask(`${s.pipe}  Default ${c.dim}[8]${c.reset}: `, '8');
  const timeoutSeconds = parseInt(timeoutInput, 10) || 8;
  pipe();

  // ── Save ──
  save({ geminiApiKey: key, geminiModel: model, marker, timeoutSeconds });
  const path = configPath();
  console.log(`${s.end}  ${s.ok}  ${c.bold}${c.green}Config saved${c.reset}`);
  console.log(`      ${c.dim}${path}${c.reset}`);
  console.log(`\n      Run  ${c.bold}ccx claude${c.reset}  to start\n`);
}

// ── Sub-commands ──────────────────────────────────────────────────────────────
function maskKey(key) {
  if (!key) return '(not set)';
  return key.slice(0, 6) + '****...';
}

function showConfig() {
  const cfg = load();
  const path = configPath();
  const provider = cfg.geminiApiKey?.startsWith('gsk_') ? 'Groq' : 'Gemini';
  banner();
  console.log(`${s.pipe}  ${c.dim}Path${c.reset}      ${path}`);
  console.log(`${s.pipe}  ${c.dim}Provider${c.reset}  ${provider}`);
  console.log(`${s.pipe}  ${c.dim}Key${c.reset}       ${maskKey(cfg.geminiApiKey)}`);
  console.log(`${s.pipe}  ${c.dim}Model${c.reset}     ${cfg.geminiModel}`);
  console.log(`${s.pipe}  ${c.dim}Marker${c.reset}    ${cfg.marker}`);
  console.log(`${s.end}  ${c.dim}Timeout${c.reset}   ${cfg.timeoutSeconds}s\n`);
}

function resetConfig() {
  const path = configPath();
  if (existsSync(path)) {
    rmSync(path);
    console.log(`${s.ok}  Config reset. Run ${c.bold}ccx-init${c.reset} to set up again.`);
  } else {
    console.log('No config file found — nothing to reset.');
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────
if (args.length === 0) {
  runWizard().catch(err => { console.error(err.message); process.exit(1); });
} else if (args[0] === '--show') {
  showConfig();
} else if (args[0] === '--reset') {
  resetConfig();
} else {
  console.error(`Unknown command: ${args[0]}`);
  process.exit(1);
}
