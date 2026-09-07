import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkProvider, publicProviderList } from './src/providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 16 * 1024;
const MAX_KEY_LENGTH = 1024;
const WINDOW_MS = 60_000;
const MAX_CHECKS_PER_WINDOW = Number(process.env.MAX_CHECKS_PER_MINUTE || 20);
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const PRODUCTION_LIKE = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
const rate = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function json(res, status, data) {
  securityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function rateAllowed(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const current = rate.get(ip);
  if (!current || now - current.start >= WINDOW_MS) {
    rate.set(ip, { start: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_CHECKS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function authorized(req) {
  if (!APP_PASSWORD) return !PRODUCTION_LIKE;
  const supplied = req.headers['x-app-password'];
  return typeof supplied === 'string' && timingSafeEqualString(supplied, APP_PASSWORD);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Payload too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.posix.normalize(requested).replace(/^\.\.\//g, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  try {
    const data = await fs.readFile(filePath);
    securityHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    return json(res, 200, { ok: true, service: 'ai-key-checker', time: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    return json(res, 200, {
      passwordRequired: Boolean(APP_PASSWORD) || PRODUCTION_LIKE,
      passwordConfigured: Boolean(APP_PASSWORD),
      providers: publicProviderList(),
      maxChecksPerMinute: MAX_CHECKS_PER_WINDOW,
      notice: 'Only test API keys you own or are authorized to use. Keys are not stored by this app.'
    });
  }

  if (req.method === 'POST' && pathname === '/api/check') {
    if (PRODUCTION_LIKE && !APP_PASSWORD) {
      return json(res, 503, {
        error: 'APP_PASSWORD is required on production/Railway before API key checks are enabled.'
      });
    }
    if (!authorized(req)) return json(res, 401, { error: 'Invalid app password.' });
    if (!rateAllowed(req)) return json(res, 429, { error: 'Too many checks. Try again in a minute.' });

    try {
      const body = await readJson(req);
      const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
      const credentials = body.credentials && typeof body.credentials === 'object' && !Array.isArray(body.credentials) ? body.credentials : {};
      if (!provider) return json(res, 400, { error: 'provider is required.' });
      const serialized = JSON.stringify(credentials);
      if (serialized.length > MAX_KEY_LENGTH * 8) return json(res, 400, { error: 'Credential payload is too large.' });

      const result = await checkProvider(provider, credentials);
      return json(res, 200, result);
    } catch (error) {
      return json(res, error?.statusCode || 500, { error: error?.message || 'Unexpected error' });
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (await serveStatic(req, res, pathname)) return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Key Checker listening on :${PORT}`);
  if (PRODUCTION_LIKE && !APP_PASSWORD) {
    console.warn('API checks are LOCKED: set APP_PASSWORD in Railway Variables.');
  }
});
