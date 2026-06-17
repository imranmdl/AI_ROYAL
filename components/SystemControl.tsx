
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
  const [predefinedBrands, setPredefinedBrands]   = useState<string[]>(store.settings.predefinedBrands || []);
  const [predefinedGrades, setPredefinedGrades]   = useState<string[]>(store.settings.predefinedGrades || []);
  const [predefinedShades, setPredefinedShades]   = useState<string[]>(store.settings.predefinedShades || []);
  const [predefinedBatches, setPredefinedBatches] = useState<string[]>(store.settings.predefinedBatches || []);
  const [newBrand, setNewBrand]   = useState('');
  const [newGrade, setNewGrade]   = useState('');
  const [newShade, setNewShade]   = useState('');
  const [newBatch, setNewBatch]   = useState('');
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


      {/* ── Item Creation Source Control ── */}
      <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8 space-y-6">
        <div>
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">New Item Creation — Access Control</h3>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
            Control where staff are allowed to create brand-new inventory items
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { val: 'both',      icon: 'fa-unlock',     label: 'Allow Both',           sub: 'New items can be created from Inventory or Vendor Supply Chain' },
            { val: 'vendor',    icon: 'fa-truck',      label: 'Vendor Page Only',     sub: 'New items can only be created when adding a vendor purchase order' },
            { val: 'inventory', icon: 'fa-warehouse',  label: 'Inventory Page Only',  sub: 'New items can only be created from the Inventory Ecosystem page' },
          ].map(opt => {
            const active = (store.settings.itemCreationSource || 'both') === opt.val;
            return (
              <button key={opt.val}
                onClick={() => { store.updateSettings({ itemCreationSource: opt.val as any }); setStatus({ type:'success', msg:`Item creation set to: ${opt.label}` }); setTimeout(()=>setStatus(null),3000); }}
                className={`text-left p-5 rounded-2xl border-2 transition-all ${active ? 'border-amber-500 bg-amber-50' : 'border-slate-100 bg-slate-50 hover:border-slate-200'}`}>
                <i className={`fas ${opt.icon} text-lg ${active ? 'text-amber-600' : 'text-slate-400'} mb-2 block`}></i>
                <div className="text-[11px] font-black text-slate-700 uppercase tracking-tight">{opt.label}</div>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">{opt.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Predefined Brands / Grades / Shades / Batches ── */}
      {([
        { title: 'Brands Registry',      icon: 'fa-tags',     items: predefinedBrands,  setItems: setPredefinedBrands,  newVal: newBrand,  setNewVal: setNewBrand,  updater: 'updatePredefinedBrands',  placeholder: 'Add Brand (e.g. Kajaria)' },
        { title: 'Grades Registry',      icon: 'fa-medal',    items: predefinedGrades,  setItems: setPredefinedGrades,  newVal: newGrade,  setNewVal: setNewGrade,  updater: 'updatePredefinedGrades',  placeholder: 'Add Grade (e.g. Premium)' },
        { title: 'Shade Numbers Registry', icon: 'fa-palette', items: predefinedShades,  setItems: setPredefinedShades,  newVal: newShade,  setNewVal: setNewShade,  updater: 'updatePredefinedShades',  placeholder: 'Add Shade No (e.g. SH-06)' },
        { title: 'Batch Numbers Registry', icon: 'fa-barcode', items: predefinedBatches, setItems: setPredefinedBatches, newVal: newBatch,  setNewVal: setNewBatch,  updater: 'updatePredefinedBatches', placeholder: 'Add Batch No (e.g. B-2025-A)' },
      ] as const).map(reg => (
        <div key={reg.title} className="bg-white rounded-[40px] border border-slate-100 shadow-sm p-8 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                <i className={`fas ${reg.icon} text-amber-500`}></i>{reg.title}
              </h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                Values shown in dropdowns when adding new items
              </p>
            </div>
            <div className="flex gap-2">
              <input type="text" placeholder={reg.placeholder}
                className="px-6 py-3 bg-slate-50 border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all text-xs"
                value={reg.newVal}
                onChange={e => reg.setNewVal(e.target.value)}
                onKeyPress={e => {
                  if (e.key === 'Enter' && reg.newVal.trim()) {
                    const updated = [...reg.items, reg.newVal.trim()];
                    reg.setItems(updated);
                    (store as any)[reg.updater](updated);
                    reg.setNewVal('');
                    setStatus({ type:'success', msg:`${reg.title.replace(' Registry','')} added.` });
                    setTimeout(()=>setStatus(null),3000);
                  }
                }} />
              <button onClick={() => {
                if (reg.newVal.trim()) {
                  const updated = [...reg.items, reg.newVal.trim()];
                  reg.setItems(updated);
                  (store as any)[reg.updater](updated);
                  reg.setNewVal('');
                  setStatus({ type:'success', msg:`${reg.title.replace(' Registry','')} added.` });
                  setTimeout(()=>setStatus(null),3000);
                }
              }} className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg">
                Add
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {reg.items.length === 0 ? (
              <div className="w-full p-10 text-center text-slate-300 font-black uppercase italic border-2 border-dashed border-slate-100 rounded-[30px]">No {reg.title.toLowerCase()} configured</div>
            ) : (
              reg.items.map((val, idx) => (
                <div key={idx} className="flex items-center gap-3 px-6 py-3 bg-slate-50 border border-slate-100 rounded-2xl group hover:border-amber-200 transition-all">
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight">{val}</span>
                  <button onClick={() => {
                    const updated = reg.items.filter((_, i) => i !== idx);
                    reg.setItems(updated);
                    (store as any)[reg.updater](updated);
                    setStatus({ type:'success', msg:`${reg.title.replace(' Registry','')} removed.` });
                    setTimeout(()=>setStatus(null),3000);
                  }} className="text-slate-300 hover:text-rose-500 transition-colors">
                    <i className="fas fa-times-circle"></i>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ))}

      <LoadingChargeManager />
    </div>
    </div>
  );
};

export default SystemControl;
