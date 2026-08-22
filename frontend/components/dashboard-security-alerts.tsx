'use client';

import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import api from '@/lib/api';

interface SpoofAttempt {
  _id: string;
  targetedEmployee: { name: string; employeeId: string } | null;
  workLocation: { name: string } | null;
  action: 'CLOCK_IN' | 'CLOCK_OUT';
  livenessDetails: string;
  createdAt: string;
}

export function DashboardSecurityAlerts() {
  const [attempts, setAttempts] = useState<SpoofAttempt[]>([]);

  useEffect(() => {
    api.getSpoofAttempts(5).then(setAttempts).catch(() => {});
  }, []);

  if (attempts.length === 0) return null;

  return (
    <div className="bg-surface border border-danger-border rounded-lg p-4 animate-enter-up">
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert size={16} className="text-danger" />
        <h3 className="text-sm font-semibold text-text-primary">Liveness Failures — Possible Spoof Attempts</h3>
        <span className="badge-danger px-2 py-0.5 rounded-full text-xs font-medium text-mono ml-auto">{attempts.length} recent</span>
      </div>
      <div className="space-y-2">
        {attempts.map(a => (
          <div key={a._id} className="flex items-center justify-between text-sm py-1.5 border-b border-border-subtle last:border-0">
            <div className="flex items-center gap-2">
              <span className="text-text-primary font-medium">{a.targetedEmployee?.name || 'Unknown identity'}</span>
              <span className="text-text-tertiary text-mono text-xs">{a.targetedEmployee?.employeeId}</span>
              {a.workLocation && <span className="text-text-tertiary text-xs">· {a.workLocation.name}</span>}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-text-tertiary">{a.livenessDetails}</span>
              <span className="text-text-tertiary text-mono">{new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
