/**
 * PlansFeatures.tsx
 * ─────────────────────────────────────────────────────────────────────────
 * Admin page to enable/disable any ERP module per tenant.
 * Changes take effect immediately — disabled modules vanish from the sidebar
 * and are inaccessible until re-enabled. Settings are saved to the DB via
 * store.updateSettings (same as all other settings).
 *
 * Organised into feature groups matching real business workflows.
 */
import React, { useState } from 'react';
import { store } from '../store';

interface Feature {
  id: string;          // sidebar module id
  label: string;
  description: string;
  icon: string;
  group: string;
  critical?: boolean;  // cannot be disabled
  requiresAdmin?: boolean;
}

const ALL_FEATURES: Feature[] = [
  // ── Core ─────────────────────────────────────────────────────────────────
  { id: 'dashboard',    label: 'Dashboard',          description: 'Business overview — KPIs, P&L snapshot, top products, stock health', icon: 'fa-tachometer-alt', group: 'Core', critical: true },
  { id: 'profile',      label: 'My Account',         description: 'User profile, password change, personal settings',                    icon: 'fa-user-circle',    group: 'Core', critical: true },
  { id: 'system',       label: 'System Architecture', description: 'Admin settings — categories, sizes, brands, loading charges, user creation source', icon: 'fa-cog', group: 'Core', requiresAdmin: true },

  // ── Inventory ─────────────────────────────────────────────────────────────
  { id: 'inventory',        label: 'Inventory Master',       description: 'Product catalogue, stock levels, Quick Add & Inward, CSV import/export, stock adjustments', icon: 'fa-boxes',          group: 'Inventory' },
  { id: 'vendor_tracking',  label: 'Vendor Supply Chain',    description: 'Purchase orders, dual invoices, vendor analytics, slab inward, damage tracking',             icon: 'fa-truck-loading',  group: 'Inventory' },

  // ── Sales ─────────────────────────────────────────────────────────────────
  { id: 'sales',       label: 'Billing & POS',    description: 'Create invoices, collect payments, manage credit balances, referral commission at billing', icon: 'fa-file-invoice-dollar', group: 'Sales' },
  { id: 'quotations',  label: 'Quotations',       description: 'Generate quotes, slab selection for Kadapa/Granite/Marble, convert to invoice',            icon: 'fa-file-alt',           group: 'Sales' },
  { id: 'returns',     label: 'Returns / Refunds', description: 'Process product returns, compute correct refund using realised price',                   icon: 'fa-undo',               group: 'Sales' },
  { id: 'offers',      label: 'Promotions',        description: 'Time-limited discount offers, category-based promotions, offer analytics',                icon: 'fa-percentage',         group: 'Sales' },
  { id: 'credits',     label: 'Credit Ledger',     description: 'Track outstanding balances per customer, credit due dates, recovery management',          icon: 'fa-user-clock',         group: 'Sales' },
  { id: 'expenses',    label: 'Expenses',          description: 'Record and categorise business expenses, included in P&L and collection reports',         icon: 'fa-receipt',            group: 'Sales' },

  // ── CRM & Leads ───────────────────────────────────────────────────────────
  { id: 'connect',       label: 'CRM Connect',           description: 'Customer profiles, purchase history, communication log, follow-ups', icon: 'fa-user-friends', group: 'CRM & Leads' },
  { id: 'gallery_leads', label: 'Gallery Orders / Leads', description: 'Showroom enquiries, digital catalogue, lead pipeline',              icon: 'fa-images',       group: 'CRM & Leads' },

  // ── Analytics ─────────────────────────────────────────────────────────────
  { id: 'reports_sales', label: 'P&L Reports', description: 'Invoice-wise P&L, item-wise margin, vendor analytics, collections, damage reports, quotation tracking', icon: 'fa-chart-line', group: 'Analytics' },

  // ── HR & Commissions ─────────────────────────────────────────────────────
  { id: 'commission_master',  label: 'Incentives',           description: 'Staff commission rules, salesperson targets, payout management',                                     icon: 'fa-hand-holding-usd', group: 'HR & Commissions', requiresAdmin: true },
  { id: 'referral_commission', label: 'Referral Commission', description: 'Track mestri / engineer / contractor referral agents, invoice-wise commission, WhatsApp broadcast', icon: 'fa-user-tag',         group: 'HR & Commissions', requiresAdmin: true },

  // ── Administration ────────────────────────────────────────────────────────
  { id: 'users', label: 'Staff Governance', description: 'Create staff accounts, role-based permissions, login management', icon: 'fa-user-shield', group: 'Administration', requiresAdmin: true },
];

const GROUPS = ['Core', 'Inventory', 'Sales', 'CRM & Leads', 'Analytics', 'HR & Commissions', 'Administration'];

const groupMeta: Record<string, { icon: string; color: string; desc: string }> = {
  'Core':             { icon: 'fa-home',          color: 'text-slate-600',  desc: 'Essential modules always available' },
  'Inventory':        { icon: 'fa-boxes',          color: 'text-blue-600',   desc: 'Stock management and vendor purchasing' },
  'Sales':            { icon: 'fa-cash-register',  color: 'text-emerald-600',desc: 'Billing, collections and promotions' },
  'CRM & Leads':      { icon: 'fa-user-friends',   color: 'text-purple-600', desc: 'Customer relationships and showroom leads' },
  'Analytics':        { icon: 'fa-chart-line',     color: 'text-amber-600',  desc: 'Business intelligence and reporting' },
  'HR & Commissions': { icon: 'fa-user-tie',       color: 'text-rose-600',   desc: 'Staff incentives and referral tracking' },
  'Administration':   { icon: 'fa-shield-alt',     color: 'text-indigo-600', desc: 'User management (admin only)' },
};

const PlansFeatures: React.FC = () => {
  const [, setTick] = useState(0);
  const [saved, setSaved] = useState(false);

  const isEnabled = (id: string) => store.isModuleEnabled(id);

  const toggle = (feature: Feature) => {
    if (feature.critical) return;
    store.setModuleEnabled(feature.id, !isEnabled(feature.id));
    setTick(n => n + 1);
    setSaved(false);
    // Give visual feedback
    setTimeout(() => setSaved(true), 200);
    setTimeout(() => setSaved(false), 2000);
  };

  const enableAll = () => {
    ALL_FEATURES.forEach(f => { if (!f.critical) store.setModuleEnabled(f.id, true); });
    setTick(n => n + 1);
  };

  const enabledCount  = ALL_FEATURES.filter(f => isEnabled(f.id)).length;
  const disabledCount = ALL_FEATURES.filter(f => !f.critical && !isEnabled(f.id)).length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase italic tracking-tighter">Plans & Features</h1>
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mt-1">
            Enable or disable any module — changes apply immediately without restart
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-[10px] font-black text-emerald-600 flex items-center gap-1">
              <i className="fas fa-check-circle"></i> Saved
            </span>
          )}
          {disabledCount > 0 && (
            <button onClick={enableAll}
              className="px-5 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-100 transition-all">
              Enable All
            </button>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-100 rounded-2xl px-5 py-4">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Modules</div>
          <div className="text-2xl font-black text-slate-900">{ALL_FEATURES.length}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-4">
          <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">Active</div>
          <div className="text-2xl font-black text-emerald-700">{enabledCount}</div>
        </div>
        <div className={`${disabledCount > 0 ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'} border rounded-2xl px-5 py-4`}>
          <div className={`text-[9px] font-black uppercase tracking-widest mb-1 ${disabledCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>Disabled</div>
          <div className={`text-2xl font-black ${disabledCount > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{disabledCount}</div>
        </div>
      </div>

      {/* Module groups */}
      {GROUPS.map(group => {
        const features = ALL_FEATURES.filter(f => f.group === group);
        const meta = groupMeta[group];
        const groupEnabled = features.filter(f => isEnabled(f.id)).length;

        return (
          <div key={group} className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
            {/* Group header */}
            <div className="px-7 py-5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <i className={`fas ${meta.icon} ${meta.color} text-lg`}></i>
                <div>
                  <div className="font-black text-slate-900 text-sm uppercase tracking-tight">{group}</div>
                  <div className="text-[10px] text-slate-400 font-bold mt-0.5">{meta.desc}</div>
                </div>
              </div>
              <div className="text-[10px] font-black text-slate-400 uppercase">
                {groupEnabled}/{features.length} active
              </div>
            </div>

            {/* Feature rows */}
            <div className="divide-y divide-slate-50">
              {features.map(f => {
                const enabled = isEnabled(f.id);
                return (
                  <div key={f.id}
                    className={`flex items-center gap-4 px-7 py-4 transition-all ${enabled ? 'bg-white' : 'bg-slate-50/70'} ${!f.critical ? 'hover:bg-slate-50 cursor-pointer' : ''}`}
                    onClick={() => toggle(f)}>

                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-all ${enabled ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <i className={`fas ${f.icon} text-sm`}></i>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-black text-sm ${enabled ? 'text-slate-900' : 'text-slate-400'}`}>{f.label}</span>
                        {f.critical && (
                          <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Always On</span>
                        )}
                        {f.requiresAdmin && (
                          <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-500">Admin Only</span>
                        )}
                        {!enabled && !f.critical && (
                          <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">Disabled</span>
                        )}
                      </div>
                      <div className={`text-[10px] font-bold mt-0.5 leading-relaxed ${enabled ? 'text-slate-500' : 'text-slate-400'}`}>{f.description}</div>
                    </div>

                    {/* Toggle */}
                    <div className="shrink-0">
                      {f.critical ? (
                        <div className="w-12 h-6 bg-emerald-500 rounded-full flex items-center justify-end pr-1 opacity-50">
                          <div className="w-4 h-4 bg-white rounded-full shadow"></div>
                        </div>
                      ) : (
                        <div
                          className={`w-12 h-6 rounded-full flex items-center transition-all duration-200 ${enabled ? 'bg-emerald-500 justify-end pr-1' : 'bg-slate-200 justify-start pl-1'}`}>
                          <div className="w-4 h-4 bg-white rounded-full shadow"></div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Info footer */}
      <div className="px-6 py-4 bg-blue-50 border border-blue-100 rounded-2xl text-blue-700 text-[10px] font-bold flex items-start gap-3">
        <i className="fas fa-info-circle mt-0.5 shrink-0"></i>
        <div>
          <span className="font-black">Tip:</span> Disabled modules are instantly hidden from the sidebar for all users on this tenant. The module's data is preserved — re-enabling it restores full access. Core modules marked "Always On" cannot be disabled.
        </div>
      </div>
    </div>
  );
};

export default PlansFeatures;
