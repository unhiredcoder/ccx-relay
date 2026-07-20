#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { rmSync, existsSync } from 'node:fs';
import { load, save, configPath } from '../src/config.js';
import { enhance } from '../src/gemini.js';

const args = process.argv.slice(2);

// Hidden input helper for API key
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

// Regular prompt helper
async function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// Mask API key: show first 6 chars + ****...
function maskKey(key) {
  if (!key) return '(not set)';
  if (key.length <= 6) return key + '****...';
  return key.slice(0, 6) + '****...';
}

// Show current config
function showConfig() {
  const config = load();
  const path = configPath();

  console.log(`Config: ${path}\n`);
  console.log(`  geminiApiKey:   ${maskKey(config.geminiApiKey)}`);
  console.log(`  geminiModel:    ${config.geminiModel}`);
  console.log(`  marker:         ${config.marker}`);
  console.log(`  timeoutSeconds: ${config.timeoutSeconds}`);
}

// Reset config
function resetConfig() {
  const path = configPath();

  if (existsSync(path)) {
    rmSync(path);
    console.log('Config reset. Run `ccx init` to set up again.');
  } else {
    console.log('No config file found — nothing to reset.');
  }
}

// Interactive wizard
async function runWizard() {
  console.log('\n  Welcome to ccx setup\n');

  // Step 1: Prompt for API key
  const key = await promptHidden('  API key: ');
  if (!key) {
    console.log('No key entered. Aborting.');
    process.exit(1);
  }

  // Step 2: Test the key
  process.stdout.write('  Testing key... ');
  try {
    await enhance('hello', { geminiApiKey: key, geminiModel: 'gemini-2.5-flash', timeoutSeconds: 10 });
    console.log('\x1b[32m✓ Valid\x1b[0m');
  } catch (err) {
    console.log(`\x1b[31m✗ Invalid key\x1b[0m — ${err.message}`);
    process.exit(1);
  }

  // Step 3: Model picker
  const models = [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.5-pro'
  ];

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('');
  console.log('  Model:');
  console.log('  1) gemini-2.5-flash (default)');
  console.log('  2) gemini-1.5-flash');
  console.log('  3) gemini-2.5-pro');

  const modelChoice = await prompt(rl, '  Choice [1]: ');
  const modelIndex = modelChoice.trim() === '' || modelChoice.trim() === '1' ? 0 :
                    modelChoice.trim() === '2' ? 1 :
                    modelChoice.trim() === '3' ? 2 : 0;
  const model = models[modelIndex];

  // Step 4: Trigger marker
  const markerAnswer = await prompt(rl, '  Trigger marker [;;]: ');
  const marker = markerAnswer.trim() || ';;';

  // Step 5: Timeout seconds
  const timeoutAnswer = await prompt(rl, '  Timeout seconds [8]: ');
  const timeoutSeconds = timeoutAnswer.trim() === '' ? 8 : (parseInt(timeoutAnswer, 10) || 8);

  rl.close();

  // Step 6: Save config
  save({ geminiApiKey: key, geminiModel: model, marker, timeoutSeconds });

  // Step 7: Success message
  console.log(`\n  Config saved to ${configPath()}`);
  console.log('  Run `ccx claude` to start.\n');
}

// Main dispatch
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
