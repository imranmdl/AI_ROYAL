/**
 * KadapaInventoryGenerator.tsx
 *
 * Auto-generates all Kadapa size × finish combinations as individual
 * inventory products. Naming convention:
 *
 *   Height < 5 ft:
 *     SP_KDP_2x1     (Single Polish, 2ft height, 1ft width)
 *     DP_KDP_2x1     (Double Polish)
 *
 *   Height >= 5 ft:
 *     DSP_KDP_5x2    (Big Single Polish = Double Single Polish)
 *     DDP_KDP_6x2.5  (Big Double Polish = Double Double Polish)
 *
 * Features:
 *   - Full 11×6 matrix (all standard combinations) auto-generated
 *   - Duplicate prevention — skips already-existing products
 *   - Per-item: enter selling price + stock qty
 *   - Custom size: add non-standard H×W combinations
 *   - Bulk create or create individual
 *   - Production-ready, scalable
 */

import React, { useState, useMemo, useCallback } from 'react';
import { store } from '../store';
import type { Product } from '../types';

// ── Size matrix ───────────────────────────────────────────────────────────────
const HEIGHTS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];
const WIDTHS: { inches: number; ft: number; label: string }[] = [
  { inches: 9,  ft: 1,    label: '9 in\n(1 Ft)' },
  { inches: 11, ft: 1,    label: '11 in\n(1 Ft)' },
  { inches: 14, ft: 1.25, label: '14 in\n(1.25 Ft)' },
  { inches: 17, ft: 1.5,  label: '17 in\n(1.5 Ft)' },
  { inches: 23, ft: 2,    label: '23 in\n(2 Ft)' },
  { inches: 29, ft: 2.5,  label: '29 in\n(2.5 Ft)' },
];

const sqftFor = (h: number, wIdx: number): number =>
  Math.round(h * WIDTHS[wIdx].ft * 100) / 100;

// ── Finish types ──────────────────────────────────────────────────────────────
interface FinishDef {
  id:          string;
  name:        string;
  prefix:      string;   // SP, DP, DSP, DDP
  bigPrefix:   string;   // used when height >= 5
  ratePerSqft: number;
}

const DEFAULT_FINISHES: FinishDef[] = [
  { id: 'sp',  name: 'Single Polish',     prefix: 'SP',  bigPrefix: 'DSP', ratePerSqft: 28 },
  { id: 'dp',  name: 'Double Polish',     prefix: 'DP',  bigPrefix: 'DDP', ratePerSqft: 35 },
];

/** Generate the product name per spec */
const buildName = (hFt: number, wFt: number, finish: FinishDef): string => {
  const isBig  = hFt >= 5;
  const px     = isBig ? finish.bigPrefix : finish.prefix;
  const hStr   = Number.isInteger(hFt) ? `${hFt}` : `${hFt}`;
  const wStr   = Number.isInteger(wFt) ? `${wFt}` : `${wFt}`;
  return `${px}_KDP_${hStr}x${wStr}`;
};

/** Unique key used for duplicate detection */
const productKey = (name: string) => name.trim().toLowerCase();

// ── Item state for the grid ───────────────────────────────────────────────────
interface GridItem {
  key:         string;   // unique key = name.toLowerCase()
  name:        string;
  hFt:         number;
  wFt:         number;
  sqft:        number;
  finish:      FinishDef;
  ratePerSqft: number;   // landed cost
  sellingPrice:number;   // selling price per slab
  stock:       number;   // initial stock (boxes = slabs)
  exists:      boolean;  // already in inventory
  selected:    boolean;  // checked for bulk create
}

// ── Component ─────────────────────────────────────────────────────────────────
const KadapaInventoryGenerator: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  // Pull finishes from settings if admin has customised them
  const settingTypes = store.settings.kadapaItemTypes || [];
  const finishes: FinishDef[] = settingTypes.length >= 2
    ? settingTypes.slice(0, 2).map((t, i) => ({
        ...DEFAULT_FINISHES[i],
        name:        t.name,
        ratePerSqft: t.ratePerSqft,
      }))
    : DEFAULT_FINISHES;

  // Existing product names (lower-cased) for duplicate detection
  const existingKeys = useMemo(() =>
    new Set(store.products.map(p => productKey(p.name))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.products.length]
  );

  // ── Build the full grid from the matrix ──────────────────────────────────
  const buildGrid = useCallback((): GridItem[] => {
    const rows: GridItem[] = [];
    HEIGHTS.forEach(h => {
      WIDTHS.forEach((w, wIdx) => {
        finishes.forEach(f => {
          const sqft = sqftFor(h, wIdx);
          const name = buildName(h, w.ft, f);
          rows.push({
            key:          productKey(name),
            name,
            hFt:          h,
            wFt:          w.ft,
            sqft,
            finish:       f,
            ratePerSqft:  f.ratePerSqft,
            sellingPrice: 0,
            stock:        0,
            exists:       existingKeys.has(productKey(name)),
            selected:     !existingKeys.has(productKey(name)), // pre-select new ones
          });
        });
      });
    });
    return rows;
  }, [existingKeys, finishes]);

  const [grid, setGrid]                   = useState<GridItem[]>(() => buildGrid());
  const [activeFinish, setActiveFinish]   = useState<string>(finishes[0].id);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customH, setCustomH]             = useState<number>(0);
  const [customW, setCustomW]             = useState<number>(0);
  const [bulkSell, setBulkSell]           = useState<number>(0);    // apply to all selected
  const [bulkStock, setBulkStock]         = useState<number>(0);
  const [creating, setCreating]           = useState(false);
  const [result, setResult]               = useState<{ created: number; skipped: number } | null>(null);
  const [filterFinish, setFilterFinish]   = useState<string>('all');

  const filteredGrid = useMemo(() => {
    let g = grid;
    if (filterFinish !== 'all') g = g.filter(i => i.finish.id === filterFinish);
    return g;
  }, [grid, filterFinish]);

  const selectedCount = useMemo(() => grid.filter(i => i.selected && !i.exists).length, [grid]);
  const existingCount = grid.filter(i => i.exists).length;

  // ── Update a single item's selling price or stock ──────────────────────────
  const updateItem = (key: string, field: 'sellingPrice' | 'stock', val: number) => {
    setGrid(prev => prev.map(i => i.key === key ? { ...i, [field]: val } : i));
  };

  // ── Toggle selection ───────────────────────────────────────────────────────
  const toggleSelect = (key: string) => {
    setGrid(prev => prev.map(i => i.key === key && !i.exists ? { ...i, selected: !i.selected } : i));
  };
  const selectAll  = () => setGrid(prev => prev.map(i => i.exists ? i : { ...i, selected: true }));
  const selectNone = () => setGrid(prev => prev.map(i => ({ ...i, selected: false })));

  // ── Apply bulk values ──────────────────────────────────────────────────────
  const applyBulk = () => {
    setGrid(prev => prev.map(i => {
      if (!i.selected || i.exists) return i;
      return {
        ...i,
        sellingPrice: bulkSell  > 0 ? bulkSell  : i.sellingPrice,
        stock:        bulkStock > 0 ? bulkStock : i.stock,
      };
    }));
  };

  // ── Add custom size ────────────────────────────────────────────────────────
  const addCustom = () => {
    if (!customH || !customW) return;
    const newItems: GridItem[] = finishes.map(f => {
      const sqft = Math.round(customH * customW * 100) / 100;
      const name = buildName(customH, customW, f);
      const key  = productKey(name);
      // Duplicate prevention
      if (grid.find(i => i.key === key)) return null as any;
      return {
        key,
        name,
        hFt:          customH,
        wFt:          customW,
        sqft,
        finish:       f,
        ratePerSqft:  f.ratePerSqft,
        sellingPrice: 0,
        stock:        0,
        exists:       existingKeys.has(key),
        selected:     !existingKeys.has(key),
      };
    }).filter(Boolean);

    if (newItems.length === 0) {
      alert('Custom size already exists for all finish types.');
      return;
    }
    setGrid(prev => [...prev, ...newItems]);
    setCustomH(0); setCustomW(0); setShowCustomForm(false);
  };

  // ── Create products ────────────────────────────────────────────────────────
  const handleCreate = async () => {
    const toCreate = grid.filter(i => i.selected && !i.exists);
    if (!toCreate.length) return;
    setCreating(true);

    let created = 0; let skipped = 0;

    for (const item of toCreate) {
      // Final duplicate check against live store (name+size)
      const alreadyExists = store.productExists
        ? store.productExists(item.name, item.hFt + 'x' + item.wFt)
        : store.products.some(p => productKey(p.name) === item.key);
      if (alreadyExists) { skipped++; continue; }

      const sqftPerBox = item.sqft;  // 1 slab = 1 "box" in POS
      const landedPerSlab = Math.round(item.sqft * item.ratePerSqft * 100) / 100;
      const now = Date.now();

      const product: Product = {
        id:               `kdp-${now}-${Math.random().toString(36).substr(2, 6)}`,
        name:             item.name,
        category:         'Kadapa' as any,
        brand:            'Kadapa',
        isTile:           false,
        unitType:         'Box' as any,  // 1 box = 1 slab
        size:             `${item.hFt}x${item.wFt}`,
        finish:           item.finish.name,
        tilesPerBox:      1,             // 1 slab per "box"
        sqftPerBox,
        purchasePrice:    landedPerSlab,
        transportCost:    0,
        transportCostType:'Percentage' as any,
        transportBasis:   'Per Unit' as any,
        otherCharges:     0,
        totalCostPerUnit: landedPerSlab,
        totalStockValue:  landedPerSlab * item.stock,
        sellingPrice:     item.sellingPrice,
        sellingPricePerSqft: item.sqft > 0 && item.sellingPrice > 0
          ? Math.round((item.sellingPrice / item.sqft) * 100) / 100
          : 0,
        stockBoxes:       item.stock,
        stockLoose:       0,
        damagedPieces:    0,
        damageHistory:    [],
        purchaseHistory:  [],
        adjustmentLog:    [],
        reorderLevel:     5,
        images:           [],
        slabHeightFt:     item.hFt,
        slabLengthFt:     item.wFt,
        costPerSqft:      item.ratePerSqft,
        status:           'Active',
        showInGallery:    true,
        grade:            'Premium' as any,
        shadeNo:          '',
        batchNo:          '',
        slabs:            [],
        lastPurchaseDate: new Date().toISOString().split('T')[0],
      } as any;

      store.addProduct(product);

      // Mark as existing in local grid state
      setGrid(prev => prev.map(i =>
        i.key === item.key ? { ...i, exists: true, selected: false } : i
      ));
      created++;
    }

    setCreating(false);
    setResult({ created, skipped });
  };

  // ── INR helper ────────────────────────────────────────────────────────────
  const INR = (n: number) => n > 0 ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—';

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-0 pb-10">

      {/* ── Header ── */}
      <div className="bg-slate-900 text-white rounded-t-[28px] px-6 py-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Kadapa Inventory</div>
          <h2 className="text-2xl font-black tracking-tight">Auto-Generate All Sizes</h2>
          <p className="text-[10px] text-slate-400 font-bold mt-1">
            {HEIGHTS.length}×{WIDTHS.length}×{finishes.length} combinations ·&nbsp;
            <span className="text-emerald-400">{selectedCount} new to create</span> ·&nbsp;
            <span className="text-slate-500">{existingCount} already in inventory</span>
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20 shrink-0">
            <i className="fas fa-times"></i>
          </button>
        )}
      </div>

      {/* ── Naming convention guide ── */}
      <div className="bg-amber-50 border border-amber-200 border-t-0 px-6 py-3 flex flex-wrap gap-4 text-[9px] font-black">
        <div className="flex items-center gap-2 text-amber-700">
          <span className="bg-amber-200 px-2 py-0.5 rounded font-black">SP_KDP_2x1</span>
          <span className="text-amber-500 font-bold">Single Polish, 2ft height, 1ft width</span>
        </div>
        <div className="flex items-center gap-2 text-amber-700">
          <span className="bg-amber-200 px-2 py-0.5 rounded font-black">DSP_KDP_5x2</span>
          <span className="text-amber-500 font-bold">Big Single Polish (height ≥ 5ft)</span>
        </div>
        <div className="flex items-center gap-2 text-amber-700">
          <span className="bg-amber-200 px-2 py-0.5 rounded font-black">DDP_KDP_6x2.5</span>
          <span className="text-amber-500 font-bold">Big Double Polish (height ≥ 5ft)</span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="bg-white border border-slate-200 border-t-0 px-5 py-4 flex flex-wrap gap-3 items-center">
        {/* Finish filter */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[{ id: 'all', label: 'All Finishes' }, ...finishes.map(f => ({ id: f.id, label: f.name }))].map(f => (
            <button key={f.id} onClick={() => setFilterFinish(f.id)}
              className={`px-3 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${filterFinish === f.id ? 'bg-white text-slate-900 shadow' : 'text-slate-400 hover:text-slate-700'}`}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 text-[9px]">
          <button onClick={selectAll}  className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl font-black uppercase hover:bg-slate-200">Select New</button>
          <button onClick={selectNone} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl font-black uppercase hover:bg-slate-200">Deselect All</button>
        </div>

        {/* Bulk price/stock setter */}
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
          <span className="text-[8px] font-black text-indigo-500 uppercase whitespace-nowrap">Bulk set:</span>
          <input type="number" placeholder="₹ Sell price" className="w-24 bg-white border border-indigo-200 rounded-lg px-2 py-1 text-xs font-black outline-none text-indigo-700"
            value={bulkSell || ''} onChange={e => setBulkSell(parseFloat(e.target.value || '0'))} />
          <input type="number" placeholder="Stock" className="w-16 bg-white border border-indigo-200 rounded-lg px-2 py-1 text-xs font-black outline-none text-indigo-700"
            value={bulkStock || ''} onChange={e => setBulkStock(parseFloat(e.target.value || '0'))} />
          <button onClick={applyBulk}
            className="px-3 py-1 bg-indigo-600 text-white rounded-lg font-black text-[9px] uppercase hover:bg-indigo-700 transition-all whitespace-nowrap">
            Apply to Selected
          </button>
        </div>

        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowCustomForm(v => !v)}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-black text-[9px] uppercase hover:bg-amber-100 transition-all">
            <i className="fas fa-plus text-[9px]"></i> Custom Size
          </button>
          <button onClick={handleCreate} disabled={creating || selectedCount === 0}
            className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-40 shadow-lg shadow-emerald-900/20">
            {creating
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Creating…</>
              : <><i className="fas fa-magic text-[9px]"></i> Create {selectedCount} Items</>}
          </button>
        </div>
      </div>

      {/* Result banner */}
      {result && (
        <div className={`px-6 py-3 flex items-center gap-3 text-sm font-bold border-t ${result.created > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
          <i className={`fas ${result.created > 0 ? 'fa-check-circle text-emerald-500' : 'fa-info-circle text-amber-500'}`}></i>
          {result.created > 0 ? `✓ ${result.created} Kadapa products created successfully!` : ''}
          {result.skipped > 0 ? ` ${result.skipped} skipped (already exist).` : ''}
          <button onClick={() => setResult(null)} className="ml-auto text-xs underline opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* Custom size form */}
      {showCustomForm && (
        <div className="bg-amber-50 border border-amber-200 border-t-0 px-6 py-4 flex flex-wrap items-end gap-4">
          <div className="text-[9px] font-black text-amber-700 uppercase self-start pt-1 w-full">Add Custom Size</div>
          <div>
            <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Height (Ft)</label>
            <input type="number" step="0.5" className="w-24 px-3 py-2.5 bg-white border-2 border-amber-200 rounded-xl font-black text-sm outline-none focus:border-amber-500"
              placeholder="e.g. 3.5"
              value={customH || ''} onChange={e => setCustomH(parseFloat(e.target.value || '0'))} />
          </div>
          <div>
            <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Width (Ft)</label>
            <input type="number" step="0.25" className="w-24 px-3 py-2.5 bg-white border-2 border-amber-200 rounded-xl font-black text-sm outline-none focus:border-amber-500"
              placeholder="e.g. 1.25"
              value={customW || ''} onChange={e => setCustomW(parseFloat(e.target.value || '0'))} />
          </div>
          {customH > 0 && customW > 0 && (
            <div className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs space-y-0.5">
              <div className="font-black text-slate-700">{customH} × {customW} ft = {Math.round(customH * customW * 100) / 100} SqFt</div>
              {finishes.map(f => (
                <div key={f.id} className="text-slate-400 font-bold">
                  {buildName(customH, customW, f)}
                  {existingKeys.has(productKey(buildName(customH, customW, f))) &&
                    <span className="text-rose-400 ml-2 text-[8px]">Already exists</span>}
                </div>
              ))}
            </div>
          )}
          <button onClick={addCustom} disabled={!customH || !customW}
            className="px-5 py-2.5 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-700 transition-all disabled:opacity-40">
            Add to Grid
          </button>
          <button onClick={() => setShowCustomForm(false)}
            className="px-4 py-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl font-black text-[9px] uppercase hover:bg-slate-50">
            Cancel
          </button>
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="border border-slate-200 border-t-0 rounded-b-[28px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-3 text-left">
                  <input type="checkbox"
                    className="w-3.5 h-3.5 rounded accent-emerald-600"
                    checked={selectedCount > 0 && selectedCount === grid.filter(i => !i.exists).length}
                    onChange={e => e.target.checked ? selectAll() : selectNone()} />
                </th>
                <th className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest">Product Name</th>
                <th className="px-3 py-3 text-center font-black text-[8px] text-slate-400 uppercase tracking-widest">Size</th>
                <th className="px-3 py-3 text-center font-black text-[8px] text-slate-400 uppercase tracking-widest">SqFt</th>
                <th className="px-3 py-3 text-center font-black text-[8px] text-slate-400 uppercase tracking-widest">Finish</th>
                <th className="px-3 py-3 text-center font-black text-[8px] text-emerald-500 uppercase tracking-widest">Landed/Slab</th>
                <th className="px-3 py-3 text-center font-black text-[8px] text-amber-500 uppercase tracking-widest">Selling Price ₹</th>
                <th className="px-3 py-3 text-center font-black text-[8px] text-indigo-500 uppercase tracking-widest">Stock</th>
                <th className="px-3 py-3 text-center font-black text-[8px] text-slate-400 uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredGrid.map(item => {
                const landed = Math.round(item.sqft * item.ratePerSqft * 100) / 100;
                const margin = item.sellingPrice > 0 ? Math.round(((item.sellingPrice - landed) / landed) * 100) : null;
                return (
                  <tr key={item.key}
                    className={`transition-colors ${
                      item.exists
                        ? 'bg-slate-50/80 opacity-60'
                        : item.selected
                          ? 'bg-emerald-50/50 hover:bg-emerald-50'
                          : 'bg-white hover:bg-slate-50'
                    }`}>

                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      {!item.exists ? (
                        <input type="checkbox" className="w-3.5 h-3.5 rounded accent-emerald-600"
                          checked={item.selected}
                          onChange={() => toggleSelect(item.key)} />
                      ) : (
                        <i className="fas fa-check-circle text-emerald-400 text-xs"></i>
                      )}
                    </td>

                    {/* Name */}
                    <td className="px-3 py-2.5">
                      <div className="font-black text-slate-800 text-[11px] tracking-tight">{item.name}</div>
                      {item.hFt >= 5 && (
                        <div className="text-[8px] text-amber-600 font-black">Big size</div>
                      )}
                    </td>

                    {/* Size */}
                    <td className="px-3 py-2.5 text-center font-bold text-slate-600 whitespace-nowrap">
                      {item.hFt} × {item.wFt} ft
                    </td>

                    {/* SqFt */}
                    <td className="px-3 py-2.5 text-center">
                      <span className="font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">{item.sqft}</span>
                    </td>

                    {/* Finish */}
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                        item.finish.id === 'sp'
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-purple-50 text-purple-600'
                      }`}>{item.finish.name}</span>
                    </td>

                    {/* Landed */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="font-black text-emerald-700">{INR(landed)}</div>
                      <div className="text-[7px] text-emerald-400">₹{item.ratePerSqft}/SqFt</div>
                    </td>

                    {/* Selling price — editable */}
                    <td className="px-3 py-2.5">
                      {item.exists ? (
                        <div className="text-center font-black text-amber-600">
                          {INR(store.products.find(p => productKey(p.name) === item.key)?.sellingPrice || 0)}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-black text-xs">₹</span>
                          <input type="number" step="0.5"
                            className={`w-20 px-2 py-1.5 border rounded-lg font-black text-sm outline-none transition-all text-center ${
                              item.selected
                                ? 'border-amber-300 bg-amber-50 text-amber-800 focus:border-amber-500'
                                : 'border-slate-200 bg-white text-slate-600 focus:border-amber-400'
                            }`}
                            placeholder="0"
                            value={item.sellingPrice || ''}
                            onChange={e => updateItem(item.key, 'sellingPrice', parseFloat(e.target.value || '0'))}
                          />
                          {margin !== null && landed > 0 && (
                            <span className={`text-[8px] font-black whitespace-nowrap ${margin >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                              {margin >= 0 ? '+' : ''}{margin}%
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Stock — editable */}
                    <td className="px-3 py-2.5">
                      {item.exists ? (
                        <div className="text-center font-black text-indigo-600">
                          {store.products.find(p => productKey(p.name) === item.key)?.stockBoxes ?? 0} slabs
                        </div>
                      ) : (
                        <input type="number" min="0"
                          className={`w-16 px-2 py-1.5 border rounded-lg font-black text-sm outline-none transition-all text-center ${
                            item.selected
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-800 focus:border-indigo-500'
                              : 'border-slate-200 bg-white text-slate-600 focus:border-indigo-400'
                          }`}
                          placeholder="0"
                          value={item.stock || ''}
                          onChange={e => updateItem(item.key, 'stock', parseInt(e.target.value || '0'))}
                        />
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2.5 text-center">
                      {item.exists ? (
                        <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">In Stock</span>
                      ) : item.selected ? (
                        <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Will Create</span>
                      ) : (
                        <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Skipped</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredGrid.length === 0 && (
                <tr><td colSpan={9} className="py-16 text-center text-slate-300 font-black uppercase text-sm">No items</td></tr>
              )}
            </tbody>

            {/* Summary footer */}
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td colSpan={6} className="px-4 py-3 text-[9px] font-black text-slate-500 uppercase">
                  {filteredGrid.filter(i => !i.exists).length} new · {filteredGrid.filter(i => i.exists).length} existing
                </td>
                <td className="px-4 py-3 text-center text-[9px] font-black text-amber-600">
                  {filteredGrid.filter(i => i.selected && i.sellingPrice > 0).length} priced
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Bottom create bar ── */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-4 bg-slate-900 text-white rounded-full px-6 py-3.5 shadow-2xl shadow-slate-900/40">
            <div className="text-sm">
              <span className="font-black">{selectedCount}</span>
              <span className="text-slate-400 font-bold ml-1">items selected</span>
            </div>
            <button onClick={handleCreate} disabled={creating}
              className="bg-emerald-600 text-white px-6 py-2 rounded-full font-black text-[10px] uppercase hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2">
              {creating
                ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Creating…</>
                : <><i className="fas fa-magic text-[9px]"></i> Create {selectedCount} Kadapa Products</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default KadapaInventoryGenerator;
