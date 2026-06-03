/**
 * KadapaSettings.tsx
 * Admin panel to add / edit / delete Kadapa finish types and their rates per sqft.
 * Rendered inside SystemControl settings tab.
 */
import React, { useState } from 'react';
import { store } from '../store';
import type { KadapaItemType } from '../types';

const KadapaSettings: React.FC = () => {
  const [types, setTypes] = useState<KadapaItemType[]>(store.settings.kadapaItemTypes || [
    { id: 'ksp',  name: 'Single Polish',    ratePerSqft: 28 },
    { id: 'kdp',  name: 'Double Polish',    ratePerSqft: 35 },
    { id: 'kbsp', name: 'Big Single Polish', ratePerSqft: 45 },
    { id: 'kbdp', name: 'Big Double Polish', ratePerSqft: 55 },
  ]);
  const [newName, setNewName]   = useState('');
  const [newRate, setNewRate]   = useState<number>(0);
  const [editId, setEditId]     = useState<string | null>(null);
  const [saved, setSaved]       = useState(false);

  const save = (next: KadapaItemType[]) => {
    setTypes(next);
    store.updateSettings({ kadapaItemTypes: next } as any);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addType = () => {
    if (!newName.trim() || !newRate) return;
    const next = [...types, {
      id: `kt-${Date.now()}`,
      name: newName.trim(),
      ratePerSqft: newRate,
    }];
    save(next);
    setNewName(''); setNewRate(0);
  };

  const updateType = (id: string, field: 'name' | 'ratePerSqft', val: string | number) => {
    const next = types.map(t => t.id === id ? { ...t, [field]: val } : t);
    setTypes(next);
  };

  const commitEdit = () => {
    save(types);
    setEditId(null);
  };

  const removeType = (id: string) => {
    if (!confirm('Remove this finish type?')) return;
    save(types.filter(t => t.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-black text-slate-800 text-sm uppercase tracking-tight">Kadapa Finish Types & Rates</h4>
          <p className="text-[9px] text-slate-400 font-bold mt-0.5">Rates per SqFt — used to auto-calculate landed cost when adding slabs</p>
        </div>
        {saved && <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">✓ Saved</span>}
      </div>

      {/* Existing types */}
      <div className="space-y-2">
        {types.map(t => (
          <div key={t.id} className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3 border border-slate-100">
            {editId === t.id ? (
              <>
                <input className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none"
                  value={t.name} onChange={e => updateType(t.id, 'name', e.target.value)} />
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 font-bold text-sm">₹</span>
                  <input type="number" className="w-20 px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none"
                    value={t.ratePerSqft} onChange={e => updateType(t.id, 'ratePerSqft', parseFloat(e.target.value || '0'))} />
                  <span className="text-slate-400 font-bold text-xs">/SqFt</span>
                </div>
                <button onClick={commitEdit} className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700">Save</button>
                <button onClick={() => setEditId(null)} className="px-3 py-1.5 bg-slate-200 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-300">Cancel</button>
              </>
            ) : (
              <>
                <div className="flex-1">
                  <div className="font-black text-slate-800 text-sm">{t.name}</div>
                </div>
                <div className="font-black text-amber-700 text-base">₹{t.ratePerSqft}<span className="text-[9px] text-amber-400 font-bold">/SqFt</span></div>
                <button onClick={() => setEditId(t.id)} className="w-8 h-8 flex items-center justify-center text-blue-400 hover:bg-blue-50 rounded-xl">
                  <i className="fas fa-pencil-alt text-xs"></i>
                </button>
                <button onClick={() => removeType(t.id)} className="w-8 h-8 flex items-center justify-center text-rose-400 hover:bg-rose-50 rounded-xl">
                  <i className="fas fa-trash-alt text-xs"></i>
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Add new type */}
      <div className="flex items-end gap-3 bg-amber-50 rounded-2xl px-4 py-3 border border-amber-100">
        <div className="flex-1">
          <label className="text-[8px] font-black text-amber-500 uppercase block mb-1">New Finish Name</label>
          <input className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl font-bold text-sm outline-none"
            placeholder="e.g. Extra Polish" value={newName} onChange={e => setNewName(e.target.value)} />
        </div>
        <div>
          <label className="text-[8px] font-black text-amber-500 uppercase block mb-1">Rate / SqFt (₹)</label>
          <input type="number" className="w-28 px-3 py-2 bg-white border border-amber-200 rounded-xl font-bold text-sm outline-none"
            placeholder="0" value={newRate || ''} onChange={e => setNewRate(parseFloat(e.target.value || '0'))} />
        </div>
        <button onClick={addType} disabled={!newName || !newRate}
          className="px-5 py-2 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-700 disabled:opacity-40">
          + Add
        </button>
      </div>
    </div>
  );
};

export default KadapaSettings;
