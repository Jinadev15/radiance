import React from 'react';

export default function ActionChoice({ onChoice, onBack }) {
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

        <main className="hero-content fade-in" style={{ padding: '2rem 0' }}>
          <h2 className="font-display" style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Select Action
          </h2>

          <div className="action-cards-grid" style={{ marginTop: '2.5rem' }}>
            <button className="action-card" onClick={() => onChoice('clock-in')} style={{ textAlign: 'center', padding: '3rem 2rem' }}>
              <h3 className="action-card-title" style={{ fontSize: '1.75rem' }}>Clock In</h3>
              <p className="action-card-desc">Record start of shift</p>
            </button>

            <button className="action-card" onClick={() => onChoice('clock-out')} style={{ textAlign: 'center', padding: '3rem 2rem' }}>
              <h3 className="action-card-title" style={{ fontSize: '1.75rem' }}>Clock Out</h3>
              <p className="action-card-desc">Record end of shift</p>
            </button>
          </div>

          <div className="action-cards-grid" style={{ marginTop: '1.25rem' }}>
            <button className="action-card" onClick={() => onChoice('my-attendance')} style={{ textAlign: 'center', padding: '1.75rem 1.5rem' }}>
              <h3 className="action-card-title" style={{ fontSize: '1.15rem' }}>My Attendance</h3>
              <p className="action-card-desc">See your last 7 days</p>
            </button>

            <button className="action-card" onClick={() => onChoice('report-issue')} style={{ textAlign: 'center', padding: '1.75rem 1.5rem' }}>
              <h3 className="action-card-title" style={{ fontSize: '1.15rem' }}>Report an Issue</h3>
              <p className="action-card-desc">Missed or incorrect scan</p>
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
