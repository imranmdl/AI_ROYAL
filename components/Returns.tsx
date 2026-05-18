
import React, { useState, useMemo } from 'react';
import { store } from '../store';
import { Sale, Return, ReturnItem, Product } from '../types';

const Returns: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showReturnModal, setShowReturnModal] = useState<Sale | null>(null);
  const [returnItems, setReturnItems] = useState<{ productId: string, boxes: number, loose: number }[]>([]);
  const [refundMode, setRefundMode] = useState<'Cash' | 'UPI' | 'Bank Transfer' | 'Store Credit'>('Cash');
  const [returnRemarks, setReturnRemarks] = useState('');

  const allReturns = useMemo(() => {
    return [...store.returns].sort((a, b) => b.id.localeCompare(a.id));
  }, [store.returns]);

  const stats = useMemo(() => {
    const totalRefunds = allReturns.reduce((sum, r) => sum + r.totalRefundAmount, 0);
    const count = allReturns.length;
    let itemsRecovered = 0;
    allReturns.forEach(r => {
      r.items.forEach(it => {
        const prod = store.products.find(p => p.id === it.productId);
        if (prod) itemsRecovered += (it.qtyBoxes + (it.qtyLoose / (prod.tilesPerBox || 1)));
      });
    });
    return { totalRefunds, count, itemsRecovered };
  }, [allReturns]);

  const filteredSales = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return store.sales.filter(s => 
      s.invoiceNo.toLowerCase().includes(q) || 
      s.customerName.toLowerCase().includes(q)
    ).slice(0, 5);
  }, [searchQuery, store.sales]);

  const handleOpenReturn = (sale: Sale) => {
    setShowReturnModal(sale);
    setReturnItems(sale.items.map(it => ({ productId: it.productId, boxes: 0, loose: 0 })));
    setReturnRemarks('');
    setSearchQuery('');
  };

  const updateReturnQty = (productId: string, type: 'boxes' | 'loose', val: number) => {
    setReturnItems(prev => prev.map(ri => {
      if (ri.productId === productId) {
        const originalItem = showReturnModal?.items.find(it => it.productId === productId);
        if (!originalItem) return ri;
        
        let nextVal = val;
        if (type === 'boxes') nextVal = Math.min(val, originalItem.qtyBoxes);
        else if (type === 'loose') nextVal = Math.min(val, originalItem.qtyLoose);
        
        return { ...ri, [type]: nextVal };
      }
      return ri;
    }));
  };

  const calculateRefundAmount = () => {
    if (!showReturnModal) return 0;
    let refund = 0;
    returnItems.forEach(ri => {
      const item = showReturnModal.items.find(si => si.productId === ri.productId);
      const prod = store.products.find(p => p.id === ri.productId);
      if (item && prod) {
        const tilesPerBox = prod.tilesPerBox || 1;
        const boxesFraction = ri.boxes + (ri.loose / tilesPerBox);
        refund += boxesFraction * item.rate;
      }
    });
    return refund;
  };

  const handleProcessReturn = () => {
    if (!showReturnModal) return;
    const finalRefund = calculateRefundAmount();
    if (finalRefund <= 0) {
      alert("Please select items to return.");
      return;
    }

    const itemsToReturn: ReturnItem[] = returnItems.filter(ri => ri.boxes > 0 || ri.loose > 0).map(ri => {
      const si = showReturnModal.items.find(it => it.productId === ri.productId)!;
      return {
        productId: ri.productId,
        productName: si.productName,
        qtyBoxes: ri.boxes,
        qtyLoose: ri.loose,
        refundAmount: (ri.boxes + (ri.loose / (store.products.find(p => p.id === ri.productId)?.tilesPerBox || 1))) * si.rate
      };
    });

    const returnData: Return = {
      id: Date.now().toString(),
      saleId: showReturnModal.id,
      invoiceNo: showReturnModal.invoiceNo,
      date: new Date().toLocaleDateString(),
      customerName: showReturnModal.customerName,
      items: itemsToReturn,
      totalRefundAmount: finalRefund,
      refundMode,
      remarks: returnRemarks,
      processedBy: store.currentUser?.name || 'System'
    };

    store.addReturn(returnData);
    setShowReturnModal(null);
    alert(`Return of ₹${finalRefund.toLocaleString()} processed successfully. Inventory adjusted.`);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 px-2 sm:px-0">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="w-full">
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter uppercase leading-none italic">Returns & Refunds</h1>
          <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest mt-2">Material Re-instatement • Asset Recovery</p>
        </div>
        <div className="relative w-full md:w-96 group">
           <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-amber-500 transition-colors"></i>
           <input 
              type="text" 
              placeholder="Search Invoice No..." 
              className="w-full pl-12 pr-6 py-4 bg-white border-2 border-slate-100 rounded-2xl font-bold shadow-sm outline-none focus:border-amber-500 transition-all text-sm"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
           />
           {filteredSales.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border rounded-2xl shadow-2xl z-50 overflow-hidden divide-y animate-in slide-in-from-top-2">
                 {filteredSales.map(s => (
                    <button key={s.id} onClick={() => handleOpenReturn(s)} className="w-full p-5 text-left hover:bg-amber-50 flex justify-between items-center transition-colors">
                       <div className="pr-4">
                          <div className="font-black text-slate-900 text-sm">{s.invoiceNo}</div>
                          <div className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[150px] sm:max-w-none">{s.customerName}</div>
                       </div>
                       <div className="text-right whitespace-nowrap">
                          <div className="font-black text-slate-600 text-xs sm:text-sm">₹{s.totalAmount.toLocaleString()}</div>
                          <div className="text-[8px] sm:text-[9px] font-black text-amber-600 uppercase">Process</div>
                       </div>
                    </button>
                 ))}
              </div>
           )}
        </div>
      </header>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
         <div className="bg-slate-900 p-6 sm:p-8 rounded-[30px] sm:rounded-[40px] text-white shadow-2xl relative overflow-hidden flex flex-col justify-between h-40 sm:h-48">
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-[50px]"></div>
            <div>
               <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Refunds</h3>
               <div className="text-3xl sm:text-4xl font-black italic tracking-tighter mt-1 text-amber-500">₹{stats.totalRefunds.toLocaleString()}</div>
            </div>
            <div className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase">Settled across nodes</div>
         </div>
         <div className="bg-white p-6 sm:p-8 rounded-[30px] sm:rounded-[40px] border border-slate-100 shadow-sm flex flex-col justify-between h-40 sm:h-48">
            <div>
               <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Return Count</h3>
               <div className="text-3xl sm:text-4xl font-black italic tracking-tighter mt-1 text-slate-900">{stats.count} Events</div>
            </div>
            <div className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase">Verified return entries</div>
         </div>
         <div className="bg-emerald-50 p-6 sm:p-8 rounded-[30px] sm:rounded-[40px] border border-emerald-100 shadow-sm flex flex-col justify-between h-40 sm:h-48">
            <div>
               <h3 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Recovered</h3>
               <div className="text-3xl sm:text-4xl font-black italic tracking-tighter mt-1 text-emerald-700">{stats.itemsRecovered.toFixed(1)} Units</div>
            </div>
            <div className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-widest italic">Asset Re-instatement</div>
         </div>
      </div>

      {/* Returns Ledger */}
      <div className="bg-white rounded-[30px] sm:rounded-[40px] shadow-sm border border-slate-100 overflow-hidden min-h-[500px]">
         <div className="p-6 sm:p-8 border-b bg-slate-50/50 flex justify-between items-center">
            <h3 className="text-[10px] sm:text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Return Ledger</h3>
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
         </div>
         
         {/* Mobile Ledger View (Cards) */}
         <div className="block md:hidden divide-y divide-slate-100">
            {allReturns.length === 0 ? (
               <div className="p-20 text-center text-slate-200 font-black uppercase">No records</div>
            ) : (
              allReturns.map(r => (
                <div key={r.id} className="p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-black text-slate-900 text-xs">{r.date}</div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">By: {r.processedBy}</div>
                    </div>
                    <span className="bg-slate-100 px-3 py-1 rounded-xl text-[8px] font-black text-slate-600 uppercase tracking-widest border border-slate-200">{r.refundMode}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="font-black text-blue-600 text-sm">{r.invoiceNo}</div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest italic">{r.customerName}</div>
                  </div>
                  <div className="space-y-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                     {r.items.map((it, idx) => (
                        <div key={idx} className="text-[9px] font-black text-slate-600 uppercase truncate">
                           • {it.productName} ({it.qtyBoxes}B + {it.qtyLoose}P)
                        </div>
                     ))}
                  </div>
                  <div className="text-right pt-2">
                     <div className="font-black text-rose-600 italic text-xl">₹{r.totalRefundAmount.toLocaleString()}</div>
                  </div>
                </div>
              ))
            )}
         </div>

         {/* Desktop Table View */}
         <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left">
               <thead className="bg-slate-50 text-slate-400 uppercase tracking-widest text-[9px] font-black">
                  <tr>
                     <th className="px-8 py-5">Return Date / Trace</th>
                     <th className="px-8 py-5">Original Context</th>
                     <th className="px-8 py-5">Items Returned</th>
                     <th className="px-8 py-5">Refund Mode</th>
                     <th className="px-8 py-5 text-right">Refund Value</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {allReturns.length === 0 ? (
                    <tr><td colSpan={5} className="p-40 text-center italic text-slate-200 font-black text-3xl uppercase tracking-tighter">No Returns Logged</td></tr>
                  ) : (
                    allReturns.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                         <td className="px-8 py-6">
                            <div className="font-black text-slate-900 text-xs">{r.date}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">By: {r.processedBy}</div>
                         </td>
                         <td className="px-8 py-6">
                            <div className="font-black text-blue-600 text-xs">{r.invoiceNo}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">{r.customerName}</div>
                         </td>
                         <td className="px-8 py-6">
                            <div className="space-y-1">
                               {r.items.map((it, idx) => (
                                  <div key={idx} className="text-[10px] font-black text-slate-600 uppercase">
                                     • {it.productName} ({it.qtyBoxes}B + {it.qtyLoose}P)
                                  </div>
                               ))}
                            </div>
                         </td>
                         <td className="px-8 py-6">
                            <span className="bg-slate-100 px-3 py-1 rounded-xl text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-200">{r.refundMode}</span>
                         </td>
                         <td className="px-8 py-6 text-right font-black text-rose-600 italic">₹{r.totalRefundAmount.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
               </tbody>
            </table>
         </div>
      </div>

      {/* Return Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-2 sm:p-4">
           <div className="bg-white rounded-[30px] sm:rounded-[50px] shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 border-t-8 border-amber-600 flex flex-col max-h-[95vh]">
              <div className="p-6 sm:p-8 border-b flex justify-between items-center bg-slate-50">
                 <div>
                    <h2 className="text-xl sm:text-2xl font-black tracking-tighter uppercase leading-none text-slate-900">Return Terminal</h2>
                    <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Adjusting Stock for {showReturnModal.invoiceNo}</p>
                 </div>
                 <button onClick={() => setShowReturnModal(null)} className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border shadow-sm text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i className="fas fa-times text-lg"></i></button>
              </div>
              <div className="p-6 sm:p-8 space-y-6 sm:space-y-8 overflow-y-auto scrollbar-hide flex-1">
                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Items to Re-Instate</h4>
                    <div className="space-y-4">
                       {showReturnModal.items.map(si => {
                          const ri = returnItems.find(item => item.productId === si.productId);
                          return (
                             <div key={si.productId} className="bg-slate-50 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                <div className="flex-1">
                                   <div className="font-black text-slate-800 uppercase text-xs sm:text-sm">{si.productName}</div>
                                   <div className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-widest">Sold: {si.qtyBoxes}B + {si.qtyLoose}P</div>
                                </div>
                                <div className="flex gap-4 items-end w-full sm:w-auto">
                                   <div className="flex-1 sm:w-24">
                                      <label className="text-[8px] sm:text-[9px] font-black text-slate-400 uppercase block mb-1 text-center">Boxes</label>
                                      <input 
                                         type="number" 
                                         className="w-full px-3 py-2 bg-white border rounded-xl font-black text-center shadow-inner text-sm"
                                         value={ri?.boxes || 0}
                                         onChange={e => updateReturnQty(si.productId, 'boxes', parseInt(e.target.value || '0'))}
                                      />
                                   </div>
                                   <div className="flex-1 sm:w-24">
                                      <label className="text-[8px] sm:text-[9px] font-black text-slate-400 uppercase block mb-1 text-center">Loose</label>
                                      <input 
                                         type="number" 
                                         className="w-full px-3 py-2 bg-white border rounded-xl font-black text-center shadow-inner text-sm"
                                         value={ri?.loose || 0}
                                         onChange={e => updateReturnQty(si.productId, 'loose', parseInt(e.target.value || '0'))}
                                      />
                                   </div>
                                </div>
                             </div>
                          );
                       })}
                    </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t">
                    <div className="space-y-4">
                       <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1 tracking-widest">Refund Method</label>
                          <select 
                             className="w-full px-5 py-4 bg-slate-50 border rounded-2xl font-black outline-none appearance-none text-sm"
                             value={refundMode}
                             onChange={e => setRefundMode(e.target.value as any)}
                          >
                             <option value="Cash">Cash Handover</option>
                             <option value="UPI">Digital (UPI)</option>
                             <option value="Bank Transfer">Bank RTGS/NEFT</option>
                             <option value="Store Credit">Against Next Bill</option>
                          </select>
                       </div>
                       <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1 tracking-widest">Internal Remarks</label>
                          <textarea 
                             className="w-full px-5 py-4 bg-slate-50 border rounded-2xl font-bold text-xs outline-none focus:border-amber-500 h-24"
                             placeholder="Reason..."
                             value={returnRemarks}
                             onChange={e => setReturnRemarks(e.target.value)}
                          />
                       </div>
                    </div>

                    <div className="bg-slate-900 p-6 sm:p-8 rounded-[30px] sm:rounded-[40px] text-white shadow-2xl relative overflow-hidden flex flex-col justify-center">
                       <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-[50px] pointer-events-none"></div>
                       <div className="text-center space-y-2">
                          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Refund Magnitude</h4>
                          <div className="text-3xl sm:text-5xl font-black italic tracking-tighter text-amber-500 leading-none">₹{calculateRefundAmount().toLocaleString()}</div>
                          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest italic mt-4">Inventory will be adjusted</p>
                       </div>
                    </div>
                 </div>

                 <button 
                    onClick={handleProcessReturn}
                    className="w-full py-5 sm:py-6 bg-amber-600 text-white rounded-3xl font-black text-lg uppercase tracking-widest hover:bg-amber-700 transition-all shadow-2xl active:scale-95 mb-4"
                 >
                    Finalize Return
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default Returns;
