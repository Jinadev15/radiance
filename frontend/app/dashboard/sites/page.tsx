'use client';

import React, { useState, useEffect } from 'react';
import { MapPin, Plus, Edit, Trash2, Loader2, Users, Clock, X, Check } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

interface Site {
  _id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  shiftStart: string;
  shiftEnd: string;
  isActive: boolean;
}

interface SiteStat {
  siteId: string | null;
  siteName: string;
  totalEmployees: number;
  presentToday: number;
  late: number;
}

const emptyForm = {
  name: '', address: '', latitude: '', longitude: '',
  radiusMeters: '150', shiftStart: '09:00', shiftEnd: '17:00',
};

export default function SitesPage() {
  const { toast } = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteStats, setSiteStats] = useState<Record<string, SiteStat>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Site | null>(null);

  const fetchData = async () => {
    try {
      const [siteList, stats] = await Promise.all([api.getLocations(), api.getStats()]);
      setSites(siteList);
      const statMap: Record<string, SiteStat> = {};
      (stats.bySite || []).forEach((s: SiteStat) => { if (s.siteId) statMap[s.siteId] = s; });
      setSiteStats(statMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sites');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setShowForm(false);
    setEditingId(null);
  };

  const handleEdit = (site: Site) => {
    setForm({
      name: site.name,
      address: site.address,
      latitude: String(site.latitude),
      longitude: String(site.longitude),
      radiusMeters: String(site.radiusMeters),
      shiftStart: site.shiftStart,
      shiftEnd: site.shiftEnd,
    });
    setEditingId(site._id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        address: form.address,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        radiusMeters: parseInt(form.radiusMeters, 10),
        shiftStart: form.shiftStart,
        shiftEnd: form.shiftEnd,
      };
      if (editingId) {
        await api.updateLocation(editingId, payload);
      } else {
        await api.createLocation(payload);
      }
      resetForm();
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save site');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.deactivateLocation(deactivateTarget._id);
      toast({ title: `"${deactivateTarget.name}" deactivated` });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to deactivate site', description: err instanceof Error ? err.message : undefined });
    } finally {
      setDeactivateTarget(null);
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
          <h1 className="text-2xl font-semibold text-text-primary text-display">Sites</h1>
          <p className="text-text-secondary">{sites.length} client location{sites.length !== 1 ? 's' : ''} — geofence radius enforced at clock-in</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent font-medium rounded-lg text-sm transition-colors"
          >
            <Plus size={16} /> Add Site
          </button>
        )}
      </div>

      {error && <div className="bg-danger-muted border border-danger-border rounded-xl p-4"><p className="text-danger text-sm">{error}</p></div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="surface rounded-xl p-6 space-y-5 animate-enter-up">
          <div className="flex items-center justify-between">
            <h2 className="text-text-primary font-semibold flex items-center gap-2">
              <MapPin size={18} className="text-accent" /> {editingId ? 'Edit Site' : 'New Site'}
            </h2>
            <button type="button" onClick={resetForm} className="text-text-tertiary hover:text-text-primary">
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="site-name" className="text-sm font-medium text-text-secondary">Site Name</label>
              <input id="site-name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Ambattur Client Campus" className="input-base w-full mt-1 p-3" />
            </div>
            <div>
              <label htmlFor="site-address" className="text-sm font-medium text-text-secondary">Address</label>
              <input id="site-address" required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="e.g. Ambattur Industrial Estate, Chennai" className="input-base w-full mt-1 p-3" />
            </div>
            <div>
              <label htmlFor="site-lat" className="text-sm font-medium text-text-secondary">Latitude</label>
              <input id="site-lat" required type="number" step="any" value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                placeholder="13.0827" className="input-base w-full mt-1 p-3 text-mono" />
            </div>
            <div>
              <label htmlFor="site-lng" className="text-sm font-medium text-text-secondary">Longitude</label>
              <input id="site-lng" required type="number" step="any" value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                placeholder="80.2707" className="input-base w-full mt-1 p-3 text-mono" />
            </div>
            <div>
              <label htmlFor="site-radius" className="text-sm font-medium text-text-secondary">Geofence Radius (meters)</label>
              <input id="site-radius" required type="number" min={50} max={5000} value={form.radiusMeters} onChange={e => setForm(f => ({ ...f, radiusMeters: e.target.value }))}
                className="input-base w-full mt-1 p-3 text-mono" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="site-shift-start" className="text-sm font-medium text-text-secondary">Shift Start</label>
                <input id="site-shift-start" required type="time" value={form.shiftStart} onChange={e => setForm(f => ({ ...f, shiftStart: e.target.value }))}
                  className="input-base w-full mt-1 p-3" />
              </div>
              <div>
                <label htmlFor="site-shift-end" className="text-sm font-medium text-text-secondary">Shift End</label>
                <input id="site-shift-end" required type="time" value={form.shiftEnd} onChange={e => setForm(f => ({ ...f, shiftEnd: e.target.value }))}
                  className="input-base w-full mt-1 p-3" />
              </div>
            </div>
          </div>

          <p className="text-xs text-text-tertiary">
            Tip: open the site on Google Maps, right-click the exact spot and copy the coordinates shown at the top of the menu — no account or paid API needed.
          </p>

          <div className="flex gap-3">
            <button disabled={saving} type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-accent/90 hover:bg-accent text-on-accent font-medium rounded-lg text-sm transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {editingId ? 'Save Changes' : 'Create Site'}
            </button>
            <button type="button" onClick={resetForm} className="px-5 py-2.5 bg-surface-elevated text-text-secondary border border-border rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sites.length === 0 && !showForm ? (
          <div className="col-span-full surface rounded-xl p-12 text-center text-text-tertiary">
            No sites yet. Add your first client location to start enforcing geofenced attendance.
          </div>
        ) : sites.map(site => {
          const stat = siteStats[site._id];
          return (
            <div key={site._id} className="surface rounded-xl p-5 space-y-4 hover:border-accent-border transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent-muted border border-accent-border flex items-center justify-center flex-none">
                    <MapPin size={16} className="text-accent" />
                  </div>
                  <div>
                    <h3 className="text-text-primary font-semibold text-sm leading-tight">{site.name}</h3>
                    <p className="text-text-tertiary text-xs mt-0.5">{site.address}</p>
                  </div>
                </div>
                <div className="flex gap-1 flex-none">
                  <button onClick={() => handleEdit(site)} aria-label={`Edit ${site.name}`} className="p-1.5 text-text-tertiary hover:text-accent hover:bg-accent-muted rounded transition-colors" title="Edit">
                    <Edit size={14} />
                  </button>
                  <button onClick={() => setDeactivateTarget(site)} aria-label={`Deactivate ${site.name}`} className="p-1.5 text-text-tertiary hover:text-danger hover:bg-danger-muted rounded transition-colors" title="Deactivate">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-mono text-text-tertiary">
                <span className="flex items-center gap-1"><Clock size={12} /> {site.shiftStart}–{site.shiftEnd}</span>
                <span>{site.radiusMeters}m radius</span>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
                <div className="flex items-center gap-1.5 text-text-secondary text-xs">
                  <Users size={13} /> {stat?.totalEmployees ?? 0} assigned
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge-success px-2 py-0.5 rounded-full text-xs font-medium text-mono">
                    {stat?.presentToday ?? 0} present today
                  </span>
                  {(stat?.late ?? 0) > 0 && (
                    <span className="badge-warning px-2 py-0.5 rounded-full text-xs font-medium text-mono">
                      {stat!.late} late
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!deactivateTarget} onOpenChange={open => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate &quot;{deactivateTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Employees assigned here will need reassigning to another site.</AlertDialogDescription>
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
