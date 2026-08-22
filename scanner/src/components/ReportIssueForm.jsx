import React, { useState } from 'react';

export default function ReportIssueForm({ onSubmit, onBack }) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');

  const isValid = date !== '' && reason.trim().length > 3;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isValid) onSubmit({ date, reason: reason.trim() });
  };

  return (
    <div className="scanner-page">
      <div className="scanner-container flex flex-col min-h-screen">
        <header className="scanner-header">
          <div className="brand-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img src="/logo.png" alt="" style={{ width: '2.25rem', height: '2.25rem', borderRadius: '0.5rem', objectFit: 'cover' }} />
            <span>Radiance</span>
          </div>
          <button onClick={onBack} className="btn-back">← Back</button>
        </header>

        <main className="hero-content fade-in" style={{ padding: '1rem 0 4rem 0' }}>
          <h2 className="font-display" style={{ fontSize: '1.75rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            Report an Issue
          </h2>
          <p className="hero-subtitle" style={{ marginBottom: '1.5rem' }}>
            Forgot to scan, or the time looks wrong? Tell us what happened — your admin will review it.
          </p>

          <form onSubmit={handleSubmit} className="form-card">
            <div className="form-group">
              <label className="form-label" htmlFor="issue-date">Which date?</label>
              <input
                id="issue-date"
                type="date"
                value={date}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDate(e.target.value)}
                required
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="issue-reason">What happened?</label>
              <textarea
                id="issue-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. I clocked in at 9am but the kiosk was offline, so it didn't record."
                required
                rows={4}
                className="form-input"
                style={{ resize: 'none', fontFamily: 'inherit' }}
              />
            </div>

            <button type="submit" disabled={!isValid} className="btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
              Continue to Face Verification
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
