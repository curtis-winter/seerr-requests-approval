import React, { useState, useEffect } from 'react';
import {
  getSettings,
  saveSettings,
  testConnection,
  type SettingsData,
  type TestConnectionResponse,
} from '../services/api';

export default function SettingsPage(): JSX.Element {
  const [seerrUrl, setSeerrUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showTmdbKey, setShowTmdbKey] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [alert, setAlert] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null
  );

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await getSettings();
      setSeerrUrl(res.data.seerrUrl || '');
      setHasKey(!!res.data.hasApiKey);
      setTmdbApiKey(res.data.tmdbApiKey || '');
    } catch (e) {
      setAlert({ type: 'error', message: 'Failed to load settings' });
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      await saveSettings({ seerrUrl, apiKey: apiKey || undefined, tmdbApiKey: tmdbApiKey || undefined });
      setHasKey(!!apiKey);
      setAlert({
        type: 'success',
        message: 'Settings saved. API key is encrypted locally.',
      });
    } catch (err) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTesting(true);
    setAlert(null);
    try {
      const res = await testConnection({
        seerrUrl,
        apiKey: apiKey || undefined,
        tmdbApiKey: tmdbApiKey || undefined,
      });
      if (res.data.success) {
        setAlert({ type: 'success', message: 'Connection successful!' });
      } else {
        setAlert({ type: 'error', message: 'Connection test failed.' });
      }
    } catch (err) {
      setAlert({
        type: 'error',
        message: err.message || 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div className="navbar">
        <div className="navbar-inner">
          <div className="brand">Seerr<span>Request</span> Approval</div>
          <div className="nav-actions">
            <a href="/" className="btn btn-ghost btn-sm">
              Back to requests
            </a>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="settings-card">
          <h2>Settings</h2>

          {alert && (
            <div className={`alert alert-${alert.type}`}>{alert.message}</div>
          )}

          <form onSubmit={handleSave}>
            <div className="form-group">
              <label htmlFor="seerr-url">Seerr URL</label>
              <input
                id="seerr-url"
                className="input"
                type="url"
                placeholder="http://10.0.0.134:5055"
                value={seerrUrl}
                onChange={(e) => setSeerrUrl(e.target.value)}
              />
              <p className="hint">The address where Seerr is hosted.</p>
            </div>

            <div className="form-group">
              <label htmlFor="seerr-api-key">Seerr API Key</label>
              <div className="key-input-wrapper">
                <input
                  id="seerr-api-key"
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  placeholder="Enter your Seerr API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowKey(!showKey)}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? '🙈' : '👁'}
                </button>
              </div>
              <p className="hint">
                Generated in Seerr under your profile. Stored encrypted at rest — never in plaintext, never on GitHub.
              </p>
              {hasKey && (
                <p className="hint" style={{ color: 'var(--approved-chip)' }}>
                  An API key is already configured. Leave blank to keep the existing key.
                </p>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="tmdb-api-key">TMDB API Key (Optional)</label>
              <div className="key-input-wrapper">
                <input
                  id="tmdb-api-key"
                  className="input"
                  type={showTmdbKey ? 'text' : 'password'}
                  placeholder="Enter your TMDB API key"
                  value={tmdbApiKey}
                  onChange={(e) => setTmdbApiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowTmdbKey(!showTmdbKey)}
                  aria-label={showTmdbKey ? 'Hide key' : 'Show key'}
                >
                  {showTmdbKey ? '🙈' : '👁'}
                </button>
              </div>
              <p className="hint">
                Optional. Used as fallback when Seerr media detail endpoints fail. Get one
                at themoviedb.org/settings/api. Enables fallback synopsis/poster/country
                data for titles that fail to load from Seerr.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
