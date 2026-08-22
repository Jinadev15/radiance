'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { DashboardStats } from './dashboard-stats';
import { DashboardCharts } from './dashboard-charts';
import { DashboardLiveFeed } from './dashboard-live-feed';
import { DashboardSecurityAlerts } from './dashboard-security-alerts';
import api from '@/lib/api';

const EMPTY_STATS = { totalEmployees: 0, presentToday: 0, absent: 0, onTime: 0, late: 0 };

export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState(EMPTY_STATS);

  const fetchData = () => {
    let mounted = true;
    setError(null);
    api.getStats()
      .then(data => { if (mounted) { setStats(data); setLoading(false); } })
      .catch(err => {
        if (!mounted) return;
        // A genuinely empty account and a failed request should not look
        // the same — zeroing the stats silently on error was indistinguishable
        // from "0 employees registered." Surface the failure instead.
        setError(err instanceof Error ? err.message : 'Failed to load dashboard stats.');
        setStats(EMPTY_STATS);
        setLoading(false);
      });
    return () => { mounted = false; };
  };

  useEffect(fetchData, []);

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="badge-danger rounded-xl p-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm"><AlertCircle size={16} /> {error}</span>
          <button onClick={() => { setLoading(true); fetchData(); }} className="flex items-center gap-1.5 text-xs font-medium hover:underline">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}
      <DashboardStats loading={loading} stats={stats} />
      <DashboardSecurityAlerts />
      <div className="grid grid-cols-1 gap-6">
        <DashboardLiveFeed />
        <DashboardCharts />
      </div>
    </div>
  );
}
