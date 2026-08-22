'use client';

import React, { useState, useEffect } from 'react';
import { Clock, Plus, Edit, Trash2, Loader2, X, Check, Moon, Sun, Users2 } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

interface Shift {
  _id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  crossesMidnight: boolean;
}

interface Site { _id: string; name: string; }

const emptyForm = { name: '', startTime: '09:00', endTime: '17:00', graceMinutes: '10' };

export default function ShiftsPage() {
  const { toast } = useToast();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Shift | null>(null);

  const [bulkShift, setBulkShift] = useState('');
  const [bulkSite, setBulkSite] = useState('');
  const [bulkStatus, setBulkStatus] = useState<{ type: 'IDLE' | 'LOADING' | 'DONE' | 'ERROR'; msg: string }>({ type: 'IDLE', msg: '' });

  const fetchData = async () => {
    try {
      const [shiftList, siteList] = await Promise.all([api.getShifts(), api.getLocations()]);
      setShifts(shiftList);
      setSites(siteList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shifts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const resetForm = () => { setForm(emptyForm); setShowForm(false); setEditingId(null); };

  const handleEdit = (shift: Shift) => {
    setForm({ name: shift.name, startTime: shift.startTime, endTime: shift.endTime, graceMinutes: String(shift.graceMinutes) });
    setEditingId(shift._id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { name: form.name, startTime: form.startTime, endTime: form.endTime, graceMinutes: parseInt(form.graceMinutes, 10) };
      if (editingId) await api.updateShift(editingId, payload);
      else await api.createShift(payload);
      resetForm();
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save shift');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.deactivateShift(deactivateTarget._id);
      toast({ title: `"${deactivateTarget.name}" deactivated` });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to deactivate shift', description: err instanceof Error ? err.message : undefined });
    } finally {
      setDeactivateTarget(null);
    }
  };

  const handleBulkAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkShift || !bulkSite) return;
    setBulkStatus({ type: 'LOADING', msg: '' });
    try {
      const result = await api.bulkAssignShift({ shiftTemplate: bulkShift, workLocation: bulkSite });
      setBulkStatus({ type: 'DONE', msg: `Assigned to ${result.updated} of ${result.matched} employee(s) at that site.` });
    } catch (err) {
      setBulkStatus({ type: 'ERROR', msg: err instanceof Error ? err.message : 'Bulk assignment failed' });
    }
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-accent" />
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary text-display">Shifts</h1>
          <p className="text-text-secondary">{shifts.length} shift template{shifts.length !== 1 ? 's' : ''} — night shifts crossing midnight are handled automatically</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent font-medium rounded-lg text-sm transition-colors">
            <Plus size={16} /> New Shift
          </button>
        )}
      </div>

      {error && <div className="bg-danger-muted border border-danger-border rounded-xl p-4"><p className="text-danger text-sm">{error}</p></div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="surface rounded-xl p-6 space-y-5 animate-enter-up">
          <div className="flex items-center justify-between">
            <h2 className="text-text-primary font-semibold flex items-center gap-2">
              <Clock size={18} className="text-accent" /> {editingId ? 'Edit Shift' : 'New Shift'}
            </h2>
            <button type="button" onClick={resetForm} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="shift-name" className="text-sm font-medium text-text-secondary">Shift Name</label>
              <input id="shift-name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Security Night Shift" className="input-base w-full mt-1 p-3" />
            </div>
            <div>
              <label htmlFor="shift-start" className="text-sm font-medium text-text-secondary">Start Time</label>
              <input id="shift-start" required type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="input-base w-full mt-1 p-3" />
            </div>
            <div>
              <label htmlFor="shift-end" className="text-sm font-medium text-text-secondary">End Time</label>
              <input id="shift-end" required type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                className="input-base w-full mt-1 p-3" />
            </div>
            <div>
              <label htmlFor="shift-grace" className="text-sm font-medium text-text-secondary">Grace Period (minutes)</label>
              <input id="shift-grace" required type="number" min={0} max={120} value={form.graceMinutes} onChange={e => setForm(f => ({ ...f, graceMinutes: e.target.value }))}
                className="input-base w-full mt-1 p-3 text-mono" />
            </div>
          </div>
          {form.endTime < form.startTime && (
            <p className="text-xs text-accent flex items-center gap-1.5"><Moon size={12} /> End time is earlier than start — this will be treated as an overnight shift.</p>
          )}
          <div className="flex gap-3">
            <button disabled={saving} type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-accent/90 hover:bg-accent text-on-accent font-medium rounded-lg text-sm transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {editingId ? 'Save Changes' : 'Create Shift'}
            </button>
            <button type="button" onClick={resetForm} className="px-5 py-2.5 bg-surface-elevated text-text-secondary border border-border rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shifts.length === 0 && !showForm ? (
          <div className="col-span-full surface rounded-xl p-12 text-center text-text-tertiary">No shift templates yet.</div>
        ) : shifts.map(shift => (
          <div key={shift._id} className="surface rounded-xl p-5 space-y-3 hover:border-accent-border transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent-muted border border-accent-border flex items-center justify-center flex-none">
                  {shift.crossesMidnight ? <Moon size={16} className="text-accent" /> : <Sun size={16} className="text-accent" />}
                </div>
                <div>
                  <h3 className="text-text-primary font-semibold text-sm">{shift.name}</h3>
                  <p className="text-text-tertiary text-xs text-mono mt-0.5">
                    {shift.startTime}–{shift.endTime}{shift.crossesMidnight ? ' (+1 day)' : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-1 flex-none">
                <button onClick={() => handleEdit(shift)} aria-label={`Edit ${shift.name}`} className="p-1.5 text-text-tertiary hover:text-accent hover:bg-accent-muted rounded transition-colors" title="Edit"><Edit size={14} /></button>
                <button onClick={() => setDeactivateTarget(shift)} aria-label={`Deactivate ${shift.name}`} className="p-1.5 text-text-tertiary hover:text-danger hover:bg-danger-muted rounded transition-colors" title="Deactivate"><Trash2 size={14} /></button>
              </div>
            </div>
            <p className="text-xs text-text-tertiary">{shift.graceMinutes} min grace period before marked late</p>
          </div>
        ))}
      </div>

      <div className="surface rounded-xl p-6 space-y-4">
        <h2 className="text-text-primary font-semibold flex items-center gap-2"><Users2 size={18} className="text-accent" /> Bulk Assign by Site</h2>
        <p className="text-text-secondary text-sm">Assign one shift to every active employee at a site in one action — useful when a client site changes its operating hours.</p>
        <form onSubmit={handleBulkAssign} className="flex flex-col sm:flex-row gap-3">
          <label htmlFor="bulk-site" className="sr-only">Site</label>
          <select id="bulk-site" required value={bulkSite} onChange={e => setBulkSite(e.target.value)} className="input-base p-3 flex-1">
            <option value="">Select a site…</option>
            {sites.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
          <label htmlFor="bulk-shift" className="sr-only">Shift</label>
          <select id="bulk-shift" required value={bulkShift} onChange={e => setBulkShift(e.target.value)} className="input-base p-3 flex-1">
            <option value="">Select a shift…</option>
            {shifts.map(s => <option key={s._id} value={s._id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
          </select>
          <button disabled={bulkStatus.type === 'LOADING'} type="submit"
            className="flex items-center justify-center gap-2 px-5 py-3 bg-accent/90 hover:bg-accent text-on-accent font-medium rounded-lg text-sm transition-colors disabled:opacity-50 whitespace-nowrap">
            {bulkStatus.type === 'LOADING' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Assign to Site
          </button>
        </form>
        {bulkStatus.type === 'DONE' && <p className="text-xs text-success">{bulkStatus.msg}</p>}
        {bulkStatus.type === 'ERROR' && <p className="text-xs text-danger">{bulkStatus.msg}</p>}
      </div>

      <AlertDialog open={!!deactivateTarget} onOpenChange={open => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate &quot;{deactivateTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Employees currently on it keep it assigned, but it won&apos;t appear in new selections.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className={buttonVariants({ variant: 'destructive' })}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
