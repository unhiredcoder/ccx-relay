# Task 3: src/gemini.js — API client with typed errors and timeout

## Context
ccx-relay is a Node.js PTY wrapper. This module calls the Gemini API to rewrite prompts.
It must be pure async logic — no UI writes, no process.exit.

## Global Constraints
- Node.js >= 18 (uses built-in fetch and AbortController)
- No new runtime dependencies
- ESM only (`export`, not `module.exports`)
- Tests use node:test and node:assert only

## Requirements

### `src/gemini.js`

Export these error classes (all extend Error):
```js
export class RateLimitError extends Error {}
export class AuthError      extends Error {}
export class ModelError     extends Error {}
export class TimeoutError   extends Error {}
export class NetworkError   extends Error {}
```

Export this function:
```js
export async function enhance(text, config): Promise<string>
```

Where `config` has shape: `{ geminiApiKey, geminiModel, timeoutSeconds }`

**Implementation:**
1. Build URL: `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`
2. Create `AbortController`, set timeout via `setTimeout(() => controller.abort(), timeoutSeconds * 1000)`
3. Call `fetch` with:
   - method: POST
   - signal: controller.signal
   - headers: `{ 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey }`
   - body: `JSON.stringify({ contents: [{ parts: [{ text: PROMPT_PREFIX + text }] }] })`
4. Clear timeout in `finally` block
5. On fetch throw:
   - `AbortError` (err.name === 'AbortError') → throw `new TimeoutError('Timed out after Xs')`
   - anything else → throw `new NetworkError('No connection')`
6. On bad HTTP status:
   - 429 → `new RateLimitError('Quota exceeded')`
   - 401 or 403 → `new AuthError('Invalid key — run ccx init')`
   - 404 → `new ModelError('Model not found — run ccx init')`
   - other → `new NetworkError('API error {status}: {first 200 chars of body}')`
7. Parse response: `data.candidates[0].content.parts.map(p => p.text||'').join('').trim()`
8. If empty result → throw `new NetworkError('Gemini returned empty response')`
9. Return trimmed string

**PROMPT_PREFIX constant** (exact text, do not change):
```
'Rewrite the following text to be grammatically correct and clearer, ' +
'while preserving its original intent and meaning exactly. ' +
'This is a single line typed into a terminal prompt, not a chat message - ' +
'respond with EXACTLY ONE rewritten version as a single plain-text line. ' +
'Do not offer multiple options or alternatives. Do not add headings, bullet ' +
'points, markdown formatting, quotes, explanations, or any commentary. ' +
'Output must contain nothing but the rewritten line itself.\n\nText:\n'
```

### `test/gemini.test.js`

7 tests using `node:test` and `node:assert`. Mock `global.fetch` for each test.

```js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

const cfg = { geminiApiKey: 'AIzaTEST', geminiModel: 'gemini-2.5-flash', timeoutSeconds: 8 };

function mockFetch(status, body) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

const { enhance, RateLimitError, AuthError, ModelError, TimeoutError, NetworkError } =
  await import('../src/gemini.js');

test('returns rewritten text on success', async () => {
  mockFetch(200, { candidates: [{ content: { parts: [{ text: 'Fixed text' }] } }] });
  const result = await enhance('fix teh bug', cfg);
  assert.equal(result, 'Fixed text');
});

test('throws RateLimitError on 429', async () => {
  mockFetch(429, { error: { message: 'quota' } });
  await assert.rejects(() => enhance('text', cfg), RateLimitError);
});

test('throws AuthError on 401', async () => {
  mockFetch(401, { error: { message: 'unauth' } });
  await assert.rejects(() => enhance('text', cfg), AuthError);
});

test('throws AuthError on 403', async () => {
  mockFetch(403, { error: { message: 'forbidden' } });
  await assert.rejects(() => enhance('text', cfg), AuthError);
});

test('throws ModelError on 404', async () => {
  mockFetch(404, { error: { message: 'not found' } });
  await assert.rejects(() => enhance('text', cfg), ModelError);
});

test('throws NetworkError on fetch rejection', async () => {
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(() => enhance('text', cfg), NetworkError);
});

test('throws TimeoutError when AbortController fires', async () => {
  global.fetch = () => new Promise(() => {}); // never resolves
  const fastCfg = { ...cfg, timeoutSeconds: 0.05 };
  await assert.rejects(() => enhance('text', fastCfg), TimeoutError);
});
```

## TDD Steps
1. Write test file first
2. Run `node --test test/gemini.test.js` — expect failure
3. Implement src/gemini.js
4. Run tests — all 7 must pass
5. Commit

## Commit message
`feat: add src/gemini.js with typed errors and AbortController timeout`

## Report
Write to: `.superpowers/sdd/task-3-report.md`

Return only:
- Status: DONE / BLOCKED
- Commit hash (short)
- Test result: "7/7 passing"
- Any concerns
