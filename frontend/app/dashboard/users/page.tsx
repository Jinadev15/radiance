'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Loader2, Shield, Check } from 'lucide-react';
import api, { ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

interface User { id: string; _id?: string; name: string; email: string; role: string; workLocation?: { name: string } | null; }
interface Site { _id: string; name: string; }

const emptyForm = { name: '', email: '', password: '', role: 'hr', workLocation: '' };

export default function UsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);

  const fetchData = async () => {
    try {
      const [u, s] = await Promise.all([api.getUsers(), api.getLocations()]);
      setUsers(u);
      setSites(s);
    } catch (err) {
      // A real status check instead of guessing from error text — the
      // backend returns 403 for "admin required," which is what actually
      // distinguishes "you're not allowed here" from any other failure.
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.role === 'supervisor' && !form.workLocation) {
      toast({ variant: 'destructive', title: 'Supervisors must be assigned to a site.' });
      return;
    }
    setSaving(true);
    try {
      await api.createUser({ ...form, workLocation: form.role === 'supervisor' ? form.workLocation : undefined });
      setForm(emptyForm);
      setShowForm(false);
      toast({ title: 'Login created' });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to create user', description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    const id = deactivateTarget.id || deactivateTarget._id!;
    try {
      await api.deactivateUser(id);
      toast({ title: `${deactivateTarget.name}'s login deactivated` });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to deactivate user', description: err instanceof Error ? err.message : undefined });
    } finally {
      setDeactivateTarget(null);
    }
  };

  if (forbidden) {
    return (
      <div className="p-6">
        <div className="surface rounded-xl p-12 text-center text-text-tertiary">
          <Shield size={28} className="mx-auto mb-3 opacity-50" />
          Only admins can manage dashboard logins.
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-accent" />
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary text-display">Dashboard Users</h1>
          <p className="text-text-secondary">Admins and HR see everything; supervisors are scoped to one site</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium">
            <Plus size={16} /> New Login
          </button>
        )}
      </div>

      {error && <div className="badge-danger rounded-xl p-4"><p className="text-sm">{error}</p></div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="surface rounded-xl p-6 space-y-4 animate-enter-up">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="user-name" className="sr-only">Full name</label>
              <input id="user-name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" className="input-base p-3 w-full" />
            </div>
            <div>
              <label htmlFor="user-email" className="sr-only">Email</label>
              <input id="user-email" required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="input-base p-3 w-full" />
            </div>
            <div>
              <label htmlFor="user-password" className="sr-only">Password</label>
              <input id="user-password" required type="password" minLength={6} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Password (min 6 chars)" className="input-base p-3 w-full" />
            </div>
            <div>
              <label htmlFor="user-role" className="sr-only">Role</label>
              <select id="user-role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="input-base p-3 w-full">
                <option value="hr">HR — full access</option>
                <option value="admin">Admin — full access + user management</option>
                <option value="supervisor">Supervisor — one site only</option>
              </select>
            </div>
            {form.role === 'supervisor' && (
              <div className="md:col-span-2">
                <label htmlFor="user-site" className="sr-only">Site</label>
                <select id="user-site" required value={form.workLocation} onChange={e => setForm(f => ({ ...f, workLocation: e.target.value }))} className="input-base p-3 w-full">
                  <option value="">Select the site they supervise…</option>
                  {sites.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button disabled={saving} type="submit" className="flex items-center gap-2 px-5 py-2.5 bg-accent/90 hover:bg-accent text-on-accent font-medium rounded-lg text-sm disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Create Login
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2.5 bg-surface-elevated text-text-secondary border border-border rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="surface rounded-xl overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            {['Name', 'Email', 'Role', 'Site', 'Actions'].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-text-tertiary uppercase tracking-wider">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-border-subtle">
            {users.map(u => (
              <tr key={u.id || u._id} className="hover:bg-surface-elevated transition-colors">
                <td className="px-4 py-3 text-text-primary font-medium text-sm">{u.name}</td>
                <td className="px-4 py-3 text-text-secondary text-sm">{u.email}</td>
                <td className="px-4 py-3">
                  <span className="badge-accent px-2 py-0.5 rounded-full text-xs font-medium capitalize">{u.role}</span>
                </td>
                <td className="px-4 py-3 text-text-secondary text-sm">{u.workLocation?.name || '–'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setDeactivateTarget(u)} aria-label={`Deactivate ${u.name}'s login`} title="Deactivate" className="p-1.5 text-text-secondary hover:text-danger hover:bg-danger-muted rounded transition-colors">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={!!deactivateTarget} onOpenChange={open => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateTarget?.name}&apos;s login?</AlertDialogTitle>
            <AlertDialogDescription>They will no longer be able to sign in to the dashboard.</AlertDialogDescription>
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
