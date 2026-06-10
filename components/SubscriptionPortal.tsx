/**
 * SubscriptionPortal.tsx
 * Standalone Subscription Admin Portal
 * Access: /?sub-admin=true
 *
 * Features:
 *  - Own login with admin user management
 *  - Beautiful sidebar navigation
 *  - Dashboard · Subscribers · Plans · Payments · Tickets · Admins · Analytics
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PLANS, FEATURES, PLAN_MAP, daysRemaining, makeSubscriptionToken } from '../subscription';
import type { Plan, PlanId, Subscription, PaymentRecord, SupportTicket } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────
const INR    = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const today  = () => new Date().toISOString().split('T')[0];
const addM   = (n: number) => { const d = new Date(); d.setMonth(d.getMonth()+n); return d.toISOString().split('T')[0]; };
const addD   = (s: string, n: number) => new Date(new Date(s).getTime()+n*86400000).toISOString().split('T')[0];
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
const BASE   = window.location.origin;
const SK     = 'test'; // super admin key — must match SUPER_ADMIN_KEY env var on Railway

// ── Storage helpers ───────────────────────────────────────────────────────────
const load  = <T,>(k: string, def: T): T => { try { return JSON.parse(localStorage.getItem(k)||'null') ?? def; } catch { return def; } };
const save  = (k: string, v: any) => localStorage.setItem(k, JSON.stringify(v));

// ── Plan feature config (editable by admin, stored per plan) ──────────────────
// Shape: { planId: Set<featureId> }  — overrides the static PLANS defaults
// Shop-level featureOverrides on Subscription always take priority over this.
const loadPlanFeatures = (): Record<PlanId, string[]> => {
  const stored = load<Record<PlanId,string[]>>('royal_plan_features', {} as any);
  return {
    classic: stored.classic ?? PLANS[0].features,
    growth:  stored.growth  ?? PLANS[1].features,
    pro:     stored.pro     ?? PLANS[2].features,
  };
};

// ── Admin users ───────────────────────────────────────────────────────────────
interface AdminUser { id: string; name: string; email: string; password: string; role: 'super'|'admin'|'support'; createdAt: string }
const defaultAdmins: AdminUser[] = [
  { id:'sa-001', name:'Super Admin', email:'superadmin@royalerp.in', password:'admin@123', role:'super', createdAt: today() }
];

// ── Sidebar nav ───────────────────────────────────────────────────────────────
const NAV = [
  { id:'dashboard',    label:'Dashboard',       icon:'fa-th-large' },
  { id:'subscribers',  label:'Subscribers',     icon:'fa-store' },
  { id:'add_shop',     label:'Add New Shop',    icon:'fa-plus-circle' },
  { id:'plans',        label:'Plans & Features',icon:'fa-layer-group' },
  { id:'payments',     label:'Payments',        icon:'fa-rupee-sign' },
  { id:'tickets',      label:'Support Tickets', icon:'fa-ticket-alt' },
  { id:'admins',       label:'Admin Users',     icon:'fa-user-shield' },
  { id:'analytics',    label:'Analytics',       icon:'fa-chart-pie' },
  { id:'backups',      label:'Backups',          icon:'fa-database' },
];






interface Tenant { id: string; name: string; slug: string; }

interface BackupRestoreProps {
  tenants: Tenant[];
  superAdminKey?: string;
}

const BackupRestore: React.FC<BackupRestoreProps> = ({ tenants, superAdminKey = SK }) => {
  const KEY = superAdminKey || SK;

  // ── Backup state ────────────────────────────────────────────────────────────
  const [backupTenant,  setBackupTenant]  = useState<string>('ALL');
  const [backupFormat,  setBackupFormat]  = useState<'json'|'sql'>('json');
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMsg,     setBackupMsg]     = useState('');

  // ── Restore state ───────────────────────────────────────────────────────────
  const [restoreFile,    setRestoreFile]    = useState<File|null>(null);
  const [restoreTenant,  setRestoreTenant]  = useState<string>('');
  const [restoreMode,    setRestoreMode]    = useState<'merge'|'replace'>('merge');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreResult,  setRestoreResult]  = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Download helper ─────────────────────────────────────────────────────────
  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Run backup ──────────────────────────────────────────────────────────────
  const runBackup = async () => {
    setBackupLoading(true); setBackupMsg('Fetching data from DB…');
    try {
      const tid   = backupTenant === 'ALL' ? '' : backupTenant;
      const query = `?key=${KEY}&format=${backupFormat}${tid ? `&tenantId=${tid}` : ''}`;
      const r     = await fetch(`${BASE}/api/admin/backup${query}`);
      if (!r.ok) throw new Error(await r.text());

      const blob     = await r.blob();
      const slug     = tid || 'full-db';
      const dt       = new Date().toISOString().slice(0,10);
      const filename = `royal-erp-backup-${slug}-${dt}.${backupFormat}`;
      triggerDownload(URL.createObjectURL(blob), filename);
      setBackupMsg(`✓ Downloaded: ${filename}`);
    } catch(e:any) {
      setBackupMsg('Error: ' + e.message);
    } finally { setBackupLoading(false); }
  };

  // ── Run restore ─────────────────────────────────────────────────────────────
  const runRestore = async () => {
    if (!restoreFile) { alert('Select a backup file first'); return; }
    if (!restoreTenant) { alert('Select target tenant'); return; }
    if (restoreMode === 'replace' && !confirm(
      `⚠️ REPLACE mode will DELETE all existing data for "${restoreTenant}" before restoring.\n\nAre you sure?`
    )) return;

    setRestoreLoading(true); setRestoreResult(null);
    try {
      const text   = await restoreFile.text();
      const parsed = JSON.parse(text);
      const query  = `?key=${KEY}&tenantId=${restoreTenant}&mode=${restoreMode}`;
      const r      = await fetch(`${BASE}/api/admin/restore${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const result = await r.json();
      setRestoreResult(result);
    } catch(e:any) {
      setRestoreResult({ error: e.message });
    } finally { setRestoreLoading(false); }
  };

  const tenantName = (id: string) => tenants.find(t=>t.id===id)?.name || id;

  return (
    <div className="space-y-8">

      {/* ── BACKUP ───────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-500/20 rounded-xl flex items-center justify-center">
            <i className="fas fa-cloud-download-alt text-blue-400"></i>
          </div>
          <div>
            <div className="text-white font-black text-sm">Create Backup</div>
            <div className="text-slate-400 text-[10px] font-bold">Export all data as JSON or SQL</div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Tenant selector */}
          <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Select Scope</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={()=>setBackupTenant('ALL')}
                className={`px-4 py-3 rounded-xl font-black text-[10px] uppercase border transition-all ${backupTenant==='ALL' ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/30'}`}>
                <i className="fas fa-database mr-2"></i>Full DB
              </button>
              <div className="relative">
                <select value={backupTenant} onChange={e=>setBackupTenant(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl font-black text-[10px] uppercase border appearance-none transition-all cursor-pointer ${backupTenant!=='ALL' ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/30'}`}>
                  <option value="ALL">Choose Tenant →</option>
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                  ))}
                </select>
              </div>
            </div>
            {backupTenant !== 'ALL' && (
              <div className="text-amber-400 text-[10px] font-bold px-1">
                <i className="fas fa-store mr-1"></i>Backing up: {tenantName(backupTenant)}
              </div>
            )}
          </div>

          {/* Format selector */}
          <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">File Format</label>
            <div className="grid grid-cols-2 gap-2">
              {(['json','sql'] as const).map(fmt => (
                <button key={fmt} onClick={()=>setBackupFormat(fmt)}
                  className={`px-4 py-3 rounded-xl font-black text-[10px] uppercase border transition-all flex items-center justify-center gap-2 ${backupFormat===fmt ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/30'}`}>
                  <i className={`fas ${fmt==='json' ? 'fa-code' : 'fa-file-code'}`}></i>
                  .{fmt.toUpperCase()}
                  {fmt==='json' && <span className="text-[8px] opacity-60">Restorable</span>}
                  {fmt==='sql' && <span className="text-[8px] opacity-60">MySQL import</span>}
                </button>
              ))}
            </div>
          </div>

          <button onClick={runBackup} disabled={backupLoading}
            className="w-full py-3.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2">
            {backupLoading
              ? <><i className="fas fa-spinner fa-spin"></i> Fetching data…</>
              : <><i className="fas fa-download"></i> Download Backup</>}
          </button>

          {backupMsg && (
            <div className={`text-[11px] font-bold px-4 py-2.5 rounded-xl ${backupMsg.startsWith('✓') ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border border-rose-500/20'}`}>
              {backupMsg}
            </div>
          )}
        </div>
      </div>

      {/* ── RESTORE ──────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-500/20 rounded-xl flex items-center justify-center">
            <i className="fas fa-cloud-upload-alt text-amber-400"></i>
          </div>
          <div>
            <div className="text-white font-black text-sm">Restore from Backup</div>
            <div className="text-slate-400 text-[10px] font-bold">Upload a .json backup file to restore data</div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* File drop zone */}
          <div
            onClick={()=>fileRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-6 cursor-pointer transition-all text-center ${restoreFile ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/20 hover:border-white/40 bg-white/5'}`}>
            <input ref={fileRef} type="file" accept=".json"
              className="hidden"
              onChange={e=>{ const f=e.target.files?.[0]; if(f) setRestoreFile(f); }} />
            {restoreFile ? (
              <div className="space-y-1">
                <div className="text-emerald-400 font-black text-sm"><i className="fas fa-check-circle mr-2"></i>{restoreFile.name}</div>
                <div className="text-slate-400 text-[10px] font-bold">{(restoreFile.size/1024).toFixed(1)} KB — click to change</div>
              </div>
            ) : (
              <div className="space-y-2">
                <i className="fas fa-file-upload text-slate-500 text-2xl"></i>
                <div className="text-slate-400 font-black text-xs">Click to select .json backup file</div>
                <div className="text-slate-600 text-[10px] font-bold">Only JSON backups can be restored (SQL is for external tools)</div>
              </div>
            )}
          </div>

          {/* Target tenant */}
          <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Restore to Tenant</label>
            <select value={restoreTenant} onChange={e=>setRestoreTenant(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white font-bold text-sm outline-none focus:border-amber-400">
              <option value="">Select target tenant…</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name} — {t.slug}</option>
              ))}
            </select>
          </div>

          {/* Restore mode */}
          <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Restore Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id:'merge',   label:'Merge',   icon:'fa-code-merge',  desc:'Add/update, keep existing' },
                { id:'replace', label:'Replace', icon:'fa-trash-alt',   desc:'Wipe first, then restore' },
              ].map(m => (
                <button key={m.id} onClick={()=>setRestoreMode(m.id as any)}
                  className={`px-3 py-3 rounded-xl font-black text-[10px] uppercase border transition-all text-left ${restoreMode===m.id ? (m.id==='replace' ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-emerald-500/20 border-emerald-500 text-emerald-400') : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/30'}`}>
                  <i className={`fas ${m.icon} mr-1`}></i>{m.label}
                  <div className="text-[8px] mt-0.5 font-bold opacity-70 normal-case">{m.desc}</div>
                </button>
              ))}
            </div>
            {restoreMode==='replace' && (
              <div className="text-rose-400 text-[10px] font-bold px-1 flex items-start gap-1">
                <i className="fas fa-exclamation-triangle mt-0.5"></i>
                Warning: All existing data for the selected tenant will be permanently deleted before restore.
              </div>
            )}
          </div>

          <button onClick={runRestore} disabled={restoreLoading || !restoreFile || !restoreTenant}
            className={`w-full py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${restoreMode==='replace' ? 'bg-rose-500 hover:bg-rose-600 text-white' : 'bg-amber-500 hover:bg-amber-600 text-white'}`}>
            {restoreLoading
              ? <><i className="fas fa-spinner fa-spin"></i> Restoring…</>
              : <><i className="fas fa-cloud-upload-alt"></i> {restoreMode==='replace'?'⚠ Replace & Restore':'Merge Restore'}</>}
          </button>

          {/* Restore result */}
          {restoreResult && (
            <div className={`rounded-xl p-4 space-y-2 border ${restoreResult.error ? 'bg-rose-500/10 border-rose-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
              <div className={`font-black text-sm ${restoreResult.error ? 'text-rose-400' : 'text-emerald-400'}`}>
                <i className={`fas ${restoreResult.error ? 'fa-times-circle' : 'fa-check-circle'} mr-2`}></i>
                {restoreResult.error ? 'Restore Failed' : 'Restore Complete'}
              </div>
              {restoreResult.restored && (
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(restoreResult.restored).map(([table, count]) => (
                    <div key={table} className="flex justify-between text-[10px] font-bold text-slate-400 bg-white/5 rounded-lg px-3 py-1.5">
                      <span>{table}</span>
                      <span className="text-white">{String(count)} rows</span>
                    </div>
                  ))}
                </div>
              )}
              {restoreResult.error && <div className="text-rose-300 text-[11px] font-mono">{restoreResult.error}</div>}
              {restoreResult.log?.length > 0 && (
                <div className="text-slate-500 text-[9px] font-mono space-y-0.5">
                  {restoreResult.log.map((l: string, i: number) => <div key={i}>{l}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── QUICK FIX TOOLS ──────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <div className="text-white font-black text-sm">Quick Fix Tools</div>
          <div className="text-slate-400 text-[10px] font-bold mt-0.5">One-time data repair operations</div>
        </div>
        <div className="p-6 space-y-3">
          <QuickFix
            label="Fix NULL tenant products"
            desc="Assign orphaned products (no tenant_id) to a specific tenant. Run after importing data before the isolation fix."
            action={async (tenantId: string) => {
              const r = await fetch(`${BASE}/api/admin/fix-null-tenants?key=${KEY}&tenantId=${tenantId}`, { method:'POST' });
              return r.json();
            }}
            tenants={tenants}
          />
          <QuickFix
            label="Reset user password"
            desc="Set a specific user's password directly in the DB."
            action={async (_tenantId: string, extra: any) => {
              const r = await fetch(`${BASE}/api/admin/reset-user-password?key=${KEY}`, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify(extra),
              });
              return r.json();
            }}
            tenants={tenants}
            extraFields={[
              { key:'email', label:'User Email', placeholder:'admin@shop.com' },
              { key:'newPassword', label:'New Password', placeholder:'newpass123' },
            ]}
          />
        </div>
      </div>
    </div>
  );
};

// ── Quick Fix helper component ──────────────────────────────────────────────
interface QFProps {
  label: string;
  desc: string;
  action: (tenantId: string, extra?: any) => Promise<any>;
  tenants: Tenant[];
  extraFields?: { key: string; label: string; placeholder: string }[];
}

const QuickFix: React.FC<QFProps> = ({ label, desc, action, tenants, extraFields }) => {
  const [open,     setOpen]     = useState(false);
  const [tenant,   setTenant]   = useState('');
  const [extra,    setExtra]    = useState<Record<string,string>>({});
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<any>(null);

  const run = async () => {
    if (!tenant) { alert('Select a tenant'); return; }
    setLoading(true); setResult(null);
    try {
      const payload = extraFields
        ? { ...extra, tenantId: tenant }
        : undefined;
      const r = await action(tenant, payload);
      setResult(r);
    } catch(e:any) { setResult({ error: e.message }); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      <button onClick={()=>setOpen(v=>!v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-all">
        <div className="text-left">
          <div className="text-white font-black text-xs">{label}</div>
          <div className="text-slate-500 text-[9px] font-bold mt-0.5">{desc}</div>
        </div>
        <i className={`fas fa-chevron-${open?'up':'down'} text-slate-500 text-xs`}></i>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-3">
          <select value={tenant} onChange={e=>setTenant(e.target.value)}
            className="w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold text-xs outline-none focus:border-amber-400">
            <option value="">Select tenant…</option>
            {tenants.map(t=><option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
          </select>
          {extraFields?.map(f => (
            <input key={f.key} type="text" placeholder={f.placeholder}
              value={extra[f.key]||''}
              onChange={e=>setExtra(prev=>({...prev,[f.key]:e.target.value}))}
              className="w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold text-xs outline-none focus:border-amber-400 placeholder:text-slate-600" />
          ))}
          <button onClick={run} disabled={loading}
            className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white rounded-xl font-black text-[10px] uppercase transition-all">
            {loading ? <><i className="fas fa-spinner fa-spin mr-1"></i>Running…</> : 'Run'}
          </button>
          {result && (
            <div className={`text-[10px] font-mono p-3 rounded-xl border ${result.error ? 'text-rose-300 bg-rose-500/10 border-rose-500/20' : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'}`}>
              {JSON.stringify(result, null, 2).slice(0, 400)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};



const STATUS_COLOR: Record<string,string> = {
  active:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  trial:    'bg-blue-100 text-blue-700 border-blue-200',
  expired:  'bg-rose-100 text-rose-600 border-rose-200',
  suspended:'bg-amber-100 text-amber-700 border-amber-200',
  cancelled:'bg-slate-100 text-slate-500 border-slate-200',
};
const PLAN_COLOR: Record<PlanId,{ bg:string; text:string; border:string; dot:string }> = {
  classic: { bg:'bg-slate-100', text:'text-slate-600', border:'border-slate-300', dot:'#64748b' },
  growth:  { bg:'bg-amber-100', text:'text-amber-700', border:'border-amber-300', dot:'#d97706' },
  pro:     { bg:'bg-purple-100', text:'text-purple-700', border:'border-purple-300', dot:'#7c3aed' },
};

interface Tenant { id:string; name:string; slug:string; owner_email:string; owner_phone:string; status:string; created_at:number }
interface TenantRow extends Tenant { sub: Subscription }

// ════════════════════════════════════════════════════════════
const SubscriptionPortal: React.FC<{ onClose?: () => void }> = ({ onClose }) => {

  // ── Plan feature config (operational matrix) ─────────────────────────────────
  const [planFeatures, setPlanFeatures] = useState<Record<PlanId,string[]>>(loadPlanFeatures);
  const savePlanFeatures = (pf: Record<PlanId,string[]>) => { setPlanFeatures(pf); save('royal_plan_features', pf); };

  const togglePlanFeature = (planId: PlanId, featureId: string) => {
    const cur  = planFeatures[planId] || [];
    const next = cur.includes(featureId) ? cur.filter(f=>f!==featureId) : [...cur, featureId];
    savePlanFeatures({ ...planFeatures, [planId]: next });
  };

  // ── Add Shop form ──────────────────────────────────────────────────────────
  const [addShopOpen,  setAddShopOpen]  = useState(false);
  const [sName,        setSName]        = useState('');
  const [sEmail,       setSEmail]       = useState('');
  const [sPass,        setSPass]        = useState('');
  const [sPhone,       setSPhone]       = useState('');
  const [sAddress,     setSAddress]     = useState('');
  const [sGst,         setSGst]         = useState('');
  const [sPlan,        setSPlan]        = useState<PlanId>('growth');
  const [sLoading,     setSLoading]     = useState(false);
  const [sMsg,         setSMsg]         = useState('');

  const createShop = async () => {
    if (!sName||!sEmail||!sPass) return;
    setSLoading(true); setSMsg('');
    try {
      const res = await fetch(`${BASE}/api/superadmin/tenants`, {
        method:'POST', headers:{'Content-Type':'application/json','x-super-admin-key':SK},
        body: JSON.stringify({ shopName:sName, ownerEmail:sEmail, password:sPass, phone:sPhone, address:sAddress, gst:sGst, plan:sPlan }),
      });
      const data = await res.json();
      if (!res.ok) { setSMsg(data.error||'Failed'); return; }
      setSMsg(`✓ Shop "${sName}" created! Login: /?tenant=${data.tenant?.slug}`);
      setSName(''); setSEmail(''); setSPass(''); setSPhone(''); setSAddress(''); setSGst('');
      setAddShopOpen(false);
      loadTenants();
    } catch(e:any) { setSMsg(e.message); }
    finally { setSLoading(false); }
  };

  // ── Auth ────────────────────────────────────────────────────────────────────
  const [admins,    setAdmins]    = useState<AdminUser[]>(() => load('royal_sub_admins', defaultAdmins));
  const [me,        setMe]        = useState<AdminUser | null>(() => load('royal_sub_session', null));
  const [loginEmail,setLoginEmail]= useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr,  setLoginErr]  = useState('');
  const saveAdmins  = (a: AdminUser[]) => { setAdmins(a); save('royal_sub_admins', a); };

  const doLogin = () => {
    const u = admins.find(a => a.email.toLowerCase() === loginEmail.toLowerCase() && a.password === loginPass);
    if (!u) { setLoginErr('Invalid email or password'); return; }
    setMe(u); save('royal_sub_session', u);
  };
  const doLogout = () => { setMe(null); save('royal_sub_session', null); };

  // ── Nav ─────────────────────────────────────────────────────────────────────
  const [page,      setPage]      = useState('dashboard');
  const [sideOpen,  setSideOpen]  = useState(true);

  // ── Data ────────────────────────────────────────────────────────────────────
  const [tenants,   setTenants]   = useState<TenantRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [payments,  setPayments]  = useState<PaymentRecord[]>(() => load('royal_payments', []));
  const [tickets,   setTickets]   = useState<SupportTicket[]>(() => load('royal_tickets', []));
  const savePay = (p: PaymentRecord[]) => { setPayments(p); save('royal_payments', p); };
  const saveTix = (t: SupportTicket[]) => { setTickets(t);  save('royal_tickets', t);  };

  const defaultSub = (tenantId: string): Subscription => ({
    tenantId, planId:'growth', status:'trial', billingCycle:'monthly',
    startDate:today(), endDate:addD(today(),14), trialEndsAt:addD(today(),14),
    featureOverrides:{}, autoRenew:false,
  });

  const loadTenants = () => {
    setLoading(true);
    fetch(`${BASE}/api/superadmin/tenants`, { headers: { 'x-super-admin-key': SK } })
      .then(r => r.json())
      .then(data => {
        const subs: Record<string,Subscription> = load('royal_subscriptions', {});

        // Always include the owner's shop (royal-mudhol) as first entry
        const defaultShop: Tenant = {
          id: 'royal-mudhol-d81d2d03', name: 'Royal Tiles & Granites (Owner)', slug: 'royal-mudhol',
          owner_email: 'admin@royal.com', owner_phone: '',
          status: 'active', created_at: 0,
        };
        const defaultSubs: Record<string,Subscription> = {
          'royal-mudhol-d81d2d03': subs['royal-mudhol-d81d2d03'] || {
            tenantId: 'royal-mudhol-d81d2d03', planId: 'pro', status: 'active',
            billingCycle: 'yearly', startDate: '2024-01-01', endDate: '2099-12-31',
            featureOverrides: {}, autoRenew: true,
            notes: 'Owner shop — full Pro access permanently',
          },
        };

        const allTenants = [
          { ...defaultShop, sub: defaultSubs['royal-mudhol-d81d2d03'] },
          ...(data.tenants||[]).map((t: Tenant) => ({ ...t, sub: subs[t.id] || defaultSub(t.id) })),
        ];
        setTenants(allTenants);
        // Save default sub if not already saved
        if (!subs['royal-mudhol-d81d2d03']) {
          const updated = { ...subs, ...defaultSubs };
          save('royal_subscriptions', updated);
        }
      })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  };

  useEffect(() => { if (me) loadTenants(); }, [me]);

  const saveSubs = (rows: TenantRow[]) => {
    const map: Record<string,Subscription> = {};
    rows.forEach(r => { map[r.id] = r.sub; });
    save('royal_subscriptions', map);
    setTenants(rows);
  };

  // ── Selected tenant for modals ───────────────────────────────────────────────
  const [sel,       setSel]       = useState<TenantRow|null>(null);
  const [modal,     setModal]     = useState<'edit'|'pay'|'ticket'|null>(null);

  // ── Edit subscription form ───────────────────────────────────────────────────
  const [ePlan,     setEPlan]     = useState<PlanId>('growth');
  const [eStatus,   setEStatus]   = useState<Subscription['status']>('active');
  const [eCycle,    setECycle]    = useState<'monthly'|'yearly'>('monthly');
  const [eEnd,      setEEnd]      = useState(addM(1));
  const [ePrice,    setEPrice]    = useState(0);
  const [eNotes,    setENotes]    = useState('');
  const [eOver,     setEOver]     = useState<Record<string,boolean>>({});

  const openEdit = (t: TenantRow) => {
    setSel(t);
    setEPlan(t.sub.planId); setEStatus(t.sub.status); setECycle(t.sub.billingCycle);
    setEEnd(t.sub.endDate); setEPrice(t.sub.customPrice||PLAN_MAP[t.sub.planId]?.price||0);
    setENotes(t.sub.notes||''); setEOver({...t.sub.featureOverrides}); setModal('edit');
  };

  const saveEdit = () => {
    if (!sel) return;
    const token = makeSubscriptionToken(sel.id, ePlan, eEnd);
    const sub: Subscription = {
      tenantId:sel.id, planId:ePlan, status:eStatus, billingCycle:eCycle,
      startDate:today(), endDate:eEnd, featureOverrides:eOver, autoRenew:false,
      customPrice: ePrice!==PLAN_MAP[ePlan]?.price ? ePrice : undefined,
      notes:eNotes, token,
    };
    saveSubs(tenants.map(t => t.id===sel.id ? {...t,sub} : t));
    setModal(null);
  };

  // ── Payment form ─────────────────────────────────────────────────────────────
  const [pAmt,  setPAmt]  = useState(0);
  const [pMeth, setPMeth] = useState<'upi'|'cash'|'bank_transfer'|'cheque'|'online'>('upi');
  const [pRef,  setPRef]  = useState('');
  const [pNote, setPNote] = useState('');

  const recordPay = () => {
    if (!sel||!pAmt) return;
    const p: PaymentRecord = {
      id:`pay-${Date.now()}`, tenantId:sel.id, tenantName:sel.name,
      amount:pAmt, currency:'INR', method:pMeth, reference:pRef,
      planId:sel.sub.planId,
      period:new Date().toLocaleDateString('en-IN',{month:'short',year:'numeric'}),
      date:today(), status:'paid', notes:pNote, recordedBy:me?.name||'Admin',
    };
    savePay([p,...payments]);
    saveSubs(tenants.map(t => t.id===sel.id ? {...t, sub:{...t.sub,status:'active' as const, endDate:addM(eCycle==='yearly'?12:1), lastPayment:p}} : t));
    setModal(null); setPAmt(0); setPRef(''); setPNote('');
  };

  // ── QR Code modal ────────────────────────────────────────────────────────────
  const [qrTenant, setQrTenant] = useState<TenantRow|null>(null);
  const [qrCanvas,  setQrCanvas]  = useState<string>('');

  const showQR = async (t: TenantRow) => {
    setQrTenant(t);
    // Build the configure URL — scanning this installs the shop config permanently
    const configUrl = `${BASE}/?tenant=${t.slug}&configure=1`;
    // Draw QR with inline SVG-based grid (no external lib needed)
    try {
      const QRCode = await import('qrcode');
      const url = await QRCode.toDataURL(configUrl, { width:280, margin:2, color:{ dark:'#0f172a', light:'#ffffff' } });
      setQrCanvas(url);
    } catch {
      // Fallback: show the URL as text
      setQrCanvas('');
    }
  };

  // ── Ticket form ──────────────────────────────────────────────────────────────
  const [tSubj, setTSubj] = useState('');
  const [tDesc, setTDesc] = useState('');
  const [tCat,  setTCat]  = useState<SupportTicket['category']>('general');
  const [tPri,  setTPri]  = useState<SupportTicket['priority']>('medium');

  const raiseTix = () => {
    if (!sel||!tSubj) return;
    const t: SupportTicket = {
      id:`tix-${Date.now()}`, tenantId:sel.id, tenantName:sel.name,
      subject:tSubj, description:tDesc, category:tCat, priority:tPri,
      status:'open', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), responses:[],
    };
    saveTix([t,...tickets]);
    setModal(null); setTSubj(''); setTDesc('');
  };

  // ── Admin users form ─────────────────────────────────────────────────────────
  const [aName, setAName] = useState('');
  const [aEmail,setAEmail]= useState('');
  const [aPass, setAPass] = useState('');
  const [aRole, setARole] = useState<AdminUser['role']>('admin');

  const addAdmin = () => {
    if (!aName||!aEmail||!aPass) return;
    const u: AdminUser = { id:`adm-${Date.now()}`, name:aName, email:aEmail, password:aPass, role:aRole, createdAt:today() };
    saveAdmins([...admins, u]);
    setAName(''); setAEmail(''); setAPass('');
  };

  // ── Stats ────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:   tenants.length,
    active:  tenants.filter(t=>t.sub.status==='active').length,
    trial:   tenants.filter(t=>t.sub.status==='trial').length,
    expired: tenants.filter(t=>daysRemaining(t.sub)<=0&&t.sub.status!=='active').length,
    mrr:     tenants.filter(t=>t.sub.status==='active').reduce((s,t)=>s+(t.sub.customPrice||PLAN_MAP[t.sub.planId]?.price||0),0),
    collected:payments.filter(p=>p.status==='paid').reduce((s,p)=>s+p.amount,0),
    openTix: tickets.filter(t=>t.status==='open').length,
    byPlan:  PLANS.map(p=>({ plan:p, count:tenants.filter(t=>t.sub.planId===p.id&&t.sub.status==='active').length })),
  }), [tenants, payments, tickets]);

  // ── Styles ───────────────────────────────────────────────────────────────────
  const inp  = "w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-amber-400 focus:bg-white transition-all";
  const lbl  = "text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";
  const btn  = "px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wide transition-all active:scale-95";

  // ════════════════════════════════════════════════════════════
  // LOGIN PAGE
  // ════════════════════════════════════════════════════════════
  if (!me) return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center z-50 p-4">
      {onClose && <button onClick={onClose} className="absolute top-6 right-6 w-9 h-9 bg-white/10 text-white rounded-xl flex items-center justify-center hover:bg-white/20 font-black">✕</button>}

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-900/40">
            <i className="fas fa-crown text-white text-2xl"></i>
          </div>
          <h1 className="text-white font-black text-2xl tracking-tight">Royal ERP</h1>
          <p className="text-slate-400 font-bold text-sm mt-1">Subscription Admin Portal</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[28px] p-8 shadow-2xl">
          <h2 className="text-white font-black text-xl mb-6">Sign In</h2>

          <div className="space-y-4">
            <div>
              <label className="text-slate-400 font-bold text-xs block mb-1.5">Email Address</label>
              <input type="email" autoFocus
                className="w-full px-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white font-medium outline-none focus:border-amber-400 focus:bg-white/15 transition-all placeholder:text-slate-500 text-sm"
                placeholder="admin@royalerp.in"
                value={loginEmail} onChange={e=>setLoginEmail(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&doLogin()} />
            </div>
            <div>
              <label className="text-slate-400 font-bold text-xs block mb-1.5">Password</label>
              <input type="password"
                className="w-full px-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white font-medium outline-none focus:border-amber-400 focus:bg-white/15 transition-all placeholder:text-slate-500 text-sm"
                placeholder="••••••••"
                value={loginPass} onChange={e=>setLoginPass(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&doLogin()} />
            </div>
            {loginErr && <div className="text-rose-400 font-bold text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-2.5">{loginErr}</div>}
            <button onClick={doLogin}
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg shadow-amber-900/30 active:scale-98">
              Sign In to Portal
            </button>
          </div>

        {/* Staff login shortcut */}
        <div className="mt-6 pt-6 border-t border-white/10 space-y-3">
          <div className="text-slate-500 text-[10px] font-bold text-center uppercase tracking-widest">Staff / Shop Login</div>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white font-mono text-sm outline-none focus:border-amber-400 transition-all placeholder:text-slate-600"
              placeholder="Shop code (e.g. royal-mudhol)"
              id="staff-shop-code"
              autoCapitalize="none" autoCorrect="off"
            />
            <button
              onClick={() => {
                const code = (document.getElementById('staff-shop-code') as HTMLInputElement)?.value?.trim();
                if (code) window.location.href = `/?tenant=${code}`;
                else alert('Enter your shop code first');
              }}
              className="px-4 py-2.5 bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-xl font-black text-[10px] uppercase hover:bg-amber-500/30 transition-all">
              Go →
            </button>
          </div>
          <p className="text-slate-600 text-[9px] font-bold text-center">Ask your admin for your shop code</p>
        </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // MAIN PORTAL
  // ════════════════════════════════════════════════════════════
  const curNav = NAV.find(n=>n.id===page)!;
  const openTixCount = tickets.filter(t=>t.status==='open').length;

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-100 overflow-hidden">

      {/* ── SIDEBAR ── */}
      <aside className={`${sideOpen?'w-64':'w-16'} bg-slate-900 flex flex-col transition-all duration-300 shrink-0 overflow-hidden`}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-800">
          <div className="w-9 h-9 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg">
            <i className="fas fa-crown text-white text-sm"></i>
          </div>
          {sideOpen && (
            <div className="min-w-0">
              <div className="text-white font-black text-sm truncate">Royal ERP</div>
              <div className="text-slate-500 font-bold text-[9px] uppercase tracking-widest">Admin Portal</div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
          {NAV.map(n => {
            const isActive = page === n.id;
            const badge = n.id==='tickets' && openTixCount > 0 ? openTixCount : 0;
            return (
              <button key={n.id} onClick={()=>setPage(n.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative ${
                  isActive ? 'bg-amber-500 text-white shadow-lg shadow-amber-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                <i className={`fas ${n.icon} text-sm shrink-0 ${isActive?'text-white':'text-slate-500 group-hover:text-slate-300'}`}></i>
                {sideOpen && <span className="font-black text-[11px] uppercase tracking-wide truncate">{n.label}</span>}
                {badge > 0 && (
                  <span className={`ml-auto shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black ${isActive?'bg-white text-amber-600':'bg-rose-500 text-white'}`}>{badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User + collapse */}
        <div className="border-t border-slate-800 p-3 space-y-2">
          {sideOpen && (
            <div className="flex items-center gap-2.5 px-2 py-2">
              <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center font-black text-white text-sm shrink-0">{me.name[0]}</div>
              <div className="min-w-0">
                <div className="text-white font-black text-[11px] truncate">{me.name}</div>
                <div className="text-slate-500 text-[9px] font-bold capitalize">{me.role}</div>
              </div>
            </div>
          )}
          <button onClick={doLogout}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-500 hover:bg-slate-800 hover:text-white transition-all ${sideOpen?'':'justify-center'}`}>
            <i className="fas fa-sign-out-alt text-sm shrink-0"></i>
            {sideOpen && <span className="font-bold text-[10px] uppercase">Sign Out</span>}
          </button>
          <button onClick={()=>setSideOpen(v=>!v)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-500 hover:bg-slate-800 hover:text-white transition-all ${sideOpen?'':'justify-center'}`}>
            <i className={`fas fa-chevron-${sideOpen?'left':'right'} text-sm shrink-0`}></i>
            {sideOpen && <span className="font-bold text-[10px] uppercase">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm">
          <div>
            <h1 className="font-black text-slate-900 text-xl">{curNav.label}</h1>
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-0.5">
              {page==='dashboard' && `${stats.total} shops · ${INR(stats.mrr)}/mo MRR`}
              {page==='subscribers' && `${stats.active} active · ${stats.trial} trial · ${stats.expired} expired`}
              {page==='payments' && `${INR(stats.collected)} total collected`}
              {page==='tickets' && `${stats.openTix} open tickets`}
              {page==='admins' && `${admins.length} admin users`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {onClose && <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase hover:bg-slate-200">✕ Close</button>}
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ══ DASHBOARD ══ */}
          {page==='dashboard' && (
            <div className="space-y-6">
              {/* KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label:'Total Shops',   value:stats.total,        icon:'fa-store',        color:'bg-slate-900',   text:'text-white' },
                  { label:'Active',        value:stats.active,       icon:'fa-check-circle', color:'bg-emerald-500', text:'text-white' },
                  { label:'Monthly MRR',   value:INR(stats.mrr),    icon:'fa-rupee-sign',   color:'bg-amber-500',   text:'text-white' },
                  { label:'Open Tickets',  value:stats.openTix,     icon:'fa-ticket-alt',   color:'bg-purple-600',  text:'text-white' },
                ].map(k => (
                  <div key={k.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center gap-4">
                    <div className={`w-12 h-12 ${k.color} rounded-xl flex items-center justify-center shrink-0 shadow-md`}>
                      <i className={`fas ${k.icon} ${k.text} text-lg`}></i>
                    </div>
                    <div>
                      <div className="font-black text-slate-900 text-2xl">{k.value}</div>
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{k.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Plan distribution */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {stats.byPlan.map(({plan,count}) => {
                  const pc = PLAN_COLOR[plan.id];
                  return (
                    <div key={plan.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm" style={{borderTop:`3px solid ${plan.color}`}}>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <div className="font-black text-slate-900 text-lg">{plan.name}</div>
                          <div className="text-slate-400 font-bold text-[10px]">{plan.tagline}</div>
                        </div>
                        <div className={`text-3xl font-black`} style={{color:plan.color}}>{count}</div>
                      </div>
                      <div className="space-y-1 text-[10px] font-bold text-slate-500">
                        <div className="flex justify-between"><span>Price</span><span className="font-black text-slate-900">{INR(plan.price)}/mo</span></div>
                        <div className="flex justify-between"><span>Revenue</span><span className="font-black text-emerald-700">{INR(count*plan.price)}/mo</span></div>
                        <div className="flex justify-between"><span>Features</span><span>{plan.features.length}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Recent activity */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                  <div className="font-black text-slate-700 mb-4">Recent Payments</div>
                  {payments.slice(0,5).length===0 ? <p className="text-slate-400 font-bold text-sm">No payments yet</p> :
                    payments.slice(0,5).map(p=>(
                      <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                        <div>
                          <div className="font-black text-slate-800 text-sm">{p.tenantName}</div>
                          <div className="text-[9px] text-slate-400 font-bold">{p.date} · {p.method}</div>
                        </div>
                        <div className="font-black text-emerald-700">{INR(p.amount)}</div>
                      </div>
                    ))
                  }
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                  <div className="font-black text-slate-700 mb-4">Recent Tickets</div>
                  {tickets.slice(0,5).length===0 ? <p className="text-slate-400 font-bold text-sm">No tickets yet</p> :
                    tickets.slice(0,5).map(t=>(
                      <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                        <div>
                          <div className="font-black text-slate-800 text-sm truncate max-w-[200px]">{t.subject}</div>
                          <div className="text-[9px] text-slate-400 font-bold">{t.tenantName}</div>
                        </div>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${t.priority==='critical'?'bg-rose-100 text-rose-600 border-rose-200':t.priority==='high'?'bg-amber-100 text-amber-700 border-amber-200':'bg-slate-100 text-slate-500 border-slate-200'}`}>{t.priority}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          )}

          {/* ══ SUBSCRIBERS ══ */}
          {page==='subscribers' && (
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-24"><div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div></div>
              ) : tenants.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 py-24 text-center">
                  <i className="fas fa-store text-4xl text-slate-200 mb-3 block"></i>
                  <div className="font-black text-slate-400 text-lg">No shops registered</div>
                  <div className="text-slate-400 font-bold text-sm mt-1">Go to Setup panel to add shops</div>
                </div>
              ) : tenants.map(t => {
                const plan  = PLAN_MAP[t.sub.planId];
                const days  = daysRemaining(t.sub);
                const pc    = PLAN_COLOR[t.sub.planId];
                const isWarn = days<=7 && days>0 && t.sub.status!=='expired';
                return (
                  <div key={t.id} className={`bg-white rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm hover:shadow-md transition-all ${isWarn?'border-amber-200':t.sub.status==='expired'?'border-rose-200':'border-slate-200'}`}>
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-lg shrink-0" style={{background:plan?.color+'20', color:plan?.color}}>
                        {t.name[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-900">{t.name}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${pc.bg} ${pc.text} ${pc.border}`}>{plan?.name||t.sub.planId}</span>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${STATUS_COLOR[t.sub.status]||'bg-slate-100 text-slate-500 border-slate-200'}`}>{t.sub.status.toUpperCase()}</span>
                          {isWarn && <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">⚠ {days}d left</span>}
                        </div>
                        <div className="text-[9px] text-slate-400 font-bold mt-0.5 flex gap-3 flex-wrap">
                          <span><i className="fas fa-envelope text-[8px] mr-1"></i>{t.owner_email}</span>
                          {t.owner_phone && <span><i className="fas fa-phone text-[8px] mr-1"></i>{t.owner_phone}</span>}
                          <span><i className="fas fa-calendar text-[8px] mr-1"></i>Expires {fmtDate(t.sub.endDate)}</span>
                          {t.sub.token && <span className="font-mono text-[8px] text-slate-400"><i className="fas fa-key text-[8px] mr-1"></i>{t.sub.token.slice(0,20)}…</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <div className="font-black text-slate-900">{INR(t.sub.customPrice||plan?.price||0)}</div>
                        <div className="text-[8px] text-slate-400 font-bold">/month</div>
                      </div>
                      <button onClick={()=>{setSel(t);setModal('pay');}}
                        className={`${btn} bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100`}>
                        <i className="fas fa-rupee-sign text-[9px] mr-1"></i>Pay
                      </button>
                      <button onClick={()=>openEdit(t)}
                        className={`${btn} bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100`}>
                        <i className="fas fa-cog text-[9px] mr-1"></i>Manage
                      </button>
                      <button onClick={()=>{setSel(t);setModal('ticket');}}
                        className={`${btn} bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100`}>
                        <i className="fas fa-ticket-alt text-[9px] mr-1"></i>Ticket
                      </button>
                      <button onClick={()=>showQR(t)}
                        className={`${btn} bg-slate-900 text-white hover:bg-amber-600`}>
                        <i className="fas fa-qrcode text-[9px] mr-1"></i>QR
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ ADD SHOP ══ */}
          {page==='add_shop' && (
            <div className="max-w-2xl space-y-5">
              {sMsg && <div className={`rounded-2xl px-5 py-3.5 font-bold text-sm border ${sMsg.startsWith('✓')?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-rose-50 text-rose-600 border-rose-200'}`}>{sMsg}</div>}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                <div>
                  <div className="font-black text-slate-900 text-xl">Add New Shop</div>
                  <div className="text-slate-400 font-bold text-sm mt-1">Creates isolated data space, admin user and login URL</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2"><label className={lbl}>Shop / Showroom Name *</label><input className={inp} placeholder="e.g. Royal Tiles & Granites, Kadapa" value={sName} onChange={e=>setSName(e.target.value)}/></div>
                  <div><label className={lbl}>Admin Email *</label><input type="email" className={inp} placeholder="admin@shop.com" value={sEmail} onChange={e=>setSEmail(e.target.value)}/></div>
                  <div><label className={lbl}>Admin Password *</label><input type="text" className={inp} placeholder="Set a strong password" value={sPass} onChange={e=>setSPass(e.target.value)}/></div>
                  <div><label className={lbl}>Phone</label><input className={inp} placeholder="9876543210" value={sPhone} onChange={e=>setSPhone(e.target.value)}/></div>
                  <div><label className={lbl}>GST Number</label><input className={inp} placeholder="29XXXXX1234Z1Z5" value={sGst} onChange={e=>setSGst(e.target.value)}/></div>
                  <div className="col-span-2"><label className={lbl}>Address</label><input className={inp} placeholder="Full showroom address" value={sAddress} onChange={e=>setSAddress(e.target.value)}/></div>
                  <div className="col-span-2">
                    <label className={lbl}>Starting Plan</label>
                    <div className="grid grid-cols-3 gap-3">
                      {PLANS.map(p=>(
                        <button key={p.id} type="button" onClick={()=>setSPlan(p.id)}
                          className={`border-2 rounded-xl p-3 text-left transition-all ${sPlan===p.id?'border-amber-500 bg-amber-50':'border-slate-200 hover:border-amber-200'}`}>
                          <div className="font-black text-slate-900 text-sm">{p.name}</div>
                          <div className="font-black text-amber-600">{INR(p.price)}/mo</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button onClick={createShop} disabled={sLoading||!sName||!sEmail||!sPass}
                  className="w-full py-4 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                  {sLoading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>Creating…</> : <><i className="fas fa-plus-circle text-xs"></i>Create Shop</>}
                </button>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-[10px] font-bold text-amber-700 space-y-1">
                <div className="font-black text-sm mb-2">What gets created automatically:</div>
                <div>✓ Unique shop ID and login slug</div>
                <div>✓ Isolated data space — data never mixes with other shops</div>
                <div>✓ Admin user account with the credentials you set</div>
                <div>✓ Default categories, settings and subscription (trial 14 days)</div>
                <div>✓ Login URL: <code className="bg-amber-100 px-1 rounded">yourapp.com/?tenant=shop-slug</code></div>
              </div>
            </div>
          )}

          {/* ══ PLANS & OPERATIONAL FEATURE MATRIX ══ */}
          {page==='plans' && (
            <div className="space-y-6">
              {/* Plan summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {PLANS.map(p => {
                  const enabledCount = (planFeatures[p.id]||[]).length;
                  return (
                    <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm" style={{borderTop:`4px solid ${p.color}`}}>
                      <div className="p-5">
                        <div className="flex justify-between items-start">
                          <div><div className="font-black text-slate-900 text-xl">{p.name}</div><div className="text-slate-400 font-bold text-[10px] mt-0.5">{p.tagline}</div></div>
                          <div className="text-right">
                            <div className="font-black text-2xl" style={{color:p.color}}>{INR(p.price)}</div>
                            <div className="text-[8px] text-slate-400 font-bold">/month</div>
                          </div>
                        </div>
                        <div className="flex gap-3 mt-3 text-[9px] font-black text-slate-500">
                          <span>👥 {p.limits.users===-1?'∞':p.limits.users} users</span>
                          <span>📦 {p.limits.products===-1?'∞':p.limits.products} products</span>
                          <span>🏪 {p.limits.locations===-1?'∞':p.limits.locations} locations</span>
                        </div>
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <span className="font-black text-slate-900">{enabledCount}</span>
                          <span className="text-[9px] font-bold text-slate-400"> / {FEATURES.length} features enabled</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Operational Feature Matrix */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="font-black text-slate-900">Feature Matrix — Operational</div>
                    <div className="text-[9px] font-bold text-slate-400 mt-0.5">
                      Click any checkbox to enable/disable per plan ·
                      <span className="text-amber-600"> Shop-level admin overrides are never affected</span>
                    </div>
                  </div>
                  <button onClick={()=>savePlanFeatures({classic:PLANS[0].features,growth:PLANS[1].features,pro:PLANS[2].features})}
                    className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg font-black text-[9px] uppercase hover:bg-slate-200">
                    Reset to Defaults
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-3 text-left font-black text-[9px] text-slate-400 uppercase tracking-widest w-56">Feature</th>
                        {PLANS.map(p=>(
                          <th key={p.id} className="px-4 py-3 text-center w-32">
                            <div className="font-black text-[11px] uppercase" style={{color:p.color}}>{p.name}</div>
                            <div className="text-[8px] font-bold text-slate-400">{(planFeatures[p.id]||[]).length} enabled</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(FEATURES.reduce((g,f)=>{(g[f.category]=g[f.category]||[]).push(f);return g;},{} as Record<string,typeof FEATURES>)).map(([cat,feats])=>(
                        <React.Fragment key={cat}>
                          <tr className="bg-slate-50">
                            <td colSpan={4} className="px-5 py-2 font-black text-[8px] text-slate-400 uppercase tracking-widest">{cat}</td>
                          </tr>
                          {feats.map(f=>(
                            <tr key={f.id} className="border-b border-slate-50 hover:bg-amber-50/30 transition-colors">
                              <td className="px-5 py-3">
                                <div className="font-bold text-slate-800 text-[11px]">{f.name}</div>
                                <div className="text-[8px] text-slate-400 mt-0.5">{f.description}</div>
                              </td>
                              {PLANS.map(p=>{
                                const enabled = (planFeatures[p.id]||[]).includes(f.id);
                                return (
                                  <td key={p.id} className="px-4 py-3 text-center">
                                    <button type="button"
                                      onClick={()=>togglePlanFeature(p.id,f.id)}
                                      title={enabled ? `Disable for ${p.name}` : `Enable for ${p.name}`}
                                      className={`w-8 h-8 rounded-xl border-2 flex items-center justify-center mx-auto transition-all active:scale-90 hover:scale-110 ${
                                        enabled
                                          ? 'border-transparent text-white shadow-md'
                                          : 'border-slate-200 bg-white text-slate-300 hover:border-slate-400'
                                      }`}
                                      style={enabled ? {background: p.color, borderColor: p.color} : {}}>
                                      <i className={`fas ${enabled?'fa-check':'fa-times'} text-[10px]`}></i>
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t-2 border-slate-200">
                        <td className="px-5 py-3 font-black text-[9px] text-slate-500 uppercase">Totals</td>
                        {PLANS.map(p=>(
                          <td key={p.id} className="px-4 py-3 text-center">
                            <span className="font-black text-slate-900">{(planFeatures[p.id]||[]).length}</span>
                            <span className="text-[8px] text-slate-400 font-bold"> / {FEATURES.length}</span>
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══ PAYMENTS ══ */}
          {page==='payments' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label:'Total Collected', value:INR(stats.collected),                    color:'text-emerald-700', bg:'bg-emerald-50' },
                  { label:'This Month',      value:INR(payments.filter(p=>p.date.startsWith(today().slice(0,7))).reduce((s,p)=>s+p.amount,0)), color:'text-amber-700', bg:'bg-amber-50' },
                  { label:'Transactions',    value:payments.length,                          color:'text-slate-900',   bg:'bg-white' },
                  { label:'Pending',         value:payments.filter(p=>p.status==='pending').length, color:'text-rose-600', bg:'bg-rose-50' },
                ].map(k=>(
                  <div key={k.label} className={`${k.bg} border border-slate-200 rounded-2xl p-4 shadow-sm`}>
                    <div className={`font-black text-2xl ${k.color}`}>{k.value}</div>
                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{k.label}</div>
                  </div>
                ))}
              </div>
              {payments.length===0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 py-20 text-center"><i className="fas fa-rupee-sign text-4xl text-slate-200 block mb-3"></i><div className="font-black text-slate-400">No payments recorded</div></div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead><tr className="bg-slate-50 border-b border-slate-200">
                        {['Date','Shop','Plan','Amount','Method','Reference','Period','Status'].map(h=>(
                          <th key={h} className="px-4 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody className="divide-y divide-slate-50">
                        {payments.map(p=>{
                          const pc = PLAN_COLOR[p.planId];
                          return (
                            <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-4 py-3 font-bold text-slate-600 whitespace-nowrap">{fmtDate(p.date)}</td>
                              <td className="px-4 py-3 font-black text-slate-900">{p.tenantName}</td>
                              <td className="px-4 py-3"><span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${pc.bg} ${pc.text}`}>{PLAN_MAP[p.planId]?.name||p.planId}</span></td>
                              <td className="px-4 py-3 font-black text-emerald-700">{INR(p.amount)}</td>
                              <td className="px-4 py-3 font-bold text-slate-600 capitalize">{p.method.replace('_',' ')}</td>
                              <td className="px-4 py-3 font-mono text-slate-500 text-[9px]">{p.reference||'—'}</td>
                              <td className="px-4 py-3 font-bold text-slate-600">{p.period}</td>
                              <td className="px-4 py-3"><span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${p.status==='paid'?'bg-emerald-100 text-emerald-700':p.status==='pending'?'bg-amber-100 text-amber-700':'bg-rose-100 text-rose-600'}`}>{p.status}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ TICKETS ══ */}
          {page==='tickets' && (
            <div className="space-y-3">
              {tickets.length===0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 py-20 text-center"><i className="fas fa-ticket-alt text-4xl text-slate-200 block mb-3"></i><div className="font-black text-slate-400">No support tickets yet</div></div>
              ) : tickets.map(t=>(
                <div key={t.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${t.priority==='critical'?'border-rose-300 bg-rose-50/30':t.priority==='high'?'border-amber-200':'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-900">{t.subject}</span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${t.priority==='critical'?'bg-rose-100 text-rose-600 border-rose-200':t.priority==='high'?'bg-amber-100 text-amber-700 border-amber-200':t.priority==='medium'?'bg-blue-100 text-blue-700 border-blue-200':'bg-slate-100 text-slate-500 border-slate-200'}`}>{t.priority}</span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${t.status==='open'?'bg-emerald-100 text-emerald-700 border-emerald-200':t.status==='in_progress'?'bg-blue-100 text-blue-700 border-blue-200':'bg-slate-100 text-slate-500 border-slate-200'}`}>{t.status.replace('_',' ')}</span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200`}>{t.category.replace('_',' ')}</span>
                      </div>
                      <div className="text-[9px] text-slate-400 font-bold mt-1">{t.tenantName} · {fmtDate(t.createdAt)}</div>
                      {t.description && <p className="text-sm text-slate-600 font-medium mt-2 leading-relaxed">{t.description}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {t.status==='open' && <button onClick={()=>saveTix(tickets.map(x=>x.id===t.id?{...x,status:'in_progress' as const,updatedAt:new Date().toISOString()}:x))} className={`${btn} bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100`}>In Progress</button>}
                      {t.status!=='resolved' && <button onClick={()=>saveTix(tickets.map(x=>x.id===t.id?{...x,status:'resolved' as const,updatedAt:new Date().toISOString()}:x))} className={`${btn} bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100`}>Resolve</button>}
                      <button onClick={()=>saveTix(tickets.filter(x=>x.id!==t.id))} className={`${btn} bg-slate-100 text-slate-500 hover:bg-slate-200`}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ══ ADMIN USERS ══ */}
          {page==='admins' && (
            <div className="space-y-5">
              {/* Add admin form */}
              {me.role==='super' && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                  <div className="font-black text-slate-700 mb-4">Add Admin User</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div><label className={lbl}>Full Name</label><input className={inp} placeholder="John Doe" value={aName} onChange={e=>setAName(e.target.value)}/></div>
                    <div><label className={lbl}>Email</label><input type="email" className={inp} placeholder="john@example.com" value={aEmail} onChange={e=>setAEmail(e.target.value)}/></div>
                    <div><label className={lbl}>Password</label><input type="text" className={inp} placeholder="Set password" value={aPass} onChange={e=>setAPass(e.target.value)}/></div>
                    <div>
                      <label className={lbl}>Role</label>
                      <select className={inp} value={aRole} onChange={e=>setARole(e.target.value as any)}>
                        <option value="admin">Admin</option>
                        <option value="support">Support</option>
                        <option value="super">Super Admin</option>
                      </select>
                    </div>
                  </div>
                  <button onClick={addAdmin} disabled={!aName||!aEmail||!aPass}
                    className={`mt-3 ${btn} bg-slate-900 text-white hover:bg-amber-600 disabled:opacity-40`}>
                    <i className="fas fa-plus text-[9px] mr-1"></i>Add Admin User
                  </button>
                </div>
              )}
              {/* Admin list */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-xs min-w-[480px]">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['Name','Email','Role','Created','Actions'].map(h=>(
                      <th key={h} className="px-5 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {admins.map(a=>(
                      <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center font-black text-white text-sm">{a.name[0]}</div>
                            <span className="font-black text-slate-900">{a.name}</span>
                            {a.id===me.id && <span className="text-[7px] font-black px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">You</span>}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-bold text-slate-600">{a.email}</td>
                        <td className="px-5 py-3.5">
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${a.role==='super'?'bg-purple-100 text-purple-700':a.role==='admin'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-500'}`}>{a.role}</span>
                        </td>
                        <td className="px-5 py-3.5 font-bold text-slate-500">{fmtDate(a.createdAt)}</td>
                        <td className="px-5 py-3.5">
                          {a.id!==me.id && me.role==='super' && (
                            <button onClick={()=>saveAdmins(admins.filter(x=>x.id!==a.id))}
                              className="text-rose-400 hover:text-rose-600 font-black text-[9px] uppercase hover:underline">Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══ BACKUPS ══ */}
          {page==='backups' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-white font-black text-xl">Backup &amp; Restore</h2>
                <p className="text-slate-400 text-sm mt-1 font-bold">Download complete DB backups or restore data per tenant</p>
              </div>
              <BackupRestore tenants={tenants.map(t=>({ id:t.id, name:t.name, slug:t.slug }))} />
            </div>
          )}

          {/* ══ ANALYTICS ══ */}
          {page==='analytics' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {PLANS.map(p=>{
                  const active = tenants.filter(t=>t.sub.planId===p.id&&t.sub.status==='active').length;
                  const trial  = tenants.filter(t=>t.sub.planId===p.id&&t.sub.status==='trial').length;
                  const rev    = active*(p.price);
                  return (
                    <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm" style={{borderLeft:`4px solid ${p.color}`}}>
                      <div className="font-black text-slate-900 text-lg">{p.name}</div>
                      <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-sm"><span className="font-bold text-slate-500">Active</span><span className="font-black text-emerald-700">{active}</span></div>
                        <div className="flex justify-between text-sm"><span className="font-bold text-slate-500">Trial</span><span className="font-black text-blue-700">{trial}</span></div>
                        <div className="flex justify-between text-sm"><span className="font-bold text-slate-500">Monthly Revenue</span><span className="font-black text-slate-900">{INR(rev)}</span></div>
                        <div className="flex justify-between text-sm"><span className="font-bold text-slate-500">Annual Revenue</span><span className="font-black text-amber-700">{INR(rev*12)}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="font-black text-slate-700 mb-5">Status Distribution</div>
                <div className="space-y-3">
                  {Object.entries(tenants.reduce((m,t)=>{const s=t.sub.status;m[s]=(m[s]||0)+1;return m;},{} as Record<string,number>)).map(([status,count])=>(
                    <div key={status} className="flex items-center gap-4">
                      <div className="w-24 text-[10px] font-black text-slate-500 uppercase text-right">{status}</div>
                      <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                        <div className="h-4 rounded-full transition-all duration-700" style={{
                          width:`${(count/Math.max(tenants.length,1))*100}%`,
                          background: status==='active'?'#10b981':status==='trial'?'#3b82f6':status==='expired'?'#ef4444':'#94a3b8'
                        }}></div>
                      </div>
                      <div className="w-8 font-black text-slate-900 text-sm">{count}</div>
                      <div className="w-10 text-[9px] font-bold text-slate-400">{Math.round(count/Math.max(tenants.length,1)*100)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ══ EDIT SUBSCRIPTION MODAL ══ */}
      {modal==='edit' && sel && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-[28px] w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="bg-slate-900 text-white px-6 py-5 rounded-t-[28px] flex items-center justify-between">
              <div>
                <div className="font-black text-lg">Manage Subscription</div>
                <div className="text-slate-400 font-bold text-[10px]">{sel.name} · {sel.owner_email}</div>
              </div>
              <button onClick={()=>setModal(null)} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">✕</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                {PLANS.map(p=>(
                  <button key={p.id} type="button" onClick={()=>{setEPlan(p.id);setEPrice(p.price);}}
                    className={`border-2 rounded-2xl p-4 text-left transition-all ${ePlan===p.id?'border-amber-500 bg-amber-50 shadow-md':'border-slate-200 hover:border-amber-200'}`}>
                    <div className="font-black text-slate-900">{p.name}</div>
                    <div className="font-black text-amber-600 text-lg mt-0.5">{INR(p.price)}<span className="text-[10px] text-amber-400 font-bold">/mo</span></div>
                    {ePlan===p.id && <div className="text-[8px] font-black text-amber-500 mt-1">● Selected</div>}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>Status</label>
                  <select className={inp} value={eStatus} onChange={e=>setEStatus(e.target.value as any)}>
                    {['active','trial','suspended','cancelled','expired'].map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>Billing Cycle</label>
                  <select className={inp} value={eCycle} onChange={e=>setECycle(e.target.value as any)}>
                    <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                  </select>
                </div>
                <div><label className={lbl}>Subscription Ends</label><input type="date" className={inp} value={eEnd} onChange={e=>setEEnd(e.target.value)}/></div>
                <div>
                  <label className={lbl}>Custom Price / Month (₹) <span className="text-slate-300 normal-case">Standard: {INR(PLAN_MAP[ePlan]?.price||0)}</span></label>
                  <input type="number" className={inp} value={ePrice} onChange={e=>setEPrice(parseFloat(e.target.value||'0'))}/>
                </div>
              </div>
              <div>
                <label className={lbl}>Feature Overrides <span className="text-slate-300 normal-case font-bold">— per-tenant exceptions</span></label>
                <div className="border border-slate-200 rounded-xl max-h-52 overflow-y-auto divide-y divide-slate-50">
                  {FEATURES.map(f=>{
                    const inPlan=PLAN_MAP[ePlan]?.features.includes(f.id);
                    const ov=eOver[f.id];
                    return (
                      <div key={f.id} className="flex items-center justify-between px-3 py-2 hover:bg-slate-50">
                        <div className="flex-1">
                          <span className="text-[10px] font-bold text-slate-700">{f.name}</span>
                          {inPlan && <span className="ml-1.5 text-[7px] font-black text-emerald-500 bg-emerald-50 px-1 rounded">in plan</span>}
                        </div>
                        <div className="flex gap-1">
                          {([['default',undefined,'bg-slate-700'],['ON',true,'bg-emerald-600'],['OFF',false,'bg-rose-600']] as const).map(([label,val,active])=>(
                            <button key={String(label)} onClick={()=>{
                              if(val===undefined){const n={...eOver};delete n[f.id];setEOver(n);}
                              else setEOver(o=>({...o,[f.id]:val as boolean}));
                            }} className={`px-1.5 py-0.5 text-[7px] font-black rounded text-white transition-all ${(ov===val||(val===undefined&&ov===undefined))?active:'bg-slate-200 text-slate-500'}`}>{label}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div><label className={lbl}>Admin Notes</label><textarea className={`${inp} resize-none`} rows={2} value={eNotes} onChange={e=>setENotes(e.target.value)} placeholder="Internal notes…"/></div>
              <div className="flex gap-3">
                <button onClick={saveEdit} className={`flex-1 py-3.5 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all`}>Save Changes</button>
                <button onClick={()=>setModal(null)} className={`px-5 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-black text-[10px] uppercase hover:bg-slate-200`}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ PAYMENT MODAL ══ */}
      {modal==='pay' && sel && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-[28px] w-full max-w-md shadow-2xl">
            <div className="bg-emerald-800 text-white px-6 py-5 rounded-t-[28px] flex items-center justify-between">
              <div><div className="font-black text-lg">Record Payment</div><div className="text-emerald-300 font-bold text-[10px]">{sel.name}</div></div>
              <button onClick={()=>setModal(null)} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className={lbl}>Amount (₹)</label>
                <input type="number" className={inp} placeholder={String(sel.sub.customPrice||PLAN_MAP[sel.sub.planId]?.price||0)}
                  value={pAmt||''} onChange={e=>setPAmt(parseFloat(e.target.value||'0'))}/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Method</label>
                  <select className={inp} value={pMeth} onChange={e=>setPMeth(e.target.value as any)}>
                    <option value="upi">UPI</option><option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option><option value="cheque">Cheque</option><option value="online">Online</option>
                  </select>
                </div>
                <div><label className={lbl}>Reference / UTR</label><input className={inp} placeholder="Ref no." value={pRef} onChange={e=>setPRef(e.target.value)}/></div>
              </div>
              <div><label className={lbl}>Notes</label><input className={inp} placeholder="Optional" value={pNote} onChange={e=>setPNote(e.target.value)}/></div>
              <button onClick={recordPay} disabled={!pAmt}
                className={`w-full py-4 bg-emerald-700 text-white rounded-xl font-black text-[10px] uppercase hover:bg-emerald-800 transition-all disabled:opacity-40`}>
                Record {pAmt?INR(pAmt):''} Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ QR CODE MODAL ══ */}
      {qrTenant && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={()=>setQrTenant(null)}>
          <div className="bg-white rounded-[28px] w-full max-w-sm shadow-2xl" onClick={e=>e.stopPropagation()}>
            <div className="bg-slate-900 text-white px-6 py-5 rounded-t-[28px] flex items-center justify-between">
              <div>
                <div className="font-black text-lg">App QR Code</div>
                <div className="text-slate-400 font-bold text-[10px]">{qrTenant.name}</div>
              </div>
              <button onClick={()=>setQrTenant(null)} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">✕</button>
            </div>
            <div className="p-6 text-center space-y-4">
              {/* QR Code */}
              {qrCanvas ? (
                <div className="flex items-center justify-center">
                  <img src={qrCanvas} alt="QR Code" className="w-56 h-56 rounded-2xl border-4 border-slate-100"/>
                </div>
              ) : (
                <div className="w-56 h-56 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
                  <i className="fas fa-qrcode text-6xl text-slate-300"></i>
                </div>
              )}

              {/* Warning for admin */}
              <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-left">
                <div className="font-black text-rose-700 text-sm flex items-center gap-2">
                  <i className="fas fa-exclamation-triangle text-xs"></i>
                  Do NOT scan this on your admin browser
                </div>
                <div className="text-[10px] font-bold text-rose-600 mt-1">
                  This QR is for the <b>shop staff's phone</b> only. Scanning it on your admin browser will switch it to that shop's account.
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left space-y-2">
                <div className="font-black text-amber-800 text-sm">How to use this QR:</div>
                <div className="text-[10px] font-bold text-amber-700 space-y-1.5">
                  <div className="flex items-start gap-2"><span className="font-black text-amber-900 shrink-0">1.</span><span>Install the Royal ERP app on your phone</span></div>
                  <div className="flex items-start gap-2"><span className="font-black text-amber-900 shrink-0">2.</span><span>Open the app once — tap <b>"Scan QR to Configure"</b> button</span></div>
                  <div className="flex items-start gap-2"><span className="font-black text-amber-900 shrink-0">3.</span><span>Point camera at this QR code</span></div>
                  <div className="flex items-start gap-2"><span className="font-black text-amber-900 shrink-0">4.</span><span>App permanently configures for <b>{qrTenant.name}</b></span></div>
                  <div className="flex items-start gap-2"><span className="font-black text-amber-900 shrink-0">5.</span><span>Login with shop credentials — done!</span></div>
                </div>
              </div>

              {/* Config URL */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Configure URL</div>
                <div className="font-mono text-[9px] text-slate-700 break-all">
                  {BASE}/?tenant={qrTenant.slug}&configure=1
                </div>
              </div>

              {/* Download QR */}
              {qrCanvas && (
                <a href={qrCanvas} download={`royal-erp-qr-${qrTenant.slug}.png`}
                  className="flex items-center justify-center gap-2 w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all">
                  <i className="fas fa-download text-xs"></i> Download QR Image
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ TICKET MODAL ══ */}
      {modal==='ticket' && sel && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-[28px] w-full max-w-md shadow-2xl">
            <div className="bg-purple-800 text-white px-6 py-5 rounded-t-[28px] flex items-center justify-between">
              <div><div className="font-black text-lg">Support Ticket</div><div className="text-purple-300 font-bold text-[10px]">{sel.name}</div></div>
              <button onClick={()=>setModal(null)} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className={lbl}>Subject</label><input className={inp} placeholder="Brief issue description" value={tSubj} onChange={e=>setTSubj(e.target.value)}/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Category</label>
                  <select className={inp} value={tCat} onChange={e=>setTCat(e.target.value as any)}>
                    <option value="billing">Billing</option><option value="feature_request">Feature Request</option>
                    <option value="bug">Bug</option><option value="upgrade">Upgrade</option><option value="general">General</option>
                  </select>
                </div>
                <div><label className={lbl}>Priority</label>
                  <select className={inp} value={tPri} onChange={e=>setTPri(e.target.value as any)}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div><label className={lbl}>Description</label><textarea className={`${inp} resize-none`} rows={3} placeholder="Details…" value={tDesc} onChange={e=>setTDesc(e.target.value)}/></div>
              <button onClick={raiseTix} disabled={!tSubj}
                className={`w-full py-4 bg-purple-700 text-white rounded-xl font-black text-[10px] uppercase hover:bg-purple-800 transition-all disabled:opacity-40`}>
                Raise Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionPortal;
