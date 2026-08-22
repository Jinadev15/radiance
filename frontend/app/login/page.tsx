'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LogIn, AlertCircle } from 'lucide-react';
import api from '@/lib/api';

// Only redirect to a path proxy.ts itself would have sent the user *from*
// — never trust `next` as an arbitrary destination. It's a query param
// anyone can hand-craft, so even though proxy.ts only ever writes a bare
// pathname into it, this still guards against `?next=//evil.com` or
// similar protocol-relative tricks landing here directly.
function safeNextPath(value: string | null): string {
  if (value && value.startsWith('/dashboard') && !value.startsWith('//')) return value;
  return '/dashboard';
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login(email, password);
      router.push(safeNextPath(searchParams.get('next')));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="Radiance" className="w-12 h-12 rounded-lg object-cover mb-4" />
          <h1 className="text-2xl text-display font-semibold text-text-primary">Radiance</h1>
          <p className="text-text-secondary text-sm mt-1">Sign in to the attendance dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="surface rounded-lg p-6 space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium text-text-secondary">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-base w-full mt-1 p-3"
              placeholder="you@radiance.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-medium text-text-secondary">Password</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input-base w-full mt-1 p-3"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="badge-danger p-3 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent/90 hover:bg-accent text-on-accent font-medium p-3 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
