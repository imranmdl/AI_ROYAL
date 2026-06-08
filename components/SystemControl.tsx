
import React, { useState, useEffect } from 'react';
import { store, HealthLogEntry } from '../store';
import LoadingChargeManager from './LoadingChargeManager';
import KadapaSettings from './KadapaSettings';

const SystemControl: React.FC = () => {
  const [isSyncing, setIsSyncing] = useState(store.isSyncing);
  const [isOnline, setIsOnline] = useState(store.isOnline);
  const [dbConnected, setDbConnected] = useState(store.dbConnected);
  const [connError, setConnError] = useState(store.connectionError);
  const [logs, setLogs] = useState<HealthLogEntry[]>(store.healthHistory);
  const [dbStatus, setDbStatus] = useState<{ persistence: string, host: string, timestamp?: number } | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);

  const [profile, setProfile] = useState({
    showroomName: store.settings.showroomName,
    showroomAddress: store.settings.showroomAddress,
    showroomCity: store.settings.showroomCity,
    showroomPhone: store.settings.showroomPhone,
    showroomGst: store.settings.showroomGst,
    systemBranding: store.settings.systemBranding,
    galleryNotification: store.settings.galleryNotification || '',
    decimalPlaceText: store.settings.decimalPlaceText || '',
    backendUrl: store.settings.backendUrl || '',
    backupFrequency: store.settings.backupFrequency || '15min'
  });

  const [visibility, setVisibility] = useState(store.settings.dashboardVisibility);
  const [predefinedSizes, setPredefinedSizes] = useState<string[]>(store.settings.predefinedSizes || []);
  const [categories, setCategories] = useState<string[]>(store.settings.categories || []);
  const [newSize, setNewSize] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${profile.backendUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setDbStatus({ persistence: 'MySQL Node (GCP)', host: data.db_host, timestamp: data.timestamp });
      }
    } catch (e) {
      console.warn("Real-time health probe failed.");
    }
  };

  const [backups, setBackups] = useState<{ filename: string, url: string, timestamp: string }[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [dbStats, setDbStats] = useState<any>(null);
  // Data management states
  const [isClearing, setIsClearing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'json'|'csv'>('json');
  const [showDataPanel, setShowDataPanel] = useState(false);

  const fetchBackups = async () => {
    try {
      const base = profile.backendUrl || '';
      const res = await fetch(`${base}/api/backups`);
      if (res.ok) { const data = await res.json(); setBackups(data); }
    } catch (e) { console.warn('Backup list fetch failed.'); }
  };

  const fetchDbStats = async () => {
    try {
      const base = profile.backendUrl || '';
      const res = await fetch(`${base}/api/admin/db-stats`);
      if (res.ok) { setDbStats(await res.json()); }
    } catch {}
  };

  useEffect(() => {
    fetchHealth();
    fetchBackups();
    fetchDbStats();
    const unsub = store.subscribe(() => {
      setIsSyncing(store.isSyncing);
      setIsOnline(store.isOnline);
      setDbConnected(store.dbConnected);
      setConnError(store.connectionError);
      setLogs([...store.healthHistory]);
    });
    return unsub;
  }, []);

  const handleUpdateProfile = () => {
    store.updateSettings(profile);
    setStatus({ type: 'success', msg: 'System node parameters synchronized with target API.' });
    fetchHealth();
    setTimeout(() => setStatus(null), 5000);
  };

  const handleForceRefresh = async () => {
    await store.refreshFromServer(true);
    await fetchHealth();
    setStatus({ type: 'success', msg: 'Forced data hydration from MySQL global node.' });
    setTimeout(() => setStatus(null), 5000);
  };

  const handleCloudMigration = async () => {
    if (!confirm("This will replace all Remote Cloud Data with your current view. Proceed?")) return;
    setIsMigrating(true);
    try {
      await store.save(); 
      await fetchHealth();
      setStatus({ type: 'success', msg: 'PUSH COMPLETE: All local changes committed to MySQL.' });
    } catch (err) {
      setStatus({ type: 'error', msg: 'Synchronization fault. Verify connectivity.' });
    } finally {
      setIsMigrating(false);
      setTimeout(() => setStatus(null), 5000);
    }
  };

  const base = profile.backendUrl || '';

  const handleTriggerBackup = async () => {
    setIsBackingUp(true);
    try {
      const res = await fetch(`${base}/api/backups/trigger`, { method: 'POST' });
      if (res.ok) {
        setStatus({ type: 'success', msg: 'Snapshot created successfully.' });
        await fetchBackups();
        await fetchDbStats();
      }
    } catch { setStatus({ type: 'error', msg: 'Backup trigger failed.' }); }
    finally { setIsBackingUp(false); setTimeout(() => setStatus(null), 5000); }
  };

  const handleRestore = async (filename: string) => {
    if (!confirm(`RESTORE from ${filename}?\n\nThis will overwrite ALL current data. A backup is taken automatically first.`)) return;
    setIsSyncing(true);
    try {
      const res = await fetch(`${base}/api/backups/restore/${filename}`, { method: 'POST' });
      if (res.ok) {
        setStatus({ type: 'success', msg: 'Restore complete. Reloading data...' });
        await store.refreshFromServer(true);
      } else {
        const err = await res.json();
        setStatus({ type: 'error', msg: `Restore failed: ${err.details || err.error}` });
      }
    } catch { setStatus({ type: 'error', msg: 'Network error during restore.' }); }
    finally { setIsSyncing(false); setTimeout(() => setStatus(null), 5000); }
  };

  // ── Clear all data from DB ──────────────────────────────────────────────────
  const handleClearDb = async () => {
    if (!confirm('DANGER: This will DELETE ALL DATA from the database.\n\nA backup will be created automatically before clearing.\n\nType YES to confirm.')) return;
    const confirm2 = window.prompt('Type DELETE to confirm data wipe:');
    if (confirm2 !== 'DELETE') { setStatus({ type: 'error', msg: 'Cancelled — confirmation did not match.' }); setTimeout(() => setStatus(null), 3000); return; }
    setIsClearing(true);
    try {
      const res = await fetch(`${base}/api/admin/clear-db`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        // 1. Immediately wipe in-memory store AND localStorage (keeps users+settings)
        store.hardReset(true);
        // 2. Force-sync from server to confirm empty state
        await store.refreshFromServer(true);
        await fetchDbStats();
        await fetchBackups();
        setStatus({ type: 'success', msg: 'All data cleared successfully. Users and settings preserved.' });
      } else { setStatus({ type: 'error', msg: data.error || 'Clear failed' }); }
    } catch (e: any) { setStatus({ type: 'error', msg: e.message }); }
    finally { setIsClearing(false); setTimeout(() => setStatus(null), 6000); }
  };

  // ── Import from JSON backup file ────────────────────────────────────────────
  const handleImportJson = async (file: File) => {
    setIsImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch(`${base}/api/admin/import-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (res.ok) {
        setImportResult({ type: 'success', ...result });
        setStatus({ type: 'success', msg: 'Import complete. Reloading data...' });
        await store.refreshFromServer(true);
        await fetchDbStats();
      } else { setImportResult({ type: 'error', message: result.error }); setStatus({ type: 'error', msg: result.error }); }
    } catch (e: any) { setImportResult({ type: 'error', message: e.message }); setStatus({ type: 'error', msg: e.message }); }
    finally { setIsImporting(false); setTimeout(() => setStatus(null), 6000); }
  };

  // ── Parse CSV/Excel file on client side ─────────────────────────────────────
  const handleCsvFile = (file: File) => {
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length === 0) return;
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      setCsvHeaders(headers);
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.replace(/"/g, '').trim());
        const obj: any = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
      }).filter(r => Object.values(r).some(v => v));
      setCsvPreview(rows.slice(0, 5));
    };
    reader.readAsText(file);
  };

  const handleImportCsv = async () => {
    if (csvPreview.length === 0 && !csvFile) return;
    setIsImporting(true);
    setImportResult(null);
    try {
      const text = await csvFile!.text();
      const lines = text.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.replace(/"/g, '').trim());
        const obj: any = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
      }).filter(r => Object.values(r).some(v => v));

      const res = await fetch(`${base}/api/admin/import-products-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      });
      const result = await res.json();
      if (res.ok) {
        setImportResult({ type: 'success', ...result });
        setStatus({ type: 'success', msg: `CSV import done: ${result.results?.created || 0} created, ${result.results?.updated || 0} updated` });
        await store.refreshFromServer(true);
        await fetchDbStats();
        setCsvPreview([]); setCsvHeaders([]); setCsvFile(null);
      } else { setImportResult({ type: 'error', message: result.error }); }
    } catch (e: any) { setImportResult({ type: 'error', message: e.message }); }
    finally { setIsImporting(false); setTimeout(() => setStatus(null), 6000); }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-20">
      <header>
        <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Infrastructure Control</h1>
        <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest mt-2">Relational Engine Diagnostics • Cloud Bridge Management</p>
      </header>

      {status && (
        <div className={`p-6 rounded-[30px] font-black text-sm text-center border-2 animate-in slide-in-from-top-4 shadow-xl ${status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
          <i className={`fas ${status.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'} mr-3`}></i>
          {status.msg}
        </div>
      )}

      {connError && (
        <div className="p-6 rounded-[30px] bg-rose-900 text-rose-100 font-black text-xs space-y-2 shadow-2xl border-4 border-rose-800 animate-pulse">
           <div className="flex items-center gap-3">
              <i className="fas fa-plug-circle-xmark text-xl"></i>
              <span className="uppercase tracking-widest">Connection Protocol Fault Detected</span>
           </div>
           <p className="font-mono text-[10px] opacity-70 bg-black/20 p-4 rounded-xl">
             {typeof connError === 'object' ? JSON.stringify(connError, null, 2) : connError}
           </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Persistence Engine Card */}
        <div className="bg-slate-900 p-10 rounded-[50px] shadow-2xl text-white space-y-10 relative overflow-hidden">
           <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 blur-[100px] pointer-events-none"></div>
           <div>
              <div className="flex justify-between items-start">
                <div>
                   <h3 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                      <i className={`fas fa-circle ${dbConnected ? 'text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'text-rose-500 animate-pulse'}`}></i>
                      MySQL Persistence Bridge
                   </h3>
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">GCP Cloud SQL Status (35.193.166.120)</p>
                </div>
                <div className={`px-4 py-2 rounded-xl border font-black text-[10px] uppercase tracking-widest ${dbConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                   {dbConnected ? 'ENGINE ACTIVE' : 'ENGINE OFFLINE'}
                </div>
              </div>
           </div>

           <div className="space-y-6 z-10 relative">
              <div className="bg-white/5 border border-white/10 p-6 rounded-[30px] space-y-4">
                 <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase">Cloud Node IP</span>
                    <span className="text-[11px] font-bold text-white font-mono">{dbStatus?.host || '35.193.166.120'}</span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase">API Endpoint</span>
                    <span className="text-[11px] font-bold text-amber-500">{profile.backendUrl || 'Local Context'}</span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase">Last Handshake</span>
                    <span className="text-[11px] font-bold text-emerald-400">{dbStatus?.timestamp ? new Date(dbStatus.timestamp).toLocaleTimeString() : 'Awaiting Heartbeat...'}</span>
                 </div>
              </div>

              <div className="space-y-2">
                 <label className="text-[9px] font-black text-slate-500 uppercase ml-4">Backend Base URL (Include http/https)</label>
                 <input 
                    type="text" 
                    placeholder="https://your-backend.com" 
                    className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-2xl font-bold text-white focus:border-amber-500 outline-none transition-all"
                    value={profile.backendUrl}
                    onChange={e => setProfile({...profile, backendUrl: e.target.value})}
                 />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                 <button 
                   onClick={handleForceRefresh}
                   disabled={isSyncing}
                   className="py-5 bg-white/5 hover:bg-white/10 text-white rounded-[30px] font-black text-[10px] uppercase tracking-widest transition-all border border-white/10 flex items-center justify-center gap-3"
                 >
                   <i className={`fas fa-sync ${isSyncing ? 'animate-spin' : ''}`}></i> Force Hydrate
                 </button>
                 <button 
                   onClick={handleCloudMigration}
                   disabled={isMigrating}
                   className="py-5 bg-amber-600 hover:bg-amber-500 text-white rounded-[30px] font-black text-[10px] uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-3"
                 >
                   <i className={`fas fa-cloud-upload-alt ${isMigrating ? 'animate-pulse' : ''}`}></i> Push To MySQL
                 </button>
              </div>
           </div>
        </div>

        {/* Live Diagnostic Feed */}
        <div className="bg-white p-10 rounded-[50px] shadow-sm border border-slate-100 flex flex-col">
           <div className="mb-8">
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                 <i className="fas fa-terminal text-amber-500"></i> Connectivity Log
              </h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Sequential audit of all handshake attempts</p>
           </div>
           
           <div className="flex-1 overflow-y-auto scrollbar-hide space-y-3">
              {logs.length === 0 ? (
                 <div className="p-20 text-center text-slate-200 font-black uppercase italic">Feed Initializing...</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className={`p-4 rounded-2xl border flex justify-between items-center animate-in slide-in-from-left-2 ${log.dbConnected ? 'bg-slate-50 border-slate-100' : 'bg-rose-50 border-rose-100'}`}>
                     <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs ${log.dbConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                           <i className={`fas ${log.dbConnected ? 'fa-check' : 'fa-times'}`}></i>
                        </div>
                        <div>
                           <div className="text-[10px] font-black text-slate-800 uppercase leading-none">{log.dbConnected ? 'Handshake Success' : 'Handshake Failed'}</div>
                           <div className="text-[8px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">{log.timestamp} • Latency: {log.latency ? `${log.latency}ms` : 'N/A'}</div>
                        </div>
                     </div>
                     {log.error && (
                        <div className="text-right max-w-[150px]">
                           <div className="text-[7px] font-black text-rose-400 uppercase truncate" title={log.error}>{log.error}</div>
                        </div>
                     )}
                  </div>
                ))
              )}
           </div>
        </div>

        {/* Backup & Recovery — REBUILT */}
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 space-y-6 lg:col-span-2">

          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                <i className="fas fa-database text-amber-500"></i> Backup & Data Management
              </h3>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Snapshots · Restore · Import (JSON / CSV·Excel) · Clear DB</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleTriggerBackup} disabled={isBackingUp}
                className="px-4 py-2 bg-slate-900 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-700 transition-all flex items-center gap-2 disabled:opacity-50">
                <i className={`fas fa-plus ${isBackingUp ? 'animate-spin' : ''}`}></i> Create Snapshot
              </button>
              <a href={`${base}/api/backups/sql`}
                className="px-4 py-2 bg-emerald-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-emerald-500 transition-all flex items-center gap-2">
                <i className="fas fa-file-export"></i> Export SQL
              </a>
              <button onClick={() => setShowDataPanel(!showDataPanel)}
                className={`px-4 py-2 rounded-2xl font-black text-[9px] uppercase tracking-widest transition-all flex items-center gap-2 ${showDataPanel ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}>
                <i className="fas fa-tools"></i> Data Tools
              </button>
            </div>
          </div>

          {/* DB Stats Bar */}
          {dbStats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Products', val: dbStats.counts?.products ?? dbStats.counts?.['products'] ?? 0, icon: 'fa-box', color: 'text-blue-600 bg-blue-50' },
                { label: 'Sales', val: dbStats.counts?.sales ?? 0, icon: 'fa-receipt', color: 'text-emerald-600 bg-emerald-50' },
                { label: 'Purchases', val: dbStats.counts?.purchases ?? 0, icon: 'fa-truck', color: 'text-amber-600 bg-amber-50' },
                { label: 'Orders', val: dbStats.counts?.vendor_orders ?? 0, icon: 'fa-clipboard-list', color: 'text-indigo-600 bg-indigo-50' },
                { label: 'Snapshots', val: dbStats.backupCount ?? 0, icon: 'fa-save', color: 'text-rose-600 bg-rose-50' },
              ].map(({ label, val, icon, color }) => (
                <div key={label} className={`rounded-2xl p-3 ${color.split(' ')[1]} flex items-center gap-3`}>
                  <i className={`fas ${icon} ${color.split(' ')[0]}`}></i>
                  <div>
                    <div className="text-[8px] font-black text-slate-400 uppercase">{label}</div>
                    <div className="text-lg font-black text-slate-900">{val.toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Data Tools Panel ── */}
          {showDataPanel && (
            <div className="border-2 border-dashed border-indigo-200 rounded-[28px] p-6 space-y-6 bg-indigo-50/30">
              <div className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Data Tools — Admin Only</div>

              {/* Import mode selector */}
              <div className="flex gap-2">
                {(['json','csv'] as const).map(m => (
                  <button key={m} onClick={() => { setImportMode(m); setImportResult(null); setCsvPreview([]); setCsvHeaders([]); setCsvFile(null); }}
                    className={`px-5 py-2 rounded-full font-black text-[9px] uppercase tracking-widest transition-all ${importMode === m ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-500 border border-indigo-200 hover:bg-indigo-50'}`}>
                    {m === 'json' ? 'Import JSON Backup' : 'Import CSV / Excel'}
                  </button>
                ))}
              </div>

              {/* JSON Import */}
              {importMode === 'json' && (
                <div className="space-y-3">
                  <div className="text-sm font-bold text-slate-600">Upload a previously downloaded <code>.json</code> backup file to restore data.</div>
                  <label className="flex items-center gap-3 px-5 py-4 bg-white border-2 border-dashed border-indigo-200 rounded-2xl cursor-pointer hover:border-indigo-400 transition-all">
                    <i className="fas fa-file-import text-indigo-400 text-xl"></i>
                    <div>
                      <div className="font-black text-sm text-slate-700">Choose JSON backup file</div>
                      <div className="text-[9px] text-slate-400 font-bold">Accepts: backup-*.json files downloaded from this panel</div>
                    </div>
                    <input type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImportJson(f); }} />
                  </label>
                  {isImporting && <div className="text-sm font-black text-indigo-500 animate-pulse">Importing... please wait</div>}
                </div>
              )}

              {/* CSV Import */}
              {importMode === 'csv' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl p-4 border border-indigo-100 text-xs font-bold text-slate-600 space-y-2">
                    <div className="font-black text-slate-800 text-sm mb-2">CSV / Excel column mapping</div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                      {[
                        ['Product Name', 'name or Name'], ['Category', 'category'], ['Brand', 'brand'],
                        ['Size', 'size'], ['Purchase Price', 'purchasePrice or Rate'], ['Selling Price', 'sellingPrice or MRP'],
                        ['Stock Boxes', 'stockBoxes or Qty or Stock'], ['Tiles Per Box', 'tilesPerBox (default 4)'],
                        ['Sqft Per Box', 'sqftPerBox (default 16)'], ['Grade', 'grade (default Premium)'],
                        ['Reorder Level', 'reorderLevel (default 10)'], ['Status', 'Active or Suspended'],
                      ].map(([col, hint]) => (
                        <div key={col} className="flex gap-2">
                          <code className="text-indigo-600 font-black">{col}</code>
                          <span className="text-slate-400">→ {hint}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-[9px] text-amber-600 font-black mt-2 bg-amber-50 rounded-xl px-3 py-2">
                      ⚠ Products matched by Name + Size — existing products are UPDATED, new ones are CREATED. Stock is set from "Stock Boxes" column.
                    </div>
                  </div>

                  <label className="flex items-center gap-3 px-5 py-4 bg-white border-2 border-dashed border-indigo-200 rounded-2xl cursor-pointer hover:border-indigo-400 transition-all">
                    <i className="fas fa-file-csv text-emerald-500 text-xl"></i>
                    <div>
                      <div className="font-black text-sm text-slate-700">{csvFile ? csvFile.name : 'Choose CSV file'}</div>
                      <div className="text-[9px] text-slate-400 font-bold">Save Excel as CSV first, then upload here</div>
                    </div>
                    <input type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); }} />
                  </label>

                  {/* Preview */}
                  {csvPreview.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[9px] font-black text-slate-400 uppercase">Preview — first 5 rows</div>
                      <div className="overflow-x-auto rounded-2xl border border-slate-100">
                        <table className="text-[10px] w-full">
                          <thead className="bg-slate-50">
                            <tr>{csvHeaders.map(h => <th key={h} className="px-3 py-2 text-left font-black text-slate-500 whitespace-nowrap">{h}</th>)}</tr>
                          </thead>
                          <tbody>
                            {csvPreview.map((row, i) => (
                              <tr key={i} className="border-t border-slate-50">
                                {csvHeaders.map(h => <td key={h} className="px-3 py-2 font-bold text-slate-600 whitespace-nowrap max-w-[120px] truncate">{row[h]}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button onClick={handleImportCsv} disabled={isImporting}
                        className="w-full py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50">
                        {isImporting ? 'Importing...' : `Import to Inventory`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Import result */}
              {importResult && (
                <div className={`rounded-2xl px-5 py-4 ${importResult.type === 'success' ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
                  {importResult.type === 'success' ? (
                    <div className="space-y-1">
                      <div className="font-black text-emerald-700 text-sm">✓ Import successful</div>
                      {importResult.counts && (
                        <div className="text-xs text-emerald-600 font-bold">
                          Products: {importResult.counts.products || 0} · Sales: {importResult.counts.sales || 0} · Orders: {importResult.counts.vendorOrders || 0}
                        </div>
                      )}
                      {importResult.results && (
                        <div className="text-xs text-emerald-600 font-bold">
                          Created: {importResult.results.created} · Updated: {importResult.results.updated} · Skipped: {importResult.results.skipped}
                          {importResult.results.errors?.length > 0 && <span className="text-amber-600 ml-2">{importResult.results.errors.length} errors</span>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="font-black text-rose-700 text-sm">✗ {importResult.message}</div>
                  )}
                </div>
              )}

              {/* Danger zone — Clear DB */}
              <div className="border border-rose-200 rounded-2xl p-4 space-y-3 bg-rose-50/50">
                <div className="flex items-center gap-2">
                  <i className="fas fa-exclamation-triangle text-rose-500"></i>
                  <span className="font-black text-rose-700 text-sm uppercase tracking-wide">Danger Zone</span>
                </div>
                <p className="text-xs text-rose-600 font-bold">Permanently deletes ALL data (products, sales, purchases, orders) from the database. An automatic backup is created first. Use for dev resets or fresh deployments.</p>
                <button onClick={handleClearDb} disabled={isClearing}
                  className="px-6 py-3 bg-rose-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-700 transition-all flex items-center gap-2 disabled:opacity-50">
                  <i className="fas fa-trash-alt"></i>
                  {isClearing ? 'Clearing...' : 'Clear All Data from DB'}
                </button>
              </div>
            </div>
          )}

          {/* Snapshot list */}
          <div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Saved Snapshots ({backups.length})</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[360px] overflow-y-auto pr-1">
              {backups.length === 0 ? (
                <div className="col-span-3 p-10 text-center text-slate-300 font-black uppercase italic border-2 border-dashed border-slate-100 rounded-[24px]">No snapshots yet</div>
              ) : backups.map((backup, idx) => {
                const ts = new Date(backup.timestamp.replace(/-/g, ':'));
                const isRecent = Date.now() - ts.getTime() < 3600000;
                return (
                  <div key={idx} className={`p-4 rounded-[20px] border space-y-3 group transition-all hover:shadow-md ${isRecent ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-100 bg-slate-50'}`}>
                    <div className="flex justify-between items-start">
                      <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center text-slate-400 group-hover:text-amber-500 transition-colors shadow-sm">
                        <i className="fas fa-file-code text-sm"></i>
                      </div>
                      {isRecent && <span className="text-[8px] font-black text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full uppercase">Recent</span>}
                    </div>
                    <div>
                      <div className="text-[9px] font-black text-slate-900 truncate" title={backup.filename}>{backup.filename.replace('backup-','').replace('.json','')}</div>
                      <div className="text-[8px] font-bold text-slate-400 mt-0.5">{ts.toLocaleDateString()} {ts.toLocaleTimeString()}</div>
                    </div>
                    <div className="flex gap-2">
                      <a href={`${base}${backup.url}`} download
                        className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[8px] uppercase tracking-widest text-center hover:bg-slate-50 transition-all">
                        Download
                      </a>
                      <button onClick={() => handleRestore(backup.filename)}
                        className="flex-1 py-2 bg-amber-50 text-amber-700 rounded-xl font-black text-[8px] uppercase tracking-widest hover:bg-amber-100 transition-all">
                        Restore
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Kadapa Stone Types Card */}
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-2xl flex items-center justify-center">
              <span className="text-amber-600 font-black text-sm">K</span>
            </div>
            <div>
              <h3 className="font-black text-slate-800 uppercase tracking-tight">Kadapa Stone Config</h3>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Finish types · Rates per SqFt · Global rates</p>
            </div>
          </div>
          <KadapaSettings />
        </div>

        {/* Business Registry Card */}
        <div className="bg-white p-10 rounded-[50px] shadow-sm border border-slate-100 space-y-8 flex flex-col justify-between lg:col-span-2">
           <div>
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                 <i className="fas fa-id-card text-amber-500"></i> Identity Registry
              </h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Configure global display headers</p>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="space-y-1">
                   <label className="text-[8px] font-black text-slate-400 uppercase ml-4">Showroom Name</label>
                   <input type="text" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all" value={profile.showroomName} onChange={e => setProfile({...profile, showroomName: e.target.value})} />
                </div>
                <div className="space-y-1">
                   <label className="text-[8px] font-black text-slate-400 uppercase ml-4">HQ Address</label>
                   <input type="text" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-bold focus:border-slate-900 outline-none transition-all" value={profile.showroomAddress} onChange={e => setProfile({...profile, showroomAddress: e.target.value})} />
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-[8px] font-black text-slate-400 uppercase ml-4">GST Registry</label>
                     <input type="text" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all" value={profile.showroomGst} onChange={e => setProfile({...profile, showroomGst: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                     <label className="text-[8px] font-black text-slate-400 uppercase ml-4">System Title</label>
                     <input type="text" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all" value={profile.systemBranding} onChange={e => setProfile({...profile, systemBranding: e.target.value})} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-[8px] font-black text-slate-400 uppercase ml-4">Gallery Notification Offer (Marquee)</label>
                     <input type="text" placeholder="e.g. Special 10% discount on all Granite this week!" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all" value={profile.galleryNotification} onChange={e => setProfile({...profile, galleryNotification: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                     <label className="text-[8px] font-black text-slate-400 uppercase ml-4">Decimal Place / Rounding Text</label>
                     <input type="text" placeholder="e.g. Prices are rounded to 2 decimal places" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all" value={profile.decimalPlaceText} onChange={e => setProfile({...profile, decimalPlaceText: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-1">
                   <label className="text-[8px] font-black text-slate-400 uppercase ml-4">Backup Frequency</label>
                   <select 
                     className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all"
                     value={profile.backupFrequency}
                     onChange={e => setProfile({...profile, backupFrequency: e.target.value as any})}
                   >
                     <option value="15min">Every 15 Minutes</option>
                     <option value="1hour">Every 1 Hour</option>
                     <option value="daily">Daily (24 Hours)</option>
                     <option value="Never">Never</option>
                   </select>
                </div>
                <button onClick={handleUpdateProfile} className="w-full py-6 bg-slate-900 text-white rounded-[30px] font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg active:scale-95 mt-4">Commit Configurations</button>
              </div>
           </div>
        </div>
      </div>

      {/* Feature Management */}
      <div className="bg-white p-10 rounded-[50px] shadow-sm border border-slate-100 space-y-8">
         <div>
            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
               <i className="fas fa-toggle-on text-amber-500"></i> Advanced Feature Management
            </h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Enable or disable specialized inventory and sales workflows</p>
         </div>
         
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-100 group hover:border-amber-200 transition-all">
               <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-slate-400 group-hover:text-amber-500 transition-colors">
                     <i className="fas fa-layer-group"></i>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight">Individual Slab Management</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">For Kadapa, Granite, Marble</span>
                  </div>
               </div>
               <button 
                 onClick={() => {
                   const newVal = !store.settings.enableIndividualSlabManagement;
                   store.updateIndividualSlabManagement(newVal);
                   setStatus({ type: 'success', msg: `Individual Slab Management ${newVal ? 'Enabled' : 'Disabled'}.` });
                   setTimeout(() => setStatus(null), 3000);
                 }}
                 className={`w-12 h-6 rounded-full transition-all relative ${store.settings.enableIndividualSlabManagement ? 'bg-amber-500' : 'bg-slate-300'}`}
               >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${store.settings.enableIndividualSlabManagement ? 'left-7' : 'left-1'}`}></div>
               </button>
            </div>

            {/* GST Print Toggles */}
            {[
              { key: 'printShowCompanyGst' as const, icon: 'fa-building', label: 'Show Company GST on Print', sub: 'Your GST number appears on quotations & invoices' },
              { key: 'printShowCustomerGst' as const, icon: 'fa-user', label: 'Show Customer GST on Print', sub: 'Customer GST shown if entered in the form' },
              { key: 'allowItemImagesInDocs' as const, icon: 'fa-image', label: 'Allow Item Images in Quotations & Invoices', sub: 'Master switch — lets creators toggle images per document. Images help customers identify selected products' },
              { key: 'allowProductPhotos' as const, icon: 'fa-camera', label: 'Allow Product Photo Upload', sub: 'Staff can capture or upload photos against inventory items using camera or gallery' },
            ].map(({ key, icon, label, sub }) => (
              <div key={key} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/50 hover:bg-amber-50 transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-slate-400 group-hover:text-amber-500 transition-colors">
                    <i className={`fas ${icon}`}></i>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight">{label}</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{sub}</span>
                  </div>
                </div>
                <button
                  onClick={() => store.updateSettings({ [key]: !(store.settings as any)[key] } as any)}
                  className={`w-12 h-6 rounded-full transition-all relative ${(store.settings as any)[key] !== false ? 'bg-amber-500' : 'bg-slate-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${(store.settings as any)[key] !== false ? 'left-7' : 'left-1'}`}></div>
                </button>
              </div>
            ))}
         </div>
      </div>

      {/* Dashboard Visibility Controls */}
      <div className="bg-white p-10 rounded-[50px] shadow-sm border border-slate-100 space-y-8">
         <div>
            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
               <i className="fas fa-eye text-amber-500"></i> Executive Dashboard Visibility
            </h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Control visibility of commercial metrics for all user nodes</p>
         </div>
         
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { key: 'showDailyBooking', label: 'Daily Booking', icon: 'fa-shopping-cart' },
              { key: 'showOverdueOption', label: 'Overdue Arrears', icon: 'fa-hand-holding-usd' },
              { key: 'showStockValuation', label: 'Stock Valuation', icon: 'fa-warehouse' },
              { key: 'showGrossMargin', label: 'Gross Margin', icon: 'fa-chart-line' },
              { key: 'showNetProfit', label: 'Net Profit', icon: 'fa-vault' },
              { key: 'showGalleryStock', label: 'Show Gallery Stock', icon: 'fa-boxes' },
              { key: 'enableGalleryCart', label: 'Enable Gallery Cart', icon: 'fa-cart-shopping' },
              { key: 'enableGalleryOtp', label: 'Enable Gallery OTP', icon: 'fa-key' }
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-100 group hover:border-amber-200 transition-all">
                 <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-slate-400 group-hover:text-amber-500 transition-colors">
                       <i className={`fas ${item.icon}`}></i>
                    </div>
                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight">{item.label}</span>
                 </div>
                 <button 
                   onClick={() => {
                     const k = item.key as keyof typeof visibility;
                     const newVisibility = { ...visibility, [k]: !visibility[k] };
                     setVisibility(newVisibility);
                     store.updateDashboardVisibility(newVisibility);
                     setStatus({ type: 'success', msg: `Dashboard visibility for ${item.label} updated.` });
                     setTimeout(() => setStatus(null), 3000);
                   }}
                   className={`w-12 h-6 rounded-full transition-all relative ${visibility[item.key as keyof typeof visibility] ? 'bg-amber-500' : 'bg-slate-300'}`}
                 >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${visibility[item.key as keyof typeof visibility] ? 'left-7' : 'left-1'}`}></div>
                 </button>
              </div>
            ))}
         </div>
      </div>

      {/* Product Category Registry */}
      <div className="bg-white p-10 rounded-[50px] shadow-sm border border-slate-100 space-y-8">
         <div className="flex justify-between items-start">
            <div>
               <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                  <i className="fas fa-tags text-amber-500"></i> Product Category Registry
               </h3>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Define standard categories for inventory items</p>
            </div>
            <div className="flex gap-2">
               <input 
                  type="text" 
                  placeholder="Add Category (e.g. Sanitary)" 
                  className="px-6 py-3 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all text-xs"
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  onKeyPress={e => {
                    if (e.key === 'Enter' && newCategory.trim()) {
                      const updated = [...categories, newCategory.trim()];
                      setCategories(updated);
                      store.updateCategories(updated);
                      setNewCategory('');
                      setStatus({ type: 'success', msg: 'Category added to registry.' });
                      setTimeout(() => setStatus(null), 3000);
                    }
                  }}
               />
               <button 
                  onClick={() => {
                    if (newCategory.trim()) {
                      const updated = [...categories, newCategory.trim()];
                      setCategories(updated);
                      store.updateCategories(updated);
                      setNewCategory('');
                      setStatus({ type: 'success', msg: 'Category added to registry.' });
                      setTimeout(() => setStatus(null), 3000);
                    }
                  }}
                  className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
               >
                  Add
               </button>
            </div>
         </div>

         <div className="flex flex-wrap gap-3">
            {categories.length === 0 ? (
               <div className="w-full p-10 text-center text-slate-300 font-black uppercase italic border-2 border-dashed border-slate-100 rounded-[30px]">No predefined categories configured</div>
            ) : (
               categories.map((cat, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-6 py-3 bg-slate-50 border border-slate-100 rounded-2xl group hover:border-amber-200 transition-all">
                     <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight">{cat}</span>
                     <button 
                        onClick={() => {
                           const updated = categories.filter((_, i) => i !== idx);
                           setCategories(updated);
                           store.updateCategories(updated);
                           setStatus({ type: 'success', msg: 'Category removed from registry.' });
                           setTimeout(() => setStatus(null), 3000);
                        }}
                        className="text-slate-300 hover:text-rose-500 transition-colors"
                     >
                        <i className="fas fa-times-circle"></i>
                     </button>
                  </div>
               ))
            )}
         </div>
      </div>

      {/* Product Size Registry */}
      <div className="bg-white p-10 rounded-[50px] shadow-sm border border-slate-100 space-y-8">
         <div className="flex justify-between items-start">
            <div>
               <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                  <i className="fas fa-ruler-combined text-amber-500"></i> Product Size Registry
               </h3>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Define standard sizes for inventory items</p>
            </div>
            <div className="flex gap-2">
               <input 
                  type="text" 
                  placeholder="Add Size (e.g. 600x600)" 
                  className="px-6 py-3 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all text-xs"
                  value={newSize}
                  onChange={e => setNewSize(e.target.value)}
                  onKeyPress={e => {
                    if (e.key === 'Enter' && newSize.trim()) {
                      const updated = [...predefinedSizes, newSize.trim()];
                      setPredefinedSizes(updated);
                      store.updatePredefinedSizes(updated);
                      setNewSize('');
                      setStatus({ type: 'success', msg: 'Size added to registry.' });
                      setTimeout(() => setStatus(null), 3000);
                    }
                  }}
               />
               <button 
                  onClick={() => {
                    if (newSize.trim()) {
                      const updated = [...predefinedSizes, newSize.trim()];
                      setPredefinedSizes(updated);
                      store.updatePredefinedSizes(updated);
                      setNewSize('');
                      setStatus({ type: 'success', msg: 'Size added to registry.' });
                      setTimeout(() => setStatus(null), 3000);
                    }
                  }}
                  className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
               >
                  Add
               </button>
            </div>
         </div>

         <div className="flex flex-wrap gap-3">
            {predefinedSizes.length === 0 ? (
               <div className="w-full p-10 text-center text-slate-300 font-black uppercase italic border-2 border-dashed border-slate-100 rounded-[30px]">No predefined sizes configured</div>
            ) : (
               predefinedSizes.map((size, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-6 py-3 bg-slate-50 border border-slate-100 rounded-2xl group hover:border-amber-200 transition-all">
                     <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight">{size}</span>
                     <button 
                        onClick={() => {
                           const updated = predefinedSizes.filter((_, i) => i !== idx);
                           setPredefinedSizes(updated);
                           store.updatePredefinedSizes(updated);
                           setStatus({ type: 'success', msg: 'Size removed from registry.' });
                           setTimeout(() => setStatus(null), 3000);
                        }}
                        className="text-slate-300 hover:text-rose-500 transition-colors"
                     >
                        <i className="fas fa-times-circle"></i>
                     </button>
                  </div>
               ))
            )}
         </div>
      </div>

      <LoadingChargeManager />
    </div>
  );
};

export default SystemControl;
