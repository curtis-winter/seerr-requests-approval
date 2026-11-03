const request = require('supertest');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Shared mock instance — axios.create() always returns this
const mockInstance = {
  get: jest.fn(),
  post: jest.fn(),
};

// Mock axios before importing the app
jest.mock('axios', () => ({
  create: jest.fn(() => mockInstance),
  get: mockInstance.get,
  post: mockInstance.post,
  default: {
    create: jest.fn(() => mockInstance),
    get: mockInstance.get,
    post: mockInstance.post,
  },
}));

const axios = require('axios');
const mockAxios = jest.mocked(axios);

function encryptTestValue(plaintext, secret) {
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash('sha256').update(secret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('hex'), encrypted, tag: tag.toString('hex') });
}

function decryptTestValue(ciphertextJson, secret) {
  const { iv, encrypted, tag } = JSON.parse(ciphertextJson);
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Helper to create a fresh app instance for each test
function createApp(envOverrides = {}) {
  // Clean up any leftover config from previous tests
  const configPath = path.join(__dirname, '..', 'data', 'config.json');
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
  // Clear module cache for index.js to pick up new env vars
  delete require.cache[require.resolve('../index')];

  // Set environment variables
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3001';
  process.env.SEERR_URL = envOverrides.SEERR_URL || 'http://localhost:5055';
  process.env.SECRET_KEY = envOverrides.SECRET_KEY || 'test-secret-key-for-testing';

  const app = require('../index');

  // Configure axios mock to return a consistent instance
  mockInstance.get.mockReset();
  mockInstance.post.mockReset();
  mockAxios.create.mockReturnValue(mockInstance);

  return { app, mockInstance };
}

describe('Server API', () => {
  afterEach(() => {
    jest.clearAllMocks();
    const configPath = path.join(__dirname, '..', 'data', 'config.json');
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  });

  describe('GET /health', () => {
    it('returns healthy status', async () => {
      const { app } = createApp({ SECRET_KEY: 'test-key' });
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('seerr-request-manager');
      expect(res.body.apiKeyConfigured).toBe(false);
      expect(res.body.secretKeyConfigured).toBe(true);
    });
  });

  describe('GET /api/v1/settings', () => {
    it('returns seerrUrl and hasApiKey=false when no key stored', async () => {
      const { app } = createApp({ SECRET_KEY: 'test-key' });
      const res = await request(app).get('/api/v1/settings');
      expect(res.status).toBe(200);
      expect(res.body.seerrUrl).toBe('http://localhost:5055');
      expect(res.body.hasApiKey).toBe(false);
      expect(res.body.secretKeyConfigured).toBe(true);
    });

    it('returns hasApiKey=true when key is configured', async () => {
      const { app } = createApp({ SECRET_KEY: 'test-key' });
      await request(app).post('/api/v1/settings').send({
        seerrUrl: 'http://localhost:5055',
        apiKey: 'my-secret-api-key',
      });

      const res = await request(app).get('/api/v1/settings');
      expect(res.status).toBe(200);
      expect(res.body.hasApiKey).toBe(true);
      expect(res.body.secretKeyConfigured).toBe(true);
    });
  });

  describe('POST /api/v1/settings', () => {
    it('saves seerrUrl and apiKey', async () => {
      const { app } = createApp({ SECRET_KEY: 'test-key' });
      const configPath = path.join(__dirname, '..', 'data', 'config.json');
      const res = await request(app)
        .post('/api/v1/settings')
        .send({ seerrUrl: 'http://newhost:5055', apiKey: 'test-api-key-123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify the key can be decrypted
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const decrypted = decryptTestValue(config.apiKeyEncrypted, 'test-key');
      expect(decrypted).toBe('test-api-key-123');
      expect(config.seerrUrl).toBe('http://newhost:5055');
    });

    it('rejects invalid Seerr URL', async () => {
      const { app } = createApp({ SECRET_KEY: 'test-key' });
      const res = await request(app)
        .post('/api/v1/settings')
        .send({ seerrUrl: 'not-a-url', apiKey: 'test-key' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });

    it('saves without apiKey when not provided', async () => {
      const { app } = createApp({ SECRET_KEY: 'test-key' });
      const res = await request(app)
        .post('/api/v1/settings')
        .send({ seerrUrl: 'http://newhost:5055' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/test-connection', () => {
    it('returns success when Seerr status endpoint responds 200', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      mockInstance.get.mockResolvedValueOnce({ data: {}, status: 200 });

      const res = await request(app)
        .post('/api/v1/test-connection')
        .send({ seerrUrl: 'http://localhost:5055' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 when seerrUrl is missing', async () => {
      const { app } = createApp({ SECRET_KEY: 'test-key' });
      const res = await request(app)
        .post('/api/v1/test-connection')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Seerr URL required');
    });

    it('returns failure when Seerr is unreachable', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      mockInstance.get.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      const res = await request(app)
        .post('/api/v1/test-connection')
        .send({ seerrUrl: 'http://localhost:5055' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/requests', () => {
    it('forwards query params to Seerr', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      mockInstance.get.mockResolvedValueOnce({
        data: { results: [], pageInfo: { results: 0, pages: 1 } },
      });

      await request(app)
        .get('/api/v1/requests')
        .query({ filter: 'pending', mediaType: 'movie', take: 50, skip: 0 });

      expect(mockInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/request?filter=pending&mediaType=movie&take=50&skip=0'),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it('returns Seerr response data', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      const mockData = { results: [{ id: 1, status: 1 }], pageInfo: { results: 1, pages: 1 } };
      mockInstance.get.mockResolvedValueOnce({ data: mockData });

      const res = await request(app).get('/api/v1/requests?filter=pending');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });

    it('returns error when Seerr fails', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      const mockError = new Error('Seerr error');
      mockError.response = { status: 500, data: { error: 'Internal error' } };
      mockInstance.get.mockRejectedValueOnce(mockError);

      const res = await request(app).get('/api/v1/requests');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/v1/requests/count', () => {
    it('returns request counts from Seerr', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      const mockData = { total: 10, pending: 5, approved: 3, declined: 2 };
      mockInstance.get.mockResolvedValueOnce({ data: mockData });

      const res = await request(app).get('/api/v1/requests/count');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });
  });

  describe('POST /api/v1/requests/:id/approve', () => {
    it('approves a request and returns updated data', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      const mockData = { id: 1, status: 2 };
      mockInstance.post.mockResolvedValueOnce({ data: mockData });

      const res = await request(app).post('/api/v1/requests/1/approve');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);

      expect(mockInstance.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/request/1/approve'),
        {},
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it('returns error when approval fails', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      const mockError = new Error('Approval failed');
      mockError.response = { status: 400, data: { message: 'Only pending requests can be approved' } };
      mockInstance.post.mockRejectedValueOnce(mockError);

      const res = await request(app).post('/api/v1/requests/1/approve');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/requests/:id/decline', () => {
    it('declines a request and returns updated data', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      const mockData = { id: 1, status: 3 };
      mockInstance.post.mockResolvedValueOnce({ data: mockData });

      const res = await request(app).post('/api/v1/requests/1/decline');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockData);
    });
  });

  describe('GET /api/v1/movie/:tmdbId', () => {
    it('returns movie details from Seerr', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      const mockData = { id: 203667, title: 'Test Movie', overview: 'A synopsis' };
      mockInstance.get.mockResolvedValueOnce({ data: mockData });

      const res = await request(app).get('/api/v1/movie/203667');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Movie');
    });
  });

  describe('GET /api/v1/tv/:tvdbId', () => {
    it('returns TV details from Seerr', async () => {
      const { app, mockInstance } = createApp({ SECRET_KEY: 'test-key' });
      const mockData = { id: 421883, name: 'Test TV Show', overview: 'A TV synopsis' };
      mockInstance.get.mockResolvedValueOnce({ data: mockData });

      const res = await request(app).get('/api/v1/tv/421883');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Test TV Show');
    });
  });

  describe('Encryption', () => {
    it('encrypts and decrypts API key correctly', () => {
      const secret = 'test-secret-key';
      const plaintext = 'my-api-key-value';
      const encrypted = encryptTestValue(plaintext, secret);
      const decrypted = decryptTestValue(encrypted, secret);
      expect(decrypted).toBe(plaintext);
    });

    it('fails to decrypt with wrong secret', () => {
      const secret = 'correct-secret';
      const wrongSecret = 'wrong-secret';
      const plaintext = 'my-api-key-value';
      const encrypted = encryptTestValue(plaintext, secret);
      expect(() => decryptTestValue(encrypted, wrongSecret)).toThrow();
    });
  });
});
