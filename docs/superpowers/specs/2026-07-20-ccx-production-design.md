# ccx-relay: Production Design

**Date:** 2026-07-20  
**Status:** Approved  
**Scope:** Public npm release of ccx-relay PTY wrapper

---

## 1. Overview

ccx-relay is a transparent PTY wrapper that intercepts terminal input before passing it to a child CLI (primarily `claude`). When triggered, it sends the current line to Gemini for grammar/clarity rewriting, replaces the line in-place, and waits for the user to submit.

**Goals for production:**
- Config survives npm upgrades
- `Alt+M` keyboard shortcut alongside `;;` marker
- Animated spinner with typed error messages
- `ccx init` wizard for first-run setup
- Automated test + publish CI/CD on public GitHub (free)

---

## 2. File Structure

```
ccx-relay/
├── bin/
│   ├── ccx.js            ← thin entry: parse argv, load config, spawn PTY, wire modules
│   └── ccx-init.js       ← standalone init wizard binary
├── src/
│   ├── config.js         ← read/write user config, defaults, env var overrides
│   ├── input.js          ← raw stdin parser: ;; marker, Alt+M, win32-input-mode
│   ├── gemini.js         ← API client: fetch, AbortController timeout, typed errors
│   └── ui.js             ← Braille spinner, ANSI status lines, color output
├── test/
│   ├── input.test.js
│   ├── gemini.test.js
│   └── config.test.js
├── .github/
│   └── workflows/
│       ├── test.yml      ← PR gate: node 18/20/22, ubuntu + windows
│       └── publish.yml   ← auto-publish on git tag v*
├── package.json
├── .env.example          ← local dev reference only, not loaded at runtime
└── README.md
```

---

## 3. Config

**Location:**
- Windows: `%APPDATA%\ccx\config.json`
- macOS/Linux: `~/.config/ccx/config.json`

**Schema:**
```json
{
  "geminiApiKey": "AIza...",
  "geminiModel": "gemini-2.5-flash",
  "marker": ";;",
  "timeoutSeconds": 8
}
```

**Priority order (highest to lowest):**
1. Environment variables (`GEMINI_API_KEY`, `GEMINI_MODEL`, `CCX_MARKER`, `CCX_TIMEOUT`)
2. `config.json`
3. Hardcoded defaults

**On missing API key:** print `No API key found. Run \`ccx init\` to set up.` and exit 1.

`src/config.js` exports: `load()`, `save(patch)`, `configPath()`.

---

## 4. Input Handling (`src/input.js`)

Two trigger paths:

| Trigger | Encoding | Condition |
|---|---|---|
| `;;` + Enter | bare `\r` (0x0d) or win32-input-mode VK=13 | lineBuffer ends with `;;` and has content before it |
| `Alt+M` | standard: `0x1b 0x6d` / win32: VK=77 + Alt bit in control-key state | lineBuffer non-empty |

**Responsibilities:**
- Build `lineBuffer` from printable chars
- Handle Backspace (0x7f/0x08), Ctrl+C (0x03), Enter (bare + win32-encoded)
- Detect `Alt+M` in both encoding modes
- Emit events: `enhance`, `submit`, `passthrough`
- No Gemini calls, no terminal writes — pure parsing

**Edge cases:**

| Situation | Behavior |
|---|---|
| `Alt+M` on empty line | ignore, passthrough |
| `Alt+M` while enhance in progress | ignore (busy flag) |
| `;;` with only whitespace before marker | ignore, passthrough |
| Ctrl+C during enhancement | abort fetch, restore line, forward Ctrl+C |
| Multi-byte paste ending with trigger | buffer entire paste, detect trigger at end |

---

## 5. Gemini Client (`src/gemini.js`)

**Signature:** `enhance(text, config): Promise<string>`

**Typed errors:**

| HTTP / condition | Error class | User message |
|---|---|---|
| 429 | `RateLimitError` | `Quota exceeded` |
| 401 / 403 | `AuthError` | `Invalid key — run ccx init` |
| 404 | `ModelError` | `Model not found — run ccx init` |
| AbortController fired | `TimeoutError` | `Timed out after Xs` |
| Network failure | `NetworkError` | `No connection` |

All errors: original line restored, cursor returned, user can retry. Nothing lost.

---

## 6. UI (`src/ui.js`)

**Spinner frames:** `['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']` at 80ms intervals

**States:**

```
⠋ Enhancing prompt...       ← animating during API call

✓ Enhanced                  ← green, shown 400ms then cleared on success

✗ Timed out — original restored   ← red on any error
```

**Rendering:** ANSI save/restore cursor (`\x1b[s` / `\x1b[u`) draws status on line below current input. `ui.js` is the only module that writes to stderr. All other modules call `ui.*` methods.

---

## 7. `ccx init` Wizard (`bin/ccx-init.js`)

**Commands:**
- `ccx init` — interactive first-run setup
- `ccx init --reset` — wipe config, start over
- `ccx init --show` — print current config (key masked as `AIza****...`)

**Wizard flow:**
1. Prompt: `Gemini API key:` (hidden input, no echo)
2. Validate: test call to `gemini-2.5-flash` → show `✓ Valid` or `✗ Invalid key`
3. Model picker (arrow keys): `gemini-2.5-flash` (default) / `gemini-1.5-flash` / `gemini-2.5-pro`
4. Marker input (default `;;`)
5. Timeout input (default `8`)
6. Write `config.json`, print path
7. Print `Run \`ccx claude\` to start.`

---

## 8. CI/CD

**`test.yml`** — triggers on pull_request:
- Matrix: Node 18, 20, 22 × ubuntu-latest + windows-latest
- Steps: `npm ci` → `npm test`

**`publish.yml`** — triggers on `push` to tags matching `v*`:
- Steps: `npm ci` → `npm test` → `npm publish --access public`
- Requires `NPM_TOKEN` secret in GitHub repo settings

**`package.json` additions:**
```json
{
  "bin": {
    "ccx": "bin/ccx.js",
    "ccx-init": "bin/ccx-init.js"
  },
  "scripts": {
    "test": "node --test test/**/*.test.js",
    "prepublishOnly": "npm test"
  },
  "engines": { "node": ">=18" }
}
```

---

## 9. What Does NOT Change

- PTY spawn logic (`node-pty` via `cmd.exe /c` on Windows)
- win32-input-mode `parseWin32InputSeq` decoder
- Gemini prompt text (rewrite for clarity, preserve intent)
- `xterm-color` PTY name, resize forwarding
- `.env.example` kept for local dev reference

---

## 10. Out of Scope

- Multiple AI providers (OpenAI, Ollama)
- Plugin system
- Telemetry
- GUI config editor
- Multi-line prompt buffering / cursor tracking fixes
