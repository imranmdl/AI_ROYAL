/**
 * KadapaManager.tsx — Ultra Simple
 *
 * Step 1: Pick finish (rates come from global settings)
 * Step 2: Tap a size cell  (standard grid OR custom)
 * Step 3: Enter qty + selling price → Add to Stock
 *
 * Purchase price is GLOBAL — set once in System Settings → Kadapa Rates.
 * No need to enter it per inward.
 */

import React, { useState, useMemo } from 'react';
import { store } from '../store';
import type { Slab } from '../types';

const HEIGHTS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];
const WIDTHS: { inches: number; ft: number; col: string }[] = [
  { inches:  9, ft: 1,    col: '9"\n(1 ft)'       },
  { inches: 11, ft: 1,    col: '11"\n(1 ft)'       },
  { inches: 14, ft: 1.25, col: '14"\n(1.25 ft)'    },
  { inches: 17, ft: 1.5,  col: '17"\n(1.5 ft)'     },
  { inches: 23, ft: 2,    col: '23"\n(2 ft)'        },
  { inches: 29, ft: 2.5,  col: '29"\n(2.5 ft)'     },
];
const sqftOf = (h: number, wFt: number) => Math.round(h * wFt * 100) / 100;
const r2     = (n: number) => Math.round(n * 100) / 100;
const INR    = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

interface Props {
  existingSlabs: Slab[];
  onAdd:        (slabs: Slab[]) => void;
  onRemove:     (id: string) => void;
  onUpdateSlab?: (id: string, u: Partial<Slab>) => void;
}

const KadapaManager: React.FC<Props> = ({ existingSlabs, onAdd, onRemove }) => {

  // Global finish types with purchase rates
  const finishTypes = store.settings.kadapaItemTypes || [
    { id: 'ksp',  name: 'Single Polish',     ratePerSqft: 28 },
    { id: 'kdp',  name: 'Double Polish',     ratePerSqft: 35 },
    { id: 'kbsp', name: 'Big Single Polish', ratePerSqft: 45 },
    { id: 'kbdp', name: 'Big Double Polish', ratePerSqft: 55 },
  ];

  const PREFIX: Record<string, string> = {
    'Single Polish': 'SP', 'Double Polish': 'DP',
    'Big Single Polish': 'DSP', 'Big Double Polish': 'DDP',
  };

  // ── State ─────────────────────────────────────────────────────────────────
  const [finish,    setFinish]    = useState(finishTypes[0]);
  const [selH,      setSelH]      = useState<number | null>(null);
  const [selWIdx,   setSelWIdx]   = useState<number | null>(null);
  const [sellRate,  setSellRate]  = useState(0);
  const [qty,       setQty]       = useState(1);
  const [customH,   setCustomH]   = useState('');
  const [customW,   setCustomW]   = useState('');
  const [useCustom, setUseCustom] = useState(false);

  // ── Active size ────────────────────────────────────────────────────────────
  const h    = useCustom ? parseFloat(customH || '0') : (selH ?? 0);
  const wFt  = useCustom ? parseFloat(customW || '0') : (selWIdx !== null ? WIDTHS[selWIdx].ft : 0);
  const wIn  = useCustom ? Math.round(parseFloat(customW || '0') * 12) : (selWIdx !== null ? WIDTHS[selWIdx].inches : 0);
  const sqft = h && wFt ? sqftOf(h, wFt) : 0;

  // Derived from global rate
  const buyRate      = finish.ratePerSqft;
  const landedPerSlab  = r2(sqft * buyRate);
  const sellingPerSlab = r2(sqft * sellRate);
  const marginPct      = landedPerSlab > 0 ? r2(((sellingPerSlab - landedPerSlab) / landedPerSlab) * 100) : 0;

  // Product name
  const pfx    = PREFIX[finish.name] || 'SP';
  const pName  = sqft > 0 ? `${pfx}_KDP_${h}x${wFt}` : '';

  // Stock badges (available slabs per cell)
  const cellAvail = useMemo(() => {
    const m: Record<string, number> = {};
    existingSlabs.forEach(s => {
      const sa = s as any;
      if (!s.isSold) {
        const k = `${sa.heightFt}|${sa.lengthFt}`;
        m[k] = (m[k] || 0) + 1;
      }
    });
    return m;
  }, [existingSlabs]);

  // Current stock for selected size+finish
  const currentStock = useMemo(() => {
    if (!sqft) return { slabs: 0, sqft: 0 };
    const avail = existingSlabs.filter(s => {
      const sa = s as any;
      return !s.isSold && sa.heightFt === h && sa.lengthFt === wFt && sa.finish === finish.name;
    });
    return { slabs: avail.length, sqft: r2(avail.reduce((a, s) => a + ((s as any).sqft || 0), 0)) };
  }, [existingSlabs, h, wFt, finish, sqft]);

  // ── Add to stock ──────────────────────────────────────────────────────────
  const handleAdd = () => {
    if (!sqft || qty < 1) return;
    const base    = `${pfx}-${h}ft-${wIn}in`;
    const existing = existingSlabs.filter(s => s.slabNo?.startsWith(base));
    const maxNum   = existing.reduce((m, s) => Math.max(m, parseInt(s.slabNo?.split('-').pop() || '0') || 0), 0);
    const now      = Date.now();

    const slabs: Slab[] = Array.from({ length: qty }, (_, i) => ({
      id:                  `slab-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
      slabNo:              `${base}-${maxNum + i + 1}`,
      heightFt:            h,
      heightIn:            Math.round(h * 12),
      lengthFt:            wFt,
      lengthIn:            wIn,
      sqft,
      isSold:              false,
      finish:              finish.name,
      landedCost:          landedPerSlab,
      landedCostPerSqft:   buyRate,
      sellingPrice:        sellingPerSlab,
      sellingPricePerSqft: sellRate,
    } as any));

    onAdd(slabs);
    setQty(1);
    setSellRate(0);
  };

  // ── Stock summary rows ────────────────────────────────────────────────────
  const stockRows = useMemo(() => {
    const map = new Map<string, { h: number; w: number; finish: string; sqft: number; avail: number; total: number; sellRate: number }>();
    existingSlabs.forEach(s => {
      const sa = s as any;
      const k  = `${sa.finish}|${sa.heightFt}|${sa.lengthFt}`;
      if (!map.has(k)) map.set(k, { h: sa.heightFt, w: sa.lengthFt, finish: sa.finish, sqft: sa.sqft || 0, avail: 0, total: 0, sellRate: sa.sellingPricePerSqft || 0 });
      const row = map.get(k)!;
      row.total++;
      if (!s.isSold) row.avail++;
    });
    return [...map.values()].sort((a, b) => (b.avail - a.avail) || a.finish.localeCompare(b.finish));
  }, [existingSlabs]);

  const totalAvailSlabs = stockRows.reduce((a, r) => a + r.avail, 0);
  const totalAvailSqft  = r2(existingSlabs.filter(s => !s.isSold).reduce((a, s) => a + ((s as any).sqft || 0), 0));

  const ready = sqft > 0 && qty > 0;

  return (
    <div className="space-y-4">

      {/* ── STEP 1: Finish ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {finishTypes.map(f => (
          <button key={f.id} type="button" onClick={() => setFinish(f)}
            className={`rounded-2xl border-2 py-3 px-3 text-left transition-all active:scale-95 ${
              finish.id === f.id
                ? 'border-amber-500 bg-amber-50 shadow-md'
                : 'border-slate-200 bg-white hover:border-amber-300'
            }`}>
            <div className="font-black text-slate-800 text-sm leading-tight">{f.name}</div>
            <div className="font-black text-amber-600 text-base mt-0.5">₹{f.ratePerSqft}<span className="text-[9px] font-bold text-amber-400">/sqft</span></div>
            {finish.id === f.id && <div className="text-[8px] font-black text-amber-500 mt-0.5">● Selected</div>}
          </button>
        ))}
      </div>

      {/* ── STEP 2: Size ──────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">

        {/* Toggle header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Select Size</div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-[9px] font-bold text-slate-500">Custom size</span>
            <button type="button" onClick={() => { setUseCustom(v => !v); setSelH(null); setSelWIdx(null); }}
              className={`w-9 h-5 rounded-full relative transition-all ${useCustom ? 'bg-amber-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${useCustom ? 'left-4' : 'left-0.5'}`} />
            </button>
          </label>
        </div>

        {!useCustom ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[440px]">
              <thead>
                <tr>
                  <th className="bg-slate-800 text-slate-400 text-left px-3 py-2.5 text-[8px] font-black uppercase">H ↓ / W →</th>
                  {WIDTHS.map((w, wi) => (
                    <th key={wi} className={`px-2 py-2.5 text-center text-[8px] font-black whitespace-pre-line leading-snug ${selWIdx === wi ? 'bg-amber-500 text-white' : 'bg-slate-800 text-amber-300'}`}>
                      {w.col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HEIGHTS.map((hh, hi) => (
                  <tr key={hh} className={hi % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className={`px-3 py-1 text-[10px] font-black border-r border-slate-100 whitespace-nowrap ${selH === hh ? 'bg-amber-500 text-white' : 'text-slate-600'}`}>
                      {hh} ft
                    </td>
                    {WIDTHS.map((w, wi) => {
                      const sf    = sqftOf(hh, w.ft);
                      const isSel = selH === hh && selWIdx === wi;
                      const cnt   = cellAvail[`${hh}|${w.ft}`] || 0;
                      return (
                        <td key={wi} className="p-0.5">
                          <button type="button"
                            onClick={() => { setSelH(hh); setSelWIdx(wi); }}
                            className={`w-full rounded-xl py-2.5 relative text-center transition-all active:scale-95 ${
                              isSel
                                ? 'bg-amber-500 text-white shadow-lg ring-2 ring-amber-300 scale-105'
                                : cnt > 0
                                  ? 'bg-emerald-50 border border-emerald-200 hover:bg-amber-50 text-emerald-800'
                                  : 'bg-white border border-slate-100 hover:bg-amber-50 hover:border-amber-200 text-slate-500'
                            }`}>
                            <div className="text-[10px] font-black">{sf.toFixed(2)}</div>
                            <div className={`text-[7px] ${isSel ? 'text-amber-100' : 'text-slate-400'}`}>sqft</div>
                            {cnt > 0 && (
                              <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-white rounded-full text-[7px] font-black flex items-center justify-center">{cnt > 9 ? '9+' : cnt}</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-1.5 text-[7px] text-slate-400 font-bold bg-slate-50 border-t border-slate-100">
              Heights in feet · Widths in inches · Green badge = slabs in stock
            </div>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-2 gap-3">
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Height (ft)</label>
              <input type="number" step="0.5" placeholder="e.g. 3.5"
                className="w-full px-4 py-3 bg-white border-2 border-amber-200 rounded-xl font-black text-lg outline-none focus:border-amber-500"
                value={customH} onChange={e => setCustomH(e.target.value)} />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Width (ft)</label>
              <input type="number" step="0.25" placeholder="e.g. 1.25"
                className="w-full px-4 py-3 bg-white border-2 border-amber-200 rounded-xl font-black text-lg outline-none focus:border-amber-500"
                value={customW} onChange={e => setCustomW(e.target.value)} />
            </div>
            {sqft > 0 && (
              <div className="col-span-2 bg-amber-50 rounded-xl p-3 text-center">
                <span className="font-black text-amber-700 text-xl">{sqft} SqFt / slab</span>
                <span className="text-amber-500 font-bold text-sm ml-2">· {pName}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── STEP 3: Qty + Selling price ──────────────────────────────────── */}
      {ready && (
        <div className="bg-white border-2 border-amber-200 rounded-2xl p-4 space-y-4">

          {/* Selected summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-black text-slate-900 text-base">{pName}</div>
              <div className="text-[9px] text-slate-400 font-bold mt-0.5">
                {h} ft × {wIn}" · {sqft} sqft/slab
                · Landed <span className="text-emerald-600 font-black">₹{buyRate}/sqft</span> (global rate)
              </div>
            </div>
            {currentStock.slabs > 0 && (
              <div className="text-right bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5">
                <div className="font-black text-emerald-700">{currentStock.slabs} slabs in stock</div>
                <div className="text-[8px] text-emerald-500 font-bold">{currentStock.sqft} sqft available</div>
              </div>
            )}
          </div>

          {/* Two inputs only */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[8px] font-black text-indigo-600 uppercase block mb-1.5">Number of Slabs</label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))}
                  className="w-12 h-14 bg-slate-100 rounded-xl font-black text-2xl hover:bg-slate-200 transition-all flex items-center justify-center">−</button>
                <input type="number" min={1}
                  className="flex-1 px-3 py-4 bg-white border-2 border-indigo-200 rounded-xl font-black text-2xl text-center outline-none focus:border-indigo-500"
                  value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value || '1')))} />
                <button type="button" onClick={() => setQty(q => q + 1)}
                  className="w-12 h-14 bg-slate-100 rounded-xl font-black text-2xl hover:bg-slate-200 transition-all flex items-center justify-center">+</button>
              </div>
            </div>
            <div>
              <label className="text-[8px] font-black text-amber-600 uppercase block mb-1.5">Selling Price / SqFt (₹)</label>
              <input type="number" step="0.5" placeholder="Enter selling price"
                className="w-full px-4 py-4 bg-amber-50 border-2 border-amber-300 rounded-xl font-black text-2xl text-amber-800 outline-none focus:border-amber-500 transition-all"
                value={sellRate || ''}
                onChange={e => setSellRate(parseFloat(e.target.value || '0'))} />
              {sellRate > 0 && <div className="text-[8px] text-amber-600 font-bold mt-1">{INR(sellingPerSlab)} per slab</div>}
            </div>
          </div>

          {/* Summary + Add button */}
          <div className="bg-slate-50 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-sm font-bold text-slate-600">
                <span className="font-black text-slate-900">{qty} slab{qty > 1 ? 's' : ''}</span>
                {' · '}
                <span className="text-indigo-600 font-black">{r2(qty * sqft)} sqft</span>
                {' · Landed '}
                <span className="text-emerald-700 font-black">{INR(qty * landedPerSlab)}</span>
              </div>
              {sellRate > 0 && (
                <div className="text-sm">
                  {'Selling '}
                  <span className="font-black text-amber-700">{INR(qty * sellingPerSlab)}</span>
                  {' · Margin '}
                  <span className={`font-black ${marginPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {marginPct >= 0 ? '+' : ''}{marginPct}%
                  </span>
                </div>
              )}
            </div>
            <button type="button" onClick={handleAdd}
              className="px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95 flex items-center gap-2 shadow-lg">
              <i className="fas fa-plus text-xs"></i>
              Add {qty} Slab{qty > 1 ? 's' : ''} to Stock
            </button>
          </div>
        </div>
      )}

      {/* ── Stock summary ────────────────────────────────────────────────── */}
      {stockRows.length > 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
            <div className="font-black text-slate-700 text-sm">Stock Summary</div>
            <div className="text-[9px] font-black text-slate-500">
              <span className="text-emerald-600">{totalAvailSlabs} slabs</span>
              {' · '}
              <span className="text-indigo-600">{totalAvailSqft} sqft</span>
              {' available'}
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {stockRows.map(row => {
              const p = PREFIX[row.finish] || 'SP';
              const pn = `${p}_KDP_${row.h}x${row.w}`;
              const m  = row.sellRate > 0 && buyRate > 0
                ? r2(((row.sellRate - (finishTypes.find(f => f.name === row.finish)?.ratePerSqft || buyRate)) / (finishTypes.find(f => f.name === row.finish)?.ratePerSqft || buyRate)) * 100) : null;
              return (
                <div key={row.finish+'|'+row.h+'|'+row.w} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[9px] font-black ${row.avail > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                      {row.avail > 0 ? row.avail : '0'}
                    </div>
                    <div>
                      <div className="font-black text-slate-800 text-sm">{pn}</div>
                      <div className="text-[8px] text-slate-400 font-bold">
                        {row.h} ft × {row.w} ft · {row.sqft} sqft/slab · {row.total} total
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <div className="font-black text-emerald-700 text-sm">
                        {r2(row.avail * row.sqft)} sqft
                      </div>
                      <div className="text-[8px] text-slate-400 font-bold">available</div>
                    </div>
                    {row.sellRate > 0 && (
                      <div>
                        <div className="font-black text-amber-700">₹{row.sellRate}/sqft</div>
                        {m !== null && (
                          <div className={`text-[8px] font-black ${m >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{m >= 0 ? '+' : ''}{m}% margin</div>
                        )}
                      </div>
                    )}
                    {row.avail > 0 && (
                      <button onClick={() => {
                        const slab = existingSlabs.find(s => {
                          const sa = s as any;
                          return sa.finish === row.finish && sa.heightFt === row.h && sa.lengthFt === row.w && !s.isSold;
                        });
                        if (slab) onRemove(slab.id);
                      }} className="w-8 h-8 flex items-center justify-center text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all" title="Remove one slab">
                        <i className="fas fa-minus text-[9px]"></i>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default KadapaManager;
