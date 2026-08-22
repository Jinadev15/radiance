import React, { useRef, useState, useEffect, useCallback } from 'react';

export default function FaceCapture({ onCapture, onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [location, setLocation] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let stream = null;
    let watchId = null;
    let cancelled = false; // guards against setState after this screen unmounts mid-permission-prompt

    const startCamera = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (cancelled) {
          s.getTracks().forEach(track => track.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setHasCamera(true);
        }
      } catch (err) {
        if (!cancelled) setErrorMsg('Camera access denied or unavailable. Please grant browser camera permissions.');
      }
    };

    const startGPS = () => {
      if (!('geolocation' in navigator)) {
        setLocationDenied(true);
        return;
      }
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return;
          setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setLocationDenied(false);
        },
        () => {
          // Geofencing depends on this — a silent console.warn here left
          // employees unable to tell why their clock-in was later rejected.
          if (!cancelled) setLocationDenied(true);
        },
        { enableHighAccuracy: true }
      );
    };

    startCamera();
    startGPS();

    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  const grabFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  }, []);

  // Grabs two frames ~450ms apart from the live feed (one tap, no extra
  // steps for the employee) so the backend can check for natural movement
  // between them — a static printed photo can't produce that.
  const handleCapture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || capturing) return;
    setCapturing(true);
    const first = grabFrame();
    setTimeout(() => {
      const second = grabFrame();
      setCapturing(false);
      onCapture([first, second].filter(Boolean), location);
    }, 450);
  }, [grabFrame, onCapture, location, capturing]);

  if (errorMsg) {
    return (
      <div className="camera-wrapper">
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '420px' }}>
          <h2 className="text-h2" style={{ color: 'var(--color-text-primary)', marginBottom: '1rem' }}>Camera Unavailable</h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: '2rem' }}>{errorMsg}</p>
          <button className="btn-secondary" onClick={onBack}>← Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="camera-wrapper">
      <video ref={videoRef} autoPlay playsInline muted className="camera-feed" />

      <div className="camera-overlay">
        <div className="camera-header">
          <span className="camera-header-label">Camera</span>
          <button className="btn-back" onClick={onBack}>Cancel</button>
        </div>

        {locationDenied && (
          <div className="status-banner status-banner--warning" style={{ pointerEvents: 'auto', maxWidth: '360px' }}>
            Location access is off — you may be asked to enable it to complete this scan, since your site requires being nearby.
          </div>
        )}

        <div className="reticle-box">
          <div className="reticle-corner corner-tl" />
          <div className="reticle-corner corner-tr" />
          <div className="reticle-corner corner-bl" />
          <div className="reticle-corner corner-br" />
          {hasCamera && <div className="reticle-scanline" />}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <span className="capture-hint">
            {hasCamera ? 'Align face inside the frame' : 'Waiting for camera permission…'}
          </span>
          <button
            className="capture-btn-trigger"
            onClick={handleCapture}
            disabled={!hasCamera || capturing}
            aria-label="Capture face"
            title="Capture Face"
          >
            <div className="capture-btn-inner" />
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
