
import React, { useMemo, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area } from 'recharts';
import { store } from '../store';
import { UserRole } from '../types';

const Dashboard: React.FC = () => {
  const [isOnline, setIsOnline] = useState(store.isOnline);
  const [lastSync, setLastSync] = useState(store.lastUpdated);
  const currentUser = store.currentUser;
  const isExecutive = currentUser?.role === UserRole.SALES_EXECUTIVE;
  
  useEffect(() => {
    const unsub = store.subscribe(() => {
      setIsOnline(store.isOnline);
      setLastSync(store.lastUpdated);
    });
    return unsub;
  }, []);

  const totalStockValue = store.getTotalInventoryValue();
  
  // Metrics calculation
  const financialMetrics = useMemo(() => {
    let totalCogs = 0;
    let totalCommission = 0;
    let accruedCommission = 0;
    let paidCommission = 0;
    let totalRevenue = 0;
    let monthlyRevenue = 0;
    let todayRevenue = 0;
    let totalOverdue = 0;

    const todayStr = new Date().toLocaleDateString();
    const currentMonthStr = new Date().toISOString().slice(0, 7);

    const relevantSales = isExecutive 
      ? store.sales.filter(s => s.salesPersonId === currentUser?.id)
      : store.sales;

    relevantSales.forEach(s => {
      const taxableAmount = s.subTotal - (s.discountType === 'Fixed' ? s.discountValue : (s.subTotal * s.discountValue) / 100);
      totalRevenue += taxableAmount;
      
      if (s.balance > 0) {
        totalOverdue += s.balance;
      }

      if (s.date === todayStr) todayRevenue += taxableAmount;
      const saleDate = new Date(s.date);
      if (!isNaN(saleDate.getTime()) && saleDate.toISOString().slice(0, 7) === currentMonthStr) {
        monthlyRevenue += taxableAmount;
      }
      
      const commission = s.commissionType === 'Fixed' ? s.commissionValue : (taxableAmount * s.commissionValue) / 100;
      totalCommission += commission;
      
      if (s.commissionStatus === 'Paid') paidCommission += commission;
      else accruedCommission += commission;

      s.items.forEach(item => {
        const product = store.products.find(p => p.id === item.productId);
        if (product) {
          const landedCost = item.costRate || product.totalCostPerUnit;
          const piecesPerBox = product.tilesPerBox || 1;
          const unitsAsBoxes = item.qtyBoxes + (item.qtyLoose / piecesPerBox);
          totalCogs += (unitsAsBoxes * landedCost);
        }
      });
    });

    const grossProfit = totalRevenue - totalCogs;
    const totalExpenses = isExecutive ? 0 : store.expenses.reduce((sum, e) => sum + e.amount, 0);
    // Referral commission is a cost that reduces net profit
    const totalReferralCommission = (store.referralCommissions || []).reduce((s, c) => s + (c.commissionAmount || 0), 0);
    const netProfit = grossProfit - totalCommission - totalExpenses - totalReferralCommission;

    return { 
      grossProfit, totalCommission, accruedCommission, paidCommission,
      totalExpenses, netProfit, totalRevenue, monthlyRevenue, todayRevenue,
      totalCogs, totalOverdue, totalReferralCommission,
      marginPercent: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0
    };
  }, [store.sales, store.expenses, store.products, isExecutive, currentUser]);

  const chartData = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return { name: days[d.getDay()], dateStr: d.toLocaleDateString(), sales: 0, commission: 0 };
    });

    const relevantSales = isExecutive ? store.sales.filter(s => s.salesPersonId === currentUser?.id) : store.sales;
    relevantSales.forEach(s => {
      const chartDay = last7Days.find(d => d.dateStr === s.date);
      if (chartDay) {
        const taxable = s.subTotal - (s.discountType === 'Fixed' ? s.discountValue : (s.subTotal * s.discountValue) / 100);
        chartDay.sales += taxable;
        const comm = s.commissionType === 'Fixed' ? s.commissionValue : (taxable * s.commissionValue) / 100;
        chartDay.commission += comm;
      }
    });
    return last7Days;
  }, [store.sales, isExecutive, currentUser]);

  const supplyChainMetrics = useMemo(() => {
    const pendingOrders = store.vendorOrders.filter(o => o.status === 'Ordered' || o.status === 'Partial').length;
    const totalPayable = store.vendorOrders.reduce((sum, o) => sum + o.balanceAmount, 0);
    const lowStockItems = store.products.filter(p => p.stockBoxes <= p.reorderLevel).length;
    return { pendingOrders, totalPayable, lowStockItems };
  }, [store.vendorOrders, store.products]);

  const formatCurrency = (val: number) => {
    if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
    return `₹${val.toFixed(0)}`;
  };

  // ── Kadapa stock summary ────────────────────────────────────────────────────
  const kadapaStats = useMemo(() => {
    const kadapaProducts = store.products.filter((p: any) => p.category === 'Kadapa');
    const allSlabs = kadapaProducts.flatMap((p: any) => p.slabs || []);
    const availSlabs = allSlabs.filter((s: any) => !s.isSold);
    const byFinish: Record<string, { total: number; avail: number; totalSqft: number; availSqft: number }> = {};
    allSlabs.forEach((s: any) => {
      const f = s.finish || 'Unknown';
      if (!byFinish[f]) byFinish[f] = { total: 0, avail: 0, totalSqft: 0, availSqft: 0 };
      byFinish[f].total++;
      byFinish[f].totalSqft += s.sqft || 0;
      if (!s.isSold) { byFinish[f].avail++; byFinish[f].availSqft += s.sqft || 0; }
    });
    return {
      totalSlabs: allSlabs.length,
      availSlabs: availSlabs.length,
      totalSqft: allSlabs.reduce((a: number, s: any) => a + (s.sqft || 0), 0),
      availSqft: availSlabs.reduce((a: number, s: any) => a + (s.sqft || 0), 0),
      byFinish,
    };
  }, [store.products]);

  // ── Granite / Marble stock summary ──────────────────────────────────────────
  const graniteStats = useMemo(() => {
    const graniteProducts = store.products.filter((p: any) =>
      p.category === 'Granite' || p.category === 'Marble'
    );
    const byProduct: Array<{
      id: string; name: string; category: string;
      totalSlabs: number; availSlabs: number;
      totalSqft: number; availSqft: number;
      landedPerSqft: number; sellingPerSqft: number;
      // by size
      sizes: Record<string, { total: number; avail: number; sqft: number }>;
    }> = [];

    graniteProducts.forEach((p: any) => {
      const slabs: any[] = p.slabs || [];
      const avail = slabs.filter((s: any) => !s.isSold);
      const sizes: Record<string, { total: number; avail: number; sqft: number }> = {};
      slabs.forEach((s: any) => {
        const key = `${s.lengthFt}×${s.heightFt}`;
        if (!sizes[key]) sizes[key] = { total: 0, avail: 0, sqft: s.sqft || 0 };
        sizes[key].total++;
        if (!s.isSold) sizes[key].avail++;
      });
      byProduct.push({
        id: p.id, name: p.name, category: p.category,
        totalSlabs: slabs.length,
        availSlabs: avail.length,
        totalSqft: Math.round(slabs.reduce((a: number, s: any) => a + (s.sqft || 0), 0) * 100) / 100,
        availSqft: Math.round(avail.reduce((a: number, s: any) => a + (s.sqft || 0), 0) * 100) / 100,
        landedPerSqft: p.purchasePrice || p.costPerSqft || 0,
        sellingPerSqft: p.sellingPricePerSqft || 0,
        sizes,
      });
    });

    return byProduct;
  }, [store.products]);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20 relative">
      {/* Cloud Sync Pulse Indicator */}
      <div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-bottom-4">
         <div className={`flex items-center gap-3 px-5 py-2.5 rounded-full border-2 shadow-2xl backdrop-blur-md transition-all ${isOnline ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-rose-500/10 border-rose-500/20 text-rose-500'}`}>
            <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-rose-500 animate-pulse'}`}></div>
            <div className="flex flex-col">
               <span className="text-[10px] font-black uppercase tracking-widest leading-none">{isOnline ? 'Cloud Synced' : 'Sync Offline'}</span>
               <span className="text-[8px] font-bold opacity-60 uppercase mt-0.5">Last Pulse: {new Date(lastSync).toLocaleTimeString()}</span>
            </div>
         </div>
      </div>

      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase leading-none italic">Executive Insights</h1>
           <p className="text-slate-500 font-bold mt-2 uppercase text-[10px] tracking-[0.2em]">Commercial Ledger • Live Performance • ROI Audit</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Manual refresh button */}
          <button
            onClick={() => store.refreshFromServer(true)}
            disabled={store.isSyncing}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50">
            <i className={`fas fa-sync text-sm text-slate-500 ${store.isSyncing ? 'animate-spin' : ''}`}></i>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
              {store.isSyncing ? 'Syncing…' : 'Refresh'}
            </span>
          </button>
          <div className="bg-white px-6 py-3 rounded-2xl border shadow-sm flex items-center gap-3">
             <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Node User: {currentUser?.name}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-6">
        {store.settings.dashboardVisibility.showDailyBooking && (
          <Widget title="Daily Booking" value={formatCurrency(financialMetrics.todayRevenue)} sub="Today's Gross" icon="fa-shopping-cart" color="bg-blue-600" />
        )}
        {store.settings.dashboardVisibility.showOverdueOption && (
          <Widget title="Overdue Arrears" value={formatCurrency(financialMetrics.totalOverdue)} sub="Pending Payments" icon="fa-hand-holding-usd" color="bg-rose-600" />
        )}
        {store.settings.dashboardVisibility.showStockValuation && (
          <Widget title="Stock Valuation" value={formatCurrency(totalStockValue)} sub="Asset at Landed Cost" icon="fa-warehouse" color="bg-slate-900" />
        )}
        <Widget title="Pending Orders" value={supplyChainMetrics.pendingOrders.toString()} sub="Vendor Supply Chain" icon="fa-truck-loading" color="bg-amber-600" />
        <Widget title="Low Stock" value={supplyChainMetrics.lowStockItems.toString()} sub="Inventory Alerts" icon="fa-exclamation-triangle" color="bg-rose-500" />
        <Widget title="Gross Margin %" value={`${financialMetrics.marginPercent.toFixed(1)}%`} sub="Profitability Ratio" icon="fa-chart-line" color="bg-indigo-600" />
        {store.settings.dashboardVisibility.showNetProfit && (
          <Widget title="Net Profit (Est)" value={formatCurrency(financialMetrics.netProfit)} sub={`After Staff Comm. ₹${Math.round(financialMetrics.totalCommission).toLocaleString('en-IN')} + Referral ₹${Math.round(financialMetrics.totalReferralCommission||0).toLocaleString('en-IN')} + OpEx`} icon="fa-vault" color="bg-emerald-600" />
        )}
      </div>


      {/* ── Granite & Marble Slab Dashboard ── */}
      {graniteStats.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-[40px] p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-black text-slate-800 uppercase tracking-tight text-sm flex items-center gap-2">
                <span className="w-7 h-7 bg-slate-700 rounded-xl flex items-center justify-center text-white text-xs">G</span>
                Granite & Marble Registry
              </h3>
              <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">
                Live slab stock · size-wise · sqft-wise · per product
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black text-slate-700">
                {graniteStats.reduce((a, p) => a + p.availSlabs, 0)}
                <span className="text-sm text-slate-400">/{graniteStats.reduce((a, p) => a + p.totalSlabs, 0)}</span>
              </div>
              <div className="text-[9px] font-bold text-slate-400">slabs available</div>
              <div className="text-[9px] font-bold text-slate-600">
                {graniteStats.reduce((a, p) => a + p.availSqft, 0).toFixed(1)} SqFt available
              </div>
            </div>
          </div>

          {/* Per-product breakdown */}
          <div className="space-y-3">
            {graniteStats.map(p => (
              <div key={p.id} className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-black text-slate-800 text-sm">{p.name}</div>
                    <div className="text-[8px] text-slate-400 font-bold uppercase">{p.category}</div>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    {p.landedPerSqft > 0 && (
                      <div>
                        <div className="text-[7px] font-black text-slate-400 uppercase">Landed/SqFt</div>
                        <div className="text-sm font-black text-emerald-700">₹{p.landedPerSqft}</div>
                      </div>
                    )}
                    {p.sellingPerSqft > 0 && (
                      <div>
                        <div className="text-[7px] font-black text-slate-400 uppercase">Selling/SqFt</div>
                        <div className="text-sm font-black text-amber-700">₹{p.sellingPerSqft}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-[7px] font-black text-slate-400 uppercase">Slabs</div>
                      <div className="text-lg font-black text-slate-700">
                        {p.availSlabs}<span className="text-slate-300 text-sm">/{p.totalSlabs}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[7px] font-black text-emerald-500 uppercase">Avail SqFt</div>
                      <div className="text-lg font-black text-emerald-700">{p.availSqft}</div>
                    </div>
                  </div>
                </div>

                {/* Size breakdown */}
                {Object.keys(p.sizes).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(p.sizes).map(([sz, stats]: [string, any]) => (
                      <div key={sz} className={`text-[9px] px-3 py-1.5 rounded-xl font-bold border
                        ${stats.avail === 0
                          ? 'bg-slate-50 border-slate-100 text-slate-400'
                          : 'bg-indigo-50 border-indigo-100 text-indigo-700'}`}>
                        <span className="font-black">{sz} ft</span>
                        <span className="text-indigo-400 ml-1">({stats.avail}/{stats.total})</span>
                        <span className="ml-1 text-indigo-300">{(stats.avail * stats.sqft).toFixed(1)} SqFt</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Kadapa Slab Dashboard ── */}
      {kadapaStats.totalSlabs > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-[40px] p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-black text-slate-800 uppercase tracking-tight text-sm flex items-center gap-2">
                <span className="w-7 h-7 bg-amber-500 rounded-xl flex items-center justify-center text-white text-xs">K</span>
                Kadapa Stone Registry
              </h3>
              <p className="text-[9px] font-bold text-amber-500 uppercase mt-0.5">Live slab stock · size-wise · sqft-wise</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black text-amber-700">{kadapaStats.availSlabs}<span className="text-sm text-amber-400">/{kadapaStats.totalSlabs}</span></div>
              <div className="text-[9px] font-bold text-amber-400">slabs available</div>
              <div className="text-[9px] font-bold text-amber-600">{kadapaStats.availSqft.toFixed(1)} SqFt available</div>
            </div>
          </div>

          {/* By finish type */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(kadapaStats.byFinish).map(([finish, stats]: [string, any]) => (
              <div key={finish} className="bg-white rounded-2xl p-4 border border-amber-100 shadow-sm">
                <div className="text-[8px] font-black text-amber-500 uppercase mb-2 truncate">{finish}</div>
                <div className="text-2xl font-black text-slate-800">
                  {stats.avail}<span className="text-sm text-slate-300">/{stats.total}</span>
                </div>
                <div className="text-[9px] font-bold text-emerald-600 mt-1">{stats.availSqft.toFixed(1)} SqFt avail</div>
                <div className="text-[8px] text-slate-400">{stats.totalSqft.toFixed(1)} SqFt total</div>
                {stats.total > stats.avail && (
                  <div className="text-[8px] text-rose-400 font-bold mt-1">{stats.total - stats.avail} sold</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-400">Booking Velocity (7D)</h3>
            <span className="text-[9px] font-black bg-blue-50 text-blue-600 px-3 py-1 rounded-full uppercase">Volume Trend</span>
          </div>
          <div className="h-64" style={{minHeight:256}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: '900', fill: '#94a3b8'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: '900', fill: '#94a3b8'}} />
                <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', padding: '15px'}} />
                <Bar dataKey="sales" fill="#2563eb" radius={[10, 10, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-black text-[11px] uppercase tracking-[0.2em] text-slate-400">Commission & Performance</h3>
            <span className="text-[9px] font-black bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full uppercase">Profitability Matrix</span>
          </div>
          <div className="h-64" style={{minHeight:256}}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: '900', fill: '#94a3b8'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: '900', fill: '#94a3b8'}} />
                <Tooltip contentStyle={{borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', padding: '15px'}} />
                <Line type="monotone" dataKey="sales" stroke="#10b981" strokeWidth={5} dot={{r: 6, fill: '#10b981', strokeWidth: 3, stroke: '#fff'}} activeDot={{r: 8, strokeWidth: 0}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h3 className="font-black text-[11px] uppercase tracking-widest text-slate-400 italic">Live Invoicing Activity</h3>
            <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">Direct from POS Ledger</p>
          </div>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-white text-slate-400 uppercase tracking-widest text-[9px] font-black border-b">
            <tr>
              <th className="px-8 py-5">Invoice Trace</th>
              <th className="px-8 py-5">Customer Profile</th>
              <th className="px-8 py-5">Settlement Mode</th>
              <th className="px-8 py-5 text-right">Invoiced Value</th>
              <th className="px-8 py-5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
             {store.sales.length === 0 ? (
               <tr><td colSpan={5} className="p-20 text-center italic text-slate-200 font-black text-2xl uppercase tracking-tighter">System Awaiting First Invoice</td></tr>
             ) : (
               store.sales.slice(0, 8).reverse().map(s => (
                 <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-6">
                       <div className="font-black text-blue-600 tracking-tight">{s.invoiceNo}</div>
                       <div className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">{s.date}</div>
                    </td>
                    <td className="px-8 py-6">
                       <div className="font-black text-slate-800 uppercase text-xs">{s.customerName}</div>
                       <div className="text-[10px] font-bold text-slate-400 tracking-tighter">{s.customerMobile || 'Direct Walk-in'}</div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${s.paymentType === 'Credit' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                        {s.paymentType} Node
                      </span>
                    </td>
                    <td className="px-8 py-6 font-black text-slate-900 italic text-right text-lg">₹{s.totalAmount.toLocaleString()}</td>
                    <td className="px-8 py-6 text-center">
                       <div className="w-2 h-2 rounded-full bg-blue-500 mx-auto group-hover:scale-150 transition-transform"></div>
                    </td>
                  </tr>
               ))
             )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Widget = ({ title, value, sub, icon, color, trend }: { title: string, value: string, sub: string, icon: string, color: string, trend?: string }) => (
  <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 flex flex-col justify-between group hover:shadow-2xl transition-all duration-500 relative overflow-hidden h-52">
    <div className="absolute -top-10 -right-10 w-32 h-32 bg-slate-50 rounded-full group-hover:scale-150 transition-transform duration-700 opacity-50"></div>
    <div className="flex justify-between items-start z-10">
      <div className={`${color} w-14 h-14 rounded-[20px] flex items-center justify-center text-white text-xl shadow-xl group-hover:rotate-6 transition-all`}>
        <i className={`fas ${icon}`}></i>
      </div>
      {trend && <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-3 py-1 rounded-full">{trend} <i className="fas fa-caret-up ml-1"></i></span>}
    </div>
    <div className="z-10 mt-4">
      <div className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{title}</div>
      <div className="text-3xl font-black italic tracking-tighter text-slate-900 leading-none">{value}</div>
      <div className="text-[9px] font-bold text-slate-400 uppercase mt-2 italic tracking-tight">{sub}</div>
    </div>
  </div>
);

export default Dashboard;
