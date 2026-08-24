import React from 'react';

// Shown when this tablet has not been provisioned as a kiosk.
//
// Deliberately gives an outsider nothing: no site list, no employee data, no
// hint about what a valid token looks like. Someone who simply finds the
// public scanner URL lands here and can go no further. The installer setting
// up a real tablet already has the link.
export default function DeviceSetupScreen() {
  return (
    <div className="scanner-page">
      <div className="scanner-container flex flex-col min-h-screen">
        <header className="scanner-header">
          <div className="brand-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img src="/logo.png" alt="" style={{ width: '2.25rem', height: '2.25rem', borderRadius: '0.5rem', objectFit: 'cover' }} />
            <span>Radiance</span>
          </div>
        </header>

        <main className="hero-content fade-in" style={{ textAlign: 'center', paddingTop: '3rem' }}>
          <h2 className="text-h2" style={{ marginBottom: '0.75rem' }}>
            This device isn&apos;t set up yet
          </h2>
          <p className="hero-subtitle" style={{ maxWidth: '30rem', margin: '0 auto' }}>
            Attendance scanning is only available on tablets registered by Radiance.
            Please ask your supervisor or administrator to set this device up.
          </p>
        </main>
      </div>
    </div>
  );
}
