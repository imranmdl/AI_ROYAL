
import React, { useState, useEffect } from 'react';
import { UserRole } from '../types';
import { store } from '../store';

interface SidebarProps {
  currentRole: UserRole;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  userName: string;
}

const Sidebar: React.FC<SidebarProps> = ({ currentRole, activeTab, setActiveTab, onLogout, userName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(store.isOnline);
  const [dbConnected, setDbConnected] = useState(store.dbConnected);
  const [isSyncing, setIsSyncing] = useState(store.isSyncing);
  const [lastUpdated, setLastUpdated] = useState(store.lastUpdated);
  const [showDiag, setShowDiag] = useState(false);
  const [logs, setLogs] = useState(store.healthHistory);
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setIsOnline(store.isOnline);
      setDbConnected(store.dbConnected);
      setIsSyncing(store.isSyncing);
      setLastUpdated(store.lastUpdated);
      setLogs([...store.healthHistory]);
      setTick(t => t + 1);
    });
    return unsub;
  }, []);

  const perms = store.currentUser?.permissions;
  const isAdmin = currentRole === UserRole.ADMIN;
  const branding = store.settings.systemBranding || 'ROYAL ERP';
  
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-tachometer-alt', visible: perms?.canViewDashboard },
    { id: 'inventory', label: 'Inventory Master', icon: 'fa-boxes', visible: perms?.canManageInventory },
    { id: 'vendor_tracking', label: 'Vendor Tracking', icon: 'fa-truck-loading', visible: perms?.canManageInventory },
    { id: 'sales', label: 'Billing & POS', icon: 'fa-file-invoice-dollar', visible: perms?.canManageSales },
    { id: 'quotations', label: 'Quotations', icon: 'fa-file-alt', visible: perms?.canManageSales },
    { id: 'returns', label: 'Returns/Refunds', icon: 'fa-undo', visible: perms?.canManageReturns },
    { id: 'offers', label: 'Promotions', icon: 'fa-percentage', visible: perms?.canManageSales },
    { id: 'commission_master', label: 'Incentives', icon: 'fa-hand-holding-usd', visible: isAdmin },
    { id: 'referral_commission', label: 'Referral Commission', icon: 'fa-user-tag', visible: isAdmin },
    { id: 'credits', label: 'Credit Ledger', icon: 'fa-user-clock', visible: perms?.canViewCredits },
    { id: 'connect', label: 'CRM Connect', icon: 'fa-user-friends', visible: perms?.canManageCustomers },
    { id: 'gallery_leads', label: 'Gallery Orders/Leads', icon: 'fa-images', visible: perms?.canManageGallery },
    { id: 'expenses', label: 'Expenses', icon: 'fa-receipt', visible: perms?.canManageSales },
    { id: 'reports_sales', label: 'P&L Reports', icon: 'fa-chart-line', visible: perms?.canViewReports },
    { id: 'users', label: 'Staff Governance', icon: 'fa-user-shield', visible: perms?.canManageUsers },
    { id: 'system',          label: 'System Architecture', icon: 'fa-cog',          visible: isAdmin },
    { id: 'plans_features',  label: 'Plans & Features',    icon: 'fa-toggle-on',    visible: isAdmin },
    { id: 'backup_restore',   label: 'Backup & Restore',    icon: 'fa-database',     visible: isAdmin },
    { id: 'profile',         label: 'My Account',          icon: 'fa-user-circle',  visible: true },
  ].filter(item => item.visible && store.isModuleEnabled(item.id));

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800">
      <div className="p-6 text-2xl font-bold border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="bg-amber-600 w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-black">
            {branding[0]}
          </div>
          <span className="tracking-tighter font-black text-white uppercase text-lg">{branding}</span>
        </div>
        <button onClick={() => setIsOpen(false)} className="lg:hidden text-slate-400">
          <i className="fas fa-times"></i>
        </button>
      </div>

      <div className="px-6 py-4 space-y-2">
         <button 
           onClick={() => setActiveTab('diagnostics')}
           className={`w-full px-4 py-2 rounded-xl border flex items-center gap-3 transition-all hover:scale-[1.02] ${isOnline ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}
         >
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 animate-pulse'}`}></div>
            <span className={`text-[9px] font-black uppercase tracking-widest ${isOnline ? 'text-emerald-500' : 'text-rose-500'}`}>
               {isOnline ? 'Cloud Linked' : 'Offline Node'}
            </span>
         </button>
         {isOnline && (
           <div className="space-y-2">
             <button 
               onClick={() => setActiveTab('diagnostics')}
               className={`w-full px-4 py-1.5 rounded-xl border flex items-center gap-3 transition-all hover:scale-[1.02] ${dbConnected ? 'bg-amber-500/10 border-amber-500/20' : 'bg-slate-500/10 border-slate-500/20'}`}>
                <i className={`fas fa-database text-[10px] ${dbConnected ? 'text-amber-500' : 'text-slate-500'}`}></i>
                <span className={`text-[8px] font-black uppercase tracking-widest ${dbConnected ? 'text-amber-500' : 'text-slate-500'}`}>
                   {dbConnected ? 'MySQL: Engine Active' : 'MySQL: Pulse Lost'}
                </span>
             </button>
             <button 
               onClick={() => store.refreshFromServer(true)}
               disabled={isSyncing}
               className={`w-full px-4 py-1.5 rounded-xl border flex items-center gap-3 transition-all hover:scale-[1.02] ${isSyncing ? 'bg-amber-500/20 border-amber-500/40 animate-pulse' : 'bg-slate-500/10 border-slate-500/20'}`}>
                <i className={`fas fa-sync-alt text-[10px] ${isSyncing ? 'text-amber-500 animate-spin' : 'text-slate-500'}`}></i>
                <span className={`text-[8px] font-black uppercase tracking-widest ${isSyncing ? 'text-amber-500' : 'text-slate-500'}`}>
                   {isSyncing ? 'Syncing Delta...' : `Last Sync: ${new Date(lastUpdated).toLocaleTimeString()}`}
                </span>
             </button>
           </div>
         )}
      </div>

      <nav className="flex-1 mt-2 overflow-y-auto scrollbar-hide pb-10">
        {menuItems.map(item => (
          <button
            key={item.id}
            onClick={() => { setActiveTab(item.id); setIsOpen(false); }}
            className={`w-full flex items-center gap-4 px-6 py-3.5 transition-all group ${activeTab === item.id ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
          >
            <i className={`fas ${item.icon} w-5 text-sm transition-transform group-hover:scale-110`}></i>
            <span className="text-xs tracking-tight uppercase font-bold">{item.label}</span>
          </button>
        ))}
      </nav>
      
      <div className="p-6 border-t border-slate-800 space-y-4">
        <div className="flex items-center gap-3">
           <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-amber-500 font-black border border-slate-700 shadow-xl">
             {userName[0]}
           </div>
           <div className="overflow-hidden">
              <div className="text-[11px] font-black text-white truncate uppercase">{userName}</div>
              <div className="text-[9px] uppercase text-slate-500 font-bold tracking-widest">{currentRole} Node</div>
           </div>
        </div>
        <button onClick={onLogout} className="w-full text-slate-400 hover:text-white hover:bg-rose-600/10 flex items-center gap-3 text-[10px] font-black uppercase tracking-widest bg-slate-800/50 py-3 px-4 rounded-xl transition-all border border-slate-800">
          <i className="fas fa-sign-out-alt"></i> Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden lg:flex w-64 text-white min-h-screen flex-col sticky top-0 h-screen z-[100] print:hidden">
        {sidebarContent}
      </div>

      <div className="lg:hidden bg-slate-900 text-white p-4 flex items-center justify-between sticky top-0 z-[100] shadow-lg border-b border-slate-800 print:hidden">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tighter">
          <div className="bg-amber-600 w-6 h-6 rounded flex items-center justify-center text-white text-[10px] font-black">{branding[0]}</div>
          <span className="text-white uppercase text-sm font-black">{branding}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}></div>
          <button onClick={() => setIsOpen(true)} className="p-2 text-slate-400 hover:text-white"><i className="fas fa-bars text-xl"></i></button>
        </div>
      </div>

      {isOpen && <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] lg:hidden print:hidden" onClick={() => setIsOpen(false)} />}
      
      <div className={`fixed inset-y-0 left-0 w-64 bg-slate-900 text-white z-[120] transform transition-transform duration-300 lg:hidden flex flex-col print:hidden ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {sidebarContent}
      </div>
    </>
  );
};

export default Sidebar;
