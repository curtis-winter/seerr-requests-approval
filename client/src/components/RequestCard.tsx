import React, { useState, useEffect, useCallback } from 'react';
import {
  getMovieDetails,
  getTvDetails,
  approveRequest,
  declineRequest,
  saveDeclinedRequest,
  type MovieDetails,
  type TvDetails,
  type SeerrRequest,
} from '../services/api';
import { StatusChip, MediaTypeChip } from './Common';

interface RequestCardProps {
  request: SeerrRequest;
  isSelected: boolean;
  onSelect: () => void;
  onApprove: (id: number) => void;
  onDecline: (id: number) => void;
  countryFilter: string[];
  mediaTypeFilter: string;
  tmdbApiKey: string | null;
  onError: (msg: string) => void;
  onCountriesLoaded: (countries: string[]) => void;
  onMediaTypeDetected: (requestId: number, type: 'movie' | 'tv') => void;
}

// Client-side deduplication cache for media detail calls
const detailCache = new Map<
  string,
  { promise: Promise<MovieDetails | TvDetails | null>; timestamp: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedDetail(
  key: string,
  fetcher: () => Promise<MovieDetails | TvDetails | null>
) {
  const now = Date.now();
  const cached = detailCache.get(key);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = fetcher().finally(() => {
    detailCache.delete(key);
  });
  detailCache.set(key, { promise, timestamp: now });
  return promise;
}

export default function RequestCard({
  request,
  isSelected,
  onSelect,
  onApprove,
  onDecline,
  countryFilter,
  mediaTypeFilter,
  onError,
  onCountriesLoaded,
  onMediaTypeDetected,
}: RequestCardProps) {
  const [details, setDetails] = useState<MovieDetails | TvDetails | null>(null);
  const [mediaType, setMediaType] = useState<'movie' | 'tv' | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [detailsError, setDetailsError] = useState(false);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const media = request.media || {};
  const tmdbId = media.tmdbId;
  const tvdbId = media.tvdbId;

  // Synchronous media type detection from request object
  const detectedMediaType = useCallback((): 'movie' | 'tv' => {
    return tvdbId ? 'tv' : 'movie';
  }, [tvdbId]);

  // Report detected media type to parent immediately (sync)
  useEffect(() => {
    onMediaTypeDetected(request.id, detectedMediaType());
  }, [request.id, detectedMediaType, onMediaTypeDetected]);

  const fetchDetails = useCallback(async () => {
    setLoadingDetails(true);
    setDetailsError(false);
    const type = detectedMediaType();
    setMediaType(type);

    const tryFetch = async (
      label: 'movie' | 'tv',
      id: number | string | undefined
    ) => {
      if (!id) return null;
      try {
        const res = await (label === 'movie' ? getMovieDetails(id, tmdbApiKey) : getTvDetails(id, tmdbApiKey));
        setDetails(res.data as MovieDetails | TvDetails);
        return res.data as MovieDetails | TvDetails;
      } catch (e) {
        return null;
      }
    };

    let fetchedDetails: MovieDetails | TvDetails | null = null;
    if (type === 'tv') {
      fetchedDetails = await tryFetch('tv', tmdbId ?? tvdbId);
      if (!fetchedDetails && tmdbId) {
        fetchedDetails = await tryFetch('movie', tmdbId);
      }
    } else {
      fetchedDetails = await tryFetch('movie', tmdbId);
      if (!fetchedDetails && tvdbId) {
        fetchedDetails = await tryFetch('tv', tvdbId);
      }
    }

    const fetched = !!fetchedDetails;
    if (!fetched) setDetailsError(true);
    setLoadingDetails(false);

    // Report countries to parent for the checkbox filter
    const countries =
      fetchedDetails?.productionCountries?.map(
        (c) => c.name || c.iso_3166_1 || ''
      ) ||
      fetchedDetails?.originCountry ||
      [];
    onCountriesLoaded(countries);
  }, [detectedMediaType, tmdbId, tvdbId, onCountriesLoaded]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const isMovie = mediaType === 'movie';
  const title = isMovie
    ? details?.title ||
      details?.originalTitle ||
      media.title ||
      request.title ||
      `ID #${request.id}`
    : details?.name ||
      details?.originalName ||
      media.name ||
      `ID #${request.id}`;
  const synopsis = (details as MovieDetails | TvDetails)?.overview || null;
  const posterPath = media.posterPath || (details as MovieDetails | TvDetails)?.posterPath;
  const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w300${posterPath}` : null;
  const countries =
    (details as MovieDetails | TvDetails)?.productionCountries?.map(
      (c) => c.name || c.iso_3166_1 || ''
    ) ||
    (details as MovieDetails | TvDetails)?.originCountry ||
    [];
  const countryLabel = countries.length ? countries.join(', ') : '—';
  const requestedBy = request.requestedBy;
  const requestedByName = requestedBy
    ? requestedBy.username || requestedBy.email || 'User'
    : '—';
  const requestedAt = request.createdAt
    ? new Date(request.createdAt).toLocaleDateString()
    : '—';

  // Season details for TV shows
  const seasons = request.seasons || [];
  const seasonNumbers = seasons.map((s) => s.seasonNumber).sort((a, b) => a - b);
  const seasonLabel = seasonNumbers.length
    ? seasonNumbers.length === 1
      ? `Season ${seasonNumbers[0]}`
      : `Seasons ${seasonNumbers[0]}–${seasonNumbers[seasonNumbers.length - 1]}`
    : '—';

  // Client-side media type filter
  const matchesMediaType =
    mediaTypeFilter === 'all' || mediaType === null || mediaType === mediaTypeFilter;

  // Country filter
  const matchesCountry =
    countryFilter.length === 0 ||
    countries.some((c) => countryFilter.includes(c));
  const showCard = loadingDetails || detailsError || (matchesMediaType && matchesCountry);

  const handleApprove = async () => {
    setActionLoading((p) => ({ ...p, [request.id]: true }));
    setActionError(null);
    // Optimistic removal: tell parent immediately
    onApprove(request.id);
    try {
      await approveRequest(request.id);
    } catch (e) {
      const msg =
        e.response?.data?.message ||
        e.response?.data?.error ||
        e.message ||
        'Approve failed';
      setActionError(msg);
      onError(msg);
    } finally {
      setActionLoading((p) => {
        const n = { ...p };
        delete n[request.id];
        return n;
      });
    }
  };

  const handleDecline = async () => {
    setActionLoading((p) => ({ ...p, [request.id]: true }));
    setActionError(null);
    // Optimistic removal: tell parent immediately
    onDecline(request.id);
    // Save to local storage for declined filter (in case Seerr doesn't return it)
    saveDeclinedRequest(request);
    try {
      await declineRequest(request.id);
    } catch (e) {
      const msg =
        e.response?.data?.message ||
        e.response?.data?.error ||
        e.message ||
        'Decline failed';
      setActionError(msg);
      onError(msg);
    } finally {
      setActionLoading((p) => {
        const n = { ...p };
        delete n[request.id];
        return n;
      });
    }
  };

  const statusVariant =
    request.status === 1
      ? 'badge-pending'
      : request.status === 2
      ? 'badge-approved'
      : request.status === 3
      ? 'badge-declined'
      : 'badge-unknown';
  const statusLabel =
    request.status === 1
      ? 'Pending'
      : request.status === 2
      ? 'Approved'
      : request.status === 3
      ? 'Declined'
      : 'Unknown';

  if (!showCard) return null;

  return (
    <article className="card with-actions">
      <div className="select-row">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          aria-label={`Select ${title}`}
          disabled={
            !(matchesMediaType && matchesCountry) && !loadingDetails && !detailsError
          }
        />
        <div className="card-body">
          <div className="poster-col">
            {posterUrl ? (
              <img className="poster" src={posterUrl} alt="" loading="lazy" />
            ) : (
              <div className="poster-placeholder" />
            )}
          </div>
          <div className="info-col">
            <div className="chips-row">
              {mediaType && <MediaTypeChip mediaType={mediaType} />}
              <StatusChip status={request.status} />
            </div>
            <div className="title">{title}</div>
            <div className="request-meta">
              <span>Requested by {requestedByName}</span>
              <span>{requestedAt}</span>
              <span>{countryLabel}</span>
            </div>
            {!isMovie && seasons.length > 0 && (
              <div className="request-meta">
                <span style={{ fontWeight: 600 }}>Seasons:</span>
                <span>{seasonLabel}</span>
              </div>
            )}
            {detailsError && (
              <div className="action-error">
                Details unavailable for this title
              </div>
            )}
            {synopsis && (
              <>
                <p className="synopsis">
                  {synopsisExpanded ? synopsis : synopsis.slice(0, 200)}{synopsis.length > 200 && !synopsisExpanded ? '…' : ''}
                </p>
                {synopsis.length > 200 && (
                  <button
                    className="synopsis-toggle"
                    onClick={() => setSynopsisExpanded((v) => !v)}
                  >
                    {synopsisExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            )}
            {actionError && <div className="action-error">{actionError}</div>}
          </div>
          <div className="card-actions">
            <button
              className="btn btn-success btn-sm"
              onClick={handleApprove}
              disabled={actionLoading[request.id] || request.status === 2}
            >
              {actionLoading[request.id] ? '…' : 'Approve'}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={handleDecline}
              disabled={actionLoading[request.id] || request.status === 3}
            >
              {actionLoading[request.id] ? '…' : 'Decline'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
