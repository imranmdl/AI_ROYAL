/**
 * SubscriptionManager.tsx
 * Super Admin panel to manage all tenant subscriptions.
 *
 * Tabs:
 *   Subscribers  — all tenants, subscription status, quick actions
 *   Plans        — plan definitions and feature matrix
 *   Payments     — payment history, mark paid, overdue alerts
 *   Tickets      — support tickets raised by tenants
 *   Analytics    — usage metrics per tenant
 */

import React, { useState, useEffect, useMemo } from 'react';
import { PLANS, FEATURES, PLAN_MAP, daysRemaining, makeSubscriptionToken } from '../subscription';
import type { Plan, PlanId, Subscription, PaymentRecord, SupportTicket } from '../types';

const BASE = window.location.origin;
const INR  = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const today = () => new Date().toISOString().split('T')[0];
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n*86400000).toISOString().split('T')[0];
const addMonths = (n: number) => {
  const d = new Date(); d.setMonth(d.getMonth() + n);
  return d.toISOString().split('T')[0];
};

interface Tenant { id: string; name: string; slug: string; owner_email: string; owner_phone: string; plan: string; status: string; created_at: number }
interface TenantWithSub extends Tenant { sub?: Subscription; metrics?: any }

interface Props { superKey: string; onClose?: () => void }

const SubscriptionManager: React.FC<Props> = ({ superKey, onClose }) => {
  const [tab,       setTab]       = useState<'subscribers'|'plans'|'payments'|'tickets'|'analytics'>('subscribers');
  const [tenants,   setTenants]   = useState<TenantWithSub[]>([]);
  const [payments,  setPayments]  = useState<PaymentRecord[]>(() => { try { return JSON.parse(localStorage.getItem('royal_payments')||'[]'); } catch { return []; } });
  const [tickets,   setTickets]   = useState<SupportTicket[]>(() => { try { return JSON.parse(localStorage.getItem('royal_tickets')||'[]'); } catch { return []; } });
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState<TenantWithSub | null>(null);
  const [showEdit,  setShowEdit]  = useState(false);
  const [showPay,   setShowPay]   = useState(false);
  const [showTicket,setShowTicket]= useState(false);
  const [msg,       setMsg]       = useState('');

  // ── Edit subscription form ──────────────────────────────────────────────────
  const [editPlan,  setEditPlan]  = useState<PlanId>('growth');
  const [editCycle, setEditCycle] = useState<'monthly'|'yearly'>('monthly');
  const [editEnd,   setEditEnd]   = useState(addMonths(1));
  const [editStatus,setEditStatus]= useState<Subscription['status']>('active');
  const [editPrice, setEditPrice] = useState(0);
  const [editNotes, setEditNotes] = useState('');
  const [editOverrides, setEditOverrides] = useState<Record<string,boolean>>({});

  // ── Payment form ────────────────────────────────────────────────────────────
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentRecord['method']>('upi');
  const [payRef,    setPayRef]    = useState('');
  const [payNotes,  setPayNotes]  = useState('');

  // ── Ticket form ─────────────────────────────────────────────────────────────
  const [tickSubject,  setTickSubject]  = useState('');
  const [tickDesc,     setTickDesc]     = useState('');
  const [tickCategory, setTickCategory]= useState<SupportTicket['category']>('general');
  const [tickPriority, setTickPriority]= useState<SupportTicket['priority']>('medium');

  const savePayments = (p: PaymentRecord[]) => { setPayments(p); localStorage.setItem('royal_payments', JSON.stringify(p)); };
  const saveTickets  = (t: SupportTicket[])  => { setTickets(t);  localStorage.setItem('royal_tickets',  JSON.stringify(t)); };

  // ── Load tenants ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${BASE}/api/superadmin/tenants`, { headers: { 'x-super-admin-key': superKey } })
      .then(r => r.json())
      .then(data => {
        // Load subscriptions from localStorage
        const subs: Record<string, Subscription> = {};
        try { Object.assign(subs, JSON.parse(localStorage.getItem('royal_subscriptions') || '{}')); } catch {}
        setTenants((data.tenants || []).map((t: Tenant) => ({
          ...t,
          sub: subs[t.id] || defaultSub(t.id, t.plan as PlanId || 'growth'),
        })));
      })
      .catch(() => setMsg('Could not load tenants'))
      .finally(() => setLoading(false));
  }, []);

  const saveSubs = (updated: TenantWithSub[]) => {
    const subs: Record<string, Subscription> = {};
    updated.forEach(t => { if (t.sub) subs[t.id] = t.sub; });
    localStorage.setItem('royal_subscriptions', JSON.stringify(subs));
    setTenants(updated);
  };

  const defaultSub = (tenantId: string, planId: PlanId = 'growth'): Subscription => ({
    tenantId, planId,
    status: 'trial',
    billingCycle: 'monthly',
    startDate: today(),
    endDate: addDays(today(), 14),
    trialEndsAt: addDays(today(), 14),
    featureOverrides: {},
    autoRenew: false,
  });

  // ── Open edit for tenant ────────────────────────────────────────────────────
  const openEdit = (t: TenantWithSub) => {
    setSelected(t);
    const sub = t.sub || defaultSub(t.id);
    setEditPlan(sub.planId);
    setEditCycle(sub.billingCycle);
    setEditEnd(sub.endDate);
    setEditStatus(sub.status);
    setEditPrice(sub.customPrice || PLAN_MAP[sub.planId]?.price || 0);
    setEditNotes(sub.notes || '');
    setEditOverrides({ ...sub.featureOverrides });
    setShowEdit(true);
  };

  const saveEdit = () => {
    if (!selected) return;
    const token = makeSubscriptionToken(selected.id, editPlan, editEnd);
    const newSub: Subscription = {
      tenantId: selected.id, planId: editPlan, status: editStatus,
      billingCycle: editCycle, startDate: today(), endDate: editEnd,
      featureOverrides: editOverrides, autoRenew: false,
      customPrice: editPrice !== PLAN_MAP[editPlan]?.price ? editPrice : undefined,
      notes: editNotes, token,
    };
    const updated = tenants.map(t => t.id === selected.id ? { ...t, sub: newSub } : t);
    saveSubs(updated);
    setSelected({ ...selected, sub: newSub });
    setShowEdit(false);
    setMsg(`✓ Subscription updated for ${selected.name}`);
    setTimeout(() => setMsg(''), 4000);
  };

  // ── Record payment ──────────────────────────────────────────────────────────
  const recordPayment = () => {
    if (!selected || !payAmount) return;
    const p: PaymentRecord = {
      id: `pay-${Date.now()}`, tenantId: selected.id, tenantName: selected.name,
      amount: payAmount, currency: 'INR', method: payMethod, reference: payRef,
      planId: selected.sub?.planId || 'growth',
      period: new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      date: today(), status: 'paid', notes: payNotes, recordedBy: 'Admin',
    };
    const updated = [p, ...payments];
    savePayments(updated);
    // Auto-extend subscription by 1 month
    if (selected.sub) {
      const newEnd = addMonths(editCycle === 'yearly' ? 12 : 1);
      const updatedSub = { ...selected.sub, status: 'active' as const, endDate: newEnd, lastPayment: p };
      saveSubs(tenants.map(t => t.id === selected.id ? { ...t, sub: updatedSub } : t));
    }
    setShowPay(false); setPayAmount(0); setPayRef(''); setPayNotes('');
    setMsg(`✓ Payment of ${INR(p.amount)} recorded for ${selected.name}`);
    setTimeout(() => setMsg(''), 4000);
  };

  // ── Raise ticket ────────────────────────────────────────────────────────────
  const raiseTicket = () => {
    if (!selected || !tickSubject) return;
    const t: SupportTicket = {
      id: `tick-${Date.now()}`, tenantId: selected.id, tenantName: selected.name,
      subject: tickSubject, description: tickDesc, category: tickCategory,
      priority: tickPriority, status: 'open',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      responses: [],
    };
    saveTickets([t, ...tickets]);
    setShowTicket(false); setTickSubject(''); setTickDesc('');
    setMsg(`✓ Ticket raised for ${selected.name}`);
    setTimeout(() => setMsg(''), 4000);
  };

  // ── Summary stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    tenants.length,
    active:   tenants.filter(t => t.sub?.status === 'active').length,
    trial:    tenants.filter(t => t.sub?.status === 'trial').length,
    expired:  tenants.filter(t => t.sub && daysRemaining(t.sub) <= 0 && t.sub.status !== 'active').length,
    mrr:      tenants.filter(t => t.sub?.status === 'active').reduce((s, t) => s + (t.sub?.customPrice || PLAN_MAP[t.sub?.planId||'classic']?.price || 0), 0),
    openTickets: tickets.filter(t => t.status === 'open').length,
  }), [tenants, tickets]);

  const statusColor: Record<string, string> = {
    active:    'bg-emerald-100 text-emerald-700',
    trial:     'bg-blue-100 text-blue-700',
    expired:   'bg-rose-100 text-rose-600',
    suspended: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-slate-100 text-slate-500',
  };
  const planColor: Record<PlanId, string> = {
    classic: 'bg-slate-100 text-slate-600',
    growth:  'bg-amber-100 text-amber-700',
    pro:     'bg-purple-100 text-purple-700',
  };

  const inp = "w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400 transition-all";
  const lbl = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ── */}
      <div className="bg-slate-900 text-white px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Royal ERP Platform</div>
            <h1 className="text-2xl font-black tracking-tight mt-0.5">Subscription Management</h1>
          </div>
          {onClose && (
            <button onClick={onClose} className="px-4 py-2 bg-white/10 rounded-xl font-black text-[9px] uppercase hover:bg-white/20">← Back</button>
          )}
        </div>
      </div>

      {/* ── KPI bar ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-6 gap-4">
          {[
            { label:'Total Shops',   value: stats.total,       color:'text-slate-900' },
            { label:'Active',        value: stats.active,      color:'text-emerald-600' },
            { label:'Trial',         value: stats.trial,       color:'text-blue-600' },
            { label:'Expired',       value: stats.expired,     color:'text-rose-600' },
            { label:'Monthly MRR',   value: INR(stats.mrr),   color:'text-amber-700' },
            { label:'Open Tickets',  value: stats.openTickets, color:'text-purple-600' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {msg && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2 text-emerald-700 font-bold text-sm text-center">{msg}</div>
      )}

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-7xl mx-auto flex gap-1">
          {([
            { id:'subscribers', label:'Subscribers', icon:'fa-users' },
            { id:'plans',       label:'Plans & Features', icon:'fa-layer-group' },
            { id:'payments',    label:'Payments', icon:'fa-rupee-sign' },
            { id:'tickets',     label:`Tickets${stats.openTickets>0?' ('+stats.openTickets+')':''}`, icon:'fa-ticket-alt' },
            { id:'analytics',   label:'Analytics', icon:'fa-chart-bar' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-4 py-3.5 font-black text-[9px] uppercase tracking-widest border-b-2 transition-all flex items-center gap-1.5 ${tab === t.id ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              <i className={`fas ${t.icon} text-[9px]`}></i>{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* ══════ SUBSCRIBERS TAB ══════ */}
        {tab === 'subscribers' && (
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-16"><div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div></div>
            ) : tenants.length === 0 ? (
              <div className="text-center py-16 text-slate-400 font-black">No shops registered yet</div>
            ) : tenants.map(t => {
              const sub     = t.sub;
              const plan    = sub ? PLAN_MAP[sub.planId] : null;
              const days    = sub ? daysRemaining(sub) : 0;
              const isWarn  = days <= 7 && days > 0;
              const isOver  = sub && new Date(sub.endDate) < new Date() && sub.status !== 'active';
              return (
                <div key={t.id} className={`bg-white rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-4 transition-all hover:shadow-md ${isWarn ? 'border-amber-200' : isOver ? 'border-rose-200' : 'border-slate-100'}`}>
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl shrink-0 ${plan ? '' : 'bg-slate-100 text-slate-400'}`}
                      style={plan ? { background: plan.color+'20', color: plan.color } : {}}>
                      {t.name[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-900">{t.name}</span>
                        {plan && <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${planColor[sub!.planId]}`}>{plan.name}</span>}
                        {sub && <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${statusColor[sub.status] || 'bg-slate-100 text-slate-500'}`}>{sub.status.toUpperCase()}</span>}
                        {isWarn && <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⚠ {days}d left</span>}
                        {isOver && <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-600">EXPIRED</span>}
                      </div>
                      <div className="text-[9px] text-slate-400 font-bold mt-0.5 flex gap-3 flex-wrap">
                        <span>📧 {t.owner_email}</span>
                        {t.owner_phone && <span>📞 {t.owner_phone}</span>}
                        {sub && <span>📅 Expires {sub.endDate}</span>}
                        {sub?.token && <span className="font-mono text-slate-500">{sub.token.slice(0,18)}…</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right mr-2">
                      <div className="font-black text-slate-900">{INR(sub?.customPrice || plan?.price || 0)}</div>
                      <div className="text-[8px] text-slate-400 font-bold">/month</div>
                    </div>
                    <button onClick={() => { setSelected(t); setShowPay(true); }}
                      className="px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl font-black text-[9px] uppercase hover:bg-emerald-100">
                      <i className="fas fa-rupee-sign text-[9px] mr-1"></i>Pay
                    </button>
                    <button onClick={() => openEdit(t)}
                      className="px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-black text-[9px] uppercase hover:bg-amber-100">
                      <i className="fas fa-cog text-[9px] mr-1"></i>Manage
                    </button>
                    <button onClick={() => { setSelected(t); setShowTicket(true); }}
                      className="px-3 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200">
                      <i className="fas fa-ticket-alt text-[9px] mr-1"></i>Ticket
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ══════ PLANS TAB ══════ */}
        {tab === 'plans' && (
          <div className="space-y-6">
            {/* Plan cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {PLANS.map(p => (
                <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="p-5 border-b border-slate-100" style={{ borderTop: `4px solid ${p.color}` }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-black text-slate-900 text-xl">{p.name}</div>
                        <div className="text-[10px] text-slate-400 font-bold mt-0.5">{p.tagline}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-2xl" style={{ color: p.color }}>{INR(p.price)}</div>
                        <div className="text-[8px] text-slate-400 font-bold">/month</div>
                        <div className="text-[8px] text-emerald-600 font-bold">{INR(p.yearlyPrice)}/yr (save {INR(p.price*12 - p.yearlyPrice)})</div>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-3 text-[9px] font-black text-slate-500">
                      <span>👥 {p.limits.users === -1 ? 'Unlimited' : p.limits.users} users</span>
                      <span>📦 {p.limits.products === -1 ? 'Unlimited' : p.limits.products} products</span>
                      <span>🏪 {p.limits.locations === -1 ? 'Unlimited' : p.limits.locations} locations</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="text-[8px] font-black text-slate-400 uppercase mb-2">{p.features.length} Features Included</div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {p.features.map(fid => {
                        const f = FEATURES.find(x => x.id === fid);
                        return f ? (
                          <div key={fid} className="flex items-center gap-2 text-[9px] text-slate-600 font-bold">
                            <i className="fas fa-check text-emerald-500 text-[8px] shrink-0"></i>{f.name}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Feature matrix */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 font-black text-slate-700">Feature Matrix</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[500px]">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-4 py-3 text-left font-black text-[9px] text-slate-500 uppercase w-48">Feature</th>
                      {PLANS.map(p => (
                        <th key={p.id} className="px-4 py-3 text-center font-black text-[9px] uppercase" style={{ color: p.color }}>{p.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {Object.entries(FEATURES.reduce((g, f) => { (g[f.category]=g[f.category]||[]).push(f); return g; }, {} as Record<string,PlanFeature[]>)).map(([cat, feats]) => (
                      <React.Fragment key={cat}>
                        <tr className="bg-slate-50"><td colSpan={4} className="px-4 py-1.5 font-black text-[8px] text-slate-400 uppercase tracking-widest">{cat}</td></tr>
                        {feats.map(f => (
                          <tr key={f.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5">
                              <div className="font-bold text-slate-700 text-[11px]">{f.name}</div>
                              <div className="text-[8px] text-slate-400">{f.description}</div>
                            </td>
                            {PLANS.map(p => (
                              <td key={p.id} className="px-4 py-2.5 text-center">
                                {p.features.includes(f.id)
                                  ? <i className="fas fa-check-circle text-emerald-500"></i>
                                  : <i className="fas fa-times-circle text-slate-200"></i>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══════ PAYMENTS TAB ══════ */}
        {tab === 'payments' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="font-black text-slate-700 text-lg">{payments.length} Payment Records</div>
              <div className="font-black text-emerald-700">{INR(payments.filter(p=>p.status==='paid').reduce((s,p)=>s+p.amount,0))} collected total</div>
            </div>
            {payments.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center text-slate-400 font-black">No payments recorded yet</div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-xs min-w-[600px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Date','Shop','Plan','Amount','Method','Reference','Period','Status'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-black text-[8px] text-slate-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {payments.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-600">{p.date}</td>
                        <td className="px-4 py-3 font-black text-slate-800">{p.tenantName}</td>
                        <td className="px-4 py-3"><span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${planColor[p.planId]}`}>{PLAN_MAP[p.planId]?.name}</span></td>
                        <td className="px-4 py-3 font-black text-emerald-700">{INR(p.amount)}</td>
                        <td className="px-4 py-3 font-bold text-slate-600 capitalize">{p.method}</td>
                        <td className="px-4 py-3 font-mono text-slate-500 text-[9px]">{p.reference || '—'}</td>
                        <td className="px-4 py-3 font-bold text-slate-600">{p.period}</td>
                        <td className="px-4 py-3"><span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${p.status==='paid'?'bg-emerald-100 text-emerald-700':p.status==='pending'?'bg-amber-100 text-amber-700':'bg-rose-100 text-rose-600'}`}>{p.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══════ TICKETS TAB ══════ */}
        {tab === 'tickets' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="font-black text-slate-700 text-lg">{tickets.filter(t=>t.status==='open').length} Open · {tickets.length} Total</div>
            </div>
            {tickets.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center text-slate-400 font-black">No tickets yet</div>
            ) : tickets.map(t => (
              <div key={t.id} className={`bg-white rounded-2xl border p-4 ${t.priority==='critical'?'border-rose-300':t.priority==='high'?'border-amber-200':'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-slate-900">{t.subject}</span>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${t.priority==='critical'?'bg-rose-100 text-rose-600':t.priority==='high'?'bg-amber-100 text-amber-700':t.priority==='medium'?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-500'}`}>{t.priority}</span>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${t.status==='open'?'bg-emerald-100 text-emerald-700':t.status==='resolved'?'bg-slate-100 text-slate-500':'bg-blue-100 text-blue-700'}`}>{t.status}</span>
                    </div>
                    <div className="text-[9px] text-slate-400 font-bold mt-1">{t.tenantName} · {t.category} · {new Date(t.createdAt).toLocaleDateString('en-IN')}</div>
                    {t.description && <div className="text-[10px] text-slate-600 font-bold mt-2">{t.description}</div>}
                  </div>
                  <div className="flex gap-2">
                    {t.status === 'open' && (
                      <button onClick={() => saveTickets(tickets.map(x => x.id===t.id ? {...x, status:'in_progress', updatedAt:new Date().toISOString()} : x))}
                        className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl font-black text-[9px] uppercase">In Progress</button>
                    )}
                    <button onClick={() => saveTickets(tickets.map(x => x.id===t.id ? {...x, status:'resolved', updatedAt:new Date().toISOString()} : x))}
                      className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl font-black text-[9px] uppercase">Resolve</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════ ANALYTICS TAB ══════ */}
        {tab === 'analytics' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {PLANS.map(p => {
                const count = tenants.filter(t => t.sub?.planId === p.id && t.sub?.status === 'active').length;
                const rev   = count * p.price;
                return (
                  <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm" style={{ borderTop: `3px solid ${p.color}` }}>
                    <div className="font-black text-slate-900 text-lg">{p.name}</div>
                    <div className="text-3xl font-black mt-1" style={{ color: p.color }}>{count}</div>
                    <div className="text-[9px] text-slate-400 font-bold">active subscribers</div>
                    <div className="font-black text-emerald-700 text-sm mt-2">{INR(rev)}/month MRR</div>
                  </div>
                );
              })}
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="font-black text-slate-700 mb-4">Subscription Status Overview</div>
              <div className="space-y-2">
                {Object.entries(
                  tenants.reduce((m, t) => { const s=t.sub?.status||'unknown'; m[s]=(m[s]||0)+1; return m; }, {} as Record<string,number>)
                ).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-3">
                    <div className="w-24 text-[9px] font-black text-slate-500 uppercase">{status}</div>
                    <div className="flex-1 bg-slate-100 rounded-full h-3">
                      <div className="h-3 rounded-full transition-all" style={{ width: `${(count/Math.max(tenants.length,1))*100}%`, background: status==='active'?'#10b981':status==='trial'?'#3b82f6':status==='expired'?'#ef4444':'#94a3b8' }}></div>
                    </div>
                    <div className="w-8 text-[9px] font-black text-slate-700 text-right">{count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════ EDIT SUBSCRIPTION MODAL ══════ */}
      {showEdit && selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="bg-slate-900 text-white px-6 py-4 rounded-t-[24px] flex items-center justify-between">
              <div>
                <div className="font-black text-lg">Manage Subscription</div>
                <div className="text-[9px] text-slate-400">{selected.name}</div>
              </div>
              <button onClick={() => setShowEdit(false)} className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">✕</button>
            </div>
            <div className="p-6 space-y-5">

              {/* Plan + Cycle */}
              <div className="grid grid-cols-3 gap-3">
                {PLANS.map(p => (
                  <button key={p.id} type="button" onClick={() => { setEditPlan(p.id); setEditPrice(p.price); }}
                    className={`border-2 rounded-xl p-3 text-left transition-all ${editPlan===p.id ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-amber-200'}`}>
                    <div className="font-black text-slate-900">{p.name}</div>
                    <div className="font-black text-amber-600">{INR(p.price)}/mo</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Status</label>
                  <select className={inp} value={editStatus} onChange={e => setEditStatus(e.target.value as any)}>
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Billing Cycle</label>
                  <select className={inp} value={editCycle} onChange={e => setEditCycle(e.target.value as any)}>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Subscription Ends</label>
                  <input type="date" className={inp} value={editEnd} onChange={e => setEditEnd(e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Custom Price / Month (₹)</label>
                  <input type="number" className={inp} value={editPrice} onChange={e => setEditPrice(parseFloat(e.target.value||'0'))} />
                  {editPrice !== (PLAN_MAP[editPlan]?.price||0) && <div className="text-[8px] text-amber-600 font-bold mt-0.5">Standard: {INR(PLAN_MAP[editPlan]?.price||0)}</div>}
                </div>
              </div>

              {/* Feature overrides */}
              <div>
                <label className={lbl}>Feature Overrides (per-tenant)</label>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-48 overflow-y-auto space-y-1">
                  {FEATURES.map(f => {
                    const planHas  = PLAN_MAP[editPlan]?.features.includes(f.id);
                    const override = editOverrides[f.id];
                    return (
                      <div key={f.id} className="flex items-center justify-between py-0.5">
                        <div>
                          <span className="text-[10px] font-bold text-slate-700">{f.name}</span>
                          {planHas && <span className="ml-1 text-[7px] text-emerald-500 font-black">in plan</span>}
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => setEditOverrides(o => { const n={...o}; delete n[f.id]; return n; })}
                            className={`px-1.5 py-0.5 text-[7px] font-black rounded ${override===undefined?'bg-slate-900 text-white':'bg-slate-100 text-slate-400'}`}>
                            Plan default
                          </button>
                          <button onClick={() => setEditOverrides(o => ({...o,[f.id]:true}))}
                            className={`px-1.5 py-0.5 text-[7px] font-black rounded ${override===true?'bg-emerald-600 text-white':'bg-slate-100 text-slate-400'}`}>
                            Force ON
                          </button>
                          <button onClick={() => setEditOverrides(o => ({...o,[f.id]:false}))}
                            className={`px-1.5 py-0.5 text-[7px] font-black rounded ${override===false?'bg-rose-600 text-white':'bg-slate-100 text-slate-400'}`}>
                            Force OFF
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className={lbl}>Admin Notes</label>
                <textarea className={`${inp} resize-none`} rows={2} value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Internal notes about this subscription…"/>
              </div>

              <div className="flex gap-3">
                <button onClick={saveEdit} className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all">Save Changes</button>
                <button onClick={() => setShowEdit(false)} className="px-5 py-3 bg-slate-100 text-slate-500 rounded-xl font-black text-[10px] uppercase">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════ RECORD PAYMENT MODAL ══════ */}
      {showPay && selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] w-full max-w-md shadow-2xl">
            <div className="bg-emerald-800 text-white px-6 py-4 rounded-t-[24px] flex items-center justify-between">
              <div>
                <div className="font-black">Record Payment</div>
                <div className="text-[9px] text-emerald-300">{selected.name}</div>
              </div>
              <button onClick={() => setShowPay(false)} className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={lbl}>Amount (₹)</label>
                <input type="number" className={inp} placeholder={String(selected.sub ? (selected.sub.customPrice || PLAN_MAP[selected.sub.planId]?.price || 0) : 0)}
                  value={payAmount || ''} onChange={e => setPayAmount(parseFloat(e.target.value||'0'))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Payment Method</label>
                  <select className={inp} value={payMethod} onChange={e => setPayMethod(e.target.value as any)}>
                    <option value="upi">UPI</option>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="online">Online</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Reference / UTR</label>
                  <input className={inp} placeholder="UPI ref or cheque no" value={payRef} onChange={e => setPayRef(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={lbl}>Notes</label>
                <input className={inp} placeholder="Optional note" value={payNotes} onChange={e => setPayNotes(e.target.value)} />
              </div>
              <button onClick={recordPayment} disabled={!payAmount}
                className="w-full py-3 bg-emerald-700 text-white rounded-xl font-black text-[10px] uppercase hover:bg-emerald-800 transition-all disabled:opacity-40">
                Record {payAmount ? INR(payAmount) : ''} Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ RAISE TICKET MODAL ══════ */}
      {showTicket && selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] w-full max-w-md shadow-2xl">
            <div className="bg-purple-800 text-white px-6 py-4 rounded-t-[24px] flex items-center justify-between">
              <div>
                <div className="font-black">Raise Support Ticket</div>
                <div className="text-[9px] text-purple-300">{selected.name}</div>
              </div>
              <button onClick={() => setShowTicket(false)} className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={lbl}>Subject</label>
                <input className={inp} placeholder="Brief description of the issue" value={tickSubject} onChange={e => setTickSubject(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Category</label>
                  <select className={inp} value={tickCategory} onChange={e => setTickCategory(e.target.value as any)}>
                    <option value="billing">Billing</option>
                    <option value="feature_request">Feature Request</option>
                    <option value="bug">Bug</option>
                    <option value="upgrade">Upgrade Request</option>
                    <option value="general">General</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Priority</label>
                  <select className={inp} value={tickPriority} onChange={e => setTickPriority(e.target.value as any)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={lbl}>Description</label>
                <textarea className={`${inp} resize-none`} rows={3} placeholder="Detailed description…" value={tickDesc} onChange={e => setTickDesc(e.target.value)} />
              </div>
              <button onClick={raiseTicket} disabled={!tickSubject}
                className="w-full py-3 bg-purple-700 text-white rounded-xl font-black text-[10px] uppercase hover:bg-purple-800 disabled:opacity-40 transition-all">
                Raise Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Feature gate component ─────────────────────────────────────────────────────
export const SubscriptionGate: React.FC<{
  feature:  string;
  sub?:     Subscription | null;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ feature, sub, children, fallback }) => {
  const { hasFeature: check } = require('../subscription');
  if (check(sub, feature)) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  const minPlan = minPlanForFeature(feature);
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 opacity-60">
      <i className="fas fa-lock text-4xl text-slate-300"></i>
      <div className="font-black text-slate-500">This feature requires {minPlan?.name || 'a higher plan'}</div>
      <div className="text-[9px] text-slate-400 font-bold">Contact your admin to upgrade</div>
    </div>
  );
};

function minPlanForFeature(fid: string): Plan | null {
  return PLANS.find(p => p.features.includes(fid)) || null;
}

export default SubscriptionManager;
