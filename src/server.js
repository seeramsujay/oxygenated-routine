/**
 * @fileoverview HTTP server and REST API handler.
 *
 * Implements a minimal attack-surface HTTP server using standard Node.js built-ins.
 * Serves secure static front-end assets with hardened security headers (CSP, nosniff,
 * frame-ancestors, referrer policy) and exposes JSON API endpoints with per-client
 * rate limiting, strict payload size limits, and robust error serialization.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { geocode } from './airData.js';
import { handleChat } from './chat.js';
import { config } from './config.js';
import { AppError, badRequest } from './errors.js';
import { createPlan } from './planner.js';
import { createRateLimiter } from './rateLimit.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Whitelist of supported MIME content types for static assets. */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Standard enterprise-grade HTTP security headers applied to all responses. */
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Sends raw HTTP response with default security headers. */
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

/** Sends JSON response with no-store caching directives and security headers. */
function sendJson(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

/**
 * Parses pre-parsed request bodies provided by serverless hosting runtimes (e.g., Vercel).
 *
 * @param {import('node:http').IncomingMessage & { body?: unknown }} req - Incoming HTTP request.
 * @returns {any} Parsed JSON object, or undefined if body must be read from stream.
 */
function parsePreParsedBody(req) {
  if (req.body === undefined || req.body === null) return undefined;
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > config.maxBodyBytes) {
      throw new AppError(413, 'payload_too_large', 'Request is too large.');
    }
    try {
      return JSON.parse(req.body);
    } catch {
      throw badRequest('Request body is not valid JSON.');
    }
  }
  return undefined;
}

async function readJsonBody(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new AppError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
  }
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > config.maxBodyBytes) {
    throw new AppError(413, 'payload_too_large', 'Request is too large.');
  }
  const preParsed = parsePreParsedBody(req);
  if (preParsed !== undefined) return preParsed;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > config.maxBodyBytes) throw new AppError(413, 'payload_too_large', 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('Request body is not valid JSON.');
  }
}

/**
 * Behind a trusted proxy, use the right-most X-Forwarded-For entry: it is the one the proxy appended.
 * Entries to its left come from the client and can be forged to dodge rate limits.
 */
function clientKey(req) {
  const forwarded = config.trustProxy()
    ? (String(req.headers['x-forwarded-for'] ?? '')
        .split(',')
        .map((part) => part.trim())
        .findLast(Boolean) ?? '')
    : '';
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(
      res,
      405,
      { error: { code: 'method_not_allowed', message: 'Method not allowed.' } },
      { Allow: 'GET, HEAD' },
    );
  }
  let relative;
  try {
    relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    throw badRequest('Malformed path.');
  }
  const file = path.join(PUBLIC_DIR, path.normalize(relative));
  const type = CONTENT_TYPES[path.extname(file)];
  if (!type || !file.startsWith(`${PUBLIC_DIR}${path.sep}`)) throw new AppError(404, 'not_found', 'Not found.');
  try {
    const body = await readFile(file);
    return send(res, 200, req.method === 'HEAD' ? undefined : body, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
    });
  } catch {
    throw new AppError(404, 'not_found', 'Not found.');
  }
}

/**
 * Build the request handler. `deps` lets tests replace network and model calls.
 * @param {{fetchImpl?: typeof fetch, generate?: Function, llmEnabled?: boolean, now?: () => number}} [deps]
 */
export function createApp(deps = {}) {
  const limit = {
    plan: createRateLimiter({ ...config.rateLimits.plan, now: deps.now }),
    geocode: createRateLimiter({ ...config.rateLimits.geocode, now: deps.now }),
    chat: createRateLimiter({ ...config.rateLimits.chat, now: deps.now }),
  };

  const routes = {
    'GET /api': async () => ({ status: 'ok', ai: deps.llmEnabled ?? config.llmEnabled() }),
    'GET /api/health': async () => ({ status: 'ok', ai: deps.llmEnabled ?? config.llmEnabled() }),
    'GET /api/geocode': async (req, url) => ({ results: await geocode(url.searchParams.get('q'), deps.fetchImpl) }),
    'POST /api/plan': async (req) => createPlan(await readJsonBody(req), deps),
    'POST /api/chat': async (req) => handleChat(await readJsonBody(req), deps),
  };
  const limited = { 'GET /api/geocode': limit.geocode, 'POST /api/plan': limit.plan, 'POST /api/chat': limit.chat };

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname = url.pathname;
      if (pathname === '/api/index.js' || pathname === '/api/index') {
        pathname = String(req.headers['x-matched-path'] ?? '/api');
      }
      const route = `${req.method} ${pathname}`;
      if (!url.pathname.startsWith('/api/')) return await serveStatic(req, res, url.pathname);

      const handler = routes[route];
      if (!handler) throw new AppError(404, 'not_found', 'Unknown API route.');

      const verdict = limited[route]?.(clientKey(req));
      if (verdict && !verdict.allowed) {
        return sendJson(
          res,
          429,
          { error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment.' } },
          {
            'Retry-After': String(verdict.retryAfterSeconds),
          },
        );
      }
      return sendJson(res, 200, await handler(req, url));
    } catch (error) {
      if (error instanceof AppError) {
        const { code, message, details } = error;
        return sendJson(res, error.status, { error: { code, message, details } }, { Connection: 'close' });
      }
      console.error('Unhandled error:', error?.name);
      return sendJson(res, 500, { error: { code: 'internal_error', message: 'Something went wrong.' } });
    }
  };
}

export const createServer = (deps) => http.createServer(createApp(deps));

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = createServer();
  server.listen(config.port(), config.host(), () => {
    const mode = config.llmEnabled()
      ? `Gemini (${config.model()})`
      : 'built-in rule engine (set GEMINI_API_KEY for Gemini)';
    console.log(`Oxygenated Routine on http://${config.host()}:${config.port()}  |  plans by ${mode}`);
  });
}
