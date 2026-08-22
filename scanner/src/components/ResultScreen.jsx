import React, { useEffect, useState } from 'react';

export default function ResultScreen({ result, error, actionType, onReset }) {
  const [countdown, setCountdown] = useState(5);
  const isSuccess = result?.success;

  useEffect(() => {
    if (isSuccess) {
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            onReset();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isSuccess, onReset]);

  if (!isSuccess) {
    return (
      <div className="scanner-page">
        <div className="scanner-container flex flex-col min-h-screen">
          <main className="hero-content fade-in" style={{ flex: 1 }}>
            <div className="result-badge result-badge--danger">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>

            <h2 className="text-h2" style={{ color: 'var(--color-danger)', marginBottom: '1rem' }}>
              Verification Failed
            </h2>

            <p className="hero-subtitle" style={{ maxWidth: '480px' }}>
              {error || 'Identity verification failed. Please align your face in good lighting and try again.'}
            </p>

            <button className="btn-primary" onClick={onReset}>Try Again</button>
          </main>
        </div>
      </div>
    );
  }

  const data = result?.data || {};
  const isQueued = Boolean(data.queued);
  const name = data.name || data.employeeName || 'Employee';
  let message = data.message || '';

  if (!message) {
    if (actionType === 'clock-in') message = 'Clocked In Successfully';
    else if (actionType === 'clock-out') message = `Clocked Out${data.totalHours ? ` • ${data.totalHours} hours` : ''}`;
    else if (actionType === 'register') message = 'Registration Complete';
  }

  const badgeClass = isQueued ? 'result-badge--warning' : 'result-badge--verify';
  const messageColor = isQueued ? 'var(--color-warning)' : 'var(--color-verify)';

  return (
    <div className="scanner-page">
      <div className="scanner-container flex flex-col min-h-screen">
        <main className="hero-content fade-in" style={{ flex: 1 }}>
          <div className={`result-badge ${badgeClass}`}>
            {isQueued ? (
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            ) : (
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>

          <h2 className="text-h1-hero" style={{ marginBottom: '0.5rem' }}>
            {isQueued ? 'Saved — Pending Sync' : name}
          </h2>

          <p style={{ fontSize: '1.15rem', color: messageColor, fontWeight: 600, marginBottom: '0.5rem' }}>
            {message}
          </p>

          <p className="text-mono" style={{ fontSize: '0.85rem', color: 'var(--color-text-tertiary)', marginBottom: '2.5rem' }}>
            {new Date().toLocaleString()}
          </p>

          {actionType === 'register' && (
            <div className="form-card" style={{ padding: '1.25rem', marginBottom: '2rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                Profile registered successfully.
              </p>
            </div>
          )}

          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', marginBottom: '1.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Returning home in {countdown}s…
          </p>

          <button className="btn-secondary" onClick={onReset}>Return Now</button>
        </main>
      </div>
    </div>
  );
}
