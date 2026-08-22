import React, { useEffect, useState } from 'react';

// Honest indeterminate state: the previous version animated three steps to
// fixed "done" checkmarks on a timer that had nothing to do with the actual
// request — a slow network left it stuck on "Recording" looking complete-ish
// forever, and a fast response cut the animation off mid-sequence. There's
// no real per-step signal from the backend to drive discrete steps off, so
// this just cycles honest, non-committal status copy until App.jsx swaps
// the screen once the real response comes back.
const MESSAGES = [
  'Verifying your identity…',
  'This takes just a moment…',
  'Confirming with the server…',
];

export default function ProcessingScreen() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(i => (i + 1) % MESSAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="scanner-page">
      <div className="scanner-container flex flex-col min-h-screen">
        <main className="hero-content fade-in" style={{ flex: 1 }}>
          <div className="processing-spinner" role="status" aria-label="Processing" />
          <h2 className="font-display" style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Processing
          </h2>
          <p className="processing-message" aria-live="polite">{MESSAGES[messageIndex]}</p>
        </main>
      </div>
    </div>
  );
}
