'use client';

import React from 'react';
import { Users, UserCheck, Gauge, AlarmClockOff } from 'lucide-react';

interface StatsProps {
  loading: boolean;
  stats: {
    totalEmployees: number;
    presentToday: number;
    absent: number;
    onTime: number;
    late: number;
  };
}

export function DashboardStats({ loading, stats }: StatsProps) {
  const attendanceRate = stats.totalEmployees > 0
    ? ((stats.presentToday / stats.totalEmployees) * 100).toFixed(1)
    : '0.0';

  const cards = [
    { label: 'Total Employees', value: stats.totalEmployees, icon: Users, badge: 'Workforce', badgeClass: 'badge-accent' },
    { label: 'Present Today', value: stats.presentToday, icon: UserCheck, badge: 'Live', badgeClass: 'badge-verify' },
    { label: 'Attendance Rate', value: `${attendanceRate}%`, icon: Gauge, badge: 'Today', badgeClass: 'badge-accent' },
    {
      label: 'Late Arrivals', value: stats.late, icon: AlarmClockOff,
      badge: stats.late > 0 ? 'Action Needed' : 'On Track',
      badgeClass: stats.late > 0 ? 'badge-warning' : 'badge-success',
    },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="surface rounded-xl p-5 h-[116px] animate-pulse">
            <div className="h-4 w-24 bg-surface-elevated rounded mb-4"></div>
            <div className="h-8 w-16 bg-surface-elevated rounded mb-2"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, i) => (
        <div key={i} className="surface rounded-xl p-5 hover:border-accent-border transition-colors">
          <div className="flex justify-between items-start mb-2">
            <p className="text-sm text-text-secondary font-medium">{card.label}</p>
            <card.icon size={16} className="text-text-tertiary" />
          </div>
          <h3 className="text-3xl font-semibold text-text-primary tabular-nums tracking-tight text-mono">
            {card.value}
          </h3>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${card.badgeClass}`}>
              {card.badge}
            </span>
            <span className="text-text-tertiary">Real-time</span>
          </div>
        </div>
      ))}
    </div>
  );
}
