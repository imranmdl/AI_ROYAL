
import React, { useState, useMemo, useRef } from 'react';
import { store } from '../store';
import { Expense, UserRole } from '../types';

const Expenses: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>(store.expenses);
  const [showAdd, setShowAdd] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMonth, setSearchMonth] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showGallery, setShowGallery] = useState<Expense | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initialForm = { title: '', category: 'Rent', amount: 0, date: new Date().toISOString().split('T')[0], remarks: '', images: [] as string[] };
  const [form, setForm] = useState(initialForm);

  const categories = ['Rent', 'Electricity', 'Staff Tea/Snacks', 'Logistics', 'Marketing', 'Maintenance', 'Others'];
  const isAdmin = store.currentUser?.role === UserRole.ADMIN;

  const filtered = useMemo(() => {
    return expenses.filter(e => {
      const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           e.category.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesMonth = searchMonth ? e.date.startsWith(searchMonth) : true;
      
      let matchesRange = true;
      if (startDate || endDate) {
        const d = new Date(e.date);
        if (startDate && d < new Date(startDate)) matchesRange = false;
        if (endDate && d > new Date(endDate)) matchesRange = false;
      }

      return matchesSearch && matchesMonth && matchesRange;
    });
  }, [expenses, searchQuery, searchMonth, startDate, endDate]);

  const handleSave = () => {
    if (!form.title || form.amount <= 0) return;
    
    if (editingExpense) {
      store.updateExpense(editingExpense.id, form);
    } else {
      store.addExpense(form);
    }
    
    setExpenses([...store.expenses]);
    setShowAdd(false);
    setEditingExpense(null);
    setForm(initialForm);
  };

  const handleDelete = (id: string) => {
    if (!isAdmin) return;
    if (confirm("Permanently delete this expense record?")) {
      store.deleteExpense(id);
      setExpenses([...store.expenses]);
    }
  };

  const handleEdit = (e: Expense) => {
    setEditingExpense(e);
    setForm({
      title: e.title,
      category: e.category,
      amount: e.amount,
      date: e.date,
      remarks: e.remarks || '',
      images: e.images || []
    });
    setShowAdd(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setForm(prev => ({
          ...prev,
          images: [...(prev.images || []), base64]
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (idx: number) => {
    setForm(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== idx) }));
  };

  return (
    <div className="space-y-6 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
           <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none italic">Operational Expenses</h1>
           <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest mt-2">Non-Inventory Costs • Proof Tracking • Financial Overheads</p>
        </div>
        <button onClick={() => { setEditingExpense(null); setForm(initialForm); setShowAdd(true); }} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all flex items-center gap-3">
          <i className="fas fa-plus"></i> Record New Expense
        </button>
      </header>

      <div className="bg-white p-6 rounded-[35px] shadow-sm border border-slate-100 flex flex-wrap items-center gap-6">
         <div className="flex-1 min-w-[200px] flex items-center gap-4 bg-slate-50 px-5 py-3 rounded-2xl border">
            <i className="fas fa-search text-slate-300"></i>
            <input 
               type="text" 
               placeholder="Search by Title..."
               className="flex-1 bg-transparent outline-none font-bold text-sm text-slate-600"
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
            />
         </div>
         
         <div className="flex items-center gap-3 bg-slate-50 px-5 py-3 rounded-2xl border">
            <span className="text-[10px] font-black text-slate-400 uppercase">Month</span>
            <input type="month" className="bg-transparent font-bold text-xs outline-none" value={searchMonth} onChange={e => setSearchMonth(e.target.value)} />
         </div>

         <div className="flex items-center gap-3 bg-slate-50 px-5 py-3 rounded-2xl border">
            <span className="text-[10px] font-black text-slate-400 uppercase">From</span>
            <input type="date" className="bg-transparent font-bold text-xs outline-none" value={startDate} onChange={e => setStartDate(e.target.value)} />
            <span className="text-slate-200">|</span>
            <span className="text-[10px] font-black text-slate-400 uppercase">To</span>
            <input type="date" className="bg-transparent font-bold text-xs outline-none" value={endDate} onChange={e => setEndDate(e.target.value)} />
         </div>

         {(searchQuery || searchMonth || startDate || endDate) && (
           <button 
             onClick={() => { setSearchQuery(''); setSearchMonth(''); setStartDate(''); setEndDate(''); }}
             className="text-[10px] font-black text-rose-500 uppercase hover:underline"
           >
             Reset Filters
           </button>
         )}
      </div>

      <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
         <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[10px] tracking-widest">
               <tr>
                  <th className="px-8 py-5">Expense Detail & Purpose</th>
                  <th className="px-8 py-5">Category</th>
                  <th className="px-8 py-5">Verification</th>
                  <th className="px-8 py-5">Date</th>
                  <th className="px-8 py-5 text-right">Amount</th>
                  <th className="px-8 py-5 text-center">Manage</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
               {filtered.length === 0 ? (
                 <tr><td colSpan={6} className="p-20 text-center text-slate-300 italic font-bold">No expenses matching your criteria.</td></tr>
               ) : (
                 filtered.map(e => (
                   <tr key={e.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-8 py-5">
                         <div className="font-black text-slate-900 uppercase text-xs">{e.title}</div>
                         <div className="text-[10px] text-slate-400 font-bold uppercase mt-1">{e.remarks || 'No extended remarks'}</div>
                      </td>
                      <td className="px-8 py-5">
                         <span className="bg-slate-100 px-3 py-1 rounded-lg text-[9px] font-black text-slate-600 uppercase tracking-widest border">{e.category}</span>
                      </td>
                      <td className="px-8 py-5">
                        {e.images && e.images.length > 0 ? (
                          <button onClick={() => setShowGallery(e)} className="flex items-center gap-2 text-blue-500 hover:text-blue-700 transition-colors">
                            <i className="fas fa-file-invoice text-sm"></i>
                            <span className="text-[9px] font-black uppercase underline tracking-widest">{e.images.length} Evidence(s)</span>
                          </button>
                        ) : (
                          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">No Proof Uploaded</span>
                        )}
                      </td>
                      <td className="px-8 py-5 font-bold text-slate-500 text-xs italic">{e.date}</td>
                      <td className="px-8 py-5 text-right font-black text-rose-600 text-lg italic">₹{e.amount.toLocaleString()}</td>
                      <td className="px-8 py-5 text-center">
                         <div className="flex justify-center gap-2">
                           <button onClick={() => handleEdit(e)} className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-900 border transition-all hover:shadow-md"><i className="fas fa-edit"></i></button>
                           {isAdmin && (
                             <button onClick={() => handleDelete(e.id)} className="w-10 h-10 rounded-xl bg-slate-50 text-rose-300 hover:text-rose-600 border transition-all hover:shadow-md"><i className="fas fa-trash"></i></button>
                           )}
                         </div>
                      </td>
                   </tr>
                 ))
               )}
            </tbody>
         </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[50px] shadow-2xl w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-200 border-t-8 border-slate-900 flex flex-col max-h-[90vh]">
              <div className="p-10 bg-slate-50 border-b flex justify-between items-center">
                 <div>
                    <h2 className="text-3xl font-black tracking-tighter uppercase italic leading-none">{editingExpense ? 'Modify Entry' : 'Record Expense'}</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Commercial overhead management</p>
                 </div>
                 <button onClick={() => setShowAdd(false)} className="w-12 h-12 rounded-full bg-white border shadow-sm text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i className="fas fa-times text-xl"></i></button>
              </div>
              <div className="p-10 space-y-8 overflow-y-auto scrollbar-hide flex-1">
                 <div className="space-y-6">
                    <div>
                       <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Commercial Title</label>
                       <input type="text" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black outline-none focus:border-slate-900 transition-all" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. Electricity Bill Jan" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Cost Category</label>
                          <select className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black outline-none appearance-none" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                             {categories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                       </div>
                       <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Transaction Date</label>
                          <input type="date" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black italic" value={form.date} onChange={e => setForm({...form, date: e.target.value})} />
                       </div>
                    </div>
                    <div>
                       <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Expense Magnitude (₹)</label>
                       <input type="number" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black text-3xl text-rose-600 outline-none focus:border-rose-500 transition-all" value={form.amount} onChange={e => setForm({...form, amount: parseFloat(e.target.value || '0')})} />
                    </div>
                    <div>
                       <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Internal Remarks</label>
                       <textarea className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-bold text-sm outline-none focus:border-slate-900 transition-all" rows={2} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} placeholder="Context of expenditure..."></textarea>
                    </div>

                    <div className="space-y-4">
                       <div className="flex justify-between items-center">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Evidence Gallery / Invoices</label>
                          <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-black text-amber-600 uppercase hover:underline"><i className="fas fa-cloud-upload-alt mr-1"></i> Add Proof</button>
                       </div>
                       <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleImageUpload} />
                       
                       <div className="grid grid-cols-4 gap-4">
                          {form.images?.map((img, idx) => (
                             <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border shadow-sm group">
                                <img src={img} className="w-full h-full object-cover" alt="" />
                                <button onClick={() => removeImage(idx)} className="absolute top-1 right-1 w-6 h-6 bg-rose-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><i className="fas fa-times text-[10px]"></i></button>
                             </div>
                          ))}
                          <button onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 hover:text-amber-500 hover:border-amber-500 transition-all">
                             <i className="fas fa-plus"></i>
                          </button>
                       </div>
                    </div>
                 </div>
                 <div className="flex gap-4 pt-6">
                    <button onClick={() => setShowAdd(false)} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-[30px] font-black uppercase text-[10px] tracking-widest hover:bg-slate-200">Discard</button>
                    <button onClick={handleSave} className="flex-[2] py-5 bg-slate-900 text-white rounded-[30px] font-black uppercase text-[11px] tracking-widest hover:bg-slate-800 shadow-2xl">{editingExpense ? 'Confirm Adjustments' : 'Commit Ledger Entry'}</button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {showGallery && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[300] flex items-center justify-center p-6" onClick={() => setShowGallery(null)}>
           <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8" onClick={e => e.stopPropagation()}>
              {showGallery.images?.map((img, idx) => (
                <div key={idx} className="aspect-[3/4] rounded-[40px] overflow-hidden shadow-2xl border-4 border-white/10 group bg-slate-900">
                  <img src={img} className="w-full h-full object-contain cursor-zoom-in transition-transform duration-700 hover:scale-110" alt="Proof" />
                  <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => {
                        const link = document.createElement('a');
                        link.href = img;
                        link.download = `expense_proof_${showGallery.id}_${idx}.png`;
                        link.click();
                    }} className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-slate-900 shadow-2xl hover:scale-110 transition-transform"><i className="fas fa-download"></i></button>
                  </div>
                </div>
              ))}
           </div>
           <button onClick={() => setShowGallery(null)} className="absolute top-10 right-10 text-white/40 hover:text-white transition-colors"><i className="fas fa-times text-4xl"></i></button>
           <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-md px-10 py-5 rounded-full border border-white/20 text-center">
              <div className="text-white font-black uppercase tracking-widest italic">{showGallery.title} Evidence Bundle</div>
              <div className="text-white/40 text-[10px] font-bold uppercase mt-1">{showGallery.date} • {showGallery.category}</div>
           </div>
        </div>
      )}
    </div>
  );
};

export default Expenses;
