import React, { useState, useMemo, useCallback } from 'react';
import { store } from '../store';
import { UserRole } from '../types';

type ReportTab = 'dashboard' | 'itemwise' | 'invoicewise' | 'quotation' | 'stock' | 'movement' | 'damage' | 'vendor' | 'collections';
interface ReportsProps { defaultTab?: string; }

const curr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct  = (n: number) => `${n.toFixed(1)}%`;
const r2   = (n: number) => Math.round(n * 100) / 100;

function profitBg(p: number) {
  if (p >= 20) return 'bg-emerald-100 text-emerald-700';
  if (p >= 10) return 'bg-blue-100 text-blue-700';
  if (p >= 0)  return 'bg-amber-100 text-amber-700';
  return 'bg-rose-100 text-rose-700';
}
function profitText(p: number) {
  if (p >= 20) return 'text-emerald-600';
  if (p >= 10) return 'text-blue-600';
  if (p >= 0)  return 'text-amber-600';
  return 'text-rose-600';
}

/**
 * CORE P&L ENGINE — handles both Box/Tile items and Slab items correctly.
 *
 * For TILE / BOX items (priceBasis = 'Box'):
 *   qty = qtyBoxes + qtyLoose/tilesPerBox
 *   landedPerUnit = costRate (landed cost per box, set at sale time)
 *   totalLanded   = qty × landedPerUnit
 *   netSelling    = item.amount
 *
 * For SLAB items — Granite / Marble / Kadapa (priceBasis = 'Sqft'):
 *   The sale stores:
 *     item.sqft       = total sqft sold
 *     item.costRate   = totalCostPerUnit = landed cost per SQFT (set by GraniteManager)
 *     item.amount     = sqft × rate (selling price already calculated)
 *   So:
 *     totalLanded = item.sqft × item.costRate   ← NOT qty × costRate
 *
 * Profit = netSelling − totalLanded
 * Margin% = Profit / totalLanded × 100
 */
const SLAB_CATS = ['Granite', 'Marble', 'Kadapa'];

function calcItemPL(item: any, product: any) {
  const isSlab = SLAB_CATS.includes(item.productCategory || product?.category || '');
  const netSelling = r2(item.amount || 0);
  const discountAmt = r2(item.discountAmount || 0);
  const grossSelling = r2(netSelling + discountAmt);

  let totalLanded: number;
  let landedPerUnit: number;
  let qty: number;
  let purchaseRate: number;
  let transportCost: number;
  let otherCharges: number;

  if (isSlab) {
    // ── SLAB ITEM ──────────────────────────────────────────────────────
    // item.sqft = total sqft of this line
    // item.costRate = landed cost per sqft (totalCostPerUnit from product)
    // If individual slab landed costs are stored, sum them for accuracy
    const slabIds: string[] = item.selectedSlabIds || [];
    let slabLandedSum = 0;
    if (slabIds.length > 0 && product?.slabs) {
      slabIds.forEach((sid: string) => {
        const s = product.slabs.find((sl: any) => sl.id === sid);
        if (s) slabLandedSum += (s.landedCost || 0);
      });
    }

    const sqft = item.sqft || 0;
    // costRate on slab sale item = totalCostPerUnit = landed/sqft
    const landedPerSqft = item.costRate > 0 ? item.costRate : product?.totalCostPerUnit || product?.costPerSqft || 0;

    if (slabLandedSum > 0) {
      totalLanded = r2(slabLandedSum);
    } else if (sqft > 0 && landedPerSqft > 0) {
      totalLanded = r2(sqft * landedPerSqft);
    } else {
      // Fallback: use purchasePrice (avg landed per slab) × number of slabs
      totalLanded = r2((product?.purchasePrice || 0) * Math.max(item.qtyBoxes || 1, 1));
    }

    landedPerUnit = sqft > 0 ? r2(totalLanded / sqft) : landedPerSqft;
    qty           = sqft || item.qtyBoxes || 1;
    purchaseRate  = product?.costPerSqft || product?.purchasePrice || landedPerSqft;
    transportCost = product?.transportCost || 0;
    if (product?.transportCostType === 'Percentage') transportCost = r2(purchaseRate * transportCost / 100);
    otherCharges  = product?.otherCharges || 0;

  } else {
    // ── TILE / BOX ITEM ────────────────────────────────────────────────
    const tilesPerBox = product?.tilesPerBox || 1;
    qty = r2((item.qtyBoxes || 0) + ((item.qtyLoose || 0) / tilesPerBox));
    const qtyEff = qty || 1;

    purchaseRate = product?.purchasePrice || 0;
    transportCost = product?.transportCost || 0;
    if (product?.transportCostType === 'Percentage') transportCost = r2(purchaseRate * transportCost / 100);
    otherCharges = product?.otherCharges || 0;

    // costRate at sale time is most accurate (captured when sale was made)
    landedPerUnit = r2(item.costRate > 0
      ? item.costRate
      : product?.totalCostPerUnit || (purchaseRate + transportCost + otherCharges));
    totalLanded = r2(landedPerUnit * qtyEff);
  }

  const profit    = r2(netSelling - totalLanded);
  const profitPct = totalLanded > 0 ? r2((profit / totalLanded) * 100) : 0;

  return {
    qty, isSlab,
    landedPerUnit, totalLanded,
    grossSelling, discountAmt, netSelling,
    profit, profitPct,
    purchaseRate, transportCost, otherCharges,
  };
}

function downloadCSV(name: string, headers: string[], rows: any[][]) {
  const esc = (v: any) => { const s = String(v ?? ''); return s.includes(',') ? `"${s}"` : s; };
  const blob = new Blob([[headers, ...rows].map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

const Reports: React.FC<ReportsProps> = ({ defaultTab }) => {
  const [activeTab, setActiveTab]     = useState<ReportTab>((defaultTab as ReportTab) || 'dashboard');
  const [dateType, setDateType]       = useState<'all'|'today'|'month'|'custom'>('month');
  const [selectedMonth, setMonth]     = useState(new Date().toISOString().slice(0, 7));
  const [startDate, setStart]         = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEnd]             = useState(new Date().toISOString().split('T')[0]);
  const [search, setSearch]           = useState('');
  const [filterCat, setFilterCat]     = useState('All');
  const [filterVendor, setFilterVendor] = useState('All');
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());

  const categories = store.settings.categories || [];

  const toggleRow = (id: string) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const inRange = useCallback((dateStr: string): boolean => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (dateType === 'all') return true;
    if (dateType === 'today') { const t = new Date(); return ts === new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(); }
    if (dateType === 'month') { const [y, m] = selectedMonth.split('-').map(Number); return d.getFullYear() === y && (d.getMonth() + 1) === m; }
    const s2 = new Date(startDate).getTime(); const e2 = new Date(endDate).getTime() + 86399999;
    return ts >= s2 && ts <= e2;
  }, [dateType, selectedMonth, startDate, endDate]);

  const filteredSales = useMemo(() =>
    store.sales.filter(s => s.status !== 'Deleted' && inRange(s.date) &&
      (filterCat === 'All' || s.items.some((i: any) => store.products.find(p => p.id === i.productId)?.category === filterCat)) &&
      (!search || s.invoiceNo.toLowerCase().includes(search.toLowerCase()) || s.customerName.toLowerCase().includes(search.toLowerCase()))
    ), [store.sales, inRange, filterCat, search]);

  const filteredPayments = useMemo(() => store.payments.filter(p => inRange(p.date)), [store.payments, inRange]);

  const vendors = useMemo(() => {
    const s = new Set<string>();
    store.products.forEach(p => p.purchaseHistory?.forEach((ph: any) => ph.vendorName && s.add(ph.vendorName)));
    store.vendorOrders.forEach(o => s.add(o.vendorName));
    return ['All', ...Array.from(s).sort()];
  }, []);

  // ── Item-wise P&L ──────────────────────────────────────────────────────
  const itemwiseRows = useMemo(() => {
    const rows: any[] = [];
    filteredSales.forEach(sale => {
      sale.items.forEach((item: any) => {
        const prod = store.products.find(p => p.id === item.productId);
        if (filterCat !== 'All' && prod?.category !== filterCat) return;
        if (search && !item.productName.toLowerCase().includes(search.toLowerCase()) && !sale.invoiceNo.toLowerCase().includes(search.toLowerCase())) return;
        rows.push({ ...calcItemPL(item, prod), item, prod, sale });
      });
    });
    return rows.sort((a, b) => new Date(b.sale.date).getTime() - new Date(a.sale.date).getTime());
  }, [filteredSales, filterCat, search]);

  // ── Invoice-wise P&L ───────────────────────────────────────────────────
  const invoicewiseRows = useMemo(() => filteredSales.map(sale => {
    let totalLanded = 0, totalNet = 0, totalDiscount = 0;
    const itemDetails: any[] = [];
    sale.items.forEach((item: any) => {
      const prod = store.products.find(p => p.id === item.productId);
      const pl = calcItemPL(item, prod);
      totalLanded += pl.totalLanded; totalNet += pl.netSelling; totalDiscount += pl.discountAmt;
      itemDetails.push({ ...pl, item, prod });
    });
    const returnVal = r2(store.returns.filter(r => r.saleId === sale.id).reduce((s, r) => s + (r.totalRefundAmount || 0), 0));
    const netRevenue = r2(totalNet - returnVal);
    // Subtract referral commission cost from this invoice's profit
    const referralComm = (sale as any).referralCommissionAmount || 0;
    const profit = r2(netRevenue - totalLanded - referralComm);
    const profitPct = totalLanded > 0 ? r2((profit / totalLanded) * 100) : 0;
    return { sale, totalLanded: r2(totalLanded), totalNet: netRevenue, totalDiscount: r2(totalDiscount), returnVal, referralComm, profit, profitPct, itemDetails };
  }).sort((a, b) => new Date(b.sale.date).getTime() - new Date(a.sale.date).getTime()), [filteredSales]);

  // ── Quotation P&L ──────────────────────────────────────────────────────
  const quotationRows = useMemo(() => store.quotations
    .filter(q => q.status !== 'Deleted' && inRange(q.date) && (!search || q.quotationNo.toLowerCase().includes(search.toLowerCase()) || q.customerName.toLowerCase().includes(search.toLowerCase())))
    .map(q => {
      let expectedLanded = 0, expectedNet = 0;
      q.items.forEach((item: any) => {
        const prod = store.products.find(p => p.id === item.productId);
        const qty = (item.qtyBoxes || 0) + ((item.qtyPieces || 0) / (prod?.tilesPerBox || 1)) || 1;
        expectedLanded += (item.costRate || prod?.totalCostPerUnit || 0) * qty;
        expectedNet    += (item.amount || 0);
      });
      const expectedProfit = r2(expectedNet - expectedLanded);
      const expectedProfitPct = expectedLanded > 0 ? r2((expectedProfit / expectedLanded) * 100) : 0;
      const converted = store.sales.find(s => s.customerName === q.customerName && s.status !== 'Deleted' && Math.abs(new Date(s.date).getTime() - new Date(q.date).getTime()) < 30 * 86400000);
      return { q, expectedLanded: r2(expectedLanded), expectedNet: r2(expectedNet), expectedProfit, expectedProfitPct, converted };
    }).sort((a, b) => new Date(b.q.date).getTime() - new Date(a.q.date).getTime())
  , [store.quotations, store.sales, inRange, search]);

  // ── Stock Value ────────────────────────────────────────────────────────
  const stockRows = useMemo(() => store.products
    .filter(p => p.status === 'Active' && (filterCat === 'All' || p.category === filterCat) && (!search || p.name.toLowerCase().includes(search.toLowerCase())))
    .map(p => {
      const currentQty = p.stockBoxes + (p.stockLoose / (p.tilesPerBox || 1));
      const costPerUnit = p.totalCostPerUnit || p.purchasePrice || 0;
      return { p, currentQty: r2(currentQty), costPerUnit, totalValue: r2(currentQty * costPerUnit), reorderAlert: currentQty <= (p.reorderLevel || 10) };
    }).sort((a, b) => b.totalValue - a.totalValue), [store.products, filterCat, search]);

  // ── Movement ───────────────────────────────────────────────────────────
  const movementRows = useMemo(() => {
    const salesMap = new Map<string, number>();
    store.sales.filter(s => s.status !== 'Deleted' && inRange(s.date)).forEach(s => {
      s.items.forEach((i: any) => {
        const qty = (i.qtyBoxes || 0) + ((i.qtyLoose || 0) / (store.products.find(p => p.id === i.productId)?.tilesPerBox || 1));
        salesMap.set(i.productId, (salesMap.get(i.productId) || 0) + qty);
      });
    });
    return store.products
      .filter(p => (filterCat === 'All' || p.category === filterCat) && (!search || p.name.toLowerCase().includes(search.toLowerCase())))
      .map(p => {
        const soldQty = r2(salesMap.get(p.id) || 0);
        const stockQty = r2(p.stockBoxes + (p.stockLoose / (p.tilesPerBox || 1)));
        const totalQty = r2(soldQty + stockQty);
        const ratio = totalQty > 0 ? r2((soldQty / totalQty) * 100) : 0;
        const tag = ratio >= 70 ? 'Fast' : ratio >= 30 ? 'Medium' : (stockQty === 0 && soldQty > 0) ? 'Out' : 'Slow';
        return { p, soldQty, stockQty, ratio, tag };
      }).sort((a, b) => b.ratio - a.ratio);
  }, [store.products, store.sales, inRange, filterCat, search]);

  // ── Damage & Returns ───────────────────────────────────────────────────
  const damageRows = useMemo(() => store.products
    .filter(p => (filterCat === 'All' || p.category === filterCat) && (!search || p.name.toLowerCase().includes(search.toLowerCase())))
    .map(p => {
      const damages = (p.damageHistory || []).filter((d: any) => inRange(d.date));
      const damageQty = r2(damages.reduce((s: number, d: any) => s + (d.qtyDamaged || d.qtyBoxes || 0), 0));
      const damageValue = r2(damageQty * (p.totalCostPerUnit || 0));
      const retItems = store.returns.filter(r => inRange(r.date)).flatMap(r => r.items.filter((i: any) => i.productId === p.id));
      const returnQty = r2(retItems.reduce((s: number, i: any) => s + (i.qtyBoxes || 0) + ((i.qtyLoose || 0) / (p.tilesPerBox || 1)), 0));
      const returnValue = r2(returnQty * (p.totalCostPerUnit || 0));
      if (damageQty === 0 && returnQty === 0) return null;
      return { p, damageQty, damageValue, returnQty, returnValue, totalImpact: r2(damageValue + returnValue) };
    }).filter(Boolean).sort((a: any, b: any) => b.totalImpact - a.totalImpact)
  , [store.products, store.returns, inRange, filterCat, search]);

  // ── Vendor Performance ─────────────────────────────────────────────────
  const vendorRows = useMemo(() => {
    const map = new Map<string, any>();
    const ensureVendor = (name: string) => {
      if (!map.has(name)) map.set(name, { vendor: name, items: new Set(), purchaseValue: 0, ordersCount: 0, damageCount: 0 });
      return map.get(name);
    };
    store.vendorOrders.filter(o => inRange(o.orderDate)).forEach(o => {
      const v = ensureVendor(o.vendorName);
      v.ordersCount++; v.purchaseValue += o.totalAmount + (o.transportationCost || 0) + (o.otherCosts || 0);
      o.items.forEach((i: any) => v.items.add(i.productName));
      v.damageCount += o.damagedItems?.length || 0;
    });
    store.products.forEach(p => {
      (p.purchaseHistory || []).filter((ph: any) => inRange(ph.date)).forEach((ph: any) => {
        if (!ph.vendorName) return;
        const v = ensureVendor(ph.vendorName);
        v.items.add(p.name); v.purchaseValue += (ph.qtyBoxes || 0) * (p.purchasePrice || 0);
      });
    });
    return Array.from(map.values())
      .filter(v => filterVendor === 'All' || v.vendor === filterVendor)
      .map(v => {
        const ids = store.products.filter(p => (p.purchaseHistory || []).some((ph: any) => ph.vendorName === v.vendor)).map(p => p.id);
        let salesValue = 0, salesCost = 0;
        filteredSales.forEach(s => {
          s.items.filter((i: any) => ids.includes(i.productId)).forEach((item: any) => {
            const prod = store.products.find(p => p.id === item.productId);
            const pl = calcItemPL(item, prod);
            salesValue += pl.netSelling; salesCost += pl.totalLanded;
          });
        });
        return { ...v, itemCount: v.items.size, salesValue: r2(salesValue), profitContrib: r2(salesValue - salesCost) };
      }).sort((a, b) => b.purchaseValue - a.purchaseValue);
  }, [store.vendorOrders, store.products, filteredSales, inRange, filterVendor]);

  // ── Collections ────────────────────────────────────────────────────────
  const collectionRows = useMemo(() => {
    const dayMap = new Map<string, any>();
    const ensure = (d: string) => { if (!dayMap.has(d)) dayMap.set(d, { date: d, cash: 0, upi: 0, card: 0, credit: 0, total: 0 }); return dayMap.get(d); };
    filteredSales.forEach(s => {
      const day = ensure(s.date); const amt = s.amountPaid;
      day.total += amt;
      if (s.paymentType === 'Cash') day.cash += amt;
      else if (s.paymentType === 'UPI') day.upi += amt;
      else if (s.paymentType === 'Card') day.card += amt;
      else if (s.paymentType === 'Credit') day.credit += amt;
      else day.cash += amt;
    });
    filteredPayments.forEach(p => {
      const day = ensure(p.date); day.total += p.amount; day.credit += p.amount;
      if (p.paymentMode === 'Cash') day.cash += p.amount;
      else if (p.paymentMode === 'UPI') day.upi += p.amount;
      else if (p.paymentMode === 'Card') day.card += p.amount;
    });
    return Array.from(dayMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredSales, filteredPayments]);

  // ── Dashboard summary ──────────────────────────────────────────────────
  const dash = useMemo(() => {
    let rev = 0, cost = 0;
    const prodPL = new Map<string, any>();
    filteredSales.forEach(s => {
      s.items.forEach((item: any) => {
        const prod = store.products.find(p => p.id === item.productId);
        const pl = calcItemPL(item, prod);
        rev += pl.netSelling; cost += pl.totalLanded;
        if (!prodPL.has(item.productId)) prodPL.set(item.productId, { name: item.productName, cat: prod?.category || '', revenue: 0, cost: 0, profit: 0 });
        const pp = prodPL.get(item.productId);
        pp.revenue += pl.netSelling; pp.cost += pl.totalLanded; pp.profit += pl.profit;
      });
    });
    const profit = r2(rev - cost);
    const profitPct = cost > 0 ? r2((profit / cost) * 100) : 0;
    const stockValue = stockRows.reduce((s, r) => s + r.totalValue, 0);
    const deadStock = stockRows.filter(r => r.p.stockBoxes > 0 && (movementRows.find(m => m.p.id === r.p.id)?.soldQty || 0) === 0);
    const allPL = Array.from(prodPL.values());
    const top10 = [...allPL].sort((a, b) => b.profit - a.profit).slice(0, 10);
    const lowMarg = [...allPL].filter(p => p.cost > 0 && (p.profit / p.cost) * 100 < 10).sort((a, b) => (a.profit / (a.cost || 1)) - (b.profit / (b.cost || 1))).slice(0, 10);
    const collection = collectionRows.reduce((s, r) => s + r.total, 0);
    return { rev: r2(rev), cost: r2(cost), profit, profitPct, stockValue: r2(stockValue), deadStockVal: r2(deadStock.reduce((s, r) => s + r.totalValue, 0)), deadCount: deadStock.length, top10, lowMarg, collection: r2(collection) };
  }, [filteredSales, stockRows, movementRows, collectionRows]);

  // ── Shared UI ──────────────────────────────────────────────────────────
  const Tbl = ({ children }: any) => (
    <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm">
      <table className="w-full text-xs">{children}</table>
    </div>
  );
  const Th = ({ c, right }: { c: string; right?: boolean }) => (
    <th className={`px-3 py-3 font-black text-[8px] text-slate-400 uppercase tracking-widest bg-slate-50 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{c}</th>
  );
  const Td = ({ children, right, bold, color, className }: any) => (
    <td className={`px-3 py-3 border-t border-slate-50 ${bold ? 'font-black' : 'font-bold'} ${color || 'text-slate-700'} ${right ? 'text-right' : ''} whitespace-nowrap ${className || ''}`}>{children}</td>
  );
  const Badge = ({ label, cls }: any) => <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
  const PBadge = ({ p }: { p: number }) => <Badge label={pct(p)} cls={profitBg(p)} />;

  const TABS = [
    { id: 'dashboard' as ReportTab,   label: 'Dashboard',        icon: 'fa-chart-pie' },
    { id: 'itemwise' as ReportTab,    label: 'Item-wise P&L',    icon: 'fa-tags' },
    { id: 'invoicewise' as ReportTab, label: 'Invoice-wise',     icon: 'fa-file-invoice' },
    { id: 'quotation' as ReportTab,   label: 'Quotations',       icon: 'fa-file-alt' },
    { id: 'stock' as ReportTab,       label: 'Stock Value',      icon: 'fa-boxes' },
    { id: 'movement' as ReportTab,    label: 'Movement',         icon: 'fa-chart-line' },
    { id: 'damage' as ReportTab,      label: 'Damage & Returns', icon: 'fa-exclamation-triangle' },
    { id: 'vendor' as ReportTab,      label: 'Vendor',           icon: 'fa-truck' },
    { id: 'collections' as ReportTab, label: 'Collections',      icon: 'fa-wallet' },
  ];

  return (
    <div className="space-y-5 pb-20">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 uppercase tracking-tighter">P&L Intelligence</h1>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Landed Cost · Net Selling Price · Real Profit per Item</p>
        </div>
        <button onClick={() => {
          if (activeTab === 'itemwise') downloadCSV(`ItemWise_${new Date().toISOString().slice(0,10)}.csv`,
            ['Product','Invoice','Date','Customer','Qty','Landed/Unit','Total Cost','Net Sell','Discount','Profit ₹','Profit %'],
            itemwiseRows.map(r => [r.item.productName, r.sale.invoiceNo, r.sale.date, r.sale.customerName, r.qty, r.landedPerUnit, r.totalLanded, r.netSelling, r.discountAmt, r.profit, pct(r.profitPct)]));
          else if (activeTab === 'stock') downloadCSV(`Stock_${new Date().toISOString().slice(0,10)}.csv`,
            ['Product','Category','Brand','Stock','Unit','Cost/Unit','Total Value'],
            stockRows.map(r => [r.p.name, r.p.category, r.p.brand, r.currentQty, r.p.unitType, r.costPerUnit, r.totalValue]));
          else if (activeTab === 'invoicewise') downloadCSV(`Invoices_${new Date().toISOString().slice(0,10)}.csv`,
            ['Invoice','Date','Customer','Total Cost','Net Revenue','Profit ₹','Profit %'],
            invoicewiseRows.map(r => [r.sale.invoiceNo, r.sale.date, r.sale.customerName, r.totalLanded, r.totalNet, r.profit, pct(r.profitPct)]));
          else if (activeTab === 'collections') downloadCSV(`Collections_${new Date().toISOString().slice(0,10)}.csv`,
            ['Date','Cash','UPI','Card','Credit','Total'],
            collectionRows.map(r => [r.date, r.cash, r.upi, r.card, r.credit, r.total]));
        }} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-emerald-700 transition-all active:scale-95">
          <i className="fas fa-file-csv text-xs"></i> Export CSV
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full font-black text-[9px] uppercase tracking-widest whitespace-nowrap transition-all flex-shrink-0 ${activeTab === t.id ? 'bg-slate-900 text-white shadow' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <i className={`fas ${t.icon} text-[9px]`}></i> {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-100 rounded-[24px] p-4 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="flex gap-1 bg-slate-100 rounded-2xl p-1">
          {(['all','today','month','custom'] as const).map(t => (
            <button key={t} onClick={() => setDateType(t)}
              className={`px-3 py-1.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${dateType === t ? 'bg-white text-slate-900 shadow' : 'text-slate-400 hover:text-slate-600'}`}>
              {t === 'all' ? 'All' : t === 'today' ? 'Today' : t === 'month' ? 'Month' : 'Custom'}
            </button>
          ))}
        </div>
        {dateType === 'month' && <input type="month" className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={selectedMonth} onChange={e => setMonth(e.target.value)} />}
        {dateType === 'custom' && <>
          <input type="date" className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={startDate} onChange={e => setStart(e.target.value)} />
          <span className="text-slate-400 text-xs font-bold">to</span>
          <input type="date" className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={endDate} onChange={e => setEnd(e.target.value)} />
        </>}
        <select className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="All">All Categories</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        <select className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none" value={filterVendor} onChange={e => setFilterVendor(e.target.value)}>
          {vendors.map(v => <option key={v}>{v}</option>)}
        </select>
        <div className="flex-1 min-w-[160px] flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
          <i className="fas fa-search text-slate-300 text-xs"></i>
          <input className="flex-1 bg-transparent font-bold text-sm outline-none" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* ═══ DASHBOARD ═══ */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Net Revenue',    val: curr(dash.rev),       sub: `${filteredSales.length} invoices`,      cls: 'bg-white' },
              { label: 'Total COGS',     val: curr(dash.cost),      sub: 'Landed cost basis',                     cls: 'bg-white' },
              { label: 'Gross Profit',   val: curr(dash.profit),    sub: pct(dash.profitPct),                     cls: dash.profit >= 0 ? 'bg-emerald-50' : 'bg-rose-50',  vcls: profitText(dash.profitPct) },
              { label: 'Collections',    val: curr(dash.collection), sub: 'Cash + UPI + Card',                    cls: 'bg-white' },
              { label: 'Stock Value',    val: curr(dash.stockValue), sub: `${stockRows.length} products`,         cls: 'bg-white' },
              { label: 'Dead Stock',     val: curr(dash.deadStockVal), sub: `${dash.deadCount} items, no sales`,  cls: 'bg-rose-50', vcls: 'text-rose-600' },
              { label: 'Damage Impact',  val: curr(damageRows.reduce((s: number, r: any) => s + r.totalImpact, 0)), sub: 'Damage + Returns', cls: 'bg-amber-50', vcls: 'text-amber-700' },
              { label: 'Quotations',     val: quotationRows.length.toString(), sub: `${quotationRows.filter(q => q.converted).length} converted`, cls: 'bg-white' },
            ].map(({ label, val, sub, cls, vcls }) => (
              <div key={label} className={`${cls} border border-slate-100 rounded-[20px] p-4 shadow-sm`}>
                <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
                <div className={`text-xl font-black ${vcls || 'text-slate-900'}`}>{val}</div>
                <div className="text-[9px] font-bold text-slate-400 mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Top 10 */}
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <i className="fas fa-trophy text-amber-400"></i> Top 10 Profitable Products
              </div>
              <div className="space-y-3">
                {dash.top10.length === 0 && <div className="text-center text-slate-300 py-6 font-black text-xs uppercase">No sales data</div>}
                {dash.top10.map((p: any, i: number) => {
                  const pp = p.cost > 0 ? r2((p.profit / p.cost) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-[9px] font-black text-slate-500 flex-shrink-0">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-slate-800 text-xs truncate">{p.name}</div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full mt-1 overflow-hidden">
                          <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${Math.min(Math.max(pp, 0), 100)}%` }}/>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-black text-emerald-600 text-xs">{curr(p.profit)}</div>
                        <div className="text-[8px] text-slate-400">{pct(pp)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Low margin */}
            <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <i className="fas fa-exclamation-circle text-rose-400"></i> Low Margin Items (&lt;10%)
              </div>
              <div className="space-y-2">
                {dash.lowMarg.length === 0 && <div className="text-center text-slate-300 py-6 font-black text-xs uppercase">All items &gt;10% ✓</div>}
                {dash.lowMarg.map((p: any, i: number) => {
                  const pp = p.cost > 0 ? r2((p.profit / p.cost) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center justify-between bg-rose-50 rounded-xl px-3 py-2">
                      <div className="font-bold text-slate-700 text-xs truncate flex-1">{p.name}</div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs font-black text-slate-600">{curr(p.profit)}</span>
                        <PBadge p={pp} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Collection split */}
          {(() => {
            const tot = collectionRows.reduce((a, r) => ({ cash: a.cash + r.cash, upi: a.upi + r.upi, card: a.card + r.card, credit: a.credit + r.credit, total: a.total + r.total }), { cash: 0, upi: 0, card: 0, credit: 0, total: 0 });
            return (
              <div className="bg-white border border-slate-100 rounded-[24px] p-5 shadow-sm">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Collection Mode Breakdown</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[{ l: 'Cash', v: tot.cash, cls: 'bg-emerald-100 text-emerald-700' }, { l: 'UPI', v: tot.upi, cls: 'bg-blue-100 text-blue-700' }, { l: 'Card', v: tot.card, cls: 'bg-indigo-100 text-indigo-700' }, { l: 'Credit/Recovery', v: tot.credit, cls: 'bg-amber-100 text-amber-700' }].map(m => (
                    <div key={m.l} className={`${m.cls} rounded-2xl p-4`}>
                      <div className="text-[8px] font-black uppercase mb-1 opacity-70">{m.l}</div>
                      <div className="text-xl font-black">{curr(m.v)}</div>
                      <div className="text-[9px] opacity-60">{tot.total > 0 ? pct((m.v / tot.total) * 100) : '0%'}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══ ITEM-WISE ═══ */}
      {activeTab === 'itemwise' && (
        <div className="space-y-3">
          <div className="flex justify-between text-[9px] font-bold text-slate-500">
            <span>{itemwiseRows.length} line items</span>
            <span>Total Profit: <span className={`font-black ${profitText(dash.profitPct)}`}>{curr(itemwiseRows.reduce((s, r) => s + r.profit, 0))}</span></span>
          </div>
          <Tbl>
            <thead><tr>
              <Th c="" /><Th c="Product" /><Th c="Category" /><Th c="Invoice" /><Th c="Date" /><Th c="Customer" />
              <Th c="Qty" right /><Th c="Landed/Unit" right /><Th c="Total Cost" right /><Th c="Gross Sell" right /><Th c="Discount" right /><Th c="Net Sell" right /><Th c="Profit ₹" right /><Th c="Profit %" right />
            </tr></thead>
            <tbody>
              {itemwiseRows.map((r, i) => {
                const id = `iw-${i}`;
                return (
                  <React.Fragment key={id}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => toggleRow(id)}>
                      <Td><i className={`fas fa-chevron-${expanded.has(id) ? 'down' : 'right'} text-[8px] text-slate-300`}></i></Td>
                      <Td bold>{r.item.productName}</Td>
                      <Td><Badge label={r.prod?.category || '—'} cls="bg-slate-100 text-slate-600" /></Td>
                      <Td color="text-blue-600">{r.sale.invoiceNo}</Td>
                      <Td>{r.sale.date}</Td>
                      <Td>{r.sale.customerName}</Td>
                      <Td right>{r.qty.toFixed(1)}</Td>
                      <Td right>{curr(r.landedPerUnit)}</Td>
                      <Td right>{curr(r.totalLanded)}</Td>
                      <Td right>{curr(r.grossSelling)}</Td>
                      <Td right color="text-rose-500">{r.discountAmt > 0 ? `-${curr(r.discountAmt)}` : '—'}</Td>
                      <Td right bold>{curr(r.netSelling)}</Td>
                      <Td right bold color={r.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{curr(r.profit)}</Td>
                      <Td right><PBadge p={r.profitPct} /></Td>
                    </tr>
                    {expanded.has(id) && (
                      <tr><td colSpan={14} className="px-8 py-4 bg-gradient-to-r from-slate-50 to-white border-t border-slate-100">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
                          {(r.isSlab ? [
                            { l: 'Landed/SqFt',   v: curr(r.landedPerUnit), cls: 'bg-amber-50 text-amber-700' },
                            { l: 'Total SqFt',    v: `${r.qty.toFixed(2)} sqft`, cls: 'bg-indigo-50 text-indigo-700' },
                            { l: 'Total Landed',  v: curr(r.totalLanded),  cls: 'bg-emerald-50 text-emerald-700' },
                            { l: 'Gross Selling', v: curr(r.grossSelling), cls: 'bg-slate-100 text-slate-700' },
                            { l: 'Discount',      v: curr(r.discountAmt),  cls: 'bg-rose-50 text-rose-700' },
                            { l: 'Net Selling',   v: curr(r.netSelling),   cls: 'bg-blue-50 text-blue-700' },
                            { l: 'Profit/SqFt',   v: curr(r.qty > 0 ? r2(r.profit / r.qty) : 0), cls: r.profit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700' },
                            { l: 'Final Profit',  v: `${curr(r.profit)} (${pct(r.profitPct)})`, cls: r.profit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700' },
                          ] : [
                            { l: 'Purchase Rate', v: curr(r.purchaseRate),  cls: 'bg-slate-100 text-slate-700' },
                            { l: 'Transport',     v: curr(r.transportCost), cls: 'bg-indigo-50 text-indigo-700' },
                            { l: 'Other Charges', v: curr(r.otherCharges),  cls: 'bg-slate-100 text-slate-700' },
                            { l: 'Landed/Box',    v: curr(r.landedPerUnit), cls: 'bg-amber-50 text-amber-700' },
                            { l: 'Gross Selling', v: curr(r.grossSelling),  cls: 'bg-slate-100 text-slate-700' },
                            { l: 'Discount',      v: curr(r.discountAmt),   cls: 'bg-rose-50 text-rose-700' },
                            { l: 'Net Selling',   v: curr(r.netSelling),    cls: 'bg-blue-50 text-blue-700' },
                            { l: 'Final Profit',  v: `${curr(r.profit)} (${pct(r.profitPct)})`, cls: r.profit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700' },
                          ]).map(({ l, v, cls }) => (
                            <div key={l} className={`${cls} rounded-xl px-3 py-2`}>
                              <div className="text-[7px] font-black uppercase opacity-60 mb-0.5">{l}</div>
                              <div className="font-black text-sm">{v}</div>
                            </div>
                          ))}
                        </div>
                        <div className="text-[8px] text-slate-400 font-bold">
                          {r.isSlab
                            ? `Formula: Landed = ${r.qty.toFixed(2)} SqFt × ₹${r.landedPerUnit}/SqFt = ₹${r.totalLanded} | Profit = ₹${r.netSelling} − ₹${r.totalLanded} = `
                            : `Formula: Landed = ₹${r.purchaseRate} + ₹${r.transportCost} (transport) + ₹${r.otherCharges} (other) = ₹${r.landedPerUnit}/box × ${r.qty.toFixed(1)} = ₹${r.totalLanded} | Profit = ₹${r.netSelling} − ₹${r.totalLanded} = `
                          }
                          <span className={r.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>₹{r.profit}</span>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              {itemwiseRows.length === 0 && <tr><td colSpan={14} className="text-center py-14 text-slate-300 font-black text-sm uppercase">No items in selected period</td></tr>}
            </tbody>
          </Tbl>
        </div>
      )}

      {/* ═══ INVOICE-WISE ═══ */}
      {activeTab === 'invoicewise' && (
        <div className="space-y-3">
          <div className="flex justify-between text-[9px] font-bold text-slate-500">
            <span>{invoicewiseRows.length} invoices</span>
            <span>Net Profit: <span className={`font-black ${profitText(dash.profitPct)}`}>{curr(dash.profit)} ({pct(dash.profitPct)})</span></span>
          </div>
          <Tbl>
            <thead><tr>
              <Th c="" /><Th c="Invoice" /><Th c="Date" /><Th c="Customer" />
              <Th c="Total Cost" right /><Th c="Net Revenue" right /><Th c="Returns" right /><Th c="Ref. Comm" right /><Th c="Profit ₹" right /><Th c="Profit %" right /><Th c="Balance" right />
            </tr></thead>
            <tbody>
              {invoicewiseRows.map(r => {
                const id = `inv-${r.sale.id}`;
                return (
                  <React.Fragment key={id}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => toggleRow(id)}>
                      <Td><i className={`fas fa-chevron-${expanded.has(id) ? 'down' : 'right'} text-[8px] text-slate-300`}></i></Td>
                      <Td bold color="text-blue-700">{r.sale.invoiceNo}</Td>
                      <Td>{r.sale.date}</Td>
                      <Td>{r.sale.customerName}</Td>
                      <Td right>{curr(r.totalLanded)}</Td>
                      <Td right bold>{curr(r.totalNet)}</Td>
                      <Td right color="text-rose-500">{r.returnVal > 0 ? `-${curr(r.returnVal)}` : '—'}</Td>
                      <Td right color={r.referralComm > 0 ? 'text-amber-600' : 'text-slate-300'}>{r.referralComm > 0 ? `-${curr(r.referralComm)}` : '—'}</Td>
                      <Td right bold color={r.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{curr(r.profit)}</Td>
                      <Td right><PBadge p={r.profitPct} /></Td>
                      <Td right color={r.sale.balance > 0 ? 'text-amber-600' : 'text-emerald-600'}>{curr(r.sale.balance)}</Td>
                    </tr>
                    {expanded.has(id) && (
                      <tr><td colSpan={11} className="px-8 py-3 bg-slate-50/80 border-t border-slate-100">
                        {r.referralComm > 0 && (
                          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl text-amber-700 text-xs font-bold">
                            <i className="fas fa-user-tag text-xs"></i>
                            Referral Commission: <strong>{curr(r.referralComm)}</strong>
                            {(r.sale as any).referralAgentName && <span className="text-amber-500">({(r.sale as any).referralAgentName})</span>}
                            {(r.sale as any).referralCommissionType === 'Percentage' && <span className="text-amber-500">— {(r.sale as any).referralCommissionValue}% of sale</span>}
                          </div>
                        )}
                        <div className="text-[8px] font-black text-slate-500 uppercase mb-2">Item Breakdown</div>
                        <div className="space-y-1.5">
                          {r.itemDetails.map((d: any, j: number) => (
                            <div key={j} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-slate-100">
                              <div className="font-bold text-slate-700 text-xs flex-1 truncate">{d.item.productName}</div>
                              <div className="flex items-center gap-3 text-right text-xs flex-shrink-0">
                                <span className="text-slate-400">Cost: <span className="font-black text-slate-700">{curr(d.totalLanded)}</span></span>
                                <span className="text-slate-400">Sell: <span className="font-black text-slate-700">{curr(d.netSelling)}</span></span>
                                <span className={`font-black px-2 py-0.5 rounded-full ${profitBg(d.profitPct)}`}>{curr(d.profit)} ({pct(d.profitPct)})</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              {invoicewiseRows.length === 0 && <tr><td colSpan={10} className="text-center py-14 text-slate-300 font-black text-sm uppercase">No invoices in selected period</td></tr>}
            </tbody>
          </Tbl>
        </div>
      )}

      {/* ═══ QUOTATION ═══ */}
      {activeTab === 'quotation' && (
        <Tbl>
          <thead><tr>
            <Th c="Quotation #" /><Th c="Date" /><Th c="Customer" />
            <Th c="Exp. Cost" right /><Th c="Quoted Value" right /><Th c="Exp. Profit ₹" right /><Th c="Exp. Profit %" right /><Th c="Status" /><Th c="Converted?" />
          </tr></thead>
          <tbody>
            {quotationRows.map(r => (
              <tr key={r.q.id} className="hover:bg-slate-50">
                <Td bold color="text-blue-700">{r.q.quotationNo}</Td>
                <Td>{r.q.date}</Td>
                <Td>{r.q.customerName}</Td>
                <Td right>{curr(r.expectedLanded)}</Td>
                <Td right bold>{curr(r.expectedNet)}</Td>
                <Td right bold color={r.expectedProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{curr(r.expectedProfit)}</Td>
                <Td right><PBadge p={r.expectedProfitPct} /></Td>
                <Td><Badge label={r.q.status} cls={r.q.status === 'Active' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'} /></Td>
                <Td>{r.converted ? <span className="font-black text-emerald-600 text-xs">✓ {r.converted.invoiceNo}</span> : <span className="text-slate-300 text-xs">—</span>}</Td>
              </tr>
            ))}
            {quotationRows.length === 0 && <tr><td colSpan={9} className="text-center py-14 text-slate-300 font-black text-sm uppercase">No quotations in period</td></tr>}
          </tbody>
        </Tbl>
      )}

      {/* ═══ STOCK VALUE ═══ */}
      {activeTab === 'stock' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-[20px] p-4">
              <div className="text-[8px] font-black text-indigo-400 uppercase mb-1">Total Stock Value</div>
              <div className="text-xl font-black text-indigo-900">{curr(stockRows.reduce((s, r) => s + r.totalValue, 0))}</div>
            </div>
            <div className="bg-white border border-slate-100 rounded-[20px] p-4">
              <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Products</div>
              <div className="text-xl font-black">{stockRows.length}</div>
            </div>
            <div className="bg-rose-50 border border-rose-100 rounded-[20px] p-4">
              <div className="text-[8px] font-black text-rose-400 uppercase mb-1">Reorder Alerts</div>
              <div className="text-xl font-black text-rose-600">{stockRows.filter(r => r.reorderAlert).length}</div>
            </div>
          </div>
          <Tbl>
            <thead><tr><Th c="Product" /><Th c="Category" /><Th c="Brand" /><Th c="Stock" right /><Th c="Unit" /><Th c="Cost/Unit" right /><Th c="Total Value" right /><Th c="Status" /></tr></thead>
            <tbody>
              {stockRows.map(r => (
                <tr key={r.p.id} className={`hover:bg-slate-50 ${r.reorderAlert ? 'bg-rose-50/30' : ''}`}>
                  <Td bold>{r.p.name}</Td>
                  <Td><Badge label={r.p.category} cls="bg-slate-100 text-slate-600" /></Td>
                  <Td>{r.p.brand}</Td>
                  <Td right bold color={r.currentQty === 0 ? 'text-rose-500' : 'text-slate-700'}>{r.currentQty.toFixed(1)}</Td>
                  <Td>{r.p.unitType}</Td>
                  <Td right>{curr(r.costPerUnit)}</Td>
                  <Td right bold>{curr(r.totalValue)}</Td>
                  <Td>{r.reorderAlert ? <Badge label="⚠ Reorder" cls="bg-rose-100 text-rose-600" /> : <Badge label="OK" cls="bg-emerald-50 text-emerald-600" />}</Td>
                </tr>
              ))}
            </tbody>
          </Tbl>
        </div>
      )}

      {/* ═══ MOVEMENT ═══ */}
      {activeTab === 'movement' && (
        <Tbl>
          <thead><tr><Th c="Product" /><Th c="Category" /><Th c="Sold Qty" right /><Th c="Stock Qty" right /><Th c="Movement %" right /><Th c="Tag" /></tr></thead>
          <tbody>
            {movementRows.map(r => (
              <tr key={r.p.id} className="hover:bg-slate-50">
                <Td bold>{r.p.name}</Td>
                <Td><Badge label={r.p.category} cls="bg-slate-100 text-slate-600" /></Td>
                <Td right bold color="text-emerald-600">{r.soldQty}</Td>
                <Td right>{r.stockQty}</Td>
                <Td right>
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${r.ratio}%` }}/>
                    </div>
                    <span className="font-black text-slate-700 w-10 text-right">{pct(r.ratio)}</span>
                  </div>
                </Td>
                <Td><Badge label={`${r.tag} Moving`} cls={r.tag === 'Fast' ? 'bg-emerald-100 text-emerald-700' : r.tag === 'Medium' ? 'bg-blue-100 text-blue-700' : r.tag === 'Out' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'} /></Td>
              </tr>
            ))}
          </tbody>
        </Tbl>
      )}

      {/* ═══ DAMAGE & RETURNS ═══ */}
      {activeTab === 'damage' && (
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-100 rounded-[20px] p-4">
            <div className="text-[8px] font-black text-rose-400 uppercase mb-1">Total Inventory Impact</div>
            <div className="text-xl font-black text-rose-700">{curr(damageRows.reduce((s: number, r: any) => s + r.totalImpact, 0))}</div>
          </div>
          <Tbl>
            <thead><tr><Th c="Product" /><Th c="Category" /><Th c="Damaged Qty" right /><Th c="Damage Value" right /><Th c="Returned Qty" right /><Th c="Return Value" right /><Th c="Total Impact" right /></tr></thead>
            <tbody>
              {damageRows.map((r: any) => (
                <tr key={r.p.id} className="hover:bg-slate-50">
                  <Td bold>{r.p.name}</Td>
                  <Td><Badge label={r.p.category} cls="bg-slate-100 text-slate-600" /></Td>
                  <Td right color="text-amber-600">{r.damageQty}</Td>
                  <Td right color="text-amber-600">{curr(r.damageValue)}</Td>
                  <Td right color="text-blue-600">{r.returnQty}</Td>
                  <Td right color="text-blue-600">{curr(r.returnValue)}</Td>
                  <Td right bold color="text-rose-600">{curr(r.totalImpact)}</Td>
                </tr>
              ))}
              {damageRows.length === 0 && <tr><td colSpan={7} className="text-center py-14 text-slate-300 font-black text-sm uppercase">No damage or returns in period</td></tr>}
            </tbody>
          </Tbl>
        </div>
      )}

      {/* ═══ VENDOR ═══ */}
      {activeTab === 'vendor' && (
        <Tbl>
          <thead><tr><Th c="Vendor" /><Th c="Items" right /><Th c="Orders" right /><Th c="Purchase Value" right /><Th c="Sales Value" right /><Th c="Profit Contrib." right /><Th c="Damages" right /></tr></thead>
          <tbody>
            {vendorRows.map((r, i) => (
              <tr key={r.vendor + i} className="hover:bg-slate-50">
                <Td bold>{r.vendor}</Td>
                <Td right>{r.itemCount}</Td>
                <Td right>{r.ordersCount}</Td>
                <Td right bold>{curr(r.purchaseValue)}</Td>
                <Td right>{curr(r.salesValue)}</Td>
                <Td right bold color={r.profitContrib >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{curr(r.profitContrib)}</Td>
                <Td right color={r.damageCount > 0 ? 'text-rose-500' : 'text-slate-300'}>{r.damageCount > 0 ? r.damageCount : '—'}</Td>
              </tr>
            ))}
            {vendorRows.length === 0 && <tr><td colSpan={7} className="text-center py-14 text-slate-300 font-black text-sm uppercase">No vendor data in period</td></tr>}
          </tbody>
        </Tbl>
      )}

      {/* ═══ COLLECTIONS ═══ */}
      {activeTab === 'collections' && (
        <div className="space-y-4">
          {(() => {
            const tot = collectionRows.reduce((a, r) => ({ cash: a.cash + r.cash, upi: a.upi + r.upi, card: a.card + r.card, credit: a.credit + r.credit, total: a.total + r.total }), { cash: 0, upi: 0, card: 0, credit: 0, total: 0 });
            return (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[{ l: 'Total', v: tot.total, cls: 'bg-slate-900 text-white' }, { l: 'Cash', v: tot.cash, cls: 'bg-emerald-50 text-emerald-700' }, { l: 'UPI', v: tot.upi, cls: 'bg-blue-50 text-blue-700' }, { l: 'Card', v: tot.card, cls: 'bg-indigo-50 text-indigo-700' }, { l: 'Credit/Recovery', v: tot.credit, cls: 'bg-amber-50 text-amber-700' }].map(m => (
                  <div key={m.l} className={`${m.cls} border border-slate-100 rounded-2xl p-4`}>
                    <div className="text-[8px] font-black uppercase mb-1 opacity-70">{m.l}</div>
                    <div className="text-xl font-black">{curr(m.v)}</div>
                  </div>
                ))}
              </div>
            );
          })()}
          <Tbl>
            <thead><tr><Th c="Date" /><Th c="Cash" right /><Th c="UPI" right /><Th c="Card" right /><Th c="Credit/Recovery" right /><Th c="Day Total" right /></tr></thead>
            <tbody>
              {collectionRows.map((r, i) => (
                <tr key={r.date + i} className="hover:bg-slate-50">
                  <Td bold>{r.date}</Td>
                  <Td right color="text-emerald-600">{r.cash > 0 ? curr(r.cash) : '—'}</Td>
                  <Td right color="text-blue-600">{r.upi > 0 ? curr(r.upi) : '—'}</Td>
                  <Td right color="text-indigo-600">{r.card > 0 ? curr(r.card) : '—'}</Td>
                  <Td right color="text-amber-600">{r.credit > 0 ? curr(r.credit) : '—'}</Td>
                  <Td right bold>{curr(r.total)}</Td>
                </tr>
              ))}
              {collectionRows.length === 0 && <tr><td colSpan={6} className="text-center py-14 text-slate-300 font-black text-sm uppercase">No collections in period</td></tr>}
            </tbody>
          </Tbl>
        </div>
      )}

    </div>
  );
};

export default Reports;
