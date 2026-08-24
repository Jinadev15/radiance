'use client';

import React, { useState, useEffect } from 'react';
import { CalendarOff, Check, X, Loader2, Plus } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import type { LeaveRequest, LeaveType, Employee } from '@/lib/types';

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  CASUAL: 'Casual', SICK: 'Sick', UNPAID: 'Unpaid', COMP_OFF: 'Comp Off', MATERNITY: 'Maternity', OTHER: 'Other',
};

const emptyForm = { employeeId: '', leaveType: 'CASUAL' as LeaveType, fromDate: '', toDate: '', reason: '' };

export default function LeavePage() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [data, me] = await Promise.all([
        api.getLeaveRequests(filter === 'PENDING' ? 'PENDING' : undefined),
        api.getMe(),
      ]);
      setRequests(data);
      // Approve/Reject and logging leave directly are admin/hr actions on
      // the backend (requireAdminOrHr) — supervisors can see this page (it's
      // useful to know who's off at their site) but the controls are hidden
      // for them rather than shown and then rejected by the server.
      setCanReview(me.role === 'admin' || me.role === 'hr');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leave requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filter]);

  useEffect(() => {
    if (!showForm || employees.length > 0) return;
    api.getEmployees().then(setEmployees).catch(() => {});
  }, [showForm, employees.length]);

  const handleReview = async (id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) => {
    setProcessingId(id);
    try {
      await api.reviewLeaveRequest(id, status, reviewNote);
      toast({ title: status === 'APPROVED' ? 'Leave approved' : 'Leave rejected' });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to update request', description: err instanceof Error ? err.message : undefined });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeId || !form.fromDate || !form.toDate || !form.reason.trim()) return;
    if (form.toDate < form.fromDate) {
      toast({ variant: 'destructive', title: 'To date cannot be before the from date.' });
      return;
    }
    setSaving(true);
    try {
      await api.createLeaveForEmployee(form);
      toast({ title: 'Leave recorded and approved' });
      setForm(emptyForm);
      setShowForm(false);
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to record leave', description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const statusColor: Record<string, string> = {
    PENDING: 'badge-warning', APPROVED: 'badge-success', REJECTED: 'badge-danger', CANCELLED: 'bg-surface-elevated text-text-tertiary border border-border',
  };

  const dayCount = (from: string, to: string) => {
    const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
    return days === 1 ? '1 day' : `${days} days`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary text-display">Leave</h1>
          <p className="text-text-secondary">Approved leave is excluded from the "absent" count on the dashboard and daily digest.</p>
        </div>
        {canReview && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} /> Log Leave
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="surface rounded-xl p-5 space-y-4">
          <p className="text-sm text-text-secondary">Recorded here is approved immediately — use this for leave phoned or told to HR directly, not routed through the kiosk.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="leave-employee" className="text-xs font-medium text-text-secondary">Employee</label>
              <select id="leave-employee" required value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} className="input-base w-full mt-1 p-2 text-sm">
                <option value="" disabled>Select an employee…</option>
                {employees.map(e => <option key={e._id} value={e._id}>{e.name} ({e.employeeId})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="leave-type" className="text-xs font-medium text-text-secondary">Leave Type</label>
              <select id="leave-type" value={form.leaveType} onChange={e => setForm(f => ({ ...f, leaveType: e.target.value as LeaveType }))} className="input-base w-full mt-1 p-2 text-sm">
                {(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map(t => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="leave-from" className="text-xs font-medium text-text-secondary">From</label>
              <input id="leave-from" type="date" required value={form.fromDate} onChange={e => setForm(f => ({ ...f, fromDate: e.target.value }))} className="input-base w-full mt-1 p-2 text-sm" />
            </div>
            <div>
              <label htmlFor="leave-to" className="text-xs font-medium text-text-secondary">To</label>
              <input id="leave-to" type="date" required value={form.toDate} onChange={e => setForm(f => ({ ...f, toDate: e.target.value }))} className="input-base w-full mt-1 p-2 text-sm" />
            </div>
          </div>
          <div>
            <label htmlFor="leave-reason" className="text-xs font-medium text-text-secondary">Reason</label>
            <input id="leave-reason" type="text" required value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="input-base w-full mt-1 p-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & Approve'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-surface-elevated text-text-secondary border border-border rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="flex gap-2">
        <button onClick={() => setFilter('PENDING')} className={`px-3 py-1.5 rounded-lg text-sm ${filter === 'PENDING' ? 'bg-accent-muted text-accent border border-accent-border' : 'bg-surface-elevated text-text-secondary border border-border'}`}>Pending</button>
        <button onClick={() => setFilter('ALL')} className={`px-3 py-1.5 rounded-lg text-sm ${filter === 'ALL' ? 'bg-accent-muted text-accent border border-accent-border' : 'bg-surface-elevated text-text-secondary border border-border'}`}>All</button>
      </div>

      {error && <div className="badge-danger rounded-xl p-4"><p className="text-sm">{error}</p></div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-accent" /></div>
      ) : requests.length === 0 ? (
        <div className="surface rounded-xl p-12 text-center text-text-tertiary">
          <CalendarOff size={28} className="mx-auto mb-3 opacity-50" />
          Nothing to review right now.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <div key={req._id} className="surface rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-text-primary font-medium text-sm">{req.employee?.name || 'Unknown'}</span>
                    <span className="text-text-tertiary text-mono text-xs">{req.employee?.employeeId}</span>
                    <span className="badge-accent px-2 py-0.5 rounded-full text-xs font-medium">{LEAVE_TYPE_LABEL[req.leaveType]}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[req.status]}`}>{req.status}</span>
                    {req.source === 'DASHBOARD' && <span className="text-text-tertiary text-xs">· logged by HR</span>}
                  </div>
                  <p className="text-text-secondary text-sm mb-1">{req.reason}</p>
                  <div className="flex items-center gap-3 text-xs text-text-tertiary">
                    <span className="text-mono">{req.fromDate} → {req.toDate}</span>
                    <span>({dayCount(req.fromDate, req.toDate)})</span>
                  </div>
                </div>
                {canReview && req.status === 'PENDING' && (
                  <div className="flex gap-2 flex-none">
                    <button
                      onClick={() => handleReview(req._id, 'APPROVED')}
                      disabled={processingId === req._id}
                      className="flex items-center gap-1.5 px-3 py-1.5 badge-success rounded-lg text-xs font-medium disabled:opacity-50"
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      onClick={() => setRejectTarget(req)}
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

      <AlertDialog open={!!rejectTarget} onOpenChange={open => { if (!open) { setRejectTarget(null); setRejectNote(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject {rejectTarget?.employee?.name || 'this'}&apos;s leave request?</AlertDialogTitle>
            <AlertDialogDescription>They requested {rejectTarget?.leaveType.toLowerCase()} leave from {rejectTarget?.fromDate} to {rejectTarget?.toDate}: &quot;{rejectTarget?.reason}&quot;</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <label htmlFor="leave-reject-note" className="text-xs font-medium text-text-secondary">Note (optional)</label>
            <input id="leave-reject-note" type="text" value={rejectNote} onChange={e => setRejectNote(e.target.value)} className="input-base w-full mt-1 p-2 text-sm" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (rejectTarget) handleReview(rejectTarget._id, 'REJECTED', rejectNote || undefined); setRejectTarget(null); setRejectNote(''); }}
              className={buttonVariants({ variant: 'destructive' })}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
