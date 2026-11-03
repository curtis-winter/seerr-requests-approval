const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const { createLogger, format, transports } = require('winston');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_SEERR_URL = process.env.SEERR_URL || 'http://10.0.0.134:5055';
const SECRET_KEY = process.env.SECRET_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------
if (!SECRET_KEY) {
  console.error(
    'FATAL: SECRET_KEY environment variable is required. ' +
    'Generate with: openssl rand -hex 32'
  );
  process.exit(1);
}

if (!DEFAULT_SEERR_URL.startsWith('http://') && !DEFAULT_SEERR_URL.startsWith('https://')) {
  console.error(
    'FATAL: SEERR_URL must start with http:// or https://'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Structured logging (Winston)
// ---------------------------------------------------------------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'seerr-request-manager' },
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join(DATA_DIR, 'logs', 'error.log'), level: 'error' }),
    new transports.File({ filename: path.join(DATA_DIR, 'logs', 'combined.log') }),
  ],
});

// ---------------------------------------------------------------------------
// Ensure directories exist
// ---------------------------------------------------------------------------
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(path.join(DATA_DIR, 'logs'))) {
  fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
}

// ---------------------------------------------------------------------------
// Encrypted local config (API key at rest)
// ---------------------------------------------------------------------------

let apiKeyCache = null;
let seerrUrlCache = DEFAULT_SEERR_URL;

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext, secret) {
  const iv = crypto.randomBytes(16);
  const key = deriveKey(secret);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('hex'), encrypted, tag: tag.toString('hex') });
}

function decrypt(ciphertextJson, secret) {
  const { iv, encrypted, tag } = JSON.parse(ciphertextJson);
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const config = JSON.parse(raw);
      if (config.seerrUrl) seerrUrlCache = config.seerrUrl;
      if (config.apiKeyEncrypted) {
        if (SECRET_KEY) {
          try {
            apiKeyCache = decrypt(config.apiKeyEncrypted, SECRET_KEY);
            logger.info('Seerr API key loaded from encrypted config');
          } catch (e) {
            logger.error('Failed to decrypt stored API key — SECRET_KEY may have changed.');
          }
        } else {
          logger.warn('SECRET_KEY not set. Stored API key cannot be decrypted.');
        }
      }
    }
  } catch (e) {
    logger.error('Error loading config', { error: e.message });
  }
}

function saveConfig({ seerrUrl, apiKey }) {
  if (seerrUrl) seerrUrlCache = seerrUrl;
  let encryptedKey = null;

  if (apiKey) {
    if (SECRET_KEY) {
      encryptedKey = encrypt(apiKey, SECRET_KEY);
      apiKeyCache = apiKey;
      logger.info('Seerr API key saved and encrypted at rest');
    } else {
      apiKeyCache = apiKey;
    }
  }

  const data = {
    seerrUrl: seerrUrlCache || DEFAULT_SEERR_URL,
    apiKeyEncrypted: encryptedKey,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

loadConfig();

// ---------------------------------------------------------------------------
// Request deduplication cache (media detail calls)
// ---------------------------------------------------------------------------
const detailCache = new Map(); // key: `movie:${tmdbId}` or `tv:${tvdbId}` => { promise, timestamp }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedDetail(key, fetcher) {
  const now = Date.now();
  const cached = detailCache.get(key);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = fetcher().finally(() => {
    // Remove from cache after resolution to allow fresh fetch next time
    detailCache.delete(key);
  });
  detailCache.set(key, { promise, timestamp: now });
  return promise;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Security headers with CSP allowing TMDB images and inline scripts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://image.tmdb.org'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", 'https://image.tmdb.org'],
      },
    },
  })
);

// CORS restriction — only allow configured origin
app.use(
  cors({
    origin: ALLOWED_ORIGIN === '*' ? '*' : [ALLOWED_ORIGIN],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Api-Key'],
    maxAge: 86400,
  })
);

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${Date.now() - start}ms`,
      ip: req.ip,
    });
  });
  next();
});

// Simple validation helper
function validateSettingsBody(body) {
  const errors = [];
  if (body.seerrUrl !== undefined && body.seerrUrl !== null && body.seerrUrl !== '') {
    try {
      new URL(body.seerrUrl);
    } catch {
      errors.push({ field: 'seerrUrl', message: 'Seerr URL must be a valid URL with http:// or https://' });
    }
  }
  if (body.apiKey !== undefined && body.apiKey !== null) {
    if (typeof body.apiKey !== 'string' || body.apiKey.length < 1 || body.apiKey.length > 256) {
      errors.push({ field: 'apiKey', message: 'API key must be between 1 and 256 characters' });
    }
  }
  return errors;
}

function seerrHeaders() {
  const headers = {};
  if (apiKeyCache) headers['X-Api-Key'] = apiKeyCache;
  return headers;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// API v1 routes (versioned)
// ---------------------------------------------------------------------------

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'seerr-request-manager',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!apiKeyCache,
    secretKeyConfigured: !!SECRET_KEY,
  });
});

// Settings
app.get('/api/v1/settings', (_req, res) => {
  res.json({
    seerrUrl: seerrUrlCache,
    hasApiKey: !!apiKeyCache,
    secretKeyConfigured: !!SECRET_KEY,
  });
});

app.post(
  '/api/v1/settings',
  (req, res) => {
    const errors = validateSettingsBody(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const { seerrUrl, apiKey } = req.body;
    saveConfig({ seerrUrl, apiKey });
    res.json({ success: true });
  }
);

app.post('/api/v1/test-connection', async (req, res) => {
  try {
    const { seerrUrl, apiKey } = req.body;
    if (!seerrUrl) {
      return res.status(400).json({ success: false, error: 'Seerr URL required' });
    }
    const headers = {};
    if (apiKey) headers['X-Api-Key'] = apiKey;
    await axios.get(`${seerrUrl.replace(/\/$/, '')}/api/v1/status`, {
      headers,
      timeout: 5000,
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Seerr connection test failed', {
      error: error.message,
      url: req.body.seerrUrl,
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

// List requests with filtering
app.get('/api/v1/requests', async (req, res) => {
  try {
    const { filter, mediaType, requestedBy, take, skip, sort, sortDirection } = req.query;
    const params = new URLSearchParams();
    if (filter) params.set('filter', filter);
    if (mediaType) params.set('mediaType', mediaType);
    if (requestedBy) params.set('requestedBy', requestedBy);
    if (take) params.set('take', take);
    if (skip) params.set('skip', skip);
    if (sort) params.set('sort', sort);
    if (sortDirection) params.set('sortDirection', sortDirection);

    const url = `${seerrUrlCache.replace(/\/$/, '')}/api/v1/request?${params.toString()}`;
    const response = await axios.get(url, { headers: seerrHeaders() });
    res.json(response.data);
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    logger.error('Failed to fetch requests', {
      error: error.message,
      status,
    });
    res.status(status).json({ error: error.message || 'Failed to fetch requests' });
  }
});

// Request counts by status
app.get('/api/v1/requests/count', async (_req, res) => {
  try {
    const response = await axios.get(`${seerrUrlCache.replace(/\/$/, '')}/api/v1/request/count`, {
      headers: seerrHeaders(),
    });
    res.json(response.data);
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    logger.error('Failed to fetch request counts', {
      error: error.message,
      status,
    });
    res.status(status).json({ error: error.message || 'Failed to fetch request counts' });
  }
});

// Approve a single request
app.post('/api/v1/requests/:id/approve', async (req, res) => {
  try {
    const response = await axios.post(
      `${seerrUrlCache.replace(/\/$/, '')}/api/v1/request/${req.params.id}/approve`,
      {},
      { headers: seerrHeaders() }
    );
    logger.info('Request approved', { requestId: req.params.id });
    res.json(response.data);
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    logger.error('Failed to approve request', {
      requestId: req.params.id,
      error: error.message,
      status,
    });
    res.status(status).json({
      error: error.response?.data?.message || error.message || 'Failed to approve request',
    });
  }
});

// Decline a single request
app.post('/api/v1/requests/:id/decline', async (req, res) => {
  try {
    const response = await axios.post(
      `${seerrUrlCache.replace(/\/$/, '')}/api/v1/request/${req.params.id}/decline`,
      {},
      { headers: seerrHeaders() }
    );
    logger.info('Request declined', { requestId: req.params.id });
    res.json(response.data);
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    logger.error('Failed to decline request', {
      requestId: req.params.id,
      error: error.message,
      status,
    });
    res.status(status).json({
      error: error.response?.data?.message || error.message || 'Failed to decline request',
    });
  }
});

// Movie details (for synopsis) — with deduplication cache
app.get('/api/v1/movie/:tmdbId', async (req, res) => {
  try {
    const cacheKey = `movie:${req.params.tmdbId}`;
    const response = await getCachedDetail(cacheKey, () =>
      axios.get(`${seerrUrlCache.replace(/\/$/, '')}/api/v1/movie/${req.params.tmdbId}`, {
        headers: seerrHeaders(),
      })
    );
    res.json(response.data);
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    logger.error('Failed to fetch movie details', {
      tmdbId: req.params.tmdbId,
      error: error.message,
      status,
    });
    res.status(status).json({ error: error.message || 'Failed to fetch movie details' });
  }
});

// TV details (for synopsis) — with deduplication cache
app.get('/api/v1/tv/:tvdbId', async (req, res) => {
  try {
    const cacheKey = `tv:${req.params.tvdbId}`;
    const response = await getCachedDetail(cacheKey, () =>
      axios.get(`${seerrUrlCache.replace(/\/$/, '')}/api/v1/tv/${req.params.tvdbId}`, {
        headers: seerrHeaders(),
      })
    );
    res.json(response.data);
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    logger.error('Failed to fetch TV details', {
      tvdbId: req.params.tvdbId,
      error: error.message,
      status,
    });
    res.status(status).json({ error: error.message || 'Failed to fetch TV details' });
  }
});

// ---------------------------------------------------------------------------
// Serve React frontend (production)
// ---------------------------------------------------------------------------

const clientDist = path.join(__dirname, 'client/dist');
app.use(express.static(clientDist));

app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let server = null;

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force close after 10 seconds
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Only listen when not in test environment
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, '0.0.0.0', () => {
    logger.info('Seerr Request Manager started', {
      port: PORT,
      seerrUrl: seerrUrlCache,
      apiKeyConfigured: !!apiKeyCache,
    });
  });
}

module.exports = app;
