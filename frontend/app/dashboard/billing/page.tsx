'use client';

import React, { useState, useEffect } from 'react';
import { Tag, Building2, Plus, Trash2, Loader2, X, Check } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

interface Service { _id: string; name: string; }
interface Site { _id: string; name: string; }
interface Contractor {
  _id: string; name: string; contactPhone?: string;
  workLocation?: { _id: string; name: string } | null;
  headcountCap?: number | null; currentHeadcount: number;
}

export default function BillingPage() {
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteServiceTarget, setDeleteServiceTarget] = useState<Service | null>(null);
  const [deleteContractorTarget, setDeleteContractorTarget] = useState<Contractor | null>(null);

  const [newService, setNewService] = useState('');
  const [savingService, setSavingService] = useState(false);

  const [showContractorForm, setShowContractorForm] = useState(false);
  const [contractorForm, setContractorForm] = useState({ name: '', contactPhone: '', workLocation: '', headcountCap: '' });
  const [savingContractor, setSavingContractor] = useState(false);

  const fetchData = async () => {
    try {
      const [s, c, sites] = await Promise.all([api.getServices(), api.getContractors(), api.getLocations()]);
      setServices(s);
      setContractors(c);
      setSites(sites);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newService.trim()) return;
    setSavingService(true);
    try {
      await api.createService(newService.trim());
      setNewService('');
      toast({ title: 'Service added' });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to add service', description: err instanceof Error ? err.message : undefined });
    } finally {
      setSavingService(false);
    }
  };

  const handleDeleteService = async () => {
    if (!deleteServiceTarget) return;
    try {
      await api.deactivateService(deleteServiceTarget._id);
      toast({ title: `"${deleteServiceTarget.name}" removed` });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to remove service', description: err instanceof Error ? err.message : undefined });
    } finally {
      setDeleteServiceTarget(null);
    }
  };

  const handleAddContractor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingContractor(true);
    try {
      await api.createContractor({
        name: contractorForm.name,
        contactPhone: contractorForm.contactPhone || undefined,
        workLocation: contractorForm.workLocation || null,
        headcountCap: contractorForm.headcountCap ? parseInt(contractorForm.headcountCap, 10) : null,
      });
      setContractorForm({ name: '', contactPhone: '', workLocation: '', headcountCap: '' });
      setShowContractorForm(false);
      toast({ title: 'Contractor added' });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to add contractor', description: err instanceof Error ? err.message : undefined });
    } finally {
      setSavingContractor(false);
    }
  };

  const handleDeleteContractor = async () => {
    if (!deleteContractorTarget) return;
    try {
      await api.deactivateContractor(deleteContractorTarget._id);
      toast({ title: `"${deleteContractorTarget.name}" removed` });
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to remove contractor', description: err instanceof Error ? err.message : undefined });
    } finally {
      setDeleteContractorTarget(null);
    }
  };

  if (loading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-accent" />
    </div>
  );

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary text-display">Services & Contractors</h1>
        <p className="text-text-secondary">What client hours get billed against, and any sub-agency staffing caps</p>
      </div>

      {error && <div className="bg-danger-muted border border-danger-border rounded-xl p-4"><p className="text-danger text-sm">{error}</p></div>}

      {/* Services */}
      <div className="surface rounded-xl p-6 space-y-4">
        <h2 className="text-text-primary font-semibold flex items-center gap-2"><Tag size={18} className="text-accent" /> Services</h2>
        <p className="text-text-secondary text-sm">Every clock-in is tagged with the employee's service so hours roll up by site + service for client invoicing.</p>
        <div className="flex flex-wrap gap-2">
          {services.map(s => (
            <span key={s._id} className="flex items-center gap-2 px-3 py-1.5 bg-surface-elevated border border-border rounded-full text-sm text-text-primary">
              {s.name}
              <button onClick={() => setDeleteServiceTarget(s)} aria-label={`Remove ${s.name}`} className="text-text-tertiary hover:text-danger"><X size={13} /></button>
            </span>
          ))}
          {services.length === 0 && <p className="text-text-tertiary text-sm">No services yet — add "Security", "Housekeeping", "Maintenance", etc.</p>}
        </div>
        <form onSubmit={handleAddService} className="flex gap-2">
          <label htmlFor="new-service" className="sr-only">New service name</label>
          <input id="new-service" value={newService} onChange={e => setNewService(e.target.value)} placeholder="e.g. Housekeeping"
            className="input-base p-2.5 flex-1 max-w-xs text-sm" />
          <button disabled={savingService} type="submit" className="flex items-center gap-1.5 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium disabled:opacity-50">
            {savingService ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
          </button>
        </form>
      </div>

      {/* Contractors */}
      <div className="surface rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-text-primary font-semibold flex items-center gap-2"><Building2 size={18} className="text-accent" /> Contractors</h2>
          {!showContractorForm && (
            <button onClick={() => setShowContractorForm(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-xs font-medium">
              <Plus size={14} /> Add Contractor
            </button>
          )}
        </div>
        <p className="text-text-secondary text-sm">Optional — only needed if Radiance staffs a site through a sub-agency instead of direct hires. Employees without a contractor are simply direct hires.</p>

        {showContractorForm && (
          <form onSubmit={handleAddContractor} className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 bg-surface-elevated rounded-lg">
            <label htmlFor="contractor-name" className="sr-only">Contractor name</label>
            <input id="contractor-name" required value={contractorForm.name} onChange={e => setContractorForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Contractor name" className="input-base p-2.5 text-sm" />
            <label htmlFor="contractor-phone" className="sr-only">Contact phone</label>
            <input id="contractor-phone" value={contractorForm.contactPhone} onChange={e => setContractorForm(f => ({ ...f, contactPhone: e.target.value }))}
              placeholder="Contact phone (optional)" className="input-base p-2.5 text-sm" />
            <label htmlFor="contractor-site" className="sr-only">Site</label>
            <select id="contractor-site" value={contractorForm.workLocation} onChange={e => setContractorForm(f => ({ ...f, workLocation: e.target.value }))}
              className="input-base p-2.5 text-sm">
              <option value="">No specific site</option>
              {sites.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
            <label htmlFor="contractor-cap" className="sr-only">Headcount cap</label>
            <input id="contractor-cap" type="number" min={1} value={contractorForm.headcountCap} onChange={e => setContractorForm(f => ({ ...f, headcountCap: e.target.value }))}
              placeholder="Headcount cap (optional)" className="input-base p-2.5 text-sm text-mono" />
            <div className="md:col-span-2 flex gap-2">
              <button disabled={savingContractor} type="submit" className="flex items-center gap-1.5 px-4 py-2 bg-accent/90 hover:bg-accent text-on-accent rounded-lg text-sm font-medium disabled:opacity-50">
                {savingContractor ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
              </button>
              <button type="button" onClick={() => setShowContractorForm(false)} className="px-4 py-2 bg-surface text-text-secondary border border-border rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {contractors.map(c => (
            <div key={c._id} className="flex items-center justify-between p-3 bg-surface-elevated rounded-lg">
              <div>
                <p className="text-text-primary text-sm font-medium">{c.name}</p>
                <p className="text-text-tertiary text-xs">{c.workLocation?.name || 'No specific site'}{c.contactPhone ? ` · ${c.contactPhone}` : ''}</p>
              </div>
              {/* "At capacity" is an expected, neutral business state, not an
                  error — badge-danger is reserved for actual security/spoof
                  alerts elsewhere in the app; warning reads as "worth noting"
                  without implying something is wrong. */}
              <div className="flex items-center gap-3">
                {c.headcountCap ? (
                  <span className={`text-xs text-mono px-2 py-1 rounded-full ${c.currentHeadcount >= c.headcountCap ? 'badge-warning' : 'badge-accent'}`}>
                    {c.currentHeadcount}/{c.headcountCap}
                  </span>
                ) : (
                  <span className="text-xs text-text-tertiary text-mono">{c.currentHeadcount} staffed</span>
                )}
                <button onClick={() => setDeleteContractorTarget(c)} aria-label={`Remove ${c.name}`} className="p-1.5 text-text-tertiary hover:text-danger hover:bg-danger-muted rounded transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {contractors.length === 0 && !showContractorForm && <p className="text-text-tertiary text-sm">No contractors — all staff are direct hires.</p>}
        </div>
      </div>

      <AlertDialog open={!!deleteServiceTarget} onOpenChange={open => !open && setDeleteServiceTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &quot;{deleteServiceTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Existing attendance records keep their service label — this only removes it from future selection.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteService} className={buttonVariants({ variant: 'destructive' })}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteContractorTarget} onOpenChange={open => !open && setDeleteContractorTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &quot;{deleteContractorTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Employees assigned to this contractor keep the association on past records.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContractor} className={buttonVariants({ variant: 'destructive' })}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
