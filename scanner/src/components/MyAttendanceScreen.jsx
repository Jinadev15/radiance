import React from 'react';
import { STATUS_LABEL, STATUS_COLOR_VAR } from '../utils/status';

export default function MyAttendanceScreen({ result, error, onReset }) {
  if (error || !result?.success) {
    return (
      <div className="scanner-page">
        <div className="scanner-container flex flex-col min-h-screen">
          <main className="hero-content fade-in" style={{ flex: 1 }}>
            <h2 className="font-display" style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--color-danger)', marginBottom: '1rem' }}>
              Couldn&apos;t Look Up Your Attendance
            </h2>
            <p className="hero-subtitle" style={{ maxWidth: '480px' }}>
              {error || 'Please try again.'}
            </p>
            <button className="btn-primary" onClick={onReset}>Try Again</button>
          </main>
        </div>
      </div>
    );
  }

  const records = result.records || [];

  return (
    <div className="scanner-page">
      <div className="scanner-container flex flex-col min-h-screen">
        <main className="hero-content fade-in" style={{ padding: '2rem 0 4rem 0', width: '100%' }}>
          <h2 className="font-display" style={{ fontSize: '1.75rem', fontWeight: 600, marginBottom: '0.25rem' }}>
            {result.employeeName}
          </h2>
          <p className="hero-subtitle text-mono" style={{ marginBottom: '2rem' }}>
            Last 7 days — {result.employeeId}
          </p>

          <div className="form-card" style={{ width: '100%', maxWidth: '520px', textAlign: 'left', padding: '0.5rem' }}>
            {records.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>No records in the last 7 days.</p>
            ) : records.map((r) => (
              <div key={r.date} className="attendance-row">
                <div>
                  <p style={{ fontWeight: 500, fontSize: '0.95rem' }}>{r.date}</p>
                  <p className="text-mono" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8rem', marginTop: '0.15rem' }}>
                    {r.clockInTime ? new Date(r.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–'}
                    {' → '}
                    {r.clockOutTime ? new Date(r.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–'}
                    {r.totalHours ? ` · ${r.totalHours}h` : ''}
                  </p>
                </div>
                <span className="text-mono" style={{ color: STATUS_COLOR_VAR[r.status] || 'var(--color-text-tertiary)', fontSize: '0.8rem', fontWeight: 600 }}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
              </div>
            ))}
          </div>

          <button className="btn-secondary" onClick={onReset} style={{ marginTop: '2rem' }}>
            Return Home
          </button>
        </main>
      </div>
    </div>
  );
}
