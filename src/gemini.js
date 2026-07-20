export class RateLimitError extends Error {}
export class AuthError extends Error {}
export class ModelError extends Error {}
export class TimeoutError extends Error {}
export class NetworkError extends Error {}

const PROMPT_PREFIX =
  'Rewrite the following text to be grammatically correct and clearer, ' +
  'while preserving its original intent and meaning exactly. ' +
  'This is a single line typed into a terminal prompt, not a chat message - ' +
  'respond with EXACTLY ONE rewritten version as a single plain-text line. ' +
  'Do not offer multiple options or alternatives. Do not add headings, bullet ' +
  'points, markdown formatting, quotes, explanations, or any commentary. ' +
  'Output must contain nothing but the rewritten line itself.\n\nText:\n';

export async function enhance(text, config) {
  const { geminiApiKey, geminiModel, timeoutSeconds } = config;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
  const controller = new AbortController();
  let timeoutId;

  try {
    timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT_PREFIX + text }] }],
      }),
    });

    // Handle bad HTTP status codes
    if (!response.ok) {
      const body = await response.text();
      if (response.status === 429) {
        throw new RateLimitError('Quota exceeded');
      } else if (response.status === 401 || response.status === 403) {
        throw new AuthError('Invalid key — run ccx init');
      } else if (response.status === 404) {
        throw new ModelError('Model not found — run ccx init');
      } else {
        const truncated = body.substring(0, 200);
        throw new NetworkError(`API error ${response.status}: ${truncated}`);
      }
    }

    // Parse response
    const data = await response.json();
    const result = data.candidates[0].content.parts.map(p => p.text || '').join('').trim();

    if (!result) {
      throw new NetworkError('Gemini returned empty response');
    }

    return result;
  } catch (err) {
    // Handle fetch errors
    if (err.name === 'AbortError') {
      throw new TimeoutError(`Timed out after ${timeoutSeconds}s`);
    }

    // Re-throw custom errors
    if (err instanceof RateLimitError || err instanceof AuthError ||
        err instanceof ModelError || err instanceof NetworkError ||
        err instanceof TimeoutError) {
      throw err;
    }

    // Wrap other errors as NetworkError
    throw new NetworkError('No connection');
  } finally {
    clearTimeout(timeoutId);
  }
}
