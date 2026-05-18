import React, { useState, useMemo, useEffect, useRef } from 'react';
import { store } from '../store';
import { Sale, Payment } from '../types';

// ── helpers ──────────────────────────────────────────────────────────────────
const INR = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const today = () => new Date().toISOString().split('T')[0];
const daysDiff = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
const dateLabel = (d: string) => {
  const diff = daysDiff(d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)  return `${diff}d ago`;
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

type Tab      = 'ledger' | 'custom' | 'reminders' | 'messages';
type PayMode  = 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'NEFT/RTGS';
type CustPane = 'timeline' | 'invoices' | 'payments' | 'custom';

const PAY_MODES: PayMode[] = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'NEFT/RTGS'];
const CC_CATS = ['Labor', 'Transport', 'Advance', 'Old Due', 'Adjustment', 'Material', 'Other'] as const;

// Pre-built WhatsApp message templates
const WA_TEMPLATES = [
  { id: 'gentle',  label: 'Gentle Reminder',   icon: 'fa-hand-wave',
    msg: (name: string, amt: string, shop: string) =>
      `Dear *${name}*,\n\nHope you are doing well!\n\nThis is a friendly reminder from *${shop}* regarding your outstanding balance of *${amt}*.\n\nRequest you to kindly clear this at your earliest convenience.\n\nThank you 🙏\n— ${shop}` },
  { id: 'urgent',  label: 'Urgent',             icon: 'fa-exclamation',
    msg: (name: string, amt: string, shop: string) =>
      `Dear *${name}*,\n\n⚠️ *Urgent Payment Reminder*\n\nYour outstanding balance of *${amt}* with *${shop}* is overdue.\n\nKindly clear this immediately to avoid any inconvenience.\n\nContact us: ${store.settings.showroomPhone || ''}\n— ${shop}` },
  { id: 'receipt', label: 'Payment Received',   icon: 'fa-check-circle',
    msg: (name: string, amt: string, shop: string, extra?: string) =>
      `Dear *${name}*,\n\n✅ *Payment Confirmed*\n\nWe have received *${amt}* from you. Thank you!\n${extra ? `\nRemaining balance: ${extra}\n` : '\nYour account is fully settled. ✓\n'}\nThank you for your business!\n— ${shop}` },
  { id: 'custom',  label: 'Custom Message',     icon: 'fa-edit', msg: () => '' },
];

const CreditManagement: React.FC = () => {
  const [ts, setTs] = useState(store.lastUpdated);
  useEffect(() => store.subscribe(() => setTs(store.lastUpdated)), []);

  const [activeTab, setActiveTab]   = useState<Tab>('ledger');
  const [search, setSearch]         = useState('');
  const [filterType, setFilterType] = useState<'all'|'outstanding'|'settled'>('outstanding');
  const [selectedCust, setSelectedCust] = useState<string | null>(null);
  const [custPane, setCustPane]     = useState<CustPane>('timeline');

  // Payment modal
  const [payModal, setPayModal]     = useState<{ sale?: Sale; bulk?: boolean } | null>(null);
  const [payAmount, setPayAmount]   = useState(0);
  const [payMode, setPayMode]       = useState<PayMode>('Cash');
  const [payRef, setPayRef]         = useState('');
  const [payRemarks, setPayRemarks] = useState('');

  // Custom credit modal
  const [showCC, setShowCC]         = useState(false);
  const [ccForm, setCCForm]         = useState({
    customerName: '', customerMobile: '', type: 'Debit' as 'Debit'|'Credit',
    amount: 0, date: today(), category: 'Other' as typeof CC_CATS[number], description: ''
  });

  // Settle custom
  const [settleCC, setSettleCC]     = useState<any | null>(null);
  const [settleAmt, setSettleAmt]   = useState(0);
  const [settleMode, setSettleMode] = useState<PayMode>('Cash');

  // Old balance import
  const [showOldBal, setShowOldBal] = useState(false);
  const [oldBalForm, setOldBalForm] = useState({ customerName: '', customerMobile: '', amount: 0, date: today(), notes: '', source: 'Old Balance' });

  // Receipt print
  const [printReceipt, setPrintReceipt] = useState<any | null>(null);

  // Aging view
  const [showAging, setShowAging]   = useState(false);

  // Custom bulk message text
  const [bulkCustomMsg, setBulkCustomMsg] = useState('');

  // Reminder modal
  const [showRem, setShowRem]       = useState(false);
  const [remForm, setRemForm]       = useState({
    customerName: '', customerMobile: '', amount: 0, dueDate: today(), notes: '', linkedInvoice: ''
  });

  // WhatsApp modal
  const [showWA, setShowWA]         = useState(false);
  const [waTarget, setWaTarget]     = useState<any | null>(null);
  const [waTpl, setWaTpl]           = useState('gentle');
  const [waMsg, setWaMsg]           = useState('');
  const [waExtra, setWaExtra]       = useState('');

  // ── Aggregations ─────────────────────────────────────────────────────────
  type CustAgg = {
    key: string; name: string; mobile: string; address: string;
    totalInvoiced: number; totalPaid: number; totalDue: number;
    invoiceCount: number; customDebit: number; customCredit: number;
    oldestDue: string; lastActivity: string; netDue: number;
  };

  const customerAggregates = useMemo<CustAgg[]>(() => {
    const map = new Map<string, CustAgg>();
    const ensure = (key: string, name: string, mobile: string, address: string): CustAgg => {
      if (!map.has(key)) map.set(key, { key, name, mobile, address, totalInvoiced: 0, totalPaid: 0, totalDue: 0, invoiceCount: 0, customDebit: 0, customCredit: 0, oldestDue: '', lastActivity: '', netDue: 0 });
      return map.get(key)!;
    };

    store.sales.filter(s => s.status !== 'Deleted').forEach(s => {
      const key = s.customerMobile || s.customerName;
      const c = ensure(key, s.customerName, s.customerMobile || '', s.customerAddress || '');
      c.totalInvoiced += s.totalAmount;
      c.totalPaid     += s.amountPaid;
      c.totalDue      += s.balance;
      c.invoiceCount  += 1;
      if (s.balance > 0 && (!c.oldestDue || s.date < c.oldestDue)) c.oldestDue = s.date;
      if (!c.lastActivity || s.date > c.lastActivity) c.lastActivity = s.date;
    });

    (store.customCredits || []).forEach((cc: any) => {
      const key = cc.customerMobile || cc.customerName;
      const c = ensure(key, cc.customerName, cc.customerMobile || '', '');
      const outstanding = cc.amount - (cc.amountSettled || 0);
      if (cc.type === 'Debit')  { c.customDebit  += outstanding; c.totalDue += outstanding; }
      else                       { c.customCredit += cc.amount; }
      if (!c.lastActivity || cc.date > c.lastActivity) c.lastActivity = cc.date;
    });

    (store.payments || []).forEach((p: any) => {
      const s = store.sales.find(x => x.id === p.saleId);
      if (!s) return;
      const key = s.customerMobile || s.customerName;
      const c = map.get(key);
      if (c && (!c.lastActivity || p.date > c.lastActivity)) c.lastActivity = p.date;
    });

    let list = Array.from(map.values()).map(c => ({ ...c, netDue: c.totalDue }));
    if (filterType === 'outstanding') list = list.filter(c => c.netDue > 0.01);
    if (filterType === 'settled')     list = list.filter(c => c.netDue <= 0 && (c.totalPaid > 0 || c.invoiceCount > 0));
    if (search) { const q = search.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(q) || c.mobile.includes(q)); }
    return list.sort((a, b) => b.netDue - a.netDue || b.lastActivity.localeCompare(a.lastActivity));
  }, [store.sales, store.customCredits, store.payments, search, filterType, ts]);

  const selCust     = useMemo(() => customerAggregates.find(c => c.key === selectedCust), [customerAggregates, selectedCust]);
  const custInvs    = useMemo(() => {
    if (!selectedCust) return [];
    return store.sales.filter(s => (s.customerMobile === selectedCust || s.customerName === selectedCust) && s.status !== 'Deleted').sort((a, b) => b.date.localeCompare(a.date));
  }, [selectedCust, store.sales, ts]);
  const custPays    = useMemo(() => {
    if (!selectedCust) return [];
    return (store.payments || []).filter((p: any) => {
      const s = store.sales.find(x => x.id === p.saleId);
      return s && (s.customerMobile === selectedCust || s.customerName === selectedCust);
    }).sort((a: any, b: any) => b.date.localeCompare(a.date));
  }, [selectedCust, store.payments, ts]);
  const custCC      = useMemo(() => {
    if (!selectedCust) return [];
    return (store.customCredits || []).filter((c: any) => c.customerMobile === selectedCust || c.customerName === selectedCust).sort((a: any, b: any) => b.date.localeCompare(a.date));
  }, [selectedCust, store.customCredits, ts]);

  // Combined timeline for a customer
  const custTimeline = useMemo(() => {
    const events: any[] = [];
    custInvs.forEach(s  => events.push({ type: 'invoice',  date: s.date, data: s }));
    custPays.forEach((p: any)  => events.push({ type: 'payment',  date: p.date, data: p }));
    custCC.forEach((c: any)    => events.push({ type: 'custom',   date: c.date, data: c }));
    // Also fetch reminders
    (store.paymentReminders || []).filter((r: any) => r.customerMobile === selectedCust || r.customerName === selectedCust)
      .forEach((r: any) => events.push({ type: 'reminder', date: r.dueDate, data: r }));
    return events.sort((a, b) => b.date.localeCompare(a.date));
  }, [custInvs, custPays, custCC, selectedCust, ts]);

  const pendingRems = useMemo(() => (store.paymentReminders || []).filter((r: any) => r.status === 'Pending').sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate)), [store.paymentReminders, ts]);
  const totalOutstanding = useMemo(() =>
    store.sales.filter(s => s.status !== 'Deleted').reduce((s, x) => s + x.balance, 0) +
    (store.customCredits || []).filter((c: any) => c.type === 'Debit' && c.status !== 'Settled').reduce((s: number, c: any) => s + (c.amount - (c.amountSettled || 0)), 0),
    [store.sales, store.customCredits, ts]);
  const overdueCount = useMemo(() => customerAggregates.filter(c => c.oldestDue && daysDiff(c.oldestDue) > 30 && c.netDue > 0).length, [customerAggregates]);

  const agingBuckets = useMemo(() => {
    const buckets = { current: 0, d30: 0, d60: 0, d90plus: 0 };
    customerAggregates.filter(c => c.netDue > 0).forEach(c => {
      const age = c.oldestDue ? daysDiff(c.oldestDue) : 0;
      if (age <= 30)  buckets.current += c.netDue;
      else if (age <= 60) buckets.d30  += c.netDue;
      else if (age <= 90) buckets.d60  += c.netDue;
      else                buckets.d90plus += c.netDue;
    });
    return buckets;
  }, [customerAggregates]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const recordPayment = () => {
    if (!payModal || payAmount <= 0) return;
    if (payModal.sale) {
      store.recordPayment({
        id: Date.now().toString(), saleId: payModal.sale.id, invoiceNo: payModal.sale.invoiceNo,
        customerName: payModal.sale.customerName, customerMobile: payModal.sale.customerMobile,
        amount: Math.min(payAmount, payModal.sale.balance), date: today(),
        paymentMode: payMode, referenceNo: payRef,
        remarks: payRemarks || `Payment: ${payModal.sale.invoiceNo}`,
      } as any);
    } else if (payModal.bulk && selCust) {
      store.recordConsolidatedPayment(selCust.mobile, selCust.name, payAmount, payMode, payRemarks);
    }
    setPayModal(null); setPayAmount(0); setPayRef(''); setPayRemarks('');
  };

  const openWA = (cust: CustAgg, tplId?: string) => {
    setWaTarget(cust);
    const id = tplId || 'gentle';
    setWaTpl(id);
    const tpl = WA_TEMPLATES.find(t => t.id === id);
    if (tpl && id !== 'custom') {
      setWaMsg(tpl.msg(cust.name, INR(cust.netDue), store.settings.showroomName, waExtra));
    } else {
      setWaMsg('');
    }
    setShowWA(true);
  };

  const sendWA = () => {
    if (!waTarget || !waMsg) return;
    const phone = `91${waTarget.mobile}`.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(waMsg)}`, '_blank');
    store.addActivityLog('Ledger', `WhatsApp sent to ${waTarget.name}`);
    setShowWA(false);
  };

  const inp = "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-blue-400 focus:bg-white transition-all";
  const lbl = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

  // ── Timeline event card ───────────────────────────────────────────────────
  const TimelineEvent = ({ ev }: { ev: any }) => {
    const { type, date, data } = ev;
    if (type === 'invoice') {
      const s: Sale = data;
      return (
        <div className={`flex gap-3 items-start group ${s.balance > 0 ? '' : 'opacity-70'}`}>
          <div className="flex flex-col items-center shrink-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm ${s.balance > 0 ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
              <i className="fas fa-file-invoice text-xs"></i>
            </div>
            <div className="w-px flex-1 bg-slate-100 mt-1 min-h-[12px]"></div>
          </div>
          <div className="flex-1 bg-white border border-slate-100 rounded-2xl p-4 mb-3 hover:shadow-md transition-all">
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="font-black text-slate-800 text-sm">{s.invoiceNo}</div>
                <div className="text-[9px] font-bold text-slate-400 mt-0.5">{dateLabel(date)}</div>
              </div>
              <div className="text-right">
                <div className="font-black text-slate-800">{INR(s.totalAmount)}</div>
                {s.balance > 0
                  ? <div className="text-[9px] font-black text-rose-500 mt-0.5">{INR(s.balance)} due</div>
                  : <div className="text-[9px] font-black text-emerald-600 mt-0.5">✓ Cleared</div>}
              </div>
            </div>
            {s.balance > 0 && (
              <div className="flex gap-2 mt-3 pt-2 border-t border-slate-50">
                <button onClick={() => { setPayModal({ sale: s }); setPayAmount(s.balance); }}
                  className="flex-1 py-2 bg-amber-100 text-amber-700 rounded-xl font-black text-[8px] uppercase hover:bg-amber-200 transition-all">
                  <i className="fas fa-money-bill-wave mr-1 text-[8px]"></i> Receive
                </button>
                <button onClick={() => {
                  const ovd = daysDiff(s.date) > 7;
                  setWaTpl(ovd ? 'urgent' : 'gentle');
                  const c = customerAggregates.find(x => x.key === selectedCust)!;
                  openWA(c, ovd ? 'urgent' : 'gentle');
                }} className="flex-1 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-black text-[8px] uppercase hover:bg-emerald-100 transition-all">
                  <i className="fab fa-whatsapp mr-1 text-[9px]"></i> Remind
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }
    if (type === 'payment') {
      const p: any = data;
      return (
        <div className="flex gap-3 items-start">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-black text-sm">
              <i className="fas fa-arrow-down text-xs"></i>
            </div>
            <div className="w-px flex-1 bg-slate-100 mt-1 min-h-[12px]"></div>
          </div>
          <div className="flex-1 bg-emerald-50 border border-emerald-100 rounded-2xl p-4 mb-3">
            <div className="flex justify-between">
              <div>
                <div className="font-black text-emerald-800 text-sm">Payment Received</div>
                <div className="text-[9px] font-bold text-emerald-600 mt-0.5">
                  {p.paymentMode} · {dateLabel(date)}
                  {p.invoiceNo && <span className="ml-2 text-emerald-500">vs {p.invoiceNo}</span>}
                  {p.referenceNo && <span className="ml-2 text-emerald-400">Ref: {p.referenceNo}</span>}
                </div>
                {p.remarks && <div className="text-[9px] text-emerald-500 italic mt-0.5">{p.remarks}</div>}
              </div>
              <div className="font-black text-emerald-700 text-lg">{INR(p.amount)}</div>
            </div>
          </div>
        </div>
      );
    }
    if (type === 'custom') {
      const cc: any = data;
      const outstanding = cc.amount - (cc.amountSettled || 0);
      return (
        <div className="flex gap-3 items-start">
          <div className="flex flex-col items-center shrink-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm ${cc.type === 'Debit' ? 'bg-orange-100 text-orange-600' : 'bg-teal-100 text-teal-600'}`}>
              <i className={`fas ${cc.type === 'Debit' ? 'fa-arrow-up' : 'fa-arrow-down'} text-xs`}></i>
            </div>
            <div className="w-px flex-1 bg-slate-100 mt-1 min-h-[12px]"></div>
          </div>
          <div className={`flex-1 border rounded-2xl p-4 mb-3 ${cc.type === 'Debit' ? 'bg-orange-50 border-orange-100' : 'bg-teal-50 border-teal-100'}`}>
            <div className="flex justify-between items-start">
              <div>
                <div className={`font-black text-sm ${cc.type === 'Debit' ? 'text-orange-800' : 'text-teal-800'}`}>{cc.description}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase ${cc.type === 'Debit' ? 'bg-orange-200 text-orange-700' : 'bg-teal-200 text-teal-700'}`}>{cc.category}</span>
                  <span className="text-[9px] font-bold text-slate-400">{dateLabel(date)}</span>
                  <span className={`text-[8px] font-black uppercase ${cc.status === 'Settled' ? 'text-emerald-600' : cc.status === 'Partial' ? 'text-amber-600' : 'text-rose-500'}`}>{cc.status}</span>
                </div>
              </div>
              <div className={`font-black text-base ${cc.type === 'Debit' ? 'text-orange-700' : 'text-teal-700'}`}>{INR(cc.amount)}</div>
            </div>
            {outstanding > 0 && cc.type === 'Debit' && cc.status !== 'Settled' && (
              <div className="flex gap-2 mt-2 pt-2 border-t border-orange-100">
                <div className="flex-1 text-[9px] font-bold text-orange-600">{INR(outstanding)} pending</div>
                <button onClick={() => { setSettleCC(cc); setSettleAmt(outstanding); }}
                  className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg font-black text-[8px] uppercase hover:bg-amber-200 transition-all">Settle</button>
              </div>
            )}
          </div>
        </div>
      );
    }
    if (type === 'reminder') {
      const r: any = data;
      const isOvd = r.dueDate < today();
      return (
        <div className="flex gap-3 items-start">
          <div className="flex flex-col items-center shrink-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOvd && r.status === 'Pending' ? 'bg-rose-100 text-rose-600 animate-pulse' : 'bg-amber-100 text-amber-600'}`}>
              <i className="fas fa-bell text-xs"></i>
            </div>
          </div>
          <div className={`flex-1 border rounded-2xl p-3 mb-3 ${isOvd && r.status === 'Pending' ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-100'}`}>
            <div className="flex justify-between items-center">
              <div>
                <div className="font-black text-sm text-slate-800">Reminder: {INR(r.amount)}</div>
                <div className="text-[9px] font-bold text-slate-400">Due {r.dueDate} · {r.notes}</div>
              </div>
              <span className={`text-[8px] font-black px-2 py-1 rounded-full ${r.status === 'Done' ? 'bg-emerald-100 text-emerald-700' : isOvd ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-700'}`}>
                {r.status === 'Done' ? '✓ Done' : isOvd ? '⚠ Overdue' : 'Pending'}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-5 pb-20">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Financial Ledger</h1>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Credit · Settlements · Reminders · Messages</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          {pendingRems.length > 0 && (
            <button onClick={() => setActiveTab('reminders')}
              className="flex items-center gap-2 px-4 py-2.5 bg-orange-100 text-orange-700 rounded-2xl font-black text-[9px] uppercase hover:bg-orange-200 transition-all animate-pulse">
              <i className="fas fa-bell text-xs"></i> {pendingRems.length} Reminder{pendingRems.length > 1 ? 's' : ''}
            </button>
          )}
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-100 text-rose-700 rounded-2xl font-black text-[9px] uppercase">
              <i className="fas fa-exclamation-triangle text-xs"></i> {overdueCount} Overdue
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <div className="bg-rose-50 border border-rose-200 px-5 py-3 rounded-2xl">
              <div className="text-[8px] font-black text-rose-400 uppercase tracking-widest">Total Outstanding</div>
              <div className="text-xl font-black text-rose-700">{INR(totalOutstanding)}</div>
            </div>
            <button onClick={() => setShowAging(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-2xl font-black text-[9px] uppercase hover:bg-indigo-100 transition-all">
              <i className="fas fa-chart-bar text-xs"></i> Aging
            </button>
            <button onClick={() => { setShowOldBal(true); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl font-black text-[9px] uppercase hover:bg-amber-100 transition-all">
              <i className="fas fa-history text-xs"></i> Old Balance
            </button>
          </div>
        </div>
      </div>

      {/* ── Tab nav ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {([
          { id: 'ledger' as Tab,    label: 'Credit Ledger',                                          icon: 'fa-book' },
          { id: 'custom' as Tab,    label: 'Custom Entries',                                         icon: 'fa-layer-group' },
          { id: 'reminders' as Tab, label: `Reminders${pendingRems.length ? ` (${pendingRems.length})` : ''}`, icon: 'fa-bell' },
          { id: 'messages' as Tab,  label: 'Bulk Messages',                                          icon: 'fa-comment-dots' },
        ]).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-black text-[9px] uppercase tracking-widest whitespace-nowrap transition-all flex-shrink-0
              ${activeTab === t.id ? 'bg-slate-900 text-white shadow' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <i className={`fas ${t.icon} text-[9px]`}></i> {t.label}
          </button>
        ))}
      </div>

      {/* ══════ LEDGER TAB ══════ */}
      {activeTab === 'ledger' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* Customer list */}
          <div className="lg:col-span-2 space-y-3">
            <div className="bg-white border border-slate-100 rounded-2xl p-3 space-y-2 shadow-sm">
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                <i className="fas fa-search text-slate-300 text-xs"></i>
                <input className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-600"
                  placeholder="Name or mobile…" value={search} onChange={e => setSearch(e.target.value)} />
                {search && <button onClick={() => setSearch('')} className="text-slate-300 hover:text-slate-500"><i className="fas fa-times text-xs"></i></button>}
              </div>
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                {([['outstanding','With Dues'],['settled','Settled'],['all','All']] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setFilterType(v)}
                    className={`flex-1 py-2 text-[8px] font-black rounded-lg uppercase transition-all
                      ${filterType === v ? (v === 'outstanding' ? 'bg-white text-rose-600 shadow' : v === 'settled' ? 'bg-white text-emerald-600 shadow' : 'bg-white text-slate-900 shadow') : 'text-slate-400 hover:text-slate-600'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
              <div className="max-h-[640px] overflow-y-auto divide-y divide-slate-50">
                {customerAggregates.length === 0 ? (
                  <div className="py-16 text-center space-y-2">
                    <i className="fas fa-check-circle text-3xl text-emerald-200"></i>
                    <div className="text-slate-300 font-black uppercase text-sm">Ledger Clean ✓</div>
                  </div>
                ) : customerAggregates.map(c => {
                  const ovd = c.oldestDue && daysDiff(c.oldestDue) > 30 && c.netDue > 0;
                  const isSel = selectedCust === c.key;
                  return (
                    <button key={c.key} onClick={() => { setSelectedCust(c.key); setCustPane('timeline'); }}
                      className={`w-full text-left px-4 py-4 transition-all hover:bg-slate-50 ${isSel ? 'bg-slate-900' : ''}`}>
                      <div className="flex justify-between items-center gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${isSel ? 'bg-amber-500 text-white' : c.netDue > 0 ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
                            {c.name[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className={`font-black text-sm truncate ${isSel ? 'text-white' : 'text-slate-800'}`}>{c.name}</div>
                            <div className={`text-[9px] font-bold mt-0.5 ${isSel ? 'text-slate-400' : 'text-slate-400'}`}>
                              {c.mobile && <span className="mr-2">{c.mobile}</span>}
                              {c.invoiceCount > 0 && <span>{c.invoiceCount} inv</span>}
                            </div>
                            {ovd && !isSel && (
                              <div className="text-[8px] font-black text-orange-500 mt-0.5 flex items-center gap-1">
                                <i className="fas fa-clock text-[7px]"></i> {daysDiff(c.oldestDue)}d overdue
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {c.netDue > 0.01 ? (
                            <div className={`font-black text-base ${isSel ? 'text-amber-400' : 'text-rose-600'}`}>{INR(c.netDue)}</div>
                          ) : (
                            <span className="text-[8px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✓ Clear</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-3">
            {!selectedCust || !selCust ? (
              <div className="h-full min-h-[400px] bg-white border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center p-10 space-y-3">
                <i className="fas fa-file-invoice-dollar text-5xl text-slate-200"></i>
                <div className="font-black text-slate-400 uppercase">Select a Customer</div>
                <div className="text-slate-300 text-sm max-w-xs">View full credit history, timeline, payments and reminders</div>
              </div>
            ) : (
              <div className="space-y-4">

                {/* Customer hero */}
                <div className="bg-slate-900 text-white rounded-2xl p-5 sm:p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/10 blur-3xl pointer-events-none"></div>
                  <div className="flex flex-col sm:flex-row justify-between gap-4">
                    <div>
                      <div className="text-xl sm:text-2xl font-black">{selCust.name}</div>
                      {selCust.mobile && <div className="text-slate-400 text-sm font-bold mt-0.5"><i className="fas fa-phone text-xs mr-1"></i>{selCust.mobile}</div>}
                      {selCust.address && <div className="text-slate-500 text-[10px] mt-0.5">{selCust.address}</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selCust.netDue > 0 && (
                        <button onClick={() => { setPayModal({ bulk: true }); setPayAmount(selCust.netDue); }}
                          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-600 transition-all active:scale-95">
                          <i className="fas fa-money-bill-wave text-xs"></i> Settle All
                        </button>
                      )}
                      {selCust.mobile && (
                        <button onClick={() => openWA(selCust)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all active:scale-95">
                          <i className="fab fa-whatsapp text-sm"></i> Message
                        </button>
                      )}
                      {selCust.mobile && (
                        <button onClick={() => { setRemForm(f => ({ ...f, customerName: selCust.name, customerMobile: selCust.mobile, amount: selCust.netDue })); setShowRem(true); }}
                          className="flex items-center gap-1.5 px-3 py-2 bg-orange-500 text-white rounded-xl font-black text-[9px] uppercase hover:bg-orange-600 transition-all active:scale-95">
                          <i className="fas fa-bell text-xs"></i> Remind
                        </button>
                      )}
                      {selCust.mobile && (
                        <a href={`tel:${selCust.mobile}`}
                          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-blue-700 transition-all active:scale-95">
                          <i className="fas fa-phone text-xs"></i> Call
                        </a>
                      )}
                      <button onClick={() => { setCCForm(f => ({ ...f, customerName: selCust.name, customerMobile: selCust.mobile })); setShowCC(true); }}
                        className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-indigo-700 transition-all active:scale-95">
                        <i className="fas fa-plus text-xs"></i> Entry
                      </button>
                    </div>
                  </div>

                  {/* KPI pills */}
                  <div className="grid grid-cols-3 gap-3 mt-5">
                    {[
                      { label: 'Total Invoiced', val: INR(selCust.totalInvoiced), cls: 'bg-white/5' },
                      { label: 'Total Received', val: INR(selCust.totalPaid),     cls: 'bg-emerald-500/20' },
                      { label: 'Balance Due',    val: INR(selCust.netDue),        cls: selCust.netDue > 0 ? 'bg-rose-500/20' : 'bg-emerald-500/10' },
                    ].map(({ label, val, cls }) => (
                      <div key={label} className={`${cls} rounded-xl px-3 py-2.5 text-center`}>
                        <div className="text-[7px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
                        <div className="text-base font-black text-white mt-0.5">{val}</div>
                      </div>
                    ))}
                  </div>

                  {(selCust.customDebit > 0 || selCust.customCredit > 0) && (
                    <div className="flex gap-3 mt-3">
                      {selCust.customDebit  > 0 && <div className="bg-orange-500/20 rounded-xl px-3 py-1.5 text-center"><div className="text-[7px] font-black text-orange-400 uppercase">Custom Debit</div><div className="text-sm font-black text-orange-300">{INR(selCust.customDebit)}</div></div>}
                      {selCust.customCredit > 0 && <div className="bg-teal-500/20 rounded-xl px-3 py-1.5 text-center"><div className="text-[7px] font-black text-teal-400 uppercase">Advance / Credit</div><div className="text-sm font-black text-teal-300">{INR(selCust.customCredit)}</div></div>}
                    </div>
                  )}
                </div>

                {/* Sub-tabs */}
                <div className="flex gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto">
                  {([
                    ['timeline', `Timeline (${custTimeline.length})`, 'fa-stream'],
                    ['invoices', `Invoices (${custInvs.length})`,    'fa-file-invoice'],
                    ['payments', `Payments (${custPays.length})`,    'fa-receipt'],
                    ['custom',   `Custom (${custCC.length})`,        'fa-layer-group'],
                  ] as const).map(([id, label, icon]) => (
                    <button key={id} onClick={() => setCustPane(id as CustPane)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-black text-[8px] uppercase whitespace-nowrap transition-all
                        ${custPane === id ? 'bg-white text-slate-900 shadow' : 'text-slate-400 hover:text-slate-600'}`}>
                      <i className={`fas ${icon} text-[8px]`}></i> {label}
                    </button>
                  ))}
                </div>

                {/* Timeline */}
                {custPane === 'timeline' && (
                  <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                    {custTimeline.length === 0
                      ? <div className="py-10 text-center text-slate-300 font-black uppercase">No activity</div>
                      : custTimeline.map((ev, i) => <TimelineEvent key={i} ev={ev} />)
                    }
                  </div>
                )}

                {/* Invoices */}
                {custPane === 'invoices' && (
                  <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                    {custInvs.length === 0
                      ? <div className="py-10 text-center text-slate-300 font-black uppercase">No invoices</div>
                      : <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead><tr className="bg-slate-50 border-b border-slate-100">
                              {['Invoice','Date','Total','Paid','Balance',''].map(h => <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>)}
                            </tr></thead>
                            <tbody className="divide-y divide-slate-50">
                              {custInvs.map(s => (
                                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-3 py-3 font-black text-blue-600 text-xs">{s.invoiceNo}</td>
                                  <td className="px-3 py-3 font-bold text-slate-400 text-xs whitespace-nowrap">{dateLabel(s.date)}</td>
                                  <td className="px-3 py-3 font-bold text-slate-600 text-xs">{INR(s.totalAmount)}</td>
                                  <td className="px-3 py-3 font-black text-emerald-600 text-xs">{INR(s.amountPaid)}</td>
                                  <td className={`px-3 py-3 font-black text-base ${s.balance > 0 ? 'text-rose-600' : 'text-slate-200'}`}>{s.balance > 0 ? INR(s.balance) : '—'}</td>
                                  <td className="px-3 py-3">
                                    {s.balance > 0
                                      ? <button onClick={() => { setPayModal({ sale: s }); setPayAmount(s.balance); }} className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg font-black text-[8px] uppercase hover:bg-amber-200 transition-all whitespace-nowrap">Receive</button>
                                      : <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">✓ Paid</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                    }
                  </div>
                )}

                {/* Payments */}
                {custPane === 'payments' && (
                  <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                    {custPays.length === 0
                      ? <div className="py-10 text-center text-slate-300 font-black uppercase">No payments recorded</div>
                      : <div className="divide-y divide-slate-50">
                          {custPays.map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between px-4 py-4 hover:bg-emerald-50/30">
                              <div>
                                <div className="font-black text-slate-800 text-sm flex items-center gap-2">
                                  <span className="text-[7px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">{p.paymentMode}</span>
                                  {p.invoiceNo}
                                </div>
                                <div className="text-[9px] text-slate-400 font-bold mt-0.5">
                                  {dateLabel(p.date)}{p.referenceNo && <span className="ml-2">Ref: {p.referenceNo}</span>}{p.remarks && <span className="ml-2 italic">{p.remarks}</span>}
                                </div>
                              </div>
                              <div className="font-black text-emerald-600 text-base">{INR(p.amount)}</div>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                )}

                {/* Custom */}
                {custPane === 'custom' && (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <button onClick={() => { setCCForm(f => ({ ...f, customerName: selCust.name, customerMobile: selCust.mobile })); setShowCC(true); }}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-indigo-700">
                        <i className="fas fa-plus text-xs"></i> Add Entry
                      </button>
                    </div>
                    {custCC.length === 0
                      ? <div className="bg-white border border-slate-100 rounded-2xl py-10 text-center text-slate-300 font-black uppercase">No custom entries</div>
                      : custCC.map((cc: any) => {
                          const outstanding = cc.amount - (cc.amountSettled || 0);
                          return (
                            <div key={cc.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center justify-between gap-3 hover:shadow-md transition-all">
                              <div className="flex items-start gap-3 flex-1 min-w-0">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${cc.type === 'Debit' ? 'bg-rose-100 text-rose-600' : 'bg-teal-100 text-teal-600'}`}>
                                  <i className={`fas ${cc.type === 'Debit' ? 'fa-arrow-up' : 'fa-arrow-down'} text-xs`}></i>
                                </div>
                                <div className="min-w-0">
                                  <div className="font-black text-slate-800 text-sm truncate">{cc.description}</div>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                    <span className="text-[7px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full uppercase">{cc.category}</span>
                                    <span className="text-[9px] font-bold text-slate-400">{dateLabel(cc.date)}</span>
                                    <span className={`text-[7px] font-black px-1.5 py-0.5 rounded-full uppercase ${cc.status === 'Settled' ? 'bg-emerald-100 text-emerald-700' : cc.status === 'Partial' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-600'}`}>{cc.status}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className={`font-black text-lg ${cc.type === 'Debit' ? 'text-rose-600' : 'text-teal-600'}`}>{INR(cc.amount)}</div>
                                {outstanding > 0 && cc.type === 'Debit' && cc.status !== 'Settled' && (
                                  <><div className="text-[9px] text-orange-500 font-bold">{INR(outstanding)} pending</div>
                                  <button onClick={() => { setSettleCC(cc); setSettleAmt(outstanding); }} className="text-[8px] font-black text-amber-600 hover:underline uppercase mt-0.5">Settle →</button></>
                                )}
                              </div>
                            </div>
                          );
                        })
                    }
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════ CUSTOM ENTRIES TAB ══════ */}
      {activeTab === 'custom' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
              {(store.customCredits || []).length} entries · labor, transport, old dues, advances
            </div>
            <button onClick={() => setShowCC(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-indigo-700 transition-all active:scale-95">
              <i className="fas fa-plus text-xs"></i> New Custom Entry
            </button>
          </div>

          {/* Category filter */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['All', ...CC_CATS].map(cat => (
              <button key={cat} onClick={() => {}} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-full font-black text-[9px] uppercase whitespace-nowrap hover:bg-slate-50 transition-all">
                {cat}
              </button>
            ))}
          </div>

          {(store.customCredits || []).length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-16 text-center space-y-3">
              <i className="fas fa-layer-group text-4xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase">No custom entries yet</div>
              <div className="text-slate-300 text-sm max-w-xs mx-auto">Labor charges, transport costs, old dues, advances — without needing an invoice</div>
            </div>
          ) : (
            <div className="space-y-2">
              {[...(store.customCredits || [])].sort((a: any, b: any) => b.date.localeCompare(a.date)).map((cc: any) => {
                const outstanding = cc.amount - (cc.amountSettled || 0);
                return (
                  <div key={cc.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center justify-between gap-4 hover:shadow-md transition-all group">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black ${cc.type === 'Debit' ? 'bg-rose-100 text-rose-600' : 'bg-teal-100 text-teal-600'}`}>
                        <i className={`fas ${cc.type === 'Debit' ? 'fa-arrow-up' : 'fa-arrow-down'} text-xs`}></i>
                      </div>
                      <div className="min-w-0">
                        <div className="font-black text-slate-800">{cc.description}</div>
                        <div className="text-[10px] font-bold text-slate-500 mt-0.5">{cc.customerName} · {cc.customerMobile}</div>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <span className="text-[7px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">{cc.category}</span>
                          <span className="text-[7px] font-bold bg-slate-50 text-slate-400 px-2 py-0.5 rounded-full">{dateLabel(cc.date)}</span>
                          <span className={`text-[7px] font-black px-2 py-0.5 rounded-full uppercase ${cc.status === 'Settled' ? 'bg-emerald-100 text-emerald-700' : cc.status === 'Partial' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-600'}`}>{cc.status}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-black text-xl ${cc.type === 'Debit' ? 'text-rose-600' : 'text-teal-600'}`}>{INR(cc.amount)}</div>
                      {outstanding > 0 && cc.type === 'Debit' && cc.status !== 'Settled' && (
                        <>
                          <div className="text-[9px] text-orange-500 font-bold">{INR(outstanding)} pending</div>
                          <button onClick={() => { setSettleCC(cc); setSettleAmt(outstanding); }}
                            className="mt-1 text-[8px] font-black text-amber-600 hover:underline uppercase">Settle →</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════ REMINDERS TAB ══════ */}
      {activeTab === 'reminders' && (
        <div className="space-y-5">
          <div className="flex justify-between items-center">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{pendingRems.length} pending · {(store.paymentReminders || []).length} total</div>
            <button onClick={() => setShowRem(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white rounded-xl font-black text-[9px] uppercase hover:bg-orange-600 transition-all active:scale-95">
              <i className="fas fa-bell text-xs"></i> Set Reminder
            </button>
          </div>

          {/* Overdue alert banner */}
          {pendingRems.filter((r: any) => r.dueDate < today()).length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl px-5 py-4 flex items-center gap-3">
              <i className="fas fa-exclamation-triangle text-rose-500 text-xl"></i>
              <div>
                <div className="font-black text-rose-700">{pendingRems.filter((r: any) => r.dueDate < today()).length} reminders overdue</div>
                <div className="text-[10px] text-rose-500 font-bold">Send WhatsApp messages immediately to recover outstanding dues</div>
              </div>
            </div>
          )}

          {(store.paymentReminders || []).length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-16 text-center space-y-3">
              <i className="fas fa-bell text-4xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase">No reminders set</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...(store.paymentReminders || [])].sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate)).map((r: any) => {
                const isOvd = r.dueDate < today() && r.status === 'Pending';
                const isDue = r.dueDate === today();
                return (
                  <div key={r.id} className={`bg-white border-2 rounded-2xl p-5 space-y-3 transition-all hover:shadow-md
                    ${isOvd ? 'border-rose-200 bg-rose-50/30' : isDue ? 'border-orange-200 bg-orange-50/30' : 'border-slate-100'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-slate-800">{r.customerName}</div>
                        {r.customerMobile && <div className="text-[10px] text-slate-400 font-bold mt-0.5"><i className="fas fa-phone text-[8px] mr-1"></i>{r.customerMobile}</div>}
                        {r.notes && <div className="text-[10px] text-slate-500 mt-1 italic">{r.notes}</div>}
                        {r.linkedInvoice && <div className="text-[9px] text-blue-500 font-black mt-0.5">Inv: {r.linkedInvoice}</div>}
                      </div>
                      <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase whitespace-nowrap shrink-0
                        ${r.status === 'Done' ? 'bg-emerald-100 text-emerald-700' : r.status === 'Sent' ? 'bg-blue-100 text-blue-700' : isOvd ? 'bg-rose-100 text-rose-600 animate-pulse' : isDue ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
                        {isOvd ? '⚠ Overdue' : isDue ? '🔔 Today' : r.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-[8px] text-slate-400 font-black uppercase">Due</div>
                        <div className="font-black text-slate-700">{r.dueDate}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[8px] text-slate-400 font-black uppercase">Amount</div>
                        <div className="font-black text-rose-600 text-xl">{INR(r.amount)}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1 border-t border-slate-100">
                      {r.status !== 'Done' && r.customerMobile && (
                        <button onClick={() => {
                          const cust = customerAggregates.find(c => c.mobile === r.customerMobile) || { name: r.customerName, mobile: r.customerMobile, netDue: r.amount, key: r.customerMobile };
                          openWA(cust as any, isOvd ? 'urgent' : 'gentle');
                          store.updateReminderStatus(r.id, 'Sent');
                        }} className="flex-1 py-2 bg-emerald-100 text-emerald-700 rounded-xl font-black text-[8px] uppercase hover:bg-emerald-200 transition-all">
                          <i className="fab fa-whatsapp mr-1 text-[10px]"></i> Send WA
                        </button>
                      )}
                      {r.status !== 'Done' && (
                        <button onClick={() => store.updateReminderStatus(r.id, 'Done')}
                          className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[8px] uppercase hover:bg-slate-200 transition-all">
                          ✓ Done
                        </button>
                      )}
                      {r.status === 'Done' && (
                        <div className="flex-1 py-2 text-center font-black text-[8px] text-emerald-600 uppercase">✓ Completed</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════ BULK MESSAGES TAB ══════ */}
      {activeTab === 'messages' && (
        <div className="space-y-5">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Send WhatsApp messages to all outstanding customers at once</div>

          {/* Template picker */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {WA_TEMPLATES.slice(0, 3).map(tpl => (
              <div key={tpl.id} className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 hover:shadow-md transition-all">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
                    <i className={`fas ${tpl.icon} text-sm`}></i>
                  </div>
                  <div className="font-black text-slate-800 text-sm">{tpl.label}</div>
                </div>
                <div className="text-[9px] text-slate-400 font-medium leading-relaxed line-clamp-3">
                  {tpl.msg('[Customer]', '[Amount]', store.settings.showroomName)}
                </div>
                <button onClick={() => {
                  const outstanding = customerAggregates.filter(c => c.netDue > 0 && c.mobile);
                  if (outstanding.length === 0) { alert('No outstanding customers with mobile numbers'); return; }
                  if (!confirm(`Send "${tpl.label}" message to ${outstanding.length} customers?`)) return;
                  outstanding.forEach(c => {
                    const msg = tpl.msg(c.name, INR(c.netDue), store.settings.showroomName);
                    const url = `https://wa.me/91${c.mobile.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
                    setTimeout(() => window.open(url, '_blank'), 800);
                  });
                  store.addActivityLog('Ledger', `Bulk ${tpl.label} sent to ${outstanding.length} customers`);
                }} className="w-full py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all active:scale-95">
                  <i className="fab fa-whatsapp mr-1.5"></i> Bulk Send ({customerAggregates.filter(c => c.netDue > 0 && c.mobile).length})
                </button>
              </div>
            ))}

            {/* Custom bulk message */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                  <i className="fas fa-edit text-sm"></i>
                </div>
                <div className="font-black text-slate-800 text-sm">Custom Bulk</div>
              </div>
              <textarea className="w-full px-3 py-2.5 bg-white border border-indigo-200 rounded-xl font-bold text-xs outline-none focus:border-indigo-400 h-20 resize-none"
                placeholder="Type message. Use [Name] and [Amount] as placeholders."
                value={bulkCustomMsg} onChange={e => setBulkCustomMsg(e.target.value)} />
              <button onClick={() => {
                if (!bulkCustomMsg.trim()) { alert('Enter a message first'); return; }
                const outstanding = customerAggregates.filter(c => c.netDue > 0 && c.mobile);
                if (!outstanding.length) { alert('No outstanding customers with mobile numbers'); return; }
                if (!confirm(`Send to ${outstanding.length} customers?`)) return;
                outstanding.forEach((c, idx) => {
                  const msg = bulkCustomMsg.replace(/\[Name\]/g, c.name).replace(/\[Amount\]/g, INR(c.netDue));
                  setTimeout(() => window.open(`https://wa.me/91${c.mobile.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank'), idx * 800);
                });
              }} disabled={!bulkCustomMsg.trim()} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-indigo-700 transition-all disabled:opacity-40">
                <i className="fab fa-whatsapp mr-1.5"></i> Send Custom ({customerAggregates.filter(c => c.netDue > 0 && c.mobile).length})
              </button>
            </div>
          </div>

          {/* Outstanding customer list with individual send */}
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
              <div className="font-black text-slate-800">Outstanding Accounts</div>
              <div className="text-[9px] font-bold text-slate-400">{customerAggregates.filter(c => c.netDue > 0).length} customers · {INR(totalOutstanding)} total</div>
            </div>
            <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
              {customerAggregates.filter(c => c.netDue > 0).map(c => (
                <div key={c.key} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors gap-3">
                  <div className="min-w-0">
                    <div className="font-black text-slate-800 text-sm">{c.name}</div>
                    <div className="text-[9px] text-slate-400 font-bold">{c.mobile}</div>
                    {c.oldestDue && daysDiff(c.oldestDue) > 30 && (
                      <div className="text-[8px] font-black text-orange-500">{daysDiff(c.oldestDue)}d overdue</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="font-black text-rose-600">{INR(c.netDue)}</div>
                    {c.mobile && (
                      <button onClick={() => openWA(c)}
                        className="w-9 h-9 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center hover:bg-emerald-200 transition-all">
                        <i className="fab fa-whatsapp text-sm"></i>
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {customerAggregates.filter(c => c.netDue > 0).length === 0 && (
                <div className="py-10 text-center text-slate-300 font-black uppercase">No outstanding accounts ✓</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════ MODALS ══════ */}

      {/* Payment modal */}
      {payModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-slate-900 text-white px-6 py-5 flex justify-between items-center">
              <div>
                <div className="font-black text-lg">{payModal.bulk ? 'Bulk Settlement' : 'Record Payment'}</div>
                <div className="text-[9px] text-slate-400 font-bold mt-0.5">{payModal.bulk ? selCust?.name : payModal.sale?.invoiceNo}</div>
              </div>
              <button onClick={() => setPayModal(null)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 flex justify-between items-center">
                <span className="text-[9px] font-black text-rose-400 uppercase">Outstanding</span>
                <span className="font-black text-rose-600 text-lg">{INR(payModal.bulk ? (selCust?.netDue || 0) : (payModal.sale?.balance || 0))}</span>
              </div>
              <div>
                <label className={lbl}>Amount Receiving (₹)</label>
                <input type="number" autoFocus className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-200 rounded-2xl font-black text-2xl text-emerald-600 outline-none focus:border-emerald-400"
                  value={payAmount || ''} onChange={e => {
                    const max = payModal.bulk ? (selCust?.netDue || 0) : (payModal.sale?.balance || 0);
                    setPayAmount(Math.min(parseFloat(e.target.value || '0'), max));
                  }} />
              </div>
              <div>
                <label className={lbl}>Payment Mode</label>
                <div className="flex flex-wrap gap-2">
                  {PAY_MODES.map(m => (
                    <button key={m} onClick={() => setPayMode(m)}
                      className={`px-3 py-2 rounded-xl font-black text-[9px] uppercase border-2 transition-all ${payMode === m ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>Reference / UPI ID</label>
                <input className={inp} placeholder="Ref no., UPI txn…" value={payRef} onChange={e => setPayRef(e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Remarks</label>
                <input className={inp} placeholder="Collection note…" value={payRemarks} onChange={e => setPayRemarks(e.target.value)} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => {
                    recordPayment();
                    // Prepare receipt for printing
                    if (payAmount > 0 && (payModal?.sale || selCust)) {
                      const receiptData = {
                        customerName: payModal?.sale?.customerName || selCust?.name,
                        customerMobile: payModal?.sale?.customerMobile || selCust?.mobile,
                        invoiceNo: payModal?.sale?.invoiceNo || 'Consolidated',
                        amount: payAmount,
                        mode: payMode,
                        ref: payRef,
                        remarks: payRemarks,
                        date: today(),
                        remaining: Math.max(0, (payModal?.bulk ? (selCust?.netDue || 0) : (payModal?.sale?.balance || 0)) - payAmount),
                      };
                      setTimeout(() => setPrintReceipt(receiptData), 300);
                    }
                  }} disabled={payAmount <= 0}
                  className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-40">
                  ✓ Confirm {INR(payAmount)} Received
                </button>
                {selCust?.mobile && (
                  <button onClick={() => {
                    const remaining = (payModal.bulk ? selCust.netDue : (payModal.sale?.balance || 0)) - payAmount;
                    const cust = selCust;
                    openWA(cust, 'receipt');
                    setWaMsg(WA_TEMPLATES[2].msg(cust.name, INR(payAmount), store.settings.showroomName, remaining > 0 ? INR(remaining) : ''));
                  }} className="px-4 py-4 bg-emerald-100 text-emerald-700 rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-200 transition-all">
                    <i className="fab fa-whatsapp text-sm"></i>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom credit modal */}
      {showCC && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="bg-indigo-900 text-white px-6 py-5 flex justify-between items-center shrink-0">
              <div>
                <div className="font-black text-lg">Custom Entry</div>
                <div className="text-[9px] text-indigo-300 font-bold mt-0.5">Labor · Transport · Old Due · Advance · No Invoice Needed</div>
              </div>
              <button onClick={() => setShowCC(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              <div className="flex gap-2">
                {(['Debit','Credit'] as const).map(t => (
                  <button key={t} onClick={() => setCCForm(f => ({ ...f, type: t }))}
                    className={`flex-1 py-3 rounded-xl font-black text-sm uppercase border-2 transition-all ${ccForm.type === t ? (t === 'Debit' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-teal-600 border-teal-600 text-white') : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    {t === 'Debit' ? '↑ Debit (owes us)' : '↓ Credit (we owe)'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Customer Name</label><input className={inp} placeholder="Name" value={ccForm.customerName} onChange={e => setCCForm(f => ({ ...f, customerName: e.target.value }))} /></div>
                <div><label className={lbl}>Mobile</label><input className={inp} placeholder="Mobile" value={ccForm.customerMobile} onChange={e => setCCForm(f => ({ ...f, customerMobile: e.target.value }))} /></div>
              </div>
              <div>
                <label className={lbl}>Category</label>
                <div className="flex flex-wrap gap-2">
                  {CC_CATS.map(cat => (
                    <button key={cat} onClick={() => setCCForm(f => ({ ...f, category: cat }))}
                      className={`px-3 py-1.5 rounded-lg font-black text-[9px] uppercase border-2 transition-all ${ccForm.category === cat ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>Description</label>
                <input className={inp} placeholder="e.g. Labor charges for flooring work at customer site" value={ccForm.description} onChange={e => setCCForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Amount (₹)</label><input type="number" className={inp} placeholder="0" value={ccForm.amount || ''} onChange={e => setCCForm(f => ({ ...f, amount: parseFloat(e.target.value || '0') }))} /></div>
                <div><label className={lbl}>Date</label><input type="date" className={inp} value={ccForm.date} onChange={e => setCCForm(f => ({ ...f, date: e.target.value }))} /></div>
              </div>
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-[9px] font-bold text-indigo-600 space-y-1">
                <div>• <strong>Debit</strong>: Customer owes you (labor, transport, old dues)</div>
                <div>• <strong>Credit</strong>: You owe customer (advance, overpayment)</div>
                <div>• No invoice needed — directly linked to customer ledger</div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 shrink-0">
              <button onClick={() => {
                if (!ccForm.customerName || !ccForm.description || !ccForm.amount) return;
                store.addCustomCredit(ccForm);
                setShowCC(false);
                setCCForm({ customerName: '', customerMobile: '', type: 'Debit', amount: 0, date: today(), category: 'Other', description: '' });
              }} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95">
                Save Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settle custom modal */}
      {settleCC && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="bg-amber-600 text-white px-6 py-5">
              <div className="font-black text-lg">Settle Entry</div>
              <div className="text-[9px] text-amber-200 mt-0.5">{settleCC.description}</div>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex justify-between">
                <span className="text-[9px] font-black text-amber-500 uppercase">Pending</span>
                <span className="font-black text-amber-700">{INR(settleCC.amount - (settleCC.amountSettled || 0))}</span>
              </div>
              <div>
                <label className={lbl}>Settle Amount (₹)</label>
                <input type="number" autoFocus className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-200 rounded-2xl font-black text-2xl text-emerald-600 outline-none focus:border-emerald-400"
                  value={settleAmt || ''} onChange={e => setSettleAmt(Math.min(parseFloat(e.target.value || '0'), settleCC.amount - (settleCC.amountSettled || 0)))} />
              </div>
              <div>
                <label className={lbl}>Payment Mode</label>
                <div className="flex flex-wrap gap-2">
                  {PAY_MODES.slice(0, 3).map(m => (
                    <button key={m} onClick={() => setSettleMode(m)}
                      className={`px-3 py-2 rounded-xl font-black text-[9px] uppercase border-2 transition-all ${settleMode === m ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-200 text-slate-500'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { store.settleCustomCredit(settleCC.id, settleAmt); setSettleCC(null); }}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-700">✓ Confirm</button>
                <button onClick={() => setSettleCC(null)}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reminder modal */}
      {showRem && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-orange-600 text-white px-6 py-5 flex justify-between items-center">
              <div className="font-black text-lg">Set Payment Reminder</div>
              <button onClick={() => setShowRem(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Customer Name</label><input className={inp} placeholder="Name" value={remForm.customerName} onChange={e => setRemForm(f => ({ ...f, customerName: e.target.value }))} /></div>
                <div><label className={lbl}>Mobile</label><input className={inp} placeholder="Mobile" value={remForm.customerMobile} onChange={e => setRemForm(f => ({ ...f, customerMobile: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Amount Due (₹)</label><input type="number" className={inp} value={remForm.amount || ''} onChange={e => setRemForm(f => ({ ...f, amount: parseFloat(e.target.value || '0') }))} /></div>
                <div><label className={lbl}>Due Date</label><input type="date" className={inp} value={remForm.dueDate} onChange={e => setRemForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
              </div>
              <div><label className={lbl}>Linked Invoice (optional)</label><input className={inp} placeholder="e.g. INV-2024-001" value={remForm.linkedInvoice} onChange={e => setRemForm(f => ({ ...f, linkedInvoice: e.target.value }))} /></div>
              <div><label className={lbl}>Notes</label><input className={inp} placeholder="e.g. Balance from tile order" value={remForm.notes} onChange={e => setRemForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-[9px] font-bold text-orange-600 space-y-1">
                <div>• Overdue reminders show a red alert and pulse notification</div>
                <div>• Send WhatsApp reminder directly from the reminder card</div>
                <div>• Link to a specific invoice for easy reference</div>
              </div>
              <button onClick={() => {
                if (!remForm.customerName || !remForm.amount) return;
                store.addReminder(remForm);
                setShowRem(false);
                setRemForm({ customerName: '', customerMobile: '', amount: 0, dueDate: today(), notes: '', linkedInvoice: '' });
              }} className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-700 transition-all active:scale-95">
                Set Reminder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp message composer */}
      {showWA && waTarget && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="bg-emerald-700 text-white px-6 py-5 flex justify-between items-center shrink-0">
              <div>
                <div className="font-black text-lg flex items-center gap-2"><i className="fab fa-whatsapp text-xl"></i> WhatsApp Message</div>
                <div className="text-[9px] text-emerald-200 font-bold mt-0.5">{waTarget.name} · {waTarget.mobile}</div>
              </div>
              <button onClick={() => setShowWA(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              {/* Template selector */}
              <div>
                <label className={lbl}>Message Template</label>
                <div className="flex flex-wrap gap-2">
                  {WA_TEMPLATES.map(tpl => (
                    <button key={tpl.id} onClick={() => {
                      setWaTpl(tpl.id);
                      if (tpl.id !== 'custom') setWaMsg(tpl.msg(waTarget.name, INR(waTarget.netDue), store.settings.showroomName, waExtra));
                      else setWaMsg('');
                    }} className={`px-3 py-1.5 rounded-lg font-black text-[9px] uppercase border-2 transition-all ${waTpl === tpl.id ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      <i className={`fas ${tpl.icon} text-[8px] mr-1`}></i>{tpl.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Message composer */}
              <div>
                <label className={lbl}>Message</label>
                <textarea className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-sm outline-none focus:border-emerald-400 focus:bg-white transition-all h-44 resize-none"
                  value={waMsg} onChange={e => setWaMsg(e.target.value)} />
                <div className="text-[8px] text-slate-400 font-bold mt-1">{waMsg.length} characters</div>
              </div>
              {/* WhatsApp preview bubble */}
              <div className="bg-[#ECE5DD] rounded-2xl p-4">
                <div className="text-[8px] font-black text-slate-500 uppercase mb-2">Preview</div>
                <div className="bg-white rounded-2xl rounded-tl-none p-3 shadow-sm max-w-xs">
                  <pre className="text-[10px] font-medium text-slate-800 whitespace-pre-wrap leading-relaxed">{waMsg || '(empty)'}</pre>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex gap-3">
              <button onClick={sendWA} disabled={!waMsg}
                className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2">
                <i className="fab fa-whatsapp text-base"></i> Open WhatsApp
              </button>
              <button onClick={() => setShowWA(false)}
                className="px-6 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200 transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ AGING REPORT MODAL ══════ */}
      {showAging && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="bg-indigo-900 text-white px-6 py-5 flex justify-between items-center shrink-0">
              <div>
                <div className="font-black text-lg">Aging Analysis</div>
                <div className="text-[9px] text-indigo-300 font-bold mt-0.5">Outstanding receivables by age bracket</div>
              </div>
              <button onClick={() => setShowAging(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              {/* Bucket summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: '0 – 30 days',  val: agingBuckets.current,  cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', icon: 'fa-check-circle' },
                  { label: '31 – 60 days', val: agingBuckets.d30,      cls: 'bg-amber-50 border-amber-200 text-amber-700',   icon: 'fa-clock' },
                  { label: '61 – 90 days', val: agingBuckets.d60,      cls: 'bg-orange-50 border-orange-200 text-orange-700', icon: 'fa-exclamation-circle' },
                  { label: '90+ days',     val: agingBuckets.d90plus,  cls: 'bg-rose-50 border-rose-200 text-rose-700',   icon: 'fa-fire' },
                ].map(({ label, val, cls, icon }) => (
                  <div key={label} className={`${cls} border-2 rounded-2xl p-4 text-center`}>
                    <i className={`fas ${icon} text-xl mb-2`}></i>
                    <div className="text-[8px] font-black uppercase tracking-widest mb-1 opacity-70">{label}</div>
                    <div className="text-xl font-black">{INR(val)}</div>
                  </div>
                ))}
              </div>

              {/* Customer aging table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    {['Customer','Mobile','Outstanding','Age (days)','Bracket','Action'].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {customerAggregates.filter(c => c.netDue > 0)
                      .map(c => {
                        const age = c.oldestDue ? daysDiff(c.oldestDue) : 0;
                        const bracket = age <= 30 ? { label: 'Current', cls: 'bg-emerald-100 text-emerald-700' } :
                                        age <= 60 ? { label: '31-60d',  cls: 'bg-amber-100 text-amber-700' } :
                                        age <= 90 ? { label: '61-90d',  cls: 'bg-orange-100 text-orange-700' } :
                                                    { label: '90+ ⚠',   cls: 'bg-rose-100 text-rose-700' };
                        return (
                          <tr key={c.key} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-3 font-black text-slate-800">{c.name}</td>
                            <td className="px-3 py-3 font-bold text-slate-400">{c.mobile}</td>
                            <td className="px-3 py-3 font-black text-rose-600">{INR(c.netDue)}</td>
                            <td className="px-3 py-3 font-black text-slate-700">{age}d</td>
                            <td className="px-3 py-3"><span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${bracket.cls}`}>{bracket.label}</span></td>
                            <td className="px-3 py-3">
                              {c.mobile && (
                                <button onClick={() => { openWA(c, age > 60 ? 'urgent' : 'gentle'); setShowAging(false); }}
                                  className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg font-black text-[8px] uppercase hover:bg-emerald-200">
                                  <i className="fab fa-whatsapp text-[10px] mr-1"></i>WA
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    {customerAggregates.filter(c => c.netDue > 0).length === 0 && (
                      <tr><td colSpan={6} className="py-10 text-center text-slate-300 font-black uppercase">No outstanding accounts ✓</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════ OLD BALANCE IMPORT MODAL ══════ */}
      {showOldBal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-amber-700 text-white px-6 py-5 flex justify-between items-center">
              <div>
                <div className="font-black text-lg">Old Balance Entry</div>
                <div className="text-[9px] text-amber-200 font-bold mt-0.5">For pre-existing dues not in this system</div>
              </div>
              <button onClick={() => setShowOldBal(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[9px] font-bold text-amber-700 space-y-1">
                <div>Use this to bring in old dues before you started using this system.</div>
                <div>These will appear as custom debit entries in the customer's ledger.</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Customer Name</label>
                  <input className={inp} placeholder="Name" value={oldBalForm.customerName}
                    onChange={e => setOldBalForm(f => ({ ...f, customerName: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Mobile</label>
                  <input className={inp} placeholder="Mobile" value={oldBalForm.customerMobile}
                    onChange={e => setOldBalForm(f => ({ ...f, customerMobile: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={lbl}>Outstanding Amount (₹)</label>
                <input type="number" className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-200 rounded-2xl font-black text-2xl text-rose-600 outline-none focus:border-amber-400"
                  placeholder="0" value={oldBalForm.amount || ''}
                  onChange={e => setOldBalForm(f => ({ ...f, amount: parseFloat(e.target.value || '0') }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>As of Date</label>
                  <input type="date" className={inp} value={oldBalForm.date}
                    onChange={e => setOldBalForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Source / Reference</label>
                  <input className={inp} placeholder="e.g. Old ledger" value={oldBalForm.source}
                    onChange={e => setOldBalForm(f => ({ ...f, source: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={lbl}>Notes</label>
                <input className={inp} placeholder="Invoice ref, old period, etc." value={oldBalForm.notes}
                  onChange={e => setOldBalForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <button
                onClick={() => {
                  if (!oldBalForm.customerName || !oldBalForm.amount) return;
                  store.addCustomCredit({
                    id: Date.now().toString(),
                    customerName: oldBalForm.customerName,
                    customerMobile: oldBalForm.customerMobile,
                    type: 'Debit',
                    category: 'Old Due',
                    amount: oldBalForm.amount,
                    date: oldBalForm.date,
                    description: `Opening Balance${oldBalForm.notes ? ': ' + oldBalForm.notes : ''} (${oldBalForm.source})`,
                    status: 'Pending',
                    amountSettled: 0,
                  } as any);
                  setShowOldBal(false);
                  setOldBalForm({ customerName: '', customerMobile: '', amount: 0, date: today(), notes: '', source: 'Old Balance' });
                }}
                disabled={!oldBalForm.customerName || !oldBalForm.amount}
                className="w-full py-4 bg-amber-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-700 transition-all active:scale-95 disabled:opacity-40">
                Import Old Balance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════ PAYMENT RECEIPT MODAL ══════ */}
      {printReceipt && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <style dangerouslySetInnerHTML={{ __html: `@media print { .no-print-receipt { display: none !important; } }` }} />
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95" id="payment-receipt">
            <div className="h-1.5 bg-emerald-600"></div>
            <div className="px-6 py-6 space-y-4 text-center">
              <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <i className="fas fa-check text-emerald-600 text-2xl"></i>
              </div>
              <div>
                <div className="font-black text-slate-900 text-xl">{store.settings.showroomName}</div>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Payment Receipt</div>
              </div>
              <div className="bg-emerald-50 rounded-2xl p-5">
                <div className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Amount Received</div>
                <div className="text-4xl font-black text-emerald-700 mt-1">{INR(printReceipt.amount)}</div>
              </div>
              <div className="text-left space-y-2 bg-slate-50 rounded-2xl p-4">
                {[
                  { label: 'Customer',  val: printReceipt.customerName },
                  { label: 'Mobile',    val: printReceipt.customerMobile },
                  { label: 'Invoice',   val: printReceipt.invoiceNo },
                  { label: 'Date',      val: printReceipt.date },
                  { label: 'Mode',      val: printReceipt.mode },
                  { label: 'Ref',       val: printReceipt.ref || '—' },
                  { label: 'Remarks',   val: printReceipt.remarks || '—' },
                  ...(printReceipt.remaining > 0 ? [{ label: 'Balance', val: INR(printReceipt.remaining) }] : [{ label: 'Status', val: 'Fully Settled ✓' }]),
                ].map(({ label, val }) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="font-bold text-slate-500">{label}</span>
                    <span className={`font-black ${label === 'Balance' ? 'text-rose-600' : label === 'Status' ? 'text-emerald-600' : 'text-slate-800'}`}>{val}</span>
                  </div>
                ))}
              </div>
              {printReceipt.remaining <= 0 && (
                <div className="text-emerald-600 font-black text-sm">Account fully settled. Thank you! 🙏</div>
              )}
              <div className="flex gap-2 no-print-receipt">
                <button onClick={() => window.print()}
                  className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase hover:bg-slate-700 transition-all">
                  <i className="fas fa-print mr-1"></i> Print
                </button>
                {printReceipt.customerMobile && (
                  <button onClick={() => {
                    const msg = `Dear *${printReceipt.customerName}*,\n\n✅ *Payment Received: ${INR(printReceipt.amount)}*\nDate: ${printReceipt.date} | Mode: ${printReceipt.mode}${printReceipt.ref ? ' | Ref: ' + printReceipt.ref : ''}\n${printReceipt.remaining > 0 ? `Balance Due: ${INR(printReceipt.remaining)}` : 'Your account is fully settled. ✓'}\n\nThank you! — ${store.settings.showroomName}`;
                    window.open(`https://wa.me/91${printReceipt.customerMobile.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank');
                  }} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all">
                    <i className="fab fa-whatsapp mr-1"></i> WhatsApp
                  </button>
                )}
                <button onClick={() => setPrintReceipt(null)} className="px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200">
                  Close
                </button>
              </div>
            </div>
            <div className="h-1.5 bg-emerald-600"></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreditManagement;
