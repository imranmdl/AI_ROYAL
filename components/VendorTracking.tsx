import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../store';
import {
  VendorOrder, VendorOrderItem, DamagedItemTracking, VendorOrderStatus,
  VendorPaymentStatus, VendorPaymentMode, VendorPaymentRecord, Product, UserRole
} from '../types';

// ─── Extended item type with per-item selling price and transport split ───────
interface OrderItemForm extends VendorOrderItem {
  receivedQty?: number;
  sellingPrice?: number;       // manual selling price per box (syncs with inventory sellingPrice)
  sellingPriceSqft?: number;   // selling price per sqft (auto = sellingPrice / sqftPerBox)
  transportShare?: number;     // % of total transport allocated to this item (by value weight)
  transportPct?: number;       // transport % of item cost (for display: 25% etc)
  landedCost?: number;         // landed cost per box (rate + transport share per box)
  landedCostSqft?: number;     // landed cost per sqft (landedCost / sqftPerBox)
  sqftPerBox?: number;         // pulled from product master
  rateSqft?: number;           // purchase rate per sqft (rate / sqftPerBox)
}

interface OrderForm {
  orderNo: string;
  vendorName: string;
  vendorPhone: string;
  vendorGst: string;
  orderDate: string;
  expectedDeliveryDate: string;
  paymentStatus: VendorPaymentStatus;
  creditDays: number;
  cashAmount: number;
  rtgsAmount: number;
  transportPayment: number;
  transportationCost: number;  // actual transport cost (e.g. rate*tonnage)
  transportTonRate: number;    // rate per ton (e.g. 3100)
  transportTons: number;       // vehicle load in tons (e.g. 35)
  otherCosts: number;
  invoiceFile: string;
  items: OrderItemForm[];
  remarks: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const currency = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

/**
 * Recalculate per-item transport % and landed cost.
 *
 * CORRECT FORMULA (as specified):
 *   Transport + Other Costs = e.g. ₹1,17,000
 *   Cash Payment + RTGS Payment = e.g. ₹4,00,000   ← THIS is the denominator
 *   Transport % = (Transport + Other) / (Cash + RTGS) × 100
 *               = 1,17,000 / 4,00,000 × 100 = 29.25%
 *
 *   Item rate = ₹500
 *   Landed cost per box = 500 + 29.25% of 500 = 500 + 146.25 = ₹646.25
 *
 *   Each item carries the SAME transport % (not proportional by value).
 *   This % is applied uniformly to every item's rate.
 */
function recalcItems(
  items: OrderItemForm[],
  transportCost: number,
  otherCosts: number,
  cashAmount: number,
  rtgsAmount: number
): OrderItemForm[] {
  const totalTransport  = transportCost + otherCosts;        // numerator
  const totalPayment    = cashAmount + rtgsAmount;           // denominator: Cash + RTGS
  // Transport % = transport / (cash + RTGS) × 100
  const transportPct    = totalPayment > 0 ? (totalTransport / totalPayment) * 100 : 0;

  return items.map(item => {
    const sqftPerBox    = item.sqftPerBox || 1;
    const ratePerBox    = item.rate;
    // Landed cost = rate + (rate × transportPct / 100)
    const landedPerBox  = parseFloat((ratePerBox + (ratePerBox * transportPct / 100)).toFixed(2));
    const landedPerSqft = sqftPerBox > 0 ? parseFloat((landedPerBox / sqftPerBox).toFixed(2)) : 0;
    const sellingPerSqft= sqftPerBox > 0 ? parseFloat(((item.sellingPrice || 0) / sqftPerBox).toFixed(2)) : 0;
    const ratePerSqft   = sqftPerBox > 0 ? parseFloat((ratePerBox / sqftPerBox).toFixed(2)) : 0;

    return {
      ...item,
      transportPct,      // the single transport % applied to all items
      transportShare:    transportPct,  // same value, kept for display compat
      landedCost:        landedPerBox,
      landedCostSqft:    landedPerSqft,
      sellingPriceSqft:  item.sellingPriceSqft !== undefined
                           ? item.sellingPriceSqft  // preserve manual entry
                           : sellingPerSqft,
      rateSqft:          ratePerSqft,
    };
  });
}

/** Variance check: items+transport should equal cash+rtgs+transportPayment */
function calcVariance(form: OrderForm) {
  const itemTotal   = form.items.reduce((s, i) => s + i.qtyBoxes * i.rate, 0);
  const totalCost   = itemTotal + form.transportationCost + form.otherCosts;
  const totalPaid   = form.cashAmount + form.rtgsAmount + form.transportPayment;
  return { totalCost, totalPaid, variance: totalCost - totalPaid };
}

// ─── Component ────────────────────────────────────────────────────────────────
const VendorTracking: React.FC<{ setActiveTab?: (tab: string) => void }> = ({ setActiveTab }) => {
  const [orders, setOrders]       = useState<VendorOrder[]>(store.vendorOrders);
  const [products, setProducts]   = useState<Product[]>(store.products);
  const [currentUser, setCurrentUser] = useState(store.currentUser);

  const [showAddOrder, setShowAddOrder]       = useState(false);
  const [showEditOrder, setShowEditOrder]     = useState<VendorOrder | null>(null);
  const [showReceiveOrder, setShowReceiveOrder] = useState<VendorOrder | null>(null);
  const [showOrderDetails, setShowOrderDetails] = useState<VendorOrder | null>(null);
  const [showUpdatePayment, setShowUpdatePayment] = useState<VendorOrder | null>(null);
  const [activeTab2, setActiveTab2]            = useState<'orders'|'performance'>('orders');
  const [searchTerm, setSearchTerm]           = useState('');
  const [filterVendor, setFilterVendor]       = useState('All');
  const [filterStatus, setFilterStatus]       = useState('All');
  const [editDamagesForm, setEditDamagesForm] = useState<DamagedItemTracking[]>([]);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setOrders([...store.vendorOrders]);
      setProducts([...store.products]);
      setCurrentUser(store.currentUser);
    });
    return unsub;
  }, []);

  // ── Default form state ──────────────────────────────────────────────────
  const defaultOrderForm = (): OrderForm => ({
    orderNo: `ORD-${Date.now().toString().slice(-6)}`,
    vendorName: '', vendorPhone: '', vendorGst: '',
    orderDate: new Date().toISOString().split('T')[0],
    expectedDeliveryDate: '',
    paymentStatus: 'Pending', creditDays: 0,
    cashAmount: 0, rtgsAmount: 0, transportPayment: 0,
    transportationCost: 0, transportTonRate: 0, transportTons: 0, otherCosts: 0, invoiceFile: '',
    items: [], remarks: '',
  });

  const [orderForm, setOrderForm] = useState<OrderForm>(defaultOrderForm());

  const [receiveForm, setReceiveForm] = useState({
    receivedDate: new Date().toISOString().split('T')[0],
    vehicleNumber: '', godownId: 'g1',
    damagedItems: [] as (DamagedItemTracking & { photoFiles?: File[] })[],
    receivedItems: [] as { productId: string; orderedQty: number; receivedQty: number }[],
  });

  const [paymentForm, setPaymentForm] = useState({
    amount: 0, mode: 'RTGS' as VendorPaymentMode,
    referenceNo: '', remarks: '', date: new Date().toISOString().split('T')[0],
    paymentSlip: '', invoiceFile: '',
  });

  // ── Derived computations ────────────────────────────────────────────────
  const { totalCost, totalPaid, variance } = calcVariance(orderForm);
  const itemTotal = orderForm.items.reduce((s, i) => s + i.qtyBoxes * i.rate, 0);

  const uniqueVendors = useMemo(() => ['All', ...Array.from(new Set(orders.map(o => o.vendorName))).sort()], [orders]);

  const filteredOrders = useMemo(() => orders.filter(o => {
    const matchSearch = o.orderNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.vendorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.items.some(i => i.productName.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchVendor = filterVendor === 'All' || o.vendorName === filterVendor;
    const matchStatus = filterStatus === 'All' || o.status === filterStatus;
    return matchSearch && matchVendor && matchStatus;
  }), [orders, searchTerm, filterVendor, filterStatus]);

  // ── Vendor performance metrics ──────────────────────────────────────────
  const vendorStats = useMemo(() => {
    const map: Record<string, {
      name: string; totalOrders: number; totalValue: number;
      onTimeCount: number; damageCount: number; fulfilledCount: number;
      fastMovingItems: string[];
    }> = {};
    orders.forEach(o => {
      if (!map[o.vendorName]) map[o.vendorName] = { name: o.vendorName, totalOrders: 0, totalValue: 0, onTimeCount: 0, damageCount: 0, fulfilledCount: 0, fastMovingItems: [] };
      const v = map[o.vendorName];
      v.totalOrders++;
      v.totalValue += o.totalAmount + o.transportationCost + o.otherCosts;
      v.damageCount += o.damagedItems?.length || 0;
      if (o.status === 'Received') {
        v.fulfilledCount++;
        if (o.receivedDate && o.expectedDeliveryDate && o.receivedDate <= o.expectedDeliveryDate) v.onTimeCount++;
      }
      o.items.forEach(i => { if (!v.fastMovingItems.includes(i.productName)) v.fastMovingItems.push(i.productName); });
    });
    // Merge with sales to find fast movers per vendor
    return Object.values(map);
  }, [orders]);

  // Low stock / reorder suggestions based on vendor items
  const reorderSuggestions = useMemo(() => {
    return products.filter(p => {
      const totalBoxes = p.stockBoxes + Math.floor((p.stockLoose || 0) / (p.tilesPerBox || 1));
      return totalBoxes <= (p.reorderLevel || 10) && p.status === 'Active';
    }).map(p => {
      const lastOrder = [...orders].reverse().find(o => o.items.some(i => i.productId === p.id));
      return { product: p, lastVendor: lastOrder?.vendorName || '—', lastOrderNo: lastOrder?.orderNo || '—', stock: p.stockBoxes };
    });
  }, [products, orders]);

  // ── Item helpers ────────────────────────────────────────────────────────
  const updateItem = (idx: number, updates: Partial<OrderItemForm>) => {
    // If user types sellingPriceSqft, back-calculate sellingPrice from it
    if ('sellingPriceSqft' in updates && !('sellingPrice' in updates)) {
      const sqft = orderForm.items[idx]?.sqftPerBox || 1;
      updates.sellingPrice = parseFloat(((updates.sellingPriceSqft || 0) * sqft).toFixed(2));
    }
    // If user types sellingPrice, back-calculate sellingPriceSqft
    if ('sellingPrice' in updates && !('sellingPriceSqft' in updates)) {
      const sqft = orderForm.items[idx]?.sqftPerBox || 1;
      updates.sellingPriceSqft = parseFloat(((updates.sellingPrice || 0) / sqft).toFixed(2));
    }
    const newItems = orderForm.items.map((it, i) => i === idx ? { ...it, ...updates } : it);
    const recalculated = recalcItems(newItems, orderForm.transportationCost, orderForm.otherCosts, orderForm.cashAmount, orderForm.rtgsAmount);
    setOrderForm(f => ({ ...f, items: recalculated }));
  };

  const addItem = () => {
    const newItems = [...orderForm.items, { productId: '', productName: '', qtyBoxes: 0, rate: 0, sellingPrice: 0, sellingPriceSqft: 0, receivedQty: 0, sqftPerBox: 1 }];
    setOrderForm(f => ({ ...f, items: recalcItems(newItems, f.transportationCost, f.otherCosts, f.cashAmount, f.rtgsAmount) }));
  };

  const removeItem = (idx: number) => {
    const newItems = orderForm.items.filter((_, i) => i !== idx);
    setOrderForm(f => ({ ...f, items: recalcItems(newItems, f.transportationCost, f.otherCosts, f.cashAmount, f.rtgsAmount) }));
  };

  // Re-run recalc whenever transport costs OR payments change
  const updateCosts = (key: 'transportationCost' | 'otherCosts' | 'cashAmount' | 'rtgsAmount', val: number) => {
    setOrderForm(f => {
      const updated = { ...f, [key]: val };
      return { ...updated, items: recalcItems(updated.items, updated.transportationCost, updated.otherCosts, updated.cashAmount, updated.rtgsAmount) };
    });
  };

  // ── Submit handlers ─────────────────────────────────────────────────────
  const handleSaveOrder = (isEdit: boolean) => {
    if (!orderForm.orderNo || !orderForm.vendorName || orderForm.items.length === 0) return;
    const items = recalcItems(orderForm.items, orderForm.transportationCost, orderForm.otherCosts, orderForm.cashAmount, orderForm.rtgsAmount);
    const computedItemTotal = items.reduce((s, i) => s + i.qtyBoxes * i.rate, 0);
    const landedTotal = computedItemTotal + orderForm.transportationCost + orderForm.otherCosts;
    const totalPaid   = orderForm.cashAmount + orderForm.rtgsAmount + orderForm.transportPayment;

    const orderData: Partial<VendorOrder> = {
      orderNo: orderForm.orderNo,
      vendorName: orderForm.vendorName,
      orderDate: orderForm.orderDate,
      expectedDeliveryDate: orderForm.expectedDeliveryDate,
      paymentStatus: orderForm.paymentStatus,
      creditDays: orderForm.paymentStatus === 'Credit' ? orderForm.creditDays : undefined,
      cashAmount: orderForm.cashAmount,
      rtgsAmount: orderForm.rtgsAmount,
      transportationCost: orderForm.transportationCost,
      otherCosts: orderForm.otherCosts,
      invoiceFile: orderForm.invoiceFile,
      totalAmount: computedItemTotal,
      paidAmount: totalPaid,
      balanceAmount: landedTotal - totalPaid,
      items: items.map(i => ({
        productId: i.productId,
        productName: i.productName,
        qtyBoxes: i.qtyBoxes,
        rate: i.rate,
        receivedQty: i.receivedQty,
        sellingPrice: i.sellingPrice,
        transportShare: i.transportShare,
        landedCost: i.landedCost,
      } as any)),
      remarks: orderForm.remarks,
    };

    if (isEdit && showEditOrder) {
      store.updateVendorOrder(showEditOrder.id, orderData);
      setShowEditOrder(null);
    } else {
      const newOrder: VendorOrder = {
        id: `vo-${Date.now()}`,
        status: 'Ordered',
        paymentHistory: [],
        damagedItems: [],
        ...orderData,
      } as VendorOrder;
      store.addVendorOrder(newOrder);
      setShowAddOrder(false);
    }
    setOrderForm(defaultOrderForm());
  };

  const openEditModal = (order: VendorOrder) => {
    const items: OrderItemForm[] = (order.items as any[]).map(i => ({
      productId: i.productId, productName: i.productName, qtyBoxes: i.qtyBoxes, rate: i.rate,
      receivedQty: i.receivedQty || 0, sellingPrice: i.sellingPrice || 0,
      transportShare: i.transportShare || 0, landedCost: i.landedCost || 0,
    }));
    setOrderForm({
      orderNo: order.orderNo, vendorName: order.vendorName,
      vendorPhone: (order as any).vendorPhone || '', vendorGst: (order as any).vendorGst || '',
      orderDate: order.orderDate, expectedDeliveryDate: order.expectedDeliveryDate || '',
      paymentStatus: order.paymentStatus, creditDays: order.creditDays || 0,
      cashAmount: order.cashAmount, rtgsAmount: order.rtgsAmount,
      transportPayment: (order as any).transportPayment || 0,
      transportationCost: order.transportationCost,
      transportTonRate: (order as any).transportTonRate || 0,
      transportTons: (order as any).transportTons || 0,
      otherCosts: order.otherCosts,
      invoiceFile: order.invoiceFile || '', remarks: order.remarks || '',
      items: recalcItems(items, order.transportationCost, order.otherCosts, order.cashAmount, order.rtgsAmount),
    });
    setShowEditOrder(order);
  };

  const handleReceiveOrder = async () => {
    if (!showReceiveOrder) return;
    const processedDamaged = await Promise.all(receiveForm.damagedItems.map(async item => {
      const photos: string[] = [];
      if (item.photoFiles) {
        for (const file of item.photoFiles) {
          const b64 = await new Promise<string>(res => { const r = new FileReader(); r.onloadend = () => res(r.result as string); r.readAsDataURL(file); });
          photos.push(b64);
        }
      }
      const { photoFiles, ...rest } = item;
      return { ...rest, photos };
    }));

    // Auto-inward to inventory: update received qty on order items
    if (receiveForm.receivedItems.length > 0) {
      const updatedItems = showReceiveOrder.items.map(oi => {
        const ri = receiveForm.receivedItems.find(r => r.productId === oi.productId);
        return ri ? { ...oi, receivedQty: ri.receivedQty } : oi;
      });
      store.updateVendorOrder(showReceiveOrder.id, { items: updatedItems });
    }

    store.receiveVendorOrder(showReceiveOrder.id, receiveForm.godownId, receiveForm.receivedDate, receiveForm.vehicleNumber, processedDamaged);

    // Auto-map all pricing to inventory — landed cost per box, per sqft, selling price both ways
    showReceiveOrder.items.forEach((oi: any) => {
      if (!oi.productId) return;
      const prod = store.products.find((p: any) => p.id === oi.productId);
      const sqftPerBox = oi.sqftPerBox || prod?.sqftPerBox || 1;

      // Landed cost: prefer already-stored value (set when order was created),
      // else recompute using the CORRECT formula:
      //   Transport % = (Transport + Other) ÷ (Cash + RTGS) × 100
      const transportTotal   = showReceiveOrder.transportationCost + showReceiveOrder.otherCosts;
      const paymentTotal     = showReceiveOrder.cashAmount + showReceiveOrder.rtgsAmount;  // Cash + RTGS
      const transportPct     = paymentTotal > 0 ? (transportTotal / paymentTotal) : 0;   // e.g. 0.2925
      const landedCostPerBox = oi.landedCost
        || parseFloat((oi.rate * (1 + transportPct)).toFixed(2));  // e.g. 500 + 29.25% = 646.25
      const landedCostPerSqft = sqftPerBox > 0 ? parseFloat((landedCostPerBox / sqftPerBox).toFixed(2)) : 0;

      // Selling price: prefer sqft-based if available, else use box price
      const sellingPriceBox  = oi.sellingPrice || 0;
      const sellingPriceSqft = oi.sellingPriceSqft || (sqftPerBox > 0 ? parseFloat((sellingPriceBox / sqftPerBox).toFixed(2)) : 0);
      const finalSellingBox  = sellingPriceBox || (sellingPriceSqft > 0 ? parseFloat((sellingPriceSqft * sqftPerBox).toFixed(2)) : undefined);

      store.updateProduct(oi.productId, {
        purchasePrice:        oi.rate,                    // purchase rate per box
        totalCostPerUnit:     landedCostPerBox,           // landed cost per box → used as base cost in POS
        costPerSqft:          landedCostPerSqft,          // landed cost per sqft → shown in inventory
        sellingPrice:         finalSellingBox || undefined, // selling price per box (POS module)
        sellingPricePerSqft:  sellingPriceSqft || undefined, // selling price per sqft (in sync)
        lastPurchaseVendor:   showReceiveOrder.vendorName,
        lastPurchaseDate:     receiveForm.receivedDate,
        lastPurchaseVehicle:  receiveForm.vehicleNumber,
        linkedOrderId:        showReceiveOrder.id,
      } as any);
    });

    setShowReceiveOrder(null);
    setReceiveForm({ receivedDate: new Date().toISOString().split('T')[0], vehicleNumber: '', godownId: 'g1', damagedItems: [], receivedItems: [] });
  };

  const handleUpdatePayment = () => {
    if (!showUpdatePayment || paymentForm.amount <= 0) return;
    const rec: VendorPaymentRecord = {
      id: `vpay-${Date.now()}`, date: paymentForm.date, amount: paymentForm.amount,
      mode: paymentForm.mode, referenceNo: paymentForm.referenceNo,
      remarks: paymentForm.remarks, paymentSlip: paymentForm.paymentSlip,
    };
    store.recordVendorPayment(showUpdatePayment.id, rec);
    if (paymentForm.invoiceFile) store.updateVendorOrder(showUpdatePayment.id, { invoiceFile: paymentForm.invoiceFile });
    setShowUpdatePayment(null);
    setPaymentForm({ amount: 0, mode: 'RTGS', referenceNo: '', remarks: '', date: new Date().toISOString().split('T')[0], paymentSlip: '', invoiceFile: '' });
  };

  const isAdmin = currentUser?.role === UserRole.ADMIN;

  // ── Input class helper ──────────────────────────────────────────────────
  const inp = "w-full px-4 py-3 bg-slate-100 rounded-2xl font-bold text-sm outline-none border-2 border-transparent focus:border-slate-800 transition-all";
  const lbl = "text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 block mb-1";

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-20">

      {/* ── Header ── */}
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase italic">Vendor Supply Chain</h1>
          <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mt-1">Order Tracking · Inward Management · Landing Cost · Vendor Performance</p>
        </div>
        {isAdmin && (
          <button onClick={() => { setOrderForm(defaultOrderForm()); setShowAddOrder(true); }}
            className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-700 transition-all shadow-xl active:scale-95">
            + New Vendor Order
          </button>
        )}
      </header>

      {/* ── Tabs ── */}
      <div className="flex gap-2">
        {(['orders','performance'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab2(t)}
            className={`px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-widest transition-all ${activeTab2 === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
            {t === 'orders' ? 'Orders' : 'Vendor Performance'}
          </button>
        ))}
      </div>

      {/* ── Reorder Alerts ── */}
      {reorderSuggestions.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center text-white text-xs font-black">{reorderSuggestions.length}</div>
            <span className="font-black text-amber-800 text-sm uppercase tracking-wide">Low Stock — Reorder Suggested</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {reorderSuggestions.map(s => (
              <div key={s.product.id} className="bg-white border border-amber-200 rounded-2xl px-4 py-2 text-xs">
                <span className="font-black text-slate-800">{s.product.name}</span>
                <span className="text-slate-400 ml-2">{s.stock} boxes left</span>
                <span className="text-amber-600 ml-2 font-bold">Last: {s.lastVendor}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab2 === 'orders' && (
        <>
          {/* ── Search & Filter ── */}
          <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm flex flex-wrap gap-3 items-center">
            <i className="fas fa-search text-slate-300 ml-2"></i>
            <input type="text" placeholder="Search by order no, vendor, or product..."
              className="flex-1 min-w-[200px] py-2 font-bold outline-none text-slate-600 bg-transparent"
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            <select className="px-4 py-2 bg-slate-100 rounded-2xl font-bold text-sm outline-none"
              value={filterVendor} onChange={e => setFilterVendor(e.target.value)}>
              {uniqueVendors.map(v => <option key={v}>{v}</option>)}
            </select>
            <select className="px-4 py-2 bg-slate-100 rounded-2xl font-bold text-sm outline-none"
              value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              {['All','Ordered','In Transit','Received','Cancelled'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* ── Order Cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredOrders.length === 0 && (
              <div className="col-span-3 text-center py-20 text-slate-300 font-black text-xl uppercase">No Orders Found</div>
            )}
            {filteredOrders.map(order => {
              const landed = order.totalAmount + order.transportationCost + order.otherCosts;
              const paidPct = landed > 0 ? Math.min((order.paidAmount / landed) * 100, 100) : 0;
              const hasVariance = Math.abs(order.paidAmount - landed) > 1;
              return (
                <div key={order.id} className="bg-white rounded-[32px] border border-slate-100 shadow-sm hover:shadow-xl transition-all overflow-hidden group">
                  <div className="p-6 space-y-4">
                    {/* Header row */}
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Order #{order.orderNo}</div>
                        <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight leading-tight">{order.vendorName}</h3>
                        <div className="text-[10px] text-slate-400 font-bold mt-0.5">{order.orderDate} · {order.items.length} item{order.items.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${
                          order.status === 'Received' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                          order.status === 'In Transit' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                          'bg-amber-50 text-amber-600 border border-amber-100'}`}>{order.status}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase ${
                          order.paymentStatus === 'Paid' ? 'text-emerald-600' :
                          order.paymentStatus === 'Partially Paid' ? 'text-blue-600' : 'text-rose-600'}`}>{order.paymentStatus}</span>
                      </div>
                    </div>

                    {/* Items preview */}
                    <div className="space-y-1">
                      {order.items.slice(0, 2).map((item: any, i) => (
                        <div key={i} className="flex justify-between text-xs bg-slate-50 px-3 py-2 rounded-xl">
                          <span className="font-bold text-slate-700 truncate max-w-[60%]">{item.productName}</span>
                          <span className="font-black text-slate-500">{item.qtyBoxes} boxes · {currency(item.qtyBoxes * item.rate)}</span>
                        </div>
                      ))}
                      {order.items.length > 2 && (
                        <div className="text-[9px] text-slate-400 font-bold text-center">+{order.items.length - 2} more items</div>
                      )}
                    </div>

                    {/* Financial summary */}
                    <div className="bg-indigo-50 rounded-2xl p-3 space-y-2">
                      <div className="flex justify-between text-[9px] font-black text-indigo-500 uppercase">
                        <span>Landed Cost</span><span>{currency(landed)}</span>
                      </div>
                      <div className="w-full bg-indigo-100 h-2 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${order.paymentStatus === 'Paid' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                          style={{ width: `${paidPct}%` }}/>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[8px] font-bold">
                        <div><span className="text-slate-400">Cash </span><span className="text-slate-700">{currency(order.cashAmount)}</span></div>
                        <div><span className="text-slate-400">RTGS </span><span className="text-slate-700">{currency(order.rtgsAmount)}</span></div>
                        <div><span className="text-slate-400">Balance </span><span className="text-rose-600">{currency(order.balanceAmount)}</span></div>
                      </div>
                      {hasVariance && (
                        <div className="text-[9px] font-black text-orange-600 bg-orange-50 rounded-xl px-2 py-1 text-center">
                          ⚠ Payment variance detected
                        </div>
                      )}
                    </div>

                    {/* Damages */}
                    {order.damagedItems?.length > 0 && (
                      <div className="bg-rose-50 border border-rose-100 rounded-2xl px-3 py-2 flex justify-between items-center">
                        <span className="text-[9px] font-black text-rose-600 uppercase">{order.damagedItems.length} damage record{order.damagedItems.length > 1 ? 's' : ''}</span>
                        <button onClick={() => setShowOrderDetails(order)} className="text-[9px] text-rose-500 font-black underline">View</button>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap pt-1">
                      <button onClick={() => setShowOrderDetails(order)}
                        className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-200 transition-all">
                        Details
                      </button>
                      {isAdmin && (
                        <>
                          <button onClick={() => openEditModal(order)}
                            className="flex-1 py-2 bg-amber-50 text-amber-600 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-amber-100 transition-all">
                            Edit
                          </button>
                          <button onClick={() => { setPaymentForm({ amount: 0, mode: 'RTGS', referenceNo: '', remarks: '', date: new Date().toISOString().split('T')[0], paymentSlip: '', invoiceFile: '' }); setShowUpdatePayment(order); }}
                            className="flex-1 py-2 bg-blue-50 text-blue-600 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-blue-100 transition-all">
                            Payment
                          </button>
                          {order.status !== 'Received' && (
                            <button onClick={() => {
                              setReceiveForm({
                                receivedDate: new Date().toISOString().split('T')[0], vehicleNumber: '', godownId: 'g1', damagedItems: [],
                                receivedItems: order.items.map((i: any) => ({ productId: i.productId, orderedQty: i.qtyBoxes, receivedQty: i.qtyBoxes })),
                              });
                              setShowReceiveOrder(order);
                            }}
                              className="flex-1 py-2 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-emerald-700 transition-all shadow">
                              Receive / Inward
                            </button>
                          )}
                          <button onClick={() => { if (confirm('Delete this order?')) store.deleteVendorOrder(order.id); }}
                            className="w-9 py-2 bg-rose-50 text-rose-500 rounded-xl font-black text-[9px] uppercase hover:bg-rose-100 transition-all flex items-center justify-center">
                            <i className="fas fa-trash-alt text-[10px]"></i>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Vendor Performance Tab ── */}
      {activeTab2 === 'performance' && (
        <div className="space-y-4">
          {vendorStats.map(v => {
            const onTimePct = v.fulfilledCount > 0 ? (v.onTimeCount / v.fulfilledCount) * 100 : 0;
            const salesForVendor = store.sales.filter(s => s.items.some(si =>
              orders.find(o => o.vendorName === v.name)?.items.some((oi: any) => oi.productId === si.productId)
            ));
            const totalSalesValue = salesForVendor.reduce((s, sale) => s + sale.totalAmount, 0);
            return (
              <div key={v.name} className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase">{v.name}</h3>
                    <p className="text-[9px] font-bold text-slate-400 uppercase">{v.totalOrders} orders · {currency(v.totalValue)} total purchased</p>
                  </div>
                  <div className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase ${onTimePct >= 80 ? 'bg-emerald-50 text-emerald-600' : onTimePct >= 50 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
                    {onTimePct.toFixed(0)}% on time
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-50 rounded-2xl p-3">
                    <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Fulfilled Orders</div>
                    <div className="text-xl font-black text-slate-900">{v.fulfilledCount}<span className="text-sm text-slate-400">/{v.totalOrders}</span></div>
                  </div>
                  <div className="bg-rose-50 rounded-2xl p-3">
                    <div className="text-[8px] font-black text-rose-400 uppercase mb-1">Damage Records</div>
                    <div className="text-xl font-black text-rose-700">{v.damageCount}</div>
                  </div>
                  <div className="bg-indigo-50 rounded-2xl p-3">
                    <div className="text-[8px] font-black text-indigo-400 uppercase mb-1">Products Supplied</div>
                    <div className="text-xl font-black text-indigo-700">{v.fastMovingItems.length}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-2xl p-3">
                    <div className="text-[8px] font-black text-emerald-400 uppercase mb-1">Sales Generated</div>
                    <div className="text-xl font-black text-emerald-700">{currency(totalSalesValue)}</div>
                  </div>
                </div>
                {/* Fast-moving items from this vendor */}
                <div className="mt-4">
                  <div className="text-[9px] font-black text-slate-400 uppercase mb-2">Items Supplied</div>
                  <div className="flex flex-wrap gap-2">
                    {v.fastMovingItems.slice(0, 8).map(name => {
                      const prod = products.find(p => p.name === name);
                      const lowStock = prod && prod.stockBoxes <= (prod.reorderLevel || 10);
                      return (
                        <span key={name} className={`text-[10px] px-3 py-1 rounded-full font-bold ${lowStock ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-600'}`}>
                          {name}{lowStock ? ' ⚠' : ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          {vendorStats.length === 0 && <div className="text-center py-20 text-slate-300 font-black text-xl uppercase">No vendor data yet</div>}
        </div>
      )}


      {/* ══════════════════════════════════════════════════════════════════
          ADD / EDIT ORDER MODAL
      ══════════════════════════════════════════════════════════════════ */}
      {(showAddOrder || showEditOrder) && (() => {
        const isEdit = !!showEditOrder;
        const accentColor = isEdit ? 'border-amber-500' : 'border-slate-900';
        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
            <div className={`bg-white rounded-[40px] shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh] border-t-8 ${accentColor}`}>
              <div className="p-6 bg-slate-50 border-b flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tighter">{isEdit ? 'Edit Vendor Order' : 'New Vendor Order'}</h2>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
                    {isEdit ? `Editing Order #${showEditOrder?.orderNo}` : 'Create purchase order · items auto-inward to inventory on receive'}
                  </p>
                </div>
                <button onClick={() => { setShowAddOrder(false); setShowEditOrder(null); setOrderForm(defaultOrderForm()); }}
                  className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center">
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div className="p-8 overflow-y-auto space-y-8">

                {/* Vendor & Order Info */}
                <div>
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Vendor & Order Info</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div><label className={lbl}>Order Number</label>
                      <input className={inp} value={orderForm.orderNo} onChange={e => setOrderForm(f => ({ ...f, orderNo: e.target.value }))} placeholder="ORD-2024-001" /></div>
                    <div><label className={lbl}>Vendor Name *</label>
                      <input className={inp} value={orderForm.vendorName} onChange={e => setOrderForm(f => ({ ...f, vendorName: e.target.value }))} placeholder="Kajaria Ceramics" /></div>
                    <div><label className={lbl}>Vendor Phone</label>
                      <input className={inp} value={orderForm.vendorPhone} onChange={e => setOrderForm(f => ({ ...f, vendorPhone: e.target.value }))} placeholder="+91 98765 43210" /></div>
                    <div><label className={lbl}>Vendor GST</label>
                      <input className={inp} value={orderForm.vendorGst} onChange={e => setOrderForm(f => ({ ...f, vendorGst: e.target.value }))} placeholder="29XXXXX..." /></div>
                    <div><label className={lbl}>Order Date</label>
                      <input type="date" className={inp} value={orderForm.orderDate} onChange={e => setOrderForm(f => ({ ...f, orderDate: e.target.value }))} /></div>
                    <div><label className={lbl}>Expected Delivery</label>
                      <input type="date" className={inp} value={orderForm.expectedDeliveryDate} onChange={e => setOrderForm(f => ({ ...f, expectedDeliveryDate: e.target.value }))} /></div>
                    <div><label className={lbl}>Payment Terms</label>
                      <select className={inp} value={orderForm.paymentStatus} onChange={e => setOrderForm(f => ({ ...f, paymentStatus: e.target.value as VendorPaymentStatus }))}>
                        <option>Pending</option><option>Advance</option><option>Partially Paid</option><option>Paid</option><option>Credit</option>
                      </select>
                    </div>
                    {orderForm.paymentStatus === 'Credit' && (
                      <div><label className={lbl}>Credit Days</label>
                        <input type="number" className={inp} value={orderForm.creditDays} onChange={e => setOrderForm(f => ({ ...f, creditDays: +e.target.value }))} /></div>
                    )}
                  </div>
                </div>

                {/* Items */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Order Items *</div>
                    <button onClick={addItem} className="text-[10px] font-black text-blue-600 uppercase hover:underline">+ Add Item</button>
                  </div>
                  <div className="space-y-3">
                    {orderForm.items.map((item, idx) => {
                      const subtotal = item.qtyBoxes * item.rate;
                      return (
                        <div key={idx} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
                          {/* Row 1: Product, Qty, Rate / Box, Rate / SqFt */}
                          <div className="grid grid-cols-12 gap-3 items-end">
                            <div className="col-span-4">
                              <label className="text-[8px] font-black text-slate-400 uppercase ml-1 block mb-1">Product</label>
                              <select className="w-full px-3 py-2 bg-white border rounded-xl font-bold text-xs outline-none"
                                value={item.productId}
                                onChange={e => {
                                  const p = products.find(x => x.id === e.target.value);
                                  const sqft = p?.sqftPerBox || 1;
                                  updateItem(idx, {
                                    productId: e.target.value,
                                    productName: p?.name || '',
                                    rate: p?.purchasePrice || 0,
                                    sellingPrice: p?.sellingPrice || 0,
                                    sellingPriceSqft: sqft > 0 ? parseFloat(((p?.sellingPrice || 0) / sqft).toFixed(2)) : 0,
                                    sqftPerBox: sqft,
                                    rateSqft: sqft > 0 ? parseFloat(((p?.purchasePrice || 0) / sqft).toFixed(2)) : 0,
                                  });
                                }}>
                                <option value="">Select Product</option>
                                {products.map(p => <option key={p.id} value={p.id}>{p.name} — {p.brand} ({p.size})</option>)}
                              </select>
                            </div>
                            <div className="col-span-1">
                              <label className="text-[8px] font-black text-slate-400 uppercase ml-1 block mb-1">Qty (Boxes)</label>
                              <input type="number" className="w-full px-3 py-2 bg-white border rounded-xl font-bold text-xs outline-none"
                                value={item.qtyBoxes} onChange={e => updateItem(idx, { qtyBoxes: +e.target.value })} />
                            </div>
                            <div className="col-span-2">
                              <label className="text-[8px] font-black text-slate-400 uppercase ml-1 block mb-1">Purchase Rate / Box (₹)</label>
                              <input type="number" className="w-full px-3 py-2 bg-white border rounded-xl font-bold text-xs outline-none"
                                value={item.rate}
                                onChange={e => {
                                  const r = +e.target.value;
                                  const sqft = item.sqftPerBox || 1;
                                  updateItem(idx, { rate: r, rateSqft: parseFloat((r / sqft).toFixed(2)) });
                                }} />
                              {(item.sqftPerBox || 0) > 0 && (
                                <div className="text-[8px] font-black text-slate-400 mt-1 ml-1">= ₹{(item.rateSqft || (item.rate / (item.sqftPerBox || 1))).toFixed(2)} / SqFt</div>
                              )}
                            </div>
                            <div className="col-span-2">
                              <label className="text-[8px] font-black text-amber-500 uppercase ml-1 block mb-1">Selling Price / SqFt (₹)</label>
                              <input type="number" className="w-full px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl font-bold text-xs outline-none text-amber-800"
                                value={item.sellingPriceSqft || 0}
                                onChange={e => updateItem(idx, { sellingPriceSqft: +e.target.value })} />
                              {(item.sqftPerBox || 0) > 0 && (
                                <div className="text-[8px] font-black text-amber-500 mt-1 ml-1">= ₹{((item.sellingPriceSqft || 0) * (item.sqftPerBox || 1)).toFixed(0)} / Box</div>
                              )}
                            </div>
                            <div className="col-span-2">
                              <label className="text-[8px] font-black text-amber-500 uppercase ml-1 block mb-1">Selling Price / Box (₹)</label>
                              <input type="number" className="w-full px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl font-bold text-xs outline-none text-amber-800"
                                value={item.sellingPrice || 0}
                                onChange={e => updateItem(idx, { sellingPrice: +e.target.value })} />
                              {(item.sqftPerBox || 0) > 0 && (
                                <div className="text-[8px] font-black text-amber-500 mt-1 ml-1">= ₹{((item.sellingPrice || 0) / (item.sqftPerBox || 1)).toFixed(2)} / SqFt</div>
                              )}
                            </div>
                            <div className="col-span-1 flex justify-end">
                              <button onClick={() => removeItem(idx)} className="w-9 h-9 flex items-center justify-center text-rose-400 hover:bg-rose-50 rounded-xl">
                                <i className="fas fa-trash-alt text-xs"></i>
                              </button>
                            </div>
                          </div>
                          {/* Row 2: Auto-calculated landed cost — per box AND per sqft */}
                          {item.qtyBoxes > 0 && (
                            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 pt-2 border-t border-slate-100">
                              <div className="bg-white rounded-xl px-3 py-2 text-center">
                                <div className="text-[7px] font-black text-slate-400 uppercase">Item Total</div>
                                <div className="text-xs font-black text-slate-800">{currency(subtotal)}</div>
                              </div>
                              <div className="bg-indigo-50 rounded-xl px-3 py-2 text-center">
                                <div className="text-[7px] font-black text-indigo-400 uppercase">Transport %</div>
                                <div className="text-xs font-black text-indigo-700">{(item.transportPct || 0).toFixed(1)}% of cost</div>
                                <div className="text-[7px] text-indigo-400">{(item.transportShare || 0).toFixed(1)}% of burden</div>
                              </div>
                              <div className="bg-emerald-50 rounded-xl px-3 py-2 text-center">
                                <div className="text-[7px] font-black text-emerald-400 uppercase">Landed / Box</div>
                                <div className="text-xs font-black text-emerald-700">{currency(item.landedCost || 0)}</div>
                              </div>
                              <div className="bg-teal-50 rounded-xl px-3 py-2 text-center">
                                <div className="text-[7px] font-black text-teal-400 uppercase">Landed / SqFt</div>
                                <div className="text-xs font-black text-teal-700">₹{(item.landedCostSqft || 0).toFixed(2)}</div>
                              </div>
                              <div className="bg-amber-50 rounded-xl px-3 py-2 text-center">
                                <div className="text-[7px] font-black text-amber-400 uppercase">Margin / Box</div>
                                <div className="text-xs font-black text-amber-700">
                                  {(item.sellingPrice || 0) > (item.landedCost || 0) ? <span className="text-emerald-600">{currency((item.sellingPrice || 0) - (item.landedCost || 0))}</span> : (item.sellingPrice || 0) > 0 ? <span className="text-rose-600">{currency((item.sellingPrice || 0) - (item.landedCost || 0))}</span> : '—'}
                                </div>
                              </div>
                              <div className="bg-amber-50 rounded-xl px-3 py-2 text-center">
                                <div className="text-[7px] font-black text-amber-400 uppercase">Margin / SqFt</div>
                                <div className="text-xs font-black">
                                  {(item.sellingPriceSqft || 0) > (item.landedCostSqft || 0) ? <span className="text-emerald-600">₹{((item.sellingPriceSqft || 0) - (item.landedCostSqft || 0)).toFixed(2)}</span> : (item.sellingPriceSqft || 0) > 0 ? <span className="text-rose-600">₹{((item.sellingPriceSqft || 0) - (item.landedCostSqft || 0)).toFixed(2)}</span> : '—'}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {orderForm.items.length === 0 && (
                      <div className="text-center py-8 text-slate-300 font-black text-sm uppercase border-2 border-dashed border-slate-200 rounded-2xl">
                        No items added. Click "+ Add Item" above.
                      </div>
                    )}
                  </div>
                </div>

                {/* Cost & Payment Breakdown */}
                <div className="bg-indigo-50/60 border border-indigo-100 rounded-[28px] p-6 space-y-4">
                  <div className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Cost & Payment Breakdown</div>
                  {/* Transport calculation helper */}
                  <div className="bg-white/70 rounded-2xl p-4 border border-indigo-100 space-y-3">
                    <div className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">Transport Cost Calculator</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className={lbl}>Rate per Ton (₹)</label>
                        <input type="number" className={inp} placeholder="e.g. 3100"
                          value={orderForm.transportTonRate || ''}
                          onChange={e => {
                            const rate = +e.target.value;
                            const tons = orderForm.transportTons || 0;
                            const tc = parseFloat((rate * tons).toFixed(2));
                            setOrderForm(f => ({ ...f, transportTonRate: rate, transportationCost: tc }));
                            updateCosts('transportationCost', tc);
                          }} />
                      </div>
                      <div>
                        <label className={lbl}>Vehicle Load (Tons)</label>
                        <input type="number" className={inp} placeholder="e.g. 35"
                          value={orderForm.transportTons || ''}
                          onChange={e => {
                            const tons = +e.target.value;
                            const rate = orderForm.transportTonRate || 0;
                            const tc = parseFloat((rate * tons).toFixed(2));
                            setOrderForm(f => ({ ...f, transportTons: tons, transportationCost: tc }));
                            updateCosts('transportationCost', tc);
                          }} />
                      </div>
                      <div>
                        <label className={lbl}>= Transport Cost (₹)</label>
                        <input type="number" className={`${inp} bg-indigo-100 font-black text-indigo-800`}
                          value={orderForm.transportationCost}
                          onChange={e => updateCosts('transportationCost', +e.target.value)} />
                        {orderForm.transportTonRate > 0 && orderForm.transportTons > 0 && (
                          <div className="text-[8px] font-black text-indigo-500 mt-1 ml-1">{orderForm.transportTons}T × ₹{orderForm.transportTonRate.toLocaleString()} = ₹{(orderForm.transportTons * orderForm.transportTonRate).toLocaleString()}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className={lbl}>Other Charges (₹)</label>
                      <input type="number" className={inp} value={orderForm.otherCosts}
                        onChange={e => updateCosts('otherCosts', +e.target.value)} />
                    </div>
                    <div>
                      <label className={lbl}>Cash Payment (₹)</label>
                      <input type="number" className={inp} value={orderForm.cashAmount}
                        onChange={e => updateCosts('cashAmount', +e.target.value)} />
                    </div>
                    <div>
                      <label className={lbl}>RTGS Payment (₹)</label>
                      <input type="number" className={inp} value={orderForm.rtgsAmount}
                        onChange={e => updateCosts('rtgsAmount', +e.target.value)} />
                    </div>
                    <div>
                      <label className={lbl}>Transport Payment (₹)</label>
                      <input type="number" className={inp} value={orderForm.transportPayment}
                        onChange={e => setOrderForm(f => ({ ...f, transportPayment: +e.target.value }))} />
                    </div>
                  </div>

                  {/* Running totals */}
                  {(() => {
                    const transportTotal = orderForm.transportationCost + orderForm.otherCosts;
                    const paymentTotal = orderForm.cashAmount + orderForm.rtgsAmount;
                    // CORRECT: transport % = (transport+other) ÷ (cash+RTGS) × 100
                    const overallTransportPct = paymentTotal > 0 ? (transportTotal / paymentTotal) * 100 : 0;
                    return (
                      <div className="space-y-3 pt-2 border-t border-indigo-100">
                        {/* Transport % summary — formula: (Transport+Other) ÷ (Cash+RTGS) */}
                        <div className="bg-indigo-50 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3 text-xs">
                          <div className="text-center">
                            <span className="font-black text-indigo-400 text-[8px] uppercase block">Transport + Other</span>
                            <span className="font-black text-indigo-900 text-base">{currency(transportTotal)}</span>
                          </div>
                          <div className="text-indigo-300 text-xl font-thin">÷</div>
                          <div className="text-center">
                            <span className="font-black text-indigo-400 text-[8px] uppercase block">Cash + RTGS</span>
                            <span className="font-black text-indigo-900 text-base">{currency(orderForm.cashAmount + orderForm.rtgsAmount)}</span>
                          </div>
                          <div className="text-indigo-300 text-xl font-thin">=</div>
                          <div className="bg-indigo-600 text-white rounded-xl px-4 py-2 text-center">
                            <div className="text-[8px] font-black uppercase opacity-70">Transport %</div>
                            <div className="text-xl font-black">{overallTransportPct.toFixed(2)}%</div>
                            <div className="text-[8px] opacity-70">added to every item rate</div>
                          </div>
                          <div className="text-xs text-indigo-600 font-bold bg-white rounded-xl px-3 py-2">
                            e.g. ₹500 rate + {overallTransportPct.toFixed(2)}% = ₹{(500 * (1 + overallTransportPct/100)).toFixed(2)} landed
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-white rounded-2xl p-3">
                            <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Items Total</div>
                            <div className="text-lg font-black text-slate-900">{currency(itemTotal)}</div>
                          </div>
                          <div className="bg-indigo-100 rounded-2xl p-3">
                            <div className="text-[8px] font-black text-indigo-400 uppercase mb-1">Total Landed Cost</div>
                            <div className="text-lg font-black text-indigo-900">{currency(totalCost)}</div>
                          </div>
                          <div className="bg-emerald-50 rounded-2xl p-3">
                            <div className="text-[8px] font-black text-emerald-400 uppercase mb-1">Cash + RTGS + Transport</div>
                            <div className="text-lg font-black text-emerald-800">{currency(totalPaid)}</div>
                          </div>
                          <div className={`rounded-2xl p-3 ${Math.abs(variance) > 1 ? 'bg-orange-100' : 'bg-slate-50'}`}>
                            <div className={`text-[8px] font-black uppercase mb-1 ${Math.abs(variance) > 1 ? 'text-orange-500' : 'text-slate-400'}`}>Variance</div>
                            <div className={`text-lg font-black ${Math.abs(variance) > 1 ? 'text-orange-700' : 'text-slate-600'}`}>
                              {Math.abs(variance) < 1 ? '✓ Balanced' : `${variance > 0 ? '−' : '+'} ${currency(Math.abs(variance))}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {Math.abs(variance) > 1 && (
                    <div className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 text-xs font-bold text-orange-700">
                      ⚠ Variance detected: Landed cost ({currency(totalCost)}) ≠ Total payments ({currency(totalPaid)}). 
                      Difference: {currency(Math.abs(variance))}. Please review before saving.
                    </div>
                  )}
                </div>

                {/* Remarks & Invoice */}
                <div className="grid grid-cols-2 gap-4">
                  <div><label className={lbl}>Remarks / Notes</label>
                    <textarea className={`${inp} min-h-[80px] resize-none`} value={orderForm.remarks}
                      onChange={e => setOrderForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Any special instructions..." /></div>
                  <div><label className={lbl}>Invoice / Document Upload</label>
                    <input type="file" className={`${inp} text-xs`}
                      onChange={e => { const file = e.target.files?.[0]; if (file) { const r = new FileReader(); r.onloadend = () => setOrderForm(f => ({ ...f, invoiceFile: r.result as string })); r.readAsDataURL(file); } }} />
                    {orderForm.invoiceFile && <div className="text-[9px] text-emerald-600 font-black mt-1 ml-2">✓ Document attached</div>}
                  </div>
                </div>

                <button onClick={() => handleSaveOrder(isEdit)}
                  disabled={!orderForm.vendorName || orderForm.items.length === 0}
                  className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">
                  {isEdit ? 'Save Changes' : 'Create Order'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}


      {/* ══════════════════════════════════════════════════════════════════
          RECEIVE / INWARD MODAL
      ══════════════════════════════════════════════════════════════════ */}
      {showReceiveOrder && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] border-t-8 border-emerald-600">
            <div className="p-6 bg-slate-50 border-b flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter">Inward Material</h2>
                <p className="text-[9px] font-black text-slate-400 uppercase mt-1">Order #{showReceiveOrder.orderNo} · {showReceiveOrder.vendorName}</p>
              </div>
              <button onClick={() => setShowReceiveOrder(null)} className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 flex items-center justify-center">
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="p-8 overflow-y-auto space-y-6">
              {/* Basic receive info */}
              <div className="grid grid-cols-3 gap-4">
                <div><label className={lbl}>Received Date</label>
                  <input type="date" className={inp} value={receiveForm.receivedDate}
                    onChange={e => setReceiveForm(f => ({ ...f, receivedDate: e.target.value }))} /></div>
                <div><label className={lbl}>Vehicle Number</label>
                  <input className={inp} value={receiveForm.vehicleNumber}
                    onChange={e => setReceiveForm(f => ({ ...f, vehicleNumber: e.target.value }))} placeholder="KA-01-AB-1234" /></div>
                <div><label className={lbl}>Destination Godown</label>
                  <select className={inp} value={receiveForm.godownId} onChange={e => setReceiveForm(f => ({ ...f, godownId: e.target.value }))}>
                    {store.godowns.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Received qty per item — tracks variation */}
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Actual Received Quantities (vs Ordered)</div>
                <div className="space-y-2">
                  {receiveForm.receivedItems.map((ri, idx) => {
                    const orderItem = (showReceiveOrder.items as any[]).find(i => i.productId === ri.productId);
                    const variation = ri.receivedQty - ri.orderedQty;
                    return (
                      <div key={ri.productId} className="grid grid-cols-4 gap-3 bg-slate-50 rounded-2xl p-3 items-center">
                        <div className="col-span-2">
                          <div className="font-black text-sm text-slate-800">{orderItem?.productName || ri.productId}</div>
                          <div className="text-[9px] text-slate-400 font-bold">Ordered: {ri.orderedQty} boxes</div>
                        </div>
                        <div>
                          <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Received Qty</label>
                          <input type="number" className="w-full px-3 py-2 bg-white border rounded-xl font-bold text-sm outline-none"
                            value={ri.receivedQty}
                            onChange={e => setReceiveForm(f => ({ ...f, receivedItems: f.receivedItems.map((r, i) => i === idx ? { ...r, receivedQty: +e.target.value } : r) }))} />
                        </div>
                        <div className={`text-center text-sm font-black rounded-xl px-2 py-2 ${variation === 0 ? 'bg-emerald-50 text-emerald-600' : variation > 0 ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-600'}`}>
                          {variation === 0 ? '✓ Exact' : variation > 0 ? `+${variation}` : `${variation}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Damages */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Damaged Items (if any)</div>
                  <button onClick={() => setReceiveForm(f => ({
                    ...f, damagedItems: [...f.damagedItems, {
                      id: `d-${Date.now()}`, productId: showReceiveOrder.items[0]?.productId || '',
                      productName: (showReceiveOrder.items[0] as any)?.productName || '',
                      qtyDamaged: 0, type: 'Box', reason: '', date: new Date().toISOString().split('T')[0], photos: [],
                    }]
                  }))} className="text-[10px] font-black text-rose-500 uppercase hover:underline">+ Add Damage</button>
                </div>
                {receiveForm.damagedItems.map((d, idx) => (
                  <div key={idx} className="bg-rose-50 border border-rose-100 rounded-2xl p-4 mb-2 grid grid-cols-2 gap-3">
                    <div><label className="text-[8px] font-black text-rose-400 uppercase block mb-1">Product</label>
                      <select className="w-full px-3 py-2 bg-white border rounded-xl font-bold text-xs outline-none"
                        value={d.productId}
                        onChange={e => {
                          const p = showReceiveOrder.items.find((i: any) => i.productId === e.target.value) as any;
                          setReceiveForm(f => ({ ...f, damagedItems: f.damagedItems.map((di, i) => i === idx ? { ...di, productId: e.target.value, productName: p?.productName || '' } : di) }));
                        }}>
                        {showReceiveOrder.items.map((i: any) => <option key={i.productId} value={i.productId}>{i.productName}</option>)}
                      </select>
                    </div>
                    <div><label className="text-[8px] font-black text-rose-400 uppercase block mb-1">Qty Damaged</label>
                      <input type="number" className="w-full px-3 py-2 bg-white border rounded-xl font-bold text-xs outline-none" value={d.qtyDamaged}
                        onChange={e => setReceiveForm(f => ({ ...f, damagedItems: f.damagedItems.map((di, i) => i === idx ? { ...di, qtyDamaged: +e.target.value } : di) }))} /></div>
                    <div><label className="text-[8px] font-black text-rose-400 uppercase block mb-1">Type</label>
                      <select className="w-full px-3 py-2 bg-white border rounded-xl font-bold text-xs outline-none" value={d.type}
                        onChange={e => setReceiveForm(f => ({ ...f, damagedItems: f.damagedItems.map((di, i) => i === idx ? { ...di, type: e.target.value as any } : di) }))}>
                        <option>Box</option><option>Piece</option>
                      </select>
                    </div>
                    <div><label className="text-[8px] font-black text-rose-400 uppercase block mb-1">Reason</label>
                      <input className="w-full px-3 py-2 bg-white border rounded-xl font-bold text-xs outline-none" value={d.reason}
                        onChange={e => setReceiveForm(f => ({ ...f, damagedItems: f.damagedItems.map((di, i) => i === idx ? { ...di, reason: e.target.value } : di) }))} placeholder="Transport damage..." /></div>
                    <div className="col-span-2 flex justify-end">
                      <button onClick={() => setReceiveForm(f => ({ ...f, damagedItems: f.damagedItems.filter((_, i) => i !== idx) }))} className="text-[9px] font-black text-rose-500 hover:underline">Remove</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 text-xs font-bold text-emerald-700">
                ✓ On confirming inward: stock will be added to <strong>{store.godowns.find(g => g.id === receiveForm.godownId)?.name}</strong>, inventory pricing will be auto-updated from this order's landed cost.
              </div>

              <button onClick={handleReceiveOrder}
                disabled={!receiveForm.vehicleNumber}
                className="w-full py-5 bg-emerald-600 text-white rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl active:scale-95 disabled:opacity-40">
                Confirm Inward & Update Inventory
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ══════════════════════════════════════════════════════════════════
          PAYMENT MODAL
      ══════════════════════════════════════════════════════════════════ */}
      {showUpdatePayment && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border-t-8 border-blue-600">
            <div className="p-6 bg-slate-50 border-b flex justify-between items-center">
              <div>
                <h2 className="text-xl font-black uppercase tracking-tighter">Record Payment</h2>
                <p className="text-[9px] font-black text-slate-400 uppercase mt-1">{showUpdatePayment.vendorName} · Balance: {currency(showUpdatePayment.balanceAmount)}</p>
              </div>
              <button onClick={() => setShowUpdatePayment(null)} className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 flex items-center justify-center">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-8 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>Amount (₹)</label>
                  <input type="number" className={inp} value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: +e.target.value }))} /></div>
                <div><label className={lbl}>Mode</label>
                  <select className={inp} value={paymentForm.mode} onChange={e => setPaymentForm(f => ({ ...f, mode: e.target.value as VendorPaymentMode }))}>
                    <option>Cash</option><option>RTGS</option><option>Cheque</option><option>UPI</option>
                  </select>
                </div>
                <div><label className={lbl}>Date</label>
                  <input type="date" className={inp} value={paymentForm.date} onChange={e => setPaymentForm(f => ({ ...f, date: e.target.value }))} /></div>
                <div><label className={lbl}>Reference No.</label>
                  <input className={inp} value={paymentForm.referenceNo} onChange={e => setPaymentForm(f => ({ ...f, referenceNo: e.target.value }))} placeholder="UTR / Cheque No." /></div>
                <div className="col-span-2"><label className={lbl}>Remarks</label>
                  <input className={inp} value={paymentForm.remarks} onChange={e => setPaymentForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              </div>
              <button onClick={handleUpdatePayment} disabled={paymentForm.amount <= 0}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-40">
                Record Payment
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ══════════════════════════════════════════════════════════════════
          ORDER DETAILS MODAL
      ══════════════════════════════════════════════════════════════════ */}
      {showOrderDetails && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] border-t-8 border-slate-700">
            <div className="p-6 bg-slate-50 border-b flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter">Order Details</h2>
                <p className="text-[9px] font-black text-slate-400 uppercase mt-1">#{showOrderDetails.orderNo} · {showOrderDetails.vendorName}</p>
              </div>
              <button onClick={() => setShowOrderDetails(null)} className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 flex items-center justify-center">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-8 overflow-y-auto space-y-6">

              {/* Status & Dates */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Status', val: showOrderDetails.status },
                  { label: 'Payment', val: showOrderDetails.paymentStatus },
                  { label: 'Order Date', val: showOrderDetails.orderDate },
                  { label: 'Expected', val: showOrderDetails.expectedDeliveryDate || '—' },
                  { label: 'Received', val: showOrderDetails.receivedDate || '—' },
                  { label: 'Vehicle', val: showOrderDetails.vehicleNumber || '—' },
                ].map(({ label, val }) => (
                  <div key={label} className="bg-slate-50 rounded-2xl p-3">
                    <div className="text-[8px] font-black text-slate-400 uppercase mb-1">{label}</div>
                    <div className="text-sm font-black text-slate-800">{val}</div>
                  </div>
                ))}
              </div>

              {/* Items with landed cost */}
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Items & Landing Cost</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        {['Product','Boxes','Rcvd','Rate/Box','Rate/SqFt','Total','Trans%','Landed/Box','Landed/SqFt','Sell/Box','Sell/SqFt','Margin/Box'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-black text-[8px] text-slate-400 uppercase whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {showOrderDetails.items.map((item: any, i) => {
                        const sqft       = item.sqftPerBox || 1;
                        const landedBox  = item.landedCost || 0;
                        const landedSqft = item.landedCostSqft || (sqft > 0 ? parseFloat((landedBox / sqft).toFixed(2)) : 0);
                        const sellBox    = item.sellingPrice || 0;
                        const sellSqft   = item.sellingPriceSqft || (sqft > 0 ? parseFloat((sellBox / sqft).toFixed(2)) : 0);
                        const marginBox  = sellBox > 0 ? sellBox - landedBox : null;
                        return (
                          <tr key={i} className="border-t border-slate-50">
                            <td className="px-3 py-3 font-bold text-slate-800 whitespace-nowrap">{item.productName}</td>
                            <td className="px-3 py-3 font-black text-slate-600">{item.qtyBoxes}</td>
                            <td className="px-3 py-3 font-black text-emerald-600">{item.receivedQty ?? '—'}</td>
                            <td className="px-3 py-3 font-black text-slate-600">{currency(item.rate)}</td>
                            <td className="px-3 py-3 font-black text-slate-500">₹{(item.rateSqft || item.rate / sqft).toFixed(2)}</td>
                            <td className="px-3 py-3 font-black text-slate-800">{currency(item.qtyBoxes * item.rate)}</td>
                            <td className="px-3 py-3 font-black text-indigo-600">{item.transportPct ? `${item.transportPct.toFixed(1)}%` : (item.transportShare ? pct(item.transportShare) : '—')}</td>
                            <td className="px-3 py-3 font-black text-emerald-700">{landedBox ? currency(landedBox) : '—'}</td>
                            <td className="px-3 py-3 font-black text-teal-700">{landedSqft ? `₹${landedSqft.toFixed(2)}` : '—'}</td>
                            <td className="px-3 py-3 font-black text-amber-700">{sellBox ? currency(sellBox) : '—'}</td>
                            <td className="px-3 py-3 font-black text-amber-600">{sellSqft ? `₹${sellSqft.toFixed(2)}` : '—'}</td>
                            <td className={`px-3 py-3 font-black ${marginBox !== null ? (marginBox >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-300'}`}>{marginBox !== null ? currency(marginBox) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financials */}
              <div className="bg-indigo-50 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Items Total', val: currency(showOrderDetails.totalAmount), color: 'text-slate-800' },
                  { label: 'Transport', val: currency(showOrderDetails.transportationCost), color: 'text-indigo-700' },
                  { label: 'Other Costs', val: currency(showOrderDetails.otherCosts), color: 'text-indigo-700' },
                  { label: 'Landed Cost', val: currency(showOrderDetails.totalAmount + showOrderDetails.transportationCost + showOrderDetails.otherCosts), color: 'text-indigo-900 text-base' },
                  { label: 'Cash Paid', val: currency(showOrderDetails.cashAmount), color: 'text-emerald-700' },
                  { label: 'RTGS Paid', val: currency(showOrderDetails.rtgsAmount), color: 'text-emerald-700' },
                  { label: 'Total Paid', val: currency(showOrderDetails.paidAmount), color: 'text-emerald-900' },
                  { label: 'Balance', val: currency(showOrderDetails.balanceAmount), color: 'text-rose-700' },
                ].map(({ label, val, color }) => (
                  <div key={label} className="bg-white rounded-xl p-3">
                    <div className="text-[7px] font-black text-slate-400 uppercase mb-1">{label}</div>
                    <div className={`text-sm font-black ${color}`}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Payment History */}
              {showOrderDetails.paymentHistory?.length > 0 && (
                <div>
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Payment History</div>
                  <div className="space-y-2">
                    {showOrderDetails.paymentHistory.map((p, i) => (
                      <div key={i} className="flex justify-between items-center bg-slate-50 rounded-2xl px-4 py-3 text-sm">
                        <div><span className="font-black text-slate-800">{currency(p.amount)}</span> <span className="font-bold text-slate-400 ml-2">{p.mode}</span></div>
                        <div className="text-slate-400 font-bold text-xs">{p.date} {p.referenceNo && `· ${p.referenceNo}`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Damages */}
              {showOrderDetails.damagedItems?.length > 0 && (
                <div>
                  <div className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-3">Damage Records</div>
                  <div className="space-y-2">
                    {showOrderDetails.damagedItems.map((d, i) => (
                      <div key={i} className="flex justify-between items-center bg-rose-50 border border-rose-100 rounded-2xl px-4 py-3 text-sm">
                        <div><span className="font-black text-rose-700">{d.productName}</span> <span className="text-rose-400 font-bold ml-2">{d.qtyDamaged} {d.type}(s)</span></div>
                        <div className="text-rose-400 font-bold text-xs">{d.reason || '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showOrderDetails.remarks && (
                <div className="bg-slate-50 rounded-2xl px-5 py-4">
                  <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Remarks</div>
                  <div className="text-sm font-bold text-slate-700">{showOrderDetails.remarks}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default VendorTracking;
