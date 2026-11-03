import { describe, it, expect } from 'vitest';
import {
  getSettings,
  saveSettings,
  testConnection,
  getRequests,
  getRequestCounts,
  approveRequest,
  declineRequest,
  getMovieDetails,
  getTvDetails,
} from '@/services/api';

describe('API Service', () => {
  describe('function exports', () => {
    it('exports getSettings function', () => {
      expect(typeof getSettings).toBe('function');
    });

    it('exports saveSettings function', () => {
      expect(typeof saveSettings).toBe('function');
    });

    it('exports testConnection function', () => {
      expect(typeof testConnection).toBe('function');
    });

    it('exports getRequests function', () => {
      expect(typeof getRequests).toBe('function');
    });

    it('exports getRequestCounts function', () => {
      expect(typeof getRequestCounts).toBe('function');
    });

    it('exports approveRequest function', () => {
      expect(typeof approveRequest).toBe('function');
    });

    it('exports declineRequest function', () => {
      expect(typeof declineRequest).toBe('function');
    });

    it('exports getMovieDetails function', () => {
      expect(typeof getMovieDetails).toBe('function');
    });

    it('exports getTvDetails function', () => {
      expect(typeof getTvDetails).toBe('function');
    });
  });

  describe('getSettings', () => {
    it('returns a promise', async () => {
      const result = getSettings();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('saveSettings', () => {
    it('returns a promise', async () => {
      const result = saveSettings({ seerrUrl: 'http://test:5055' });
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('testConnection', () => {
    it('returns a promise', async () => {
      const result = testConnection({ seerrUrl: 'http://test:5055' });
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('approveRequest', () => {
    it('returns a promise', async () => {
      const result = approveRequest(1);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('declineRequest', () => {
    it('returns a promise', async () => {
      const result = declineRequest(1);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('getMovieDetails', () => {
    it('returns a promise', async () => {
      const result = getMovieDetails(1);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('getTvDetails', () => {
    it('returns a promise', async () => {
      const result = getTvDetails(1);
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
