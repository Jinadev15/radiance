'use client';

import React, { useState, useEffect } from 'react';
import { Clock, Search, Download, Loader2, Edit, Check, X } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface AttendanceLog {
  _id: string;
  employee: { _id: string; name: string; employeeId: string; status?: string } | null;
  date: string;
  sessionNumber?: number;
  siteName: string | null;
  clockInTime: string;
  clockOutTime?: string;
  totalHours?: number;
  status: string;
  confidence?: number;
}

function toLocalInputValue(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The employee lifecycle status shown per row — separate from the
// per-scan attendance status (VALID/LATE/etc.) in the "Status" column.
// A pending employee clocks in and shows up here like anyone else; this
// badge is purely "has HR confirmed this person yet", the flag that has to
// be clear before payroll is run from this data.
const EMPLOYEE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Approved',
  PENDING_APPROVAL: 'Pending',
  INACTIVE: 'Inactive',
  REJECTED: 'Rejected',
};
const EMPLOYEE_STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'badge-success',
  PENDING_APPROVAL: 'badge-warning',
  INACTIVE: 'bg-surface-elevated text-text-tertiary border border-border',
  REJECTED: 'badge-danger',
};

export default function AttendancePage() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState('');
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ clockInTime: '', clockOutTime: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await api.exportAttendance(selectedDate, selectedDate, `attendance_${selectedDate}.csv`, approvedOnly);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await api.getAttendance({ date: selectedDate, status: statusFilter || undefined, limit: 200, approvedOnly });
      setLogs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [selectedDate, statusFilter, approvedOnly]);

  const startEdit = (log: AttendanceLog) => {
    setEditingId(log._id);
    setEditForm({ clockInTime: toLocalInputValue(log.clockInTime), clockOutTime: toLocalInputValue(log.clockOutTime), reason: '' });
  };

  const saveEdit = async (log: AttendanceLog) => {
    if (!editForm.clockInTime) {
      toast({ variant: 'destructive', title: 'A clock-in time is required.' });
      return;
    }
    if (!editForm.reason.trim()) {
      toast({ variant: 'destructive', title: 'Please explain why this record is being corrected.' });
      return;
    }
    if (!log.employee) return;
    setSaving(true);
    try {
      await api.manualAttendanceEdit({
        employeeId: log.employee._id,
        date: log.date,
        sessionNumber: log.sessionNumber,
        clockInTime: new Date(editForm.clockInTime).toISOString(),
        clockOutTime: editForm.clockOutTime ? new Date(editForm.clockOutTime).toISOString() : undefined,
        reason: editForm.reason.trim(),
      });
      setEditingId(null);
      toast({ title: 'Attendance record updated' });
      fetchLogs();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to save correction', description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const statusColors: Record<string, string> = {
    VALID: 'badge-success',
    LATE: 'badge-warning',
    EARLY_DEPARTURE: 'badge-warning',
    LOCATION_MISMATCH: 'badge-danger',
    SPOOF_ATTEMPT: 'badge-danger',
  };

  const pendingCount = logs.filter(l => l.employee?.status === 'PENDING_APPROVAL').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary text-display">Attendance Logs</h1>
          <p className="text-text-secondary">
            {logs.length} records for {selectedDate}
            {pendingCount > 0 && <span className="text-warning"> · {pendingCount} from employees still pending HR approval</span>}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm transition-all duration-200 ease-out disabled:opacity-50"
        >
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label htmlFor="attendance-date" className="sr-only">Date</label>
          <input
            id="attendance-date"
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="input-base px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="attendance-status" className="sr-only">Status</label>
          <select
            id="attendance-status"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="input-base px-3 py-2 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="VALID">On Time</option>
            <option value="LATE">Late</option>
            <option value="EARLY_DEPARTURE">Early Departure</option>
            <option value="LOCATION_MISMATCH">Location Mismatch</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary px-3 py-2 rounded-lg border border-border bg-surface-elevated cursor-pointer">
          <input
            type="checkbox"
            checked={approvedOnly}
            onChange={e => setApprovedOnly(e.target.checked)}
            className="accent-accent"
          />
          Approved employees only
        </label>
      </div>
      <p className="text-xs text-text-tertiary -mt-3">
        Attendance is recorded from an employee's first scan, before HR approves them — check &quot;Approved employees only&quot;
        when building a payroll export so pending registrations aren&apos;t included by mistake.
      </p>

      {error && <div className="badge-danger rounded-lg p-4"><p className="text-sm">{error}</p></div>}

      <div className="surface rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center"><Loader2 size={28} className="animate-spin text-accent" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-border">
                {['Employee', 'ID', 'Employee Status', 'Site', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Confidence', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-text-tertiary uppercase tracking-wider">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-border-subtle">
                {logs.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-12 text-text-tertiary">No attendance records for this date</td></tr>
                ) : logs.map(log => (
                  <tr key={log._id} className="hover:bg-surface-elevated transition-all duration-200 ease-out">
                    <td className="px-4 py-3 text-text-primary font-medium text-sm">{log.employee?.name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-accent text-mono text-sm">{log.employee?.employeeId || '–'}</td>
                    <td className="px-4 py-3">
                      {log.employee?.status ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${EMPLOYEE_STATUS_BADGE[log.employee.status] || 'badge-accent'}`}>
                          {EMPLOYEE_STATUS_LABEL[log.employee.status] || log.employee.status}
                        </span>
                      ) : '–'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary text-xs">{log.siteName || '–'}</td>
                    {editingId === log._id ? (
                      <>
                        <td className="px-4 py-2">
                          <input type="datetime-local" value={editForm.clockInTime} onChange={e => setEditForm(f => ({ ...f, clockInTime: e.target.value }))}
                            className="input-base px-2 py-1 text-xs w-40" />
                        </td>
                        <td className="px-4 py-2">
                          <input type="datetime-local" value={editForm.clockOutTime} onChange={e => setEditForm(f => ({ ...f, clockOutTime: e.target.value }))}
                            className="input-base px-2 py-1 text-xs w-40" />
                        </td>
                        <td colSpan={3} className="px-4 py-2">
                          <input
                            type="text"
                            value={editForm.reason}
                            onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                            placeholder="Reason for correction (required)"
                            className="input-base px-2 py-1 text-xs w-full"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => saveEdit(log)} disabled={saving} className="p-1.5 badge-success rounded"><Check size={14} /></button>
                            <button onClick={() => setEditingId(null)} className="p-1.5 bg-surface-elevated text-text-secondary border border-border rounded"><X size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-text-secondary text-mono text-sm">{new Date(log.clockInTime).toLocaleTimeString()}</td>
                        <td className="px-4 py-3 text-text-secondary text-mono text-sm">{log.clockOutTime ? new Date(log.clockOutTime).toLocaleTimeString() : <span className="text-text-tertiary">–</span>}</td>
                        <td className="px-4 py-3 text-text-secondary text-mono text-sm">{log.totalHours ? `${log.totalHours}h` : '–'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[log.status] || 'badge-accent'}`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-text-secondary text-mono text-sm">{log.confidence ? `${(log.confidence * 100).toFixed(0)}%` : '–'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => startEdit(log)} aria-label={`Correct attendance record for ${log.employee?.name || 'employee'}`} className="p-1.5 text-text-secondary hover:text-accent hover:bg-accent-muted rounded transition-colors" title="Correct this record">
                            <Edit size={14} />
                          </button>
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
    </div>
  );
}
