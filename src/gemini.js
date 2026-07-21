export class RateLimitError extends Error {}
export class AuthError extends Error {}
export class ModelError extends Error {}
export class TimeoutError extends Error {}
export class NetworkError extends Error {}

const SYSTEM_PROMPT =
  'Rewrite the following text to be grammatically correct and clearer, ' +
  'while preserving its original intent and meaning exactly. ' +
  'This is text typed into a terminal prompt intended for an AI coding assistant — ' +
  'preserve all technical terms, file paths, command names, code snippets, and ' +
  'programming identifiers exactly as written. ' +
  'It may be one line or multiple lines. ' +
  'Respond with EXACTLY ONE rewritten version preserving the same line structure and count. ' +
  'Do not offer multiple options or alternatives. Do not add headings, bullet ' +
  'points, markdown formatting, quotes, explanations, or any commentary. ' +
  'If recent terminal context is provided before the text, use it only to clarify ' +
  'abbreviations or references — do not include context content in the output. ' +
  'Output must contain nothing but the rewritten text itself.';

function isGroq(apiKey) { return apiKey.startsWith('gsk_'); }

function buildAuthHeaders(apiKey) {
  return isGroq(apiKey)
    ? { 'Authorization': `Bearer ${apiKey}` }
    : { 'x-goog-api-key': apiKey };
}

export async function listModels(apiKey) {
  if (isGroq(apiKey)) {
    return [
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'gemma2-9b-it',
      'llama3-8b-8192',
      'llama-3.1-70b-versatile',
    ];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models',
      {
        headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(apiKey) },
        signal: controller.signal,
      }
    );
    if (!response.ok) throw new AuthError('Could not fetch model list');
    const data = await response.json();
    return (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new NetworkError('Could not fetch model list');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function enhanceGroq(text, config, context) {
  const { geminiApiKey: apiKey, geminiModel: model, timeoutSeconds } = config;
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const controller = new AbortController();
  let timeoutId;

  const userContent = context
    ? `Recent terminal context:\n${context}\n\nText:\n${text}`
    : text;

  try {
    timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) throw new RateLimitError('Quota exceeded');
      else if (response.status === 401 || response.status === 403) throw new AuthError('Invalid key — run ccx-init');
      else if (response.status === 404) throw new ModelError('Model not found — run ccx-init');
      else throw new NetworkError(`API error ${response.status}`);
    }

    const data = await response.json();
    const result = data.choices[0].message.content.trim();
    if (!result) throw new NetworkError('Empty response');
    return result;
  } catch (err) {
    if (err.name === 'AbortError') throw new TimeoutError(`Timed out after ${timeoutSeconds}s`);
    if (err instanceof RateLimitError || err instanceof AuthError ||
        err instanceof ModelError || err instanceof NetworkError ||
        err instanceof TimeoutError) throw err;
    throw new NetworkError('No connection');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function enhanceGemini(text, config, context) {
  const { geminiApiKey, geminiModel, timeoutSeconds } = config;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
  const controller = new AbortController();
  let timeoutId;

  const promptText = context
    ? `${SYSTEM_PROMPT}\n\nRecent terminal context:\n${context}\n\nText:\n${text}`
    : `${SYSTEM_PROMPT}\n\nText:\n${text}`;

  try {
    timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(geminiApiKey) },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 429) throw new RateLimitError('Quota exceeded');
      else if (response.status === 401 || response.status === 403) throw new AuthError('Invalid key — run ccx-init');
      else if (response.status === 404) throw new ModelError('Model not found — run ccx-init');
      else throw new NetworkError(`API error ${response.status}: ${body.substring(0, 200)}`);
    }

    const data = await response.json();
    const result = data.candidates[0].content.parts.map(p => p.text || '').join('').trim();
    if (!result) throw new NetworkError('Gemini returned empty response');
    return result;
  } catch (err) {
    if (err.name === 'AbortError') throw new TimeoutError(`Timed out after ${timeoutSeconds}s`);
    if (err instanceof RateLimitError || err instanceof AuthError ||
        err instanceof ModelError || err instanceof NetworkError ||
        err instanceof TimeoutError) throw err;
    throw new NetworkError('No connection');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function enhance(text, config, context = null) {
  return isGroq(config.geminiApiKey)
    ? enhanceGroq(text, config, context)
    : enhanceGemini(text, config, context);
}
