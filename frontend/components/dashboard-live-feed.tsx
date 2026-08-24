'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, AlertCircle, Clock, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import type { AttendanceLog } from '@/lib/types';

export function DashboardLiveFeed() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against out-of-order responses: the 10s poll can overlap with a
  // manual "Sync" click or a slow response arriving after a faster later
  // one, and without this the stale response's data could overwrite fresher
  // data that already rendered.
  const requestSeq = useRef(0);

  const fetchTodayLogs = async () => {
    const seq = ++requestSeq.current;
    try {
      const data = await api.getTodayAttendance();
      if (seq !== requestSeq.current) return; // a newer request already resolved
      setLogs(data || []);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      // Previously swallowed entirely — the feed just quietly stopped
      // updating with no indication anything had failed.
      setError(err instanceof Error ? err.message : 'Failed to load live feed');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchTodayLogs();
    const interval = setInterval(fetchTodayLogs, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="surface rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-verify animate-subtle-pulse" />
          <h3 className="text-base font-medium text-display text-text-primary">Live Attendance Stream</h3>
        </div>
        <button
          onClick={fetchTodayLogs}
          className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded-md transition-colors text-xs flex items-center gap-1 border border-border"
          aria-label="Refresh live feed"
          title="Refresh Live Feed"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          <span>Sync</span>
        </button>
      </div>

      {error ? (
        <div className="badge-danger rounded-lg p-3 text-sm flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      ) : logs.length === 0 ? (
        <div className="py-8 text-center border border-dashed border-border rounded-lg">
          <Clock size={24} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-sm text-text-secondary font-medium">No clock-ins recorded today</p>
          <p className="text-xs text-text-tertiary mt-1">Live scans from kiosk will appear here instantly</p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
          {logs.map((log) => (
            <div key={log._id} className="flex items-center justify-between p-3 bg-background border border-border-subtle rounded-lg hover:border-border transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent-muted border border-accent-border text-accent flex items-center justify-center font-semibold text-sm text-display">
                  {log.employee?.name ? log.employee.name.charAt(0) : 'E'}
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">{log.employee?.name || 'Employee'}</p>
                  <p className="text-xs text-text-tertiary flex items-center gap-1">
                    <span className="text-mono text-accent">{log.employee?.employeeId || '–'}</span>
                    <span>•</span>
                    <span className="text-mono">{new Date(log.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {log.employee?.status === 'PENDING_APPROVAL' && (
                  <span className="badge-warning inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium" title="Recorded normally — this employee just hasn't been approved by HR yet">
                    Pending Approval
                  </span>
                )}
                <span className="badge-verify inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium">
                  <ShieldCheck size={11} />
                  Liveness Verified
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
