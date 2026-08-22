'use client';

import React, { useState, useEffect } from 'react';
import { UserPlus, Upload, Save, AlertCircle, CheckCircle2, MapPin, Clock, Tag, Building2 } from 'lucide-react';
import api from '@/lib/api';

interface Site { _id: string; name: string; }
interface Shift { _id: string; name: string; startTime: string; endTime: string; }
interface Service { _id: string; name: string; }
interface Contractor { _id: string; name: string; currentHeadcount: number; headcountCap?: number; }

export default function RegisterEmployeePage() {
    const [formData, setFormData] = useState({
        name: '', phone: '', nationalId: '', dateOfBirth: '',
        shiftTemplate: '', workLocation: '', serviceTag: '', contractor: '', consent: false,
    });
    const [sites, setSites] = useState<Site[]>([]);
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [contractors, setContractors] = useState<Contractor[]>([]);
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [status, setStatus] = useState<{ type: 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR', msg: string }>({ type: 'IDLE', msg: '' });

    useEffect(() => {
        api.getLocations().then(setSites).catch(() => {});
        api.getShifts().then(setShifts).catch(() => {});
        api.getServices().then(setServices).catch(() => {});
        api.getContractors().then(setContractors).catch(() => {});
    }, []);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setImageBase64(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!imageBase64) return setStatus({ type: 'ERROR', msg: 'A clear face photo is required for the ML engine.' });
        if (!formData.consent) return setStatus({ type: 'ERROR', msg: 'Employee consent to biometric data collection is required.' });

        setStatus({ type: 'LOADING', msg: 'Processing face registration...' });

        try {
            const payload = {
                ...formData,
                workLocation: formData.workLocation || null,
                shiftTemplate: formData.shiftTemplate || null,
                serviceTag: formData.serviceTag || null,
                contractor: formData.contractor || null,
                imageBase64,
            };
            await api.registerEmployee(payload);
            setStatus({ type: 'SUCCESS', msg: 'Employee registered successfully.' });
            setTimeout(() => window.location.href = '/dashboard/employees', 2000);
        } catch (error) {
            setStatus({ type: 'ERROR', msg: error instanceof Error ? error.message : 'Registration failed.' });
        }
    };

    return (
        <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl text-display text-text-primary flex items-center gap-3"><UserPlus size={24} className="text-accent" /> Register New Employee</h1>
                <p className="text-text-secondary text-sm mt-1">Add a new employee with face recognition enrollment.</p>
            </div>

            <form onSubmit={handleSubmit} className="surface rounded-lg p-6 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div><label className="text-sm font-medium text-text-secondary">Full Name</label><input required type="text" placeholder="e.g. Ramesh Kumar" className="input-base w-full mt-1 p-3" onChange={e => setFormData({...formData, name: e.target.value})} /></div>
                    <div><label className="text-sm font-medium text-text-secondary">Phone (10 Digits)</label><input required type="text" pattern="\d{10}" className="input-base w-full mt-1 p-3" onChange={e => setFormData({...formData, phone: e.target.value})} /></div>
                    <div><label className="text-sm font-medium text-text-secondary">Aadhaar Number (12 Digits)</label><input required type="text" pattern="\d{12}" className="input-base w-full mt-1 p-3" onChange={e => setFormData({...formData, nationalId: e.target.value})} /></div>
                    <div><label className="text-sm font-medium text-text-secondary">Date of Birth</label><input required type="date" className="input-base w-full mt-1 p-3" onChange={e => setFormData({...formData, dateOfBirth: e.target.value})} /></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5"><MapPin size={13} /> Assigned Site</label>
                        <select
                            value={formData.workLocation}
                            onChange={e => setFormData({...formData, workLocation: e.target.value})}
                            className="input-base w-full mt-1 p-3"
                        >
                            <option value="">Unassigned — assign later from Employees</option>
                            {sites.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                        </select>
                        {sites.length === 0 && (
                            <p className="text-xs text-text-tertiary mt-1">No sites created yet — add one under Sites to enable geofenced clock-ins.</p>
                        )}
                    </div>

                    <div>
                        <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5"><Clock size={13} /> Shift</label>
                        <select
                            value={formData.shiftTemplate}
                            onChange={e => setFormData({...formData, shiftTemplate: e.target.value})}
                            className="input-base w-full mt-1 p-3"
                        >
                            <option value="">No shift — attendance always marked on-time</option>
                            {shifts.map(s => <option key={s._id} value={s._id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5"><Tag size={13} /> Service (for billing)</label>
                        <select
                            value={formData.serviceTag}
                            onChange={e => setFormData({...formData, serviceTag: e.target.value})}
                            className="input-base w-full mt-1 p-3"
                        >
                            <option value="">Not tagged</option>
                            {services.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5"><Building2 size={13} /> Contractor</label>
                        <select
                            value={formData.contractor}
                            onChange={e => setFormData({...formData, contractor: e.target.value})}
                            className="input-base w-full mt-1 p-3"
                        >
                            <option value="">Direct hire (no contractor)</option>
                            {contractors.map(c => (
                                <option key={c._id} value={c._id} disabled={!!c.headcountCap && c.currentHeadcount >= c.headcountCap}>
                                    {c.name}{c.headcountCap ? ` (${c.currentHeadcount}/${c.headcountCap})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:bg-surface-elevated transition-colors">
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="photo-upload" />
                    <label htmlFor="photo-upload" className="cursor-pointer flex flex-col items-center">
                        {imageBase64 ? (
                            <img src={imageBase64} alt="Preview" className="h-32 rounded-lg shadow-md mb-4" />
                        ) : (
                            <Upload size={40} className="text-text-tertiary mb-4" />
                        )}
                        <span className="text-accent font-medium">{imageBase64 ? 'Change Photo' : 'Upload Clear Face Photo'}</span>
                        <span className="text-xs text-text-tertiary mt-2">Required for face recognition</span>
                    </label>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={formData.consent}
                        onChange={e => setFormData({...formData, consent: e.target.checked})}
                        className="mt-0.5 w-4 h-4 flex-shrink-0"
                    />
                    <span className="text-xs text-text-tertiary leading-relaxed">
                        The employee has consented to Radiance collecting and storing their facial biometric data and GPS location for attendance tracking purposes.
                    </span>
                </label>

                {status.type !== 'IDLE' && (
                    <div className={
                        status.type === 'SUCCESS' ? 'badge-success p-4 rounded-lg font-medium flex items-center gap-2' :
                        status.type === 'ERROR' ? 'badge-danger p-4 rounded-lg font-medium flex items-center gap-2' :
                        'badge-accent p-4 rounded-lg font-medium flex items-center gap-2'
                    }>
                        {status.type === 'ERROR' ? <AlertCircle size={20}/> : <CheckCircle2 size={20}/>} {status.msg}
                    </div>
                )}

                <button disabled={status.type === 'LOADING'} type="submit" className="w-full bg-accent/90 hover:bg-accent text-on-accent font-medium p-3 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                    <Save size={20} /> Register Employee
                </button>
            </form>
        </div>
    );
}
