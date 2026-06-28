/**
 * UserManagement.tsx — Staff Governance
 * Full granular permission editor: 35 permissions across 8 modules.
 */
import React, { useState, useCallback } from 'react';
import { store } from '../store';
import { UserRole } from '../types';
import type { User, UserPermissions } from '../types';

// ── Permission groups ────────────────────────────────────────────────────────
const PERM_GROUPS: { label: string; icon: string; color: string; perms: { key: keyof UserPermissions; label: string; desc: string }[] }[] = [
  {
    label: 'Core', icon: 'fa-home', color: 'blue',
    perms: [
      { key: 'canViewDashboard',       label: 'View Dashboard',          desc: 'Business KPIs, charts, quick stats' },
    ],
  },
  {
    label: 'Inventory', icon: 'fa-boxes', color: 'amber',
    perms: [
      { key: 'canManageInventory',     label: 'View Inventory',          desc: 'Browse & search product catalogue' },
      { key: 'canCreateProduct',       label: 'Create Product',          desc: 'Create Master Node / Quick Add & Inward' },
      { key: 'canEditProduct',         label: 'Edit Product',            desc: 'Edit details, pricing, brand, images, grade' },
      { key: 'canDeleteProduct',       label: 'Suspend / Delete',        desc: 'Suspend or permanently delete a product' },
      { key: 'canInwardStock',         label: 'Inward Stock',            desc: 'Add Inward Item / Inward Stock (Advanced)' },
      { key: 'canAdjustStock',         label: 'Adjust Stock',            desc: 'Stock corrections, damage write-offs' },
      { key: 'canImportExportCSV',     label: 'Import / Export CSV',     desc: 'Bulk upload CSV, export templates, Kadapa setup' },
      { key: 'canViewStockLedger',     label: 'View Stock Ledger',       desc: 'Per-product inward/outward audit trail' },
    ],
  },
  {
    label: 'Vendor Supply Chain', icon: 'fa-truck-loading', color: 'purple',
    perms: [
      { key: 'canViewVendorTracking',  label: 'View Vendor Orders',      desc: 'Browse vendor purchase orders & analytics' },
      { key: 'canManageVendorOrders',  label: 'Create / Edit Orders',    desc: 'Create new orders, add items, set invoices & transport' },
      { key: 'canMarkReceivedDamaged', label: 'Receive & Mark Damaged',  desc: 'Mark goods as received or damaged in Receive & Pay tab' },
    ],
  },
  {
    label: 'Sales & Billing', icon: 'fa-cash-register', color: 'emerald',
    perms: [
      { key: 'canManageSales',         label: 'Access Billing & POS',    desc: 'Open the Billing & POS page' },
      { key: 'canCreateInvoice',       label: 'Create Invoice',          desc: 'Create new sales invoice' },
      { key: 'canApplyDiscount',       label: 'Apply Discount',          desc: 'Add item or invoice-level discounts' },
      { key: 'canDeleteInvoice',       label: 'Delete / Void Invoice',   desc: 'Permanently delete a finalized invoice' },
      { key: 'canPrintInvoice',        label: 'Print / Share Invoice',   desc: 'Print PDF or share invoice via WhatsApp' },
      { key: 'canManageQuotations',    label: 'Quotations',              desc: 'Create, edit & convert quotations to invoices' },
      { key: 'canManageReturns',       label: 'Returns & Refunds',       desc: 'Process product returns and issue refunds' },
      { key: 'canManageOffers',        label: 'Promotions & Offers',     desc: 'Create time-limited discount campaigns' },
      { key: 'canRecordPayment',       label: 'Record Payment',          desc: 'Collect cash, UPI, card payments against invoices' },
      { key: 'canViewCollections',     label: 'View Collections',        desc: 'Day-by-day collections report with mode breakdown' },
    ],
  },
  {
    label: 'Credits & Expenses', icon: 'fa-receipt', color: 'rose',
    perms: [
      { key: 'canViewCredits',         label: 'View Credit Ledger',      desc: 'See outstanding credit per customer' },
      { key: 'canManageCredits',       label: 'Manage Credits',          desc: 'Record credit collections, update balances' },
      { key: 'canManageExpenses',      label: 'Manage Expenses',         desc: 'Add, edit, delete business expenses' },
    ],
  },
  {
    label: 'CRM & Leads', icon: 'fa-user-friends', color: 'indigo',
    perms: [
      { key: 'canManageCustomers',     label: 'CRM Connect',             desc: 'Customer profiles, history, follow-ups' },
      { key: 'canManageGallery',       label: 'Gallery Leads',           desc: 'Showroom enquiries, digital catalogue, lead pipeline' },
    ],
  },
  {
    label: 'Analytics & Reports', icon: 'fa-chart-line', color: 'teal',
    perms: [
      { key: 'canViewReports',         label: 'P&L Reports',             desc: 'Invoice-wise P&L, item-wise margin, damage reports' },
      { key: 'canViewVendorAnalytics', label: 'Vendor Analytics',        desc: 'Vendor performance, cost trends, damage analysis' },
      { key: 'canExportReports',       label: 'Export Reports',          desc: 'Download CSV / PDF of reports' },
    ],
  },
  {
    label: 'HR & Commissions', icon: 'fa-user-tie', color: 'orange',
    perms: [
      { key: 'canManageIncentives',    label: 'Incentives Module',       desc: 'Staff commission rules, targets, payouts' },
      { key: 'canManageReferralComm',  label: 'Referral Commission',     desc: 'Referral agents, invoice-wise tracking, WhatsApp broadcast' },
    ],
  },
  {
    label: 'Admin & System', icon: 'fa-shield-alt', color: 'slate',
    perms: [
      { key: 'canManageUsers',         label: 'Staff Governance',        desc: 'Create staff accounts, set roles & permissions' },
      { key: 'canViewSystemSettings',  label: 'View System Settings',    desc: 'View categories, brands, loading charges' },
      { key: 'canChangeSystemSettings',label: 'Edit System Settings',    desc: 'Edit categories, sizes, brands, loading charges' },
      { key: 'canAccessBackupRestore', label: 'Backup & Restore',        desc: 'Download backups, validate, restore data' },
      { key: 'canManagePlansFeatures', label: 'Plans & Features',        desc: 'Enable / disable ERP modules per tenant' },
    ],
  },
];

// ── Role presets ──────────────────────────────────────────────────────────────
const ALL_ON:  Partial<UserPermissions> = Object.fromEntries(PERM_GROUPS.flatMap(g => g.perms.map(p => [p.key, true]))) as any;
const ALL_OFF: Partial<UserPermissions> = Object.fromEntries(PERM_GROUPS.flatMap(g => g.perms.map(p => [p.key, false]))) as any;

const ROLE_PRESETS: Record<string, Partial<UserPermissions>> = {
  admin: { ...ALL_ON },
  manager: {
    ...ALL_ON,
    canDeleteInvoice: false, canManageUsers: false, canChangeSystemSettings: false,
    canAccessBackupRestore: false, canManagePlansFeatures: false, canDeleteProduct: false,
  },
  salesperson: {
    canViewDashboard: true,
    canManageInventory: true, canCreateProduct: false, canEditProduct: false, canDeleteProduct: false,
    canInwardStock: false, canAdjustStock: false, canImportExportCSV: false, canViewStockLedger: false,
    canViewVendorTracking: false, canManageVendorOrders: false, canMarkReceivedDamaged: false,
    canManageSales: true, canCreateInvoice: true, canApplyDiscount: true, canDeleteInvoice: false,
    canPrintInvoice: true, canManageQuotations: true, canManageReturns: false, canManageOffers: false,
    canRecordPayment: true, canViewCollections: false,
    canViewCredits: true, canManageCredits: true, canManageExpenses: false,
    canManageCustomers: true, canManageGallery: true,
    canViewReports: false, canViewVendorAnalytics: false, canExportReports: false,
    canManageIncentives: false, canManageReferralComm: false,
    canManageUsers: false, canViewSystemSettings: false, canChangeSystemSettings: false,
    canAccessBackupRestore: false, canManagePlansFeatures: false,
  },
  storekeeper: {
    canViewDashboard: true,
    canManageInventory: true, canCreateProduct: false, canEditProduct: false, canDeleteProduct: false,
    canInwardStock: true, canAdjustStock: true, canImportExportCSV: false, canViewStockLedger: true,
    canViewVendorTracking: true, canManageVendorOrders: false, canMarkReceivedDamaged: true,
    canManageSales: false, canCreateInvoice: false, canApplyDiscount: false, canDeleteInvoice: false,
    canPrintInvoice: false, canManageQuotations: false, canManageReturns: true, canManageOffers: false,
    canRecordPayment: false, canViewCollections: false,
    canViewCredits: false, canManageCredits: false, canManageExpenses: false,
    canManageCustomers: false, canManageGallery: false,
    canViewReports: false, canViewVendorAnalytics: false, canExportReports: false,
    canManageIncentives: false, canManageReferralComm: false,
    canManageUsers: false, canViewSystemSettings: false, canChangeSystemSettings: false,
    canAccessBackupRestore: false, canManagePlansFeatures: false,
  },
  viewer: {
    ...ALL_OFF,
    canViewDashboard: true, canManageInventory: true, canViewStockLedger: true,
    canViewVendorTracking: true, canViewReports: true,
  },
};

const FULL_PERMS = (overrides: Partial<UserPermissions> = {}): UserPermissions => ({
  ...(ALL_OFF as UserPermissions), ...overrides,
});

const inp  = "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-amber-400 transition-all";
const lbl  = "text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";
const colorMap: Record<string,string> = {
  blue:'bg-blue-50 border-blue-100',amber:'bg-amber-50 border-amber-100',
  purple:'bg-purple-50 border-purple-100',emerald:'bg-emerald-50 border-emerald-100',
  rose:'bg-rose-50 border-rose-100',indigo:'bg-indigo-50 border-indigo-100',
  teal:'bg-teal-50 border-teal-100',orange:'bg-orange-50 border-orange-100',slate:'bg-slate-50 border-slate-200',
};
const iconColorMap: Record<string,string> = {
  blue:'text-blue-600',amber:'text-amber-600',purple:'text-purple-600',emerald:'text-emerald-600',
  rose:'text-rose-600',indigo:'text-indigo-600',teal:'text-teal-600',orange:'text-orange-600',slate:'text-slate-600',
};

const UserManagement: React.FC = () => {
  const users = store.users;
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formUser, setFormUser] = useState({
    name: '', email: '', password: '', role: UserRole.SALESPERSON as UserRole,
    permissions: FULL_PERMS(ROLE_PRESETS.salesperson),
  });

  const applyPreset = (role: UserRole) => {
    const preset = ROLE_PRESETS[role] || {};
    return FULL_PERMS(preset);
  };

  const togglePerm = useCallback((u: User, key: keyof UserPermissions) => {
    const newPerms = { ...u.permissions, [key]: !u.permissions?.[key] };
    const updated = { ...u, permissions: newPerms };
    store.updateUser(u.id, { permissions: newPerms });
    setSelectedUser(updated);
    setSaved(false); setSaving(true);
    setTimeout(() => { setSaving(false); setSaved(true); }, 300);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const saveNewUser = async () => {
    if (!formUser.name || !formUser.email || !formUser.password) { alert('Name, email and password required'); return; }
    const now = Date.now();
    await store.createUser({
      id: `user-${now}`, name: formUser.name.trim(), email: formUser.email.trim(),
      password: formUser.password, role: formUser.role, status: 'Active' as any,
      permissions: formUser.permissions, createdAt: now, updatedAt: now,
      phone: '', address: '', designation: '',
    } as any);
    setShowCreate(false);
    setFormUser({ name:'', email:'', password:'', role: UserRole.SALESPERSON, permissions: FULL_PERMS(ROLE_PRESETS.salesperson) });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const roleBadge = (role: UserRole) => {
    const m: Record<string,string> = { admin:'bg-rose-100 text-rose-700', manager:'bg-purple-100 text-purple-700', salesperson:'bg-blue-100 text-blue-700', storekeeper:'bg-amber-100 text-amber-700', viewer:'bg-slate-100 text-slate-600' };
    return m[role] || 'bg-slate-100 text-slate-600';
  };

  const countEnabled = (u: User) => Object.values(u.permissions||{}).filter(Boolean).length;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase italic tracking-tighter">Staff Governance</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
            {PERM_GROUPS.flatMap(g=>g.perms).length} permissions across {PERM_GROUPS.length} modules — granular control per staff member
          </p>
        </div>
        <button onClick={()=>setShowCreate(true)}
          className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-slate-800 flex items-center gap-2">
          <i className="fas fa-user-plus"></i> Add Staff Member
        </button>
      </div>

      {(saving || saved) && (
        <div className={`px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 ${saved?'bg-emerald-50 text-emerald-700':'bg-blue-50 text-blue-600'}`}>
          <i className={`fas ${saving?'fa-spinner fa-spin':'fa-check-circle'}`}></i>
          {saving ? 'Saving…' : 'Permissions saved'}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Staff list */}
        <div className="space-y-2">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Staff Members ({users.length})</div>
          {users.map(u => (
            <button key={u.id} onClick={()=>setSelectedUser(u)}
              className={`w-full text-left px-4 py-4 rounded-2xl border transition-all ${selectedUser?.id===u.id?'bg-slate-900 border-slate-900 text-white':'bg-white border-slate-100 hover:border-slate-300'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-sm ${selectedUser?.id===u.id?'bg-white/20 text-white':'bg-slate-100 text-slate-700'}`}>
                  {u.name?.[0]?.toUpperCase()||'?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-black text-sm truncate ${selectedUser?.id===u.id?'text-white':'text-slate-900'}`}>{u.name}</div>
                  <div className={`text-[9px] truncate ${selectedUser?.id===u.id?'text-white/60':'text-slate-400'}`}>{u.email}</div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${roleBadge(u.role)}`}>{u.role}</span>
                <span className={`text-[8px] font-bold ${selectedUser?.id===u.id?'text-white/60':'text-slate-400'}`}>{countEnabled(u)} perms</span>
              </div>
            </button>
          ))}
          {users.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-xs font-bold">No staff members yet. Add one above.</div>
          )}
        </div>

        {/* Permission editor */}
        {selectedUser ? (
          <div className="lg:col-span-2 space-y-4">
            {/* User header */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-black text-xl text-slate-900">{selectedUser.name}</div>
                  <div className="text-[10px] text-slate-400 font-bold">{selectedUser.email}</div>
                  <span className={`mt-1 inline-block text-[8px] font-black px-2 py-0.5 rounded-full ${roleBadge(selectedUser.role)}`}>{selectedUser.role}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="text-[9px] text-slate-400 font-black uppercase mb-1 w-full">Quick Preset</div>
                  {(['admin','manager','salesperson','storekeeper','viewer'] as const).map(r => (
                    <button key={r} onClick={()=>{ const p=FULL_PERMS(ROLE_PRESETS[r]); store.updateUser(selectedUser.id,{permissions:p}); setSelectedUser({...selectedUser,permissions:p}); }}
                      className="px-3 py-1.5 text-[8px] font-black uppercase rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400 transition-all capitalize">
                      {r}
                    </button>
                  ))}
                  <button onClick={()=>{ const p=FULL_PERMS(ALL_ON as any); store.updateUser(selectedUser.id,{permissions:p}); setSelectedUser({...selectedUser,permissions:p}); }}
                    className="px-3 py-1.5 text-[8px] font-black uppercase rounded-xl bg-emerald-50 border border-emerald-200 hover:border-emerald-400 text-emerald-700 transition-all">
                    All On
                  </button>
                  <button onClick={()=>{ const p=FULL_PERMS(ALL_OFF as any); store.updateUser(selectedUser.id,{permissions:p}); setSelectedUser({...selectedUser,permissions:p}); }}
                    className="px-3 py-1.5 text-[8px] font-black uppercase rounded-xl bg-rose-50 border border-rose-200 hover:border-rose-400 text-rose-700 transition-all">
                    All Off
                  </button>
                </div>
              </div>
            </div>

            {/* Permission groups */}
            {PERM_GROUPS.map(group => {
              const enabledInGroup = group.perms.filter(p => selectedUser.permissions?.[p.key]).length;
              return (
                <div key={group.label} className={`border rounded-2xl overflow-hidden ${colorMap[group.color]}`}>
                  <div className="px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <i className={`fas ${group.icon} ${iconColorMap[group.color]} text-sm`}></i>
                      <span className="font-black text-sm text-slate-900">{group.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black text-slate-400">{enabledInGroup}/{group.perms.length}</span>
                      <button onClick={()=>{
                        const allOn = enabledInGroup === group.perms.length;
                        const newP = {...selectedUser.permissions};
                        group.perms.forEach(p => { newP[p.key] = !allOn; });
                        store.updateUser(selectedUser.id,{permissions:newP});
                        setSelectedUser({...selectedUser,permissions:newP});
                      }} className="text-[8px] font-black px-2 py-0.5 rounded-full bg-white border border-slate-200 hover:border-slate-400 text-slate-500">
                        {enabledInGroup === group.perms.length ? 'All Off' : 'All On'}
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-white/60 bg-white/50">
                    {group.perms.map(p => {
                      const enabled = !!selectedUser.permissions?.[p.key];
                      return (
                        <div key={p.key} className="flex items-center gap-4 px-5 py-3 hover:bg-white/80 transition-all cursor-pointer"
                          onClick={()=>togglePerm(selectedUser, p.key)}>
                          <div className="flex-1">
                            <div className={`font-black text-sm ${enabled?'text-slate-900':'text-slate-400'}`}>{p.label}</div>
                            <div className="text-[9px] text-slate-400 font-bold mt-0.5">{p.desc}</div>
                          </div>
                          <div className={`w-12 h-6 rounded-full flex items-center transition-all duration-200 shrink-0 ${enabled?'bg-emerald-500 justify-end pr-1':'bg-slate-200 justify-start pl-1'}`}>
                            <div className="w-4 h-4 bg-white rounded-full shadow"></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="lg:col-span-2 flex items-center justify-center text-slate-400 text-sm font-bold border-2 border-dashed border-slate-200 rounded-2xl">
            <div className="text-center py-20">
              <i className="fas fa-user-shield text-4xl mb-3 opacity-30 block"></i>
              Select a staff member to manage permissions
            </div>
          </div>
        )}
      </div>

      {/* Create user modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[600] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg p-8 space-y-5">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-xl">Add Staff Member</h3>
              <button onClick={()=>setShowCreate(false)} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
                <i className="fas fa-times text-xs"></i>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className={lbl}>Full Name</label><input className={inp} value={formUser.name} onChange={e=>setFormUser(p=>({...p,name:e.target.value}))} placeholder="e.g. Rahul Kumar"/></div>
              <div className="col-span-2"><label className={lbl}>Email</label><input type="email" className={inp} value={formUser.email} onChange={e=>setFormUser(p=>({...p,email:e.target.value}))} placeholder="rahul@yourshop.com"/></div>
              <div><label className={lbl}>Password</label><input type="password" className={inp} value={formUser.password} onChange={e=>setFormUser(p=>({...p,password:e.target.value}))} placeholder="Min 6 chars"/></div>
              <div>
                <label className={lbl}>Role (Preset)</label>
                <select className={inp} value={formUser.role} onChange={e=>{
                  const r = e.target.value as UserRole;
                  setFormUser(p=>({...p, role:r, permissions: FULL_PERMS(ROLE_PRESETS[r]||{})}));
                }}>
                  <option value={UserRole.ADMIN}>Admin (Full Access)</option>
                  <option value={UserRole.MANAGER}>Manager</option>
                  <option value={UserRole.SALESPERSON}>Salesperson</option>
                  <option value={UserRole.STOREKEEPER}>Storekeeper</option>
                  <option value={UserRole.VIEWER}>Viewer</option>
                </select>
              </div>
            </div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
              Permissions will be pre-set from the role. You can fine-tune them after creating.
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setShowCreate(false)} className="flex-1 py-3 bg-slate-100 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200">Cancel</button>
              <button onClick={saveNewUser} className="flex-1 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-slate-800">
                Create Staff Member
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
