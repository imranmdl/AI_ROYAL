/**
 * KadapaManager.tsx — SIMPLIFIED
 *
 * Flow:
 *  1. Tap a size cell in the grid
 *  2. Select finish (SP / DP / Big SP / Big DP)
 *  3. Enter: purchase price/sqft · selling price/sqft · no. of slabs
 *  4. Tap "Add to Stock"
 *
 * Stock register shows existing slabs per size with available count & sqft.
 */

import React, { useState, useMemo } from 'react';
import type { Slab } from '../types';

// ── Size matrix (matches chart) ───────────────────────────────────────────────
const HEIGHTS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];
const WIDTHS: { inches: number; ft: number; label: string }[] = [
  { inches:  9, ft: 1,    label: '9 in\n(1 Ft)'      },
  { inches: 11, ft: 1,    label: '11 in\n(1 Ft)'      },
  { inches: 14, ft: 1.25, label: '14 in\n(1.25 Ft)'   },
  { inches: 17, ft: 1.5,  label: '17 in\n(1.5 Ft)'    },
  { inches: 23, ft: 2,    label: '23 in\n(2 Ft)'       },
  { inches: 29, ft: 2.5,  label: '29 in\n(2.5 Ft)'    },
];
const sqftOf = (h: number, wFt: number) => Math.round(h * wFt * 100) / 100;

// ── Finish types ──────────────────────────────────────────────────────────────
interface Finish { id: string; label: string; shortLabel: string; defaultRate: number; bigPrefix: boolean }
const FINISHES: Finish[] = [
  { id: 'SP',  label: 'Single Polish',     shortLabel: 'SP',  defaultRate: 28, bigPrefix: false },
  { id: 'DP',  label: 'Double Polish',     shortLabel: 'DP',  defaultRate: 35, bigPrefix: false },
  { id: 'DSP', label: 'Big Single Polish', shortLabel: 'DSP', defaultRate: 45, bigPrefix: true  },
  { id: 'DDP', label: 'Big Double Polish', shortLabel: 'DDP', defaultRate: 55, bigPrefix: true  },
];
const productName = (finishId: string, h: number, wFt: number) =>
  `${finishId}_KDP_${h}x${wFt}`;

const r2 = (n: number) => Math.round(n * 100) / 100;
const INR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

interface Props {
  existingSlabs: Slab[];
  onAdd:        (slabs: Slab[]) => void;
  onRemove:     (id: string) => void;
  onUpdateSlab?: (id: string, updates: Partial<Slab>) => void;
}

const KadapaManager: React.FC<Props> = ({ existingSlabs, onAdd, onRemove }) => {

  // ── Selection state ───────────────────────────────────────────────────────
  const [selH,    setSelH]    = useState<number | null>(null);
  const [selWIdx, setSelWIdx] = useState<number | null>(null);
  const [finishId, setFinishId] = useState('SP');
  const [buyRate,  setBuyRate]  = useState(0);   // purchase ₹/sqft
  const [sellRate, setSellRate] = useState(0);   // selling ₹/sqft
  const [qty,      setQty]      = useState(1);   // slabs to add
  const [customH,  setCustomH]  = useState(0);
  const [customW,  setCustomW]  = useState(0);
  const [useCustom, setUseCustom] = useState(false);

  // ── Custom size ───────────────────────────────────────────────────────────
  const activeH   = useCustom ? customH   : (selH  ?? 0);
  const activeWFt = useCustom ? customW   : (selWIdx !== null ? WIDTHS[selWIdx].ft : 0);
  const activeWIn = useCustom ? Math.round(customW * 12) : (selWIdx !== null ? WIDTHS[selWIdx].inches : 0);
  const sqft      = activeH && activeWFt ? sqftOf(activeH, activeWFt) : 0;
  const pName     = sqft > 0 ? productName(finishId, activeH, activeWFt) : '';

  // ── Derived costs ─────────────────────────────────────────────────────────
  const landedPerSlab  = r2(sqft * buyRate);
  const sellingPerSlab = r2(sqft * sellRate);
  const marginPct      = landedPerSlab > 0 ? r2(((sellingPerSlab - landedPerSlab) / landedPerSlab) * 100) : 0;

  // ── Stock index: key = "finishId|hFt|wFt" → slabs ────────────────────────
  const stockIndex = useMemo(() => {
    const idx: Record<string, Slab[]> = {};
    existingSlabs.forEach(s => {
      const sa = s as any;
      const f  = sa.finish || 'SP';
      const h  = sa.heightFt || 0;
      const w  = sa.lengthFt || 0;
      const k  = `${f}|${h}|${w}`;
      if (!idx[k]) idx[k] = [];
      idx[k].push(s);
    });
    return idx;
  }, [existingSlabs]);

  const currentKey   = `${FINISHES.find(f=>f.id===finishId)?.label||finishId}|${activeH}|${activeWFt}`;
  const currentSlabs = stockIndex[currentKey] || [];
  const availSlabs   = currentSlabs.filter(s => !s.isSold);
  const availSqft    = r2(availSlabs.reduce((a, s) => a + ((s as any).sqft || 0), 0));

  // ── Per-cell stock count for grid highlight ────────────────────────────────
  const cellStock = useMemo(() => {
    const m: Record<string, number> = {};
    existingSlabs.forEach(s => {
      const sa = s as any;
      const k  = `${sa.heightFt}|${sa.lengthFt}`;
      if (!s.isSold) m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [existingSlabs]);

  // ── Add stock ─────────────────────────────────────────────────────────────
  const handleAdd = () => {
    if (!sqft || !buyRate || qty < 1) return;
    const finish  = FINISHES.find(f => f.id === finishId)!;
    const now     = Date.now();
    const base    = `${finishId}-KDP-${activeH}ft-${activeWIn}in`;

    // Next slab number
    const existing = existingSlabs.filter(s => (s.slabNo || '').startsWith(base));
    const nums      = existing.map(s => parseInt((s.slabNo || '').replace(base + '-', '')) || 0);
    const nextNum   = nums.length > 0 ? Math.max(...nums) + 1 : 1;

    const newSlabs: Slab[] = Array.from({ length: qty }, (_, i) => ({
      id:                  `slab-${now}-${i}-${Math.random().toString(36).substr(2,5)}`,
      slabNo:              `${base}-${nextNum + i}`,
      heightFt:            activeH,
      heightIn:            Math.round(activeH * 12),
      lengthFt:            activeWFt,
      lengthIn:            activeWIn,
      sqft,
      isSold:              false,
      finish:              finish.label,
      landedCost:          landedPerSlab,
      landedCostPerSqft:   buyRate,
      sellingPrice:        sellingPerSlab,
      sellingPricePerSqft: sellRate,
    } as any));

    onAdd(newSlabs);
    setQty(1);
  };

  // ── Auto-fill purchase rate from first existing slab of this size ──────────
  const handleCellClick = (h: number, wIdx: number) => {
    setSelH(h); setSelWIdx(wIdx); setUseCustom(false);
    // Auto-fill rate from existing slabs of this size
    const k = `${FINISHES.find(f=>f.id===finishId)?.label||finishId}|${h}|${WIDTHS[wIdx].ft}`;
    const ex = (stockIndex[k] || [])[0] as any;
    if (ex?.landedCostPerSqft) setBuyRate(ex.landedCostPerSqft);
    if (ex?.sellingPricePerSqft) setSellRate(ex.sellingPricePerSqft);
  };

  // ── Full stock register ────────────────────────────────────────────────────
  const stockRows = useMemo(() => {
    const rows: { key: string; finishLabel: string; h: number; w: number; sqft: number; total: number; avail: number; availSqft: number; landedRate: number; sellRate: number }[] = [];
    const seen = new Set<string>();
    existingSlabs.forEach(s => {
      const sa = s as any;
      const k  = `${sa.finish}|${sa.heightFt}|${sa.lengthFt}`;
      if (!seen.has(k)) {
        seen.add(k);
        const group  = existingSlabs.filter(x => {
          const xa = x as any;
          return xa.finish === sa.finish && xa.heightFt === sa.heightFt && xa.lengthFt === sa.lengthFt;
        });
        const avail  = group.filter(x => !x.isSold);
        const sample = avail[0] as any || group[0] as any;
        rows.push({
          key: k,
          finishLabel: sa.finish || '',
          h: sa.heightFt, w: sa.lengthFt,
          sqft: sa.sqft || sqftOf(sa.heightFt, sa.lengthFt),
          total: group.length, avail: avail.length,
          availSqft: r2(avail.reduce((a, x) => a + ((x as any).sqft || 0), 0)),
          landedRate: sample?.landedCostPerSqft || 0,
          sellRate:   sample?.sellingPricePerSqft || 0,
        });
      }
    });
    return rows.sort((a, b) => b.avail - a.avail);
  }, [existingSlabs]);

  return (
    <div className="space-y-5">

      {/* ── Finish selector ── */}
      <div>
        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">① Finish / Polish Type</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FINISHES.map(f => (
            <button key={f.id} type="button" onClick={() => setFinishId(f.id)}
              className={`rounded-2xl border-2 p-3 text-left transition-all active:scale-95 ${finishId === f.id ? 'border-amber-500 bg-amber-50 shadow' : 'border-slate-200 bg-white hover:border-amber-200'}`}>
              <div className="font-black text-slate-800 text-sm">{f.label}</div>
              <div className="text-amber-600 font-black text-base mt-0.5">₹{f.defaultRate}/SqFt</div>
              {finishId === f.id && <div className="text-[8px] font-black text-amber-500 uppercase mt-1">● Selected</div>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Size grid ── */}
      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">② Select Size — Tap Any Cell</div>
          <label className="flex items-center gap-2 cursor-pointer text-[9px] font-bold text-slate-500">
            Custom size
            <button type="button" onClick={() => { setUseCustom(v => !v); setSelH(null); setSelWIdx(null); }}
              className={`w-10 h-5 rounded-full relative transition-all ${useCustom ? 'bg-amber-500' : 'bg-slate-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${useCustom ? 'left-5' : 'left-0.5'}`} />
            </button>
          </label>
        </div>

        {!useCustom ? (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm bg-white">
            <table className="w-full border-collapse min-w-[480px]">
              <thead>
                <tr>
                  <th className="bg-slate-800 text-white text-left px-3 py-3 text-[9px] font-black uppercase tracking-wide whitespace-nowrap rounded-tl-2xl">Height ↓ / Width →</th>
                  {WIDTHS.map((w, wi) => (
                    <th key={wi} className={`px-2 py-3 text-center text-[9px] font-black whitespace-pre-line leading-tight ${selWIdx === wi ? 'bg-amber-500 text-white' : 'bg-slate-800 text-amber-300'}`}>
                      {w.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HEIGHTS.map((h, hi) => (
                  <tr key={h} className={hi % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'}>
                    <td className={`px-3 py-1 text-[10px] font-black whitespace-nowrap border-r border-slate-100 ${selH === h ? 'bg-amber-500 text-white' : 'text-slate-700 bg-slate-50'}`}>
                      {h} Feet
                    </td>
                    {WIDTHS.map((w, wi) => {
                      const sf     = sqftOf(h, w.ft);
                      const isSel  = selH === h && selWIdx === wi;
                      const stock  = cellStock[`${h}|${w.ft}`] || 0;
                      return (
                        <td key={wi} className="px-1 py-0.5">
                          <button type="button" onClick={() => handleCellClick(h, wi)}
                            className={`w-full rounded-xl py-2 px-1 text-center transition-all active:scale-95 relative ${
                              isSel
                                ? 'bg-amber-500 text-white shadow-lg scale-105 ring-2 ring-amber-300'
                                : stock > 0
                                  ? 'bg-emerald-50 border border-emerald-200 hover:bg-amber-50 text-emerald-800'
                                  : 'bg-white border border-slate-100 hover:bg-amber-50 hover:border-amber-200 text-slate-600'
                            }`}>
                            <div className="text-[9px] font-black">{sf.toFixed(2)}</div>
                            <div className={`text-[7px] font-bold ${isSel ? 'text-amber-100' : 'text-slate-400'}`}>Sq Ft</div>
                            {stock > 0 && !isSel && (
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-white rounded-full text-[7px] font-black flex items-center justify-center">{stock}</div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 text-[8px] text-slate-400 font-bold">Heights in feet · Widths in inches · SqFt uses rounded-foot equivalents · Green badge = stock available</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Height (Ft)</label>
              <input type="number" step="0.5" className="w-full px-3 py-3 bg-white border-2 border-amber-200 rounded-xl font-black text-base outline-none focus:border-amber-500"
                placeholder="e.g. 3.5" value={customH || ''} onChange={e => setCustomH(parseFloat(e.target.value||'0'))} />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Width (Ft)</label>
              <input type="number" step="0.25" className="w-full px-3 py-3 bg-white border-2 border-amber-200 rounded-xl font-black text-base outline-none focus:border-amber-500"
                placeholder="e.g. 1.25" value={customW || ''} onChange={e => setCustomW(parseFloat(e.target.value||'0'))} />
            </div>
            {sqft > 0 && <div className="col-span-2 text-center font-black text-amber-700 text-xl">{sqft} SqFt · {productName(finishId, activeH, activeWFt)}</div>}
          </div>
        )}
      </div>

      {/* ── Stock entry form (shows when size is selected) ── */}
      {sqft > 0 && (
        <div className="bg-slate-50 border-2 border-slate-200 rounded-[24px] p-5 space-y-4">

          {/* Selected size summary */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">③ Enter Stock Details</div>
              <div className="font-black text-slate-900 text-base mt-0.5">
                {FINISHES.find(f=>f.id===finishId)?.label} · {activeH} ft × {activeWIn}" · <span className="text-indigo-600">{sqft} SqFt/slab</span>
              </div>
              <div className="text-[9px] font-bold text-slate-500 font-mono mt-0.5">{pName}</div>
            </div>
            {availSlabs.length > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2 text-center">
                <div className="text-[8px] font-black text-emerald-500 uppercase">Current Stock</div>
                <div className="font-black text-emerald-700 text-xl">{availSlabs.length} slabs</div>
                <div className="text-[8px] text-emerald-400 font-bold">{availSqft} SqFt available</div>
              </div>
            )}
          </div>

          {/* Price + qty inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Purchase ₹/SqFt</label>
              <input type="number" step="0.5"
                className="w-full px-4 py-3.5 bg-white border-2 border-slate-200 rounded-xl font-black text-lg outline-none focus:border-amber-400 transition-all"
                placeholder="e.g. 28"
                value={buyRate || ''}
                onChange={e => setBuyRate(parseFloat(e.target.value||'0'))} />
              {buyRate > 0 && <div className="text-[8px] text-slate-500 font-bold mt-1">{INR(landedPerSlab)}/slab</div>}
            </div>
            <div>
              <label className="text-[8px] font-black text-amber-600 uppercase block mb-1.5">Selling ₹/SqFt</label>
              <input type="number" step="0.5"
                className="w-full px-4 py-3.5 bg-amber-50 border-2 border-amber-300 rounded-xl font-black text-lg text-amber-800 outline-none focus:border-amber-500 transition-all"
                placeholder="e.g. 65"
                value={sellRate || ''}
                onChange={e => setSellRate(parseFloat(e.target.value||'0'))} />
              {sellRate > 0 && <div className="text-[8px] text-amber-600 font-bold mt-1">{INR(sellingPerSlab)}/slab</div>}
            </div>
            <div>
              <label className="text-[8px] font-black text-indigo-600 uppercase block mb-1.5">No. of Slabs</label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setQty(q => Math.max(1, q-1))}
                  className="w-11 h-12 bg-white border-2 border-slate-200 rounded-xl font-black text-xl hover:bg-slate-50 flex items-center justify-center">−</button>
                <input type="number" min={1}
                  className="flex-1 px-2 py-3.5 bg-white border-2 border-indigo-200 rounded-xl font-black text-lg text-center outline-none focus:border-indigo-400"
                  value={qty}
                  onChange={e => setQty(Math.max(1, parseInt(e.target.value||'1')))} />
                <button type="button" onClick={() => setQty(q => q+1)}
                  className="w-11 h-12 bg-white border-2 border-slate-200 rounded-xl font-black text-xl hover:bg-slate-50 flex items-center justify-center">+</button>
              </div>
            </div>
            <div>
              <label className="text-[8px] font-black text-emerald-600 uppercase block mb-1.5">Margin</label>
              <div className={`h-12 rounded-xl border-2 flex flex-col items-center justify-center ${
                sellRate > 0 && buyRate > 0
                  ? marginPct >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
                  : 'bg-white border-slate-200'
              }`}>
                {sellRate > 0 && buyRate > 0 ? (
                  <>
                    <div className={`font-black text-lg ${marginPct >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{marginPct >= 0 ? '+' : ''}{marginPct}%</div>
                    <div className={`text-[8px] font-bold ${marginPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{INR(sellingPerSlab - landedPerSlab)}/slab</div>
                  </>
                ) : <div className="text-slate-300 font-black">—</div>}
              </div>
            </div>
          </div>

          {/* Total summary + Add button */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-sm font-bold text-slate-600">
              Adding <span className="font-black text-slate-900">{qty} slab{qty>1?'s':''}</span>
              {' · '}<span className="text-indigo-600 font-black">{r2(qty * sqft)} SqFt total</span>
              {buyRate > 0 && <> · Landed <span className="text-emerald-700 font-black">{INR(qty * landedPerSlab)}</span></>}
            </div>
            <button type="button" onClick={handleAdd}
              disabled={!sqft || !buyRate || qty < 1}
              className="px-8 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-40 active:scale-95 flex items-center gap-2">
              <i className="fas fa-plus-circle text-xs"></i>
              Add {qty} Slab{qty>1?'s':''} to Stock
            </button>
          </div>
        </div>
      )}

      {/* ── Stock Register ── */}
      {stockRows.length > 0 && (
        <div className="space-y-2">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Stock Register</div>
          <div className="bg-white border border-slate-100 rounded-[24px] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[540px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Product','Size','SqFt/Slab','Avail Slabs','Avail SqFt','Landed ₹/SqFt','Selling ₹/SqFt','Margin'].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stockRows.map(row => {
                    const f = FINISHES.find(f => f.label === row.finishLabel);
                    const pn = productName(f?.id || 'SP', row.h, row.w);
                    const margin = row.landedRate > 0 && row.sellRate > 0
                      ? r2(((row.sellRate - row.landedRate) / row.landedRate) * 100) : null;
                    return (
                      <tr key={row.key} className="hover:bg-amber-50/30 transition-colors">
                        <td className="px-3 py-3">
                          <div className="font-black text-slate-800 text-[11px]">{pn}</div>
                          <div className="text-[8px] text-slate-400 font-bold">{row.finishLabel}</div>
                        </td>
                        <td className="px-3 py-3 font-bold text-slate-600 whitespace-nowrap">{row.h} × {row.w} ft</td>
                        <td className="px-3 py-3">
                          <span className="font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">{row.sqft}</span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-black text-base ${row.avail > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>{row.avail}</span>
                            <span className="text-[8px] text-slate-400 font-bold">/ {row.total}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-black text-emerald-700">{row.availSqft} SqFt</td>
                        <td className="px-3 py-3 font-bold text-slate-600">{row.landedRate > 0 ? `₹${row.landedRate}` : '—'}</td>
                        <td className="px-3 py-3 font-bold text-amber-700">{row.sellRate > 0 ? `₹${row.sellRate}` : '—'}</td>
                        <td className="px-3 py-3">
                          {margin !== null
                            ? <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${margin >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>{margin >= 0 ? '+' : ''}{margin}%</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td colSpan={3} className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">
                      {existingSlabs.filter(s=>!s.isSold).length} slabs available · {existingSlabs.length} total
                    </td>
                    <td className="px-3 py-3 font-black text-emerald-700 text-sm">
                      {stockRows.reduce((a,r)=>a+r.avail,0)} slabs
                    </td>
                    <td className="px-3 py-3 font-black text-emerald-700 text-sm">
                      {r2(stockRows.reduce((a,r)=>a+r.availSqft,0))} SqFt
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KadapaManager;
