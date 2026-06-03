import React, { useState, useMemo, useEffect } from 'react';
import { store } from '../store';
import { CommissionRule, Category, UserRole, CommissionTier, PayrollRecord, PayrollStatus } from '../types';

// ── helpers ──────────────────────────────────────────────────────────────────
const INR   = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const r2    = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().split('T')[0];
const pctColor = (p: number) => p >= 20 ? 'text-emerald-600' : p >= 10 ? 'text-amber-600' : p >= 0 ? 'text-orange-600' : 'text-rose-600';
const pctBg = (p: number) => p >= 20 ? 'bg-emerald-100 text-emerald-700' : p >= 10 ? 'bg-amber-100 text-amber-700' : p >= 0 ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700';

type Tab = 'rules' | 'simulator' | 'entries' | 'slowstock' | 'payroll';

const CommissionMaster: React.FC = () => {
  const [ts, setTs] = useState(store.lastUpdated);
  useEffect(() => store.subscribe(() => setTs(store.lastUpdated)), []);

  const isAdmin   = store.currentUser?.role === UserRole.ADMIN;
  const isManager = store.currentUser?.role === UserRole.MANAGER || isAdmin;
  const categories = store.settings.categories || [];
  const executives = useMemo(() => store.users.filter(u => u.role !== UserRole.ADMIN), [ts]);

  const [activeTab, setActiveTab]   = useState<Tab>('rules');
  const [showAdd, setShowAdd]       = useState(false);
  const [editRule, setEditRule]     = useState<CommissionRule | null>(null);

  // ── Rule form ────────────────────────────────────────────────────────────────
  const emptyForm = () => ({
    title: '', description: '', type: 'Conditional' as any, value: 0, isActive: true,
    targetCategory: '', targetProductId: '', targetUserId: '', priority: 1,
    startDate: today(), expiryDate: '',
    minDaysInStock: 90, maxMarginForTrigger: 15,
    tiers: [
      { minMargin: 20, commissionValue: 3, commissionType: 'Percentage' as const },
      { minMargin: 10, commissionValue: 1.5, commissionType: 'Percentage' as const },
      { minMargin: 0,  commissionValue: 0,   commissionType: 'Percentage' as const },
    ],
  });
  const [form, setForm] = useState<any>(emptyForm());
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  // ── Payroll ───────────────────────────────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showPayoutModal, setShowPayoutModal] = useState<PayrollRecord | null>(null);
  const [payoutForm, setPayoutForm]           = useState({ amount: 0, remarks: '' });
  const [showAdjustModal, setShowAdjustModal] = useState<PayrollRecord | null>(null);
  const [adjustForm, setAdjustForm]           = useState({ type: 'bonus' as 'bonus'|'travel'|'other', amount: 0 });
  const [detailUser, setDetailUser]           = useState<string | null>(null);

  // ── Simulator ─────────────────────────────────────────────────────────────────
  const [simSell,  setSimSell]  = useState(0);
  const [simCost,  setSimCost]  = useState(0);
  const [simCat,   setSimCat]   = useState(categories[0] || '');
  const [simUser,  setSimUser]  = useState('');
  const [simDisc,  setSimDisc]  = useState(0);

  // ── Slow-stock filter ─────────────────────────────────────────────────────────
  const [slowDays, setSlowDays] = useState(90);

  // ── Computed ──────────────────────────────────────────────────────────────────
  const currentMonthRecords = useMemo(() =>
    store.payrollRecords.filter(p => p.month === selectedMonth), [ts, selectedMonth]);

  const slowMoving = useMemo(() => store.getSlowMovingProducts(slowDays), [ts, slowDays]);

  const allEntries = useMemo(() => (store.incentiveEntries || [])
    .sort((a: any, b: any) => b.date.localeCompare(a.date)), [ts]);

  const totalAccrued = useMemo(() => allEntries
    .filter((e: any) => e.date?.startsWith(selectedMonth))
    .reduce((s: number, e: any) => s + e.incentiveAmount, 0), [allEntries, selectedMonth]);

  // Simulator result
  const simResult = useMemo(() => {
    if (!simSell || !simCost) return null;
    const net    = simSell - simDisc;
    const profit = net - simCost;
    const margin = simCost > 0 ? (profit / simCost) * 100 : -999;

    const eligible = store.commissionRules
      .filter(r => r.isActive && (!r.expiryDate || r.expiryDate >= today()) && (!r.targetUserId || r.targetUserId === simUser))
      .filter(r => !r.targetCategory || r.targetCategory === simCat)
      .sort((a, b) => ((b as any).priority || 1) - ((a as any).priority || 1));

    let incentive = 0; let ruleName = '—'; let basis = '';
    for (const rule of eligible) {
      if (rule.type === 'Conditional' && rule.tiers?.length) {
        const sorted = [...rule.tiers].sort((a, b) => b.minMargin - a.minMargin);
        const tier = sorted.find(t => margin >= t.minMargin);
        if (tier && tier.commissionValue > 0) {
          incentive = tier.commissionType === 'Percentage' ? (net * tier.commissionValue) / 100 : tier.commissionValue;
          ruleName = rule.title;
          basis = `${tier.commissionValue}${tier.commissionType === 'Percentage' ? '%' : '₹'} of ₹${Math.round(net)} (margin ${margin.toFixed(1)}% ≥ ${tier.minMargin}%)`;
          break;
        }
      } else if (rule.type === 'Percentage' && rule.value > 0) {
        incentive = (net * rule.value) / 100;
        ruleName = rule.title; basis = `${rule.value}% of ₹${Math.round(net)}`; break;
      } else if (rule.type === 'Fixed' && rule.value > 0) {
        incentive = rule.value; ruleName = rule.title; basis = `Fixed ₹${rule.value}`; break;
      }
    }
    return { net, profit, margin, incentive, ruleName, basis };
  }, [simSell, simCost, simDisc, simCat, simUser, ts]);

  // ── Save rule ─────────────────────────────────────────────────────────────────
  const saveRule = () => {
    if (!form.title) return;
    const r: any = {
      ...form,
      targetCategory:  form.targetCategory  || undefined,
      targetProductId: form.targetProductId  || undefined,
      targetUserId:    form.targetUserId     || undefined,
      tiers: form.type === 'Conditional' ? form.tiers : undefined,
      minDaysInStock:  form.type === 'SlowStock' ? form.minDaysInStock : undefined,
      maxMarginForTrigger: form.type === 'SlowStock' ? form.maxMarginForTrigger : undefined,
    };
    if (editRule) {
      store.updateCommissionRule(editRule.id, r);
    } else {
      store.addCommissionRule(r);
    }
    setShowAdd(false); setEditRule(null); setForm(emptyForm());
  };

  const openEdit = (rule: CommissionRule) => {
    setEditRule(rule);
    setForm({ ...emptyForm(), ...rule, tiers: rule.tiers || emptyForm().tiers });
    setShowAdd(true);
  };

  const getStatus = (rule: CommissionRule) => {
    const now = today();
    if (rule.expiryDate && now > rule.expiryDate) return 'Expired';
    if (rule.startDate && now < rule.startDate) return 'Scheduled';
    return 'Active';
  };

  const payrollStatus = (s: PayrollStatus) =>
    s === 'Paid' ? 'bg-emerald-100 text-emerald-700' :
    s === 'Partially Paid' ? 'bg-amber-100 text-amber-700' :
    'bg-slate-100 text-slate-500';

  const inp  = "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400 focus:bg-white transition-all";
  const lbl  = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

  const TABS: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'rules',     label: 'Logic Matrix',   icon: 'fa-sitemap',   badge: store.commissionRules.filter(r => r.isActive).length },
    { id: 'simulator', label: 'Simulator',      icon: 'fa-calculator' },
    { id: 'entries',   label: 'Incentive Log',  icon: 'fa-list',      badge: allEntries.filter((e:any) => e.date?.startsWith(selectedMonth)).length || undefined },
    { id: 'slowstock', label: 'Slow Stock',      icon: 'fa-box',       badge: slowMoving.length || undefined },
    { id: 'payroll',   label: 'Payroll',         icon: 'fa-wallet' },
  ];

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 pb-20">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tighter uppercase italic">Incentive Architecture</h1>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Commission Logic · Margin-Based Tiers · Payroll · Slow Stock Incentives</p>
        </div>
        {isManager && activeTab === 'rules' && (
          <button onClick={() => { setEditRule(null); setForm(emptyForm()); setShowAdd(true); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-amber-600 transition-all active:scale-95">
            <i className="fas fa-plus text-xs"></i> New Rule
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full font-black text-[9px] uppercase tracking-widest whitespace-nowrap transition-all flex-shrink-0
              ${activeTab === t.id ? 'bg-slate-900 text-white shadow' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <i className={`fas ${t.icon} text-[9px]`}></i> {t.label}
            {t.badge ? <span className="absolute -top-1.5 -right-1 bg-amber-500 text-white w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ═══ RULES TAB ═══ */}
      {activeTab === 'rules' && (
        <div className="space-y-5">
          {/* How it works card */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-[24px] px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shrink-0">
              <i className="fas fa-lightbulb text-white"></i>
            </div>
            <div className="flex-1">
              <div className="font-black text-sm">How the Incentive Engine Works</div>
              <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                On every sale → system checks active rules → finds the best match for each item → calculates incentive based on margin % achieved → accrues to salesperson's monthly payroll automatically.
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[8px] font-black text-slate-500 uppercase">Rules Active</div>
              <div className="text-2xl font-black text-amber-400">{store.commissionRules.filter(r => r.isActive).length}</div>
            </div>
          </div>

          {store.commissionRules.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center space-y-3">
              <i className="fas fa-sitemap text-4xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase">No incentive rules defined</div>
              <p className="text-[10px] text-slate-300 max-w-xs mx-auto">Create your first rule — e.g. "Pay 3% if margin ≥ 20%"</p>
              {isManager && <button onClick={() => { setForm(emptyForm()); setShowAdd(true); }} className="text-amber-600 font-black text-sm hover:underline">+ Create First Rule</button>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...store.commissionRules].sort((a, b) => ((b as any).priority || 1) - ((a as any).priority || 1)).map(rule => {
                const status = getStatus(rule);
                const typeColor = rule.type === 'Conditional' ? 'bg-indigo-500' : rule.type === 'SlowStock' ? 'bg-amber-500' : rule.type === 'Fixed' ? 'bg-emerald-500' : 'bg-blue-500';
                return (
                  <div key={rule.id} className="bg-white border border-slate-100 rounded-[24px] overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                    <div className={`h-1.5 ${typeColor}`}/>
                    <div className="p-5 space-y-4">
                      <div className="flex justify-between items-start">
                        <div className="flex gap-2 flex-wrap">
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase border ${status === 'Active' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : status === 'Expired' ? 'bg-rose-50 text-rose-500 border-rose-200' : 'bg-blue-50 text-blue-500 border-blue-200'}`}>{status}</span>
                          <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">{rule.type}</span>
                          {(rule as any).priority > 1 && <span className="text-[8px] font-black bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">P{(rule as any).priority}</span>}
                        </div>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <div onClick={() => isManager && store.updateCommissionRule(rule.id, { isActive: !rule.isActive })}
                            className={`w-8 h-4 rounded-full relative transition-all cursor-pointer ${rule.isActive ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${rule.isActive ? 'left-4' : 'left-0.5'}`}/>
                          </div>
                        </label>
                      </div>

                      <div>
                        <h3 className="font-black text-slate-900 text-base leading-tight">{rule.title}</h3>
                        {(rule as any).description && <p className="text-[9px] text-slate-400 font-medium mt-0.5">{(rule as any).description}</p>}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {rule.targetCategory && <span className="text-[7px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{rule.targetCategory}</span>}
                          {rule.targetUserId && <span className="text-[7px] font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{executives.find(e => e.id === rule.targetUserId)?.name || 'Specific exec'}</span>}
                          {rule.targetProductId && <span className="text-[7px] font-black bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">Specific product</span>}
                          {rule.startDate && <span className="text-[7px] font-black bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full">From {rule.startDate}</span>}
                          {rule.expiryDate && <span className="text-[7px] font-black bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full">Until {rule.expiryDate}</span>}
                        </div>
                      </div>

                      {/* Rule value display */}
                      {rule.type === 'Conditional' && rule.tiers?.length ? (
                        <div className="space-y-1.5 bg-slate-50 rounded-2xl p-3">
                          <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Margin → Incentive</div>
                          {[...rule.tiers].sort((a, b) => b.minMargin - a.minMargin).map((t, i) => (
                            <div key={i} className={`flex items-center justify-between rounded-xl px-3 py-2 ${t.commissionValue > 0 ? 'bg-white border border-slate-100' : 'bg-slate-100 opacity-50'}`}>
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${t.commissionValue > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`}/>
                                <span className="text-[9px] font-bold text-slate-600">Margin ≥ {t.minMargin}%</span>
                              </div>
                              <span className={`font-black text-sm ${t.commissionValue > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {t.commissionValue > 0 ? `${t.commissionValue}${t.commissionType === 'Percentage' ? '%' : ' ₹'}` : 'No incentive'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : rule.type === 'SlowStock' ? (
                        <div className="bg-amber-50 rounded-2xl p-3 space-y-1">
                          <div className="text-[8px] font-black text-amber-600 uppercase tracking-widest">Slow Stock Booster</div>
                          <div className="text-[9px] font-bold text-slate-600">
                            Trigger: unsold ≥ {(rule as any).minDaysInStock || 90} days
                            {(rule as any).maxMarginForTrigger && ` · margin ≤ ${(rule as any).maxMarginForTrigger}%`}
                          </div>
                          <div className="font-black text-amber-700">{rule.value > 0 ? `${rule.value}${rule.type === 'Fixed' ? ' ₹ bonus' : '%'}` : 'Custom tier'}</div>
                        </div>
                      ) : (
                        <div className="bg-slate-900 rounded-2xl p-4 flex justify-between items-center">
                          <div className="text-[8px] font-black text-slate-500 uppercase">Incentive</div>
                          <div className="font-black text-white text-xl">{rule.value}{rule.type === 'Percentage' ? '%' : ' ₹'}</div>
                        </div>
                      )}

                      {/* Stats */}
                      {((rule as any).usageCount > 0) && (
                        <div className="flex gap-3 text-[8px] font-bold text-slate-400 border-t border-slate-100 pt-2">
                          <span>{(rule as any).usageCount} sales matched</span>
                          <span>{INR((rule as any).totalIncentivePaid || 0)} paid out</span>
                        </div>
                      )}
                    </div>

                    {isManager && (
                      <div className="px-5 pb-4 flex gap-2 border-t border-slate-50 pt-3">
                        <button onClick={() => openEdit(rule)}
                          className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
                          <i className="fas fa-pencil-alt text-[9px] mr-1"></i> Edit
                        </button>
                        {isAdmin && (
                          <button onClick={() => confirm('Delete this rule?') && store.deleteCommissionRule(rule.id)}
                            className="w-9 h-9 rounded-xl bg-rose-50 text-rose-400 hover:bg-rose-100 flex items-center justify-center">
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

      {/* ═══ SIMULATOR TAB ═══ */}
      {activeTab === 'simulator' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">
              Enter sale details → see exactly which rule fires and how much incentive is earned
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className={lbl}>Category</label>
                <select className={inp} value={simCat} onChange={e => setSimCat(e.target.value)}>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Executive (optional)</label>
                <select className={inp} value={simUser} onChange={e => setSimUser(e.target.value)}>
                  <option value="">Any executive</option>
                  {executives.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Selling Price (₹)</label>
                <input type="number" className={inp} placeholder="e.g. 550" value={simSell || ''} onChange={e => setSimSell(parseFloat(e.target.value || '0'))} />
              </div>
              <div>
                <label className={lbl}>Landed Cost (₹)</label>
                <input type="number" className={inp} placeholder="e.g. 380" value={simCost || ''} onChange={e => setSimCost(parseFloat(e.target.value || '0'))} />
              </div>
              <div>
                <label className={lbl}>Discount Applied (₹)</label>
                <input type="number" className={inp} placeholder="0" value={simDisc || ''} onChange={e => setSimDisc(parseFloat(e.target.value || '0'))} />
              </div>
            </div>
          </div>

          {simResult && (
            <div className={`rounded-[24px] p-6 space-y-5 ${simResult.incentive > 0 ? 'bg-emerald-900' : simResult.margin < 0 ? 'bg-rose-900' : 'bg-slate-800'} text-white`}>
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Live Simulation Result</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {[
                  { label: 'Net Selling',   val: INR(simResult.net),                    cls: 'text-white' },
                  { label: 'Landed Cost',   val: INR(simCost),                          cls: 'text-slate-300' },
                  { label: 'Profit',        val: INR(simResult.profit),                 cls: simResult.profit >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Margin %',      val: `${simResult.margin.toFixed(1)}%`,     cls: `font-black text-2xl ${pctColor(simResult.margin).replace('text-', 'text-').replace('600', '400')}` },
                  { label: 'Incentive',     val: INR(simResult.incentive),              cls: simResult.incentive > 0 ? 'text-amber-400 text-2xl font-black' : 'text-slate-500' },
                ].map(({ label, val, cls }) => (
                  <div key={label} className="bg-white/5 rounded-2xl p-3 text-center">
                    <div className="text-[7px] font-black text-slate-500 uppercase mb-0.5">{label}</div>
                    <div className={`font-black ${cls}`}>{val}</div>
                  </div>
                ))}
              </div>
              {simResult.incentive > 0 ? (
                <div className="bg-emerald-800/50 rounded-2xl px-4 py-3 space-y-1">
                  <div className="text-[9px] font-black text-emerald-300 uppercase">Rule Triggered: {simResult.ruleName}</div>
                  <div className="text-[10px] font-bold text-emerald-200">{simResult.basis}</div>
                </div>
              ) : simResult.margin < 0 ? (
                <div className="bg-rose-800/50 rounded-2xl px-4 py-3 text-[9px] font-black text-rose-300 uppercase">⛔ Negative margin — no incentive</div>
              ) : (
                <div className="bg-slate-700/50 rounded-2xl px-4 py-3 text-[9px] font-black text-slate-400 uppercase">No rule matched this margin / category combination</div>
              )}

              {/* Which rules were considered */}
              <div className="space-y-1.5">
                <div className="text-[8px] font-black text-slate-500 uppercase">Rules evaluated (in priority order)</div>
                {store.commissionRules.filter(r => r.isActive && (!r.targetCategory || r.targetCategory === simCat))
                  .sort((a, b) => ((b as any).priority || 1) - ((a as any).priority || 1))
                  .slice(0, 5).map(r => {
                    const matched = r.id === (store.commissionRules.find(x => x.title === simResult.ruleName)?.id);
                    return (
                      <div key={r.id} className={`flex justify-between items-center px-3 py-1.5 rounded-xl text-[9px] ${matched ? 'bg-emerald-700/50 text-emerald-300' : 'bg-white/5 text-slate-500'}`}>
                        <span className="font-bold">{r.title}</span>
                        <span className="font-black">{matched ? '✓ MATCHED' : 'skipped'}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
          {!simResult && (
            <div className="bg-slate-100 rounded-[24px] py-16 text-center text-slate-400 font-black uppercase">Enter selling price and cost to simulate</div>
          )}
        </div>
      )}

      {/* ═══ INCENTIVE ENTRIES LOG ═══ */}
      {activeTab === 'entries' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
              <label className="text-[8px] font-black text-slate-400 uppercase">Month</label>
              <input type="month" className="bg-transparent font-bold text-sm outline-none" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
            </div>
            <div className="flex-1">
              <select className="w-full sm:w-48 px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none" value={detailUser || ''} onChange={e => setDetailUser(e.target.value || null)}>
                <option value="">All Executives</option>
                {executives.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2">
              <div className="text-[8px] font-black text-emerald-500 uppercase">Total This Month</div>
              <div className="font-black text-emerald-700">{INR(totalAccrued)}</div>
            </div>
          </div>

          {(() => {
            const filtered = allEntries.filter((e: any) =>
              e.date?.startsWith(selectedMonth) && (!detailUser || e.userId === detailUser));
            if (!filtered.length) return <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center text-slate-300 font-black uppercase">No incentive entries for this period</div>;
            return (
              <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    {['Date','Executive','Invoice','Product','Sale Amt','Cost','Profit','Margin%','Rule','Incentive','Status'].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map((e: any) => (
                      <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-3 font-bold text-slate-400 whitespace-nowrap">{e.date}</td>
                        <td className="px-3 py-3 font-black text-slate-800">{e.userName}</td>
                        <td className="px-3 py-3 font-black text-blue-600">{e.invoiceNo}</td>
                        <td className="px-3 py-3 font-bold text-slate-700 max-w-[120px] truncate" title={e.productName}>{e.productName}</td>
                        <td className="px-3 py-3 font-bold text-slate-700">{INR(e.saleAmount)}</td>
                        <td className="px-3 py-3 font-bold text-slate-400">{INR(e.landedCost)}</td>
                        <td className={`px-3 py-3 font-black ${e.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{INR(e.profit)}</td>
                        <td className="px-3 py-3"><span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${pctBg(e.marginPct)}`}>{e.marginPct.toFixed(1)}%</span></td>
                        <td className="px-3 py-3 font-bold text-slate-500 max-w-[100px] truncate" title={e.ruleTitle}>{e.ruleTitle}</td>
                        <td className="px-3 py-3 font-black text-amber-600">{INR(e.incentiveAmount)}</td>
                        <td className="px-3 py-3"><span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${e.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{e.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-amber-50 border-t-2 border-amber-200">
                    <td colSpan={10} className="px-3 py-3 font-black text-slate-700 text-[9px] uppercase">Total incentive for period</td>
                    <td className="px-3 py-3 font-black text-amber-700 text-sm">{INR(filtered.reduce((s: number, e: any) => s + e.incentiveAmount, 0))}</td>
                  </tr></tfoot>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══ SLOW STOCK TAB ═══ */}
      {activeTab === 'slowstock' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 flex items-center gap-3">
              <label className="text-[8px] font-black text-slate-400 uppercase whitespace-nowrap">Unsold for ≥</label>
              <input type="number" min={30} className="w-20 bg-transparent font-black text-slate-800 text-lg outline-none" value={slowDays} onChange={e => setSlowDays(parseInt(e.target.value || '90'))} />
              <span className="text-[9px] font-black text-slate-400">days</span>
            </div>
            <div className={`rounded-2xl px-4 py-3 font-black ${slowMoving.length > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {slowMoving.length} slow-moving products
            </div>
            <button onClick={() => { setForm({ ...emptyForm(), type: 'SlowStock', title: `Slow Stock Booster >${slowDays}d`, minDaysInStock: slowDays, maxMarginForTrigger: 15, value: 2, tiers: [] }); setShowAdd(true); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-amber-700 transition-all">
              <i className="fas fa-plus text-xs"></i> Create Slow-Stock Incentive Rule
            </button>
          </div>

          {slowMoving.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center space-y-3">
              <i className="fas fa-check-circle text-4xl text-emerald-200"></i>
              <div className="font-black text-slate-400 uppercase">No slow-moving stock — all products are moving ✓</div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 border-b border-slate-100">
                  {['Product','Category','Brand','Stock','Cost/Unit','Stock Value','Last Sale','Days Stagnant','Action'].map(h => (
                    <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {slowMoving.map(p => {
                    const lastSale = store.sales.filter(s => s.status !== 'Deleted' && s.items.some(i => i.productId === p.id))
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
                    const ageDays = lastSale
                      ? Math.floor((Date.now() - new Date(lastSale.date).getTime()) / 86400000)
                      : p.purchaseHistory?.[0]?.date
                        ? Math.floor((Date.now() - new Date(p.purchaseHistory[0].date).getTime()) / 86400000)
                        : 999;
                    const stockVal = p.stockBoxes * (p.totalCostPerUnit || p.purchasePrice || 0);
                    const hasRule  = store.commissionRules.some(r => (r as any).type === 'SlowStock' && (!r.targetProductId || r.targetProductId === p.id) && (!r.targetCategory || r.targetCategory === p.category));
                    return (
                      <tr key={p.id} className={`hover:bg-slate-50 ${ageDays > 180 ? 'bg-rose-50/30' : ageDays > 90 ? 'bg-amber-50/20' : ''}`}>
                        <td className="px-3 py-3 font-black text-slate-800">{p.name}</td>
                        <td className="px-3 py-3"><span className="text-[8px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-black">{p.category}</span></td>
                        <td className="px-3 py-3 font-bold text-slate-500">{p.brand}</td>
                        <td className="px-3 py-3 font-black text-slate-700">{p.stockBoxes} {p.unitType}</td>
                        <td className="px-3 py-3 font-bold text-slate-600">{INR(p.totalCostPerUnit || p.purchasePrice || 0)}</td>
                        <td className="px-3 py-3 font-black text-rose-600">{INR(stockVal)}</td>
                        <td className="px-3 py-3 font-bold text-slate-400 whitespace-nowrap">{lastSale?.date || 'Never'}</td>
                        <td className="px-3 py-3">
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${ageDays > 180 ? 'bg-rose-100 text-rose-700' : ageDays > 90 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{ageDays}d</span>
                        </td>
                        <td className="px-3 py-3">
                          {hasRule ? (
                            <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">✓ Rule active</span>
                          ) : (
                            <button onClick={() => { setForm({ ...emptyForm(), type: 'SlowStock', title: `Slow Stock: ${p.name}`, targetProductId: p.id, targetCategory: p.category, minDaysInStock: slowDays, value: 2, tiers: [] }); setShowAdd(true); }}
                              className="text-[8px] font-black text-amber-600 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg transition-all">
                              + Add Rule
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ PAYROLL TAB ═══ */}
      {activeTab === 'payroll' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm flex flex-wrap items-center gap-4">
            <div>
              <label className={lbl}>Statement Month</label>
              <input type="month" className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-sm outline-none" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-center">
                <div className="text-[8px] font-black text-slate-400 uppercase">Statements</div>
                <div className="font-black text-slate-800">{currentMonthRecords.length}</div>
              </div>
              <div className="bg-amber-50 rounded-xl px-4 py-2.5 text-center">
                <div className="text-[8px] font-black text-amber-500 uppercase">Incentives Accrued</div>
                <div className="font-black text-amber-700">{INR(totalAccrued)}</div>
              </div>
              <div className="bg-emerald-50 rounded-xl px-4 py-2.5 text-center">
                <div className="text-[8px] font-black text-emerald-500 uppercase">Total Payable</div>
                <div className="font-black text-emerald-700">{INR(currentMonthRecords.reduce((s, r) => s + r.netPayable, 0))}</div>
              </div>
            </div>
            <button onClick={() => executives.forEach(e => store.generateMonthlyStatement(e.id, selectedMonth))}
              className="px-6 py-2.5 bg-slate-900 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-slate-700 transition-all">
              Initialize / Refresh Statements
            </button>
          </div>

          {currentMonthRecords.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[24px] py-20 text-center space-y-3">
              <i className="fas fa-file-invoice-dollar text-4xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase">No statements for {selectedMonth}</div>
              <p className="text-[10px] text-slate-300 max-w-xs mx-auto">Click "Initialize Statements" above to generate for all executives</p>
            </div>
          ) : (
            <div className="space-y-4">
              {currentMonthRecords.map(rec => {
                const incEntries = allEntries.filter((e: any) => e.userId === rec.userId && e.date?.startsWith(selectedMonth));
                const incTotal = incEntries.reduce((s: number, e: any) => s + e.incentiveAmount, 0);
                return (
                  <div key={rec.id} className="bg-white border border-slate-100 rounded-[24px] overflow-hidden shadow-sm hover:shadow-md transition-all">
                    <div className="flex flex-col lg:flex-row">
                      {/* Left */}
                      <div className="lg:w-64 bg-slate-900 p-6 text-white flex flex-col justify-between shrink-0">
                        <div>
                          <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-2xl font-black text-amber-400 mb-3">{rec.userName[0]}</div>
                          <div className="font-black text-lg tracking-tight">{rec.userName}</div>
                          <div className="text-[9px] text-slate-500 font-bold uppercase mt-0.5">{rec.month}</div>
                        </div>
                        <div className="mt-6 space-y-1">
                          <div className="text-[8px] font-black text-slate-500 uppercase">Balance Due</div>
                          <div className={`text-2xl font-black ${rec.balanceDue > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{INR(rec.balanceDue)}</div>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${payrollStatus(rec.status)}`}>{rec.status}</span>
                        </div>
                      </div>

                      {/* Right */}
                      <div className="flex-1 p-5 space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: 'Base Salary',  val: INR(rec.baseSalary),                                             cls: 'bg-slate-50 text-slate-800' },
                            { label: 'Incentives',   val: INR(rec.incentivesAccrued),                                      cls: 'bg-purple-50 text-purple-700' },
                            { label: 'Bonus/Exp',    val: INR(rec.bonus + rec.travelExpenses + rec.otherExpenses),         cls: 'bg-emerald-50 text-emerald-700' },
                            { label: 'Advances',     val: `- ${INR(rec.advancesDeducted)}`,                                cls: 'bg-rose-50 text-rose-700' },
                          ].map(({ label, val, cls }) => (
                            <div key={label} className={`${cls} rounded-2xl p-3 text-center border border-slate-100`}>
                              <div className="text-[7px] font-black uppercase mb-0.5 opacity-60">{label}</div>
                              <div className="font-black text-base">{val}</div>
                            </div>
                          ))}
                        </div>

                        {/* Incentive breakdown */}
                        {incEntries.length > 0 && (
                          <div className="bg-purple-50 rounded-2xl p-3 space-y-1.5">
                            <div className="text-[8px] font-black text-purple-500 uppercase tracking-widest">Incentive Breakdown ({incEntries.length} items · {INR(incTotal)})</div>
                            {incEntries.slice(0, 3).map((e: any) => (
                              <div key={e.id} className="flex justify-between text-[9px]">
                                <span className="font-bold text-slate-600 truncate flex-1">{e.productName} · {e.invoiceNo}</span>
                                <span className="font-black text-purple-700 ml-2">{INR(e.incentiveAmount)}</span>
                              </div>
                            ))}
                            {incEntries.length > 3 && <div className="text-[8px] text-purple-400 font-bold">+{incEntries.length - 3} more in Incentive Log tab</div>}
                          </div>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => { setShowAdjustModal(rec); setAdjustForm({ type: 'bonus', amount: 0 }); }}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:border-slate-400 transition-all">
                            <i className="fas fa-plus-circle text-emerald-500 text-xs"></i> Add Bonus
                          </button>
                          <button onClick={() => { setShowPayoutModal(rec); setPayoutForm({ amount: rec.balanceDue, remarks: '' }); }}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase hover:bg-slate-700 transition-all">
                            <i className="fas fa-receipt text-amber-400 text-xs"></i> Issue Payout
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ RULE BUILDER MODAL ═══ */}
      {showAdd && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
              <div>
                <div className="font-black text-xl">{editRule ? 'Edit Incentive Rule' : 'New Incentive Rule'}</div>
                <div className="text-[9px] text-slate-400 font-bold mt-0.5">Define when and how much to pay · rules auto-apply on every sale</div>
              </div>
              <button onClick={() => { setShowAdd(false); setEditRule(null); setForm(emptyForm()); }} className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              {/* Rule type selector */}
              <div>
                <label className={lbl}>Rule Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'Conditional', label: 'Margin Tiers', icon: 'fa-layer-group', desc: 'Different % based on margin achieved' },
                    { id: 'Percentage',  label: 'Flat %',       icon: 'fa-percent',     desc: 'Fixed % on net selling price' },
                    { id: 'Fixed',       label: 'Fixed ₹',      icon: 'fa-rupee-sign',  desc: 'Fixed rupee amount per sale item' },
                    { id: 'SlowStock',   label: 'Slow Stock',   icon: 'fa-box',         desc: 'Bonus for clearing aged inventory' },
                  ].map(t => (
                    <button key={t.id} onClick={() => setF('type', t.id)}
                      className={`p-3 rounded-2xl border-2 text-left transition-all ${form.type === t.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 bg-slate-50 hover:border-slate-300'}`}>
                      <i className={`fas ${t.icon} text-sm mb-1.5 ${form.type === t.id ? 'text-amber-400' : 'text-slate-400'}`}></i>
                      <div className="font-black text-[10px] uppercase">{t.label}</div>
                      <div className={`text-[8px] mt-0.5 ${form.type === t.id ? 'text-slate-400' : 'text-slate-400'}`}>{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Basic fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={lbl}>Rule Title</label>
                  <input className={inp} placeholder="e.g. High Margin Accelerator (≥20% margin)" value={form.title} onChange={e => setF('title', e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className={lbl}>Description (optional)</label>
                  <input className={inp} placeholder="Internal notes about this rule" value={form.description || ''} onChange={e => setF('description', e.target.value)} />
                </div>

                {/* Non-conditional: value field */}
                {(form.type === 'Percentage' || form.type === 'Fixed' || form.type === 'SlowStock') && (
                  <div>
                    <label className={lbl}>{form.type === 'Fixed' ? 'Amount (₹)' : 'Rate (%)'}</label>
                    <input type="number" className={inp} placeholder="e.g. 3" value={form.value || ''} onChange={e => setF('value', parseFloat(e.target.value || '0'))} />
                  </div>
                )}

                <div>
                  <label className={lbl}>Priority (higher = evaluated first)</label>
                  <input type="number" min={1} max={10} className={inp} value={form.priority || 1} onChange={e => setF('priority', parseInt(e.target.value || '1'))} />
                </div>
              </div>

              {/* Targeting */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={lbl}>Category (blank = all)</label>
                  <select className={inp} value={form.targetCategory || ''} onChange={e => setF('targetCategory', e.target.value)}>
                    <option value="">All Categories</option>
                    {categories.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Executive (blank = all)</label>
                  <select className={inp} value={form.targetUserId || ''} onChange={e => setF('targetUserId', e.target.value)}>
                    <option value="">All Executives</option>
                    {executives.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Specific Product (optional)</label>
                  <select className={inp} value={form.targetProductId || ''} onChange={e => setF('targetProductId', e.target.value)}>
                    <option value="">Any Product</option>
                    {store.products.slice(0, 100).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Effective From</label>
                  <input type="date" className={inp} value={form.startDate} onChange={e => setF('startDate', e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Expires On (blank = never)</label>
                  <input type="date" className={inp} value={form.expiryDate || ''} onChange={e => setF('expiryDate', e.target.value)} />
                </div>
              </div>

              {/* Slow stock specific */}
              {form.type === 'SlowStock' && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
                  <div className="text-[9px] font-black text-amber-600 uppercase">Slow Stock Trigger Conditions</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={lbl}>Trigger if unsold ≥ (days)</label>
                      <input type="number" className={inp} value={form.minDaysInStock || 90} onChange={e => setF('minDaysInStock', parseInt(e.target.value || '90'))} />
                    </div>
                    <div>
                      <label className={lbl}>Max margin for trigger (%) — e.g. 15 means only apply if margin ≤ 15%</label>
                      <input type="number" className={inp} value={form.maxMarginForTrigger || ''} onChange={e => setF('maxMarginForTrigger', parseFloat(e.target.value || '0'))} />
                    </div>
                  </div>
                </div>
              )}

              {/* Conditional tiers */}
              {form.type === 'Conditional' && (
                <div className="bg-slate-900 rounded-[24px] p-5 space-y-4 text-white">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-black text-base">Margin → Incentive Tiers</div>
                      <div className="text-[9px] text-slate-400 font-bold mt-0.5">
                        System picks the HIGHEST matching tier. Set 0% for "no incentive below X%".
                      </div>
                    </div>
                    <button onClick={() => setF('tiers', [...form.tiers, { minMargin: 0, commissionValue: 0, commissionType: 'Percentage' }])}
                      className="px-4 py-2 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-700">
                      + Add Tier
                    </button>
                  </div>
                  <div className="space-y-2">
                    {[...form.tiers].sort((a: any, b: any) => b.minMargin - a.minMargin).map((tier: any, idx: number) => (
                      <div key={idx} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex items-center gap-4">
                        <div className="flex-1">
                          <label className="text-[8px] font-black text-slate-500 uppercase block mb-1">If Margin ≥</label>
                          <div className="flex items-center gap-1.5">
                            <input type="number" className="w-20 bg-slate-950 text-white font-black text-lg px-3 py-2 rounded-xl border-0 outline-none" value={tier.minMargin}
                              onChange={e => {
                                const t = [...form.tiers];
                                const realIdx = form.tiers.indexOf(tier);
                                if (realIdx >= 0) t[realIdx] = { ...t[realIdx], minMargin: parseFloat(e.target.value || '0') };
                                setF('tiers', t);
                              }} />
                            <span className="text-slate-500 font-black">%</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <label className="text-[8px] font-black text-slate-500 uppercase block mb-1">Pay Incentive</label>
                          <div className="flex items-center gap-1.5">
                            <input type="number" className="w-20 bg-slate-950 text-emerald-400 font-black text-lg px-3 py-2 rounded-xl border-0 outline-none" value={tier.commissionValue}
                              onChange={e => {
                                const t = [...form.tiers]; const ri = form.tiers.indexOf(tier);
                                if (ri >= 0) t[ri] = { ...t[ri], commissionValue: parseFloat(e.target.value || '0') };
                                setF('tiers', t);
                              }} />
                            <select className="bg-slate-900 text-white font-black text-[10px] uppercase outline-none rounded-lg px-2 py-2 border border-white/10" value={tier.commissionType}
                              onChange={e => {
                                const t = [...form.tiers]; const ri = form.tiers.indexOf(tier);
                                if (ri >= 0) t[ri] = { ...t[ri], commissionType: e.target.value };
                                setF('tiers', t);
                              }}>
                              <option value="Percentage">% of sale</option>
                              <option value="Fixed">₹ fixed</option>
                            </select>
                          </div>
                        </div>
                        <button onClick={() => setF('tiers', form.tiers.filter((_: any, i: number) => form.tiers.indexOf(tier) !== i))}
                          className="text-white/20 hover:text-rose-400 transition-colors mt-4"><i className="fas fa-times"></i></button>
                      </div>
                    ))}
                    {form.tiers.length === 0 && (
                      <div className="text-center py-6 text-slate-600 font-bold text-sm">No tiers yet — click "+ Add Tier"</div>
                    )}
                  </div>

                  {/* Live example */}
                  {form.tiers.length > 0 && (
                    <div className="bg-white/5 rounded-2xl p-4">
                      <div className="text-[8px] font-black text-slate-500 uppercase mb-2">Example — ₹1000 sale at different margins</div>
                      <div className="grid grid-cols-3 gap-2 text-[9px]">
                        {[10, 15, 20, 25, 30].map(testMargin => {
                          const sorted = [...form.tiers].sort((a: any, b: any) => b.minMargin - a.minMargin);
                          const match = sorted.find((t: any) => testMargin >= t.minMargin);
                          const earn = match ? (match.commissionType === 'Percentage' ? (1000 * match.commissionValue) / 100 : match.commissionValue) : 0;
                          return (
                            <div key={testMargin} className={`text-center rounded-xl px-2 py-2 ${earn > 0 ? 'bg-emerald-900/50 text-emerald-300' : 'bg-slate-900/50 text-slate-500'}`}>
                              <div className="font-black">{testMargin}% margin</div>
                              <div className="text-[10px]">{earn > 0 ? `₹${earn} incentive` : 'No incentive'}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowAdd(false); setEditRule(null); setForm(emptyForm()); }}
                  className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200">Cancel</button>
                <button onClick={saveRule} disabled={!form.title}
                  className="flex-[2] py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all active:scale-95 disabled:opacity-40">
                  {editRule ? 'Update Rule' : 'Create Rule'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payout Modal */}
      {showPayoutModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
              <div>
                <div className="font-black text-lg">Issue Payout</div>
                <div className="text-[9px] text-slate-400 font-bold">{showPayoutModal.userName} · Balance {INR(showPayoutModal.balanceDue)}</div>
              </div>
              <button onClick={() => setShowPayoutModal(null)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={lbl}>Amount (₹)</label>
                <input type="number" autoFocus className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-200 rounded-2xl font-black text-2xl text-emerald-600 outline-none focus:border-slate-900"
                  value={payoutForm.amount || ''} onChange={e => setPayoutForm({ ...payoutForm, amount: parseFloat(e.target.value || '0') })} />
              </div>
              <div>
                <label className={lbl}>Reference / Remarks</label>
                <input className={inp} placeholder="Bank ref, UPI transaction ID…" value={payoutForm.remarks} onChange={e => setPayoutForm({ ...payoutForm, remarks: e.target.value })} />
              </div>
              <button onClick={() => { if (showPayoutModal && payoutForm.amount > 0) { store.recordPayrollPayment(showPayoutModal.id, payoutForm.amount, payoutForm.remarks); setShowPayoutModal(null); setPayoutForm({ amount: 0, remarks: '' }); } }}
                disabled={payoutForm.amount <= 0}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-700 transition-all disabled:opacity-40">
                Confirm {INR(payoutForm.amount)} Disbursement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjustment Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-emerald-800 text-white px-6 py-5 flex items-center justify-between">
              <div>
                <div className="font-black text-lg">Add Adjustment</div>
                <div className="text-[9px] text-emerald-300 font-bold">{showAdjustModal.userName}</div>
              </div>
              <button onClick={() => setShowAdjustModal(null)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={lbl}>Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['bonus','travel','other'] as const).map(t => (
                    <button key={t} onClick={() => setAdjustForm({ ...adjustForm, type: t })}
                      className={`py-2 rounded-xl font-black text-[9px] uppercase border-2 transition-all ${adjustForm.type === t ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                      {t === 'bonus' ? '🏆 Bonus' : t === 'travel' ? '✈ Travel' : '➕ Other'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>Amount (₹)</label>
                <input type="number" className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-200 rounded-2xl font-black text-2xl text-emerald-600 outline-none focus:border-emerald-500"
                  value={adjustForm.amount || ''} onChange={e => setAdjustForm({ ...adjustForm, amount: parseFloat(e.target.value || '0') })} />
              </div>
              <button onClick={() => { if (showAdjustModal && adjustForm.amount > 0) { store.addPayrollAdjustment(showAdjustModal.id, adjustForm.type, adjustForm.amount); setShowAdjustModal(null); setAdjustForm({ type: 'bonus', amount: 0 }); } }}
                disabled={adjustForm.amount <= 0}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-700 disabled:opacity-40">
                Apply Adjustment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommissionMaster;
