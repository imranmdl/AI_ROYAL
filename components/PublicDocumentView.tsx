
import React, { useMemo } from 'react';
import { store } from '../store';
import { Sale, Quotation } from '../types';

interface PublicDocumentViewProps {
  type: 'invoice' | 'quotation';
  id: string;
  onAdminAccess: () => void;
}

const PublicDocumentView: React.FC<PublicDocumentViewProps> = ({ type, id, onAdminAccess }) => {
  const document = useMemo(() => {
    if (type === 'invoice') {
      return store.sales.find(s => s.id === id);
    } else {
      return store.quotations.find(q => q.id === id);
    }
  }, [type, id, store.sales, store.quotations]);

  if (!document) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-10 text-center">
        <div className="w-20 h-20 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center text-3xl mb-6 shadow-inner">
          <i className="fas fa-exclamation-triangle"></i>
        </div>
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Document Not Found</h2>
        <p className="text-slate-500 font-medium mt-2 max-w-xs">The requested {type} could not be located on our cloud node. It may have been archived or deleted.</p>
        <button onClick={onAdminAccess} className="mt-8 bg-slate-900 text-white px-8 py-3 rounded-2xl font-black text-sm uppercase tracking-widest hover:scale-105 transition-all">Admin Access</button>
      </div>
    );
  }

  const isInvoice = type === 'invoice';
  const doc = document as any;

  return (
    <div className="bg-slate-100 min-h-screen p-2 sm:p-4 md:p-10">
      <div className="max-w-4xl mx-auto bg-white shadow-2xl rounded-[30px] sm:rounded-[50px] overflow-hidden p-6 sm:p-10 md:p-16 space-y-12 border-t-8 border-amber-600 relative">
        <div className="absolute top-6 right-6 print:hidden">
           <button onClick={() => window.print()} className="bg-slate-900 text-white w-12 h-12 rounded-2xl flex items-center justify-center shadow-xl hover:scale-110 transition-all">
              <i className="fas fa-print"></i>
           </button>
        </div>

        <header className="flex flex-col md:flex-row justify-between items-start gap-8 border-b pb-12">
          <div className="space-y-3">
            <div className="bg-slate-900 text-white w-12 h-12 rounded-2xl flex items-center justify-center text-2xl font-black">R</div>
            <h2 className="text-3xl font-black tracking-tighter uppercase italic">{store.settings.showroomName}</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] max-w-xs">{store.settings.showroomAddress}</p>
            <div className="flex gap-4 pt-2">
              <div className="text-[10px] font-black uppercase text-slate-900">GST: {store.settings.showroomGst}</div>
              <div className="text-[10px] font-black uppercase text-slate-900">PH: {store.settings.showroomPhone}</div>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-xs font-black text-amber-600 uppercase tracking-widest">{isInvoice ? 'Tax Invoice' : 'Proforma Estimate'}</div>
            <div className="text-4xl font-black italic tracking-tighter text-slate-900">{isInvoice ? doc.invoiceNo : doc.quotationNo}</div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date: {doc.date}</div>
          </div>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-12 border-b pb-12">
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Consignee Profile</h4>
            <div>
              <div className="text-2xl font-black text-slate-900 uppercase italic leading-none">{doc.customerName}</div>
              <div className="text-xs font-bold text-slate-500 mt-2">+91 {doc.customerMobile}</div>
              <div className="text-[10px] font-medium text-slate-400 mt-1 uppercase">{doc.customerAddress}</div>
            </div>
          </div>
          <div className="text-right space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Document Status</h4>
            <div className="space-y-1">
              <div className="text-[10px] font-black text-slate-900 uppercase">{isInvoice ? 'Official Dispatch Node' : 'Valid for 7 Days'}</div>
              {isInvoice && <div className="text-[10px] font-black text-slate-900 uppercase">Status: {doc.balance <= 0 ? 'Full Paid' : 'Credit Dues'}</div>}
            </div>
          </div>
        </section>

        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b-2 border-slate-900">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest">Description</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-center">Volume</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-center">Rate</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {doc.items.map((it: any, idx: number) => (
              <tr key={idx}>
                <td className="px-6 py-6">
                  <div className="font-black text-slate-800 uppercase text-sm italic">{it.productName}</div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Area: {it.purpose || 'General'}</div>
                </td>
                <td className="px-6 py-6 text-center font-black text-slate-700 italic">
                  {it.qtyBoxes}{store.products.find(p => p.id === it.productId)?.unitType === 'Box' ? 'B' : store.products.find(p => p.id === it.productId)?.unitType === 'Bag' ? 'Bag' : store.products.find(p => p.id === it.productId)?.unitType || 'U'} {it.qtyPieces > 0 || it.qtyLoose > 0 ? `+ ${it.qtyPieces || it.qtyLoose}P` : ''}
                  <div className="text-[8px] font-bold text-slate-400 mt-1">({it.reqSqft || it.sqft} Sqft)</div>
                </td>
                <td className="px-6 py-6 text-center">
                  <div className="font-bold text-slate-800">₹{it.rate}</div>
                  <div className="text-[8px] font-black text-slate-400 uppercase">Per {it.priceBasis}</div>
                  <div className="text-[7px] font-black text-amber-600 uppercase mt-1 italic">₹{(it.amount / (it.reqSqft || it.sqft || 1)).toFixed(2)} / Sqft</div>
                </td>
                <td className="px-6 py-6 text-right font-black text-slate-900 text-base italic">₹{it.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col md:flex-row justify-between items-start gap-20">
          <div className="flex-1 space-y-6">
            <div className="bg-slate-50 p-8 rounded-3xl border border-slate-100 italic font-medium text-slate-500 text-xs leading-relaxed">
              <p className="font-black text-slate-400 uppercase text-[9px] mb-2 tracking-widest not-italic">Commercial Remarks</p>
              {doc.remarks || "Material once sold cannot be returned. Please verify shades and quality before fixing."}
            </div>
          </div>
          <div className="w-full md:w-80 space-y-4">
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400"><span>Gross Value</span><span>₹{doc.subTotal.toLocaleString()}</span></div>
            {doc.discountValue > 0 && (
              <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-emerald-600"><span>Promotional Off</span><span>- ₹{(doc.discountType === 'Fixed' ? doc.discountValue : (doc.subTotal * doc.discountValue) / 100).toLocaleString()}</span></div>
            )}
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400"><span>GST ({doc.gstPercent}%)</span><span>₹{doc.gstAmount.toLocaleString()}</span></div>
            <div className="bg-slate-900 text-white p-8 rounded-[40px] space-y-2 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 blur-3xl"></div>
              <div className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Aggregate Total</div>
              <div className="text-4xl font-black italic tracking-tighter">₹{doc.totalAmount.toLocaleString()}</div>
            </div>
            {isInvoice && (
              <div className="p-6 bg-slate-50 rounded-3xl border space-y-2">
                <div className="flex justify-between text-[10px] font-black uppercase text-slate-400"><span>Paid magnitude</span><span>₹{doc.amountPaid.toLocaleString()}</span></div>
                <div className="flex justify-between text-xs font-black uppercase text-rose-600"><span>Arrears</span><span>₹{doc.balance.toLocaleString()}</span></div>
              </div>
            )}
          </div>
        </div>
        
        <div className="text-center pt-10 border-t border-slate-100 print:hidden">
           <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em]">Cloud Document Node • {store.settings.showroomName}</p>
        </div>
      </div>
    </div>
  );
};

export default PublicDocumentView;
