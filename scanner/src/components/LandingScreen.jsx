import React from 'react';

export default function LandingScreen({ onExistingUser, onNewUser }) {
  return (
    <div className="scanner-page">
      <div className="scanner-container flex flex-col min-h-screen">
        <header className="scanner-header">
          <div className="brand-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img src="/logo.png" alt="" style={{ width: '2.25rem', height: '2.25rem', borderRadius: '0.5rem', objectFit: 'cover' }} />
            <span>Radiance</span>
          </div>
        </header>

        <main className="hero-content fade-in">
          <h1 className="hero-title">Welcome</h1>
          <p className="hero-subtitle">Select an option below to proceed</p>

          <div className="hero-actions">
            <button className="btn-primary" onClick={onExistingUser}>
              Clock In / Out
            </button>
            <button className="btn-secondary" onClick={onNewUser}>
              New Employee
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
