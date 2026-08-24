'use client';

import React, { useState, useEffect } from 'react';
import { History, Loader2, ChevronLeft, ChevronRight, ShieldOff } from 'lucide-react';
import api, { ApiError } from '@/lib/api';
import type { AuditEntry } from '@/lib/types';

// Human-readable labels for the stable action slugs written by
// backend/utils/audit.js — "attendance.manual_correction" reads as a data
// key, "Attendance Manually Corrected" reads as a sentence.
function actionLabel(action: string) {
  return action
    .split('.')
    .join(' ')
    .split('_')
    .join(' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(v: Record<string, unknown> | null): string {
  if (!v) return '–';
  const entries = Object.entries(v).filter(([, val]) => val !== null && val !== undefined);
  if (entries.length === 0) return '–';
  return entries.map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`).join(', ');
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await api.getAuditLog({ page, limit: 50 });
      setEntries(result.entries);
      setPages(result.pagination.pages);
      setTotal(result.pagination.total);
      setError(null);
    } catch (err) {
      // The backend restricts this to admins — a wider view than HR or a
      // supervisor needs, since it spans every employee and every user
      // account, not just one site.
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof Error ? err.message : 'Failed to load the audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [page]);

  if (forbidden) {
    return (
      <div className="p-6">
        <div className="surface rounded-xl p-12 text-center text-text-tertiary">
          <ShieldOff size={28} className="mx-auto mb-3 opacity-50" />
          <p className="text-text-secondary">The audit log is visible to admins only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary text-display">Audit Log</h1>
        <p className="text-text-secondary">Every attendance correction, approval, and account change, attributed to who made it — read-only.</p>
      </div>

      {error && <div className="badge-danger rounded-xl p-4"><p className="text-sm">{error}</p></div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-accent" /></div>
      ) : entries.length === 0 ? (
        <div className="surface rounded-xl p-12 text-center text-text-tertiary">
          <History size={28} className="mx-auto mb-3 opacity-50" />
          No activity recorded yet.
        </div>
      ) : (
        <>
          <div className="surface rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-border">
                  {['When', 'Action', 'By', 'Target', 'Changed', 'Reason'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-text-tertiary uppercase tracking-wider">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-border-subtle">
                  {entries.map(entry => (
                    <tr key={entry._id} className="hover:bg-surface-elevated transition-colors align-top">
                      <td className="px-4 py-3 text-text-secondary text-mono text-xs whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-text-primary text-sm font-medium whitespace-nowrap">{actionLabel(entry.action)}</td>
                      <td className="px-4 py-3 text-text-secondary text-sm">
                        {entry.actorName || 'System'}
                        {entry.actorRole && <span className="text-text-tertiary text-xs"> ({entry.actorRole})</span>}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-sm">{entry.targetLabel || '–'}</td>
                      <td className="px-4 py-3 text-text-tertiary text-xs max-w-xs">
                        {entry.before && <div>Before: {formatValue(entry.before)}</div>}
                        {entry.after && <div>After: {formatValue(entry.after)}</div>}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs max-w-xs">{entry.reason || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-text-secondary">
            <span>{total} total entries · page {page} of {pages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-xs disabled:opacity-40"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="flex items-center gap-1 px-3 py-1.5 bg-surface-elevated border border-border rounded-lg text-xs disabled:opacity-40"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
