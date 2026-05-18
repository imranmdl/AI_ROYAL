/**
 * DependentItemsManager.tsx
 *
 * Links dependent products to a parent product.
 * Use cases:
 *   - Adhesive bag dispatched with every box of tiles
 *   - Grout pouch dispatched with every box
 *   - Tools that go with a sanitary item
 *
 * On sale/dispatch:
 *   - If trackStock=true → stock is auto-deducted for the dependent item
 *   - If isOptional=true → shown as suggestion at POS but not mandatory
 *
 * At audit: shows which dependent items should have moved with each unit
 */

import React, { useState, useMemo } from 'react';
import { store } from '../store';
import type { DependentItem } from '../types';

interface Props {
  dependentItems: DependentItem[];
  parentUnit: string;  // e.g. 'Box', 'Piece' — for label
  onChange: (items: DependentItem[]) => void;
}

const DependentItemsManager: React.FC<Props> = ({ dependentItems, parentUnit, onChange }) => {
  const [search, setSearch] = useState('');

  const availableProducts = useMemo(() =>
    store.products.filter(p =>
      p.status === 'Active' &&
      (p.name.toLowerCase().includes(search.toLowerCase()) ||
       p.category.toLowerCase().includes(search.toLowerCase()))
    ).slice(0, 20),
    [store.products, search]
  );

  const addItem = (productId: string) => {
    const product = store.products.find(p => p.id === productId);
    if (!product) return;
    if (dependentItems.some(d => d.productId === productId)) return;
    const newItem: DependentItem = {
      id: `dep-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      productId,
      productName: product.name,
      qtyPerUnit: 1,
      unitLabel: `per ${parentUnit}`,
      isOptional: false,
      trackStock: true,
    };
    onChange([...dependentItems, newItem]);
    setSearch('');
  };

  const update = (id: string, field: keyof DependentItem, val: any) => {
    onChange(dependentItems.map(d => d.id === id ? { ...d, [field]: val } : d));
  };

  const remove = (id: string) => {
    onChange(dependentItems.filter(d => d.id !== id));
  };

  const inp = "w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-purple-400";
  const lbl = "text-[7px] font-black text-slate-400 uppercase tracking-widest block mb-1";

  return (
    <div className="bg-purple-50/60 border border-purple-100 rounded-[24px] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[9px] font-black text-purple-600 uppercase tracking-widest flex items-center gap-2">
            <i className="fas fa-link"></i> Dependent Items
          </div>
          <div className="text-[8px] text-purple-400 font-bold mt-0.5">
            Items dispatched / consumed with each {parentUnit} — tracked at stock and audit level
          </div>
        </div>
      </div>

      {/* Search and add */}
      <div className="relative">
        <input className="w-full px-3 py-2 bg-white border border-purple-200 rounded-xl font-bold text-sm outline-none"
          placeholder="Search product to link (e.g. Adhesive, Grout, Screw)..."
          value={search}
          onChange={e => setSearch(e.target.value)} />
        {search && availableProducts.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-50 bg-white border border-purple-100 rounded-2xl shadow-xl mt-1 max-h-52 overflow-y-auto">
            {availableProducts.map(p => (
              <button key={p.id} onClick={() => addItem(p.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-purple-50 transition-all text-left border-b border-slate-50 last:border-0">
                <div className="flex-1">
                  <div className="font-black text-slate-800 text-sm">{p.name}</div>
                  <div className="text-[9px] text-slate-400 font-bold">{p.category} · {p.unitType} · ₹{p.sellingPrice}</div>
                </div>
                <div className="text-[9px] font-black text-purple-500 bg-purple-50 px-2 py-1 rounded-lg">+ Link</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Linked items list */}
      {dependentItems.length === 0 ? (
        <div className="text-center py-6 text-purple-200 font-black text-xs uppercase border-2 border-dashed border-purple-100 rounded-2xl">
          No dependent items linked yet
        </div>
      ) : (
        <div className="space-y-2">
          {dependentItems.map(dep => {
            const product = store.products.find(p => p.id === dep.productId);
            return (
              <div key={dep.id} className="bg-white rounded-2xl border border-purple-100 p-3 space-y-2">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-purple-100 rounded-xl flex items-center justify-center">
                      <i className="fas fa-link text-[10px] text-purple-500"></i>
                    </div>
                    <div>
                      <div className="font-black text-slate-800 text-sm">{dep.productName}</div>
                      <div className="text-[8px] text-slate-400 font-bold">
                        {product?.category} · Stock: {product?.stockBoxes ?? '?'} {product?.unitType}
                        {product?.sellingPrice ? ` · ₹${product.sellingPrice}/${product.unitType}` : ''}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => remove(dep.id)}
                    className="w-7 h-7 flex items-center justify-center text-rose-400 hover:bg-rose-50 rounded-xl">
                    <i className="fas fa-unlink text-[10px]"></i>
                  </button>
                </div>

                {/* Config row */}
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className={lbl}>Qty per {parentUnit}</label>
                    <input type="number" step="0.1" className={inp}
                      value={dep.qtyPerUnit}
                      onChange={e => update(dep.id, 'qtyPerUnit', parseFloat(e.target.value || '0'))} />
                  </div>
                  <div>
                    <label className={lbl}>Unit label</label>
                    <input className={inp}
                      placeholder={`per ${parentUnit}`}
                      value={dep.unitLabel}
                      onChange={e => update(dep.id, 'unitLabel', e.target.value)} />
                  </div>
                  <div className="flex flex-col justify-end gap-1">
                    <label className={lbl}>Track stock</label>
                    <button onClick={() => update(dep.id, 'trackStock', !dep.trackStock)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl font-black text-[9px] uppercase transition-all ${dep.trackStock ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      <span className={`w-3 h-3 rounded-full ${dep.trackStock ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                      {dep.trackStock ? 'Auto-deduct' : 'Manual'}
                    </button>
                  </div>
                  <div className="flex flex-col justify-end gap-1">
                    <label className={lbl}>Required?</label>
                    <button onClick={() => update(dep.id, 'isOptional', !dep.isOptional)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl font-black text-[9px] uppercase transition-all ${!dep.isOptional ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                      <span className={`w-3 h-3 rounded-full ${!dep.isOptional ? 'bg-blue-500' : 'bg-slate-300'}`}></span>
                      {dep.isOptional ? 'Optional' : 'Required'}
                    </button>
                  </div>
                </div>

                {/* Summary line */}
                <div className={`text-[8px] font-bold rounded-xl px-3 py-1.5 ${dep.trackStock ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-500'}`}>
                  {dep.qtyPerUnit} {product?.unitType || 'unit'} of {dep.productName} {dep.unitLabel}
                  {dep.trackStock ? ' — stock auto-deducted on sale' : ' — stock not tracked'}
                  {dep.isOptional ? ' · Optional (suggested at POS)' : ' · Required'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* How it works */}
      {dependentItems.length > 0 && (
        <div className="bg-purple-50 border border-purple-100 rounded-2xl px-4 py-3 text-[8px] font-bold text-purple-600 space-y-1">
          <div className="font-black text-purple-700 text-[9px]">How this works:</div>
          <div>• At POS/Sales: dependent items shown alongside this product for dispatch confirmation</div>
          <div>• At Audit: expected vs actual dependent items tracked per unit sold</div>
          {dependentItems.some(d => d.trackStock) && (
            <div>• Auto-deduct: when this product is sold, linked items are deducted from inventory automatically</div>
          )}
        </div>
      )}
    </div>
  );
};

export default DependentItemsManager;
