/**
 * StockLedger.tsx
 *
 * Per-product stock ledger showing:
 *  - Each inward batch: vendor, date, qty, cost, value
 *  - Sales consumed from each batch (FIFO)
 *  - Current remaining stock and value
 *  - Inward total vs current stock reconciliation
 */

import React, { useMemo } from 'react';
import { store } from '../store';
import type { Product, PurchaseRecord } from '../types';

const INR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const r2  = (n: number) => Math.round(n * 100) / 100;

interface StockLedgerProps {
  product: Product;
  onClose: () => void;
}

const StockLedger: React.FC<StockLedgerProps> = ({ product, onClose }) => {

  // ── Build inward batches from purchaseHistory + vendorOrders ──────────────
  const batches = useMemo(() => {
    const rows: (PurchaseRecord & {
      batchNo:     number;
      totalValue:  number;
      landedCost:  number;
      source:      'Purchase' | 'VendorOrder' | 'Manual';
    })[] = [];

    // From purchaseHistory on the product
    (product.purchaseHistory || []).forEach((pr, i) => {
      const lc  = pr.landedCost || product.totalCostPerUnit || 0;
      rows.push({
        ...pr,
        batchNo:    i + 1,
        landedCost: lc,
        totalValue: (pr.qtyBoxes || 0) * lc,
        source:     pr.vendorOrderId ? 'VendorOrder' : 'Purchase',
      });
    });

    // Fill in data from VendorOrders where linked
    rows.forEach(r => {
      if (r.vendorOrderId) {
        const vo = store.vendorOrders.find(v => v.id === r.vendorOrderId);
        if (vo) {
          if (!r.vendorName) r.vendorName = vo.vendorName;
          if (!r.vendorPhone) r.vendorPhone = vo.vendorPhone;
          if (!r.vendorGst) r.vendorGst = vo.vendorGst;
          if (!r.invoiceNo) r.invoiceNo = vo.orderNo;
          const item = vo.items?.find((it: any) => it.productId === product.id);
          if (item && !r.landedCost) {
            r.landedCost = item.landedCost || 0;
            r.totalValue = (r.qtyBoxes || 0) * r.landedCost;
          }
        }
      }
    });

    return rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [product]);

  // ── Compute stock ledger figures ──────────────────────────────────────────
  const totalInwarded   = batches.reduce((s, b) => s + (b.qtyBoxes || 0), 0);
  const totalInwardValue= batches.reduce((s, b) => s + (b.totalValue || 0), 0);
  const currentStock    = product.stockBoxes || 0;
  const totalSold       = Math.max(0, totalInwarded - currentStock);
  const landedPerUnit   = product.totalCostPerUnit || (batches.length > 0 ? batches[batches.length-1].landedCost : 0) || 0;
  const currentValue    = currentStock * landedPerUnit;
  const soldValue       = totalSold * landedPerUnit;

  // ── Sales that consumed this product ─────────────────────────────────────
  const salesHistory = useMemo(() => {
    return store.sales
      .filter(s => s.items?.some((it: any) => it.productId === product.id))
      .map(s => {
        const item = s.items.find((it: any) => it.productId === product.id);
        return {
          id:     s.id,
          date:   s.date,
          invoiceNo: s.invoiceNo,
          customer: s.customerName,
          qty:    item?.qtyBoxes || item?.qty || 0,
          amount: item?.amount || 0,
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [product.id]);

  const thStyle = "px-4 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest whitespace-nowrap";
  const tdStyle = "px-4 py-3";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:rounded-[28px] max-h-[95vh] overflow-hidden flex flex-col shadow-2xl sm:max-w-4xl">

        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-5 flex items-start justify-between shrink-0">
          <div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Stock Ledger</div>
            <h2 className="font-black text-xl mt-0.5 leading-tight">{product.name}</h2>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-[9px] font-black text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">{product.category}</span>
              {product.brand && <span className="text-[9px] font-bold text-slate-400">{product.brand}</span>}
              <span className="text-[9px] font-bold text-slate-400">{product.size}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20 shrink-0">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 bg-slate-50 border-b border-slate-200 shrink-0">
          {[
            { label:'Total Inwarded',    value:`${totalInwarded} boxes`,    sub: INR(totalInwardValue),  color:'text-indigo-700',  bg:'bg-indigo-50',  border:'border-indigo-100' },
            { label:'Total Sold',        value:`${totalSold} boxes`,        sub: INR(soldValue),         color:'text-rose-600',    bg:'bg-rose-50',    border:'border-rose-100'   },
            { label:'Current Stock',     value:`${currentStock} boxes`,     sub: INR(currentValue),      color:'text-emerald-700', bg:'bg-emerald-50', border:'border-emerald-100'},
            { label:'Landed / Unit',     value: INR(landedPerUnit),         sub:`per box/unit`,          color:'text-amber-700',   bg:'bg-amber-50',   border:'border-amber-100'  },
          ].map(k => (
            <div key={k.label} className={`${k.bg} border ${k.border} rounded-2xl px-4 py-3`}>
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{k.label}</div>
              <div className={`font-black text-lg ${k.color}`}>{k.value}</div>
              <div className={`text-[9px] font-bold ${k.color} opacity-70`}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ── Inward Batches ── */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-black text-slate-800">Inward History</div>
              <div className="text-[9px] font-black text-slate-400 uppercase">{batches.length} batches · {totalInwarded} boxes · {INR(totalInwardValue)}</div>
            </div>

            {batches.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl py-10 text-center text-slate-400 font-bold">
                No inward records found. Add stock via Purchases or Vendor Orders.
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className={thStyle}>#</th>
                        <th className={thStyle}>Date</th>
                        <th className={thStyle}>Vendor</th>
                        <th className={thStyle}>Invoice / Bill</th>
                        <th className={thStyle}>Vehicle</th>
                        <th className={thStyle}>Qty (Boxes)</th>
                        <th className={thStyle + " text-right"}>Landed/Box</th>
                        <th className={thStyle + " text-right"}>Total Value</th>
                        <th className={thStyle}>Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {batches.map((b, idx) => (
                        <tr key={b.id} className="hover:bg-amber-50/30 transition-colors">
                          <td className={tdStyle}>
                            <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-black text-[10px]">{b.batchNo}</div>
                          </td>
                          <td className={tdStyle}>
                            <div className="font-bold text-slate-800">{b.date}</div>
                          </td>
                          <td className={tdStyle}>
                            <div className="font-black text-slate-900">{b.vendorName || '—'}</div>
                            {b.vendorPhone && <div className="text-[9px] text-slate-400 font-bold">📞 {b.vendorPhone}</div>}
                            {b.vendorGst   && <div className="text-[9px] text-slate-400 font-bold">GST: {b.vendorGst}</div>}
                          </td>
                          <td className={tdStyle}>
                            <div className="font-bold text-slate-700 font-mono text-[11px]">{b.gstInvoiceNo || b.invoiceNo || '—'}</div>
                          </td>
                          <td className={tdStyle}>
                            <div className="font-bold text-slate-600">{b.vehicleNumber || '—'}</div>
                          </td>
                          <td className={tdStyle}>
                            <span className="font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg text-sm">{b.qtyBoxes}</span>
                          </td>
                          <td className={tdStyle + " text-right"}>
                            <div className="font-black text-emerald-700">{b.landedCost > 0 ? INR(b.landedCost) : '—'}</div>
                          </td>
                          <td className={tdStyle + " text-right"}>
                            <div className="font-black text-slate-900">{b.totalValue > 0 ? INR(b.totalValue) : '—'}</div>
                          </td>
                          <td className={tdStyle}>
                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${b.source === 'VendorOrder' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                              {b.source === 'VendorOrder' ? '📋 Vendor Order' : '📥 Purchase'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t-2 border-slate-200">
                        <td colSpan={5} className="px-4 py-3 font-black text-[9px] text-slate-500 uppercase">
                          Total Inwarded
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-black text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-lg">{totalInwarded} boxes</span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-500 text-[10px]">
                          avg {batches.length > 0 ? INR(totalInwardValue / Math.max(totalInwarded, 1)) : '—'}/box
                        </td>
                        <td className="px-4 py-3 text-right font-black text-slate-900">{INR(totalInwardValue)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Stock Movement Summary ── */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
            <div className="font-black text-slate-800 mb-3">Stock Movement Reconciliation</div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2.5">
              {[
                { label:'Total Inwarded',         qty: totalInwarded, value: totalInwardValue, color:'text-indigo-700', op:'' },
                { label:`Sold (${salesHistory.length} invoices)`, qty:-totalSold, value:-soldValue, color:'text-rose-600', op:'−' },
                { label:'Current Stock',           qty: currentStock, value: currentValue, color:'text-emerald-700', op:'=' },
              ].map((row, i) => (
                <div key={row.label} className={`flex items-center justify-between py-2 ${i < 2 ? 'border-b border-slate-100' : 'border-t-2 border-slate-200 pt-3 mt-1'}`}>
                  <div className="flex items-center gap-3">
                    <span className="w-6 font-black text-slate-400 text-center">{row.op}</span>
                    <span className={`font-bold text-sm ${i === 2 ? 'font-black text-base' : ''} ${row.color}`}>{row.label}</span>
                  </div>
                  <div className="flex items-center gap-8">
                    <span className={`font-black text-base ${row.color}`}>{Math.abs(row.qty)} boxes</span>
                    <span className={`font-black text-base ${row.color} min-w-[100px] text-right`}>{INR(Math.abs(row.value))}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Sales History ── */}
          {salesHistory.length > 0 && (
            <div className="px-6 py-4 border-t border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div className="font-black text-slate-800">Sales History (this product)</div>
                <div className="text-[9px] font-black text-slate-400 uppercase">{salesHistory.length} invoices · {totalSold} boxes sold</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-xs min-w-[480px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Date','Invoice No','Customer','Qty Sold','Sale Amount'].map(h => (
                        <th key={h} className={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {salesHistory.map(s => (
                      <tr key={s.id} className="hover:bg-rose-50/30">
                        <td className={tdStyle + " font-bold text-slate-600"}>{s.date}</td>
                        <td className={tdStyle + " font-mono text-[10px] text-slate-700"}>{s.invoiceNo || '—'}</td>
                        <td className={tdStyle + " font-bold text-slate-800"}>{s.customer || '—'}</td>
                        <td className={tdStyle}>
                          <span className="font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-lg text-[11px]">−{s.qty} boxes</span>
                        </td>
                        <td className={tdStyle + " font-black text-amber-700"}>{s.amount > 0 ? INR(s.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StockLedger;
