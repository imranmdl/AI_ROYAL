import React, { useState, useEffect } from 'react';
import { store } from '../store';
import { LoadingChargeRule } from '../types';

const LoadingChargeManager: React.FC = () => {
  const [rules, setRules] = useState<LoadingChargeRule[]>(store.loadingCharges);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<Omit<LoadingChargeRule, 'id'>>({
    productType: '',
    unitType: 'sqft',
    rate: 0,
    perUnit: 1,
    isActive: true
  });

  const [categories, setCategories] = useState<string[]>(store.settings.categories || []);
  const productNames = Array.from(new Set(store.products.map(p => p.name))).filter(Boolean);
  const allOptions = Array.from(new Set([...categories, ...productNames])).sort();

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setRules([...store.loadingCharges]);
      setCategories([...(store.settings.categories || [])]);
    });
    return unsub;
  }, []);

  const handleSave = () => {
    if (!formData.productType) {
      alert('Please select or enter a product type/category');
      return;
    }
    if (editingId) {
      store.updateLoadingChargeRule(editingId, formData);
    } else {
      store.addLoadingChargeRule(formData);
    }
    setIsAdding(false);
    setEditingId(null);
    setFormData({
      productType: '',
      unitType: 'sqft',
      rate: 0,
      perUnit: 1,
      isActive: true
    });
  };

  const handleEdit = (rule: LoadingChargeRule) => {
    setFormData({
      productType: rule.productType,
      unitType: rule.unitType,
      rate: rule.rate,
      perUnit: rule.perUnit,
      isActive: rule.isActive
    });
    setEditingId(rule.id);
    setIsAdding(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this loading charge rule?')) {
      store.deleteLoadingChargeRule(id);
    }
  };

  return (
    <div className="bg-white p-10 rounded-[50px] shadow-sm border border-slate-100 space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
            <i className="fas fa-truck-loading text-amber-500"></i> Loading Charge Rules
          </h3>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Configure automated loading charges for Quotations and Invoices</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg flex items-center gap-2"
        >
          <i className="fas fa-plus"></i> Add Rule
        </button>
      </div>

      {isAdding && (
        <div className="p-8 bg-slate-50 rounded-[30px] border-2 border-amber-100 space-y-6 animate-in zoom-in-95 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-1">
              <label className="text-[8px] font-black text-slate-400 uppercase ml-4">Product Type / Category</label>
              <select 
                className="w-full px-6 py-4 bg-white border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all"
                value={formData.productType}
                onChange={e => {
                  const val = e.target.value;
                  let unit: LoadingChargeRule['unitType'] = formData.unitType;
                  
                  // Auto-suggest unit type based on category
                  if (val.toLowerCase().includes('granite') || val.toLowerCase().includes('marble') || val.toLowerCase().includes('kadapa')) {
                    unit = 'sqft';
                  } else if (val.toLowerCase().includes('tile')) {
                    unit = 'box';
                  }
                  
                  setFormData({...formData, productType: val, unitType: unit});
                }}
              >
                <option value="">Select Category/Product...</option>
                <optgroup label="Categories">
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </optgroup>
                <optgroup label="Specific Products">
                  {productNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-slate-400 uppercase ml-4">Unit Type</label>
              <select 
                className="w-full px-6 py-4 bg-white border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all"
                value={formData.unitType}
                onChange={e => setFormData({...formData, unitType: e.target.value as any})}
              >
                <option value="sqft">Sqft</option>
                <option value="box">Box</option>
                <option value="piece">Piece</option>
                <option value="unit">Unit</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-slate-400 uppercase ml-4">Rate (₹)</label>
              <input 
                type="number" 
                className="w-full px-6 py-4 bg-white border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all"
                value={formData.rate}
                onChange={e => setFormData({...formData, rate: parseFloat(e.target.value) || 0})}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-black text-slate-400 uppercase ml-4">Per Unit Quantity</label>
              <input 
                type="number" 
                className="w-full px-6 py-4 bg-white border-2 rounded-2xl font-black focus:border-slate-900 outline-none transition-all"
                value={formData.perUnit}
                onChange={e => setFormData({...formData, perUnit: parseInt(e.target.value) || 1})}
              />
            </div>
          </div>
          <div className="flex justify-end gap-4">
            <button 
              onClick={() => { setIsAdding(false); setEditingId(null); }}
              className="px-8 py-4 bg-white border-2 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              className="px-8 py-4 bg-amber-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-400 transition-all shadow-lg"
            >
              {editingId ? 'Update Rule' : 'Save Rule'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-3">
          <thead>
            <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <th className="px-6 py-4">Product Type</th>
              <th className="px-6 py-4">Unit Type</th>
              <th className="px-6 py-4">Rate</th>
              <th className="px-6 py-4">Basis</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-20 text-center text-slate-300 font-black uppercase italic border-2 border-dashed border-slate-100 rounded-[30px]">No loading charge rules configured</td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="bg-slate-50 hover:bg-slate-100 transition-all group rounded-2xl overflow-hidden">
                  <td className="px-6 py-5 first:rounded-l-2xl">
                    <div className="text-sm font-black text-slate-900 uppercase">{rule.productType}</div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{rule.unitType}</div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="text-sm font-black text-slate-900">₹{rule.rate}</div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Per {rule.perUnit} {rule.unitType}</div>
                  </td>
                  <td className="px-6 py-5">
                    <button 
                      onClick={() => store.updateLoadingChargeRule(rule.id, { isActive: !rule.isActive })}
                      className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${rule.isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}
                    >
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-6 py-5 last:rounded-r-2xl text-right space-x-2">
                    <button 
                      onClick={() => handleEdit(rule)}
                      className="w-8 h-8 rounded-lg bg-white text-slate-400 hover:text-amber-500 transition-colors shadow-sm"
                    >
                      <i className="fas fa-edit"></i>
                    </button>
                    <button 
                      onClick={() => handleDelete(rule.id)}
                      className="w-8 h-8 rounded-lg bg-white text-slate-400 hover:text-rose-500 transition-colors shadow-sm"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
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

export default LoadingChargeManager;
