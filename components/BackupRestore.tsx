/**
 * BackupRestore.tsx
 * Full backup/restore panel for the Subscription Admin Portal.
 * Supports per-tenant and full-DB backup in JSON or SQL format.
 * Restore: upload a JSON backup, choose target tenant, merge or replace.
 */
import React, { useState, useRef } from 'react';

const BASE = window.location.origin;
const SK   = 'test'; // must match SUPER_ADMIN_KEY

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

export default BackupRestore;
