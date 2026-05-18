import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { store } from '../store';
import { Offer, UserRole } from '../types';

// ── helpers ──────────────────────────────────────────────────────────────────
const INR  = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const today = () => new Date().toISOString().split('T')[0];
const r2    = (n: number) => Math.round(n * 100) / 100;

type Tab = 'dashboard' | 'offers' | 'campaigns' | 'contractor' | 'margin' | 'approvals' | 'promo';

const STATUS_CLS: Record<string, string> = {
  Draft:          'bg-slate-100 text-slate-500',
  'Under Review': 'bg-amber-100 text-amber-700',
  Published:      'bg-emerald-100 text-emerald-700',
  Paused:         'bg-blue-100 text-blue-600',
  Expired:        'bg-rose-100 text-rose-600',
};
const RISK_CLS: Record<string, string> = {
  Green:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  Yellow: 'bg-amber-100 text-amber-700 border-amber-200',
  Red:    'bg-rose-100 text-rose-700 border-rose-200',
};

const OFFER_KINDS = [
  { id: 'Percentage',       label: '% Discount',          icon: 'fa-percent',      desc: 'Percentage off selling price' },
  { id: 'Fixed',            label: 'Flat ₹ Off',           icon: 'fa-tag',          desc: 'Fixed rupee discount per unit' },
  { id: 'BOGO',             label: 'Buy X Get Y',          icon: 'fa-gift',         desc: 'Buy N items, get M free' },
  { id: 'InvoiceValue',     label: 'Invoice Value Slab',  icon: 'fa-receipt',      desc: 'Reward based on total bill value' },
  { id: 'CustomerSpecific', label: 'Customer Specific',   icon: 'fa-user-tag',     desc: 'Special pricing for selected customers' },
  { id: 'PromoCode',        label: 'Promo Code',           icon: 'fa-ticket-alt',   desc: 'Code-based discount with usage limit' },
  { id: 'Gift',             label: 'Gift Offer',           icon: 'fa-gift',         desc: 'Gift item on reaching purchase value' },
] as const;

const CUSTOMER_SEGMENTS = ['All','Retail','Builder','Architect','Contractor','Dealer','VIP'] as const;
const INCENTIVE_TYPES = ['Percentage','Fixed','PerSqft','PerBox','Gift','Target'] as const;

const Offers: React.FC = () => {
  const [ts, setTs] = useState(store.lastUpdated);
  useEffect(() => store.subscribe(() => setTs(store.lastUpdated)), []);

  const isAdmin   = store.currentUser?.role === UserRole.ADMIN;
  const isManager = store.currentUser?.role === UserRole.MANAGER || isAdmin;
  const categories = store.settings.categories || [];
  const thresholds = (store.settings as any).marginThresholds || [];

  const [activeTab, setActiveTab]   = useState<Tab>('dashboard');
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [editOffer, setEditOffer]   = useState<Offer | null>(null);
  const [filterStatus, setFilterStatus] = useState('All');
  const [searchQ, setSearchQ]       = useState('');

  // ── Offer form ──────────────────────────────────────────────────────────────
  const emptyForm = () => ({
    title: '', description: '', kind: 'Percentage' as any, type: 'Percentage' as any,
    value: 0, targetProductIds: [] as string[], targetCategories: [] as string[],
    targetCustomerSegments: ['All'] as string[], targetCustomerIds: [] as string[],
    minPurchaseValue: 0, minQtyBoxes: 0,
    startDate: today(), expiryDate: '',
    promoCode: '', promoCodeUsageLimit: 0,
    bogo: { buyQty: 1, getQty: 1, getFreeProductId: '', discountOnSecond: 0 },
    invoiceSlabs: [] as any[],
    minMarginPct: 0, requiresApproval: false,
    campaignBudget: 0, priority: 1, stackable: false,
  });
  const [form, setForm]             = useState<any>(emptyForm());
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  // ── Contractor form ──────────────────────────────────────────────────────────
  const [showCI, setShowCI]         = useState(false);
  const [ciForm, setCiForm]         = useState({ contractorName: '', contractorMobile: '', type: 'PerSqft', value: 0, targetCategory: '', startDate: today(), expiryDate: '', notes: '', referralCode: '', totalEarned: 0, totalPaid: 0, pending: 0, status: 'Active', linkedInvoiceIds: [] });

  // ── Gift management ──────────────────────────────────────────────────────────
  const [activeGiftTab, setActiveGiftTab] = useState<'stock'|'issue'>('stock');
  const [showGiftForm, setShowGiftForm]   = useState(false);
  const [giftForm, setGiftForm]           = useState({ name: '', qty: 0, unitCost: 0, notes: '' });
  const [showIssueGift, setShowIssueGift] = useState(false);
  const [giftIssueForm, setGiftIssueForm] = useState({ giftId: '', qty: 1, customerName: '', invoiceNo: '', notes: '', date: today() });

  // ── Rejection comment ─────────────────────────────────────────────────────────
  const [rejectComment, setRejectComment] = useState('');
  const [rejectTarget, setRejectTarget]   = useState<string | null>(null);

  // ── Contractor settlement partial ────────────────────────────────────────────
  const [settleCI, setSettleCI]           = useState<any | null>(null);
  const [settleCIAmt, setSettleCIAmt]     = useState(0);

  // ── Tab extension ─────────────────────────────────────────────────────────────
  const [showThresholdForm, setShowThresholdForm] = useState(false);
  const [threshForm, setThreshForm]       = useState({ category: '', minMarginPct: 10, warningMarginPct: 15, approvalRequired: true });

  // ── Margin simulator ─────────────────────────────────────────────────────────
  const [simCat, setSimCat]         = useState(categories[0] || '');
  const [simSell, setSimSell]       = useState(0);
  const [simCost, setSimCost]       = useState(0);
  const [simDisc, setSimDisc]       = useState(0);

  // ── Margin simulator result ───────────────────────────────────────────────────
  const simResult = useMemo(() => {
    if (!simSell || !simCost) return null;
    return store.validateMargin(simCat, simSell, simCost, simDisc);
  }, [simCat, simSell, simCost, simDisc, ts]);

  // ── Profitability impact of offer form ────────────────────────────────────────
  const formImpact = useMemo(() => {
    const targets = store.products.filter(p =>
      form.targetProductIds.includes(p.id) || form.targetCategories.includes(p.category)
    );
    if (!targets.length) return null;
    const avg = (fn: (p: any) => number) => targets.reduce((s, p) => s + fn(p), 0) / targets.length;
    const avgCost = avg(p => p.totalCostPerUnit || p.purchasePrice || 0);
    const avgSell = avg(p => p.sellingPrice || 0);
    const disc = form.kind === 'Percentage' ? (avgSell * form.value) / 100 : form.kind === 'Fixed' ? form.value : 0;
    const net  = avgSell - disc;
    const profit = net - avgCost;
    const marginPct = net > 0 ? (profit / net) * 100 : -999;
    const threshold = thresholds.find((t: any) => form.targetCategories.includes(t.category)) || { minMarginPct: 0, warningMarginPct: 10 };
    const riskLevel = profit < 0 ? 'Red' : marginPct < threshold.warningMarginPct ? 'Yellow' : 'Green';
    return { avgCost: r2(avgCost), avgSell: r2(avgSell), disc: r2(disc), net: r2(net), profit: r2(profit), marginPct: r2(marginPct), riskLevel };
  }, [form, store.products, thresholds, ts]);

  // ── Filtered offers ──────────────────────────────────────────────────────────
  const filteredOffers = useMemo(() => {
    let list = store.offers;
    if (filterStatus !== 'All') list = list.filter(o => o.status === filterStatus);
    if (searchQ) list = list.filter(o => o.title.toLowerCase().includes(searchQ.toLowerCase()));
    return list.sort((a, b) => (b.priority || 1) - (a.priority || 1));
  }, [store.offers, filterStatus, searchQ, ts]);

  // ── Aggregated stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now = today();
    return {
      active:   store.offers.filter(o => o.status === 'Published' && (!o.expiryDate || o.expiryDate >= now)).length,
      expiring: store.offers.filter(o => o.status === 'Published' && o.expiryDate && o.expiryDate >= now && daysDiff(o.expiryDate) <= 7).length,
      pending:  (store.approvalRequests || []).filter((r: any) => r.status === 'Pending').length,
      totalDisc: store.offers.reduce((s, o) => s + (o.totalDiscountGiven || 0), 0),
      contractors: (store.contractorIncentives || []).filter((c: any) => c.status === 'Active').length,
      pendingIncentive: (store.contractorIncentives || []).reduce((s: number, c: any) => s + (c.pending || 0), 0),
    };
  }, [store.offers, store.approvalRequests, store.contractorIncentives, ts]);

  const daysDiff = (d: string) => Math.floor((new Date(d).getTime() - Date.now()) / 86400000);

  // ── Save offer ───────────────────────────────────────────────────────────────
  const saveOffer = () => {
    if (!form.title || (!form.value && form.kind !== 'BOGO' && form.kind !== 'InvoiceValue')) return;
    const offer: any = {
      ...form,
      type: ['Percentage','Fixed'].includes(form.kind) ? form.kind : 'Percentage',
    };
    if (editOffer) {
      store.updateOffer(editOffer.id, offer);
    } else {
      store.addOffer(offer);
    }
    setShowOfferForm(false);
    setEditOffer(null);
    setForm(emptyForm());
  };

  const inp  = "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400 focus:bg-white transition-all";
  const lbl  = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";
  const TABS: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'dashboard',  label: 'Dashboard',     icon: 'fa-chart-pie' },
    { id: 'offers',     label: 'Offers',         icon: 'fa-tags',       badge: stats.active },
    { id: 'campaigns',  label: 'Campaigns',      icon: 'fa-bullhorn' },
    { id: 'contractor', label: 'Contractors',    icon: 'fa-hard-hat',   badge: stats.contractors },
    { id: 'margin',     label: 'Margin Guard',   icon: 'fa-shield-alt' },
    { id: 'approvals',  label: 'Approvals',      icon: 'fa-check-square', badge: stats.pending || undefined },
    { id: 'promo',      label: 'Promo Codes',    icon: 'fa-ticket-alt' },
    { id: 'gifts' as any,  label: 'Gift Stock',     icon: 'fa-gift' },
  ];

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-20">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tighter uppercase italic">
            Promotion & Margin Engine
          </h1>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
            Offers · BOGO · Promo Codes · Margin Guard · Contractor Incentives · Approvals
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {stats.pending > 0 && (
            <button onClick={() => setActiveTab('approvals')}
              className="flex items-center gap-2 px-4 py-2.5 bg-rose-100 text-rose-700 rounded-2xl font-black text-[9px] uppercase hover:bg-rose-200 transition-all animate-pulse">
              <i className="fas fa-bell text-xs"></i> {stats.pending} Pending Approval{stats.pending > 1 ? 's' : ''}
            </button>
          )}
          {isManager && (
            <button onClick={() => { setEditOffer(null); setForm(emptyForm()); setShowOfferForm(true); }}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-amber-600 transition-all active:scale-95">
              <i className="fas fa-plus text-xs"></i> New Offer
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full font-black text-[9px] uppercase tracking-widest whitespace-nowrap transition-all flex-shrink-0
              ${activeTab === t.id ? 'bg-slate-900 text-white shadow' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <i className={`fas ${t.icon} text-[9px]`}></i> {t.label}
            {t.badge ? (
              <span className="absolute -top-1.5 -right-1 bg-amber-500 text-white w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ═══════════ DASHBOARD ═══════════ */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Active Offers',    val: stats.active,                           cls: 'bg-emerald-50 text-emerald-700' },
              { label: 'Expiring ≤7d',     val: stats.expiring,                         cls: stats.expiring > 0 ? 'bg-amber-50 text-amber-700' : 'bg-white text-slate-700' },
              { label: 'Pending Approval', val: stats.pending,                          cls: stats.pending > 0 ? 'bg-rose-50 text-rose-700' : 'bg-white text-slate-700' },
              { label: 'Total Disc Given', val: INR(stats.totalDisc),                   cls: 'bg-white text-slate-700' },
              { label: 'Active Contractors', val: stats.contractors,                    cls: 'bg-indigo-50 text-indigo-700' },
              { label: 'Pending Incentives', val: INR(stats.pendingIncentive),          cls: 'bg-amber-50 text-amber-700' },
            ].map(({ label, val, cls }) => (
              <div key={label} className={`${cls} border border-slate-100 rounded-[20px] p-4 shadow-sm`}>
                <div className="text-[8px] font-black uppercase tracking-widest opacity-60 mb-1">{label}</div>
                <div className="text-xl font-black">{val}</div>
              </div>
            ))}
          </div>

          {/* ROI + Discount leakage row */}
          {(() => {
            const totalDisc = store.offers.reduce((s, o) => s + (o.totalDiscountGiven || 0), 0);
            const totalRev  = store.offers.reduce((s, o) => s + (o.totalRevenueGenerated || 0), 0);
            const roi = totalDisc > 0 ? ((totalRev - totalDisc) / totalDisc) * 100 : 0;
            const lowMgInvoices = store.sales.filter(s => s.status !== 'Deleted').filter(s => {
              const prof = s.items.reduce((a, it) => {
                const p = store.products.find(x => x.id === it.productId);
                return a + (it.amount - (p?.totalCostPerUnit || 0) * (it.qtyBoxes + it.qtyLoose / (p?.tilesPerBox || 1)));
              }, 0);
              return (prof / (s.totalAmount || 1)) * 100 < 10;
            }).length;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-[20px] p-5 space-y-1">
                  <div className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Promotion ROI</div>
                  <div className={`text-2xl font-black ${roi >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{roi.toFixed(1)}%</div>
                  <div className="text-[9px] font-bold text-emerald-500">{INR(totalRev)} rev / {INR(totalDisc)} disc</div>
                </div>
                <div className={`border rounded-[20px] p-5 space-y-1 ${totalDisc > 50000 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-100'}`}>
                  <div className="text-[8px] font-black text-rose-500 uppercase tracking-widest">Discount Leakage</div>
                  <div className={`text-2xl font-black ${totalDisc > 50000 ? 'text-rose-700' : 'text-slate-700'}`}>{INR(totalDisc)}</div>
                  <div className="text-[9px] font-bold text-slate-400">Total discount given across all offers</div>
                </div>
                <div className={`border rounded-[20px] p-5 space-y-1 ${lowMgInvoices > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
                  <div className="text-[8px] font-black text-amber-600 uppercase tracking-widest">Low Margin Invoices</div>
                  <div className={`text-2xl font-black ${lowMgInvoices > 0 ? 'text-amber-700' : 'text-slate-700'}`}>{lowMgInvoices}</div>
                  <div className="text-[9px] font-bold text-slate-400">Invoices below 10% margin this period</div>
                </div>
              </div>
            );
          })()}

          {/* Active offers quick view */}
          <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Live Offers</div>
            {store.offers.filter(o => o.status === 'Published').length === 0 ? (
              <div className="text-slate-300 font-black text-sm text-center py-8 uppercase">No published offers</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {store.offers.filter(o => o.status === 'Published').slice(0, 6).map(o => (
                  <div key={o.id} className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="font-black text-slate-800 text-sm truncate">{o.title}</div>
                      <span className="text-[8px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full ml-2 shrink-0">Live</span>
                    </div>
                    <div className="text-[9px] font-bold text-slate-400">
                      {(o as any).kind === 'BOGO' ? `Buy ${(o as any).bogo?.buyQty} Get ${(o as any).bogo?.getQty} Free`
                        : (o as any).kind === 'Percentage' ? `${o.value}% Off`
                        : `₹${o.value} Off`}
                    </div>
                    <div className="text-[8px] text-slate-400 font-bold">
                      {o.targetCategories.join(', ') || 'All Products'}
                      {o.expiryDate && ` · Exp: ${o.expiryDate}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Margin risk alerts */}
          {thresholds.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Margin Thresholds</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {thresholds.map((t: any) => (
                  <div key={t.category} className="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-center">
                    <div className="text-[8px] font-black text-slate-400 uppercase mb-1">{t.category}</div>
                    <div className="text-lg font-black text-slate-800">{t.minMarginPct}%</div>
                    <div className="text-[8px] text-amber-500 font-bold">min · {t.warningMarginPct}% warn</div>
                    {t.approvalRequired && <div className="text-[7px] font-black text-rose-500 mt-1">Approval req'd</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ OFFERS LIST ═══════════ */}
      {activeTab === 'offers' && (
        <div className="space-y-5">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-3 items-center bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
              {['All','Draft','Published','Paused','Expired'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${filterStatus === s ? 'bg-white text-slate-900 shadow' : 'text-slate-400 hover:text-slate-600'}`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 min-w-[160px]">
              <i className="fas fa-search text-slate-300 text-xs"></i>
              <input className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-600" placeholder="Search offers…" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
            </div>
          </div>

          {filteredOffers.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center space-y-3">
              <i className="fas fa-tags text-4xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase">No offers found</div>
              {isManager && <button onClick={() => { setShowOfferForm(true); }} className="text-amber-600 font-black text-sm hover:underline">+ Create your first offer</button>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredOffers.map(o => {
                const kindInfo = OFFER_KINDS.find(k => k.id === (o as any).kind) || OFFER_KINDS[0];
                const now = today();
                const isExpired = o.expiryDate && o.expiryDate < now;
                const daysLeft = o.expiryDate ? daysDiff(o.expiryDate) : null;
                return (
                  <div key={o.id} className="bg-white border border-slate-100 rounded-[24px] overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all group">
                    {/* Color strip by kind */}
                    <div className={`h-1.5 ${(o as any).kind === 'BOGO' ? 'bg-purple-500' : (o as any).kind === 'PromoCode' ? 'bg-blue-500' : (o as any).kind === 'InvoiceValue' ? 'bg-orange-500' : 'bg-amber-500'}`}/>
                    <div className="p-5 space-y-4">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                            <i className={`fas ${kindInfo.icon} text-xs`}></i>
                          </div>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS_CLS[o.status] || 'bg-slate-100 text-slate-500'}`}>{o.status}</span>
                        </div>
                        {daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && (
                          <span className="text-[8px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">⏰ {daysLeft}d left</span>
                        )}
                        {isExpired && <span className="text-[8px] font-black bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full">Expired</span>}
                      </div>

                      <div>
                        <h3 className="font-black text-slate-900 text-base leading-tight">{o.title}</h3>
                        <p className="text-[9px] text-slate-400 font-medium mt-0.5 line-clamp-2">{o.description}</p>
                      </div>

                      {/* Value badge */}
                      <div className="bg-slate-50 rounded-2xl px-4 py-3 flex justify-between items-center">
                        <div>
                          <div className="text-[8px] font-black text-slate-400 uppercase">{kindInfo.label}</div>
                          <div className="font-black text-slate-800 text-sm">
                            {(o as any).kind === 'BOGO' ? `Buy ${(o as any).bogo?.buyQty} → ${(o as any).bogo?.getQty} Free`
                              : (o as any).kind === 'InvoiceValue' ? `${(o as any).invoiceSlabs?.length || 0} slabs`
                              : (o as any).kind === 'PromoCode' ? `Code: ${(o as any).promoCode || 'N/A'}`
                              : o.type === 'Percentage' ? `${o.value}%` : INR(o.value)}
                          </div>
                        </div>
                        <div className="text-right text-[8px] text-slate-400">
                          {o.startDate} → {o.expiryDate || '∞'}
                        </div>
                      </div>

                      {/* Targets */}
                      <div className="flex flex-wrap gap-1">
                        {o.targetCategories.slice(0, 3).map(c => (
                          <span key={c} className="text-[7px] font-black bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full uppercase">{c}</span>
                        ))}
                        {o.targetProductIds.length > 0 && (
                          <span className="text-[7px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{o.targetProductIds.length} products</span>
                        )}
                        {(o as any).promoCode && (
                          <span className="text-[7px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-mono">{(o as any).promoCode}</span>
                        )}
                      </div>

                      {/* Usage stats */}
                      {(o.usageCount || o.totalDiscountGiven) ? (
                        <div className="text-[8px] text-slate-400 font-bold flex gap-3">
                          {o.usageCount ? <span>{o.usageCount} uses</span> : null}
                          {o.totalDiscountGiven ? <span>Disc given: {INR(o.totalDiscountGiven)}</span> : null}
                        </div>
                      ) : null}
                    </div>

                    {/* Actions */}
                    {isManager && (
                      <div className="px-5 pb-4 flex gap-2 border-t border-slate-50 pt-3">
                        {o.status === 'Draft' && (
                          <button onClick={() => store.publishOffer(o.id)}
                            className="flex-1 py-2 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all">
                            Publish
                          </button>
                        )}
                        {o.status === 'Published' && (
                          <button onClick={() => store.pauseOffer(o.id)}
                            className="flex-1 py-2 bg-amber-100 text-amber-700 rounded-xl font-black text-[9px] uppercase hover:bg-amber-200 transition-all">
                            Pause
                          </button>
                        )}
                        {o.status === 'Paused' && (
                          <button onClick={() => store.publishOffer(o.id)}
                            className="flex-1 py-2 bg-emerald-100 text-emerald-700 rounded-xl font-black text-[9px] uppercase hover:bg-emerald-200 transition-all">
                            Resume
                          </button>
                        )}
                        <button onClick={() => { setEditOffer(o); setForm({ ...o, kind: (o as any).kind || o.type, bogo: (o as any).bogo || emptyForm().bogo, invoiceSlabs: (o as any).invoiceSlabs || [] }); setShowOfferForm(true); }}
                          className="px-3 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
                          Edit
                        </button>
                        {isAdmin && (
                          <button onClick={() => store.deleteOffer(o.id)}
                            className="w-9 h-9 rounded-xl bg-rose-50 text-rose-400 hover:bg-rose-100 transition-all flex items-center justify-center">
                            <i className="fas fa-trash-alt text-[10px]"></i>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ CAMPAIGNS ═══════════ */}
      {activeTab === 'campaigns' && (
        <div className="space-y-5">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Seasonal & promotional campaigns</div>
          {/* Campaign cards — reuse offers with campaign budget */}
          {store.offers.filter(o => (o as any).campaignBudget > 0).length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center space-y-3">
              <i className="fas fa-bullhorn text-4xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase">No campaigns created</div>
              <p className="text-[10px] text-slate-300 max-w-xs mx-auto">Create an offer with a Campaign Budget set to track it as a campaign</p>
              {isManager && <button onClick={() => setShowOfferForm(true)} className="text-amber-600 font-black text-sm hover:underline">+ New Campaign</button>}
            </div>
          ) : store.offers.filter(o => (o as any).campaignBudget > 0).map(o => {
            const pct = o.campaignBudget ? ((o.campaignSpent || 0) / o.campaignBudget) * 100 : 0;
            return (
              <div key={o.id} className="bg-white border border-slate-100 rounded-[24px] p-6 shadow-sm space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-black text-slate-900 text-lg">{o.title}</h3>
                    <p className="text-[10px] text-slate-400 font-bold">{o.startDate} → {o.expiryDate || 'Open'}</p>
                  </div>
                  <span className={`text-[8px] font-black px-3 py-1 rounded-full ${STATUS_CLS[o.status] || ''}`}>{o.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="text-[8px] font-black text-slate-400 uppercase">Budget</div>
                    <div className="font-black text-slate-800">{INR(o.campaignBudget || 0)}</div>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3 text-center">
                    <div className="text-[8px] font-black text-amber-500 uppercase">Spent</div>
                    <div className="font-black text-amber-700">{INR(o.campaignSpent || 0)}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-3 text-center">
                    <div className="text-[8px] font-black text-emerald-500 uppercase">Revenue</div>
                    <div className="font-black text-emerald-700">{INR(o.totalRevenueGenerated || 0)}</div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[8px] font-black text-slate-400 mb-1">
                    <span>Budget Used</span><span>{pct.toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(pct, 100)}%` }}/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════ CONTRACTOR INCENTIVES ═══════════ */}
      {activeTab === 'contractor' && (
        <div className="space-y-5">
          <div className="flex justify-between items-center">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
              Mestri · Contractor · Architect Incentive Programs
            </div>
            {isManager && (
              <button onClick={() => setShowCI(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-indigo-700 transition-all">
                <i className="fas fa-plus text-xs"></i> Add Incentive
              </button>
            )}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Earned', val: INR((store.contractorIncentives || []).reduce((s: number, c: any) => s + c.totalEarned, 0)), cls: 'bg-indigo-50 text-indigo-700' },
              { label: 'Total Paid',   val: INR((store.contractorIncentives || []).reduce((s: number, c: any) => s + c.totalPaid, 0)),   cls: 'bg-emerald-50 text-emerald-700' },
              { label: 'Pending',      val: INR(stats.pendingIncentive),                                                                   cls: 'bg-amber-50 text-amber-700' },
            ].map(({ label, val, cls }) => (
              <div key={label} className={`${cls} border border-slate-100 rounded-[20px] p-4`}>
                <div className="text-[8px] font-black opacity-60 uppercase mb-1">{label}</div>
                <div className="text-xl font-black">{val}</div>
              </div>
            ))}
          </div>

          {(store.contractorIncentives || []).length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center space-y-3">
              <i className="fas fa-hard-hat text-4xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase">No contractor incentives</div>
            </div>
          ) : (
            <div className="space-y-3">
              {[...(store.contractorIncentives || [])].sort((a: any, b: any) => b.pending - a.pending).map((c: any) => (
                <div key={c.id} className="bg-white border border-slate-100 rounded-2xl p-5 flex items-center justify-between gap-4 hover:shadow-md transition-all">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 ${c.status === 'Active' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                      <i className="fas fa-hard-hat text-xs"></i>
                    </div>
                    <div className="min-w-0">
                      <div className="font-black text-slate-900">{c.contractorName}</div>
                      <div className="text-[9px] text-slate-400 font-bold">{c.contractorMobile}{c.referralCode && ` · Code: ${c.referralCode}`}</div>
                      <div className="text-[8px] text-slate-400 mt-0.5">
                        {c.type === 'PerSqft' ? `₹${c.value}/SqFt` : c.type === 'PerBox' ? `₹${c.value}/Box` : c.type === 'Percentage' ? `${c.value}%` : `₹${c.value}`}
                        {c.targetCategory && ` · ${c.targetCategory}`}
                      </div>
                      {c.notes && <div className="text-[8px] italic text-slate-400 mt-0.5">{c.notes}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right shrink-0">
                    <div>
                      <div className="text-[7px] font-black text-slate-400 uppercase">Earned</div>
                      <div className="font-black text-indigo-600">{INR(c.totalEarned)}</div>
                    </div>
                    <div>
                      <div className="text-[7px] font-black text-slate-400 uppercase">Paid</div>
                      <div className="font-black text-emerald-600">{INR(c.totalPaid)}</div>
                    </div>
                    {c.pending > 0 && (
                      <div>
                        <div className="text-[7px] font-black text-amber-500 uppercase">Pending</div>
                        <div className="font-black text-amber-600 text-lg">{INR(c.pending)}</div>
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      {c.pending > 0 && isManager && (
                        <button onClick={() => { setSettleCI(c); setSettleCIAmt(c.pending); }}
                          className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-xl font-black text-[8px] uppercase hover:bg-emerald-200">
                          Settle
                        </button>
                      )}
                      {isAdmin && (
                        <button onClick={() => store.deleteContractorIncentive(c.id)}
                          className="w-8 h-8 rounded-xl bg-rose-50 text-rose-400 hover:bg-rose-100 flex items-center justify-center">
                          <i className="fas fa-trash-alt text-[9px]"></i>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ MARGIN GUARD ═══════════ */}
      {activeTab === 'margin' && (
        <div className="space-y-6">
          {/* Margin simulator */}
          <div className="bg-slate-900 text-white rounded-[28px] p-6 space-y-5">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Margin Simulator — Test any discount scenario</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5">Category</label>
                <select className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl font-bold text-sm outline-none text-white"
                  value={simCat} onChange={e => setSimCat(e.target.value)}>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5">Selling Price (₹)</label>
                <input type="number" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl font-black text-amber-400 text-lg outline-none"
                  placeholder="e.g. 850" value={simSell || ''} onChange={e => setSimSell(parseFloat(e.target.value || '0'))} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5">Landed Cost (₹)</label>
                <input type="number" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl font-black text-slate-300 text-lg outline-none"
                  placeholder="e.g. 650" value={simCost || ''} onChange={e => setSimCost(parseFloat(e.target.value || '0'))} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-500 uppercase block mb-1.5">Discount (₹)</label>
                <input type="number" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl font-black text-rose-400 text-lg outline-none"
                  placeholder="0" value={simDisc || ''} onChange={e => setSimDisc(parseFloat(e.target.value || '0'))} />
              </div>
            </div>

            {simResult && (
              <div className={`border-2 rounded-2xl p-5 space-y-4 ${simResult.riskLevel === 'Green' ? 'border-emerald-500/30 bg-emerald-900/20' : simResult.riskLevel === 'Yellow' ? 'border-amber-500/30 bg-amber-900/20' : 'border-rose-500/30 bg-rose-900/20'}`}>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-4">
                  {[
                    { label: 'Net Selling',   val: INR(simSell - simDisc),          cls: 'text-white' },
                    { label: 'Landed Cost',   val: INR(simCost),                    cls: 'text-slate-300' },
                    { label: 'Profit/Unit',   val: INR(simSell - simDisc - simCost), cls: simResult.riskLevel === 'Green' ? 'text-emerald-400' : 'text-rose-400' },
                    { label: 'Margin %',      val: `${simResult.marginPct.toFixed(1)}%`, cls: simResult.riskLevel === 'Green' ? 'text-emerald-400 text-2xl' : 'text-rose-400 text-2xl' },
                    { label: 'Risk',          val: simResult.riskLevel,             cls: simResult.riskLevel === 'Green' ? 'text-emerald-400' : simResult.riskLevel === 'Yellow' ? 'text-amber-400' : 'text-rose-400' },
                  ].map(({ label, val, cls }) => (
                    <div key={label} className="text-center">
                      <div className="text-[7px] font-black text-slate-500 uppercase mb-0.5">{label}</div>
                      <div className={`font-black ${cls}`}>{val}</div>
                    </div>
                  ))}
                </div>
                {simResult.riskLevel === 'Red' && <div className="text-[9px] font-black text-rose-400 bg-rose-900/30 rounded-xl px-3 py-2 text-center">⛔ Transaction would be BLOCKED — selling below cost</div>}
                {simResult.riskLevel === 'Yellow' && <div className="text-[9px] font-black text-amber-400 bg-amber-900/30 rounded-xl px-3 py-2 text-center">⚠ Low margin — approval required before applying</div>}
                {simResult.blocked && <div className="text-[9px] font-black text-rose-300">Min allowed: {(simResult.threshold as any)?.minMarginPct}%</div>}
              </div>
            )}
          </div>

          {/* Margin threshold config */}
          <div className="bg-white border border-slate-100 rounded-[24px] p-6 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Margin Thresholds by Category</div>
              {isAdmin && (
                <button onClick={() => setShowThresholdForm(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-indigo-700 transition-all">
                  <i className="fas fa-plus text-[9px]"></i> Add / Edit
                </button>
              )}
            </div>
            {showThresholdForm && isAdmin && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="text-[9px] font-black text-slate-500 uppercase">Add / Update Threshold</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className={lbl}>Category</label>
                    <select className={inp} value={threshForm.category} onChange={e => setThreshForm(f => ({ ...f, category: e.target.value }))}>
                      <option value="">Select…</option>
                      {categories.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Block Below % (Min)</label>
                    <input type="number" className={inp} value={threshForm.minMarginPct || ''} onChange={e => setThreshForm(f => ({ ...f, minMarginPct: parseFloat(e.target.value || '0') }))} />
                  </div>
                  <div>
                    <label className={lbl}>Warn Below % (Yellow)</label>
                    <input type="number" className={inp} value={threshForm.warningMarginPct || ''} onChange={e => setThreshForm(f => ({ ...f, warningMarginPct: parseFloat(e.target.value || '0') }))} />
                  </div>
                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-2 cursor-pointer mb-2.5">
                      <input type="checkbox" className="w-4 h-4 rounded" checked={threshForm.approvalRequired} onChange={e => setThreshForm(f => ({ ...f, approvalRequired: e.target.checked }))} />
                      <span className="text-xs font-bold text-slate-600">Require Approval</span>
                    </label>
                    <button
                      onClick={() => {
                        if (!threshForm.category) return;
                        const cur: any[] = [...thresholds];
                        const idx = cur.findIndex((t: any) => t.category === threshForm.category);
                        if (idx >= 0) cur[idx] = threshForm;
                        else cur.push(threshForm);
                        store.updateSettings({ marginThresholds: cur } as any);
                        setShowThresholdForm(false);
                        setThreshForm({ category: '', minMarginPct: 10, warningMarginPct: 15, approvalRequired: true });
                      }}
                      disabled={!threshForm.category}
                      className="w-full py-2 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-indigo-700 disabled:opacity-40">
                      Save Threshold
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {thresholds.map((t: any) => (
                <div key={t.category} className="flex items-center gap-4 bg-slate-50 rounded-2xl px-4 py-3">
                  <div className="font-black text-slate-800 w-28 shrink-0">{t.category}</div>
                  <div className="flex-1 flex items-center gap-4 text-sm">
                    <div className="text-center">
                      <div className="text-[7px] font-black text-rose-400 uppercase">Block Below</div>
                      <div className="font-black text-rose-600">{t.minMarginPct}%</div>
                    </div>
                    <div className="flex-1 h-2 bg-slate-200 rounded-full relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-rose-400 rounded-full" style={{ width: `${Math.min(t.minMarginPct, 100)}%` }}/>
                      <div className="absolute inset-y-0 bg-amber-400 rounded-full" style={{ left: `${Math.min(t.minMarginPct, 100)}%`, width: `${Math.min(t.warningMarginPct - t.minMarginPct, 100)}%` }}/>
                    </div>
                    <div className="text-center">
                      <div className="text-[7px] font-black text-amber-500 uppercase">Warn Below</div>
                      <div className="font-black text-amber-600">{t.warningMarginPct}%</div>
                    </div>
                  </div>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${t.approvalRequired ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                    {t.approvalRequired ? 'Approval req.' : 'Warning only'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Low-margin invoice alerts */}
          <div className="bg-white border border-slate-100 rounded-[24px] p-6 shadow-sm">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Recent Low-Margin Sales</div>
            {(() => {
              const riskySales = store.sales.filter(s => s.status !== 'Deleted').map(s => {
                const prof = s.items.reduce((acc, it) => {
                  const prod = store.products.find(p => p.id === it.productId);
                  const cost = (prod?.totalCostPerUnit || 0) * (it.qtyBoxes + it.qtyLoose / (prod?.tilesPerBox || 1));
                  return acc + (it.amount - cost);
                }, 0);
                const margin = s.totalAmount > 0 ? (prof / s.totalAmount) * 100 : 0;
                return { s, margin: r2(margin), profit: r2(prof) };
              }).filter(x => x.margin < 15).sort((a, b) => a.margin - b.margin).slice(0, 8);

              if (riskySales.length === 0) return <div className="text-center text-slate-300 font-black uppercase py-8">No low-margin sales detected ✓</div>;
              return (
                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-50">
                      {['Invoice','Customer','Date','Total','Margin%','Profit','Risk'].map(h => (
                        <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {riskySales.map(({ s, margin, profit }) => (
                        <tr key={s.id} className={margin < 5 ? 'bg-rose-50/30' : margin < 10 ? 'bg-amber-50/30' : ''}>
                          <td className="px-3 py-3 font-black text-blue-600">{s.invoiceNo}</td>
                          <td className="px-3 py-3 font-bold text-slate-700">{s.customerName}</td>
                          <td className="px-3 py-3 font-bold text-slate-400 whitespace-nowrap">{s.date}</td>
                          <td className="px-3 py-3 font-bold text-slate-700">{INR(s.totalAmount)}</td>
                          <td className={`px-3 py-3 font-black ${margin < 5 ? 'text-rose-600' : 'text-amber-600'}`}>{margin.toFixed(1)}%</td>
                          <td className={`px-3 py-3 font-black ${profit < 0 ? 'text-rose-600' : 'text-amber-600'}`}>{INR(profit)}</td>
                          <td className="px-3 py-3">
                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${margin < 0 ? RISK_CLS.Red : margin < 10 ? RISK_CLS.Yellow : RISK_CLS.Green}`}>
                              {margin < 0 ? 'Red' : margin < 10 ? 'Yellow' : 'Green'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ═══════════ APPROVALS ═══════════ */}
      {activeTab === 'approvals' && (
        <div className="space-y-5">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{(store.approvalRequests || []).length} total · {stats.pending} pending</div>
          {(store.approvalRequests || []).length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center space-y-3">
              <i className="fas fa-check-circle text-4xl text-emerald-200"></i>
              <div className="font-black text-slate-400 uppercase">No approvals pending ✓</div>
            </div>
          ) : (
            <div className="space-y-3">
              {[...(store.approvalRequests || [])].sort((a: any, b: any) => b.requestedAt.localeCompare(a.requestedAt)).map((r: any) => (
                <div key={r.id} className={`bg-white border-2 rounded-[24px] p-5 space-y-4 transition-all ${r.status === 'Pending' ? (r.riskLevel === 'Red' ? 'border-rose-200' : 'border-amber-200') : 'border-slate-100 opacity-70'}`}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-900">{r.customerName || 'Unknown Customer'}</span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${RISK_CLS[r.riskLevel] || ''}`}>{r.riskLevel} Risk</span>
                        <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{r.type}</span>
                      </div>
                      <div className="text-[9px] text-slate-400 font-bold mt-0.5">{r.reason}</div>
                      {r.invoiceNo && <div className="text-[9px] text-blue-500 font-black">Invoice: {r.invoiceNo}</div>}
                    </div>
                    <span className={`text-[8px] font-black px-3 py-1 rounded-full shrink-0 ${r.status === 'Pending' ? 'bg-amber-100 text-amber-700' : r.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                      {r.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 bg-slate-50 rounded-2xl px-4 py-3">
                    {[
                      { label: 'Original Price', val: INR(r.originalPrice) },
                      { label: 'Proposed Price', val: INR(r.proposedPrice) },
                      { label: 'Discount',        val: INR(r.discountValue) },
                      { label: 'Margin %',        val: `${r.marginPct?.toFixed(1)}%` },
                      { label: 'Requested by',    val: r.requestedBy },
                    ].map(({ label, val }) => (
                      <div key={label}>
                        <div className="text-[7px] font-black text-slate-400 uppercase mb-0.5">{label}</div>
                        <div className="font-black text-slate-800 text-xs">{val}</div>
                      </div>
                    ))}
                  </div>

                  {r.status === 'Pending' && isManager && (
                    <div className="space-y-2">
                      {rejectTarget === r.id && (
                        <div className="flex gap-2">
                          <input className="flex-1 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl font-bold text-sm outline-none"
                            placeholder="Rejection reason…" value={rejectComment} onChange={e => setRejectComment(e.target.value)} />
                          <button onClick={() => { store.resolveApproval(r.id, false, rejectComment || 'Rejected by manager'); setRejectTarget(null); setRejectComment(''); }}
                            className="px-4 py-2 bg-rose-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-rose-700">Confirm</button>
                          <button onClick={() => setRejectTarget(null)} className="px-3 py-2 bg-slate-100 text-slate-500 rounded-xl font-black text-[9px] uppercase">Cancel</button>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <button onClick={() => store.resolveApproval(r.id, true)}
                          className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all">
                          <i className="fas fa-check mr-1.5"></i> Approve
                        </button>
                        <button onClick={() => setRejectTarget(r.id)}
                          className="flex-1 py-2.5 bg-rose-100 text-rose-700 rounded-xl font-black text-[9px] uppercase hover:bg-rose-200 transition-all">
                          <i className="fas fa-times mr-1.5"></i> Reject with Reason
                        </button>
                      </div>
                    </div>
                  )}
                  {r.status !== 'Pending' && (
                    <div className="text-[9px] font-bold text-slate-400">{r.status} by {r.approvedBy} · {r.approvedAt?.slice(0,10)}{r.comment ? ` — "${r.comment}"` : ''}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ PROMO CODES ═══════════ */}
      {activeTab === 'promo' && (
        <div className="space-y-5">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active promo codes and their usage</div>
          {store.offers.filter(o => (o as any).promoCode).length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center space-y-3">
              <i className="fas fa-ticket-alt text-4xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase">No promo codes</div>
              <p className="text-[10px] text-slate-300 max-w-xs mx-auto">Create an offer of type "Promo Code" to generate shareable discount codes</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {store.offers.filter(o => (o as any).promoCode).map(o => {
                const used = (o as any).promoCodeUsageCount || 0;
                const limit = (o as any).promoCodeUsageLimit || 0;
                return (
                  <div key={o.id} className="bg-white border border-slate-100 rounded-[24px] p-5 space-y-4 shadow-sm">
                    <div className="flex justify-between items-center">
                      <div className="font-mono text-xl font-black text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 tracking-widest">
                        {(o as any).promoCode}
                      </div>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${STATUS_CLS[o.status] || ''}`}>{o.status}</span>
                    </div>
                    <div className="font-bold text-slate-700">{o.title}</div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-slate-50 rounded-xl p-2">
                        <div className="text-[7px] font-black text-slate-400 uppercase">Value</div>
                        <div className="font-black text-slate-800 text-sm">{o.type === 'Percentage' ? `${o.value}%` : INR(o.value)}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-2">
                        <div className="text-[7px] font-black text-slate-400 uppercase">Used</div>
                        <div className="font-black text-slate-800 text-sm">{used}{limit > 0 ? `/${limit}` : ''}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-2">
                        <div className="text-[7px] font-black text-slate-400 uppercase">Expires</div>
                        <div className="font-black text-slate-800 text-sm">{o.expiryDate || '∞'}</div>
                      </div>
                    </div>
                    {limit > 0 && (
                      <div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${Math.min((used / limit) * 100, 100)}%` }}/>
                        </div>
                        <div className="text-[8px] text-slate-400 font-bold mt-1">{used} of {limit} uses</div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => {
                        navigator.clipboard?.writeText((o as any).promoCode);
                        alert(`Code "${(o as any).promoCode}" copied!`);
                      }} className="flex-1 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[9px] uppercase hover:bg-indigo-100 transition-all">
                        <i className="fas fa-copy mr-1"></i> Copy
                      </button>
                      <button onClick={() => {
                        const msg = `🎉 Special Offer from *${store.settings.showroomName}*!\n\nUse code *${(o as any).promoCode}* to get ${o.type === 'Percentage' ? o.value + '% off' : '₹' + o.value + ' off'} on your purchase!\n\nValid till: ${o.expiryDate || 'Limited period'}`;
                        window.open(`https://wa.me?text=${encodeURIComponent(msg)}`, '_blank');
                      }} className="flex-1 py-2 bg-emerald-100 text-emerald-700 rounded-xl font-black text-[9px] uppercase hover:bg-emerald-200 transition-all">
                        <i className="fab fa-whatsapp mr-1"></i> Share
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ OFFER FORM MODAL ═══════════ */}
      {showOfferForm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-4xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95">

            <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
              <div>
                <div className="font-black text-xl">{editOffer ? 'Edit Offer' : 'Create New Offer'}</div>
                <div className="text-[9px] text-slate-400 font-bold mt-0.5">Fill details below. Margin impact shows on the right.</div>
              </div>
              <button onClick={() => { setShowOfferForm(false); setEditOffer(null); setForm(emptyForm()); }}
                className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20">
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Left: Form */}
              <div className="lg:col-span-2 space-y-5">

                {/* Offer kind selector */}
                <div>
                  <label className={lbl}>Offer Type</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {OFFER_KINDS.map(k => (
                      <button key={k.id} onClick={() => setF('kind', k.id)}
                        className={`flex items-center gap-2 px-3 py-3 rounded-2xl border-2 text-left transition-all
                          ${form.kind === k.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-300'}`}>
                        <i className={`fas ${k.icon} text-sm shrink-0`}></i>
                        <div>
                          <div className="font-black text-[10px] uppercase">{k.label}</div>
                          <div className={`text-[8px] ${form.kind === k.id ? 'text-slate-400' : 'text-slate-400'}`}>{k.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Basic info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className={lbl}>Offer Title</label>
                    <input className={inp} placeholder="e.g. Diwali Dhamaka Offer" value={form.title} onChange={e => setF('title', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={lbl}>Description</label>
                    <textarea className={`${inp} h-16 resize-none`} placeholder="Internal description…" value={form.description} onChange={e => setF('description', e.target.value)} />
                  </div>
                </div>

                {/* Kind-specific fields */}
                {(form.kind === 'Percentage' || form.kind === 'Fixed') && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={lbl}>{form.kind === 'Percentage' ? 'Discount %' : 'Flat Discount (₹)'}</label>
                      <input type="number" className={inp} placeholder="0"
                        value={form.value || ''} onChange={e => setF('value', parseFloat(e.target.value || '0'))} />
                    </div>
                    <div>
                      <label className={lbl}>Min Purchase Value (₹)</label>
                      <input type="number" className={inp} placeholder="0"
                        value={form.minPurchaseValue || ''} onChange={e => setF('minPurchaseValue', parseFloat(e.target.value || '0'))} />
                    </div>
                  </div>
                )}

                {form.kind === 'BOGO' && (
                  <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4 space-y-3">
                    <div className="text-[9px] font-black text-purple-600 uppercase">Buy X Get Y Configuration</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div><label className={lbl}>Buy Qty</label><input type="number" className={inp} value={form.bogo.buyQty} onChange={e => setF('bogo', { ...form.bogo, buyQty: parseInt(e.target.value || '1') })} /></div>
                      <div><label className={lbl}>Get Qty</label><input type="number" className={inp} value={form.bogo.getQty} onChange={e => setF('bogo', { ...form.bogo, getQty: parseInt(e.target.value || '1') })} /></div>
                      <div><label className={lbl}>% Off 2nd</label><input type="number" className={inp} value={form.bogo.discountOnSecond || ''} onChange={e => setF('bogo', { ...form.bogo, discountOnSecond: parseFloat(e.target.value || '0') })} /></div>
                    </div>
                    <div><label className={lbl}>Free Product (leave blank = same product)</label>
                      <select className={inp} value={form.bogo.getFreeProductId || ''} onChange={e => setF('bogo', { ...form.bogo, getFreeProductId: e.target.value })}>
                        <option value="">Same product as purchased</option>
                        {store.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {form.kind === 'PromoCode' && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div><label className={lbl}>Promo Code</label><input className={`${inp} font-mono uppercase`} placeholder="DIWALI25" value={form.promoCode} onChange={e => setF('promoCode', e.target.value.toUpperCase())} /></div>
                    <div><label className={lbl}>Discount %</label><input type="number" className={inp} value={form.value || ''} onChange={e => setF('value', parseFloat(e.target.value || '0'))} /></div>
                    <div><label className={lbl}>Usage Limit</label><input type="number" className={inp} placeholder="0 = unlimited" value={form.promoCodeUsageLimit || ''} onChange={e => setF('promoCodeUsageLimit', parseInt(e.target.value || '0'))} /></div>
                  </div>
                )}

                {form.kind === 'InvoiceValue' && (
                  <div className="space-y-3">
                    <div className="text-[9px] font-black text-slate-400 uppercase">Invoice Value Slabs (add reward tiers)</div>
                    {(form.invoiceSlabs || []).map((slab: any, i: number) => (
                      <div key={i} className="grid grid-cols-4 gap-2 items-center bg-slate-50 rounded-xl p-3">
                        <div><label className={lbl}>Min Bill (₹)</label><input type="number" className={inp} value={slab.minValue || ''} onChange={e => { const s = [...form.invoiceSlabs]; s[i] = { ...s[i], minValue: parseFloat(e.target.value || '0') }; setF('invoiceSlabs', s); }} /></div>
                        <div><label className={lbl}>Benefit Type</label>
                          <select className={inp} value={slab.benefit} onChange={e => { const s = [...form.invoiceSlabs]; s[i] = { ...s[i], benefit: e.target.value }; setF('invoiceSlabs', s); }}>
                            {['Percentage','Fixed','FreeProduct','Gift'].map(b => <option key={b}>{b}</option>)}
                          </select></div>
                        <div><label className={lbl}>Value / Gift</label><input className={inp} placeholder="Value or description" value={slab.benefitValue || slab.giftDescription || ''} onChange={e => { const s = [...form.invoiceSlabs]; s[i] = { ...s[i], benefitValue: parseFloat(e.target.value || '0'), giftDescription: e.target.value }; setF('invoiceSlabs', s); }} /></div>
                        <div className="pt-5"><button onClick={() => setF('invoiceSlabs', form.invoiceSlabs.filter((_: any, j: number) => j !== i))} className="w-8 h-8 rounded-xl bg-rose-50 text-rose-400 hover:bg-rose-100 flex items-center justify-center"><i className="fas fa-times text-xs"></i></button></div>
                      </div>
                    ))}
                    <button onClick={() => setF('invoiceSlabs', [...(form.invoiceSlabs || []), { minValue: 0, benefit: 'Percentage', benefitValue: 0 }])}
                      className="w-full py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-[9px] font-black text-slate-400 uppercase hover:border-slate-400 transition-all">
                      + Add Slab
                    </button>
                  </div>
                )}

                {/* Dates + Campaign budget */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div><label className={lbl}>Start Date</label><input type="date" className={inp} value={form.startDate} onChange={e => setF('startDate', e.target.value)} /></div>
                  <div><label className={lbl}>Expiry Date</label><input type="date" className={inp} value={form.expiryDate} onChange={e => setF('expiryDate', e.target.value)} /></div>
                  <div><label className={lbl}>Priority (1-10)</label><input type="number" className={inp} min={1} max={10} value={form.priority || 1} onChange={e => setF('priority', parseInt(e.target.value || '1'))} /></div>
                  <div><label className={lbl}>Campaign Budget (₹)</label><input type="number" className={inp} placeholder="0" value={form.campaignBudget || ''} onChange={e => setF('campaignBudget', parseFloat(e.target.value || '0'))} /></div>
                </div>

                {/* Targets */}
                <div className="space-y-3">
                  <label className={lbl}>Target Categories</label>
                  <div className="flex flex-wrap gap-2">
                    {categories.map(c => (
                      <button key={c} onClick={() => setF('targetCategories', form.targetCategories.includes(c) ? form.targetCategories.filter((x: string) => x !== c) : [...form.targetCategories, c])}
                        className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${form.targetCategories.includes(c) ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={lbl}>Target Customer Segments</label>
                  <div className="flex flex-wrap gap-2">
                    {CUSTOMER_SEGMENTS.map(s => (
                      <button key={s} onClick={() => {
                        const segs = form.targetCustomerSegments || [];
                        setF('targetCustomerSegments', segs.includes(s) ? segs.filter((x: string) => x !== s) : [...segs, s]);
                      }} className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${(form.targetCustomerSegments || []).includes(s) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Specific products */}
                <div className="space-y-2">
                  <label className={lbl}>Specific Products (optional)</label>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl max-h-40 overflow-y-auto p-3 space-y-1">
                    {store.products.map(p => (
                      <label key={p.id} className="flex items-center gap-3 cursor-pointer hover:bg-white rounded-lg px-2 py-1.5 transition-all">
                        <input type="checkbox" className="w-4 h-4 rounded"
                          checked={form.targetProductIds.includes(p.id)}
                          onChange={e => setF('targetProductIds', e.target.checked ? [...form.targetProductIds, p.id] : form.targetProductIds.filter((id: string) => id !== p.id))} />
                        <span className="text-xs font-bold text-slate-600">{p.name} — {p.brand}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Margin protection */}
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 space-y-3">
                  <div className="text-[9px] font-black text-rose-600 uppercase tracking-widest flex items-center gap-2">
                    <i className="fas fa-shield-alt"></i> Margin Protection
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl}>Min Margin % to Allow</label>
                      <input type="number" className={inp} placeholder="0" value={form.minMarginPct || ''} onChange={e => setF('minMarginPct', parseFloat(e.target.value || '0'))} />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-3 cursor-pointer pb-2.5">
                        <input type="checkbox" className="w-4 h-4 rounded" checked={form.requiresApproval} onChange={e => setF('requiresApproval', e.target.checked)} />
                        <span className="text-xs font-bold text-slate-600">Require approval before applying</span>
                      </label>
                    </div>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 rounded" checked={form.stackable} onChange={e => setF('stackable', e.target.checked)} />
                    <span className="text-xs font-bold text-slate-600">Can stack with other offers</span>
                  </label>
                </div>
              </div>

              {/* Right: Live margin analysis */}
              <div className="space-y-4">
                <div className={`rounded-[24px] p-5 space-y-4 text-white ${
                  !formImpact ? 'bg-slate-800' :
                  formImpact.riskLevel === 'Red' ? 'bg-rose-900' :
                  formImpact.riskLevel === 'Yellow' ? 'bg-amber-800' : 'bg-emerald-900'}`}>
                  <div className="text-[9px] font-black opacity-60 uppercase tracking-widest">Live Margin Impact</div>
                  {!formImpact ? (
                    <div className="text-slate-500 font-bold text-sm">Select categories or products to see impact</div>
                  ) : (
                    <>
                      <div>
                        <div className="text-4xl font-black">{formImpact.marginPct.toFixed(1)}%</div>
                        <div className="text-[9px] opacity-60 mt-0.5">Estimated margin after offer</div>
                      </div>
                      <div className="space-y-2 border-t border-white/10 pt-3">
                        {[
                          { label: 'Avg Sell Price', val: INR(formImpact.avgSell) },
                          { label: 'Discount',       val: `-${INR(formImpact.disc)}` },
                          { label: 'Avg Net Sell',   val: INR(formImpact.net) },
                          { label: 'Avg Cost',       val: INR(formImpact.avgCost) },
                          { label: 'Avg Profit',     val: INR(formImpact.profit) },
                        ].map(({ label, val }) => (
                          <div key={label} className="flex justify-between text-[9px]">
                            <span className="opacity-60 font-bold">{label}</span>
                            <span className="font-black">{val}</span>
                          </div>
                        ))}
                      </div>
                      <div className={`text-center text-[9px] font-black px-3 py-2 rounded-xl ${formImpact.riskLevel === 'Red' ? 'bg-rose-500' : formImpact.riskLevel === 'Yellow' ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                        {formImpact.riskLevel === 'Red' ? '⛔ Margin dangerously low' : formImpact.riskLevel === 'Yellow' ? '⚠ Low margin — approval needed' : '✓ Healthy margin'}
                      </div>
                    </>
                  )}
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-[9px] font-bold text-amber-700 space-y-1">
                  <div className="font-black text-amber-800">Publish Protocol</div>
                  <div>Saved in Draft first. Only Admins / Managers can publish to sales module.</div>
                </div>

                <button onClick={saveOffer} disabled={!form.title}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95 disabled:opacity-40">
                  {editOffer ? 'Update Offer' : 'Save as Draft'}
                </button>
                <button onClick={() => { setShowOfferForm(false); setEditOffer(null); setForm(emptyForm()); }}
                  className="w-full py-3 text-[9px] font-black text-slate-400 uppercase hover:text-slate-700 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ GIFT MANAGEMENT TAB ═══════════ */}
      {(activeTab as any) === 'gifts' && (
        <div className="space-y-5">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Gift Stock · Issuance · Tracking</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setActiveGiftTab('stock'); setShowGiftForm(true); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-700 transition-all">
                <i className="fas fa-plus text-xs"></i> Add Gift Stock
              </button>
              <button onClick={() => setShowIssueGift(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-indigo-700 transition-all">
                <i className="fas fa-hand-holding text-xs"></i> Issue Gift
              </button>
            </div>
          </div>

          {/* Gift stock summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(store.giftInventory || []).map((g: any) => (
              <div key={g.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center mb-2">
                  <i className="fas fa-gift text-amber-600 text-xs"></i>
                </div>
                <div className="font-black text-slate-800 text-sm">{g.name}</div>
                <div className="text-[9px] text-slate-400 font-bold mt-0.5">{INR(g.unitCost)} / unit</div>
                <div className={`text-xl font-black mt-1 ${g.qty <= 0 ? 'text-rose-600' : g.qty <= 2 ? 'text-amber-600' : 'text-slate-800'}`}>{g.qty} left</div>
              </div>
            ))}
            {(store.giftInventory || []).length === 0 && (
              <div className="col-span-4 bg-white border-2 border-dashed border-slate-200 rounded-2xl py-16 text-center space-y-3">
                <i className="fas fa-gift text-4xl text-slate-200"></i>
                <div className="font-black text-slate-400 uppercase">No gift items in stock</div>
                <p className="text-[10px] text-slate-300 max-w-xs mx-auto">Add TVs, mobiles, gold coins etc. for promotional issuance</p>
              </div>
            )}
          </div>

          {/* Gift issuance history */}
          {(store.giftIssuances || []).length > 0 && (
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm space-y-3">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Issuance History</div>
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    {['Gift','Qty','Customer','Invoice','Date','Value','Notes'].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {[...(store.giftIssuances || [])].sort((a: any, b: any) => b.date.localeCompare(a.date)).map((gi: any) => {
                      const gift = (store.giftInventory || []).find((g: any) => g.id === gi.giftId);
                      return (
                        <tr key={gi.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-3 font-black text-amber-600">{gift?.name || 'Unknown'}</td>
                          <td className="px-3 py-3 font-bold text-slate-700">{gi.qty}</td>
                          <td className="px-3 py-3 font-bold text-slate-700">{gi.customerName}</td>
                          <td className="px-3 py-3 font-black text-blue-600">{gi.invoiceNo || '—'}</td>
                          <td className="px-3 py-3 font-bold text-slate-400 whitespace-nowrap">{gi.date}</td>
                          <td className="px-3 py-3 font-black text-rose-600">{INR((gift?.unitCost || 0) * gi.qty)}</td>
                          <td className="px-3 py-3 font-bold text-slate-400 italic">{gi.notes || '—'}</td>
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

      {/* ── Gift stock add modal ── */}
      {showGiftForm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-amber-700 text-white px-6 py-5 flex items-center justify-between">
              <div className="font-black text-lg">Add Gift to Stock</div>
              <button onClick={() => setShowGiftForm(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className={lbl}>Gift Name</label><input className={inp} placeholder="e.g. Samsung TV, Gold Coin 2g" value={giftForm.name} onChange={e => setGiftForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Quantity</label><input type="number" className={inp} value={giftForm.qty || ''} onChange={e => setGiftForm(f => ({ ...f, qty: parseInt(e.target.value || '0') }))} /></div>
                <div><label className={lbl}>Unit Cost (₹)</label><input type="number" className={inp} value={giftForm.unitCost || ''} onChange={e => setGiftForm(f => ({ ...f, unitCost: parseFloat(e.target.value || '0') }))} /></div>
              </div>
              <div><label className={lbl}>Notes</label><input className={inp} placeholder="Supplier, batch, etc." value={giftForm.notes} onChange={e => setGiftForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <button onClick={() => {
                if (!giftForm.name || !giftForm.qty) return;
                store.addGiftStock({ id: Date.now().toString(), ...giftForm });
                setShowGiftForm(false);
                setGiftForm({ name: '', qty: 0, unitCost: 0, notes: '' });
              }} disabled={!giftForm.name || !giftForm.qty}
                className="w-full py-3 bg-amber-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-amber-700 transition-all disabled:opacity-40">
                Add to Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Issue gift modal ── */}
      {showIssueGift && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-indigo-800 text-white px-6 py-5 flex items-center justify-between">
              <div className="font-black text-lg">Issue Gift to Customer</div>
              <button onClick={() => setShowIssueGift(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className={lbl}>Select Gift</label>
                <select className={inp} value={giftIssueForm.giftId} onChange={e => setGiftIssueForm(f => ({ ...f, giftId: e.target.value }))}>
                  <option value="">-- Select --</option>
                  {(store.giftInventory || []).filter((g: any) => g.qty > 0).map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name} ({g.qty} in stock)</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Customer Name</label><input className={inp} value={giftIssueForm.customerName} onChange={e => setGiftIssueForm(f => ({ ...f, customerName: e.target.value }))} /></div>
                <div><label className={lbl}>Invoice No</label><input className={inp} placeholder="Optional" value={giftIssueForm.invoiceNo} onChange={e => setGiftIssueForm(f => ({ ...f, invoiceNo: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Qty</label><input type="number" min={1} className={inp} value={giftIssueForm.qty} onChange={e => setGiftIssueForm(f => ({ ...f, qty: parseInt(e.target.value || '1') }))} /></div>
                <div><label className={lbl}>Date</label><input type="date" className={inp} value={giftIssueForm.date} onChange={e => setGiftIssueForm(f => ({ ...f, date: e.target.value }))} /></div>
              </div>
              <div><label className={lbl}>Notes</label><input className={inp} placeholder="Reason, offer name…" value={giftIssueForm.notes} onChange={e => setGiftIssueForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <button onClick={() => {
                if (!giftIssueForm.giftId || !giftIssueForm.customerName) return;
                store.issueGift({ id: Date.now().toString(), ...giftIssueForm });
                setShowIssueGift(false);
                setGiftIssueForm({ giftId: '', qty: 1, customerName: '', invoiceNo: '', notes: '', date: today() });
              }} disabled={!giftIssueForm.giftId || !giftIssueForm.customerName}
                className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-indigo-700 transition-all disabled:opacity-40">
                Confirm Issue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Contractor partial settlement modal ── */}
      {settleCI && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-indigo-900 text-white px-6 py-5 flex items-center justify-between">
              <div>
                <div className="font-black text-lg">Settle Incentive</div>
                <div className="text-[9px] text-indigo-300 font-bold mt-0.5">{settleCI.contractorName} · Pending {INR(settleCI.pending)}</div>
              </div>
              <button onClick={() => setSettleCI(null)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={lbl}>Amount to Settle (₹)</label>
                <input type="number" className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-200 rounded-2xl font-black text-2xl text-indigo-600 outline-none focus:border-indigo-400"
                  value={settleCIAmt || ''} max={settleCI.pending}
                  onChange={e => setSettleCIAmt(Math.min(parseFloat(e.target.value || '0'), settleCI.pending))} />
              </div>
              <button onClick={() => {
                const paid = settleCI.totalPaid + settleCIAmt;
                const pending = settleCI.pending - settleCIAmt;
                store.updateContractorIncentive(settleCI.id, { totalPaid: paid, pending, status: pending <= 0 ? 'Settled' : 'Active' });
                setSettleCI(null); setSettleCIAmt(0);
              }} disabled={settleCIAmt <= 0}
                className="w-full py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-700 disabled:opacity-40">
                Confirm Settlement {settleCIAmt > 0 ? `(${INR(settleCIAmt)})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CONTRACTOR INCENTIVE FORM ═══════════ */}
      {showCI && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-indigo-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
              <div>
                <div className="font-black text-lg">Contractor / Mestri Incentive</div>
                <div className="text-[9px] text-indigo-300 font-bold mt-0.5">Referral · Commission · Gift · Target</div>
              </div>
              <button onClick={() => setShowCI(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Name</label><input className={inp} placeholder="Contractor name" value={ciForm.contractorName} onChange={e => setCiForm(f => ({ ...f, contractorName: e.target.value }))} /></div>
                <div><label className={lbl}>Mobile</label><input className={inp} placeholder="Mobile" value={ciForm.contractorMobile} onChange={e => setCiForm(f => ({ ...f, contractorMobile: e.target.value }))} /></div>
              </div>
              <div>
                <label className={lbl}>Incentive Type</label>
                <div className="flex flex-wrap gap-2">
                  {INCENTIVE_TYPES.map(t => (
                    <button key={t} onClick={() => setCiForm(f => ({ ...f, type: t }))}
                      className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${ciForm.type === t ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                      {t === 'PerSqft' ? '₹/SqFt' : t === 'PerBox' ? '₹/Box' : t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>{ciForm.type === 'PerSqft' ? '₹ per SqFt' : ciForm.type === 'PerBox' ? '₹ per Box' : ciForm.type === 'Percentage' ? 'Commission %' : 'Value (₹)'}</label><input type="number" className={inp} value={ciForm.value || ''} onChange={e => setCiForm(f => ({ ...f, value: parseFloat(e.target.value || '0') }))} /></div>
                <div><label className={lbl}>Category (optional)</label>
                  <select className={inp} value={ciForm.targetCategory} onChange={e => setCiForm(f => ({ ...f, targetCategory: e.target.value }))}>
                    <option value="">All Categories</option>
                    {categories.map(c => <option key={c}>{c}</option>)}
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Start Date</label><input type="date" className={inp} value={ciForm.startDate} onChange={e => setCiForm(f => ({ ...f, startDate: e.target.value }))} /></div>
                <div><label className={lbl}>Expiry Date</label><input type="date" className={inp} value={ciForm.expiryDate} onChange={e => setCiForm(f => ({ ...f, expiryDate: e.target.value }))} /></div>
              </div>
              <div><label className={lbl}>Referral Code (optional)</label><input className={`${inp} font-mono uppercase`} placeholder="e.g. RAVI2026" value={ciForm.referralCode} onChange={e => setCiForm(f => ({ ...f, referralCode: e.target.value.toUpperCase() }))} /></div>
              <div><label className={lbl}>Notes</label><textarea className={`${inp} h-16 resize-none`} placeholder="Additional terms or notes…" value={ciForm.notes} onChange={e => setCiForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div className="p-5 border-t border-slate-100 shrink-0 flex gap-3">
              <button onClick={() => {
                  if (!ciForm.contractorName) return;
                  store.addContractorIncentive(ciForm);
                  setShowCI(false);
                  setCiForm({ contractorName: '', contractorMobile: '', type: 'PerSqft', value: 0, targetCategory: '', startDate: today(), expiryDate: '', notes: '', referralCode: '', totalEarned: 0, totalPaid: 0, pending: 0, status: 'Active', linkedInvoiceIds: [] });
                }}
                disabled={!ciForm.contractorName || !ciForm.value}
                className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-indigo-700 transition-all disabled:opacity-40">
                Create Incentive
              </button>
              <button onClick={() => setShowCI(false)} className="px-5 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Offers;
