'use client';

import React, { useState } from 'react';
import { Download, BarChart3, Calendar } from 'lucide-react';
import api from '@/lib/api';

export default function ReportsPage() {
  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await api.exportAttendance(startDate, endDate, `attendance_${startDate}_to_${endDate}.csv`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl text-display text-text-primary">Reports & Export</h1>
        <p className="text-text-secondary">Export attendance data for payroll processing</p>
      </div>

      <div className="surface rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={20} className="text-accent" />
          <h2 className="text-text-primary font-semibold">Attendance Export</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-text-secondary">Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="input-base mt-1 w-full px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm text-text-secondary">End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="input-base mt-1 w-full px-3 py-2 text-sm" />
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 px-6 py-3 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Download size={16} /> {exporting ? 'Preparing…' : 'Download CSV Report'}
        </button>
        {error && <p className="text-xs text-danger">{error}</p>}
        <p className="text-xs text-text-tertiary">The CSV file includes: Employee ID, Name, Phone, Date, Clock In, Clock Out, Total Hours, Status, and Face Recognition Confidence.</p>
      </div>
    </div>
  );
}
