# Seerr Request Approval Dashboard

A simpler way to approve media requests via Seerr. Deployed locally via Docker Compose.

## Features

- **Short synopsis** on each request (fetch from Seerr/TMDB details)
- **TMDB fallback** for media details when Seerr endpoints fail (requires TMDB API key in Settings)
- **Local storage of declined requests** — declined requests are stored locally so they appear in the Declined filter even if Seerr doesn't return them
- **Filtering** by status, media type, requested-by, and country (multi-select checkboxes)
  - Status filter includes **Declined** (movies: status=3; TV: all seasons declined) and **Partially Declined** (TV only: some seasons declined, some not)
- **Multi-select** and bulk approve/decline
- **Per-row** quick approve/decline with optimistic UI
- **Pending count** badge and stats strip
- **Encrypted API key** storage — AES-256-GCM encrypted at rest, never in plaintext, never in GitHub
- **Health check** endpoint (`/health`) for Docker health checks
- **Graceful shutdown** on SIGTERM/SIGINT
- **Security headers** via Helmet.js
- **Structured logging** via Winston
- **Input validation** on settings form
- **Request deduplication** cache for media detail calls (5-minute TTL)
- **TypeScript** frontend with strict type checking
- **Unit tests** for server (Jest + Supertest) and client (Vitest + React Testing Library)

## Deployment

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env and set SECRET_KEY (e.g. openssl rand -hex 32)
# Optionally set ALLOWED_ORIGIN (defaults to http://10.0.0.134:5656)
```

### 2. Start with Docker Compose

```bash
docker compose up -d
```

The app will be available at **http://10.0.0.134:5656**.

### 3. Configure the Seerr API key

Open the app, go to **Settings**, enter your Seerr URL and API key, then click **Save**. The key is encrypted locally (using `SECRET_KEY`) and stored in a Docker volume — never in plaintext, never in GitHub.

## Testing

```bash
# Run all tests
npm test

# Run client tests only
npm run test:client

# Run server tests only
npm run test:server
```

## Best Practices Implemented

| Practice | Implementation |
|----------|---------------|
| TypeScript | Frontend fully converted to TypeScript with strict mode |
| Error Boundaries | React ErrorBoundary wraps the app |
| Request Deduplication | Media detail calls cached client-side (5-min TTL) |
| Health Check | `GET /health` endpoint + Docker HEALTHCHECK |
| Graceful Shutdown | SIGTERM/SIGINT handlers close HTTP server |
| Security Headers | Helmet.js (CSP, HSTS, XSS protection, etc.) |
| CORS Restriction | Configurable `ALLOWED_ORIGIN` env var |
| Input Validation | Settings form validated server-side |
| Structured Logging | Winston with JSON output to console + files |
| Environment Validation | SECRET_KEY required at startup |
| API Versioning | All API routes under `/api/v1/` |
| Optimistic UI | Approve/decline updates UI immediately, rolls back on error |
| Accessibility | ARIA labels, htmlFor/id associations, keyboard navigation |

## Architecture

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express + TypeScript |
| Frontend | React + Vite + TypeScript |
| API proxy | Express forwards requests to Seerr with `X-Api-Key` |
| Storage | Encrypted `config.json` in a Docker volume |
| Logging | Winston (JSON, console + file) |
| Testing | Jest + Supertest (server), Vitest + RTL (client) |

The Express server holds the Seerr API key server-side and proxies all Seerr API calls, so the key is never exposed to the browser.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | Yes | — | Encryption key for API key at rest (`openssl rand -hex 32`) |
| `SEERR_URL` | No | `http://10.0.0.134:5055` | Seerr instance URL |
| `ALLOWED_ORIGIN` | No | `http://10.0.0.134:5656` | CORS allowed origin |
| `PORT` | No | `3000` | Container port |
| `NODE_ENV` | No | `production` | Node environment |
| `LOG_LEVEL` | No | `info` | Winston log level |
| `TMDB_API_KEY` | No | — | TMDB API key for fallback media details (get at themoviedb.org/settings/api) |