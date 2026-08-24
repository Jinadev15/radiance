import React, { useState, useEffect } from 'react';
import { fetchSites, kioskSiteId } from '../utils/api';

// A site is now required to register.
//
// The previous version never collected one at all, so every self-registered
// employee saved with workLocation: null — and the backend's geofence check
// was wrapped in `if (employee.workLocation)`, so a missing site silently
// disabled the location check entirely rather than blocking anything. Every
// self-registered employee could clock in from anywhere. If this kiosk is
// bound to a site via VITE_KIOSK_SITE_ID, that site is used automatically
// and the picker is skipped — a kiosk lives at a site, it shouldn't have to
// ask.
export default function RegistrationForm({ onSubmit, onBack }) {
  const boundSiteId = kioskSiteId();

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    aadhaar: '',
    dob: '',
    workLocation: boundSiteId || '',
    consent: false,
  });
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(!boundSiteId);
  const [sitesError, setSitesError] = useState(null);

  useEffect(() => {
    if (boundSiteId) return; // no need to fetch a list if this kiosk only offers its own site
    let cancelled = false;
    fetchSites()
      .then(list => { if (!cancelled) setSites(list); })
      .catch(err => { if (!cancelled) setSitesError(err.message || 'Could not load sites'); })
      .finally(() => { if (!cancelled) setSitesLoading(false); });
    return () => { cancelled = true; };
  }, [boundSiteId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'aadhaar') {
      const numericValue = value.replace(/\D/g, '');
      if (numericValue.length <= 12) setFormData(prev => ({ ...prev, [name]: numericValue }));
    } else if (name === 'phone') {
      const numericValue = value.replace(/\D/g, '');
      if (numericValue.length <= 10) setFormData(prev => ({ ...prev, [name]: numericValue }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const isValid = formData.name.length > 2 && formData.phone.length === 10 &&
    formData.aadhaar.length === 12 && formData.dob !== '' && formData.workLocation !== '' && formData.consent;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isValid) onSubmit(formData);
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
          <h2 className="text-h2" style={{ marginBottom: '0.4rem' }}>
            Register Employee
          </h2>
          <p className="hero-subtitle" style={{ marginBottom: '1.5rem' }}>
            Enter details to register a new employee.
          </p>

          <form onSubmit={handleSubmit} className="form-card">
            <div className="form-group">
              <label className="form-label" htmlFor="reg-name">Full Name</label>
              <input
                id="reg-name"
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="e.g. Ramesh Kumar"
                required
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-phone">Phone Number</label>
              <input
                id="reg-phone"
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="e.g. 9876543210"
                required
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-aadhaar">Aadhaar Number (12 Digits)</label>
              <input
                id="reg-aadhaar"
                type="text"
                name="aadhaar"
                value={formData.aadhaar}
                onChange={handleChange}
                placeholder="e.g. 1234 5678 9012"
                required
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-dob">Date of Birth</label>
              <input
                id="reg-dob"
                type="date"
                name="dob"
                value={formData.dob}
                onChange={handleChange}
                required
                className="form-input"
              />
            </div>

            {!boundSiteId && (
              <div className="form-group">
                <label className="form-label" htmlFor="reg-site">Work Site</label>
                {sitesLoading ? (
                  <p className="hero-subtitle" style={{ margin: 0 }}>Loading sites…</p>
                ) : sitesError ? (
                  <p className="status-banner status-banner--warning" style={{ margin: 0 }}>
                    {sitesError} — please ask your supervisor for help registering.
                  </p>
                ) : sites.length === 0 ? (
                  <p className="status-banner status-banner--warning" style={{ margin: 0 }}>
                    No sites are set up yet. Please ask your supervisor to add one before registering.
                  </p>
                ) : (
                  <select
                    id="reg-site"
                    name="workLocation"
                    value={formData.workLocation}
                    onChange={handleChange}
                    required
                    className="form-input"
                  >
                    <option value="" disabled>Select your work site…</option>
                    {sites.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                  </select>
                )}
              </div>
            )}

            <label className="form-consent">
              <input
                type="checkbox"
                name="consent"
                checked={formData.consent}
                onChange={(e) => setFormData(prev => ({ ...prev, consent: e.target.checked }))}
              />
              <span>
                I consent to Radiance collecting and storing my facial biometric data and GPS location for attendance tracking purposes.
              </span>
            </label>

            <button type="submit" disabled={!isValid} className="btn-primary" style={{ width: '100%' }}>
              Proceed to Face Scan
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
