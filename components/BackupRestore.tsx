/**
 * BackupRestore.tsx
 * Intelligent Backup & Restore for Royal ERP.
 * Super Admin: full DB + tenant-wise. Tenant Admin: own data.
 */
import React, { useState, useRef, useEffect } from 'react';
import { store } from '../store';

interface Props { isSuperAdmin?: boolean; superKey?: string; }
const INR = (n: number) => n.toLocaleString('en-IN');
const BASE = window.location.origin;
type Status = 'idle'|'loading'|'success'|'error';

const BackupRestore: React.FC<Props> = ({ isSuperAdmin=false, superKey='' }) => {
  const [tab, setTab] = useState<'backup'|'restore'|'validate'>('backup');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [validation, setValidation] = useState<any>(null);
  const [uploadedBackup, setUploadedBackup] = useState<any>(null);
  const [uploadedFilename, setUploadedFilename] = useState('');
  const [restoreMode, setRestoreMode] = useState<'merge'|'replace'>('merge');
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [targetTenantId, setTargetTenantId] = useState('');
  const [tenants, setTenants] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Refresh token from store on every render (in case it changes)
  const authHeaders = store.getAuthHeaders?.() || {};
  const token = authHeaders.Authorization || authHeaders['Authorization'] || '';
  const inp  = "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-amber-400 transition-all";
  const lbl  = "text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

  useEffect(() => { fetchStats(); if(isSuperAdmin) fetchAllTenants(); }, []);

  const fetchStats = async () => {
    if (!token && !superKey) return; // don't call without auth
    try {
      const tParam = isSuperAdmin && targetTenantId ? `&tenant_id=${targetTenantId}` : '';
      const kParam = isSuperAdmin ? `?key=${superKey}${tParam}` : '';
      const headers: Record<string,string> = {};
      if (token) headers['Authorization'] = token;
      const r = await fetch(`${BASE}/api/backup/stats${kParam}`, { headers });
      if (r.ok) setStats(await r.json());
    } catch {}
  };
  const fetchAllTenants = async () => {
    try {
      const r = await fetch(`${BASE}/api/admin/tenants?key=${superKey}`);
      if(r.ok) { const d = await r.json(); setTenants(d.tenants||[]); }
    } catch {}
  };

  const downloadBackup = async (type: 'tenant'|'full') => {
    setStatus('loading'); setMessage('Preparing backup…');
    try {
      const params = type==='full' ? `?key=${superKey}` :
        (targetTenantId&&isSuperAdmin) ? `?key=${superKey}&tenant_id=${targetTenantId}` : '';
      const hdrs: Record<string,string> = {};
      if (token) hdrs['Authorization'] = token;
      const r = await fetch(`${BASE}/api/backup/${type}${params}`, { headers: hdrs });
      if(!r.ok) throw new Error((await r.json()).error||`HTTP ${r.status}`);
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
      const fname = `backup-${type}-${data._meta?.tenantId||'full'}-${new Date().toISOString().slice(0,10)}.json`;
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fname; a.click(); URL.revokeObjectURL(a.href);
      const total = Object.values(data.counts||{}).reduce((s:any,v:any)=>s+v,0);
      setStatus('success'); setMessage(`✓ Backup saved: ${fname} — ${total} records · checksum: ${data._meta?.checksum}`);
    } catch(e:any){ setStatus('error'); setMessage(`✗ ${e.message}`); }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if(!f) return;
    setUploadedFilename(f.name);
    const r=new FileReader();
    r.onload=ev=>{ try{ setUploadedBackup(JSON.parse(ev.target?.result as string)); setValidation(null); setDryRunResult(null); setRestoreResult(null); setStatus('idle'); setMessage('File loaded — click Validate.'); }catch{ setStatus('error'); setMessage('Invalid JSON file'); } };
    r.readAsText(f);
  };

  const validateBackup = async () => {
    if(!uploadedBackup){ setMessage('Upload a file first.'); return; }
    setStatus('loading'); setMessage('Validating…');
    try{
      const hdrs2: Record<string,string> = {'Content-Type':'application/json'};
      if(token) hdrs2['Authorization']=token;
      const r=await fetch(`${BASE}/api/backup/validate`,{ method:'POST', headers:hdrs2, body:JSON.stringify({backup:uploadedBackup})});
      const result=await r.json(); setValidation(result);
      setStatus(result.valid?'success':'error');
      setMessage(result.valid?'✓ Backup is valid and safe to restore':`✗ Issues: ${result.issues.join('; ')}`);
    }catch(e:any){ setStatus('error'); setMessage(`Validation error: ${e.message}`); }
  };

  const runDryRun = async () => {
    if(!uploadedBackup){ setMessage('Upload a file first.'); return; }
    setStatus('loading'); setMessage('Running dry-run preview…');
    try{
      const q=isSuperAdmin&&targetTenantId?`?key=${superKey}&tenant_id=${targetTenantId}`:'';
      const r=await fetch(`${BASE}/api/backup/restore/tenant${q}`,{ method:'POST', headers:{'Content-Type':'application/json',Authorization:token}, body:JSON.stringify({backup:uploadedBackup,mode:restoreMode,dryRun:true})});
      const d=await r.json(); setDryRunResult(d); setStatus('success'); setMessage('Dry run complete. Review and click Commit to proceed.');
    }catch(e:any){ setStatus('error'); setMessage(`Dry run failed: ${e.message}`); }
  };

  const performRestore = async () => {
    if(!uploadedBackup||!dryRunResult){ setMessage('Run dry-run first.'); return; }
    if(!window.confirm(`⚠️ Restore ${restoreMode==='replace'?'REPLACE ALL DATA in':'merge data into'} "${dryRunResult.targetTenant}"?\n\nThis cannot be undone. Continue?`)) return;
    setStatus('loading'); setMessage('Restoring…');
    try{
      const q=isSuperAdmin&&targetTenantId?`?key=${superKey}&tenant_id=${targetTenantId}`:'';
      const r=await fetch(`${BASE}/api/backup/restore/tenant${q}`,{ method:'POST', headers:{'Content-Type':'application/json',Authorization:token}, body:JSON.stringify({backup:uploadedBackup,mode:restoreMode,dryRun:false})});
      const d=await r.json(); setRestoreResult(d);
      setStatus(d.success?'success':'error');
      setMessage(d.success?'✓ Restore complete! Refresh to see data.':`✗ ${d.error}`);
      if(d.success) fetchStats();
    }catch(e:any){ setStatus('error'); setMessage(`Restore failed: ${e.message}`); }
  };

  const scol={idle:'text-slate-500',loading:'text-blue-600',success:'text-emerald-600',error:'text-rose-600'}[status];
  const TAB=(id:typeof tab,label:string,icon:string)=>(
    <button onClick={()=>setTab(id)} className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black text-[10px] uppercase transition-all ${tab===id?'bg-slate-900 text-white shadow':'text-slate-500 hover:bg-slate-100'}`}>
      <i className={`fas ${icon} text-xs`}></i>{label}
    </button>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-3">
          <i className="fas fa-database text-amber-500 text-2xl"></i>
          {isSuperAdmin?'Full DB Backup & Restore':'Data Backup & Restore'}
        </h1>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
          {isSuperAdmin?'Super Admin — all tenants or per-tenant backup + restore with validation':'Secure your data — download, validate, restore'}
        </p>
      </div>

      {/* Live stats */}
      {stats&&(<div className="bg-white border rounded-3xl p-5 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Live DB — {stats.tenantId}</div>
          <button onClick={fetchStats} className="text-[9px] font-black text-slate-400 hover:text-slate-700 flex items-center gap-1"><i className="fas fa-sync text-[8px]"></i> Refresh</button>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
          {Object.entries(stats.counts||{}).map(([k,v]:any)=>(
            <div key={k} className="bg-slate-50 rounded-2xl px-4 py-3">
              <div className="text-[8px] font-black text-slate-400 uppercase mb-0.5">{k}</div>
              <div className="text-xl font-black">{INR(v)}</div>
            </div>
          ))}
        </div>
        <div className="text-[8px] text-slate-400 font-bold mt-2">As of {new Date(stats.as_of).toLocaleString()}</div>
      </div>)}

      <div className="flex flex-wrap gap-2">
        {TAB('backup','Backup','fa-cloud-download-alt')}
        {TAB('restore','Restore','fa-cloud-upload-alt')}
        {TAB('validate','Validate','fa-shield-alt')}
      </div>

      {/* ── BACKUP ── */}
      {tab==='backup'&&(<div className="space-y-5">
        {isSuperAdmin&&(<div className="bg-rose-50 border border-rose-100 rounded-3xl p-6 space-y-3">
          <div className="text-[9px] font-black text-rose-600 uppercase tracking-widest"><i className="fas fa-crown mr-1"></i> Super Admin — Full Database Backup</div>
          <p className="text-xs text-rose-700 font-bold">All tables, all tenants. Run before every deployment.</p>
          <button onClick={()=>downloadBackup('full')} disabled={status==='loading'}
            className="px-7 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-black text-[10px] uppercase disabled:opacity-40 flex items-center gap-2">
            <i className="fas fa-database"></i> Download Full DB Backup
          </button>
          <div className="pt-3 border-t border-rose-100 space-y-2">
            <label className={lbl}>Specific Tenant Backup</label>
            <input className={inp} value={targetTenantId} onChange={e=>setTargetTenantId(e.target.value)}
              placeholder="Tenant ID e.g. royal-mudhol-d81d2d03" list="t-list"/>
            <datalist id="t-list">{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</datalist>
            <button onClick={()=>{if(targetTenantId)downloadBackup('tenant');}} disabled={!targetTenantId||status==='loading'}
              className="px-5 py-2.5 bg-slate-700 hover:bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase disabled:opacity-40 flex items-center gap-2">
              <i className="fas fa-user-shield"></i> Download Tenant: {targetTenantId||'—'}
            </button>
          </div>
        </div>)}

        <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="text-[9px] font-black text-slate-400 uppercase">Your Tenant Backup</div>
          <div className="text-xs text-slate-500 space-y-1 font-bold">
            <p>✅ Products, sales, vendor orders, referral agents, settings</p>
            <p>✅ Checksum embedded for tamper detection</p>
            <p>✅ JSON format — versioned, human-readable</p>
          </div>
          <button onClick={()=>downloadBackup('tenant')} disabled={status==='loading'}
            className="w-full py-5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-black text-sm uppercase disabled:opacity-40 flex items-center justify-center gap-3">
            {status==='loading'?<><i className="fas fa-spinner fa-spin"></i> Preparing…</>:<><i className="fas fa-cloud-download-alt"></i> Download Backup Now</>}
          </button>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 text-amber-800 text-xs font-bold">
          <i className="fas fa-lightbulb mr-2 text-amber-500"></i>
          Take a backup before every deployment or major import. Store in Google Drive or email to yourself.
        </div>
      </div>)}

      {/* ── RESTORE ── */}
      {tab==='restore'&&(<div className="space-y-5">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-amber-800 text-xs font-bold flex gap-3">
          <i className="fas fa-exclamation-triangle mt-0.5 text-amber-500 shrink-0"></i>
          Process: Upload → Validate → Dry Run → Commit. Always merge-mode unless you want to wipe everything.
        </div>

        <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="text-[9px] font-black text-slate-400 uppercase">Step 1 — Upload Backup File</div>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onFileSelect}/>
          <button onClick={()=>fileRef.current?.click()}
            className="w-full py-5 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 hover:border-amber-400 hover:text-amber-600 font-black text-sm flex items-center justify-center gap-3 transition-all">
            <i className="fas fa-file-upload text-xl"></i>
            {uploadedFilename||'Click to upload backup .json file'}
          </button>
          {uploadedBackup&&(<div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-xs font-bold text-emerald-700 space-y-0.5">
            <div>✓ <strong>{uploadedFilename}</strong></div>
            <div>Tenant: {uploadedBackup._meta?.tenantId} · Exported: {uploadedBackup._meta?.exportedAt?.slice(0,19).replace('T',' ')}</div>
            <div>Products: {(uploadedBackup.products||[]).length} · Sales: {(uploadedBackup.sales||[]).length} · Orders: {(uploadedBackup.vendorOrders||[]).length}</div>
          </div>)}
        </div>

        {uploadedBackup&&(<div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="text-[9px] font-black text-slate-400 uppercase">Step 2 — Options</div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={()=>setRestoreMode('merge')}
              className={`py-4 rounded-2xl border-2 text-left px-5 transition-all ${restoreMode==='merge'?'border-emerald-500 bg-emerald-50':'border-slate-100 hover:border-slate-200'}`}>
              <div className="font-black text-sm mb-1">🔀 Merge (Safe)</div>
              <div className="text-[9px] text-slate-500 font-bold">Add/update from backup. Keep existing data not in backup.</div>
            </button>
            <button onClick={()=>setRestoreMode('replace')}
              className={`py-4 rounded-2xl border-2 text-left px-5 transition-all ${restoreMode==='replace'?'border-rose-500 bg-rose-50':'border-slate-100 hover:border-slate-200'}`}>
              <div className="font-black text-sm mb-1">⚠️ Replace (Full Wipe)</div>
              <div className="text-[9px] text-slate-500 font-bold">Delete all data, then restore. Cannot be undone.</div>
            </button>
          </div>
          {isSuperAdmin&&(<div><label className={lbl}>Override Target Tenant ID</label>
            <input className={inp} value={targetTenantId} onChange={e=>setTargetTenantId(e.target.value)} placeholder="Leave blank to use backup's own tenant"/>
          </div>)}
          <div className="flex gap-3">
            <button onClick={validateBackup} className="flex-1 py-3 bg-blue-50 border border-blue-100 text-blue-700 rounded-2xl font-black text-[10px] uppercase hover:bg-blue-100 flex items-center justify-center gap-2">
              <i className="fas fa-shield-alt"></i> Validate
            </button>
            <button onClick={runDryRun} className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200 flex items-center justify-center gap-2">
              <i className="fas fa-eye"></i> Dry Run
            </button>
          </div>
        </div>)}

        {dryRunResult&&(<div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
          <div className="text-[9px] font-black text-slate-500 uppercase">Dry Run — No data changed yet</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(dryRunResult.preview||{}).map(([k,v]:any)=>(
              <div key={k} className="bg-white rounded-xl px-3 py-2">
                <div className="text-[8px] font-black text-slate-400 uppercase">{k}</div>
                <div className="font-black text-xl">{v}</div>
                <div className="text-[8px] text-slate-400">to restore</div>
              </div>
            ))}
          </div>
          <div className="text-xs font-bold text-slate-600">Mode: <strong>{dryRunResult.mode}</strong> · Target: <strong>{dryRunResult.targetTenant}</strong></div>
          <button onClick={performRestore}
            className={`w-full py-4 rounded-2xl font-black text-sm uppercase text-white flex items-center justify-center gap-2 ${restoreMode==='replace'?'bg-rose-600 hover:bg-rose-700':'bg-emerald-600 hover:bg-emerald-700'}`}>
            <i className="fas fa-redo"></i> Commit Restore ({restoreMode==='replace'?'⚠️ Replace All':'Merge'})
          </button>
        </div>)}

        {restoreResult?.success&&(<div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
          <div className="font-black text-emerald-700 flex items-center gap-2"><i className="fas fa-check-circle text-xl"></i> Restore Completed Successfully</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(restoreResult.restored||{}).map(([k,v]:any)=>(
              <div key={k} className="bg-white rounded-xl px-3 py-2">
                <div className="text-[8px] font-black text-slate-400 uppercase">{k}</div>
                <div className="font-black text-xl text-emerald-700">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-xs font-bold text-emerald-700"><i className="fas fa-info-circle mr-1"></i> Refresh the page to see restored data.</p>
        </div>)}
      </div>)}

      {/* ── VALIDATE ── */}
      {tab==='validate'&&(<div className="space-y-5">
        <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="text-[9px] font-black text-slate-400 uppercase">Validate a Backup File</div>
          <p className="text-xs text-slate-500 font-bold">Verify checksum, record counts, and schema version before trusting the file.</p>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onFileSelect}/>
          <button onClick={()=>fileRef.current?.click()}
            className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 hover:border-amber-400 hover:text-amber-600 font-black text-sm flex items-center justify-center gap-3 transition-all">
            <i className="fas fa-file-search text-xl"></i>
            {uploadedFilename||'Upload backup .json to validate'}
          </button>
          {uploadedBackup&&(<button onClick={validateBackup} disabled={status==='loading'}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-[10px] uppercase disabled:opacity-40 flex items-center justify-center gap-2">
            {status==='loading'?<><i className="fas fa-spinner fa-spin"></i> Validating…</>:<><i className="fas fa-shield-alt"></i> Validate Now</>}
          </button>)}
        </div>

        {validation&&(<div className={`border rounded-3xl p-6 space-y-4 ${validation.valid?'bg-emerald-50 border-emerald-200':'bg-rose-50 border-rose-200'}`}>
          <div className={`flex items-center gap-3 font-black text-lg ${validation.valid?'text-emerald-700':'text-rose-700'}`}>
            <i className={`fas ${validation.valid?'fa-check-circle':'fa-times-circle'} text-2xl`}></i>
            {validation.valid?'Backup Valid ✓':'Validation Failed ✗'}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-white rounded-xl p-3">
              <div className="text-[8px] font-black opacity-60 uppercase mb-1">Checksum</div>
              <div className={`font-black ${validation.checksumOk?'text-emerald-600':'text-rose-600'}`}>{validation.checksumOk?'✓ Valid':'✗ Mismatch'}</div>
              <div className="text-[8px] text-slate-400 mt-0.5 break-all">{validation.meta?.checksum}</div>
            </div>
            <div className="bg-white rounded-xl p-3">
              <div className="text-[8px] font-black opacity-60 uppercase mb-1">Exported</div>
              <div className="font-bold">{validation.meta?.exportedAt?.slice(0,16).replace('T',' ')}</div>
              <div className="text-[8px] text-slate-400">{validation.meta?.exportedBy} · {validation.meta?.schema}</div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[8px] font-black opacity-60 uppercase">Record Counts</div>
            {Object.entries(validation.validation||{}).map(([k,v]:any)=>(
              <div key={k} className="flex items-center justify-between bg-white rounded-xl px-4 py-2 text-xs">
                <span className="font-bold capitalize">{k}</span>
                <div className="flex items-center gap-2">
                  {v.stated!==undefined&&<span className="text-slate-400">expected {v.stated}</span>}
                  <span className={`font-black ${v.ok===false?'text-rose-600':'text-emerald-600'}`}>
                    {v.actual??v.count} found {v.ok===false?'✗':'✓'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {validation.issues.length>0&&validation.issues.map((iss:string,i:number)=>(
            <div key={i} className="text-xs text-rose-700 font-bold flex items-start gap-2"><i className="fas fa-exclamation-circle mt-0.5 shrink-0"></i>{iss}</div>
          ))}
        </div>)}
      </div>)}

      {message&&(<div className={`px-5 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 ${status==='error'?'bg-rose-50 border border-rose-100':status==='success'?'bg-emerald-50 border border-emerald-100':'bg-blue-50 border border-blue-100'}`}>
        <i className={`fas ${status==='loading'?'fa-spinner fa-spin':status==='success'?'fa-check-circle':'fa-exclamation-circle'} ${scol}`}></i>
        <span className={scol}>{message}</span>
      </div>)}
    </div>
  );
};
export default BackupRestore;
