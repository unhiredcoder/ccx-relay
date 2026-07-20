import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const defaults = {
  geminiApiKey: null,
  geminiModel: 'gemini-2.5-flash',
  marker: ';;',
  timeoutSeconds: 8,
};

/**
 * Returns the path to the config.json file.
 * Windows: %APPDATA%/ccx/config.json
 * macOS/Linux: ~/.config/ccx/config.json
 */
export function configPath() {
  let configDir;

  if (process.platform === 'win32') {
    configDir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'ccx'
    );
  } else {
    configDir = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
      'ccx'
    );
  }

  return path.join(configDir, 'config.json');
}

/**
 * Loads user configuration from multiple sources with priority:
 * 1. Environment variables
 * 2. config.json file (if exists)
 * 3. Hardcoded defaults
 */
export function load() {
  const result = { ...defaults };

  // Layer 2: Read from config.json if it exists
  try {
    const configFilePath = configPath();
    if (fs.existsSync(configFilePath)) {
      const fileContent = fs.readFileSync(configFilePath, 'utf8');
      const fileConfig = JSON.parse(fileContent);
      Object.assign(result, fileConfig);
    }
  } catch (error) {
    // If file doesn't exist or fails to parse, use defaults silently
  }

  // Layer 1: Environment variables override everything
  if (process.env.GEMINI_API_KEY) {
    result.geminiApiKey = process.env.GEMINI_API_KEY;
  }
  if (process.env.GEMINI_MODEL) {
    result.geminiModel = process.env.GEMINI_MODEL;
  }
  if (process.env.CCX_MARKER) {
    result.marker = process.env.CCX_MARKER;
  }
  if (process.env.CCX_TIMEOUT) {
    result.timeoutSeconds = Number(process.env.CCX_TIMEOUT);
  }

  // Ensure timeoutSeconds is a number
  result.timeoutSeconds = Number(result.timeoutSeconds);

  return result;
}

/**
 * Saves a partial config patch to disk.
 * Creates directory if needed and merges with existing config.
 */
export function save(patch) {
  const configFilePath = configPath();
  const configDir = path.dirname(configFilePath);

  // Create directory if it doesn't exist
  fs.mkdirSync(configDir, { recursive: true });

  // Read existing config or use empty object if file doesn't exist
  let existing = {};
  try {
    if (fs.existsSync(configFilePath)) {
      const fileContent = fs.readFileSync(configFilePath, 'utf8');
      existing = JSON.parse(fileContent);
    }
  } catch (error) {
    // If file doesn't exist or fails to parse, start with empty object
  }

  // Deep merge patch into existing
  const merged = { ...existing, ...patch };

  // Write pretty-printed JSON with 2-space indent
  fs.writeFileSync(configFilePath, JSON.stringify(merged, null, 2) + '\n');
}
