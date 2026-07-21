#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { rmSync, existsSync } from 'node:fs';
import { load, save, configPath } from '../src/config.js';
import { enhance, listModels, RateLimitError } from '../src/gemini.js';

const args = process.argv.slice(2);

async function promptHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    const rl = createInterface({ input: process.stdin, output: null, terminal: false });
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    let input = '';
    process.stdin.on('data', function onData(buf) {
      for (let i = 0; i < buf.length; i++) {
        const byte = buf[i];
        if (byte === 0x0d || byte === 0x0a) {
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.stdin.removeListener('data', onData);
          rl.close();
          resolve(input);
          return;
        } else if (byte === 0x7f || byte === 0x08) {
          if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (byte === 0x03) {
          process.exit(0);
        } else if (byte >= 0x20) {
          input += String.fromCharCode(byte);
          process.stdout.write('*');
        }
      }
    });
  });
}

async function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function maskKey(key) {
  if (!key) return '(not set)';
  if (key.length <= 6) return key + '****...';
  return key.slice(0, 6) + '****...';
}

function showConfig() {
  const config = load();
  const path = configPath();
  console.log(`Config: ${path}\n`);
  console.log(`  geminiApiKey:   ${maskKey(config.geminiApiKey)}`);
  console.log(`  geminiModel:    ${config.geminiModel}`);
  console.log(`  marker:         ${config.marker}`);
  console.log(`  timeoutSeconds: ${config.timeoutSeconds}`);
}

function resetConfig() {
  const path = configPath();
  if (existsSync(path)) {
    rmSync(path);
    console.log('Config reset. Run `ccx-init` to set up again.');
  } else {
    console.log('No config file found — nothing to reset.');
  }
}

async function runWizard() {
  console.log('\n  Welcome to ccx setup\n');

  const key = await promptHidden('  API key: ');
  if (!key) { console.log('No key entered. Aborting.'); process.exit(1); }

  const testModel = key.startsWith('gsk_') ? 'llama-3.1-8b-instant' : 'gemini-2.5-flash';
  process.stdout.write('  Testing key... ');
  try {
    await enhance('hello', { geminiApiKey: key, geminiModel: testModel, timeoutSeconds: 10 });
    console.log('\x1b[32m✓ Valid\x1b[0m');
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.log('\x1b[32m✓ Valid\x1b[0m \x1b[2m(quota exceeded — key authenticated)\x1b[0m');
    } else {
      console.log(`\x1b[31m✗ Invalid key\x1b[0m — ${err.message}`);
      process.exit(1);
    }
  }

  // Fetch available models, fall back to hardcoded list
  let models;
  process.stdout.write('  Fetching available models... ');
  try {
    const all = await listModels(key);
    models = all.filter(m => m.includes('gemini')).slice(0, 10);
    if (models.length === 0) throw new Error('empty');
    console.log(`\x1b[32m✓\x1b[0m ${models.length} found`);
  } catch (_) {
    models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.5-pro'];
    console.log('(using defaults)');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('');
  console.log('  Model:');
  models.forEach((m, i) => {
    console.log(`  ${i + 1}) ${m}${i === 0 ? ' (default)' : ''}`);
  });

  const modelChoice = await prompt(rl, '  Choice [1]: ');
  const idx = parseInt(modelChoice.trim(), 10);
  const modelIndex = (!idx || idx < 1 || idx > models.length) ? 0 : idx - 1;
  const model = models[modelIndex];

  const markerAnswer = await prompt(rl, '  Trigger marker [;;]: ');
  const marker = markerAnswer.trim() || ';;';

  const timeoutAnswer = await prompt(rl, '  Timeout seconds [8]: ');
  const timeoutSeconds = timeoutAnswer.trim() === '' ? 8 : (parseInt(timeoutAnswer, 10) || 8);

  rl.close();

  save({ geminiApiKey: key, geminiModel: model, marker, timeoutSeconds });
  console.log(`\n  Config saved to ${configPath()}`);
  console.log('  Run `ccx claude` to start.\n');
}

if (args.length === 0) {
  runWizard();
} else if (args[0] === '--show') {
  showConfig();
} else if (args[0] === '--reset') {
  resetConfig();
} else {
  console.error(`Unknown command: ${args[0]}`);
  process.exit(1);
}
