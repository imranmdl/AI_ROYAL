/**
 * VendorSupplyChain.tsx
 * Complete vendor supply chain management with:
 * - Dual invoice system (Billing Invoice vs Actual/Dispatch Invoice)
 * - Per-item cost tracking (billed vs actual)
 * - Transport tracking (per-ton rate, loading/unloading, driver expenses)
 * - Auto-inward to inventory on receive
 * - Vendor analytics (margins, profit, quality, damage tracking)
 */
import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../store';
import QuickAddInward from './QuickAddInward';
import type { VendorOrder, VendorOrderItem, VendorTransport, VendorInvoice } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => `vo-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
const itemUid = () => `item-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
const fmt = (n: number) => '₹' + (n||0).toLocaleString('en-IN', { maximumFractionDigits:2 });
const pct = (n: number) => (n||0).toFixed(1) + '%';

const BLANK_TRANSPORT = (): VendorTransport => ({
  vehicleNo:'', driverName:'', driverPhone:'', transporterName:'',
  totalWeightTons:0, ratePerTon:3500, freightCost:0,
  loadingCharges:0, unloadingCharges:0, driverExpenses:0, totalTransportCost:0,
});

const BLANK_INVOICE = (): VendorInvoice => ({
  invoiceNo:'', invoiceDate: new Date().toISOString().slice(0,10),
  subtotal:0, gstPct:0, gstAmount:0, total:0, notes:'',
});

const calcTransport = (t: VendorTransport): VendorTransport => {
  const freight = (t.totalWeightTons||0) * (t.ratePerTon||0);
  const total   = freight + (t.loadingCharges||0) + (t.unloadingCharges||0) + (t.driverExpenses||0);
  return { ...t, freightCost: freight, totalTransportCost: total };
};

const calcItem = (item: VendorOrderItem, transportPerUnit: number, laborPerUnit: number): VendorOrderItem => {
  const billed   = (item.billedQty||0) * (item.billedRate||0);
  const actual   = (item.actualQty||0) * (item.actualRate||0);
  const good     = Math.max(0, (item.receivedQty||0) - (item.damagedQty||0));
  // Use actualQty as denominator when not yet received (good=0) so landed is always shown
  const denom    = good > 0 ? good : (item.actualQty||0);
  const transAmt = transportPerUnit * (item.actualQty||0);
  const laborAmt = laborPerUnit * (item.actualQty||0);
  const landed   = denom > 0 ? (actual + transAmt + laborAmt) / denom : 0;
  const margin   = item.sellingPrice > 0 ? ((item.sellingPrice - landed) / item.sellingPrice) * 100 : 0;
  return { ...item, billedAmount: billed, actualAmount: actual, goodQty: good,
    transportShare: transAmt, laborShare: laborAmt,
    landedCostPerUnit: landed, marginPct: margin };
};

// ── Main Component ────────────────────────────────────────────────────────────
const VendorSupplyChain: React.FC = () => {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = store.subscribe(() => forceUpdate(n => n + 1), (s) => s.vendorOrders);
    return unsub;
  }, []);

  const orders = store.vendorOrders || [];
  const products = store.products || [];
  const [view, setView] = useState<'list'|'new'|'edit'|'analytics'>('list');
  const [selected, setSelected] = useState<VendorOrder|null>(null);
  const [analyticsVendor, setAnalyticsVendor] = useState<string>('ALL');
  const [searchQ, setSearchQ] = useState('');
  const [statusF, setStatusF] = useState('All');

  const filtered = useMemo(() => orders
    .filter(o => statusF === 'All' || o.status === statusF)
    .filter(o => !searchQ || o.vendorName.toLowerCase().includes(searchQ.toLowerCase()) || o.orderNo.includes(searchQ))
    .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0)), [orders, searchQ, statusF]);

  const statusColors: Record<string,string> = {
    Draft:'bg-slate-100 text-slate-600', Ordered:'bg-blue-100 text-blue-700',
    'In Transit':'bg-amber-100 text-amber-700', 'Partially Received':'bg-orange-100 text-orange-700',
    Received:'bg-emerald-100 text-emerald-700', Closed:'bg-gray-100 text-gray-600',
  };

  // ── Analytics data ─────────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    const src = analyticsVendor === 'ALL' ? orders : orders.filter(o => o.vendorName === analyticsVendor);
    const received = src.filter(o => ['Received','Closed','Partially Received'].includes(o.status));
    const totalActual    = src.reduce((s,o) => s+(o.totalActualAmount||0), 0);
    const totalTransport = src.reduce((s,o) => s+(o.totalTransportCost||0), 0);
    const totalLabor     = src.reduce((s,o) => s+(o.laborCharges||0), 0);
    const totalLanded    = totalActual + totalTransport + totalLabor;

    // Potential revenue based on selling prices set in order items
    const tPerUnitAll = totalActual > 0 ? totalTransport / src.reduce((s,o)=>s+o.items.reduce((si,i)=>si+(i.actualQty||0),0),0) : 0;
    const potentialRevenue = src.reduce((s,o) => {
      const tpu = o.items.length > 0 ? (o.totalTransportCost||0) / o.items.reduce((si,i)=>si+(i.actualQty||0),1) : 0;
      const lpu = o.items.length > 0 ? (o.laborCharges||0) / o.items.reduce((si,i)=>si+(i.actualQty||0),1) : 0;
      return s + o.items.reduce((is,i) => {
        const qty = i.actualQty||0;
        const selling = i.sellingPrice||0;
        return is + (qty * selling);
      }, 0);
    }, 0);
    const potentialProfit = potentialRevenue - totalLanded;
    const potentialMargin = potentialRevenue > 0 ? (potentialProfit/potentialRevenue)*100 : 0;

    // Realized revenue from actual sales of vendor products
    const sales = store.sales || [];
    const vendorProductIds = new Set(src.flatMap(o=>o.items.map(i=>i.productId)));
    const vendorSales = (sales as any[]).filter((s:any) => s.items?.some((i:any)=>vendorProductIds.has(i.productId)));
    const totalSaleValue = vendorSales.reduce((s:number,sale:any)=>s+(sale.totalAmount||0),0);
    const realizedProfit = totalSaleValue - totalLanded;
    const realizedMargin = totalSaleValue > 0 ? (realizedProfit/totalSaleValue)*100 : 0;

    const totalDamaged = src.reduce((s,o)=>s+o.damagedItems.reduce((ds,d)=>ds+(d.qtyDamaged||0),0),0);
    const allItems = src.flatMap(o=>o.items);
    const avgQuality = allItems.filter(i=>i.qualityRating).length
      ? allItems.reduce((s,i)=>s+(i.qualityRating||0),0)/allItems.filter(i=>i.qualityRating).length : 0;
    const totalOrders = src.length;
    return { totalOrders, totalActual, totalTransport, totalLanded,
             potentialRevenue, potentialProfit, potentialMargin,
             totalSaleValue, realizedProfit, realizedMargin, totalDamaged, avgQuality };
  }, [orders, analyticsVendor]);

  const vendors = [...new Set(orders.map(o=>o.vendorName).filter(Boolean))].sort();

  if (view === 'new' || view === 'edit') {
    return <OrderForm order={selected} products={products}
      onSave={o=>{ store.saveVendorOrder(o); setView('list'); setSelected(null); }}
      onCancel={()=>{ setView('list'); setSelected(null); }} />;
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-white font-black text-2xl">Vendor Supply Chain</h2>
          <p className="text-slate-400 text-sm font-bold mt-0.5">Purchase orders · Dual invoices · Transport · Inventory linkage</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>setView(view==='analytics'?'list':'analytics')}
            className={`px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 ${view==='analytics'?'bg-purple-600 text-white':'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'}`}>
            <i className="fas fa-chart-bar text-xs"></i>Analytics
          </button>
          <button onClick={()=>{ setSelected(null); setView('new'); }}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2">
            <i className="fas fa-plus text-xs"></i>New Purchase Order
          </button>
        </div>
      </div>

      {/* ── Analytics Panel ── */}
      {view === 'analytics' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <select value={analyticsVendor} onChange={e=>setAnalyticsVendor(e.target.value)}
              className="px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold text-sm outline-none focus:border-amber-400">
              <option value="ALL">All Vendors</option>
              {vendors.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
            <span className="text-slate-400 text-sm font-bold">{analytics.totalOrders} orders</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label:'Total Landed Cost', val:fmt(analytics.totalLanded), icon:'fa-rupee-sign', color:'text-amber-400', sub:`Actual: ${fmt(analytics.totalActual)} + Transport: ${fmt(analytics.totalTransport)}` },
              { label:'Potential Revenue', val:fmt(analytics.potentialRevenue), icon:'fa-chart-pie', color:'text-blue-400', sub:`Based on selling prices in orders` },
              { label:'Potential Profit', val:fmt(analytics.potentialProfit), icon:'fa-chart-line', color: analytics.potentialProfit>=0?'text-emerald-400':'text-rose-400', sub:`Margin: ${pct(analytics.potentialMargin)}` },
              { label:'Realized Profit', val:fmt(analytics.realizedProfit), icon:'fa-check-circle', color: analytics.realizedProfit>=0?'text-emerald-400':'text-rose-400', sub:`Sales: ${fmt(analytics.totalSaleValue)} · Margin: ${pct(analytics.realizedMargin)}` },
              { label:'Damaged Items', val:analytics.totalDamaged.toString(), icon:'fa-exclamation-triangle', color:'text-rose-400', sub:`Avg quality: ${analytics.avgQuality.toFixed(1)}/5` },
            ].map(c=>(
              <div key={c.label} className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <i className={`fas ${c.icon} ${c.color} text-sm`}></i>
                  <span className="text-slate-400 text-[9px] font-black uppercase tracking-widest">{c.label}</span>
                </div>
                <div className={`font-black text-xl ${c.color}`}>{c.val}</div>
                <div className="text-slate-500 text-[10px] font-bold mt-1">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Per-vendor table */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <span className="text-white font-black text-sm">Vendor-wise Performance</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-white/5">
                  <tr>{['Vendor','Orders','Billed','Actual','Transport','Landed','Potential Rev','Potential Profit','Margin','Realized Sales','Damaged'].map(h=>(
                    <th key={h} className="px-4 py-2.5 text-left text-[9px] font-black text-slate-400 uppercase whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {vendors.map(v=>{
                    const vo = orders.filter(o=>o.vendorName===v);
                    const rc = vo.filter(o=>['Received','Closed'].includes(o.status));
                    const billed = vo.reduce((s,o)=>s+(o.totalBilledAmount||0),0);
                    const actual = vo.reduce((s,o)=>s+(o.totalActualAmount||0),0);
                    const trans  = vo.reduce((s,o)=>s+(o.totalTransportCost||0),0);
                    const labor  = vo.reduce((s,o)=>s+(o.laborCharges||0),0);
                    const landed = actual+trans+labor;
                    const potRev = vo.reduce((s,o)=>s+o.items.reduce((is,i)=>is+(i.actualQty||0)*(i.sellingPrice||0),0),0);
                    const potProfit = potRev - landed;
                    const potMargin = potRev>0?(potProfit/potRev)*100:0;
                    const pids   = new Set(vo.flatMap(o=>o.items.map(i=>i.productId)));
                    const sv     = (store.sales||[]).filter((s:any)=>s.items?.some((i:any)=>pids.has(i.productId))).reduce((s:number,x:any)=>s+(x.totalAmount||0),0);
                    const damaged= vo.reduce((s,o)=>s+o.damagedItems.reduce((d,x)=>d+(x.qtyDamaged||0),0),0);
                    return (
                      <tr key={v} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={()=>{ setAnalyticsVendor(v); }}>
                        <td className="px-4 py-3 text-white font-bold">{v}</td>
                        <td className="px-4 py-3 text-slate-300">{vo.length}</td>
                        <td className="px-4 py-3 text-amber-400">{fmt(billed)}</td>
                        <td className="px-4 py-3 text-blue-400">{fmt(actual)}</td>
                        <td className="px-4 py-3 text-slate-300">{fmt(trans)}</td>
                        <td className="px-4 py-3 text-white font-bold">{fmt(landed)}</td>
                        <td className="px-4 py-3 text-purple-400">{fmt(potRev)}</td>
                        <td className={`px-4 py-3 font-bold ${potProfit>=0?'text-emerald-400':'text-rose-400'}`}>{fmt(potProfit)} <span className="text-[9px] opacity-70">{pct(potMargin)}</span></td>
                        <td className="px-4 py-3 text-slate-400 text-[9px]">potential</td>
                        <td className="px-4 py-3 text-emerald-400">{fmt(sv)}</td>
                        <td className={`px-4 py-3 ${damaged>0?'text-rose-400':'text-slate-500'}`}>{damaged}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Order List ── */}
      {view === 'list' && (
        <>
          <div className="flex gap-3 flex-wrap">
            <input type="text" placeholder="Search vendor or order#…" value={searchQ} onChange={e=>setSearchQ(e.target.value)}
              className="flex-1 min-w-[200px] px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold text-sm outline-none focus:border-amber-400 placeholder:text-slate-600" />
            <select value={statusF} onChange={e=>setStatusF(e.target.value)}
              className="px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold text-sm outline-none focus:border-amber-400">
              {['All','Draft','Ordered','In Transit','Partially Received','Received','Closed'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="space-y-3">
            {filtered.length === 0 && (
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-10 text-center">
                <i className="fas fa-truck text-slate-700 text-3xl mb-3 block"></i>
                <div className="text-slate-400 font-bold">No orders yet</div>
                <button onClick={()=>{ setSelected(null); setView('new'); }}
                  className="mt-4 px-5 py-2.5 bg-amber-500 text-white rounded-xl font-black text-[10px] uppercase">
                  Create First Order
                </button>
              </div>
            )}
            {filtered.map(o=>{
              const totalQty  = o.items.reduce((s,i)=>s+(i.actualQty||i.qtyBoxes||0),0);
              const receivedQ = o.items.reduce((s,i)=>s+(i.receivedQty||0),0);
              const pctRecv   = totalQty>0 ? Math.round((receivedQ/totalQty)*100) : 0;
              return (
                <div key={o.id} className="bg-slate-900 border border-white/10 rounded-2xl p-5 hover:border-amber-500/30 transition-all">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-black text-sm">{o.vendorName}</span>
                        <span className="text-slate-500 text-[10px] font-bold">#{o.orderNo}</span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusColors[o.status]||'bg-slate-100 text-slate-600'}`}>{o.status}</span>
                        {o.paymentStatus==='Pending' && o.balanceAmount>0 && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-rose-100 text-rose-600">Due: {fmt(o.balanceAmount)}</span>
                        )}
                      </div>
                      <div className="flex gap-4 mt-2 flex-wrap">
                        <span className="text-slate-400 text-[10px] font-bold"><i className="fas fa-calendar mr-1"></i>{o.orderDate}</span>
                        <span className="text-slate-400 text-[10px] font-bold"><i className="fas fa-box mr-1"></i>{o.items.length} items</span>
                        <span className="text-amber-400 text-[10px] font-bold">Billed: {fmt(o.totalBilledAmount||0)}</span>
                        <span className="text-blue-400 text-[10px] font-bold">Actual: {fmt(o.totalActualAmount||0)}</span>
                        {o.totalTransportCost>0 && <span className="text-purple-400 text-[10px] font-bold">Transport: {fmt(o.totalTransportCost)}</span>}
                      </div>
                      {totalQty > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{width:`${pctRecv}%`}}></div>
                          </div>
                          <span className="text-[9px] font-bold text-slate-400">{pctRecv}% received</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={()=>{ setSelected(o); setView('edit'); }}
                        className="px-3 py-2 bg-white/5 border border-white/10 text-white rounded-xl font-black text-[10px] uppercase hover:bg-amber-500/20 hover:border-amber-500/40 transition-all">
                        <i className="fas fa-edit text-xs mr-1"></i>Edit
                      </button>
                      <button onClick={async ()=>{
                        const reverse = confirm(
                          `Delete order #${o.orderNo} (${o.vendorName})?\n\n` +
                          `Click OK to also REMOVE the stock this order added to inventory ` +
                          `(${o.items.reduce((s,i)=>s+(i.goodQty||i.receivedQty||0),0)} units across ${o.items.length} item(s)).\n\n` +
                          `Click Cancel to delete the order record only and keep current stock as-is.`
                        );
                        const proceed = confirm(
                          reverse
                            ? `This will delete the order AND subtract ${o.items.reduce((s,i)=>s+(i.goodQty||i.receivedQty||0),0)} units from inventory stock. Continue?`
                            : `This will delete order #${o.orderNo} but keep current inventory stock unchanged. Continue?`
                        );
                        if (!proceed) return;
                        await store.deleteVendorOrder(o.id, reverse);
                      }}
                        className="px-3 py-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl font-black text-[10px] uppercase hover:bg-rose-500/20 hover:border-rose-500/40 transition-all">
                        <i className="fas fa-trash text-xs mr-1"></i>Delete
                      </button>
                    </div>
                  </div>
                  {/* Damage alerts */}
                  {o.damagedItems.length > 0 && (
                    <div className="mt-3 px-3 py-2 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2">
                      <i className="fas fa-exclamation-triangle text-rose-400 text-xs"></i>
                      <span className="text-rose-400 text-[10px] font-bold">
                        {o.damagedItems.reduce((s,d)=>s+(d.qtyDamaged||0),0)} damaged units across {o.damagedItems.length} items
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

// ── Order Form (New / Edit) ───────────────────────────────────────────────────
interface FormProps {
  order: VendorOrder | null;
  products: any[];
  onSave: (o: VendorOrder) => void;
  onCancel: () => void;
}

const OrderForm: React.FC<FormProps> = ({ order, products, onSave, onCancel }) => {
  const isEdit = !!order;
  const [tab, setTab] = useState<'basic'|'invoices'|'items'|'transport'|'receive'|'damage'>('basic');

  // ── Re-map item to another vendor ───────────────────────────────────────
  const [remapItem, setRemapItem] = useState<{ productId:string; productName:string } | null>(null);
  const [remapVendorName, setRemapVendorName] = useState('');
  const [remapDate, setRemapDate] = useState(new Date().toISOString().slice(0,10));
  const [remapSaving, setRemapSaving] = useState(false);

  // ── Form state ────────────────────────────────────────────────────────────
  const [vendorName,    setVendorName]    = useState(order?.vendorName || '');
  const [vendorPhone,   setVendorPhone]   = useState(order?.vendorPhone || '');
  const [vendorGst,     setVendorGst]     = useState(order?.vendorGst || '');
  const [vendorAddress, setVendorAddress] = useState(order?.vendorAddress || '');
  const [orderDate,     setOrderDate]     = useState(order?.orderDate || new Date().toISOString().slice(0,10));
  const [expectedDate,  setExpectedDate]  = useState(order?.expectedDeliveryDate || '');
  const [status,        setStatus]        = useState(order?.status || 'Ordered');
  const [remarks,       setRemarks]       = useState(order?.remarks || '');

  const [billingInv,  setBillingInv]  = useState<VendorInvoice>(order?.billingInvoice  || BLANK_INVOICE());
  const [actualInv,   setActualInv]   = useState<VendorInvoice>(order?.actualInvoice   || BLANK_INVOICE());
  /** Controls which invoice panels are shown:
   *  'billing' = only billing invoice
   *  'actual'  = only actual/dispatch invoice
   *  'both'    = show both (default)
   */
  const [invoiceMode, setInvoiceMode] = useState<'billing'|'actual'|'both'>(
    order?.actualInvoice?.invoiceNo ? 'both' : order?.billingInvoice?.invoiceNo ? 'billing' : 'both'
  );

  const [items, setItems] = useState<VendorOrderItem[]>(order?.items?.map(i=>({
    id: (i as any).id || itemUid(),
    productId: i.productId, productName: i.productName,
    category: (i as any).category || '',
    unit: (i as any).unit || 'Box',
    orderedQty: (i as any).orderedQty || i.qtyBoxes || 0,
    billedQty: (i as any).billedQty || i.qtyBoxes || 0,
    billedRate: (i as any).billedRate || i.rate || 0,
    billedAmount: (i as any).billedAmount || 0,
    actualQty: (i as any).actualQty || i.qtyBoxes || 0,
    actualRate: (i as any).actualRate || i.rate || 0,
    actualAmount: (i as any).actualAmount || 0,
    receivedQty: (i as any).receivedQty || 0,
    damagedQty: (i as any).damagedQty || 0,
    goodQty: (i as any).goodQty || 0,
    transportShare: i.transportShare || 0,
    laborShare: (i as any).laborShare || 0,
    landedCostPerUnit: i.landedCost || 0,
    sellingPrice: i.sellingPrice || 0,
    qualityRating: (i as any).qualityRating,
    qualityNotes: (i as any).qualityNotes || '',
  })) || []);

  const [transport, setTransport] = useState<VendorTransport>(order?.transport || BLANK_TRANSPORT());
  const [laborCharges, setLaborCharges] = useState(order?.laborCharges || 0);
  const [miscCharges,  setMiscCharges]  = useState(order?.miscCharges  || 0);
  const [miscDesc,     setMiscDesc]     = useState(order?.miscDescription || '');

  const [paymentMode,   setPaymentMode]   = useState<'Cash'|'RTGS'|'UPI'|'Cheque'>('Cash');
  const [paymentAmt,    setPaymentAmt]    = useState(0);
  const [paymentDate,   setPaymentDate]   = useState(new Date().toISOString().slice(0,10));
  const [paymentRef,    setPaymentRef]    = useState('');
  const [payHistory,    setPayHistory]    = useState(order?.paymentHistory || []);

  const [damagedItems,  setDamagedItems]  = useState(order?.damagedItems || []);
  const [productSearch, setProductSearch] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // ── Computed totals ───────────────────────────────────────────────────────
  const t = calcTransport(transport);
  const totalItems = items.length;
  const totalQtyAll = items.reduce((s,i)=>s+(i.actualQty||0),0);
  const tPerUnit = totalQtyAll > 0 ? t.totalTransportCost / totalQtyAll : 0;
  const lPerUnit = totalQtyAll > 0 ? laborCharges / totalQtyAll : 0;
  const calcedItems = items.map(i => calcItem(i, tPerUnit, lPerUnit));
  const totalBilled  = calcedItems.reduce((s,i)=>s+(i.billedAmount||0),0);
  const totalActual  = calcedItems.reduce((s,i)=>s+(i.actualAmount||0),0);
  const grandTotal   = totalActual + t.totalTransportCost + laborCharges + miscCharges;
  const paidSoFar    = payHistory.reduce((s:number,p:any)=>s+(p.amount||0),0);
  const balance      = grandTotal - paidSoFar;

  // Product selector
  const filteredProds = products.filter(p => !productSearch ||
    p.name?.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.category?.toLowerCase().includes(productSearch.toLowerCase()));

  const addItem = (prod: any) => {
    setItems(prev=>[...prev, {
      id: itemUid(), productId: prod.id, productName: prod.name,
      category: prod.category||'', unit: prod.unitType||'Box',
      orderedQty:0, billedQty:0, billedRate:0, billedAmount:0,
      actualQty:0, actualRate:0, actualAmount:0,
      receivedQty:0, damagedQty:0, goodQty:0,
      transportShare:0, laborShare:0, landedCostPerUnit:0,
      sellingPrice: prod.sellingPrice||0,
    }]);
    setProductSearch('');
  };

  const updateItem = (idx: number, key: string, val: any) => {
    setItems(prev => prev.map((item,i)=> i!==idx ? item : { ...item, [key]: val }));
  };

  const addPayment = () => {
    if (paymentAmt <= 0) return;
    const p = { id:`vpay-${Date.now()}`, date:paymentDate, mode:paymentMode,
      amount:paymentAmt, referenceNo:paymentRef, remarks:'', paymentSlip:'' };
    setPayHistory(prev=>[...prev, p]);
    setPaymentAmt(0); setPaymentRef('');
  };

  const save = () => {
    if (!vendorName.trim()) { alert('Enter vendor name'); return; }
    const tr = calcTransport(transport);

    // Sync hidden invoice values: billing-only → copy billing to actual, actual-only → copy actual to billing
    const syncedItems = calcedItems.map(it => {
      if (invoiceMode === 'billing') {
        const qty = it.actualQty || it.billedQty || 0;
        const rate = it.actualRate || it.billedRate || 0;
        return { ...it, actualQty: qty, actualRate: rate, actualAmount: qty * rate };
      } else if (invoiceMode === 'actual') {
        const qty = it.billedQty || it.actualQty || 0;
        const rate = it.billedRate || it.actualRate || 0;
        return { ...it, billedQty: qty, billedRate: rate, billedAmount: qty * rate };
      }
      return it;
    });
    // Also sync billing/actual invoice totals based on mode
    const finalBillingInv  = invoiceMode === 'actual'  ? { ...billingInv,  ...actualInv  } : billingInv;
    const finalActualInv   = invoiceMode === 'billing' ? { ...actualInv,   ...billingInv } : actualInv;

    const newOrder: VendorOrder = {
      id: order?.id || uid(),
      orderNo: order?.orderNo || `ORD-${Math.floor(Math.random()*900000)+100000}`,
      vendorName: vendorName.trim(), vendorPhone, vendorGst, vendorAddress,
      orderDate, expectedDeliveryDate: expectedDate, status: status as any,
      paymentStatus: balance <= 0 ? 'Paid' : paidSoFar > 0 ? 'Partial' : 'Pending',
      billingInvoice: finalBillingInv, actualInvoice: finalActualInv,
      items: syncedItems,
      transport: tr,
      laborCharges, miscCharges, miscDescription: miscDesc,
      totalBilledAmount: totalBilled, totalActualAmount: totalActual,
      totalTransportCost: tr.totalTransportCost, grandTotal,
      cashAmount: payHistory.filter((p:any)=>p.mode==='Cash').reduce((s:number,p:any)=>s+p.amount,0),
      rtgsAmount: payHistory.filter((p:any)=>p.mode==='RTGS').reduce((s:number,p:any)=>s+p.amount,0),
      paidAmount: paidSoFar, balanceAmount: Math.max(0, balance),
      paymentHistory: payHistory,
      receivedGodownId: order?.receivedGodownId||'g1',
      damagedItems,
      remarks,
      invoiceFile: order?.invoiceFile,
      updatedAt: Date.now(),
      isFullyReceived: calcedItems.every(i=>(i.receivedQty||0) >= (i.actualQty||0)),
    };
    onSave(newOrder);
  };

  const TABS = [
    { id:'basic',     label:'Vendor & Dates', icon:'fa-store' },
    { id:'invoices',  label:'Invoices',        icon:'fa-file-invoice' },
    { id:'items',     label:'Items',           icon:'fa-boxes', count: items.length },
    { id:'transport', label:'Transport',       icon:'fa-truck' },
    { id:'receive',   label:'Receive & Pay',   icon:'fa-check-circle' },
    { id:'damage',    label:'Damage',          icon:'fa-exclamation-triangle', count: damagedItems.length },
  ] as const;

  const inp = "w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold text-sm outline-none focus:border-amber-400 transition-all placeholder:text-slate-600";
  const label = "text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-white hover:bg-white/20 transition-all">
          <i className="fas fa-arrow-left text-sm"></i>
        </button>
        <div className="flex-1">
          <h2 className="text-white font-black text-lg">{isEdit ? `Edit: ${order?.vendorName}` : 'New Purchase Order'}</h2>
          <div className="flex gap-4 mt-0.5 flex-wrap">
            <span className="text-amber-400 text-[10px] font-bold">Billed: {fmt(totalBilled)}</span>
            <span className="text-blue-400 text-[10px] font-bold">Actual: {fmt(totalActual)}</span>
            <span className="text-purple-400 text-[10px] font-bold">Transport: {fmt(t.totalTransportCost)}</span>
            <span className="text-white font-black text-[10px]">Grand Total: {fmt(grandTotal)}</span>
          </div>
        </div>
        <button onClick={save} className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2">
          <i className="fas fa-save text-xs"></i>Save Order
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap bg-white/5 p-1 rounded-xl">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id as any)}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-black text-[9px] uppercase tracking-wider transition-all ${tab===t.id?'bg-amber-500 text-white':'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <i className={`fas ${t.icon} text-[10px]`}></i>
            <span className="truncate">{t.label}</span>
            {(t as any).count>0 && <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black ${tab===t.id?'bg-white/20':'bg-amber-500 text-white'}`}>{(t as any).count}</span>}
          </button>
        ))}
      </div>

      {/* ── BASIC tab ── */}
      {tab === 'basic' && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={label}>Vendor Name *</label>
              <input className={inp} value={vendorName} onChange={e=>setVendorName(e.target.value)} placeholder="Vendor name or company" list="vendor-list" />
              <datalist id="vendor-list">
                {[...new Set((store.vendorOrders||[]).map(o=>o.vendorName))].map(v=><option key={v} value={v}/>)}
              </datalist>
            </div>
            <div><label className={label}>Phone</label><input className={inp} value={vendorPhone} onChange={e=>setVendorPhone(e.target.value)} placeholder="+91 9XXXXXXXX" /></div>
            <div><label className={label}>GST Number</label><input className={inp} value={vendorGst} onChange={e=>setVendorGst(e.target.value)} placeholder="29XXXXX" /></div>
            <div className="md:col-span-2"><label className={label}>Address</label><textarea className={inp} rows={2} value={vendorAddress} onChange={e=>setVendorAddress(e.target.value)} placeholder="Vendor address" /></div>
            <div><label className={label}>Order Date *</label><input type="date" className={inp} value={orderDate} onChange={e=>setOrderDate(e.target.value)} /></div>
            <div><label className={label}>Expected Delivery</label><input type="date" className={inp} value={expectedDate} onChange={e=>setExpectedDate(e.target.value)} /></div>
            <div>
              <label className={label}>Status</label>
              <select className={inp} value={status} onChange={e=>setStatus(e.target.value)}>
                {['Draft','Ordered','In Transit','Partially Received','Received','Closed'].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><label className={label}>Remarks</label><input className={inp} value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Any notes about this order…" /></div>
          </div>
        </div>
      )}

      {/* ── INVOICES tab ── */}
      {tab === 'invoices' && (
        <div className="space-y-5">

          {/* ── Invoice mode selector ── */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-4">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Which invoices do you have for this order?</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id:'billing', icon:'fa-file-invoice',     label:'Billing Only',     sub:'Only vendor bill (with markup)' },
                { id:'actual',  icon:'fa-file-alt',         label:'Actual Only',      sub:'Only dispatch note / real cost' },
                { id:'both',    icon:'fa-copy',             label:'Both Invoices',    sub:'Billing + Actual/Dispatch' },
              ] as const).map(m => (
                <button key={m.id} onClick={() => setInvoiceMode(m.id)}
                  className={`text-left px-4 py-3 rounded-xl border transition-all ${invoiceMode===m.id?'bg-amber-500/20 border-amber-500/40 text-amber-400':'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'}`}>
                  <i className={`fas ${m.icon} text-xs mb-1.5 block`}></i>
                  <div className="text-[10px] font-black uppercase">{m.label}</div>
                  <div className="text-[8px] opacity-60 mt-0.5">{m.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Billing Invoice */}
          {(invoiceMode === 'billing' || invoiceMode === 'both') && (
          <div className="bg-slate-900 border border-amber-500/20 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-500/20 rounded-xl flex items-center justify-center">
                <i className="fas fa-file-invoice text-amber-400 text-sm"></i>
              </div>
              <div>
                <div className="text-white font-black text-sm">Billing Invoice</div>
                <div className="text-amber-400 text-[9px] font-bold uppercase">What vendor charges (may include markup)</div>
              </div>
            </div>
            <div className="space-y-3">
              <div><label className={label}>Invoice Number</label><input className={inp} value={billingInv.invoiceNo} onChange={e=>setBillingInv(p=>({...p,invoiceNo:e.target.value}))} placeholder="INV-2024-001" /></div>
              <div><label className={label}>Invoice Date</label><input type="date" className={inp} value={billingInv.invoiceDate} onChange={e=>setBillingInv(p=>({...p,invoiceDate:e.target.value}))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Sub Total</label><input type="number" className={inp} value={billingInv.subtotal||''} onChange={e=>{ const s=+e.target.value; setBillingInv(p=>({...p,subtotal:s,gstAmount:s*p.gstPct/100,total:s+s*p.gstPct/100})); }} /></div>
                <div><label className={label}>GST %</label><input type="number" className={inp} value={billingInv.gstPct||''} onChange={e=>{ const g=+e.target.value; setBillingInv(p=>({...p,gstPct:g,gstAmount:p.subtotal*g/100,total:p.subtotal+p.subtotal*g/100})); }} /></div>
              </div>
              <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <div className="flex justify-between text-sm font-black"><span className="text-slate-300">GST Amount</span><span className="text-amber-400">{fmt(billingInv.gstAmount||0)}</span></div>
                <div className="flex justify-between text-sm font-black mt-1"><span className="text-white">Total Billed</span><span className="text-amber-400 text-base">{fmt(billingInv.total||0)}</span></div>
              </div>
              <div><label className={label}>Notes</label><input className={inp} value={billingInv.notes||''} onChange={e=>setBillingInv(p=>({...p,notes:e.target.value}))} placeholder="Reference, terms, etc." /></div>
            </div>
          </div>
          )}

          {/* Actual Invoice */}
          {(invoiceMode === 'actual' || invoiceMode === 'both') && (
          <div className="bg-slate-900 border border-blue-500/20 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-500/20 rounded-xl flex items-center justify-center">
                <i className="fas fa-file-alt text-blue-400 text-sm"></i>
              </div>
              <div>
                <div className="text-white font-black text-sm">Actual / Dispatch Invoice</div>
                <div className="text-blue-400 text-[9px] font-bold uppercase">Real cost / dispatch note (no markup)</div>
              </div>
            </div>
            <div className="space-y-3">
              <div><label className={label}>Invoice / DN Number</label><input className={inp} value={actualInv.invoiceNo} onChange={e=>setActualInv(p=>({...p,invoiceNo:e.target.value}))} placeholder="DN-2024-001" /></div>
              <div><label className={label}>Invoice Date</label><input type="date" className={inp} value={actualInv.invoiceDate} onChange={e=>setActualInv(p=>({...p,invoiceDate:e.target.value}))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Sub Total</label><input type="number" className={inp} value={actualInv.subtotal||''} onChange={e=>{ const s=+e.target.value; setActualInv(p=>({...p,subtotal:s,gstAmount:s*p.gstPct/100,total:s+s*p.gstPct/100})); }} /></div>
                <div><label className={label}>GST %</label><input type="number" className={inp} value={actualInv.gstPct||''} onChange={e=>{ const g=+e.target.value; setActualInv(p=>({...p,gstPct:g,gstAmount:p.subtotal*g/100,total:p.subtotal+p.subtotal*g/100})); }} /></div>
              </div>
              <div className="px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                <div className="flex justify-between text-sm font-black"><span className="text-slate-300">GST Amount</span><span className="text-blue-400">{fmt(actualInv.gstAmount||0)}</span></div>
                <div className="flex justify-between text-sm font-black mt-1"><span className="text-white">Actual Total</span><span className="text-blue-400 text-base">{fmt(actualInv.total||0)}</span></div>
              </div>
              <div className="px-3 py-2 bg-white/5 rounded-xl">
                <div className="text-[9px] font-bold text-slate-400 uppercase">Difference (Markup)</div>
                <div className={`font-black text-lg ${(billingInv.total||0)>(actualInv.total||0)?'text-rose-400':(billingInv.total||0)<(actualInv.total||0)?'text-emerald-400':'text-slate-400'}`}>
                  {fmt(Math.abs((billingInv.total||0)-(actualInv.total||0)))}
                  {(billingInv.total||0)>(actualInv.total||0)&&<span className="text-xs ml-1">(vendor markup)</span>}
                </div>
              </div>
              <div><label className={label}>Notes</label><input className={inp} value={actualInv.notes||''} onChange={e=>setActualInv(p=>({...p,notes:e.target.value}))} placeholder="Dispatch details, vehicle, etc." /></div>
            </div>
          </div>
          )}
          </div>{/* end invoice grid */}

          {/* Summary when only one mode selected */}
          {invoiceMode !== 'both' && (
            <div className="px-4 py-3 bg-white/5 rounded-xl text-slate-400 text-[9px] font-bold flex items-center gap-2">
              <i className="fas fa-info-circle"></i>
              {invoiceMode === 'billing'
                ? 'Only billing invoice will be recorded. Switch to "Both Invoices" if you also have an actual/dispatch note.'
                : 'Only actual/dispatch invoice will be recorded. Switch to "Both Invoices" if you also have a billing invoice.'}
            </div>
          )}
        </div>
      )}

      {/* ── ITEMS tab ── */}
      {tab === 'items' && (
        <div className="space-y-4">
          {/* Product search */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 space-y-3">
            <label className={label}>Add Product from Inventory</label>
            <input className={inp} value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="Search products…" />
            {productSearch && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredProds.slice(0,15).map(p=>(
                  <button key={p.id} onClick={()=>addItem(p)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-amber-500/20 rounded-xl transition-all text-left">
                    <div><div className="text-white font-bold text-xs">{p.name}</div><div className="text-slate-400 text-[9px]">{p.category} · {p.unitType}</div></div>
                    <i className="fas fa-plus text-amber-400 text-xs"></i>
                  </button>
                ))}
                {filteredProds.length === 0 && (
                  <div className="px-3 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-xs font-bold flex items-center justify-between">
                    No matching product found.
                    <button onClick={()=>setShowQuickAdd(true)} className="underline font-black">+ New Product</button>
                  </div>
                )}
              </div>
            )}
            <button onClick={()=>setShowQuickAdd(true)}
              className="w-full py-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl font-black text-[10px] uppercase hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-2">
              <i className="fas fa-plus"></i> Create New Item &amp; Inward Directly
            </button>
          </div>

          {/* Quick Add & Inward modal — creates product + records this vendor's inward in one step */}
          {showQuickAdd && (
            <QuickAddInward
              source="vendor"
              onClose={()=>setShowQuickAdd(false)}
              defaultVendorName={vendorName}
              onDone={(p)=>{ addItem(p); }}
            />
          )}

          {/* Items table */}
          {items.length > 0 && (
            <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[9px] font-black text-slate-400 uppercase min-w-[140px]">Product</th>
                      <th className="px-3 py-2.5 text-center text-[9px] font-black text-amber-400 uppercase min-w-[80px]">Ordered</th>
                      {(invoiceMode === 'billing' || invoiceMode === 'both') && (
                        <th className="px-3 py-2.5 text-center text-[9px] font-black text-amber-400 uppercase" colSpan={3}>Billing Invoice</th>
                      )}
                      {(invoiceMode === 'actual' || invoiceMode === 'both') && (
                        <th className="px-3 py-2.5 text-center text-[9px] font-black text-blue-400 uppercase" colSpan={3}>Actual Invoice</th>
                      )}
                      <th className="px-3 py-2.5 text-center text-[9px] font-black text-emerald-400 uppercase min-w-[90px]">Selling ₹</th>
                      <th className="px-3 py-2.5 text-center text-[9px] font-black text-purple-400 uppercase min-w-[80px]">Landed</th>
                      <th className="px-3 py-2.5 text-center text-[9px] font-black text-purple-400 uppercase min-w-[70px]">Margin</th>
                      <th className="px-3 py-2.5 text-center text-[9px] font-black text-slate-400 uppercase w-8"></th>
                    </tr>
                    <tr className="bg-white/[0.02]">
                      <th></th><th></th>
                      {(invoiceMode === 'billing' || invoiceMode === 'both') && (<>
                        <th className="px-2 py-1 text-[8px] font-bold text-amber-400/70 text-center">Slabs/Qty</th>
                        <th className="px-2 py-1 text-[8px] font-bold text-amber-400/70 text-center">Rate</th>
                        <th className="px-2 py-1 text-[8px] font-bold text-amber-400/70 text-center">Amt</th>
                      </>)}
                      {(invoiceMode === 'actual' || invoiceMode === 'both') && (<>
                        <th className="px-2 py-1 text-[8px] font-bold text-blue-400/70 text-center">Slabs/Qty</th>
                        <th className="px-2 py-1 text-[8px] font-bold text-blue-400/70 text-center">Rate</th>
                        <th className="px-2 py-1 text-[8px] font-bold text-blue-400/70 text-center">Amt</th>
                      </>)}
                      <th></th><th></th><th></th><th></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {items.map((item,idx)=>{
                      const ci = calcItem(item, tPerUnit, lPerUnit);
                      const margin = ci.marginPct||0;
                      const isSlabItem = ['Kadapa','Granite','Marble'].includes(item.category || '');
                      const prod = products.find(p => p.id === item.productId);
                      return (
                        <tr key={item.id||idx} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-2">
                            <div className="text-white font-bold text-xs">{item.productName}</div>
                            <div className="text-slate-500 text-[9px]">{item.category} · {item.unit}</div>
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" className="w-16 px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-white text-xs text-center font-bold outline-none focus:border-amber-400"
                              value={item.orderedQty||''} onChange={e=>updateItem(idx,'orderedQty',+e.target.value)} />
                          </td>
                          {/* Billing */}
                          <td className="px-2 py-2">
                            <input type="number" className="w-16 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs text-center font-bold outline-none focus:border-amber-400"
                              value={item.billedQty||''} onChange={e=>updateItem(idx,'billedQty',+e.target.value)} />
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" className="w-20 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs text-center font-bold outline-none focus:border-amber-400"
                              value={item.billedRate||''} onChange={e=>updateItem(idx,'billedRate',+e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-amber-400 font-bold text-xs text-center">{fmt((item.billedQty||0)*(item.billedRate||0))}</td>
                          {/* Actual */}
                          <td className="px-2 py-2">
                            <input type="number" className="w-16 px-2 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400 text-xs text-center font-bold outline-none focus:border-blue-400"
                              value={item.actualQty||''} onChange={e=>updateItem(idx,'actualQty',+e.target.value)} />
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" className="w-20 px-2 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400 text-xs text-center font-bold outline-none focus:border-blue-400"
                              value={item.actualRate||''} onChange={e=>updateItem(idx,'actualRate',+e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-blue-400 font-bold text-xs text-center">{fmt((item.actualQty||0)*(item.actualRate||0))}</td>
                          {/* Selling */}
                          <td className="px-2 py-2">
                            <input type="number" className="w-20 px-2 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs text-center font-bold outline-none focus:border-emerald-400"
                              value={item.sellingPrice||''} onChange={e=>updateItem(idx,'sellingPrice',+e.target.value)} />
                          </td>
                          <td className="px-2 py-2 text-purple-400 font-bold text-xs text-center">{fmt(ci.landedCostPerUnit)}</td>
                          <td className="px-2 py-2 text-center">
                            <span className={`text-xs font-black ${margin>=20?'text-emerald-400':margin>=10?'text-amber-400':'text-rose-400'}`}>{pct(margin)}</span>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              {isEdit && (
                                <button onClick={()=>{ setRemapItem({ productId:item.productId, productName:item.productName }); setRemapVendorName(''); setRemapDate(new Date().toISOString().slice(0,10)); }}
                                  title="Re-map this item to a different vendor"
                                  className="text-purple-400 hover:text-purple-300 transition-colors">
                                  <i className="fas fa-exchange-alt text-xs"></i>
                                </button>
                              )}
                              <button onClick={()=>setItems(p=>p.filter((_,i)=>i!==idx))} className="text-rose-400 hover:text-rose-300 transition-colors">
                                <i className="fas fa-times text-xs"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-white/5">
                    <tr>
                      <td colSpan={4} className="px-3 py-2.5 text-white font-black text-xs">Totals ({items.length} items)</td>
                      <td className="px-2 py-2.5 text-amber-400 font-black text-xs text-center">{fmt(totalBilled)}</td>
                      <td colSpan={2}></td>
                      <td className="px-2 py-2.5 text-blue-400 font-black text-xs text-center">{fmt(totalActual)}</td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TRANSPORT tab ── */}
      {tab === 'transport' && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 bg-purple-500/20 rounded-xl flex items-center justify-center">
              <i className="fas fa-truck text-purple-400"></i>
            </div>
            <div>
              <div className="text-white font-black text-sm">Transport Details</div>
              <div className="text-slate-400 text-[10px] font-bold">Rate: ₹{transport.ratePerTon}/ton × {transport.totalWeightTons}T = {fmt(transport.totalWeightTons*transport.ratePerTon)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className={label}>Vehicle Number</label><input className={inp} value={transport.vehicleNo} onChange={e=>setTransport(p=>({...p,vehicleNo:e.target.value}))} placeholder="KA-01-AB-1234" /></div>
            <div><label className={label}>Transporter Name</label><input className={inp} value={transport.transporterName||''} onChange={e=>setTransport(p=>({...p,transporterName:e.target.value}))} placeholder="Transporter / lorry service" /></div>
            <div><label className={label}>Driver Name</label><input className={inp} value={transport.driverName||''} onChange={e=>setTransport(p=>({...p,driverName:e.target.value}))} placeholder="Driver name" /></div>
            <div><label className={label}>Driver Phone</label><input className={inp} value={transport.driverPhone||''} onChange={e=>setTransport(p=>({...p,driverPhone:e.target.value}))} placeholder="+91 9XXXXXXXX" /></div>
          </div>

          <hr className="border-white/10" />
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cost Breakdown</div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={label}>Total Weight (Tons)</label>
              <input type="number" step="0.1" className={inp} value={transport.totalWeightTons||''} onChange={e=>setTransport(p=>calcTransport({...p,totalWeightTons:+e.target.value}))} placeholder="0.0" />
            </div>
            <div>
              <label className={label}>Rate per Ton (₹)</label>
              <input type="number" className={inp} value={transport.ratePerTon||''} onChange={e=>setTransport(p=>calcTransport({...p,ratePerTon:+e.target.value}))} placeholder="3500" />
            </div>
            <div>
              <label className={label}>Freight Cost (auto)</label>
              <div className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-purple-400 font-black text-sm">{fmt(t.freightCost)}</div>
            </div>
            <div>
              <label className={label}>Loading Charges (₹)</label>
              <input type="number" className={inp} value={transport.loadingCharges||''} onChange={e=>setTransport(p=>calcTransport({...p,loadingCharges:+e.target.value}))} placeholder="0" />
            </div>
            <div>
              <label className={label}>Unloading Charges (₹)</label>
              <input type="number" className={inp} value={transport.unloadingCharges||''} onChange={e=>setTransport(p=>calcTransport({...p,unloadingCharges:+e.target.value}))} placeholder="0" />
            </div>
            <div>
              <label className={label}>Driver Extra Expenses (₹)</label>
              <input type="number" className={inp} value={transport.driverExpenses||''} onChange={e=>setTransport(p=>calcTransport({...p,driverExpenses:+e.target.value}))} placeholder="Toll, daily needs, etc." />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
            <div>
              <label className={label}>Labor Charges (₹)</label>
              <input type="number" className={inp} value={laborCharges||''} onChange={e=>setLaborCharges(+e.target.value)} placeholder="Unloading / stacking" />
            </div>
            <div>
              <label className={label}>Misc Charges (₹)</label>
              <input type="number" className={inp} value={miscCharges||''} onChange={e=>setMiscCharges(+e.target.value)} placeholder="Other costs" />
            </div>
            <div>
              <label className={label}>Misc Description</label>
              <input className={inp} value={miscDesc} onChange={e=>setMiscDesc(e.target.value)} placeholder="What are misc charges for?" />
            </div>
          </div>

          {/* Total transport summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            {[
              { label:'Freight', val:t.freightCost },
              { label:'Load/Unload', val:(transport.loadingCharges||0)+(transport.unloadingCharges||0) },
              { label:'Driver Extra', val:transport.driverExpenses||0 },
              { label:'Labor + Misc', val:laborCharges+miscCharges },
            ].map(c=>(
              <div key={c.label} className="bg-white/5 rounded-xl px-4 py-3">
                <div className="text-[9px] font-black text-slate-400 uppercase">{c.label}</div>
                <div className="text-white font-black text-sm mt-1">{fmt(c.val)}</div>
              </div>
            ))}
          </div>
          <div className="px-5 py-4 bg-purple-500/10 border border-purple-500/30 rounded-2xl flex items-center justify-between">
            <span className="text-white font-black text-sm">Total Logistics Cost</span>
            <span className="text-purple-400 font-black text-xl">{fmt(t.totalTransportCost + laborCharges + miscCharges)}</span>
          </div>
          {totalQtyAll > 0 && (
            <div className="text-slate-400 text-xs font-bold text-right">
              Per unit logistics cost: {fmt((t.totalTransportCost + laborCharges + miscCharges) / totalQtyAll)}
            </div>
          )}
        </div>
      )}

      {/* ── RECEIVE & PAY tab ── */}
      {tab === 'receive' && (
        <div className="space-y-5">
          {/* Receive items */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <div className="text-white font-black text-sm">Mark Items as Received</div>
              <div className="text-slate-400 text-[10px] font-bold mt-0.5">Set received qty — items auto-inward to inventory on save</div>
            </div>
            <div className="divide-y divide-white/5">
              {items.length === 0 && <div className="p-6 text-center text-slate-500 font-bold text-sm">Add items in the Items tab first</div>}
              {items.map((item, idx)=>{
                const ci = calcItem(item, tPerUnit, lPerUnit);
                const pctR = (item.actualQty||0) > 0 ? ((item.receivedQty||0)/(item.actualQty||0))*100 : 0;
                return (
                  <div key={item.id||idx} className="px-5 py-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-white font-bold text-sm">{item.productName}</div>
                        <div className="text-slate-400 text-[10px] font-bold">{item.category} · Actual: {item.actualQty} {item.unit} · Landed: {fmt(ci.landedCostPerUnit)}/{item.unit}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-emerald-400 font-black text-sm">{item.receivedQty||0} / {item.actualQty} received</div>
                        <div className="text-[9px] font-bold text-slate-500">{pctR.toFixed(0)}%</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={label}>Received Qty</label>
                        <input type="number" className={inp} value={item.receivedQty||''} max={item.actualQty}
                          onChange={e=>updateItem(idx,'receivedQty',Math.min(+e.target.value,item.actualQty||9999))} />
                      </div>
                      <div>
                        <label className={label}>Damaged Qty</label>
                        <input type="number" className="w-full px-3 py-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 font-bold text-sm outline-none focus:border-rose-400 transition-all"
                          value={item.damagedQty||''} max={item.receivedQty}
                          onChange={e=>updateItem(idx,'damagedQty',Math.min(+e.target.value,item.receivedQty||0))} />
                      </div>
                    </div>
                    {(item.receivedQty||0) > 0 && (
                      <div>
                        <label className={label}>Quality Rating</label>
                        <div className="flex gap-2">
                          {[1,2,3,4,5].map(r=>(
                            <button key={r} onClick={()=>updateItem(idx,'qualityRating',r)}
                              className={`w-9 h-9 rounded-xl font-black text-sm transition-all ${(item.qualityRating||0)>=r?'bg-amber-400 text-white':'bg-white/10 text-slate-400 hover:bg-amber-400/20'}`}>
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-white font-black text-sm">Payment Tracking</div>
              <div className={`font-black text-lg ${balance<=0?'text-emerald-400':'text-rose-400'}`}>
                {balance<=0 ? '✓ Fully Paid' : `Balance: ${fmt(balance)}`}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[{l:'Grand Total',v:grandTotal},{l:'Paid',v:paidSoFar},{l:'Balance',v:balance}].map(c=>(
                <div key={c.l} className="bg-white/5 rounded-xl px-4 py-3">
                  <div className="text-slate-400 text-[9px] font-black uppercase">{c.l}</div>
                  <div className={`font-black text-sm mt-0.5 ${c.l==='Balance'&&c.v>0?'text-rose-400':c.l==='Paid'?'text-emerald-400':'text-white'}`}>{fmt(c.v)}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={label}>Mode</label>
                <select className={inp} value={paymentMode} onChange={e=>setPaymentMode(e.target.value as any)}>
                  {['Cash','RTGS','UPI','Cheque'].map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div><label className={label}>Amount (₹)</label><input type="number" className={inp} value={paymentAmt||''} onChange={e=>setPaymentAmt(+e.target.value)} /></div>
              <div><label className={label}>Date</label><input type="date" className={inp} value={paymentDate} onChange={e=>setPaymentDate(e.target.value)} /></div>
              <div><label className={label}>Reference No</label><input className={inp} value={paymentRef} onChange={e=>setPaymentRef(e.target.value)} placeholder="UTR/Cheque no." /></div>
            </div>
            <button onClick={addPayment} disabled={paymentAmt<=0}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-xl font-black text-[10px] uppercase transition-all">
              <i className="fas fa-plus mr-2"></i>Add Payment
            </button>
            {payHistory.length > 0 && (
              <table className="w-full text-xs mt-2">
                <thead><tr>{['Date','Mode','Amount','Ref'].map(h=><th key={h} className="text-left px-2 py-1.5 text-[9px] font-black text-slate-400 uppercase">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-white/5">
                  {payHistory.map((p:any,i:number)=>(
                    <tr key={i}>
                      <td className="px-2 py-2 text-slate-300">{p.date}</td>
                      <td className="px-2 py-2 text-slate-300">{p.mode}</td>
                      <td className="px-2 py-2 text-emerald-400 font-bold">{fmt(p.amount)}</td>
                      <td className="px-2 py-2 text-slate-500">{p.referenceNo||'-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── DAMAGE tab ── */}
      {tab === 'damage' && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 bg-rose-500/20 rounded-xl flex items-center justify-center">
              <i className="fas fa-exclamation-triangle text-rose-400"></i>
            </div>
            <div>
              <div className="text-white font-black text-sm">Damage & Quality Issues</div>
              <div className="text-slate-400 text-[10px] font-bold">Track damaged items received from vendor</div>
            </div>
            <button onClick={()=>setDamagedItems(prev=>[...prev, {
              id:`d-${Date.now()}`, productId:'', productName:'', qtyDamaged:0,
              type:'Box' as any, reason:'', actionTaken:'', date:new Date().toISOString().slice(0,10), photos:[]
            }])} className="ml-auto px-3 py-2 bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-xl font-black text-[10px] uppercase hover:bg-rose-500/30 transition-all">
              <i className="fas fa-plus mr-1"></i>Add
            </button>
          </div>

          {damagedItems.length === 0 && (
            <div className="text-center py-8 text-slate-500 font-bold text-sm">No damage reported for this order</div>
          )}

          {damagedItems.map((d:any, idx:number)=>(
            <div key={d.id} className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-rose-400 font-black text-xs">Damage #{idx+1}</span>
                <button onClick={()=>setDamagedItems(prev=>prev.filter((_:any,i:number)=>i!==idx))} className="text-rose-400 hover:text-rose-300 text-xs">✕</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className={label}>Product</label>
                  <select className={inp} value={d.productId} onChange={e=>{ const p=products.find(x=>x.id===e.target.value); setDamagedItems(prev=>prev.map((x:any,i:number)=>i===idx?{...x,productId:e.target.value,productName:p?.name||''}:x)); }}>
                    <option value="">Select product…</option>
                    {items.map(i=><option key={i.productId} value={i.productId}>{i.productName}</option>)}
                  </select>
                </div>
                <div><label className={label}>Qty Damaged</label><input type="number" className={inp} value={d.qtyDamaged||''} onChange={e=>setDamagedItems(prev=>prev.map((x:any,i:number)=>i===idx?{...x,qtyDamaged:+e.target.value}:x))} /></div>
                <div><label className={label}>Date</label><input type="date" className={inp} value={d.date} onChange={e=>setDamagedItems(prev=>prev.map((x:any,i:number)=>i===idx?{...x,date:e.target.value}:x))} /></div>
                <div className="md:col-span-2"><label className={label}>Reason</label><input className={inp} value={d.reason} onChange={e=>setDamagedItems(prev=>prev.map((x:any,i:number)=>i===idx?{...x,reason:e.target.value}:x))} placeholder="Broken, cracked, size mismatch…" /></div>
                <div><label className={label}>Action Taken</label><input className={inp} value={d.actionTaken||''} onChange={e=>setDamagedItems(prev=>prev.map((x:any,i:number)=>i===idx?{...x,actionTaken:e.target.value}:x))} placeholder="Credit note, return, replacement…" /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Re-map item to another vendor ───────────────────────────────── */}
      {remapItem && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[700] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-[32px] shadow-2xl w-full max-w-md p-7 space-y-5">
            <div>
              <h3 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
                <i className="fas fa-exchange-alt text-purple-400"></i> Re-map to Vendor
              </h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                "{remapItem.productName}" will be moved out of this order and linked to the new vendor.
                It will no longer appear under {vendorName || 'this vendor'}.
              </p>
            </div>
            <div>
              <label className={label}>New Vendor Name</label>
              <input className={inp} list="remap-vendor-list" value={remapVendorName} onChange={e=>setRemapVendorName(e.target.value)} placeholder="e.g. Pradeep Suppliers" autoFocus />
              <datalist id="remap-vendor-list">
                {[...new Set((store.vendorOrders||[]).map(o=>o.vendorName))].filter(Boolean).map(v=><option key={v} value={v} />)}
              </datalist>
            </div>
            <div>
              <label className={label}>Date</label>
              <input type="date" className={inp} value={remapDate} onChange={e=>setRemapDate(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setRemapItem(null)} className="flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all">
                Cancel
              </button>
              <button
                disabled={!remapVendorName.trim() || remapSaving}
                onClick={async ()=>{
                  if (!order?.id) return;
                  setRemapSaving(true);
                  try {
                    await store.remapItemToVendor(remapItem.productId, order.id, remapVendorName.trim(), remapDate);
                    // Remove the item from THIS form's local state too (order is being re-fetched)
                    setItems(p => p.filter(i => i.productId !== remapItem.productId));
                    setRemapItem(null);
                  } finally { setRemapSaving(false); }
                }}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                {remapSaving ? <><i className="fas fa-spinner fa-spin"></i> Moving…</> : <><i className="fas fa-exchange-alt"></i> Confirm Re-map</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorSupplyChain;
