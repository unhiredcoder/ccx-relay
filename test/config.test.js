import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { configPath, load, save } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper to set up isolated test environment
function setupTestEnv() {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-config-test-'));
  const originalEnv = { ...process.env };

  // Override environment variables for test isolation
  process.env.APPDATA = tmpdir;
  process.env.HOME = tmpdir;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.CCX_MARKER;
  delete process.env.CCX_TIMEOUT;

  return { tmpdir, originalEnv };
}

function restoreEnv(originalEnv) {
  process.env = originalEnv;
}

function cleanupTmpdir(tmpdir) {
  fs.rmSync(tmpdir, { recursive: true, force: true });
}

test('configPath() returns path ending in config.json and containing ccx', () => {
  const result = configPath();
  assert.ok(result.endsWith('config.json'), `Path should end with config.json, got: ${result}`);
  assert.ok(result.includes('ccx'), `Path should contain ccx, got: ${result}`);
});

test('load() returns defaults when no config file exists', () => {
  const env = setupTestEnv();
  try {
    const config = load();
    assert.deepStrictEqual(config, {
      geminiApiKey: null,
      geminiModel: 'gemini-2.5-flash',
      marker: ';;',
      timeoutSeconds: 8,
    });
  } finally {
    restoreEnv(env.originalEnv);
    cleanupTmpdir(env.tmpdir);
  }
});

test('load() reads values from config file', () => {
  const env = setupTestEnv();
  try {
    const configDir = path.join(env.tmpdir, 'ccx');
    fs.mkdirSync(configDir, { recursive: true });
    const configFile = path.join(configDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({
      geminiApiKey: 'test-key',
      geminiModel: 'gemini-custom',
      marker: '::',
      timeoutSeconds: '5',
    }));

    const config = load();
    assert.deepStrictEqual(config, {
      geminiApiKey: 'test-key',
      geminiModel: 'gemini-custom',
      marker: '::',
      timeoutSeconds: 5,
    });
  } finally {
    restoreEnv(env.originalEnv);
    cleanupTmpdir(env.tmpdir);
  }
});

test('env vars override config file values', () => {
  const env = setupTestEnv();
  try {
    const configDir = path.join(env.tmpdir, 'ccx');
    fs.mkdirSync(configDir, { recursive: true });
    const configFile = path.join(configDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({
      geminiApiKey: 'file-key',
      geminiModel: 'gemini-file',
      marker: '::',
      timeoutSeconds: 5,
    }));

    // Set environment variables
    process.env.GEMINI_API_KEY = 'env-key';
    process.env.GEMINI_MODEL = 'gemini-env';
    process.env.CCX_MARKER = '>>>';
    process.env.CCX_TIMEOUT = '10';

    const config = load();
    assert.deepStrictEqual(config, {
      geminiApiKey: 'env-key',
      geminiModel: 'gemini-env',
      marker: '>>>',
      timeoutSeconds: 10,
    });
  } finally {
    restoreEnv(env.originalEnv);
    cleanupTmpdir(env.tmpdir);
  }
});

test('save() writes patch and load() reads it back', () => {
  const env = setupTestEnv();
  try {
    // First save
    save({ geminiApiKey: 'my-key', marker: '@@' });

    // Verify load reads it back
    const config = load();
    assert.strictEqual(config.geminiApiKey, 'my-key');
    assert.strictEqual(config.marker, '@@');
    assert.strictEqual(config.geminiModel, 'gemini-2.5-flash');
    assert.strictEqual(config.timeoutSeconds, 8);

    // Second save patches existing
    save({ timeoutSeconds: 15 });

    const config2 = load();
    assert.strictEqual(config2.geminiApiKey, 'my-key');
    assert.strictEqual(config2.marker, '@@');
    assert.strictEqual(config2.geminiModel, 'gemini-2.5-flash');
    assert.strictEqual(config2.timeoutSeconds, 15);
  } finally {
    restoreEnv(env.originalEnv);
    cleanupTmpdir(env.tmpdir);
  }
});
