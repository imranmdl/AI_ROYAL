import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { store } from '../store';
import { GalleryLead, GalleryLeadItem, Quotation, QuotationItem } from '../types';

interface GalleryLeadsProps {
  onConvertToQuotation?: (lead: GalleryLead) => void;
}

const curr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const STATUS_STYLE: Record<string, string> = {
  New:       'bg-amber-100  text-amber-700  border-amber-200',
  Responded: 'bg-blue-100   text-blue-700   border-blue-200',
  Converted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Cancelled: 'bg-rose-100   text-rose-600   border-rose-200',
};

const GalleryLeads: React.FC<GalleryLeadsProps> = ({ onConvertToQuotation }) => {
  const [leads, setLeads]           = useState<GalleryLead[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [page, setPage]             = useState(1);
  const [isLoading, setIsLoading]   = useState(true);
  const [viewMode, setViewMode]     = useState<'daily'|'history'>('daily');
  const [search, setSearch]         = useState('');
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const LIMIT = 12;

  const [selectedLead, setSelectedLead] = useState<GalleryLead | null>(null);
  const [showDetail, setShowDetail]     = useState(false);

  // Follow-up
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followDate, setFollowDate]     = useState('');
  const [followTime, setFollowTime]     = useState('');

  // Customer Portal
  const [showPortal, setShowPortal]     = useState(false);
  const [portalMobile, setPortalMobile] = useState('');
  const [portalOtp, setPortalOtp]       = useState('');
  const [portalGenOtp, setPortalGenOtp] = useState('');
  const [portalVerified, setPortalVerified] = useState(false);
  const [portalLeads, setPortalLeads]   = useState<GalleryLead[]>([]);
  const [portalOtpSent, setPortalOtpSent] = useState(false);
  const [portalOtpError, setPortalOtpError] = useState('');
  const [selectedPortalLead, setSelectedPortalLead] = useState<GalleryLead | null>(null);

  // ── Fetch leads ──────────────────────────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await store.fetchGalleryLeadsPage(page, LIMIT, search, { startDate, endDate, dailyLatest: viewMode === 'daily' });
      let data = res.data as GalleryLead[];
      if (statusFilter !== 'All') data = data.filter(l => l.status === statusFilter);
      setLeads(data);
      setTotalLeads(res.total);
    } catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  }, [page, LIMIT, search, startDate, endDate, viewMode, statusFilter]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:     store.galleryLeads.length,
    new:       store.galleryLeads.filter(l => l.status === 'New').length,
    converted: store.galleryLeads.filter(l => l.status === 'Converted').length,
    value:     store.galleryLeads.filter(l => l.status !== 'Cancelled').reduce((s, l) => s + (l.totalAmount || 0), 0),
  }), [store.galleryLeads]);

  // ── Status update ─────────────────────────────────────────────────────────
  const updateStatus = (id: string, status: GalleryLead['status']) => {
    store.updateGalleryLeadStatus(id, status);
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
    if (selectedLead?.id === id) setSelectedLead({ ...selectedLead, status });
  };

  // ── Follow-up ─────────────────────────────────────────────────────────────
  const saveFollowUp = () => {
    if (!selectedLead || !followDate || !followTime) return;
    const dt = `${followDate}T${followTime}`;
    store.updateGalleryLead(selectedLead.id, { followUpDate: dt });
    setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, followUpDate: dt } : l));
    setSelectedLead({ ...selectedLead, followUpDate: dt });
    setShowFollowUp(false);
    store.addActivityLog('Sales', `Follow-up set for ${selectedLead.customerName} on ${new Date(dt).toLocaleString()}`);
  };

  // ── Convert to Quotation ──────────────────────────────────────────────────
  const handleConvertToQuotation = (lead: GalleryLead) => {
    if (onConvertToQuotation) {
      store.updateGalleryLeadStatus(lead.id, 'Responded');
      onConvertToQuotation(lead);
    }
  };

  // ── Convert directly to Sale (via Quotation in App) ───────────────────────
  const handleConvertToSale = (lead: GalleryLead) => {
    handleConvertToQuotation(lead); // goes through quotation flow in App.tsx
  };

  // ── Item display helper ───────────────────────────────────────────────────
  const renderLeadItem = (item: any, index: number) => {
    const isSlabCat = ['Kadapa', 'Granite', 'Marble'].includes(item.category || '');
    const prod = store.products.find(p => p.id === item.productId);

    return (
      <div key={index} className="bg-white border border-slate-100 rounded-2xl p-4 space-y-2">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <div className="font-black text-slate-800 text-sm">{item.productName}</div>
            {item.category && (
              <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">{item.category}</span>
            )}
            {item.purpose && <div className="text-[9px] text-slate-400 font-bold mt-0.5">{item.purpose}</div>}
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <div className="font-black text-slate-800">{curr(item.totalValue || 0)}</div>
            <div className="text-[8px] text-slate-400">₹{item.unitPrice?.toFixed(2)}/{isSlabCat ? 'SqFt' : 'Box'}</div>
          </div>
        </div>

        {/* Tile: show qty */}
        {!isSlabCat && (
          <div className="text-[9px] text-slate-500 font-bold">
            {item.requestedSqft} SqFt → {item.calculatedBoxes} boxes
          </div>
        )}

        {/* Slab: show individual slab details */}
        {isSlabCat && item.slabDetails && item.slabDetails.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Selected Slabs ({item.slabDetails.length})</div>
            {item.slabDetails.map((slab: any, si: number) => (
              <div key={si} className="flex items-center justify-between bg-amber-50 rounded-xl px-3 py-2">
                <div>
                  <span className="font-black text-slate-800 text-xs">#{slab.slabNo}</span>
                  {slab.finish && <span className="text-amber-500 font-bold text-[9px] ml-2">{slab.finish}</span>}
                  <span className="text-slate-400 text-[9px] ml-2">{slab.sqft} SqFt</span>
                </div>
                <div className="font-black text-sm text-emerald-700">{slab.sellingPrice ? curr(slab.sellingPrice) : '—'}</div>
              </div>
            ))}
            <div className="flex justify-between text-[9px] font-bold text-slate-600 px-1">
              <span>Total: {item.requestedSqft?.toFixed(1)} SqFt</span>
              <span className="font-black text-emerald-700">{curr(item.totalValue)}</span>
            </div>
          </div>
        )}

        {/* Slab without slabDetails (sqft-based) */}
        {isSlabCat && (!item.slabDetails || item.slabDetails.length === 0) && (
          <div className="text-[9px] text-slate-500 font-bold">{item.requestedSqft} SqFt</div>
        )}

        {/* Stock check */}
        {prod && (
          <div className={`text-[8px] font-bold px-2 py-0.5 rounded-full inline-block ${prod.stockBoxes > 0 || (prod.slabs?.filter((s: any) => !s.isSold).length || 0) > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
            {isSlabCat
              ? `${prod.slabs?.filter((s: any) => !s.isSold).length || 0} slabs available`
              : `Stock: ${prod.stockBoxes} boxes`}
          </div>
        )}
      </div>
    );
  };

  // ── Customer Portal: send OTP ─────────────────────────────────────────────
  const sendPortalOtp = () => {
    if (!portalMobile || portalMobile.length < 10) { setPortalOtpError('Enter a valid mobile number'); return; }
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    setPortalGenOtp(otp);
    setPortalOtpSent(true);
    setPortalOtpError('');
    alert(`[DEMO] OTP for ${portalMobile}: ${otp}`);
  };

  const verifyPortalOtp = () => {
    if (portalOtp === portalGenOtp) {
      setPortalVerified(true);
      setPortalOtpError('');
      // Find all leads for this mobile
      const myLeads = store.galleryLeads.filter(l => l.customerMobile === portalMobile);
      setPortalLeads(myLeads);
    } else {
      setPortalOtpError('Invalid OTP. Try again.');
    }
  };

  const getPortalLeadQuotation = (lead: GalleryLead) =>
    lead.convertedQuotationId ? store.quotations.find(q => q.id === lead.convertedQuotationId) : null;

  const getPortalLeadSale = (lead: GalleryLead) =>
    lead.convertedSaleId ? store.sales.find(s => s.id === lead.convertedSaleId) : null;

  const inp = "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-amber-400 transition-all";

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase italic">Gallery Leads</h1>
          <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mt-1">Inbound interests · Slab selection · Convert to Quotation → Sale</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowPortal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-indigo-700 transition-all">
            <i className="fas fa-user text-xs"></i> Customer Portal
          </button>
          <button onClick={fetchLeads} disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-50 transition-all">
            <i className={`fas fa-sync-alt text-xs ${isLoading ? 'animate-spin' : ''}`}></i> Refresh
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Leads',  val: stats.total,                        cls: 'bg-white' },
          { label: 'New / Pending',val: stats.new,                          cls: 'bg-amber-50', vcls: 'text-amber-700' },
          { label: 'Converted',    val: stats.converted,                    cls: 'bg-emerald-50', vcls: 'text-emerald-700' },
          { label: 'Pipeline Value',val: curr(stats.value),                 cls: 'bg-indigo-50', vcls: 'text-indigo-700' },
        ].map(({ label, val, cls, vcls }) => (
          <div key={label} className={`${cls} border border-slate-100 rounded-[20px] p-4 shadow-sm`}>
            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
            <div className={`text-2xl font-black ${vcls || 'text-slate-900'}`}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── View mode + filters ── */}
      <div className="bg-white border border-slate-100 rounded-[24px] p-4 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="flex gap-1 bg-slate-100 rounded-2xl p-1">
          {(['daily','history'] as const).map(m => (
            <button key={m} onClick={() => { setViewMode(m); setPage(1); }}
              className={`px-5 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${viewMode === m ? 'bg-white text-slate-900 shadow' : 'text-slate-400 hover:text-slate-600'}`}>
              {m === 'daily' ? 'Today' : 'History'}
            </button>
          ))}
        </div>
        {viewMode === 'history' && (
          <>
            <input type="date" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }} />
            <span className="text-slate-400 text-xs">to</span>
            <input type="date" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }} />
          </>
        )}
        <select className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="All">All Status</option>
          {['New','Responded','Converted','Cancelled'].map(s => <option key={s}>{s}</option>)}
        </select>
        <div className="flex-1 min-w-[180px] flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <i className="fas fa-search text-slate-300 text-xs"></i>
          <input className="flex-1 bg-transparent font-bold text-sm outline-none" placeholder="Name or mobile…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {/* ── Lead grid + Detail panel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Lead cards */}
        <div className="lg:col-span-2 space-y-3">
          {isLoading ? (
            <div className="py-16 text-center">
              <div className="text-3xl text-amber-500 animate-spin mb-3"><i className="fas fa-circle-notch"></i></div>
              <div className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Loading…</div>
            </div>
          ) : leads.length === 0 ? (
            <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-[24px]">
              <div className="text-slate-300 font-black text-lg uppercase">No leads found</div>
            </div>
          ) : leads.map(lead => (
            <div key={lead.id} onClick={() => { setSelectedLead(lead); setShowDetail(true); }}
              className={`bg-white border-2 rounded-[24px] p-5 cursor-pointer hover:shadow-md transition-all ${selectedLead?.id === lead.id ? 'border-amber-400 shadow-md' : 'border-slate-100'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-black text-slate-900 text-base truncate">{lead.customerName}</div>
                  <div className="text-[9px] font-bold text-slate-400 flex items-center gap-3 mt-0.5">
                    <span><i className="fas fa-phone text-[8px] mr-1"></i>{lead.customerMobile}</span>
                    {lead.customerPlace && <span><i className="fas fa-map-marker-alt text-[8px] mr-1"></i>{lead.customerPlace}</span>}
                  </div>
                </div>
                <span className={`text-[8px] font-black px-2 py-1 rounded-full border ${STATUS_STYLE[lead.status] || 'bg-slate-100 text-slate-500'}`}>{lead.status}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {lead.items.slice(0, 3).map((item, i) => {
                  const isSlabCat = ['Kadapa','Granite','Marble'].includes((item as any).category || '');
                  return (
                    <span key={i} className="text-[9px] font-bold bg-slate-50 border border-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">
                      {item.productName}
                      {isSlabCat && (item as any).slabDetails?.length > 0
                        ? ` (${(item as any).slabDetails.length} slabs)`
                        : ` (${item.requestedSqft} sqft)`}
                    </span>
                  );
                })}
                {lead.items.length > 3 && <span className="text-[9px] text-slate-400 font-bold">+{lead.items.length - 3} more</span>}
              </div>

              <div className="mt-3 flex justify-between items-center">
                <div className="font-black text-slate-800">{curr(lead.totalAmount)}</div>
                <div className="text-[8px] text-slate-400 font-bold">{new Date(lead.timestamp).toLocaleString()}</div>
              </div>

              {lead.followUpDate && (
                <div className="mt-2 text-[8px] font-black text-blue-600 bg-blue-50 rounded-xl px-3 py-1.5">
                  <i className="fas fa-clock mr-1"></i> Follow-up: {new Date(lead.followUpDate).toLocaleString()}
                </div>
              )}
            </div>
          ))}

          {/* Pagination */}
          {totalLeads > LIMIT && (
            <div className="flex justify-center gap-2 pt-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-black text-[9px] uppercase disabled:opacity-40">← Prev</button>
              <span className="px-4 py-2 font-bold text-sm text-slate-500">{page} / {Math.ceil(totalLeads / LIMIT)}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(totalLeads / LIMIT)}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-black text-[9px] uppercase disabled:opacity-40">Next →</button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3">
          {!selectedLead || !showDetail ? (
            <div className="h-full min-h-[400px] flex items-center justify-center border-2 border-dashed border-slate-200 rounded-[28px]">
              <div className="text-center">
                <i className="fas fa-hand-pointer text-4xl text-slate-200 mb-3"></i>
                <div className="text-slate-300 font-black uppercase text-sm">Select a lead to review</div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-100 rounded-[28px] shadow-sm overflow-hidden">
              {/* Detail header */}
              <div className="bg-slate-900 text-white p-6 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Gallery Lead #{selectedLead.id.slice(-6).toUpperCase()}</div>
                    <div className="text-2xl font-black mt-1">{selectedLead.customerName}</div>
                    <div className="text-sm text-slate-400 font-bold mt-0.5 flex items-center gap-3">
                      <span><i className="fas fa-phone mr-1"></i>{selectedLead.customerMobile}</span>
                      {selectedLead.customerPlace && <span><i className="fas fa-map-marker-alt mr-1"></i>{selectedLead.customerPlace}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`text-[9px] font-black px-3 py-1 rounded-full border ${STATUS_STYLE[selectedLead.status]}`}>{selectedLead.status}</span>
                    <div className="text-amber-400 font-black text-xl">{curr(selectedLead.totalAmount)}</div>
                    {selectedLead.totalDiscount && selectedLead.totalDiscount > 0 && (
                      <div className="text-[9px] text-slate-400 font-bold">Discount: {curr(selectedLead.totalDiscount)}</div>
                    )}
                  </div>
                </div>
                <div className="text-[9px] text-slate-500">{new Date(selectedLead.timestamp).toLocaleString()} · {selectedLead.source}</div>
                {selectedLead.remarks && (
                  <div className="bg-white/5 rounded-xl px-4 py-2 text-sm font-bold text-slate-300">{selectedLead.remarks}</div>
                )}
              </div>

              {/* Items */}
              <div className="p-5 space-y-3">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Order Items ({selectedLead.items.length})</div>
                {selectedLead.items.map((item, i) => renderLeadItem(item, i))}

                {/* Financial summary */}
                <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-slate-600">Subtotal</span>
                    <span className="font-black text-slate-800">{curr(selectedLead.totalAmount + (selectedLead.totalDiscount || 0))}</span>
                  </div>
                  {(selectedLead.totalDiscount || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="font-bold text-rose-500">Discount</span>
                      <span className="font-black text-rose-500">-{curr(selectedLead.totalDiscount || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base border-t border-slate-200 pt-2">
                    <span className="font-black text-slate-800">Total</span>
                    <span className="font-black text-emerald-700">{curr(selectedLead.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="px-5 pb-5 space-y-2">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Actions</div>

                {/* Status buttons */}
                <div className="flex flex-wrap gap-2">
                  {(['New','Responded','Converted','Cancelled'] as const).filter(s => s !== selectedLead.status).map(s => (
                    <button key={s} onClick={() => updateStatus(selectedLead.id, s)}
                      className={`px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${
                        s === 'Cancelled' ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' :
                        s === 'Converted' ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' :
                        'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      Mark {s}
                    </button>
                  ))}
                  <button onClick={() => setShowFollowUp(true)}
                    className="px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all">
                    <i className="fas fa-clock mr-1"></i> Follow-up
                  </button>
                </div>

                {/* Primary CTA: Convert to Quotation */}
                {selectedLead.status !== 'Cancelled' && selectedLead.status !== 'Converted' && (
                  <button onClick={() => handleConvertToQuotation(selectedLead)}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-700 transition-all active:scale-95 flex items-center justify-center gap-2">
                    <i className="fas fa-file-alt"></i> Convert to Quotation
                  </button>
                )}

                {/* WhatsApp share */}
                <button onClick={() => {
                  const items = selectedLead.items.map(i => {
                    const isSlab = ['Kadapa','Granite','Marble'].includes((i as any).category || '');
                    const slabInfo = (i as any).slabDetails?.length > 0
                      ? `\n    Slabs: ${(i as any).slabDetails.map((s: any) => `#${s.slabNo} (${s.sqft} sqft)`).join(', ')}`
                      : '';
                    return `• ${i.productName}: ${i.requestedSqft} sqft${slabInfo} — ${curr(i.totalValue)}`;
                  }).join('\n');
                  const msg = `Hello ${selectedLead.customerName}!\n\nWe received your gallery order:\n${items}\n\nTotal: ${curr(selectedLead.totalAmount)}\n\nWe'll contact you shortly to confirm. — ${store.settings.showroomName}`;
                  window.open(`https://wa.me/${selectedLead.customerMobile}?text=${encodeURIComponent(msg)}`, '_blank');
                }} className="w-full py-3 bg-emerald-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-2">
                  <i className="fab fa-whatsapp text-sm"></i> WhatsApp Customer
                </button>

                {/* Conversion status */}
                {selectedLead.convertedQuotationId && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 text-[9px] font-black text-emerald-700">
                    <i className="fas fa-check-circle mr-1"></i> Quotation created · ID: {selectedLead.convertedQuotationId.slice(-8).toUpperCase()}
                  </div>
                )}
                {selectedLead.convertedSaleId && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 text-[9px] font-black text-blue-700">
                    <i className="fas fa-file-invoice mr-1"></i> Invoice created · ID: {selectedLead.convertedSaleId.slice(-8).toUpperCase()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Follow-up Modal ── */}
      {showFollowUp && selectedLead && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[500] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] p-8 w-full max-w-md shadow-2xl space-y-5">
            <h3 className="text-xl font-black uppercase tracking-tight">Schedule Follow-up</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Date</label>
                <input type="date" className={inp} value={followDate} onChange={e => setFollowDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Time</label>
                <input type="time" className={inp} value={followTime} onChange={e => setFollowTime(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={saveFollowUp} className="flex-1 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-slate-700">Save</button>
              <button onClick={() => setShowFollowUp(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Customer Portal Modal ── */}
      {showPortal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

            {/* Portal header */}
            <div className="bg-slate-900 text-white p-6 flex justify-between items-center shrink-0">
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Customer Portal</div>
                <div className="text-2xl font-black mt-1">{store.settings.showroomName}</div>
                <div className="text-[10px] text-slate-400 font-bold mt-0.5">View your orders, quotations & invoices</div>
              </div>
              <button onClick={() => { setShowPortal(false); setPortalVerified(false); setPortalMobile(''); setPortalOtp(''); setPortalLeads([]); setSelectedPortalLead(null); }}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20">
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              {!portalVerified ? (
                /* OTP login */
                <div className="space-y-4 max-w-sm mx-auto">
                  <div className="text-center py-4">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <i className="fas fa-mobile-alt text-amber-500 text-2xl"></i>
                    </div>
                    <div className="font-black text-slate-800 text-lg">Login with Mobile</div>
                    <div className="text-[10px] text-slate-400 font-bold mt-1">Enter your registered mobile number to view your orders</div>
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Mobile Number</label>
                    <input type="tel" className={inp} placeholder="+91 XXXXX XXXXX" value={portalMobile} onChange={e => setPortalMobile(e.target.value)} />
                  </div>
                  {!portalOtpSent ? (
                    <button onClick={sendPortalOtp} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-700">
                      Send OTP
                    </button>
                  ) : (
                    <>
                      <div>
                        <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Enter OTP</label>
                        <input type="text" className={inp} placeholder="4-digit OTP" maxLength={4} value={portalOtp} onChange={e => setPortalOtp(e.target.value)} />
                      </div>
                      {portalOtpError && <div className="text-[10px] text-rose-500 font-bold">{portalOtpError}</div>}
                      <button onClick={verifyPortalOtp} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700">
                        Verify & Login
                      </button>
                      <button onClick={sendPortalOtp} className="w-full text-[9px] text-slate-400 font-bold underline text-center">Resend OTP</button>
                    </>
                  )}
                </div>
              ) : selectedPortalLead ? (
                /* Lead detail view */
                <div className="space-y-5">
                  <button onClick={() => setSelectedPortalLead(null)} className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase hover:text-slate-700">
                    <i className="fas fa-arrow-left text-xs"></i> Back to my orders
                  </button>

                  <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                    <div className="font-black text-slate-800">Order #{selectedPortalLead.id.slice(-6).toUpperCase()}</div>
                    <div className="text-[9px] text-slate-400 font-bold">{new Date(selectedPortalLead.timestamp).toLocaleString()}</div>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${STATUS_STYLE[selectedPortalLead.status]}`}>{selectedPortalLead.status}</span>
                  </div>

                  {/* Items */}
                  <div className="space-y-2">
                    <div className="text-[9px] font-black text-slate-400 uppercase">Your Items</div>
                    {selectedPortalLead.items.map((item, i) => renderLeadItem(item, i))}
                    <div className="flex justify-between font-black text-base border-t border-slate-100 pt-3 mt-3">
                      <span>Total</span>
                      <span className="text-emerald-700">{curr(selectedPortalLead.totalAmount)}</span>
                    </div>
                  </div>

                  {/* Quotation view */}
                  {(() => {
                    const q = getPortalLeadQuotation(selectedPortalLead);
                    if (!q) return null;
                    return (
                      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-2">
                        <div className="font-black text-blue-700 flex items-center gap-2"><i className="fas fa-file-alt"></i> Quotation Created</div>
                        <div className="text-[9px] font-bold text-blue-600">#{q.quotationNo} · {q.date}</div>
                        <div className="text-base font-black text-blue-800">{curr(q.totalAmount)}</div>
                        <div className="text-[9px] text-blue-500 font-bold">Contact us to confirm your order</div>
                      </div>
                    );
                  })()}

                  {/* Sale/Invoice view */}
                  {(() => {
                    const s = getPortalLeadSale(selectedPortalLead);
                    if (!s) return null;
                    return (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
                        <div className="font-black text-emerald-700 flex items-center gap-2"><i className="fas fa-file-invoice"></i> Invoice Generated</div>
                        <div className="text-[9px] font-bold text-emerald-600">#{s.invoiceNo} · {s.date}</div>
                        <div className="grid grid-cols-3 gap-2 text-xs mt-2">
                          <div className="bg-white rounded-xl p-2 text-center">
                            <div className="text-[7px] font-black text-slate-400 uppercase">Total</div>
                            <div className="font-black text-slate-800">{curr(s.totalAmount)}</div>
                          </div>
                          <div className="bg-white rounded-xl p-2 text-center">
                            <div className="text-[7px] font-black text-slate-400 uppercase">Paid</div>
                            <div className="font-black text-emerald-700">{curr(s.amountPaid)}</div>
                          </div>
                          <div className="bg-white rounded-xl p-2 text-center">
                            <div className="text-[7px] font-black text-slate-400 uppercase">Balance</div>
                            <div className={`font-black ${s.balance > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>{curr(s.balance)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                /* Order list */
                <div className="space-y-3">
                  <div className="text-sm font-black text-slate-800">
                    Welcome, {portalLeads[0]?.customerName || portalMobile}
                    <span className="text-[9px] text-slate-400 font-bold ml-2">({portalLeads.length} order{portalLeads.length !== 1 ? 's' : ''})</span>
                  </div>
                  {portalLeads.length === 0 ? (
                    <div className="text-center py-10 text-slate-300 font-black text-sm uppercase">No orders found for this number</div>
                  ) : portalLeads.map(lead => (
                    <button key={lead.id} onClick={() => setSelectedPortalLead(lead)}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-left hover:border-amber-300 hover:shadow-md transition-all space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-black text-slate-800">Order #{lead.id.slice(-6).toUpperCase()}</div>
                          <div className="text-[9px] text-slate-400 font-bold">{new Date(lead.timestamp).toLocaleString()}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${STATUS_STYLE[lead.status]}`}>{lead.status}</span>
                          <div className="font-black text-slate-700">{curr(lead.totalAmount)}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {lead.items.slice(0, 3).map((item, i) => (
                          <span key={i} className="text-[9px] bg-white border border-slate-100 text-slate-600 px-2 py-0.5 rounded-lg font-bold">{item.productName}</span>
                        ))}
                      </div>
                      {lead.convertedQuotationId && <div className="text-[8px] font-black text-blue-600"><i className="fas fa-file-alt mr-1"></i>Quotation ready</div>}
                      {lead.convertedSaleId && <div className="text-[8px] font-black text-emerald-600"><i className="fas fa-check-circle mr-1"></i>Invoice generated</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GalleryLeads;
