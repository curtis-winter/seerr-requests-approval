import axios, { AxiosInstance } from 'axios';

const api: AxiosInstance = axios.create({ baseURL: '' });

// ---------- Settings ----------
export const getSettings = () => api.get('/api/v1/settings');
export const saveSettings = (payload: { seerrUrl: string; apiKey?: string; tmdbApiKey?: string }) =>
  api.post('/api/v1/settings', payload);
export const testConnection = (payload: {
  seerrUrl: string;
  apiKey?: string;
  tmdbApiKey?: string;
}) => api.post('/api/v1/test-connection', payload);

// ---------- Requests ----------
export const getRequests = (params?: Record<string, string | number>) =>
  api.get('/api/v1/requests', { params });
export const getRequestCounts = () => api.get('/api/v1/requests/count');
export const approveRequest = (id: number | string) =>
  api.post(`/api/v1/requests/${id}/approve`);
export const declineRequest = (id: number | string) =>
  api.post(`/api/v1/requests/${id}/decline`);

// ---------- Media details (for synopsis) ----------
// Seerr endpoints first, with TMDB fallback
export const getMovieDetails = async (tmdbId: number | string, tmdbApiKey?: string) => {
  try {
    const res = await api.get(`/api/v1/movie/${tmdbId}`);
    return res.data;
  } catch (e) {
    // Fallback to TMDB API directly
    if (tmdbApiKey) {
      const tmdbRes = await axios.get(
        `https://api.themoviedb.org/3/movie/${tmdbId}`,
        { params: { api_key: tmdbApiKey } }
      );
      return mapTmdbMovieToSeerrFormat(tmdbRes.data);
    }
    throw e;
  }
};

export const getTvDetails = async (tvdbId: number | string, tmdbApiKey?: string) => {
  try {
    const res = await api.get(`/api/v1/tv/${tvdbId}`);
    return res.data;
  } catch (e) {
    // Fallback to TMDB API directly
    if (tmdbApiKey) {
      const tmdbRes = await axios.get(
        `https://api.themoviedb.org/3/tv/${tvdbId}`,
        { params: { api_key: tmdbApiKey } }
      );
      return mapTmdbTvToSeerrFormat(tmdbRes.data);
    }
    throw e;
  }
};

// ---------- Types ----------
export interface SeerrUser {
  id: number;
  username?: string | null;
  email?: string | null;
  plexUsername?: string | null;
  jellyfinUsername?: string | null;
}

export interface SeerrSeason {
  id: number;
  seasonNumber: number;
  status: number; // 1 = pending, 2 = approved, 3 = declined
  createdAt: string;
  updatedAt: string;
}

export interface SeerrMedia {
  id: number;
  tmdbId?: number | null;
  tvdbId?: number | null;
  mediaType?: string;
  title?: string | null;
  name?: string | null;
  posterPath?: string | null;
  originalTitle?: string | null;
  originalName?: string | null;
  overview?: string | null;
  productionCountries?: Array<{ iso_3166_1?: string | null; name?: string | null }>;
  originCountry?: Array<string>;
}

export interface SeerrRequest {
  id: number;
  status: number; // 1 = pending, 2 = approved, 3 = declined
  createdAt: string;
  updatedAt: string;
  media: SeerrMedia;
  requestedBy: SeerrUser;
  mediaType?: string;
  title?: string;
  seasons: SeerrSeason[];
  seasonCount?: number;
}

export interface SeerrRequestCounts {
  total: number;
  movie: number;
  tv: number;
  pending: number;
  approved: number;
  declined: number;
  processing: number;
  available: number;
  completed: number;
}

export interface SeerrPageInfo {
  page: number;
  pages: number;
  results: number;
}

export interface SeerrRequestResponse {
  pageInfo: SeerrPageInfo;
  results: SeerrRequest[];
}

export interface MovieDetails {
  id: number;
  title: string;
  originalTitle?: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  productionCountries: Array<{ iso_3166_1: string; name: string }>;
  releaseDate: string;
}

export interface TvDetails {
  id: number;
  name: string;
  originalName?: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  originCountry: string[];
  firstAirDate: string;
  seasons?: Array<{
    season_number: number;
    name: string;
    air_date: string;
    episode_count: number;
    poster_path: string | null;
  }>;
}

// ---------- TMDB fallback mappers ----------
function mapTmdbMovieToSeerrFormat(data: any): MovieDetails {
  return {
    id: data.id,
    title: data.title,
    originalTitle: data.original_title,
    overview: data.overview || null,
    posterPath: data.poster_path || null,
    backdropPath: data.backdrop_path || null,
    productionCountries: (data.production_countries || []).map((c: any) => ({
      iso_3166_1: c.iso_3166_1,
      name: c.name,
    })),
    releaseDate: data.release_date,
  };
}

function mapTmdbTvToSeerrFormat(data: any): TvDetails {
  return {
    id: data.id,
    name: data.name,
    originalName: data.original_name,
    overview: data.overview || null,
    posterPath: data.poster_path || null,
    backdropPath: data.backdrop_path || null,
    originCountry: data.origin_country || [],
    firstAirDate: data.first_air_date,
    seasons: (data.seasons || []).map((s: any) => ({
      season_number: s.season_number,
      name: s.name,
      air_date: s.air_date,
      episode_count: s.episode_count,
      poster_path: s.poster_path || null,
    })),
  };
}

// ---------- Local storage for declined requests (fallback when Seerr doesn't return them) ----------
const DECLINED_STORAGE_KEY = 'seerr-declined-requests';

export const getDeclinedRequests = (): SeerrRequest[] => {
  try {
    const raw = localStorage.getItem(DECLINED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveDeclinedRequest = (request: SeerrRequest) => {
  try {
    const existing = getDeclinedRequests();
    const exists = existing.some((r) => r.id === request.id);
    if (!exists) {
      existing.push(request);
      localStorage.setItem(DECLINED_STORAGE_KEY, JSON.stringify(existing));
    }
  } catch {
    // Silently fail if localStorage is unavailable
  }
};

export const removeDeclinedRequest = (id: number) => {
  try {
    const existing = getDeclinedRequests();
    const filtered = existing.filter((r) => r.id !== id);
    localStorage.setItem(DECLINED_STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // Silently fail
  }
};

export const getAllDeclinedRequests = (): SeerrRequest[] => {
  return getDeclinedRequests();
};