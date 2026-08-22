import React, { useState } from 'react';

export default function RegistrationForm({ onSubmit, onBack }) {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    aadhaar: '',
    dob: '',
    consent: false,
  });

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

  const isValid = formData.name.length > 2 && formData.phone.length === 10 && formData.aadhaar.length === 12 && formData.dob !== '' && formData.consent;

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
          <h2 className="font-display" style={{ fontSize: '1.75rem', fontWeight: 600, marginBottom: '0.4rem' }}>
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
