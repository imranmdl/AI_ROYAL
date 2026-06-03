
import React, { useState, useEffect } from 'react';
import { store } from '../store';

interface TerminalLog {
  timestamp: string;
  type: 'request' | 'response' | 'error' | 'system' | 'success';
  endpoint: string;
  payload: any;
}

const DiagnosticsTerminal: React.FC = () => {
  const [logs, setLogs] = useState<TerminalLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeConfig, setActiveConfig] = useState<any>(null);
  const [connectionMode, setConnectionMode] = useState<'proxy' | 'direct' | 'socket'>('proxy');

  const [form, setForm] = useState({
    host: '',
    port: '3306',
    database: '',
    user: '',
    password: '',
    socketPath: ''
  });

  const addLog = (type: TerminalLog['type'], endpoint: string, payload: any) => {
    setLogs(prev => [{
      timestamp: new Date().toLocaleTimeString(),
      type,
      endpoint,
      payload
    }, ...prev].slice(0, 50));
  };

  const getApiUrl = (path: string) => {
    const base = store.settings.backendUrl || '';
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    return normalizedBase ? `${normalizedBase}${path}` : path;
  };

  const refreshInfo = async () => {
    try {
      const res = await fetch(getApiUrl('/api/db/config'));
      const data = await res.json();
      setActiveConfig(data);
      setForm({
        host: data.host || '',
        port: (data.port || 3306).toString(),
        database: data.database || '',
        user: data.user || '',
        password: '', // Never populate password from server
        socketPath: data.socketPath || ''
      });
      if (data.socketPath) setConnectionMode('socket');
      else if (data.host && data.host !== 'localhost' && data.host !== '127.0.0.1') setConnectionMode('direct');
      else setConnectionMode('proxy');
    } catch (e) {
      setActiveConfig({ error: "Backend Unreachable" });
    }
  };

  const resetSyncState = async () => {
    if (!confirm("This will clear your local browser cache and force a fresh download from the server. Use this if your data is out of sync. Proceed?")) return;
    localStorage.removeItem('royal_erp_cache');
    localStorage.removeItem('royal_backend_url');
    window.location.reload();
  };

  useEffect(() => {
    refreshInfo();
  }, []);

  const runTest = async () => {
    setIsLoading(true);
    addLog('system', 'DIAGNOSTIC_INIT', `Testing ${connectionMode} connection...`);
    
    try {
      const response = await fetch(getApiUrl('/api/db/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...form,
            socketPath: connectionMode === 'socket' ? form.socketPath : undefined
        }),
        cache: 'no-store'
      });

      const data = await response.json();
      if (response.ok) {
        addLog('success', 'HANDSHAKE_OK', data);
      } else {
        addLog('error', 'HANDSHAKE_FAILED', data);
      }
    } catch (e: any) {
      addLog('error', 'NETWORK_FAULT', { message: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const applyToEngine = async () => {
    if (!confirm("This will REBOOT the persistence layer. Current unsaved state may be lost. Continue?")) return;
    setIsLoading(true);
    addLog('system', 'MIGRATION_START', 'Updating engine configuration...');
    
    try {
      const response = await fetch(getApiUrl('/api/db/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...form,
            socketPath: connectionMode === 'socket' ? form.socketPath : undefined
        }),
        cache: 'no-store'
      });

      const data = await response.json();
      if (response.ok) {
        addLog('success', 'ENGINE_CONFIG_UPDATED', data);
        refreshInfo();
      } else {
        addLog('error', 'ENGINE_CONFIG_REJECTED', data);
      }
    } catch (e: any) {
      addLog('error', 'CRITICAL_FAULT', { message: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Infra Terminal</h1>
          <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest mt-2 italic">Storage & Persistence Management</p>
        </div>
        <div className="bg-slate-900 px-6 py-4 rounded-3xl flex items-center gap-6 border border-slate-800 shadow-xl">
            <button 
              onClick={resetSyncState}
              className="px-4 py-2 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-500 hover:text-white transition-all"
            >
              Reset Sync
            </button>
            <div className="h-8 w-px bg-slate-800"></div>
           <div className="flex flex-col">
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Active Node</span>
              <span className="text-xs font-black text-emerald-400 font-mono italic">
                {activeConfig?.host || activeConfig?.socketPath || 'Node Offline'}
              </span>
           </div>
           <div className="h-8 w-px bg-slate-800"></div>
           <div className="flex flex-col">
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Storage User</span>
              <span className="text-xs font-black text-white italic">{activeConfig?.user || '---'}</span>
           </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white p-10 rounded-[50px] shadow-sm border-2 border-slate-100 space-y-8">
            <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                <button onClick={() => setConnectionMode('proxy')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${connectionMode === 'proxy' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>Proxy (Local)</button>
                <button onClick={() => setConnectionMode('direct')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${connectionMode === 'direct' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>Direct (IP)</button>
                <button onClick={() => setConnectionMode('socket')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${connectionMode === 'socket' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>Socket</button>
            </div>

            <div className="space-y-6">
               <div className="grid grid-cols-4 gap-4">
                  <div className="col-span-3 space-y-1">
                     <label className="text-[9px] font-black text-slate-400 uppercase ml-2">SQL Host / IP</label>
                     <input type="text" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-black text-slate-900 focus:border-amber-500 outline-none transition-all" value={form.host} onChange={e => setForm({...form, host: e.target.value})} disabled={connectionMode === 'socket'} />
                  </div>
                  <div className="col-span-1 space-y-1">
                     <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Port</label>
                     <input type="text" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-black text-slate-900 focus:border-amber-500 outline-none transition-all" value={form.port} onChange={e => setForm({...form, port: e.target.value})} disabled={connectionMode === 'socket'} />
                  </div>
               </div>

               {connectionMode === 'socket' && (
                  <div className="space-y-1 animate-in slide-in-from-top-2">
                     <label className="text-[9px] font-black text-slate-400 uppercase ml-2">GCP Socket Path</label>
                     <input type="text" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-black text-slate-900 focus:border-amber-500 outline-none transition-all font-mono" value={form.socketPath} onChange={e => setForm({...form, socketPath: e.target.value})} />
                  </div>
               )}

               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Database Name</label>
                     <input type="text" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-black text-slate-900 focus:border-amber-500 outline-none transition-all" value={form.database} onChange={e => setForm({...form, database: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                     <label className="text-[9px] font-black text-slate-400 uppercase ml-2">SQL Username</label>
                     <input type="text" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-black text-slate-900 focus:border-amber-500 outline-none transition-all" value={form.user} onChange={e => setForm({...form, user: e.target.value})} />
                  </div>
               </div>

               <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-2">Access Key (Password)</label>
                  <input type="password" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-black text-slate-900 focus:border-amber-500 outline-none transition-all" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
               </div>

               <div className="flex flex-col gap-3 pt-6 border-t border-slate-50">
                  <button 
                    disabled={isLoading}
                    onClick={runTest}
                    className="w-full py-5 bg-slate-900 text-white rounded-[30px] font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
                  >
                    <i className="fas fa-microchip"></i> Test Connection Handshake
                  </button>
                  <button 
                    disabled={isLoading}
                    onClick={applyToEngine}
                    className="w-full py-5 bg-amber-600 text-white rounded-[30px] font-black text-[11px] uppercase tracking-widest hover:bg-amber-700 transition-all shadow-2xl shadow-amber-900/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
                  >
                    <i className="fas fa-link"></i> Attach Engine to Node
                  </button>
               </div>
            </div>
          </div>

          <div className="bg-slate-950 p-8 rounded-[40px] text-slate-400 space-y-6 shadow-2xl relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-[60px]"></div>
             <div className="flex items-center gap-3">
                <i className="fas fa-info-circle text-amber-500"></i>
                <h4 className="text-[10px] font-black text-white uppercase tracking-widest leading-none">Cloud SQL Tip</h4>
             </div>
             <p className="text-[10px] font-medium leading-relaxed italic uppercase">
                If testing via Proxy, ensure your terminal is running: <br/>
                <code className="text-amber-500 bg-white/5 px-2 py-1 rounded block mt-2 text-[8px] font-mono not-italic">cloud-sql-proxy.x64.exe gen-lang-client-0538835665:us-central1:royaltiles</code>
             </p>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col h-[750px]">
           <div className="bg-slate-950 rounded-[50px] shadow-2xl flex-1 flex flex-col overflow-hidden border-4 border-slate-900">
              <div className="bg-slate-900 px-8 py-4 flex justify-between items-center shrink-0">
                 <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                 </div>
                 <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic">Node Activity Stream</div>
                 <button onClick={() => setLogs([])} className="text-[9px] font-black text-slate-600 hover:text-white uppercase transition-colors">Flush</button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-10 font-mono text-[11px] space-y-8 scrollbar-hide">
                 {logs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-800 opacity-20">
                       <i className="fas fa-terminal text-6xl mb-6"></i>
                       <p className="uppercase tracking-[0.4em] font-black italic text-lg">Waiting for Handshake...</p>
                    </div>
                 ) : (
                    logs.map((log, i) => (
                       <div key={i} className={`animate-in slide-in-from-left-4 duration-300 border-l-4 pl-6 ${log.type === 'error' ? 'border-rose-500' : log.type === 'request' ? 'border-blue-500' : log.type === 'success' ? 'border-emerald-500' : 'border-amber-500'}`}>
                          <div className="flex items-center gap-4 mb-3">
                             <span className="text-slate-600 font-bold bg-white/5 px-2 py-0.5 rounded text-[9px]">[{log.timestamp}]</span>
                             <span className={`font-black uppercase tracking-widest text-[10px] ${log.type === 'error' ? 'text-rose-500' : log.type === 'success' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                {log.type}
                             </span>
                             <span className="text-slate-400 font-bold tracking-tight">{log.endpoint}</span>
                          </div>
                          <pre className="bg-black/40 p-6 rounded-3xl text-slate-300 overflow-x-auto scrollbar-hide border border-white/5 shadow-inner">
                             {JSON.stringify(log.payload, null, 2)}
                          </pre>
                       </div>
                    ))
                 )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsTerminal;
