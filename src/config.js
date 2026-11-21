/** Central runtime configuration. Read lazily so tests can change env vars. */
export const config = {
  port: () => Number(process.env.PORT) || 3000,
  host: () => process.env.HOST || '127.0.0.1',
  model: () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  llmTimeoutMs: 60_000,
  upstreamTimeoutMs: 8_000,
  maxBodyBytes: 16 * 1024,
  /** Claude is used only when credentials are present; otherwise the rule engine answers. */
  llmEnabled: () =>
    process.env.DISABLE_LLM !== '1' && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  rateLimits: {
    plan: { windowMs: 60_000, max: 6 },
    geocode: { windowMs: 60_000, max: 30 },
  },
  trustProxy: () => process.env.TRUST_PROXY === '1' || Boolean(process.env.VERCEL),
};
