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
  global.fetch = (url, opts) => {
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    });
  };
  const fastCfg = { ...cfg, timeoutSeconds: 0.05 };
  await assert.rejects(() => enhance('text', fastCfg), TimeoutError);
});
