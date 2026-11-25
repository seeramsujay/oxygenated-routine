/**
 * @fileoverview Central application configuration.
 *
 * Reads environment variables lazily through functions so unit and integration
 * test suites can alter environment variables per test without cache cross-contamination.
 */
export const config = {
  /** Server listening port. Defaults to 3000. */
  port: () => Number(process.env.PORT) || 3000,
  /** Server binding host interface. Defaults to 127.0.0.1 for local security. */
  host: () => process.env.HOST || '127.0.0.1',
  /** Google Gemini model identifier. Defaults to gemini-3.1-flash-lite. */
  model: () => process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  /** Google Gemini API key. */
  apiKey: () => process.env.GEMINI_API_KEY || '',
  /** Maximum duration before an LLM request is aborted. */
  llmTimeoutMs: 60_000,
  /** Maximum duration before an external upstream HTTP request is aborted. */
  upstreamTimeoutMs: 8_000,
  /** Maximum permitted request body payload in bytes (16 KB). */
  maxBodyBytes: 16 * 1024,
  /**
   * Evaluates whether Gemini generative capabilities are active.
   * Disabled when DISABLE_LLM is set or when GEMINI_API_KEY is absent.
   */
  llmEnabled: () => process.env.DISABLE_LLM !== '1' && Boolean(process.env.GEMINI_API_KEY),
  /** Rate limiting policies for API routes (per IP key). */
  rateLimits: {
    plan: { windowMs: 60_000, max: 6 },
    geocode: { windowMs: 60_000, max: 30 },
    chat: { windowMs: 60_000, max: 20 },
  },
  /**
   * Whether to trust upstream reverse proxies for client IP extraction.
   * Automatically trusts proxy when running on Vercel serverless platform or when TRUST_PROXY=1.
   */
  trustProxy: () => process.env.TRUST_PROXY === '1' || Boolean(process.env.VERCEL),
};
