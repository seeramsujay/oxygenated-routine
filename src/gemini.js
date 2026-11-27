/**
 * @fileoverview Shared Google Gemini REST transport and prompt-boundary helpers.
 *
 * Centralizes API endpoint construction, header authentication (`x-goog-api-key`),
 * timeout handling, XML delimiter neutralisation, and candidate text extraction
 * so plan synthesis (`llm.js`) and follow-up chat (`chat.js`) share one client.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REFUSAL_REASONS = new Set(['SAFETY', 'RECITATION']);

/**
 * Strips XML-style angle brackets from untrusted user text so it cannot close its boundary tag.
 *
 * @param {string} text
 * @returns {string}
 */
export const neutralise = (text) => String(text ?? '').replace(/[<>]/g, ' ');

/**
 * Sends a `generateContent` request to the Google Gemini REST API.
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   apiKey: string,
 *   model: string,
 *   body: object,
 *   timeoutMs: number
 * }} params
 * @returns {Promise<Response>}
 */
export function postGemini({ fetchImpl = fetch, apiKey, model, body, timeoutMs }) {
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
  return fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Extracts the primary text part and refusal status from a Gemini `generateContent` payload.
 *
 * @param {any} data
 * @returns {{ text: string|null, refused: boolean }}
 */
export function extractGeminiText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const candidate = candidates[0];
  if (!candidate) return { text: null, refused: false };
  if (REFUSAL_REASONS.has(candidate.finishReason)) return { text: null, refused: true };
  const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
  const text = typeof parts[0]?.text === 'string' ? parts[0].text : null;
  return { text, refused: false };
}
