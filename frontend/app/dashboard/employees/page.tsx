'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Users, Search, Edit, UserX, MapPin, Loader2, AlertTriangle, Clock, UserPlus } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

interface Employee {
  _id: string;
  employeeId: string;
  name: string;
  phone: string;
  nationalId: string;
  dateOfBirth: string;
  shiftTemplate: { _id: string; name: string; startTime: string; endTime: string } | null;
  workLocation: { _id: string; name: string; address?: string } | null;
  isActive: boolean;
  createdAt: string;
}

interface Site { _id: string; name: string; }
interface Shift { _id: string; name: string; startTime: string; endTime: string; }

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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', shiftTemplate: '', workLocation: '' });
  const [deactivateTarget, setDeactivateTarget] = useState<Employee | null>(null);

  const fetchData = async () => {
    try {
      const [emps, siteList, shiftList] = await Promise.all([api.getEmployees(), api.getLocations(), api.getShifts()]);
      setEmployees(emps);
      setSites(siteList);
      setShifts(shiftList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

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

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.employeeId.toLowerCase().includes(search.toLowerCase()) ||
    e.phone.includes(search)
  );

  if (loading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-accent" />
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary text-display">Employees</h1>
          <p className="text-text-secondary">{employees.length} registered employees</p>
        </div>
        <Link
          href="/dashboard/employees/register"
          className="flex items-center gap-2 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium transition-colors"
        >
          <UserPlus size={16} /> Add Employee
        </Link>
      </div>

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
                <tr><td colSpan={8} className="text-center py-12 text-text-tertiary">No employees found</td></tr>
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
                        <div className="flex gap-2">
                          <button onClick={() => handleEdit(emp)} aria-label={`Edit ${emp.name}`} title="Edit" className="p-1.5 text-text-secondary hover:text-accent hover:bg-accent-muted rounded transition-colors">
                            <Edit size={14} />
                          </button>
                          <button onClick={() => setDeactivateTarget(emp)} aria-label={`Deactivate ${emp.name}`} title="Deactivate" className="p-1.5 text-text-secondary hover:text-danger hover:bg-danger-muted rounded transition-colors">
                            <UserX size={14} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
