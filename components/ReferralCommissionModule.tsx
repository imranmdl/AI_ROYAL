/**
 * ReferralCommissionModule.tsx
 * Manage referral agents (mestri, engineer, contractor, individual),
 * track commissions per invoice, and handle payouts with WhatsApp broadcast.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { store } from '../store';
import type { ReferralAgent, ReferralAgentType, ReferralCommissionEntry } from '../types';

const INR   = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const r2    = (n: number) => Math.round((n || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const inp   = "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all";
const lbl   = "text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";
const badge = (t: ReferralAgentType) => {
  const map: Record<string,string> = {
    Individual:'bg-blue-100 text-blue-700', Engineer:'bg-purple-100 text-purple-700',
    Contractor:'bg-amber-100 text-amber-700', Mestri:'bg-orange-100 text-orange-700',
    'Interior Designer':'bg-pink-100 text-pink-700', Other:'bg-slate-100 text-slate-600',
  };
  return map[t] || 'bg-slate-100 text-slate-600';
};

type Tab = 'agents' | 'commissions' | 'analytics' | 'whatsapp';

const ReferralCommissionModule: React.FC = () => {
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick(n => n + 1)), []);

  const agents = store.referralAgents || [];
  const commissions = store.referralCommissions || [];
  const sales = store.sales || [];

  const [tab, setTab]           = useState<Tab>('agents');
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [editAgent, setEditAgent]       = useState<ReferralAgent | null>(null);
  const [showPayModal, setShowPayModal] = useState<ReferralCommissionEntry | null>(null);
  const [filterAgent, setFilterAgent]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMonth, setFilterMonth]   = useState('');
  const [searchAgent, setSearchAgent]   = useState('');

  // ── Agent Form ─────────────────────────────────────────────────────────────
  const emptyAgent = () => ({ name:'', mobile:'', agentType:'Individual' as ReferralAgentType,
    defaultCommissionType:'Percentage' as const, defaultCommissionValue:0, notes:'', isActive:true });
  const [agentForm, setAgentForm] = useState<any>(emptyAgent());
  const setAF = (k: string, v: any) => setAgentForm((f:any) => ({ ...f, [k]: v }));

  const saveAgent = () => {
    if (!agentForm.name.trim() || !agentForm.mobile.trim()) return;
    if (editAgent) {
      store.updateReferralAgent(editAgent.id, agentForm);
    } else {
      store.addReferralAgent(agentForm);
    }
    setShowAddAgent(false); setEditAgent(null); setAgentForm(emptyAgent());
  };

  // ── Pay modal ──────────────────────────────────────────────────────────────
  const [payForm, setPayForm] = useState({ amount: 0, paymentMode: 'Cash', date: today(), notes: '' });

  const doPay = () => {
    if (!showPayModal || payForm.amount <= 0) return;
    store.payReferralCommission(showPayModal.id, payForm.amount, payForm.paymentMode, payForm.date, payForm.notes);
    setShowPayModal(null); setPayForm({ amount: 0, paymentMode: 'Cash', date: today(), notes: '' });
  };

  // ── Analytics ──────────────────────────────────────────────────────────────
  const agentSummary = useMemo(() => {
    return agents.map(a => {
      const entries = commissions.filter(c => c.agentId === a.id);
      const earned  = entries.reduce((s,e) => s + e.commissionAmount, 0);
      const paid    = entries.reduce((s,e) => s + (e.amountPaid||0), 0);
      const pending = entries.filter(e => e.status !== 'Paid').length;
      return { ...a, earned, paid, outstanding: earned - paid, pendingCount: pending, invoiceCount: entries.length };
    }).sort((a,b) => b.outstanding - a.outstanding);
  }, [agents, commissions]);

  const totalEarned  = useMemo(() => commissions.reduce((s,e)=>s+e.commissionAmount,0), [commissions]);
  const totalPaid    = useMemo(() => commissions.reduce((s,e)=>s+(e.amountPaid||0),0), [commissions]);
  const totalPending = totalEarned - totalPaid;

  // ── Filtered commissions ───────────────────────────────────────────────────
  const filteredCommissions = useMemo(() => commissions.filter(c => {
    if (filterAgent && c.agentId !== filterAgent) return false;
    if (filterStatus && c.status !== filterStatus) return false;
    if (filterMonth && !c.saleDate.startsWith(filterMonth)) return false;
    return true;
  }).sort((a,b) => b.saleDate.localeCompare(a.saleDate)), [commissions, filterAgent, filterStatus, filterMonth]);

  const filteredAgents = useMemo(() => agents.filter(a =>
    !searchAgent || a.name.toLowerCase().includes(searchAgent.toLowerCase()) || a.mobile.includes(searchAgent)
  ), [agents, searchAgent]);

  // ── WhatsApp broadcast ─────────────────────────────────────────────────────
  const [waMsg, setWaMsg] = useState(`🏠 *Royal Tiles — Special Offer*\n\nDear [Name], we have exciting items at great prices!\n\n📞 Contact us for details.\n\n_This message was sent to our valued referral partners._`);
  const [waFilter, setWaFilter] = useState<'all'|ReferralAgentType>('all');
  const waTargets = waFilter === 'all' ? agents.filter(a=>a.isActive) : agents.filter(a=>a.isActive && a.agentType === waFilter);

  const openWhatsApp = (mobile: string, name: string) => {
    const text = encodeURIComponent(waMsg.replace('[Name]', name));
    window.open(`https://wa.me/91${mobile.replace(/\D/g,'')}?text=${text}`, '_blank');
  };

  const TAB = (id: Tab, label: string, icon: string, count?: number) => (
    <button onClick={() => setTab(id)}
      className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black text-[10px] uppercase transition-all ${tab===id?'bg-slate-900 text-white shadow-lg':'text-slate-500 hover:bg-slate-100'}`}>
      <i className={`fas ${icon} text-xs`}></i>{label}
      {count !== undefined && count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${tab===id?'bg-white text-slate-900':'bg-rose-100 text-rose-600'}`}>{count}</span>}
    </button>
  );

  return (
    <div className="p-6 space-y-5">
      {/* ── Header + KPIs ── */}
      <div>
        <h2 className="text-2xl font-black uppercase italic tracking-tight">Referral Commission</h2>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
          Track commissions for mestri, engineers, contractors &amp; referral partners
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:'Total Agents', val: agents.length, sub: `${agents.filter(a=>a.isActive).length} active`, icon:'fa-users', color:'bg-blue-50 border-blue-100' },
          { label:'Total Earned', val: INR(totalEarned), sub:'all time', icon:'fa-hand-holding-usd', color:'bg-amber-50 border-amber-100' },
          { label:'Total Paid', val: INR(totalPaid), sub:'disbursed', icon:'fa-check-circle', color:'bg-emerald-50 border-emerald-100' },
          { label:'Pending', val: INR(totalPending), sub: `${commissions.filter(c=>c.status!=='Paid').length} invoices`, icon:'fa-clock', color:'bg-rose-50 border-rose-100' },
        ].map(k => (
          <div key={k.label} className={`${k.color} border rounded-2xl px-4 py-4`}>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5">
              <i className={`fas ${k.icon} text-[10px]`}></i>{k.label}
            </div>
            <div className="text-xl font-black text-slate-900">{k.val}</div>
            <div className="text-[9px] text-slate-500 font-bold mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex flex-wrap gap-2">
        {TAB('agents', 'Agents', 'fa-user-tag')}
        {TAB('commissions', 'Commissions', 'fa-file-invoice', commissions.filter(c=>c.status!=='Paid').length)}
        {TAB('analytics', 'Analytics', 'fa-chart-bar')}
        {TAB('whatsapp', 'WhatsApp Broadcast', 'fa-brands fa-whatsapp')}
      </div>

      {/* ══ AGENTS TAB ══════════════════════════════════════════════════════ */}
      {tab === 'agents' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <input className={inp + " max-w-xs"} placeholder="Search agent or mobile…"
              value={searchAgent} onChange={e=>setSearchAgent(e.target.value)} />
            <button onClick={() => { setEditAgent(null); setAgentForm(emptyAgent()); setShowAddAgent(true); }}
              className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-slate-800 transition-all flex items-center gap-2">
              <i className="fas fa-plus"></i> Add Agent
            </button>
          </div>

          {filteredAgents.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <i className="fas fa-user-tag text-4xl mb-3 block opacity-30"></i>
              <div className="font-black uppercase text-sm">No agents yet</div>
              <div className="text-xs mt-1">Add mestri, engineers, contractors or individuals who refer customers</div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAgents.map(a => {
                const summary = agentSummary.find(s => s.id === a.id);
                return (
                  <div key={a.id} className={`bg-white border rounded-2xl p-5 space-y-3 ${!a.isActive?'opacity-60':''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-black text-sm">{a.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">📱 {a.mobile}</div>
                      </div>
                      <span className={`px-2 py-1 rounded-xl text-[9px] font-black uppercase ${badge(a.agentType)}`}>{a.agentType}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-50 rounded-xl px-2 py-2 text-center">
                        <div className="text-[9px] text-slate-400 font-black uppercase">Earned</div>
                        <div className="font-black text-xs text-amber-600">{INR(summary?.earned||0)}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl px-2 py-2 text-center">
                        <div className="text-[9px] text-slate-400 font-black uppercase">Paid</div>
                        <div className="font-black text-xs text-emerald-600">{INR(summary?.paid||0)}</div>
                      </div>
                      <div className="bg-rose-50 rounded-xl px-2 py-2 text-center">
                        <div className="text-[9px] text-slate-400 font-black uppercase">Due</div>
                        <div className="font-black text-xs text-rose-600">{INR(summary?.outstanding||0)}</div>
                      </div>
                    </div>
                    <div className="text-[9px] text-slate-500 font-bold">
                      Default: {a.defaultCommissionType === 'Percentage' ? `${a.defaultCommissionValue}%` : INR(a.defaultCommissionValue)} · {summary?.invoiceCount||0} invoices
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openWhatsApp(a.mobile, a.name)}
                        className="flex-1 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-black text-[9px] uppercase hover:bg-emerald-100 transition-all flex items-center justify-center gap-1">
                        <i className="fab fa-whatsapp text-xs"></i> WhatsApp
                      </button>
                      <button onClick={() => { setEditAgent(a); setAgentForm({...a}); setShowAddAgent(true); }}
                        className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
                        Edit
                      </button>
                      <button onClick={() => { if (confirm(`Delete ${a.name}?`)) store.deleteReferralAgent(a.id); }}
                        className="py-2 px-3 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100 transition-all">
                        <i className="fas fa-trash text-xs"></i>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ COMMISSIONS TAB ══════════════════════════════════════════════════ */}
      {tab === 'commissions' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select className={inp + " w-auto"} value={filterAgent} onChange={e=>setFilterAgent(e.target.value)}>
              <option value="">All Agents</option>
              {agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className={inp + " w-auto"} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="">All Status</option>
              <option value="Pending">Pending</option>
              <option value="Partial">Partial</option>
              <option value="Paid">Paid</option>
            </select>
            <input type="month" className={inp + " w-auto"} value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} />
            <button onClick={()=>{setFilterAgent('');setFilterStatus('');setFilterMonth('');}} className="text-[10px] font-black text-slate-400 hover:text-slate-700 uppercase">Clear</button>
          </div>

          {/* Table */}
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    {['Date','Agent','Invoice','Customer','Sale Amt','Commission','Paid','Balance','Status','Action'].map(h=>(
                      <th key={h} className="px-4 py-3 text-left text-[9px] font-black text-slate-400 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredCommissions.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400 font-bold">No commission entries found</td></tr>
                  ) : filteredCommissions.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50 transition-all">
                      <td className="px-4 py-3 whitespace-nowrap">{c.saleDate}</td>
                      <td className="px-4 py-3">
                        <div className="font-bold">{c.agentName}</div>
                        <div className="text-[9px] text-slate-400">{c.agentMobile}</div>
                      </td>
                      <td className="px-4 py-3 font-black text-purple-600">{c.invoiceNo}</td>
                      <td className="px-4 py-3">{c.customerName}</td>
                      <td className="px-4 py-3 font-bold">{INR(c.saleAmountAfterDiscount)}</td>
                      <td className="px-4 py-3">
                        <div className="font-black text-amber-600">{INR(c.commissionAmount)}</div>
                        <div className="text-[9px] text-slate-400">{c.commissionType==='Percentage'?`${c.commissionValue}%`:`Fixed ${INR(c.commissionValue)}`}</div>
                      </td>
                      <td className="px-4 py-3 text-emerald-600 font-bold">{INR(c.amountPaid)}</td>
                      <td className="px-4 py-3 text-rose-600 font-bold">{INR(c.balance)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase ${c.status==='Paid'?'bg-emerald-100 text-emerald-700':c.status==='Partial'?'bg-amber-100 text-amber-700':'bg-rose-100 text-rose-600'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {c.status !== 'Paid' && (
                          <button onClick={() => { setShowPayModal(c); setPayForm({amount: c.balance, paymentMode:'Cash', date: today(), notes:''}); }}
                            className="px-3 py-1.5 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase hover:bg-slate-700 transition-all">
                            Pay
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {filteredCommissions.length > 0 && (
                  <tfoot className="bg-slate-50 border-t">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 font-black text-[10px] uppercase text-slate-500">Totals ({filteredCommissions.length} entries)</td>
                      <td className="px-4 py-3 font-black text-amber-600">{INR(filteredCommissions.reduce((s,c)=>s+c.commissionAmount,0))}</td>
                      <td className="px-4 py-3 font-black text-emerald-600">{INR(filteredCommissions.reduce((s,c)=>s+(c.amountPaid||0),0))}</td>
                      <td className="px-4 py-3 font-black text-rose-600">{INR(filteredCommissions.reduce((s,c)=>s+(c.balance||0),0))}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══ ANALYTICS TAB ════════════════════════════════════════════════════ */}
      {tab === 'analytics' && (
        <div className="space-y-5">
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b font-black text-sm">Agent-wise Commission Summary</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {['Agent','Type','Invoices','Total Earned','Total Paid','Outstanding','Default Rate'].map(h=>(
                      <th key={h} className="px-4 py-3 text-left text-[9px] font-black text-slate-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {agentSummary.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-bold">{a.name}</div>
                        <div className="text-[9px] text-slate-400">{a.mobile}</div>
                      </td>
                      <td className="px-4 py-3"><span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase ${badge(a.agentType)}`}>{a.agentType}</span></td>
                      <td className="px-4 py-3 font-black">{a.invoiceCount}</td>
                      <td className="px-4 py-3 font-black text-amber-600">{INR(a.earned)}</td>
                      <td className="px-4 py-3 font-black text-emerald-600">{INR(a.paid)}</td>
                      <td className="px-4 py-3 font-black text-rose-600">{a.outstanding > 0 ? INR(a.outstanding) : <span className="text-emerald-600">Cleared</span>}</td>
                      <td className="px-4 py-3 text-slate-600 font-bold">
                        {a.defaultCommissionType === 'Percentage' ? `${a.defaultCommissionValue}%` : INR(a.defaultCommissionValue)}
                      </td>
                    </tr>
                  ))}
                  {agentSummary.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No agents to analyze</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* P&L Impact */}
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">Total Commission Cost (P&amp;L Impact)</div>
              <div className="text-2xl font-black text-amber-700">{INR(totalEarned)}</div>
              <div className="text-[9px] text-amber-600 mt-1">Reduces net profit by this amount</div>
            </div>
            <div>
              <div className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">Commission as % of Total Sales</div>
              <div className="text-2xl font-black text-amber-700">
                {sales.length > 0 ? r2(totalEarned / sales.reduce((s,sale)=>s+sale.totalAmount,0) * 100).toFixed(1) : '0'}%
              </div>
              <div className="text-[9px] text-amber-600 mt-1">Of gross invoiced amount</div>
            </div>
            <div>
              <div className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">Outstanding Liability</div>
              <div className="text-2xl font-black text-rose-600">{INR(totalPending)}</div>
              <div className="text-[9px] text-amber-600 mt-1">Unpaid commission due to agents</div>
            </div>
          </div>
        </div>
      )}

      {/* ══ WHATSAPP BROADCAST TAB ══════════════════════════════════════════ */}
      {tab === 'whatsapp' && (
        <div className="space-y-5">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div>
                <label className={lbl}>Target Group</label>
                <div className="flex flex-wrap gap-2">
                  {(['all','Individual','Engineer','Contractor','Mestri','Interior Designer','Other'] as const).map(t => (
                    <button key={t} onClick={() => setWaFilter(t as any)}
                      className={`px-4 py-2 rounded-xl font-black text-[9px] uppercase transition-all ${waFilter===t?'bg-slate-900 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {t} {t==='all' ? `(${agents.filter(a=>a.isActive).length})` : `(${agents.filter(a=>a.isActive&&a.agentType===t).length})`}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>Message Template</label>
                <textarea rows={8} className={inp + " resize-none font-normal"} value={waMsg} onChange={e=>setWaMsg(e.target.value)} />
                <div className="text-[9px] text-slate-400 mt-1">Use <code>[Name]</code> to personalize per recipient</div>
              </div>
              <div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-700 text-[10px] font-bold">
                <i className="fab fa-whatsapp mr-1"></i>
                {waTargets.length} agent(s) will receive this message. Click their name below to send individually.
              </div>
            </div>
            <div className="space-y-3">
              <label className={lbl}>Recipients</label>
              {waTargets.length === 0 ? (
                <div className="text-slate-400 text-sm text-center py-10">No active agents in this group</div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {waTargets.map(a => (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-3 bg-white border rounded-2xl">
                      <div className="flex-1">
                        <div className="font-bold text-sm">{a.name}</div>
                        <div className="text-[9px] text-slate-400">{a.mobile} · {a.agentType}</div>
                      </div>
                      <button onClick={() => openWhatsApp(a.mobile, a.name)}
                        className="px-4 py-2 bg-emerald-500 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-600 transition-all flex items-center gap-1.5">
                        <i className="fab fa-whatsapp text-xs"></i> Send
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD/EDIT AGENT MODAL ════════════════════════════════════════════ */}
      {showAddAgent && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[600] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg p-8 space-y-5">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black uppercase italic">{editAgent ? 'Edit Agent' : 'Add Referral Agent'}</h3>
              <button onClick={()=>{setShowAddAgent(false);setEditAgent(null);}} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className={lbl}>Full Name *</label><input className={inp} value={agentForm.name} onChange={e=>setAF('name',e.target.value)} placeholder="e.g. Ravi Kumar" /></div>
              <div><label className={lbl}>Mobile *</label><input className={inp} value={agentForm.mobile} onChange={e=>setAF('mobile',e.target.value)} placeholder="9876543210" /></div>
              <div>
                <label className={lbl}>Agent Type</label>
                <select className={inp} value={agentForm.agentType} onChange={e=>setAF('agentType',e.target.value)}>
                  {(['Individual','Engineer','Contractor','Mestri','Interior Designer','Other'] as ReferralAgentType[]).map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Default Commission Type</label>
                <select className={inp} value={agentForm.defaultCommissionType} onChange={e=>setAF('defaultCommissionType',e.target.value)}>
                  <option value="Percentage">% of Sale (after discount)</option>
                  <option value="Fixed">Fixed Lump Sum (₹)</option>
                </select>
              </div>
              <div><label className={lbl}>{agentForm.defaultCommissionType==='Percentage'?'Default %':'Default ₹ Amount'}</label>
                <input type="number" className={inp} value={agentForm.defaultCommissionValue||''} onChange={e=>setAF('defaultCommissionValue',+e.target.value)} placeholder={agentForm.defaultCommissionType==='Percentage'?'e.g. 2':'e.g. 500'} />
              </div>
              <div className="col-span-2"><label className={lbl}>Notes (optional)</label><input className={inp} value={agentForm.notes||''} onChange={e=>setAF('notes',e.target.value)} placeholder="Role, area, etc." /></div>
              <div className="col-span-2 flex items-center gap-3">
                <input type="checkbox" checked={agentForm.isActive} onChange={e=>setAF('isActive',e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                <label className="text-sm font-bold text-slate-700">Active (receives commissions)</label>
              </div>
            </div>
            <button onClick={saveAgent} disabled={!agentForm.name.trim()||!agentForm.mobile.trim()}
              className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase disabled:opacity-40 hover:bg-slate-800 transition-all">
              {editAgent ? 'Update Agent' : 'Add Agent'}
            </button>
          </div>
        </div>
      )}

      {/* ══ PAY COMMISSION MODAL ════════════════════════════════════════════ */}
      {showPayModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[600] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-md p-8 space-y-5">
            <h3 className="text-xl font-black uppercase italic">Pay Commission</h3>
            <div className="bg-slate-50 rounded-2xl p-4 space-y-1 text-sm">
              <div className="font-black">{showPayModal.agentName}</div>
              <div className="text-slate-500">Invoice: <strong>{showPayModal.invoiceNo}</strong> · {showPayModal.customerName}</div>
              <div className="text-slate-500">Commission: <strong className="text-amber-600">{INR(showPayModal.commissionAmount)}</strong> · Paid so far: {INR(showPayModal.amountPaid)}</div>
              <div className="font-black text-rose-600">Balance: {INR(showPayModal.balance)}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className={lbl}>Amount to Pay (₹)</label>
                <input type="number" max={showPayModal.balance} className={inp} value={payForm.amount||''} onChange={e=>setPayForm(p=>({...p,amount:+e.target.value}))} />
              </div>
              <div><label className={lbl}>Payment Mode</label>
                <select className={inp} value={payForm.paymentMode} onChange={e=>setPayForm(p=>({...p,paymentMode:e.target.value}))}>
                  <option>Cash</option><option>UPI</option><option>Bank Transfer</option>
                </select>
              </div>
              <div><label className={lbl}>Date</label><input type="date" className={inp} value={payForm.date} onChange={e=>setPayForm(p=>({...p,date:e.target.value}))} /></div>
              <div className="col-span-2"><label className={lbl}>Notes</label><input className={inp} value={payForm.notes} onChange={e=>setPayForm(p=>({...p,notes:e.target.value}))} placeholder="Optional" /></div>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setShowPayModal(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl font-black text-[10px] uppercase text-slate-600 hover:bg-slate-200">Cancel</button>
              <button onClick={doPay} disabled={!payForm.amount||payForm.amount<=0}
                className="flex-1 py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase disabled:opacity-40 hover:bg-emerald-700">
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReferralCommissionModule;
