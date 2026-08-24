'use client';

import React, { useState, useEffect } from 'react';
import { CalendarDays, Plus, Trash2, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import type { Holiday, Site } from '@/lib/types';

const emptyForm = { date: '', name: '', workLocations: [] as string[], isPaid: true };

export default function HolidaysPage() {
  const { toast } = useToast();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [h, s] = await Promise.all([api.getHolidays(year), api.getLocations()]);
      setHolidays(h);
      setSites(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load holidays');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [year]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.date || !form.name.trim()) return;
    setSaving(true);
    try {
      await api.createHoliday(form);
      toast({ title: 'Holiday added' });
      setForm(emptyForm);
      setShowForm(false);
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to add holiday', description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteHoliday(deleteTarget._id);
      toast({ title: 'Holiday removed' });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to remove holiday', description: err instanceof Error ? err.message : undefined });
    } finally {
      setDeleteTarget(null);
    }
  };

  const toggleSite = (id: string) => {
    setForm(f => ({
      ...f,
      workLocations: f.workLocations.includes(id) ? f.workLocations.filter(s => s !== id) : [...f.workLocations, id],
    }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary text-display">Holidays</h1>
          <p className="text-text-secondary">Employees expected at a site on a holiday there are excluded from "absent" — the whole workforce won&apos;t show as missing on Diwali.</p>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="holiday-year" className="sr-only">Year</label>
          <select id="holiday-year" value={year} onChange={e => setYear(Number(e.target.value))} className="input-base px-3 py-2 text-sm">
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} /> Add Holiday
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="surface rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="holiday-date" className="text-xs font-medium text-text-secondary">Date</label>
              <input id="holiday-date" type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input-base w-full mt-1 p-2 text-sm" />
            </div>
            <div>
              <label htmlFor="holiday-name" className="text-xs font-medium text-text-secondary">Name</label>
              <input id="holiday-name" type="text" required placeholder="e.g. Diwali" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input-base w-full mt-1 p-2 text-sm" />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">Applies to</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, workLocations: [] }))}
                className={`px-3 py-1.5 rounded-lg text-xs border ${form.workLocations.length === 0 ? 'bg-accent-muted text-accent border-accent-border' : 'bg-surface-elevated text-text-secondary border-border'}`}
              >
                All sites
              </button>
              {sites.map(s => (
                <button
                  key={s._id}
                  type="button"
                  onClick={() => toggleSite(s._id)}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${form.workLocations.includes(s._id) ? 'bg-accent-muted text-accent border-accent-border' : 'bg-surface-elevated text-text-secondary border-border'}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-tertiary mt-1">
              {form.workLocations.length === 0 ? 'Leave none selected for a company-wide holiday.' : `Applies only to ${form.workLocations.length} selected site(s) — client sites don't always close together.`}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={form.isPaid} onChange={e => setForm(f => ({ ...f, isPaid: e.target.checked }))} className="accent-accent" />
            Paid holiday
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Holiday'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-surface-elevated text-text-secondary border border-border rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      {error && <div className="badge-danger rounded-xl p-4"><p className="text-sm">{error}</p></div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-accent" /></div>
      ) : holidays.length === 0 ? (
        <div className="surface rounded-xl p-12 text-center text-text-tertiary">
          <CalendarDays size={28} className="mx-auto mb-3 opacity-50" />
          No holidays set for {year}.
        </div>
      ) : (
        <div className="surface rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-border">
                {['Date', 'Name', 'Applies To', 'Paid', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-text-tertiary uppercase tracking-wider">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-border-subtle">
                {holidays.map(h => (
                  <tr key={h._id} className="hover:bg-surface-elevated transition-colors">
                    <td className="px-4 py-3 text-text-secondary text-mono text-sm">{h.date}</td>
                    <td className="px-4 py-3 text-text-primary font-medium text-sm">{h.name}</td>
                    <td className="px-4 py-3 text-text-secondary text-xs">
                      {h.workLocations.length === 0 ? 'All sites' : h.workLocations.map(s => s.name).join(', ')}
                    </td>
                    <td className="px-4 py-3 text-text-secondary text-xs">{h.isPaid ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setDeleteTarget(h)} aria-label={`Remove ${h.name}`} className="p-1.5 text-text-secondary hover:text-danger hover:bg-danger-muted rounded transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Anyone who would have been excluded from &quot;absent&quot; on {deleteTarget?.date} for this holiday will count normally again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className={buttonVariants({ variant: 'destructive' })}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
