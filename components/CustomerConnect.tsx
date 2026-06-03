import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { store } from '../store';
import { Customer, CustomerType, LeadStatus, LeadSource, ProjectStage, TileCategory, AgentCommission } from '../types';

// ── Constants & helpers ───────────────────────────────────────────────────────
const INR   = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const today = () => new Date().toISOString().split('T')[0];
const r2    = (n: number) => Math.round(n * 100) / 100;

const TYPE_ICON: Record<string, string> = {
  'House Owner':      'fa-home',
  'Contractor':       'fa-hard-hat',
  'Engineer':         'fa-drafting-compass',
  'Architect':        'fa-ruler-combined',
  'Commission Agent': 'fa-handshake',
  'Dealer':           'fa-store',
  'Retail':           'fa-shopping-cart',
  'Interior Designer':'fa-paint-brush',
};
const TYPE_COLOR: Record<string, string> = {
  'House Owner':      'bg-sky-100 text-sky-700',
  'Contractor':       'bg-amber-100 text-amber-700',
  'Engineer':         'bg-violet-100 text-violet-700',
  'Architect':        'bg-purple-100 text-purple-700',
  'Commission Agent': 'bg-emerald-100 text-emerald-700',
  'Dealer':           'bg-cyan-100 text-cyan-700',
  'Retail':           'bg-slate-100 text-slate-600',
  'Interior Designer':'bg-pink-100 text-pink-700',
};
const STATUS_COLOR: Record<string, string> = {
  'New':            'bg-blue-100 text-blue-700 border-blue-200',
  'Follow-up':      'bg-amber-100 text-amber-700 border-amber-200',
  'In Discussion':  'bg-orange-100 text-orange-700 border-orange-200',
  'Quotation Sent': 'bg-purple-100 text-purple-700 border-purple-200',
  'Converted':      'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Lost':           'bg-rose-100 text-rose-600 border-rose-200',
};
const STATUS_DOT: Record<string, string> = {
  'New': 'bg-blue-500', 'Follow-up': 'bg-amber-500', 'In Discussion': 'bg-orange-500',
  'Quotation Sent': 'bg-purple-500', 'Converted': 'bg-emerald-500', 'Lost': 'bg-rose-500',
};
const STAGE_COLOR: Record<string, string> = {
  'Planning': 'bg-blue-50 text-blue-600',
  'Ongoing':  'bg-amber-50 text-amber-700',
  'Finishing':'bg-purple-50 text-purple-700',
  'Completed':'bg-emerald-50 text-emerald-700',
};
const SOURCE_ICON: Record<string, string> = {
  'WhatsApp':'fa-whatsapp', 'Walk-in':'fa-walking', 'Agent Referral':'fa-user-friends',
  'Phone':'fa-phone', 'Instagram':'fa-instagram', 'Gallery':'fa-images', 'Manual':'fa-keyboard',
};

const CUSTOMER_TYPES: CustomerType[] = ['House Owner','Contractor','Engineer','Architect','Commission Agent','Dealer','Retail','Interior Designer'];
const LEAD_STATUSES:  LeadStatus[]   = ['New','Follow-up','In Discussion','Quotation Sent','Converted','Lost'];
const LEAD_SOURCES:   LeadSource[]   = ['WhatsApp','Walk-in','Agent Referral','Phone','Instagram','Gallery','Manual'];
const TILE_CATS:      TileCategory[] = ['Floor','Wall','Premium','Budget','Granite','Kadapa','Sanitary'];
const MSG_CATS        = ['New Arrivals','Offers','Clearance Sale','Stock Update','Custom'] as const;

type Tab = 'dashboard' | 'leads' | 'broadcast' | 'stockpdf' | 'commission' | 'templates';

const emptyForm = (): Partial<Customer> => ({
  name: '', mobile: '', address: '', city: '', email: '', gst: '',
  type: 'House Owner', status: 'New', source: 'Manual',
  projectStage: 'Planning', preferredCategories: [],
  budgetMin: 0, budgetMax: 0, agentCommissionPct: 5,
  notes: '', tags: [], assignedTo: '', nextFollowUpDate: '',
});

const CustomerConnect: React.FC = () => {
  const [ts, setTs] = useState(store.lastUpdated);
  useEffect(() => store.subscribe(() => setTs(store.lastUpdated)), []);

  const [activeTab, setActiveTab]       = useState<Tab>('dashboard');
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [showForm, setShowForm]         = useState(false);
  const [editCust, setEditCust]         = useState<Customer | null>(null);
  const [form, setForm]                 = useState<Partial<Customer>>(emptyForm());
  const setF = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  // Filters
  const [search, setSearch]           = useState('');
  const [filterType, setFilterType]   = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterSource, setFilterSource] = useState('All');
  const [sortBy, setSortBy]           = useState<'recent'|'business'|'name'>('recent');

  // Interaction
  const [intType, setIntType]         = useState('Visit');
  const [intNotes, setIntNotes]       = useState('');
  const [intOutcome, setIntOutcome]   = useState('');

  // Broadcast
  const [broadMsg, setBroadMsg]             = useState('');
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  const [broadcastStep, setBroadcastStep]   = useState<number | null>(null);
  const [broadcastCat, setBroadcastCat]     = useState('All');
  const [broadcastTypeFilter, setBTF]       = useState('All');
  const [broadcastStatus, setBStatus]       = useState('All');
  const [scheduledTime, setScheduledTime]   = useState('');
  const [broadcastMsgCat, setBroadcastMsgCat] = useState<string>('Custom');
  const [previewMode, setPreviewMode]       = useState(false);

  // Commission
  const [showCommForm, setShowCommForm] = useState(false);
  const [commForm, setCommForm]         = useState({ agentId: '', saleAmount: 0, commissionPct: 5, invoiceNo: '', notes: '', date: today() });
  const [commFilter, setCommFilter]     = useState<'All'|'Pending'|'Paid'>('All');
  const [commSearch, setCommSearch]     = useState('');

  // Template
  const [showTmplForm, setShowTmplForm] = useState(false);
  const [tmplForm, setTmplForm]         = useState({ name: '', category: 'Custom' as any, body: '', triggerType: 'Manual' });
  const [tmplSearch, setTmplSearch]     = useState('');

  // Stock PDF
  const [pdfCatFilter, setPdfCatFilter]   = useState('All');
  const [pdfOnlyAvail, setPdfOnlyAvail]   = useState(true);
  const [pdfShowPrice, setPdfShowPrice]   = useState(true);
  const [pdfSizeFilter, setPdfSizeFilter] = useState('All');
  const [pdfViewMode, setPdfViewMode]     = useState<'cards'|'table'>('cards');
  const [pdfShowImages, setPdfShowImages] = useState(true);
  const [showWAContact, setShowWAContact] = useState(false);  // contact picker for WA send
  const [waSendLoading, setWaSendLoading] = useState(false);
  const stockPdfRef = useRef<HTMLDivElement>(null);

  // AI recommendations
  const [showAIRec, setShowAIRec]       = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────────
  const customers  = store.customers;
  const agents     = useMemo(() => customers.filter(c => c.type === 'Commission Agent'), [ts]);
  const templates  = useMemo(() => (store.settings as any).messageTemplates || [], [ts]);
  const categories = store.settings.categories || [];
  const executives = store.users;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = customers.filter(c =>
      (filterType   === 'All' || c.type   === filterType)   &&
      (filterStatus === 'All' || c.status === filterStatus) &&
      (filterSource === 'All' || c.source === filterSource) &&
      (!q || c.name.toLowerCase().includes(q) || c.mobile.includes(q) || (c.city||'').toLowerCase().includes(q))
    );
    if (sortBy === 'business') list = [...list].sort((a,b) => (b.totalBusiness||0) - (a.totalBusiness||0));
    else if (sortBy === 'name') list = [...list].sort((a,b) => a.name.localeCompare(b.name));
    else list = [...list].sort((a,b) => {
      const aDate = a.interactions?.slice(-1)[0]?.date || '2000';
      const bDate = b.interactions?.slice(-1)[0]?.date || '2000';
      return bDate.localeCompare(aDate);
    });
    return list;
  }, [customers, search, filterType, filterStatus, filterSource, sortBy, ts]);

  // Broadcast pool
  const broadcastPool = useMemo(() => filtered.filter(c =>
    (broadcastTypeFilter === 'All' || c.type === broadcastTypeFilter) &&
    (broadcastStatus === 'All' || c.status === broadcastStatus) &&
    (broadcastCat === 'All' || (c.preferredCategories||[]).includes(broadcastCat as TileCategory))
  ), [filtered, broadcastTypeFilter, broadcastStatus, broadcastCat]);

  // Dashboard
  const dash = useMemo(() => {
    const total      = customers.length;
    const converted  = customers.filter(c => c.status === 'Converted').length;
    const conversion = total > 0 ? r2((converted / total) * 100) : 0;
    const followup   = customers.filter(c => c.nextFollowUpDate && c.nextFollowUpDate <= today() && c.status !== 'Converted' && c.status !== 'Lost').length;
    const topCusts   = [...customers].filter(c => c.totalBusiness > 0).sort((a,b) => b.totalBusiness - a.totalBusiness).slice(0,5);
    const topAgents  = agents.map(a => ({ a, total: (a.agentCommissions||[]).reduce((s:number,ac:any)=>s+ac.commissionValue,0) })).filter(x=>x.total>0).sort((a,b)=>b.total-a.total).slice(0,5);
    const allComm    = customers.flatMap(c => c.agentCommissions||[]) as AgentCommission[];
    const pendingComm = allComm.filter(ac => ac.status === 'Pending').reduce((s,ac) => s+ac.commissionValue, 0);
    const deadStock  = store.getSlowMovingProducts(90).length;
    const newLeads   = customers.filter(c => c.status === 'New').length;
    const revenue    = customers.reduce((s,c) => s+(c.totalBusiness||0), 0);
    // Source breakdown
    const srcBreak = LEAD_SOURCES.reduce((acc, src) => { acc[src] = customers.filter(c => c.source===src).length; return acc; }, {} as Record<string,number>);
    // Type breakdown
    const typeBreak = CUSTOMER_TYPES.reduce((acc, t) => { acc[t] = customers.filter(c => c.type===t).length; return acc; }, {} as Record<string,number>);
    return { total, converted, conversion, followup, topCusts, topAgents, pendingComm, deadStock, newLeads, revenue, srcBreak, typeBreak };
  }, [customers, agents, ts]);

  // All commissions
  const allCommissions = useMemo(() => {
    const list: any[] = [];
    customers.forEach(c => {
      (c.agentCommissions||[]).forEach((ac: any) => {
        if (commFilter === 'All' || ac.status === commFilter) {
          if (!commSearch || ac.agentName?.toLowerCase().includes(commSearch.toLowerCase()) || c.name.toLowerCase().includes(commSearch.toLowerCase())) {
            list.push({ ...ac, custName: c.name, custId: c.id });
          }
        }
      });
    });
    return list.sort((a,b) => b.date.localeCompare(a.date));
  }, [customers, commFilter, commSearch, ts]);
  const pendingCommTotal = allCommissions.filter(ac => ac.status === 'Pending').reduce((s,ac) => s+ac.commissionValue, 0);
  const paidCommTotal    = allCommissions.filter(ac => ac.status === 'Paid').reduce((s,ac) => s+ac.commissionValue, 0);

  // Stock PDF products
  const stockPdfProds = useMemo(() => {
    const sizes = [...new Set(store.products.map(p => p.size).filter(Boolean))];
    return { sizes, products: store.products.filter(p =>
      (pdfOnlyAvail ? p.stockBoxes > 0 : true) &&
      (pdfCatFilter === 'All' || p.category === pdfCatFilter) &&
      (pdfSizeFilter === 'All' || p.size === pdfSizeFilter) &&
      p.showInGallery !== false
    )};
  }, [store.products, pdfCatFilter, pdfSizeFilter, pdfOnlyAvail, ts]);

  // AI tile recommendation
  const aiRecommend = (c: Customer) => {
    const prods = store.products.filter(p => p.stockBoxes > 0 && p.sellingPrice > 0);
    let candidates = prods;
    if (c.preferredCategories?.length) candidates = candidates.filter(p => c.preferredCategories!.includes(p.category as TileCategory));
    if (c.budgetMax) candidates = candidates.filter(p => p.sellingPrice <= c.budgetMax!);
    if (c.budgetMin) candidates = candidates.filter(p => p.sellingPrice >= c.budgetMin!);
    return candidates.slice(0, 4);
  };

  // AI tag suggestion
  const suggestTags = (c: Customer): string[] => {
    const tags: string[] = [];
    if (c.type === 'Commission Agent') tags.push('Agent');
    if (c.type === 'Contractor') tags.push('Contractor');
    if ((c.budgetMax||0) > 100000) tags.push('High Budget');
    if ((c.budgetMax||0) < 30000 && (c.budgetMax||0) > 0) tags.push('Budget Buyer');
    if ((c.preferredCategories||[]).includes('Premium')) tags.push('Premium');
    if (c.projectStage === 'Ongoing') tags.push('Active Project');
    if (c.totalBusiness > 100000) tags.push('VIP');
    if (c.status === 'Converted') tags.push('Repeat Potential');
    if (c.source === 'Instagram') tags.push('Social Media');
    return tags.filter(t => !(c.tags||[]).includes(t));
  };

  // ── Actions ─────────────────────────────────────────────────────────────────
  const saveCustomer = () => {
    if (!form.name || !form.mobile) return;
    if (editCust) { store.updateCustomer(editCust.id, form); }
    else store.addCustomer(form as any);
    setShowForm(false); setEditCust(null); setForm(emptyForm());
  };

  const logInteraction = () => {
    if (!selectedCust || !intNotes) return;
    store.addInteraction(selectedCust.id, { type: intType, notes: intNotes, outcome: intOutcome, date: today() });
    setIntNotes(''); setIntOutcome('');
    setSelectedCust(store.customers.find(c => c.id === selectedCust.id) || null);
  };

  const addTag = (tag: string) => {
    if (!selectedCust) return;
    const tags = [...(selectedCust.tags||[])];
    if (!tags.includes(tag)) { tags.push(tag); store.updateCustomer(selectedCust.id, { tags }); setSelectedCust({ ...selectedCust, tags }); }
  };

  const updateStatus = (status: LeadStatus) => {
    if (!selectedCust) return;
    store.updateCustomer(selectedCust.id, { status });
    setSelectedCust({ ...selectedCust, status });
  };

  const setFollowUp = (date: string) => {
    if (!selectedCust) return;
    store.updateCustomer(selectedCust.id, { nextFollowUpDate: date });
    setSelectedCust({ ...selectedCust, nextFollowUpDate: date });
  };

  const waQuick = (c: Customer, type: 'quote'|'stock'|'call') => {
    const msgs: Record<string, string> = {
      quote: `Hello ${c.name}! 🏠 We'd love to prepare a personalized quotation for you.\n\nWhat tiles/granite are you looking for? Please share your requirements and we'll send you the best options.\n\n— ${store.settings.showroomName}`,
      stock: `Hello ${c.name}! 🏷️ Exciting new arrivals at *${store.settings.showroomName}*!\n\nWe have great options in ${(c.preferredCategories||['tiles']).join(', ')} that match your budget. Would you like to see our latest collection?\n\n👉 Reply VIEW STOCK to get our full catalogue PDF.`,
      call:  `Hello ${c.name}! 📞 Please feel free to call us anytime:\n\n*${store.settings.showroomPhone || store.settings.showroomName}*\n\nWe're happy to assist with your project! 🙏`,
    };
    window.open(`https://wa.me/91${c.mobile.replace(/\D/g,'')}?text=${encodeURIComponent(msgs[type])}`, '_blank');
  };

  const waStockSend = (c: Customer) => {
    // Build rich stock message with category, size, price per product
    const items = stockPdfProds.products.map(p => {
      const disc = p.mrp && p.sellingPrice && p.mrp > p.sellingPrice
        ? ` (${Math.round(((p.mrp - p.sellingPrice) / p.mrp) * 100)}% OFF)` : '';
      return `• *${p.name}*${p.size ? ` | ${p.size}` : ''}${p.finish ? ` | ${p.finish}` : ''}\n  Stock: ${p.stockBoxes} boxes${pdfShowPrice ? ` | Price: ${INR(p.sellingPrice||0)}/box${disc}` : ''}`;
    }).join('\n');

    const header = `🏪 *${store.settings.showroomName}*\n📋 *LIVE STOCK CATALOGUE*\n📅 ${new Date().toLocaleDateString('en-IN')}\n${pdfCatFilter !== 'All' ? `📦 Category: ${pdfCatFilter}` : ''}\n`;
    const footer = `\n━━━━━━━━━━━━━━━━\n📞 ${store.settings.showroomPhone || ''}\n💬 Reply *ORDER* to place an enquiry\n🖨️ Full PDF catalogue available on request`;
    const msg = `${header}\n${items}${footer}`;

    const waUrl = 'https://wa.me/91' + c.mobile.replace(/\D/g, '') + '?text=' + encodeURIComponent(msg);
    window.open(waUrl, '_blank');
    setShowWAContact(false);
  };

  const broadcastNext = useCallback(() => {
    if (broadcastStep === null) return;
    const targets = broadcastPool.filter(c => selectedIds.has(c.id));
    if (broadcastStep >= targets.length) { setBroadcastStep(null); alert(`Broadcast complete — ${targets.length} messages queued`); return; }
    const c = targets[broadcastStep];
    const msg = broadMsg
      .replace(/\[Name\]/g, c.name)
      .replace(/\[Type\]/g, c.type)
      .replace(/\[Category\]/g, (c.preferredCategories||[]).join(', ') || 'tiles')
      .replace(/\[Budget\]/g, c.budgetMax ? INR(c.budgetMax) : 'your budget')
      .replace(/\[City\]/g, c.city || 'your area')
      .replace(/\[Showroom\]/g, store.settings.showroomName);
    window.open(`https://wa.me/91${c.mobile.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank');
    store.addInteraction(c.id, { type: 'WhatsApp', notes: `Broadcast: ${broadMsg.slice(0,60)}`, outcome: 'Sent', date: today() });
    setTimeout(() => setBroadcastStep(s => s !== null ? s + 1 : null), 800);
  }, [broadcastStep, broadcastPool, selectedIds, broadMsg]);

  useEffect(() => { if (broadcastStep !== null) broadcastNext(); }, [broadcastStep]);

  const saveCommission = () => {
    const agent = customers.find(c => c.id === commForm.agentId);
    if (!agent || !commForm.saleAmount) return;
    const val = (commForm.saleAmount * commForm.commissionPct) / 100;
    store.addAgentCommission(commForm.agentId, {
      agentId: commForm.agentId, agentName: agent.name,
      customerId: selectedCust?.id || commForm.agentId, saleAmount: commForm.saleAmount,
      commissionPct: commForm.commissionPct, commissionValue: r2(val),
      date: commForm.date, invoiceNo: commForm.invoiceNo, notes: commForm.notes, status: 'Pending',
    } as any);
    setShowCommForm(false);
    setCommForm({ agentId:'', saleAmount:0, commissionPct:5, invoiceNo:'', notes:'', date:today() });
  };

  const markPaid = (custId: string, commissionId: string) => {
    store.markAgentCommissionPaid(custId, commissionId);
  };

  const saveTmpl = () => {
    if (!tmplForm.name || !tmplForm.body) return;
    store.addMessageTemplate({ ...tmplForm, id: Date.now().toString() });
    setShowTmplForm(false); setTmplForm({ name:'', category:'Custom', body:'', triggerType:'Manual' });
  };

  const loadTemplate = (t: any) => { setBroadMsg(t.body); setActiveTab('broadcast'); };

  const printStockPDF = () => {
    window.print();
    // Tip: In the print dialog → Save as PDF, then share the PDF file via WhatsApp
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const inp = "w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400 focus:bg-white transition-all";
  const lbl = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";
  const Bdg = ({ label, cls }: any) => <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;

  const TABS: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'dashboard',  label: 'Dashboard',     icon: 'fa-chart-pie' },
    { id: 'leads',      label: 'Leads & CRM',   icon: 'fa-address-book', badge: dash.followup || undefined },
    { id: 'broadcast',  label: 'Broadcast',      icon: 'fa-broadcast-tower' },
    { id: 'stockpdf',   label: 'Stock PDF',       icon: 'fa-file-pdf' },
    { id: 'commission', label: 'Commissions',    icon: 'fa-handshake', badge: allCommissions.filter(a=>a.status==='Pending').length || undefined },
    { id: 'templates',  label: 'Templates',      icon: 'fa-file-alt' },
  ];

  return (
    <div className="space-y-5 pb-20">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tighter uppercase italic">Customer Connect</h1>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Smart CRM · WhatsApp Broadcast · Live Stock PDF · Commission Ledger</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {activeTab === 'leads' && (
            <>
              <button onClick={() => { setEditCust(null); setForm(emptyForm()); setShowForm(true); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-amber-600 transition-all active:scale-95">
                <i className="fas fa-plus text-xs"></i> Add Contact
              </button>
            </>
          )}
          {activeTab === 'commission' && (
            <button onClick={() => setShowCommForm(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all">
              <i className="fas fa-plus text-xs"></i> Log Commission
            </button>
          )}
          {activeTab === 'templates' && (
            <button onClick={() => setShowTmplForm(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-indigo-700 transition-all">
              <i className="fas fa-plus text-xs"></i> New Template
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
            {t.badge ? <span className="absolute -top-1.5 -right-1 bg-amber-500 text-white w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ══════ DASHBOARD ══════ */}
      {activeTab === 'dashboard' && (
        <div className="space-y-5">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Contacts', val: dash.total, sub: `${dash.newLeads} new`, cls: 'bg-white', vcls: 'text-slate-900' },
              { label: 'Converted', val: `${dash.converted}`, sub: `${dash.conversion}% rate`, cls: 'bg-emerald-50', vcls: 'text-emerald-700' },
              { label: 'Follow-up Due', val: dash.followup, sub: 'Overdue today', cls: dash.followup > 0 ? 'bg-amber-50' : 'bg-white', vcls: 'text-amber-700' },
              { label: 'Pending Commission', val: INR(dash.pendingComm), sub: 'Unpaid to agents', cls: 'bg-rose-50', vcls: 'text-rose-700' },
              { label: 'Total Revenue', val: INR(dash.revenue), sub: 'All contacts', cls: 'bg-indigo-50', vcls: 'text-indigo-700' },
              { label: 'Dead Stock Alert', val: dash.deadStock, sub: 'Products >90d unsold', cls: dash.deadStock > 0 ? 'bg-orange-50' : 'bg-white', vcls: 'text-orange-700' },
              { label: 'Agents', val: agents.length, sub: 'Commission agents', cls: 'bg-white', vcls: 'text-slate-800' },
              { label: 'Broadcast Pool', val: customers.filter(c=>c.mobile).length, sub: 'Has WhatsApp', cls: 'bg-white', vcls: 'text-slate-800' },
            ].map(({ label, val, sub, cls, vcls }) => (
              <div key={label} className={`${cls} border border-slate-100 rounded-[20px] p-4 shadow-sm`}>
                <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
                <div className={`text-xl font-black ${vcls}`}>{val}</div>
                <div className="text-[8px] font-bold text-slate-400 mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          {/* Pipeline + Top Customers + Top Agents */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Pipeline */}
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm space-y-3">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Sales Pipeline</div>
              {LEAD_STATUSES.map(s => {
                const count = customers.filter(c => c.status === s).length;
                const pct   = customers.length > 0 ? (count / customers.length) * 100 : 0;
                return (
                  <div key={s}>
                    <div className="flex justify-between text-[9px] font-bold text-slate-500 mb-1">
                      <div className="flex items-center gap-1.5"><div className={`w-2 h-2 rounded-full ${STATUS_DOT[s]}`}/>{s}</div>
                      <span className="font-black text-slate-700">{count}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${STATUS_DOT[s]} transition-all`} style={{ width: `${pct}%` }}/>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Top customers */}
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <i className="fas fa-trophy text-amber-400"></i> Top Customers
              </div>
              <div className="space-y-3">
                {dash.topCusts.length === 0 && <div className="text-center text-slate-300 font-black text-xs py-6 uppercase">No business recorded</div>}
                {dash.topCusts.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded-xl px-2 py-1 -mx-2 transition-all" onClick={() => { setSelectedCust(c); setActiveTab('leads'); }}>
                    <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center text-[9px] font-black text-amber-700">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-slate-800 text-xs truncate">{c.name}</div>
                      <div className="text-[8px] text-slate-400">{c.type} · {c.city}</div>
                    </div>
                    <div className="font-black text-emerald-600 text-xs">{INR(c.totalBusiness)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top agents */}
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <i className="fas fa-handshake text-indigo-400"></i> Top Agents
              </div>
              <div className="space-y-3">
                {dash.topAgents.length === 0 && <div className="text-center text-slate-300 font-black text-xs py-6 uppercase">No agent data yet</div>}
                {dash.topAgents.map(({ a, total }, i) => (
                  <div key={a.id} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center text-[9px] font-black text-indigo-600">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-slate-800 text-xs truncate">{a.name}</div>
                      <div className="text-[8px] text-slate-400">{(a.agentCommissions||[]).length} deals</div>
                    </div>
                    <div className="font-black text-indigo-600 text-xs">{INR(total)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Source + Type breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Lead Sources</div>
              <div className="flex flex-wrap gap-2">
                {LEAD_SOURCES.map(src => {
                  const count = dash.srcBreak[src] || 0;
                  if (!count) return null;
                  return (
                    <div key={src} className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                      <i className={`fab ${SOURCE_ICON[src]} text-slate-400 text-xs`}></i>
                      <div>
                        <div className="font-black text-slate-800 text-sm leading-none">{count}</div>
                        <div className="text-[7px] font-black text-slate-400 uppercase">{src}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Customer Types</div>
              <div className="flex flex-wrap gap-2">
                {CUSTOMER_TYPES.map(t => {
                  const count = dash.typeBreak[t] || 0;
                  if (!count) return null;
                  return (
                    <div key={t} className={`flex items-center gap-2 ${TYPE_COLOR[t] || 'bg-slate-100 text-slate-600'} rounded-xl px-3 py-2`}>
                      <i className={`fas ${TYPE_ICON[t]} text-xs`}></i>
                      <div>
                        <div className="font-black text-sm leading-none">{count}</div>
                        <div className="text-[7px] font-black uppercase opacity-70">{t}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Dead stock + broadcast prompt */}
          {dash.deadStock > 0 && (
            <div className="bg-gradient-to-r from-amber-900 to-amber-800 text-white rounded-[24px] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center"><i className="fas fa-box text-amber-300 text-xl"></i></div>
                <div>
                  <div className="font-black text-lg">{dash.deadStock} Slow-Moving Products</div>
                  <div className="text-[10px] text-amber-300 font-bold">Unsold 90+ days — broadcast a clearance to buyers to unlock cash</div>
                </div>
              </div>
              <button onClick={() => { setBroadMsg('Hello [Name]! 🏷️ CLEARANCE SALE at [Showroom]!\n\nWe\'re offering special discounts on premium tiles & granite. Don\'t miss out!\n\nCall us now: ' + store.settings.showroomPhone); setActiveTab('broadcast'); }}
                className="px-5 py-2.5 bg-white text-amber-800 rounded-2xl font-black text-[9px] uppercase hover:bg-amber-100 transition-all flex-shrink-0">
                <i className="fas fa-broadcast-tower mr-1.5"></i> Broadcast Clearance
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════ LEADS & CRM ══════ */}
      {activeTab === 'leads' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Left: list */}
          <div className="lg:col-span-2 space-y-3">
            <div className="bg-white border border-slate-100 rounded-2xl p-3 space-y-2.5 shadow-sm">
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                <i className="fas fa-search text-slate-300 text-xs"></i>
                <input className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-600" placeholder="Search name, phone, city…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="flex gap-1.5 overflow-x-auto">
                <select className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-[9px] uppercase outline-none flex-shrink-0" value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="All">All Types</option>
                  {CUSTOMER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <select className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-[9px] uppercase outline-none flex-shrink-0" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="All">All Status</option>
                  {LEAD_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
                <select className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-[9px] uppercase outline-none flex-shrink-0" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
                  <option value="recent">Recent</option>
                  <option value="business">Top Business</option>
                  <option value="name">Name A→Z</option>
                </select>
              </div>
              <div className="text-[8px] font-bold text-slate-400">{filtered.length} contacts</div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm max-h-[68vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-slate-300 font-black uppercase text-sm space-y-3">
                  <i className="fas fa-address-book text-4xl"></i>
                  <div>No contacts found</div>
                  <button onClick={() => { setForm(emptyForm()); setShowForm(true); }} className="text-amber-600 font-black text-xs hover:underline">+ Add first contact</button>
                </div>
              ) : filtered.map(c => {
                const isOverdue = c.nextFollowUpDate && c.nextFollowUpDate <= today() && c.status !== 'Converted' && c.status !== 'Lost';
                const isSel = selectedCust?.id === c.id;
                return (
                  <button key={c.id} onClick={() => setSelectedCust(c)}
                    className={`w-full text-left p-4 border-b border-slate-50 hover:bg-slate-50 transition-all flex items-center gap-3 ${isSel ? 'bg-slate-900' : ''}`}>
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 ${isSel ? 'bg-white/10 text-amber-400' : (TYPE_COLOR[c.type] || 'bg-slate-100 text-slate-500')}`}>
                      <i className={`fas ${TYPE_ICON[c.type] || 'fa-user'} text-xs`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-black text-sm truncate ${isSel ? 'text-white' : 'text-slate-900'}`}>{c.name}</div>
                      <div className={`text-[9px] font-bold flex gap-2 ${isSel ? 'text-slate-400' : 'text-slate-400'}`}>
                        <span>{c.mobile}</span>{c.city && <span>· {c.city}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className={`w-2 h-2 rounded-full ${STATUS_DOT[c.status] || 'bg-slate-300'}`}/>
                      {isOverdue && <span className="text-[7px] font-black text-amber-500">⏰</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail */}
          <div className="lg:col-span-3">
            {!selectedCust ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-[28px] h-full min-h-[400px] flex flex-col items-center justify-center text-slate-300 space-y-3">
                <i className="fas fa-hand-pointer text-5xl"></i>
                <div className="font-black uppercase text-sm">Select a contact</div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Hero */}
                <div className="bg-slate-900 text-white rounded-[24px] p-5 space-y-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/10 blur-[60px] pointer-events-none"/>
                  <div className="flex justify-between items-start gap-4 relative">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center text-2xl font-black text-amber-400">{selectedCust.name[0]}</div>
                      <div>
                        <div className="font-black text-xl tracking-tight">{selectedCust.name}</div>
                        <div className="text-[9px] font-bold text-slate-400 flex gap-3 mt-0.5">
                          <span><i className="fas fa-phone text-[8px] mr-1"></i>{selectedCust.mobile}</span>
                          {selectedCust.city && <span><i className="fas fa-map-marker-alt text-[8px] mr-1"></i>{selectedCust.city}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <Bdg label={selectedCust.type} cls={TYPE_COLOR[selectedCust.type] || 'bg-slate-700 text-white'} />
                          <Bdg label={selectedCust.status} cls={`border ${STATUS_COLOR[selectedCust.status] || ''}`} />
                          {selectedCust.projectStage && <Bdg label={selectedCust.projectStage} cls={STAGE_COLOR[selectedCust.projectStage] || 'bg-slate-700 text-white'} />}
                          {selectedCust.source && <Bdg label={selectedCust.source} cls="bg-white/10 text-slate-300" />}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <a href={`tel:${selectedCust.mobile}`} className="w-9 h-9 bg-blue-600/80 rounded-xl flex items-center justify-center hover:bg-blue-600"><i className="fas fa-phone text-xs text-white"></i></a>
                      <button onClick={() => window.open(`https://wa.me/91${selectedCust.mobile.replace(/\D/g,'')}`, '_blank')} className="w-9 h-9 bg-emerald-600/80 rounded-xl flex items-center justify-center hover:bg-emerald-600"><i className="fab fa-whatsapp text-xs text-white"></i></button>
                      <button onClick={() => { setEditCust(selectedCust); setForm({ ...emptyForm(), ...selectedCust }); setShowForm(true); }} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20"><i className="fas fa-pencil-alt text-xs text-white"></i></button>
                      <button onClick={() => { if(confirm('Delete contact?')) { store.deleteCustomer(selectedCust.id); setSelectedCust(null); } }} className="w-9 h-9 bg-rose-900/50 rounded-xl flex items-center justify-center hover:bg-rose-900"><i className="fas fa-trash-alt text-xs text-rose-400"></i></button>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 relative">
                    {[
                      { label: 'Total Business', val: INR(selectedCust.totalBusiness || 0), cls: 'text-amber-400' },
                      { label: 'Budget', val: (selectedCust.budgetMax||0) > 0 ? `${INR(selectedCust.budgetMin||0)}–${INR(selectedCust.budgetMax||0)}` : 'Not set', cls: 'text-white' },
                      { label: 'Preferred', val: (selectedCust.preferredCategories||[]).join(', ') || 'Any', cls: 'text-slate-300' },
                      { label: 'Follow-up', val: selectedCust.nextFollowUpDate || 'Not set', cls: selectedCust.nextFollowUpDate && selectedCust.nextFollowUpDate <= today() ? 'text-amber-400' : 'text-slate-300' },
                    ].map(({ label, val, cls }) => (
                      <div key={label} className="bg-white/5 rounded-xl px-3 py-2">
                        <div className="text-[7px] font-black text-slate-500 uppercase">{label}</div>
                        <div className={`font-black text-xs mt-0.5 truncate ${cls}`}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WhatsApp quick-reply buttons */}
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => waQuick(selectedCust, 'stock')} className="flex items-center justify-center gap-1.5 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all">
                    <i className="fab fa-whatsapp text-xs"></i> View Stock
                  </button>
                  <button onClick={() => waQuick(selectedCust, 'quote')} className="flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-blue-700 transition-all">
                    <i className="fas fa-file-alt text-xs"></i> Request Quote
                  </button>
                  <button onClick={() => waQuick(selectedCust, 'call')} className="flex items-center justify-center gap-1.5 py-2.5 bg-slate-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-slate-700 transition-all">
                    <i className="fas fa-phone text-xs"></i> Call Now
                  </button>
                </div>

                {/* Status update + Follow-up */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 shadow-sm">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Status & Follow-up</div>
                  <div className="flex flex-wrap gap-1.5">
                    {LEAD_STATUSES.map(s => (
                      <button key={s} onClick={() => updateStatus(s)}
                        className={`px-3 py-1.5 rounded-xl font-black text-[9px] uppercase transition-all ${selectedCust.status === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                        <div className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${STATUS_DOT[s]}`}/>{s}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="date" className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none"
                      value={selectedCust.nextFollowUpDate || ''} onChange={e => setFollowUp(e.target.value)} />
                    <div className="text-[9px] font-black text-slate-400 uppercase">Follow-up date</div>
                  </div>
                </div>

                {/* Tags + AI suggestions */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tags & AI Suggestions</div>
                    <button onClick={() => setShowAIRec(!showAIRec)} className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg font-black text-[8px] uppercase hover:bg-indigo-100">
                      <i className="fas fa-magic mr-1 text-[9px]"></i> AI Rec
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedCust.tags||[]).map(tag => (
                      <span key={tag} className="flex items-center gap-1 text-[8px] font-black bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                        {tag}
                        <button onClick={() => { const tags = (selectedCust.tags||[]).filter(t=>t!==tag); store.updateCustomer(selectedCust.id,{tags}); setSelectedCust({...selectedCust,tags}); }} className="text-slate-400 hover:text-rose-500 ml-0.5">×</button>
                      </span>
                    ))}
                    {suggestTags(selectedCust).map(tag => (
                      <button key={tag} onClick={() => addTag(tag)} className="text-[8px] font-black bg-amber-50 text-amber-600 px-2 py-1 rounded-full border border-dashed border-amber-300 hover:bg-amber-100 transition-all">
                        + {tag}
                      </button>
                    ))}
                  </div>

                  {/* AI Recommendations */}
                  {showAIRec && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 space-y-2">
                      <div className="text-[8px] font-black text-indigo-600 uppercase">AI Tile Recommendations for {selectedCust.name}</div>
                      <div className="grid grid-cols-2 gap-2">
                        {aiRecommend(selectedCust).length === 0 ? (
                          <div className="col-span-2 text-[9px] text-slate-400 font-bold text-center py-3">No matching products found</div>
                        ) : aiRecommend(selectedCust).map(p => (
                          <div key={p.id} className="bg-white rounded-lg p-2 border border-indigo-100">
                            <div className="font-black text-slate-800 text-[10px] truncate">{p.name}</div>
                            <div className="text-[8px] text-slate-400">{p.size} · {INR(p.sellingPrice||0)}/box</div>
                            <button onClick={() => {
                              const msg = `Hello ${selectedCust.name}! 🏠 Based on your preferences, we recommend:\n\n*${p.name}* (${p.size})\nPrice: ${INR(p.sellingPrice||0)}/box · ${p.stockBoxes} boxes in stock\n\nInterested? Reply for a quotation!`;
                              window.open(`https://wa.me/91${selectedCust.mobile.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank');
                            }} className="mt-1 w-full py-1 bg-emerald-100 text-emerald-700 rounded font-black text-[7px] uppercase hover:bg-emerald-200">
                              <i className="fab fa-whatsapp text-[8px] mr-0.5"></i> Send WA
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Interaction log */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 shadow-sm">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Interaction Timeline</div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {(selectedCust.interactions||[]).length === 0 && (
                      <div className="text-center text-slate-300 text-xs font-bold py-4 uppercase">No interactions yet</div>
                    )}
                    {[...(selectedCust.interactions||[])].sort((a:any,b:any) => (b.date||'').localeCompare(a.date||'')).map((int: any, i: number) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center shrink-0">
                          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                            <i className={`fas ${int.type === 'WhatsApp' ? 'fa-whatsapp text-emerald-500' : int.type === 'Call' ? 'fa-phone text-blue-500' : 'fa-comment text-slate-400'} text-[9px]`}></i>
                          </div>
                          {i < (selectedCust.interactions||[]).length - 1 && <div className="w-px flex-1 bg-slate-100 mt-1"/>}
                        </div>
                        <div className="flex-1 pb-2">
                          <div className="flex justify-between items-center">
                            <span className="font-black text-slate-700 text-xs">{int.type}</span>
                            <span className="text-[8px] text-slate-400 font-bold">{int.date || 'N/A'}</span>
                          </div>
                          <p className="text-[9px] text-slate-500 font-medium mt-0.5">{int.notes}</p>
                          {int.outcome && <span className="text-[8px] font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{int.outcome}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Log new interaction */}
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div className="flex gap-2">
                      <select className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none" value={intType} onChange={e => setIntType(e.target.value)}>
                        {['Visit','Call','WhatsApp','Email','Meeting','Site Visit','Follow-up'].map(t => <option key={t}>{t}</option>)}
                      </select>
                      <input className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-400" placeholder="Outcome…" value={intOutcome} onChange={e => setIntOutcome(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <textarea className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:border-amber-400 h-12 resize-none" placeholder="Notes…" value={intNotes} onChange={e => setIntNotes(e.target.value)} />
                      <button onClick={logInteraction} disabled={!intNotes} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-600 transition-all disabled:opacity-40">Log</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════ BROADCAST ══════ */}
      {activeTab === 'broadcast' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: compose */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm space-y-4">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Compose Message</div>

              {/* Message category quick-select */}
              <div className="flex flex-wrap gap-2">
                {MSG_CATS.map(cat => (
                  <button key={cat} onClick={() => {
                    setBroadcastMsgCat(cat);
                    const templates_map: Record<string, string> = {
                      'New Arrivals': `Hello [Name]! 🆕 *New Stock Alert!*\n\nFresh arrivals at [Showroom]! Premium [Category] tiles & granite now in stock.\n\n📍 Visit us today or call for details.`,
                      'Offers': `Hello [Name]! 🏷️ *Special Offer!*\n\nExclusive discounts on [Category] tiles this week at [Showroom].\n\n💰 Budget-friendly options available. Call us now!`,
                      'Clearance Sale': `Hello [Name]! ⚡ *CLEARANCE SALE!*\n\nHuge discounts on selected tiles & granite at [Showroom].\n\nFirst come, first served — limited stock! 📦`,
                      'Stock Update': `Hello [Name]! 📦 *Stock Update*\n\nHere's what's available now at [Showroom] in your preferred [Category] category.\n\nReply for pricing & availability.`,
                      'Custom': '',
                    };
                    if (cat !== 'Custom' && !broadMsg) setBroadMsg(templates_map[cat]);
                  }}
                    className={`px-3 py-1.5 rounded-xl font-black text-[9px] uppercase border-2 transition-all ${broadcastMsgCat === cat ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                    {cat}
                  </button>
                ))}
              </div>

              {/* Load from template */}
              {templates.length > 0 && (
                <select className={inp} onChange={e => { const t = templates.find((x:any) => x.id === e.target.value); if(t) setBroadMsg(t.body); e.target.value=''; }}>
                  <option value="">Load from template…</option>
                  {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}

              <div className="relative">
                <textarea className={`${inp} h-40 resize-none`}
                  placeholder="Type your message…&#10;&#10;Placeholders: [Name] [Type] [Category] [Budget] [City] [Showroom]"
                  value={broadMsg} onChange={e => setBroadMsg(e.target.value)} />
                <div className="absolute bottom-3 right-3 text-[8px] font-black text-slate-300">{broadMsg.length} chars</div>
              </div>

              {/* Preview */}
              {previewMode && broadMsg && broadcastPool.filter(c => selectedIds.has(c.id)).length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
                  <div className="text-[8px] font-black text-emerald-600 uppercase">Preview for {broadcastPool.filter(c => selectedIds.has(c.id))[0]?.name}</div>
                  <div className="text-[10px] font-medium text-slate-700 whitespace-pre-wrap">
                    {(() => {
                      const c = broadcastPool.filter(x => selectedIds.has(x.id))[0];
                      if (!c) return broadMsg;
                      return broadMsg.replace(/\[Name\]/g, c.name).replace(/\[Type\]/g, c.type).replace(/\[Category\]/g, (c.preferredCategories||[]).join(', ')||'tiles').replace(/\[Budget\]/g, c.budgetMax?INR(c.budgetMax):'your budget').replace(/\[City\]/g, c.city||'your area').replace(/\[Showroom\]/g, store.settings.showroomName);
                    })()}
                  </div>
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                <button onClick={() => setPreviewMode(v => !v)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
                  {previewMode ? 'Hide Preview' : 'Preview Message'}
                </button>
                <button
                  onClick={() => { if (broadMsg && selectedIds.size > 0) setBroadcastStep(0); }}
                  disabled={!broadMsg || selectedIds.size === 0}
                  className="flex-[2] py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-40">
                  <i className="fab fa-whatsapp mr-1.5"></i>
                  Send to {selectedIds.size} selected {broadcastStep !== null && `(${broadcastStep + 1}/${broadcastPool.filter(c=>selectedIds.has(c.id)).length})`}
                </button>
              </div>

              {/* Schedule option */}
              <div className="flex items-center gap-3 text-[9px]">
                <i className="fas fa-clock text-slate-400 text-xs"></i>
                <input type="datetime-local" className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
                <span className="text-slate-400 font-bold">Schedule broadcast (optional)</span>
              </div>
            </div>
          </div>

          {/* Right: audience selector */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm space-y-3">
              <div className="flex justify-between items-center">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Target Audience</div>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedIds(new Set(broadcastPool.map(c=>c.id)))} className="text-[8px] font-black text-amber-600 hover:underline">All</button>
                  <button onClick={() => setSelectedIds(new Set())} className="text-[8px] font-black text-slate-400 hover:underline">Clear</button>
                </div>
              </div>

              <select className={inp} value={broadcastTypeFilter} onChange={e => setBTF(e.target.value)}>
                <option value="All">All Types</option>
                {CUSTOMER_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <select className={inp} value={broadcastStatus} onChange={e => setBStatus(e.target.value)}>
                <option value="All">All Status</option>
                {LEAD_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
              <select className={inp} value={broadcastCat} onChange={e => setBroadcastCat(e.target.value)}>
                <option value="All">All Categories</option>
                {TILE_CATS.map(c => <option key={c}>{c}</option>)}
              </select>

              <div className="text-[9px] font-black text-slate-500 border-t border-slate-100 pt-2">{broadcastPool.length} eligible · {selectedIds.size} selected</div>

              <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                {broadcastPool.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded-xl cursor-pointer transition-all">
                    <input type="checkbox" className="w-4 h-4 rounded" checked={selectedIds.has(c.id)} onChange={() => { const n = new Set(selectedIds); n.has(c.id) ? n.delete(c.id) : n.add(c.id); setSelectedIds(n); }} />
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[9px] shrink-0 ${TYPE_COLOR[c.type]||'bg-slate-100'}`}><i className={`fas ${TYPE_ICON[c.type]||'fa-user'} text-[9px]`}></i></div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-slate-800 text-xs truncate">{c.name}</div>
                      <div className="text-[8px] text-slate-400 truncate">{c.mobile}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════ STOCK PDF ══════ */}
      {activeTab === 'stockpdf' && (
        <div className="space-y-4">
          {/* Print-only CSS */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              @page { size: A4; margin: 8mm 10mm; }
              body * { visibility: hidden !important; }
              #stock-catalogue, #stock-catalogue * { visibility: visible !important; }
              #stock-catalogue { position: fixed; inset: 0; background: white; z-index: 9999; padding: 12mm 14mm; }
              .no-print { display: none !important; }
              .print-card { break-inside: avoid; }
              -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
          ` }} />

          {/* ── Toolbar ── */}
          <div className="no-print bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-3">
            {/* Row 1: filters */}
            <div className="flex flex-wrap gap-3 items-center">
              <select className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={pdfCatFilter} onChange={e => setPdfCatFilter(e.target.value)}>
                <option value="All">All Categories</option>
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
              <select className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={pdfSizeFilter} onChange={e => setPdfSizeFilter(e.target.value)}>
                <option value="All">All Sizes</option>
                {stockPdfProds.sizes.map((s: any) => <option key={s}>{s}</option>)}
              </select>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={pdfOnlyAvail} onChange={e => setPdfOnlyAvail(e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
                <span className="font-bold text-sm text-slate-600">Available only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={pdfShowPrice} onChange={e => setPdfShowPrice(e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
                <span className="font-bold text-sm text-slate-600">Show prices</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={pdfShowImages} onChange={e => setPdfShowImages(e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
                <span className="font-bold text-sm text-slate-600">Show images</span>
              </label>
              {/* View toggle */}
              <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                {(['cards','table'] as const).map(m => (
                  <button key={m} onClick={() => setPdfViewMode(m)}
                    className={`px-3 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${pdfViewMode === m ? 'bg-white shadow text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
                    <i className={`fas ${m === 'cards' ? 'fa-th-large' : 'fa-list'} mr-1 text-[9px]`}></i>{m}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2: actions */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="text-[9px] font-black text-slate-400 uppercase flex-1">{stockPdfProds.products.length} products · {new Date().toLocaleString()}</div>
              <button onClick={() => window.print()}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-amber-600 transition-all active:scale-95">
                <i className="fas fa-file-pdf text-xs"></i> Save as PDF
              </button>
              <button onClick={() => setShowWAContact(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-2xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all active:scale-95">
                <i className="fab fa-whatsapp text-xs"></i> Send via WhatsApp
              </button>
            </div>

            {/* How to share PDF tip */}
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 flex items-start gap-3">
              <i className="fas fa-info-circle text-amber-500 text-sm mt-0.5 shrink-0"></i>
              <div className="text-[9px] font-bold text-amber-700 leading-relaxed">
                <span className="font-black">To send PDF via WhatsApp:</span> Click "Save as PDF" → in the print dialog choose "Save as PDF" → download the file → open WhatsApp and attach the PDF file as a document.
                <br/>Or use "Send via WhatsApp" to send the live stock list as a text message directly to any customer.
              </div>
            </div>
          </div>

          {/* ── Printable Catalogue ── */}
          <div id="stock-catalogue" ref={stockPdfRef}>

            {/* Catalogue header (shows in PDF) */}
            <div className="bg-slate-900 text-white rounded-t-2xl px-6 py-5 flex justify-between items-center print:rounded-none">
              <div>
                <div className="text-2xl font-black tracking-tight uppercase">{store.settings.showroomName}</div>
                <div className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">Live Stock Catalogue · {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                {pdfCatFilter !== 'All' && <div className="text-[9px] font-black text-amber-400 mt-1">Category: {pdfCatFilter}</div>}
              </div>
              <div className="text-right">
                <div className="text-[8px] font-black text-slate-500 uppercase">Contact</div>
                <div className="text-[10px] font-black text-white">{store.settings.showroomPhone}</div>
                <div className="text-[8px] text-slate-400 font-bold mt-0.5">{store.settings.showroomAddress}</div>
              </div>
            </div>

            {/* ── CARD VIEW (with images) ── */}
            {pdfViewMode === 'cards' && (
              <div className="bg-white border border-slate-100 border-t-0 rounded-b-2xl p-4 print:border-0 print:p-0">
                {stockPdfProds.products.length === 0 ? (
                  <div className="py-20 text-center text-slate-300 font-black uppercase">No products match selected filters</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 print:grid-cols-3 print:gap-4">
                    {stockPdfProds.products.map(p => {
                      const discount = p.mrp && p.sellingPrice && p.mrp > p.sellingPrice
                        ? Math.round(((p.mrp - p.sellingPrice) / p.mrp) * 100) : 0;
                      const stockOk = p.stockBoxes > 0;
                      return (
                        <div key={p.id} className={`print-card bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm print:shadow-none print:border print:border-slate-200 ${!stockOk ? 'opacity-50' : ''}`}>
                          {/* Product Image */}
                          {pdfShowImages && (
                            <div className="relative bg-stone-100 aspect-square overflow-hidden">
                              {p.images?.[0] ? (
                                <img src={p.images[0]} alt={p.name}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/200x200/f1f5f9/94a3b8?text=No+Image'; }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-100">
                                  <i className="fas fa-image text-2xl text-slate-300"></i>
                                </div>
                              )}
                              {/* Stock badge */}
                              <div className={`absolute top-2 right-2 text-[7px] font-black px-1.5 py-0.5 rounded-full border ${stockOk ? 'bg-white/95 text-emerald-700 border-emerald-200' : 'bg-rose-50/95 text-rose-600 border-rose-200'}`}>
                                {stockOk ? `${p.stockBoxes} boxes` : 'Out of stock'}
                              </div>
                              {/* Discount badge */}
                              {discount > 0 && (
                                <div className="absolute top-2 left-2 text-[7px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                                  {discount}% OFF
                                </div>
                              )}
                            </div>
                          )}

                          {/* Info */}
                          <div className="p-2.5 space-y-1.5">
                            <div className="font-black text-slate-900 text-[10px] leading-tight line-clamp-2">{p.name}</div>
                            <div className="flex flex-wrap gap-1">
                              <span className="text-[7px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full uppercase">{p.category}</span>
                              {p.size && <span className="text-[7px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{p.size}</span>}
                              {p.finish && <span className="text-[7px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{p.finish}</span>}
                            </div>

                            {pdfShowPrice && (
                              <div className="border-t border-slate-100 pt-1.5 flex items-end justify-between">
                                <div>
                                  <div className="text-[7px] font-black text-slate-400 uppercase">Price / Box</div>
                                  <div className="font-black text-slate-900 text-sm leading-none">{INR(p.sellingPrice || 0)}</div>
                                </div>
                                {p.sqftPerBox > 0 && (
                                  <div className="text-right">
                                    <div className="text-[7px] font-black text-slate-400 uppercase">Per SqFt</div>
                                    <div className="font-black text-amber-600 text-[10px]">{INR(Math.round((p.sellingPrice || 0) / p.sqftPerBox))}</div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Stock bar */}
                            <div className={`text-[7px] font-black text-center py-1 rounded-lg ${stockOk ? p.stockBoxes < 10 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                              {!stockOk ? '⛔ Out of Stock' : p.stockBoxes < 10 ? `⚠ Low: ${p.stockBoxes} boxes` : `✓ ${p.stockBoxes} boxes available`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── TABLE VIEW ── */}
            {pdfViewMode === 'table' && (
              <div className="bg-white border border-slate-100 border-t-0 rounded-b-2xl overflow-x-auto print:border-0">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    {[
                      ...(pdfShowImages ? ['Photo'] : []),
                      'Product','Category','Size','Finish','Stock',
                      ...(pdfShowPrice ? ['Price/Box','Per SqFt','Discount'] : []),
                      'Updated'
                    ].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {stockPdfProds.products.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-12 text-slate-300 font-black uppercase">No products match filter</td></tr>
                    ) : stockPdfProds.products.map(p => {
                      const discount = p.mrp && p.sellingPrice && p.mrp > p.sellingPrice ? Math.round(((p.mrp - p.sellingPrice) / p.mrp) * 100) : 0;
                      const perSqft  = p.sqftPerBox > 0 && p.sellingPrice ? Math.round(p.sellingPrice / p.sqftPerBox) : 0;
                      return (
                        <tr key={p.id} className={`hover:bg-slate-50 print-card ${p.stockBoxes === 0 ? 'opacity-50' : ''}`}>
                          {pdfShowImages && (
                            <td className="px-3 py-2">
                              {p.images?.[0] ? (
                                <img src={p.images[0]} alt={p.name} className="w-12 h-12 object-cover rounded-lg border border-slate-100" referrerPolicy="no-referrer"
                                  onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/48x48/f1f5f9/94a3b8?text=?'; }} />
                              ) : (
                                <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center"><i className="fas fa-image text-slate-300 text-sm"></i></div>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-3 font-black text-slate-800 max-w-[140px]">
                            <div className="truncate">{p.name}</div>
                            {p.brand && <div className="text-[8px] text-slate-400 font-bold">{p.brand}</div>}
                          </td>
                          <td className="px-3 py-3"><span className="text-[8px] font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{p.category}</span></td>
                          <td className="px-3 py-3 font-bold text-slate-600 whitespace-nowrap">{p.size || '—'}</td>
                          <td className="px-3 py-3 font-bold text-slate-500">{p.finish || '—'}</td>
                          <td className="px-3 py-3">
                            <span className={`font-black text-xs whitespace-nowrap ${p.stockBoxes === 0 ? 'text-rose-500' : p.stockBoxes < 10 ? 'text-amber-600' : 'text-emerald-700'}`}>
                              {p.stockBoxes > 0 ? `${p.stockBoxes} boxes` : 'Out of stock'}
                            </span>
                          </td>
                          {pdfShowPrice && <>
                            <td className="px-3 py-3 font-black text-slate-900">{INR(p.sellingPrice || 0)}</td>
                            <td className="px-3 py-3 font-black text-amber-600">{perSqft > 0 ? INR(perSqft) : '—'}</td>
                            <td className="px-3 py-3 font-black text-emerald-600">{discount > 0 ? `${discount}%` : '—'}</td>
                          </>}
                          <td className="px-3 py-3 font-bold text-slate-400 text-[8px] whitespace-nowrap">{new Date(p.updatedAt || Date.now()).toLocaleDateString('en-IN')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {stockPdfProds.products.length > 0 && (
                    <tfoot><tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td colSpan={pdfShowImages ? (pdfShowPrice ? 9 : 6) : (pdfShowPrice ? 8 : 5)} className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">
                        Total: {stockPdfProds.products.length} products · {stockPdfProds.products.filter(p=>p.stockBoxes>0).length} in stock · Generated {new Date().toLocaleString()}
                      </td>
                    </tr></tfoot>
                  )}
                </table>
              </div>
            )}

            {/* Catalogue footer */}
            <div className="bg-slate-50 border border-slate-100 border-t-0 rounded-b-2xl px-6 py-4 flex justify-between items-center text-[8px] font-bold text-slate-400 print:bg-white print:border-t print:border-slate-200">
              <span>{store.settings.showroomName} · {store.settings.showroomAddress}</span>
              <span>Generated {new Date().toLocaleString('en-IN')} · Prices subject to change without notice</span>
            </div>
          </div>

          {/* ── WhatsApp Contact Picker Modal ── */}
          {showWAContact && (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[600] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95">
                <div className="bg-emerald-700 text-white px-6 py-4 flex items-center justify-between shrink-0">
                  <div>
                    <div className="font-black text-lg flex items-center gap-2"><i className="fab fa-whatsapp"></i> Send Stock List</div>
                    <div className="text-[9px] text-emerald-200 font-bold mt-0.5">Select customer to send the catalogue</div>
                  </div>
                  <button onClick={() => setShowWAContact(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
                </div>

                {/* Search */}
                <div className="p-4 border-b border-slate-100 shrink-0">
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                    <i className="fas fa-search text-slate-300 text-xs"></i>
                    <input className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-600" placeholder="Search name or mobile…"
                      onChange={e => setSearch(e.target.value)} />
                  </div>
                </div>

                {/* Contact list */}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {customers.filter(c => c.mobile && (!search || c.name.toLowerCase().includes(search.toLowerCase()) || c.mobile.includes(search))).map(c => (
                    <button key={c.id} onClick={() => waStockSend(c)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-emerald-50 transition-all text-left group">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 ${TYPE_COLOR[c.type] || 'bg-slate-100 text-slate-500'}`}>
                        <i className={`fas ${TYPE_ICON[c.type] || 'fa-user'} text-xs`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-slate-900 text-sm truncate">{c.name}</div>
                        <div className="text-[9px] text-slate-400 font-bold flex gap-2 mt-0.5">
                          <span>{c.mobile}</span>
                          {c.city && <span>· {c.city}</span>}
                          {c.type && <span>· {c.type}</span>}
                        </div>
                      </div>
                      <div className="w-9 h-9 bg-emerald-100 group-hover:bg-emerald-500 rounded-xl flex items-center justify-center transition-all">
                        <i className="fab fa-whatsapp text-emerald-600 group-hover:text-white text-sm transition-colors"></i>
                      </div>
                    </button>
                  ))}
                  {customers.filter(c => c.mobile).length === 0 && (
                    <div className="py-16 text-center text-slate-300 font-black uppercase text-sm">No contacts with mobile numbers</div>
                  )}
                </div>

                {/* Footer tip */}
                <div className="shrink-0 bg-slate-50 border-t border-slate-100 px-5 py-4">
                  <div className="text-[9px] text-slate-500 font-bold flex items-start gap-2">
                    <i className="fas fa-info-circle text-amber-500 text-xs mt-0.5 shrink-0"></i>
                    <span>This sends the stock list as a <b>WhatsApp text message</b>. To send the actual <b>PDF file</b>, first click "Save as PDF" above, then share the downloaded file from WhatsApp on your device.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════ COMMISSIONS ══════ */}
      {activeTab === 'commission' && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-rose-50 border border-rose-200 rounded-[20px] p-4">
              <div className="text-[8px] font-black text-rose-400 uppercase mb-1">Pending</div>
              <div className="text-xl font-black text-rose-700">{INR(pendingCommTotal)}</div>
              <div className="text-[8px] text-rose-400 font-bold">{allCommissions.filter(a=>a.status==='Pending').length} entries</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-[20px] p-4">
              <div className="text-[8px] font-black text-emerald-500 uppercase mb-1">Paid</div>
              <div className="text-xl font-black text-emerald-700">{INR(paidCommTotal)}</div>
              <div className="text-[8px] text-emerald-500 font-bold">{allCommissions.filter(a=>a.status==='Paid').length} entries</div>
            </div>
            <div className="bg-white border border-slate-100 rounded-[20px] p-4">
              <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Total</div>
              <div className="text-xl font-black text-slate-800">{INR(pendingCommTotal + paidCommTotal)}</div>
              <div className="text-[8px] text-slate-400 font-bold">{allCommissions.length} total entries</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
              {(['All','Pending','Paid'] as const).map(f => (
                <button key={f} onClick={() => setCommFilter(f)}
                  className={`px-4 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${commFilter === f ? 'bg-white text-slate-900 shadow' : 'text-slate-400 hover:text-slate-600'}`}>{f}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 flex-1 min-w-[160px]">
              <i className="fas fa-search text-slate-300 text-xs"></i>
              <input className="flex-1 bg-transparent font-bold text-sm outline-none" placeholder="Search agent or customer…" value={commSearch} onChange={e => setCommSearch(e.target.value)} />
            </div>
          </div>

          {/* Commission table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 border-b border-slate-100">
                {['Date','Agent','Customer','Invoice','Sale Amount','Comm %','Commission','Status','Action'].map(h => (
                  <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {allCommissions.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-14 text-slate-300 font-black uppercase">No commission entries</td></tr>
                ) : allCommissions.map((ac: any) => (
                  <tr key={ac.id || `${ac.agentId}-${ac.date}`} className="hover:bg-slate-50">
                    <td className="px-3 py-3 font-bold text-slate-400 whitespace-nowrap">{ac.date}</td>
                    <td className="px-3 py-3 font-black text-indigo-600">{ac.agentName}</td>
                    <td className="px-3 py-3 font-bold text-slate-700">{ac.custName}</td>
                    <td className="px-3 py-3 font-black text-blue-600">{ac.invoiceNo || '—'}</td>
                    <td className="px-3 py-3 font-bold text-slate-700">{INR(ac.saleAmount)}</td>
                    <td className="px-3 py-3 font-bold text-slate-500">{ac.commissionPct}%</td>
                    <td className="px-3 py-3 font-black text-slate-900">{INR(ac.commissionValue)}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${ac.status === 'Paid' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>{ac.status}</span>
                    </td>
                    <td className="px-3 py-3">
                      {ac.status === 'Pending' && (
                        <button onClick={() => markPaid(ac.custId, ac.id)}
                          className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-xl font-black text-[8px] uppercase hover:bg-emerald-200 transition-all whitespace-nowrap">
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════ TEMPLATES ══════ */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
              <i className="fas fa-search text-slate-300 text-xs"></i>
              <input className="flex-1 bg-transparent outline-none text-sm font-bold" placeholder="Search templates…" value={tmplSearch} onChange={e => setTmplSearch(e.target.value)} />
            </div>
          </div>

          {/* Default templates */}
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Quick Templates</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { name: 'New Stock Arrival', cat: 'New Arrivals', body: 'Hello [Name]! 🆕 Fresh stock arrived at [Showroom]!\n\nPremium [Category] tiles & granite now available. Visit us or call for details.\n\n📍 [Showroom]' },
              { name: 'Clearance Offer', cat: 'Clearance Sale', body: 'Hello [Name]! ⚡ MEGA CLEARANCE at [Showroom]!\n\nMassive discounts on premium tiles. Limited stock available.\n\n🏃 Hurry — first come, first served!' },
              { name: 'Follow-up Reminder', cat: 'Custom', body: 'Hello [Name]! 👋 Just checking in about your tile project.\n\nAre you ready to finalize your selection? We have some great options in [Category] within [Budget].\n\nLet us know how we can help!' },
              { name: 'Festival Special', cat: 'Offers', body: '🎉 Happy Festive Season [Name]!\n\n[Showroom] is offering special festival discounts on ALL premium tiles & granite.\n\n💫 Visit us or request a WhatsApp catalogue.' },
            ].map(t => (
              <div key={t.name} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2">
                <div className="flex justify-between items-center">
                  <div className="font-black text-slate-800">{t.name}</div>
                  <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">{t.cat}</span>
                </div>
                <p className="text-[9px] text-slate-500 font-medium line-clamp-3 whitespace-pre-line">{t.body}</p>
                <div className="flex gap-2">
                  <button onClick={() => loadTemplate(t)} className="flex-1 py-2 bg-amber-50 text-amber-700 rounded-xl font-black text-[9px] uppercase hover:bg-amber-100">
                    <i className="fas fa-broadcast-tower text-[8px] mr-1"></i> Use
                  </button>
                  <button onClick={() => { setBroadMsg(t.body); }} className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200">Copy</button>
                </div>
              </div>
            ))}
          </div>

          {/* Saved templates */}
          {templates.filter((t: any) => !tmplSearch || t.name.toLowerCase().includes(tmplSearch.toLowerCase())).length > 0 && (
            <>
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-4">Saved Templates</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.filter((t: any) => !tmplSearch || t.name.toLowerCase().includes(tmplSearch.toLowerCase())).map((t: any) => (
                  <div key={t.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-2">
                    <div className="flex justify-between items-center">
                      <div className="font-black text-slate-800">{t.name}</div>
                      <div className="flex gap-1.5">
                        <span className="text-[8px] font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full uppercase">{t.category}</span>
                        <button onClick={() => store.deleteMessageTemplate(t.id)} className="text-slate-300 hover:text-rose-500 transition-colors"><i className="fas fa-times text-[9px]"></i></button>
                      </div>
                    </div>
                    <p className="text-[9px] text-slate-500 font-medium line-clamp-3 whitespace-pre-line">{t.body}</p>
                    <div className="flex gap-2">
                      <button onClick={() => loadTemplate(t)} className="flex-1 py-2 bg-amber-50 text-amber-700 rounded-xl font-black text-[9px] uppercase hover:bg-amber-100">
                        <i className="fas fa-broadcast-tower text-[8px] mr-1"></i> Use in Broadcast
                      </button>
                      <button onClick={() => {
                        const msg = encodeURIComponent(t.body.replace(/\[Showroom\]/g, store.settings.showroomName));
                        window.open(`https://wa.me/?text=${msg}`, '_blank');
                      }} className="py-2 px-3 bg-emerald-100 text-emerald-700 rounded-xl font-black text-[9px] uppercase hover:bg-emerald-200">
                        <i className="fab fa-whatsapp text-[9px]"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════ ADD/EDIT CUSTOMER MODAL ══════ */}
      {showForm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
              <div>
                <div className="font-black text-lg">{editCust ? 'Edit Contact' : 'New Contact'}</div>
                <div className="text-[9px] text-slate-400 font-bold">Enter customer details below</div>
              </div>
              <button onClick={() => { setShowForm(false); setEditCust(null); setForm(emptyForm()); }} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Type selector */}
              <div>
                <label className={lbl}>Customer Type</label>
                <div className="flex flex-wrap gap-2">
                  {CUSTOMER_TYPES.map(t => (
                    <button key={t} onClick={() => setF('type', t)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 transition-all text-[9px] font-black uppercase ${form.type === t ? `${TYPE_COLOR[t]} border-current` : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                      <i className={`fas ${TYPE_ICON[t]} text-[9px]`}></i> {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Full Name *</label><input className={inp} placeholder="Customer name" value={form.name||''} onChange={e => setF('name', e.target.value)} /></div>
                <div><label className={lbl}>Mobile (WhatsApp) *</label><input className={inp} placeholder="+91 XXXXX XXXXX" value={form.mobile||''} onChange={e => setF('mobile', e.target.value)} /></div>
                <div><label className={lbl}>City / Location</label><input className={inp} placeholder="City" value={form.city||''} onChange={e => setF('city', e.target.value)} /></div>
                <div><label className={lbl}>Email</label><input type="email" className={inp} placeholder="email@example.com" value={form.email||''} onChange={e => setF('email', e.target.value)} /></div>
                <div><label className={lbl}>Address</label><input className={inp} placeholder="Area / Street" value={form.address||''} onChange={e => setF('address', e.target.value)} /></div>
                <div><label className={lbl}>GST Number</label><input className={inp} placeholder="Optional" value={form.gst||''} onChange={e => setF('gst', e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={lbl}>Lead Status</label>
                  <select className={inp} value={form.status||'New'} onChange={e => setF('status', e.target.value)}>
                    {LEAD_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Source</label>
                  <select className={inp} value={form.source||'Manual'} onChange={e => setF('source', e.target.value)}>
                    {LEAD_SOURCES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Project Stage</label>
                  <select className={inp} value={form.projectStage||'Planning'} onChange={e => setF('projectStage', e.target.value)}>
                    {['Planning','Ongoing','Finishing','Completed'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={lbl}>Preferred Categories</label>
                <div className="flex flex-wrap gap-2">
                  {TILE_CATS.map(c => {
                    const sel = (form.preferredCategories||[]).includes(c);
                    return (
                      <button key={c} onClick={() => {
                        const cats = sel ? (form.preferredCategories||[]).filter((x:string)=>x!==c) : [...(form.preferredCategories||[]), c];
                        setF('preferredCategories', cats);
                      }} className={`px-3 py-1.5 rounded-xl border-2 font-black text-[9px] uppercase transition-all ${sel ? 'bg-amber-600 text-white border-amber-600' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>{c}</button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Budget Min (₹)</label><input type="number" className={inp} value={form.budgetMin||''} onChange={e => setF('budgetMin', parseFloat(e.target.value||'0'))} /></div>
                <div><label className={lbl}>Budget Max (₹)</label><input type="number" className={inp} value={form.budgetMax||''} onChange={e => setF('budgetMax', parseFloat(e.target.value||'0'))} /></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Assigned To</label>
                  <select className={inp} value={form.assignedTo||''} onChange={e => setF('assignedTo', e.target.value)}>
                    <option value="">Unassigned</option>
                    {executives.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Follow-up Date</label>
                  <input type="date" className={inp} value={form.nextFollowUpDate||''} onChange={e => setF('nextFollowUpDate', e.target.value)} />
                </div>
              </div>

              {(form.type === 'Commission Agent') && (
                <div>
                  <label className={lbl}>Default Commission %</label>
                  <input type="number" className={inp} step="0.5" value={form.agentCommissionPct||5} onChange={e => setF('agentCommissionPct', parseFloat(e.target.value||'5'))} />
                </div>
              )}

              <div>
                <label className={lbl}>Notes</label>
                <textarea className={`${inp} h-16 resize-none`} placeholder="Project details, preferences, site info…" value={form.notes||''} onChange={e => setF('notes', e.target.value)} />
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 shrink-0 flex gap-3">
              <button onClick={saveCustomer} disabled={!form.name || !form.mobile}
                className="flex-1 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all disabled:opacity-40">
                {editCust ? 'Update Contact' : 'Save Contact'}
              </button>
              <button onClick={() => { setShowForm(false); setEditCust(null); setForm(emptyForm()); }}
                className="px-5 py-3 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Commission form modal */}
      {showCommForm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-emerald-800 text-white px-6 py-4 flex items-center justify-between">
              <div className="font-black text-lg">Log Commission</div>
              <button onClick={() => setShowCommForm(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={lbl}>Agent</label>
                <select className={inp} value={commForm.agentId} onChange={e => { const a = agents.find(ag => ag.id === e.target.value); setCommForm(f => ({ ...f, agentId: e.target.value, commissionPct: a?.agentCommissionPct || 5 })); }}>
                  <option value="">Select agent…</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Sale Amount (₹)</label>
                  <input type="number" className={inp} value={commForm.saleAmount||''} onChange={e => setCommForm(f => ({ ...f, saleAmount: parseFloat(e.target.value||'0') }))} />
                </div>
                <div>
                  <label className={lbl}>Commission %</label>
                  <input type="number" step="0.5" className={inp} value={commForm.commissionPct} onChange={e => setCommForm(f => ({ ...f, commissionPct: parseFloat(e.target.value||'0') }))} />
                </div>
              </div>
              {commForm.saleAmount > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex justify-between">
                  <span className="font-bold text-slate-600 text-sm">Commission Value</span>
                  <span className="font-black text-emerald-700 text-lg">{INR(r2((commForm.saleAmount * commForm.commissionPct) / 100))}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Invoice No.</label><input className={inp} placeholder="Optional" value={commForm.invoiceNo} onChange={e => setCommForm(f => ({ ...f, invoiceNo: e.target.value }))} /></div>
                <div><label className={lbl}>Date</label><input type="date" className={inp} value={commForm.date} onChange={e => setCommForm(f => ({ ...f, date: e.target.value }))} /></div>
              </div>
              <div><label className={lbl}>Notes</label><input className={inp} placeholder="Optional remarks" value={commForm.notes} onChange={e => setCommForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <button onClick={saveCommission} disabled={!commForm.agentId || !commForm.saleAmount}
                className="w-full py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-emerald-700 transition-all disabled:opacity-40">
                Save Commission Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template form modal */}
      {showTmplForm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="bg-indigo-800 text-white px-6 py-4 flex items-center justify-between">
              <div className="font-black text-lg">New Message Template</div>
              <button onClick={() => setShowTmplForm(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className={lbl}>Template Name</label><input className={inp} placeholder="e.g. Festival Offer 2026" value={tmplForm.name} onChange={e => setTmplForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Category</label>
                  <select className={inp} value={tmplForm.category} onChange={e => setTmplForm(f => ({ ...f, category: e.target.value }))}>
                    {MSG_CATS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Trigger Type</label>
                  <select className={inp} value={tmplForm.triggerType} onChange={e => setTmplForm(f => ({ ...f, triggerType: e.target.value }))}>
                    {['Manual','New Stock','Price Drop','Clearance','Festival','Follow-up'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={lbl}>Message Body</label>
                <textarea className={`${inp} h-32 resize-none`}
                  placeholder="Use: [Name] [Type] [Category] [Budget] [City] [Showroom]"
                  value={tmplForm.body} onChange={e => setTmplForm(f => ({ ...f, body: e.target.value }))} />
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-[8px] font-bold text-slate-400 space-y-0.5">
                <div className="font-black text-slate-500 uppercase mb-1">Placeholder guide</div>
                <div>[Name] → Customer name | [Type] → Customer type | [Category] → Preferred category</div>
                <div>[Budget] → Budget max | [City] → Customer city | [Showroom] → Your showroom name</div>
              </div>
              <button onClick={saveTmpl} disabled={!tmplForm.name || !tmplForm.body}
                className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-indigo-700 transition-all disabled:opacity-40">
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default CustomerConnect;
