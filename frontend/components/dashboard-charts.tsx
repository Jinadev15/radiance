'use client';

import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';
import api from '@/lib/api';

interface TrendPoint { date: string; present: number; onTime: number; late: number; }

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="surface-elevated p-3 rounded-lg text-sm">
        <p className="font-medium text-text-primary mb-2 text-mono">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-text-secondary capitalize">{entry.name}:</span>
            <span className="font-semibold text-text-primary tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

function formatDay(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

export function DashboardCharts() {
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.getTrend(7)
      .then(setTrend)
      .catch(() => setError(true));
  }, []);

  const data = (trend || []).map(t => ({ name: formatDay(t.date), present: t.present, onTime: t.onTime, late: t.late }));
  const hasAnyData = data.some(d => d.present > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="surface rounded-xl p-5">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-base font-medium text-display text-text-primary">Daily Attendance</h3>
            <p className="text-sm text-text-tertiary mt-1">Last 7 days</p>
          </div>
          <div className="badge-verify px-2 py-1 rounded-md text-xs font-medium">Live</div>
        </div>
        {error ? (
          <ChartError />
        ) : !trend ? (
          <ChartLoading />
        ) : !hasAnyData ? (
          <ChartEmpty />
        ) : (
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-subtle)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-tertiary)', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-tertiary)', fontSize: 12 }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-border-subtle)', opacity: 0.5 }} />
                <Bar dataKey="present" name="Present" fill="var(--color-accent)" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="surface rounded-xl p-5">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-base font-medium text-display text-text-primary">On-Time vs Late</h3>
            <p className="text-sm text-text-tertiary mt-1">Trend analysis</p>
          </div>
          <div className="badge-accent px-2 py-1 rounded-md text-xs font-medium">7-day trend</div>
        </div>
        {error ? (
          <ChartError />
        ) : !trend ? (
          <ChartLoading />
        ) : !hasAnyData ? (
          <ChartEmpty />
        ) : (
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-subtle)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-tertiary)', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-tertiary)', fontSize: 12 }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-text-secondary)' }} />
                <Line type="monotone" dataKey="onTime" name="On Time" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="late" name="Late" stroke="var(--color-warning)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartLoading() {
  return <div className="h-[240px] flex items-center justify-center text-text-tertiary text-sm animate-pulse">Loading trend…</div>;
}

function ChartEmpty() {
  return (
    <div className="h-[240px] flex flex-col items-center justify-center text-center border border-dashed border-border rounded-lg">
      <p className="text-sm text-text-secondary font-medium">No attendance recorded yet</p>
      <p className="text-xs text-text-tertiary mt-1">This fills in as employees clock in over the coming days</p>
    </div>
  );
}

function ChartError() {
  return (
    <div className="h-[240px] flex items-center justify-center text-danger text-sm">Couldn&apos;t load trend data.</div>
  );
}
