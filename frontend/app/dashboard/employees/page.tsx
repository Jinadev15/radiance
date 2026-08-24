'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Users, Search, Edit, UserX, UserCheck, MapPin, Loader2, AlertTriangle, Clock, UserPlus, Check, X, RotateCcw } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import type { Employee, EmployeeStatus } from '@/lib/types';

interface Site { _id: string; name: string; }
interface Shift { _id: string; name: string; startTime: string; endTime: string; }

// The tabs this page shows. Kept separate from the raw status enum so the
// label wording ("Pending Approval", not "PENDING_APPROVAL") lives in one place.
const TABS: { key: EmployeeStatus; label: string }[] = [
  { key: 'ACTIVE', label: 'Approved' },
  { key: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { key: 'INACTIVE', label: 'Inactive' },
];

export default function EmployeesPage() {
  return (
    <Suspense fallback={
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    }>
      <EmployeesPageInner />
    </Suspense>
  );
}

function EmployeesPageInner() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [tab, setTab] = useState<EmployeeStatus>('ACTIVE');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [counts, setCounts] = useState<{ active: number; pending: number; inactive: number } | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(() => searchParams.get('q') || '');

  // The header's global search does a router.push with a new ?q= while this
  // page is already mounted — Next.js reuses the component instance rather
  // than remounting it, so the lazy useState initializer above only ever
  // ran once and silently never saw the second search. Resync whenever the
  // URL's q actually changes.
  useEffect(() => {
    const q = searchParams.get('q') || '';
    setSearch(q);
  }, [searchParams]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', shiftTemplate: '', workLocation: '' });
  const [deactivateTarget, setDeactivateTarget] = useState<Employee | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Employee | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [empPage, siteList, shiftList, counts] = await Promise.all([
        api.getEmployeesPage({ status: tab, limit: 200 }),
        api.getLocations(),
        api.getShifts(),
        api.getEmployeeCounts(),
      ]);
      setEmployees(empPage.employees);
      setSites(siteList);
      setShifts(shiftList);
      setCounts(counts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [tab]);

  const handleEdit = (emp: Employee) => {
    setEditingId(emp._id);
    setEditForm({
      name: emp.name,
      shiftTemplate: emp.shiftTemplate?._id || '',
      workLocation: emp.workLocation?._id || '',
    });
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await api.updateEmployee(id, {
        name: editForm.name,
        workLocation: editForm.workLocation || null,
        shiftTemplate: editForm.shiftTemplate || null,
      });
      setEditingId(null);
      toast({ title: 'Employee updated' });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Update failed', description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.deactivateEmployee(deactivateTarget._id);
      toast({ title: `${deactivateTarget.name} deactivated` });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Deactivation failed', description: err instanceof Error ? err.message : undefined });
    } finally {
      setDeactivateTarget(null);
    }
  };

  // Approval needs no extra input — the site was already required at
  // registration, so this is a single confirming click. Attendance recorded
  // before this point is kept exactly as it was scanned; approving only
  // flips who counts as a confirmed employee for payroll.
  const handleApprove = async (emp: Employee) => {
    setProcessingId(emp._id);
    try {
      await api.approveEmployee(emp._id);
      toast({ title: `${emp.name} approved`, description: 'Their existing attendance is unchanged — this only confirms them for payroll.' });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Approval failed', description: err instanceof Error ? err.message : undefined });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    setProcessingId(rejectTarget._id);
    try {
      await api.rejectEmployee(rejectTarget._id, rejectReason.trim());
      toast({ title: `${rejectTarget.name}'s registration rejected` });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Rejection failed', description: err instanceof Error ? err.message : undefined });
    } finally {
      setProcessingId(null);
      setRejectTarget(null);
      setRejectReason('');
    }
  };

  const handleReactivate = async (emp: Employee) => {
    setProcessingId(emp._id);
    try {
      const result = await api.reactivateEmployee(emp._id);
      toast({
        title: `${emp.name} reactivated`,
        description: result.needsFaceReenrolment ? 'Their face data was erased — they need to re-enrol at the kiosk before they can clock in.' : undefined,
      });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Reactivation failed', description: err instanceof Error ? err.message : undefined });
    } finally {
      setProcessingId(null);
    }
  };

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.employeeId.toLowerCase().includes(search.toLowerCase()) ||
    e.phone.includes(search)
  );

  const tabCount = (key: EmployeeStatus) => {
    if (!counts) return null;
    if (key === 'ACTIVE') return counts.active;
    if (key === 'PENDING_APPROVAL') return counts.pending;
    if (key === 'INACTIVE') return counts.inactive;
    return null;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary text-display">Employees</h1>
          <p className="text-text-secondary">
            An employee can clock in as soon as they register at the kiosk — approval here confirms them for payroll, it doesn&apos;t gate attendance.
          </p>
        </div>
        <Link
          href="/dashboard/employees/register"
          className="flex items-center gap-2 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium transition-colors"
        >
          <UserPlus size={16} /> Add Employee
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              tab === t.key ? 'bg-accent-muted text-accent border border-accent-border' : 'bg-surface-elevated text-text-secondary border border-border'
            }`}
          >
            {t.label}
            {tabCount(t.key) !== null && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${tab === t.key ? 'bg-accent/20' : 'bg-surface text-text-tertiary'}`}>
                {tabCount(t.key)}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'PENDING_APPROVAL' && employees.length > 0 && (
        <div className="badge-warning rounded-lg p-3 text-sm">
          These employees are already clocking in and their attendance is being recorded — approving them here only confirms they're a real employee before their hours are paid.
        </div>
      )}

      {error && <div className="badge-danger rounded-xl p-4"><p className="text-sm">{error}</p></div>}

      {/* Search */}
      <div className="relative">
        <label htmlFor="employee-search" className="sr-only">Search employees by name, ID, or phone</label>
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          id="employee-search"
          type="text"
          placeholder="Search by name, ID, or phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 input-base rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="surface rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center"><Loader2 size={28} className="animate-spin text-accent" /></div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['ID', 'Name', 'Phone', 'Aadhaar', 'Site', 'Shift', 'Joined', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-text-tertiary uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-text-tertiary">
                  {tab === 'PENDING_APPROVAL' ? 'Nothing waiting for approval right now.' : 'No employees found'}
                </td></tr>
              ) : filtered.map(emp => (
                <tr key={emp._id} className="hover:bg-surface-elevated transition-colors">
                  {editingId === emp._id ? (
                    <>
                      <td className="px-4 py-2 text-text-secondary text-sm text-mono">{emp.employeeId}</td>
                      <td className="px-4 py-2">
                        <label htmlFor={`edit-name-${emp._id}`} className="sr-only">Name</label>
                        <input id={`edit-name-${emp._id}`} value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                          className="input-base px-2 py-1 text-sm w-32" />
                      </td>
                      <td className="px-4 py-2 text-text-secondary text-sm">{emp.phone}</td>
                      <td className="px-4 py-2 text-text-secondary text-sm text-mono">{emp.nationalId}</td>
                      <td className="px-4 py-2">
                        <label htmlFor={`edit-site-${emp._id}`} className="sr-only">Site</label>
                        <select id={`edit-site-${emp._id}`} value={editForm.workLocation} onChange={e => setEditForm(f => ({ ...f, workLocation: e.target.value }))}
                          className="input-base px-2 py-1 text-sm w-36">
                          <option value="">Unassigned</option>
                          {sites.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <label htmlFor={`edit-shift-${emp._id}`} className="sr-only">Shift</label>
                        <select id={`edit-shift-${emp._id}`} value={editForm.shiftTemplate} onChange={e => setEditForm(f => ({ ...f, shiftTemplate: e.target.value }))}
                          className="input-base px-2 py-1 text-sm w-36">
                          <option value="">No shift</option>
                          {shifts.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-text-secondary text-sm text-mono">{new Date(emp.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => handleSaveEdit(emp._id)} className="px-2 py-1 bg-success-muted text-success border border-success-border text-xs rounded-md">Save</button>
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 bg-surface-elevated text-text-secondary border border-border text-xs rounded-md">Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-accent text-mono text-sm">{emp.employeeId}</td>
                      <td className="px-4 py-3 text-text-primary font-medium text-sm">{emp.name}</td>
                      <td className="px-4 py-3 text-text-secondary text-sm">{emp.phone}</td>
                      <td className="px-4 py-3 text-text-secondary text-sm text-mono">{emp.nationalId}</td>
                      <td className="px-4 py-3 text-sm">
                        {emp.workLocation ? (
                          <span className="flex items-center gap-1.5 text-text-secondary">
                            <MapPin size={12} className="text-accent" /> {emp.workLocation.name}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-warning text-xs">
                            <AlertTriangle size={12} /> Unassigned
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {emp.shiftTemplate ? (
                          <span className="flex items-center gap-1.5 text-text-secondary text-mono text-xs">
                            <Clock size={12} className="text-accent" /> {emp.shiftTemplate.startTime}–{emp.shiftTemplate.endTime}
                          </span>
                        ) : (
                          <span className="text-text-tertiary text-xs">No shift</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-sm text-mono">{new Date(emp.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        {tab === 'PENDING_APPROVAL' ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleApprove(emp)}
                              disabled={processingId === emp._id}
                              className="flex items-center gap-1.5 px-3 py-1.5 badge-success rounded-lg text-xs font-medium disabled:opacity-50"
                            >
                              <Check size={13} /> Approve
                            </button>
                            <button
                              onClick={() => setRejectTarget(emp)}
                              disabled={processingId === emp._id}
                              className="flex items-center gap-1.5 px-3 py-1.5 badge-danger rounded-lg text-xs font-medium disabled:opacity-50"
                            >
                              <X size={13} /> Reject
                            </button>
                          </div>
                        ) : tab === 'INACTIVE' ? (
                          <button
                            onClick={() => handleReactivate(emp)}
                            disabled={processingId === emp._id}
                            className="flex items-center gap-1.5 px-3 py-1.5 badge-success rounded-lg text-xs font-medium disabled:opacity-50"
                          >
                            <RotateCcw size={13} /> Reactivate
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            {/* Disabled (not hidden) while another row is being edited — clicking
                                Edit elsewhere used to silently discard whatever was unsaved in the
                                open row, with no warning. Only one row can be edited at a time now. */}
                            <button onClick={() => handleEdit(emp)} disabled={editingId !== null} aria-label={`Edit ${emp.name}`} title={editingId !== null ? 'Finish or cancel the current edit first' : 'Edit'} className="p-1.5 text-text-secondary hover:text-accent hover:bg-accent-muted rounded transition-colors disabled:opacity-30 disabled:pointer-events-none">
                              <Edit size={14} />
                            </button>
                            <button onClick={() => setDeactivateTarget(emp)} disabled={editingId !== null} aria-label={`Deactivate ${emp.name}`} title="Deactivate" className="p-1.5 text-text-secondary hover:text-danger hover:bg-danger-muted rounded transition-colors disabled:opacity-30 disabled:pointer-events-none">
                              <UserX size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <AlertDialog open={!!deactivateTarget} onOpenChange={open => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>They will no longer be able to clock in at any kiosk. This can be reversed by an admin later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className={buttonVariants({ variant: 'destructive' })}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!rejectTarget} onOpenChange={open => { if (!open) { setRejectTarget(null); setRejectReason(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject {rejectTarget?.name}&apos;s registration?</AlertDialogTitle>
            <AlertDialogDescription>
              Their face data will be erased and their attendance history stays on record but they will never be able to clock in again under this profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <label htmlFor="reject-reason" className="text-xs font-medium text-text-secondary">Reason (required)</label>
            <textarea
              id="reject-reason"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={2}
              placeholder="e.g. Not a Radiance employee, could not be verified with HR"
              className="input-base w-full mt-1 p-2 text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={!rejectReason.trim()}
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
