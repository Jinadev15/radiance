'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Menu, Search, Send, User, LogOut, Sun, Moon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import api from '@/lib/api';
import type { CurrentUser } from './app-shell';

const KIOSK_URL = process.env.NEXT_PUBLIC_KIOSK_URL || 'http://localhost:3001';

export function DashboardHeader({ onMenuClick, user }: { onMenuClick: () => void, user?: CurrentUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Avoid a hydration mismatch: resolvedTheme is only meaningful client-side.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleLogout = () => {
    api.logout();
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/dashboard/employees?q=${encodeURIComponent(q)}`);
  };

  const pathParts = pathname.split('/').filter(Boolean);
  const currentPage = pathParts.length > 1
    ? pathParts[pathParts.length - 1].charAt(0).toUpperCase() + pathParts[pathParts.length - 1].slice(1)
    : 'Dashboard';

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-background border-b border-border text-text-secondary">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 rounded-md hover:bg-surface-elevated text-text-tertiary transition-colors"
        >
          <Menu size={20} />
        </button>

        <div className="flex items-center gap-2 text-sm font-medium">
          <div className="hidden sm:flex items-center gap-2 text-text-tertiary">
            <span>Radiance</span>
            <span className="text-border">/</span>
          </div>
          <span className="text-text-primary">{currentPage}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {/* Search — jumps to the Employees page filtered by name/ID */}
        <form onSubmit={handleSearch} className="hidden md:flex items-center bg-surface border border-border rounded-lg px-3 py-1.5 text-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted transition-colors">
          <label htmlFor="global-search" className="sr-only">Search employees</label>
          <Search size={14} className="text-text-tertiary mr-2" />
          <input
            ref={searchRef}
            id="global-search"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search employees…"
            className="bg-transparent border-none outline-none text-text-primary placeholder-text-tertiary w-48"
          />
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[10px] bg-surface-elevated text-text-tertiary px-1.5 py-0.5 rounded border border-border">⌘</span>
            <span className="text-[10px] bg-surface-elevated text-text-tertiary px-1.5 py-0.5 rounded border border-border">K</span>
          </div>
        </form>

        {/* Actions */}
        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href={KIOSK_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Launch Scanner Kiosk App"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-elevated hover:bg-accent-muted border border-border hover:border-accent-border text-xs text-accent font-medium rounded-lg transition-colors"
          >
            <Send size={13} />
            <span className="hidden sm:inline">Launch Kiosk</span>
          </a>
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label={mounted && resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={mounted && resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-2 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
          >
            {mounted && resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <div className="w-px h-6 bg-border mx-1"></div>

        {/* User Profile */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-surface-elevated border border-border flex items-center justify-center">
            <User size={16} className="text-text-secondary" />
          </div>
          <span className="text-xs font-medium text-text-secondary hidden sm:inline">
            {user ? user.name : 'Loading…'}
            {user && user.role !== 'admin' && (
              <span className="ml-1.5 text-text-tertiary capitalize">({user.role}{user.workLocation ? ` · ${user.workLocation.name}` : ''})</span>
            )}
          </span>
          <button
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
            className="p-2 rounded-md hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
