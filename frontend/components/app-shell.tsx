'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { DashboardSidebar } from './dashboard-sidebar';
import { DashboardHeader } from './dashboard-header';
import api, { ApiError } from '@/lib/api';

export interface CurrentUser {
  name: string;
  email: string;
  role: 'admin' | 'hr' | 'supervisor';
  workLocation?: { _id: string; name: string } | null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.getMe()
      .then(u => setUser(u as CurrentUser))
      .catch(err => {
        // A 401 means the session cookie is missing/expired — proxy.ts will
        // already usually catch this before the page renders, but if it
        // doesn't (cookie expired mid-session), send the user back to
        // login instead of leaving the shell stuck on "Loading…" forever.
        //
        // This must go through api.logout() (clears the cookie server-side,
        // then does a full navigation), NOT router.push('/login') directly:
        // proxy.ts redirects /login -> /dashboard whenever *any* token
        // cookie is present, without checking whether it's still valid. A
        // client-side push while the stale cookie is still sitting in the
        // browser gets bounced straight back to /dashboard by that rule,
        // which 401s again and pushes again — an infinite loop between the
        // two routes. Clearing the cookie first breaks that loop.
        if (err instanceof ApiError && err.status === 401) {
          api.logout();
          return;
        }
        setLoadError('Could not load your account. Check your connection and refresh.');
      });
  }, []);

  return (
    <div className="flex h-screen bg-background text-text-primary overflow-hidden font-sans">
      <DashboardSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} role={user?.role} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <DashboardHeader onMenuClick={() => setSidebarOpen(true)} user={user} />

        <main className="flex-1 overflow-y-auto scrollbar-hide">
          {loadError && (
            <div className="max-w-7xl mx-auto w-full px-6 pt-4">
              <div className="badge-danger rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                <AlertCircle size={15} /> {loadError}
              </div>
            </div>
          )}
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
