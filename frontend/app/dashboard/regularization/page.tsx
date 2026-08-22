'use client';

import React, { useState, useEffect } from 'react';
import { ClipboardEdit, Check, X, Loader2, Clock } from 'lucide-react';
import api from '@/lib/api';

interface RegRequest {
  _id: string;
  employee: { name: string; employeeId: string } | null;
  date: string;
  reason: string;
  requestedClockIn?: string;
  requestedClockOut?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy?: { name: string } | null;
  createdAt: string;
}

export default function RegularizationPage() {
  const [requests, setRequests] = useState<RegRequest[]>([]);
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await api.getRegularizationRequests(filter === 'PENDING' ? 'PENDING' : undefined);
      setRequests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filter]);

  const handleReview = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setProcessingId(id);
    try {
      await api.reviewRegularizationRequest(id, status);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update request');
    } finally {
      setProcessingId(null);
    }
  };

  const statusColor: Record<string, string> = { PENDING: 'badge-warning', APPROVED: 'badge-success', REJECTED: 'badge-danger' };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary text-display">Regularization Requests</h1>
          <p className="text-text-secondary">Employee-reported missed or incorrect scans, filed from the kiosk</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFilter('PENDING')} className={`px-3 py-1.5 rounded-lg text-sm ${filter === 'PENDING' ? 'bg-accent-muted text-accent border border-accent-border' : 'bg-surface-elevated text-text-secondary border border-border'}`}>Pending</button>
          <button onClick={() => setFilter('ALL')} className={`px-3 py-1.5 rounded-lg text-sm ${filter === 'ALL' ? 'bg-accent-muted text-accent border border-accent-border' : 'bg-surface-elevated text-text-secondary border border-border'}`}>All</button>
        </div>
      </div>

      {error && <div className="bg-danger-muted border border-danger-border rounded-xl p-4"><p className="text-danger text-sm">{error}</p></div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-accent" /></div>
      ) : requests.length === 0 ? (
        <div className="surface rounded-xl p-12 text-center text-text-tertiary">
          <ClipboardEdit size={28} className="mx-auto mb-3 opacity-50" />
          Nothing to review right now.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <div key={req._id} className="surface rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-text-primary font-medium text-sm">{req.employee?.name || 'Unknown'}</span>
                    <span className="text-text-tertiary text-mono text-xs">{req.employee?.employeeId}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[req.status]}`}>{req.status}</span>
                  </div>
                  <p className="text-text-secondary text-sm mb-1">{req.reason}</p>
                  <div className="flex items-center gap-3 text-xs text-text-tertiary">
                    <span>Disputed date: <span className="text-mono">{req.date}</span></span>
                    {req.requestedClockIn && <span className="flex items-center gap-1"><Clock size={11} /> In: {req.requestedClockIn}</span>}
                    {req.requestedClockOut && <span className="flex items-center gap-1"><Clock size={11} /> Out: {req.requestedClockOut}</span>}
                  </div>
                </div>
                {req.status === 'PENDING' && (
                  <div className="flex gap-2 flex-none">
                    <button
                      onClick={() => handleReview(req._id, 'APPROVED')}
                      disabled={processingId === req._id}
                      className="flex items-center gap-1.5 px-3 py-1.5 badge-success rounded-lg text-xs font-medium disabled:opacity-50"
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      onClick={() => handleReview(req._id, 'REJECTED')}
                      disabled={processingId === req._id}
                      className="flex items-center gap-1.5 px-3 py-1.5 badge-danger rounded-lg text-xs font-medium disabled:opacity-50"
                    >
                      <X size={13} /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-tertiary">
        Approving a request doesn't change the attendance record automatically — correct the actual clock-in/out time from the Attendance page after approving.
      </p>
    </div>
  );
}
