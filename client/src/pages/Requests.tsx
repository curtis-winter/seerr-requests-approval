import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getRequests,
  getRequestCounts,
  approveRequest,
  declineRequest,
  getDeclinedRequests,
  saveDeclinedRequest,
  type SeerrRequest,
  type SeerrRequestCounts,
} from '../services/api';
import RequestCard from '../components/RequestCard';

const STATUS_LABELS: Record<string, string> = {
  all: 'All',
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  fully_declined: 'Fully Declined',
  partially_declined: 'Partially Declined',
};
const TAKE = 500;

interface RequestsPageProps {}

export default function RequestsPage(): JSX.Element {
  const [requests, setRequests] = useState<SeerrRequest[]>([]);
  const [counts, setCounts] = useState<SeerrRequestCounts>({
    total: 0,
    movie: 0,
    tv: 0,
    pending: 0,
    approved: 0,
    declined: 0,
    processing: 0,
    available: 0,
    completed: 0,
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<string>('pending');
  const [mediaType, setMediaType] = useState<string>('all');
  const [requestedBy, setRequestedBy] = useState<string>('');
  const [countryFilter, setCountryFilter] = useState<Set<string>>(new Set());
  const [allCountries, setAllCountries] = useState<Set<string>>(new Set());
  const [tmdbApiKey, setTmdbApiKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usersMap = useMemo(() => {
    const map = new Map<number, { id: number; username?: string | null; email?: string | null }>();
    requests.forEach((r) => {
      const u = r.requestedBy;
      if (u && u.id) map.set(u.id, u);
    });
    return map;
  }, [requests]);

  const skip = page * TAKE;

  // Synchronous media type detection from request object
  const getRequestMediaType = useCallback((r: SeerrRequest): 'movie' | 'tv' => {
    return r.media?.tvdbId ? 'tv' : 'movie';
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { take: String(TAKE), skip: String(skip) };
      // Only pass standard Seerr filter values; custom declined filters are handled client-side
      if (['all', 'pending', 'approved'].includes(filter)) {
        params.filter = filter;
      }
      if (mediaType !== 'all') params.mediaType = mediaType;
      if (requestedBy) params.requestedBy = requestedBy;
      const [reqRes, countRes, settingsRes] = await Promise.all([
        getRequests(params),
        getRequestCounts(),
        getSettings(),
      ]);
      setRequests(reqRes.data.results || []);
      setTmdbApiKey(settingsRes.data.tmdbApiKey || null);
      const pageInfo = reqRes.data.pageInfo || {};
      setCounts({
        ...(countRes.data || {}),
        total: pageInfo.results ?? countRes.data?.total ?? 0,
        pages: pageInfo.pages ?? 1,
      });
    } catch (e) {
      setError(e.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [filter, mediaType, requestedBy, skip]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const timer = setInterval(fetchData, 30000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const totalPages = Math.max(1, counts.pages ?? 1);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visible = filteredRequests();
    if (selected.size === visible.length && visible.length > 0) {
      setSelected(new Set()); // deselect all
    } else {
      setSelected(new Set(visible.map((r) => r.id))); // select all visible
    }
  };

  const isSelected = (id: number) => selected.has(id);

  const handleBulkAction = async (action: 'approve' | 'decline') => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setActionLoadingBulk(true);
    try {
      await Promise.all(
        ids.map((id) => (action === 'approve' ? approveRequest(id) : declineRequest(id)))
      );
      setSelected(new Set());
      await fetchData();
    } catch (e) {
      setError(e.message || `Bulk ${action} failed`);
    } finally {
      setActionLoadingBulk(false);
    }
  };

  const handleItemAction = async (id: number, action: 'approve' | 'decline') => {
    // Optimistic removal: immediately remove from displayed list
    const removedRequest = requests.find((r) => r.id === id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    try {
      if (action === 'approve') await approveRequest(id);
      else await declineRequest(id);
      await fetchData();
    } catch (e) {
      // Restore removed item on failure
      if (removedRequest) {
        setRequests((prev) => [...prev, removedRequest]);
      }
      setError(e.message || `Item ${action} failed`);
    }
  };

  const handleCountriesLoaded = useCallback((countries: string[]) => {
    if (!countries || countries.length === 0) return;
    setAllCountries((prev) => {
      const next = new Set(prev);
      countries.forEach((c) => next.add(c));
      return next;
    });
  }, []);

  const statusCount = (key: keyof SeerrRequestCounts) => counts[key] ?? 0;
  const start = skip + 1;
  const end = Math.min(skip + requests.length, counts.total ?? 0);

  const isCountrySelected = (country: string) => countryFilter.has(country);

  const toggleCountry = (country: string) => {
    const next = new Set(countryFilter);
    if (next.has(country)) next.delete(country);
    else next.add(country);
    setCountryFilter(next);
    setPage(0);
  };

  const filteredRequests = useCallback(() => {
    // Combine server requests with locally stored declined requests
    const localDeclined = getDeclinedRequests();
    const allRequests = [...requests, ...localDeclined];

    return allRequests.filter((r) => {
      const reqMediaType = getRequestMediaType(r);

      // Media type filter
      if (mediaType !== 'all' && reqMediaType !== mediaType) {
        return false;
      }

      // Status filter
      if (filter === 'declined') {
        if (reqMediaType === 'movie') {
          return r.status === 3;
        } else {
          // TV: all seasons must be declined
          const seasons = r.seasons || [];
          return seasons.length > 0 && seasons.every((s) => s.status === 3);
        }
      } else if (filter === 'fully_declined') {
        if (reqMediaType !== 'tv') return false;
        const seasons = r.seasons || [];
        return seasons.length > 0 && seasons.every((s) => s.status === 3);
      } else if (filter === 'partially_declined') {
        if (reqMediaType !== 'tv') return false;
        const seasons = r.seasons || [];
        const declinedCount = seasons.filter((s) => s.status === 3).length;
        return seasons.length > 0 && declinedCount > 0 && declinedCount < seasons.length;
      } else if (filter === 'pending') {
        if (reqMediaType === 'movie') {
          return r.status === 1;
        } else {
          const seasons = r.seasons || [];
          return seasons.length > 0 && seasons.every((s) => s.status === 1);
        }
      } else if (filter === 'approved') {
        if (reqMediaType === 'movie') {
          return r.status === 2;
        } else {
          const seasons = r.seasons || [];
          return seasons.length > 0 && seasons.every((s) => s.status === 2);
        }
      }

      return true;
    });
  }, [requests, mediaType, filter, getRequestMediaType]);

  const [bulkLoading, setActionLoadingBulk] = useState(false);
  const [itemLoading, setActionLoadingItem] = useState<Record<number, boolean>>({});

  return (
    <div>
      <div className="navbar">
        <div className="navbar-inner">
          <div className="brand">Seerr<span>Request</span> Approval</div>
          <div className="nav-actions">
            <a href="/settings" className="btn btn-ghost btn-sm">
              Settings
            </a>
          </div>
        </div>
      </div>

      <div className="container">
        {error && <div className="alert alert-error">{error}</div>}

        <div className="stats">
          <div className="stat">
            <div className="stat-label">Pending</div>
            <div className="stat-value">{statusCount('pending')}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Approved</div>
            <div className="stat-value">{statusCount('approved')}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Declined</div>
            <div className="stat-value">{statusCount('declined')}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total</div>
            <div className="stat-value">{statusCount('total')}</div>
          </div>
        </div>

        <div className="filters">
          <div className="filter-group">
            <label>Status</label>
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Type</label>
            <select
              value={mediaType}
              onChange={(e) => {
                setMediaType(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All</option>
              <option value="movie">Movie</option>
              <option value="tv">TV</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Requested by</label>
            <select
              value={requestedBy}
              onChange={(e) => {
                setRequestedBy(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All users</option>
              {[...usersMap.values()].map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.username || u.email || 'User'}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group country-filter">
            <label>Country</label>
            <div className="country-checkboxes">
              {allCountries.size > 0 ? (
                [...allCountries].sort().map((country) => (
                  <label key={country} className="country-checkbox">
                    <input
                      type="checkbox"
                      checked={isCountrySelected(country)}
                      onChange={() => toggleCountry(country)}
                    />
                    {country}
                  </label>
                ))
              ) : loading ? (
                <span
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  Discovering countries…
                </span>
              ) : (
                <span
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  No countries discovered yet
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="select-actions">
          <label
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={
                filteredRequests().length > 0 &&
                selected.size === filteredRequests().length
              }
              onChange={toggleSelectAll}
            />{' '}
            Select all ({selected.size})
          </label>
          {selected.size > 0 && (
            <>
              <button
                className="btn btn-success btn-sm"
                onClick={() => handleBulkAction('approve')}
                disabled={bulkLoading}
              >
                Approve selected
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleBulkAction('decline')}
                disabled={bulkLoading}
              >
                Decline selected
              </button>
            </>
          )}
        </div>

        <div className="requests-list">
          {loading && requests.length === 0 && (
            <div className="empty">
              <h3>Loading requests…</h3>
            </div>
          )}
          {!loading && filteredRequests().length === 0 && (
            <div className="empty">
              <h3>No requests found</h3>
            </div>
          )}
          {filteredRequests().map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              isSelected={isSelected(request.id)}
              onSelect={() => toggleSelect(request.id)}
              onApprove={(id) => handleItemAction(id, 'approve')}
              onDecline={(id) => handleItemAction(id, 'decline')}
              countryFilter={Array.from(countryFilter)}
              mediaTypeFilter={mediaType}
              tmdbApiKey={tmdbApiKey}
              onError={(msg) => setError(msg)}
              onCountriesLoaded={handleCountriesLoaded}
              onMediaTypeDetected={(requestId, type) => {
                // Media type detected - could be used for additional filtering
              }}
            />
          ))}
        </div>

        {filteredRequests().length > 0 && (
          <div className="pagination">
            <span className="pagination-info">
              Showing {filteredRequests().length} items on this page
            </span>
            <div className="pagination-controls">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Prev
              </button>
              <span className="pagination-page">
                Page {page + 1} of {totalPages}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={page >= totalPages - 1 || requests.length < TAKE}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
