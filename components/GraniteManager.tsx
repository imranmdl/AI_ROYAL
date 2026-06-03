/**
 * GraniteManager.tsx — Granite/Marble slab entry
 *
 * KEY RULES:
 *  - Slab dimensions entered in INCHES (width × height)
 *  - SqFt = (widthIn × heightIn) / 144
 *  - Each slab stores: vendorSqft (from inventory entry) — this is what vendor supplied
 *  - At sale time: user enters actual sellingSqft (may differ due to vendor margin/damage)
 *  - Profit = sellingSqft × sellingRate − vendorSqft × landedRate
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { Slab } from '../types';

// Inches → sqft  (divide by 144)
const inchesToSqft = (wIn: number, hIn: number): number =>
  Math.round((wIn * hIn) / 144 * 100) / 100;

const r2  = (n: number) => Math.round(n * 100) / 100;
const r0  = (n: number) => Math.round(n);
const fmt = (n: number) => `₹${r0(n).toLocaleString('en-IN')}`;

interface CostConfig {
  purchaseRatePerSqft: number;
  transportPct:        number;
  unloadingPerSqft:    number;
  otherChargesPerSqft: number;
  sellingPricePerSqft: number;
}

interface Props {
  existingSlabs:      Slab[];
  onAdd:              (slabs: Slab[], costConfig: CostConfig) => void;
  onRemove:           (id: string) => void;
  initialCostConfig?: Partial<CostConfig>;
}

const GraniteManager: React.FC<Props> = ({ existingSlabs, onAdd, onRemove, initialCostConfig }) => {

  // ── Step 1: Cost config ────────────────────────────────────────────────────
  const [cost, setCost] = useState<CostConfig>({
    purchaseRatePerSqft:  initialCostConfig?.purchaseRatePerSqft  || 0,
    transportPct:         initialCostConfig?.transportPct         || 0,
    unloadingPerSqft:     initialCostConfig?.unloadingPerSqft     || 0,
    otherChargesPerSqft:  initialCostConfig?.otherChargesPerSqft  || 0,
    sellingPricePerSqft:  initialCostConfig?.sellingPricePerSqft  || 0,
  });
  const setC = (k: keyof CostConfig, v: number) => setCost(c => ({ ...c, [k]: v }));

  // ── Step 2: Slab entry in INCHES ──────────────────────────────────────────
  const [slabNo,   setSlabNo]   = useState('');
  const [widthIn,  setWidthIn]  = useState<number>(0);   // width in inches
  const [heightIn, setHeightIn] = useState<number>(0);   // height in inches
  const [count,    setCount]    = useState(1);
  const [prefix,   setPrefix]   = useState('GR');

  // ── Derived values ─────────────────────────────────────────────────────────
  const landedPerSqft = useMemo(() => {
    const base      = cost.purchaseRatePerSqft;
    const transport = r2(base * (cost.transportPct / 100));
    return r2(base + transport + cost.unloadingPerSqft + cost.otherChargesPerSqft);
  }, [cost]);

  const breakdown = useMemo(() => {
    const base      = cost.purchaseRatePerSqft;
    const transport = r2(base * (cost.transportPct / 100));
    return { base, transport, unloading: cost.unloadingPerSqft, other: cost.otherChargesPerSqft };
  }, [cost]);

  // SqFt for this slab = (W" × H") ÷ 144
  const slabSqft    = widthIn && heightIn ? inchesToSqft(widthIn, heightIn) : 0;
  const slabLanded  = r2(slabSqft * landedPerSqft);
  const slabSelling = r2(slabSqft * cost.sellingPricePerSqft);
  const slabMargin  = r2(slabSelling - slabLanded);
  const marginPct   = slabLanded > 0 ? r2((slabMargin / slabLanded) * 100) : 0;

  // ── Generate slab numbers ──────────────────────────────────────────────────
  const genSlabNos = useCallback((): string[] => {
    const base = slabNo.trim() || `${prefix}-1`;
    const m    = base.match(/^(.*?)(\d+)$/);
    if (!m) return Array.from({ length: count }, (_, i) => i === 0 ? base : `${base}-${i + 1}`);
    return Array.from({ length: count }, (_, i) => `${m[1]}${parseInt(m[2]) + i}`);
  }, [slabNo, prefix, count]);

  // ── Add slabs ──────────────────────────────────────────────────────────────
  const handleAdd = () => {
    if (!widthIn || !heightIn || !slabNo.trim() || landedPerSqft <= 0) return;
    const slabNos = genSlabNos();
    const now     = Date.now();

    const newSlabs: Slab[] = slabNos.map((no, i) => ({
      id:                  `slab-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
      slabNo:              no,
      // Store dimensions in BOTH inches and feet for display flexibility
      heightFt:            r2(heightIn / 12),
      heightIn:            heightIn,              // ← actual inches from vendor
      lengthFt:            r2(widthIn / 12),
      lengthIn:            widthIn,               // ← actual inches from vendor
      sqft:                slabSqft,              // ← vendorSqft: (W" × H") / 144
      vendorSqft:          slabSqft,              // ← explicit vendor sqft field
      isSold:              false,
      landedCost:          slabLanded,
      landedCostPerSqft:   landedPerSqft,
      sellingPrice:        slabSelling,
      sellingPricePerSqft: cost.sellingPricePerSqft,
    } as any));

    onAdd(newSlabs, cost);

    // Advance slab number
    const last = slabNos[slabNos.length - 1];
    const m    = last.match(/^(.*?)(\d+)$/);
    if (m) setSlabNo(`${m[1]}${parseInt(m[2]) + 1}`);
    setWidthIn(0); setHeightIn(0);
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalAvail     = existingSlabs.filter(s => !s.isSold).length;
  const totalAvailSqft = r2(existingSlabs.filter(s => !s.isSold).reduce((a, s) => a + (s.sqft || 0), 0));

  const inp  = "w-full px-3 py-3 bg-white border-2 border-slate-200 rounded-xl font-black text-base outline-none focus:border-indigo-400 transition-all";
  const darkInp = "w-full px-3 py-3 bg-slate-800 border border-slate-700 rounded-xl font-black text-lg outline-none focus:border-amber-500 transition-all";
  const lbl  = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

  return (
    <div className="space-y-5">

      {/* ══ Step 1: Landed Cost Configuration ══ */}
      <div className="bg-slate-900 rounded-[28px] p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Step 1 — Landed Cost Configuration</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Set once · every slab's cost = vendor sqft × rate (each slab different size → different cost)</div>
          </div>
          {landedPerSqft > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl px-4 py-2.5 text-right">
              <div className="text-[8px] font-black text-amber-400 uppercase tracking-widest">Landed / SqFt</div>
              <div className="text-2xl font-black text-amber-400">₹{landedPerSqft}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`${lbl} text-slate-500`}>Purchase Rate / SqFt (₹)</label>
            <input type="number" className={`${darkInp} text-amber-400`} placeholder="e.g. 40"
              value={cost.purchaseRatePerSqft || ''} onChange={e => setC('purchaseRatePerSqft', parseFloat(e.target.value || '0'))} />
          </div>
          <div>
            <label className={`${lbl} text-slate-500`}>Transport % of purchase rate</label>
            <div className="relative">
              <input type="number" className={`${darkInp} text-indigo-400 pr-10`} placeholder="e.g. 30"
                value={cost.transportPct || ''} onChange={e => setC('transportPct', parseFloat(e.target.value || '0'))} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-black text-sm">%</span>
            </div>
            {cost.purchaseRatePerSqft > 0 && cost.transportPct > 0 && (
              <div className="text-[8px] text-indigo-400 font-bold mt-1 ml-1">= ₹{r2(cost.purchaseRatePerSqft * cost.transportPct / 100)}/SqFt</div>
            )}
          </div>
          <div>
            <label className={`${lbl} text-slate-500`}>Unloading / SqFt (₹)</label>
            <input type="number" className={`${darkInp} text-teal-400`} placeholder="0"
              value={cost.unloadingPerSqft || ''} onChange={e => setC('unloadingPerSqft', parseFloat(e.target.value || '0'))} />
          </div>
          <div>
            <label className={`${lbl} text-slate-500`}>Other Charges / SqFt (₹)</label>
            <input type="number" className={`${darkInp} text-slate-300`} placeholder="0"
              value={cost.otherChargesPerSqft || ''} onChange={e => setC('otherChargesPerSqft', parseFloat(e.target.value || '0'))} />
          </div>
        </div>

        {/* Breakdown strip */}
        {landedPerSqft > 0 && (
          <div className="bg-slate-800 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-slate-400 font-bold">₹{breakdown.base} purchase</span>
            {breakdown.transport > 0 && <><span className="text-slate-600">+</span><span className="text-indigo-400 font-bold">₹{breakdown.transport} transport</span></>}
            {breakdown.unloading > 0 && <><span className="text-slate-600">+</span><span className="text-teal-400 font-bold">₹{breakdown.unloading} unloading</span></>}
            {breakdown.other > 0 && <><span className="text-slate-600">+</span><span className="text-slate-300 font-bold">₹{breakdown.other} other</span></>}
            <span className="text-slate-600">=</span>
            <span className="font-black text-amber-400 text-base">₹{landedPerSqft} / SqFt</span>
          </div>
        )}

        {/* Selling price */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`${lbl} text-amber-400`}>Selling Price / SqFt (₹)</label>
            <input type="number" className="w-full px-3 py-3 bg-amber-900/30 border-2 border-amber-700/50 rounded-xl font-black text-amber-400 text-lg outline-none focus:border-amber-500 transition-all"
              placeholder="Enter selling price / sqft"
              value={cost.sellingPricePerSqft || ''} onChange={e => setC('sellingPricePerSqft', parseFloat(e.target.value || '0'))} />
          </div>
          {cost.sellingPricePerSqft > 0 && landedPerSqft > 0 && (
            <div className={`rounded-2xl px-4 py-3 flex flex-col justify-center ${(cost.sellingPricePerSqft - landedPerSqft) >= 0 ? 'bg-emerald-900/30 border border-emerald-700/30' : 'bg-rose-900/30 border border-rose-700/30'}`}>
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Margin / SqFt</div>
              <div className={`text-2xl font-black ${(cost.sellingPricePerSqft - landedPerSqft) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {(cost.sellingPricePerSqft - landedPerSqft) >= 0 ? '+' : ''}₹{r2(cost.sellingPricePerSqft - landedPerSqft)}
              </div>
              <div className="text-[8px] text-slate-500">per SqFt</div>
            </div>
          )}
        </div>
      </div>

      {/* ══ Step 2: Add Slabs — dimensions in INCHES ══ */}
      <div className="bg-indigo-50 border-2 border-indigo-100 rounded-[28px] p-5 sm:p-6 space-y-5">
        <div>
          <div className="text-[9px] font-black text-indigo-700 uppercase tracking-widest">Step 2 — Add Slabs</div>
          <div className="text-[10px] text-indigo-500 font-bold mt-0.5">
            Enter dimensions in <span className="font-black text-indigo-700 underline">INCHES</span> · SqFt = (Width" × Height") ÷ 144
          </div>
        </div>

        <div className="bg-white border border-indigo-100 rounded-2xl p-4 space-y-4">

          {/* Slab number row */}
          <div>
            <label className={lbl}>Slab Number</label>
            <div className="flex gap-2">
              <div className="flex-shrink-0">
                <label className="text-[7px] font-black text-slate-400 uppercase block mb-1">Prefix</label>
                <input className="w-20 px-3 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl font-black text-sm outline-none focus:border-indigo-400 transition-all text-center"
                  placeholder="GR" value={prefix} onChange={e => setPrefix(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="text-[7px] font-black text-slate-400 uppercase block mb-1">Slab No.</label>
                <input className={inp} placeholder="e.g. GR-101"
                  value={slabNo} onChange={e => setSlabNo(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Dimensions in INCHES */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={lbl}>
                Width <span className="text-indigo-600 font-black">(Inches)</span>
              </label>
              <input type="number" step="0.5" className={`${inp} focus:border-indigo-500 bg-indigo-50`}
                placeholder="e.g. 126" value={widthIn || ''}
                onChange={e => setWidthIn(parseFloat(e.target.value || '0'))} />
              {widthIn > 0 && <div className="text-[8px] text-indigo-500 font-bold mt-1 ml-1">= {r2(widthIn / 12)} ft</div>}
            </div>
            <div>
              <label className={lbl}>
                Height <span className="text-indigo-600 font-black">(Inches)</span>
              </label>
              <input type="number" step="0.5" className={`${inp} focus:border-indigo-500 bg-indigo-50`}
                placeholder="e.g. 43" value={heightIn || ''}
                onChange={e => setHeightIn(parseFloat(e.target.value || '0'))} />
              {heightIn > 0 && <div className="text-[8px] text-indigo-500 font-bold mt-1 ml-1">= {r2(heightIn / 12)} ft</div>}
            </div>
            <div>
              <label className={lbl}>No. of Slabs</label>
              <input type="number" min={1} className={inp}
                value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value || '1')))} />
              <div className="text-[8px] text-slate-400 font-bold mt-1 ml-1">same size</div>
            </div>
          </div>

          {/* Live slab preview */}
          {slabSqft > 0 && landedPerSqft > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-slate-100 pt-4">
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <div className="text-[7px] font-black text-slate-400 uppercase mb-0.5">Vendor SqFt / Slab</div>
                <div className="font-black text-slate-900 text-lg">{slabSqft}</div>
                <div className="text-[8px] text-indigo-500 font-bold">{widthIn}" × {heightIn}" ÷ 144</div>
              </div>
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <div className="text-[7px] font-black text-emerald-500 uppercase mb-0.5">Landed / Slab</div>
                <div className="font-black text-emerald-700 text-lg">{fmt(slabLanded)}</div>
                <div className="text-[8px] text-emerald-400">{slabSqft} × ₹{landedPerSqft}</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-[7px] font-black text-amber-500 uppercase mb-0.5">Selling / Slab</div>
                <div className="font-black text-amber-700 text-lg">{slabSelling > 0 ? fmt(slabSelling) : '—'}</div>
                {slabSelling > 0 && <div className="text-[8px] text-amber-400">{slabSqft} × ₹{cost.sellingPricePerSqft}</div>}
              </div>
              <div className={`rounded-xl p-3 text-center ${slabMargin >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                <div className={`text-[7px] font-black uppercase mb-0.5 ${slabMargin >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>Margin / Slab</div>
                <div className={`font-black text-lg ${slabMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {slabSelling > 0 ? `${slabMargin >= 0 ? '+' : ''}${fmt(slabMargin)}` : '—'}
                </div>
                {slabSelling > 0 && <div className={`text-[8px] font-bold ${slabMargin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{marginPct >= 0 ? '+' : ''}{marginPct}%</div>}
              </div>
            </div>
          )}

          {/* Add button */}
          <button onClick={handleAdd}
            disabled={!widthIn || !heightIn || !slabNo.trim() || landedPerSqft <= 0}
            className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-40 active:scale-95 flex items-center justify-center gap-2">
            <i className="fas fa-plus-circle text-xs"></i>
            Add {count > 1 ? `${count} Slabs` : 'Slab'}
            {slabSqft > 0 && landedPerSqft > 0 && (
              <span className="text-indigo-200 font-bold normal-case ml-1">
                ({slabSqft} SqFt · {fmt(slabLanded)} landed each)
              </span>
            )}
          </button>
          {!landedPerSqft && (
            <div className="text-[9px] text-amber-600 font-bold text-center bg-amber-50 rounded-xl py-2">
              ⚠ Complete Step 1 (landed cost) before adding slabs
            </div>
          )}
        </div>
      </div>

      {/* ══ Landed Intelligence Per Slab ══ */}
      {existingSlabs.length > 0 && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-100 rounded-2xl px-5 py-3 shadow-sm">
            <div>
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Total Stock</div>
              <div className="text-xl font-black text-slate-800 mt-0.5">
                {totalAvail}<span className="text-slate-300 text-sm">/{existingSlabs.length}</span>
                <span className="text-[10px] font-bold text-slate-400 ml-1">slabs</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[8px] font-black text-emerald-500 uppercase">Available SqFt (Vendor)</div>
              <div className="text-xl font-black text-emerald-700">{totalAvailSqft} SqFt</div>
            </div>
          </div>

          {/* Per-slab table */}
          <div className="bg-white border border-slate-100 rounded-[24px] overflow-hidden shadow-sm">
            <div className="bg-slate-800 px-5 py-3 flex items-center justify-between">
              <div className="font-black text-white text-sm">Landed Intelligence — Per Slab</div>
              <div className="text-[8px] font-black text-slate-400 uppercase">
                Dimensions in inches · SqFt = W" × H" ÷ 144
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[620px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['#','Slab No.','Width"','Height"','Vendor SqFt','Landed ₹','Selling ₹','Margin','Status',''].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {existingSlabs.map((slab, idx) => {
                    const s          = slab as any;
                    const wIn        = s.lengthIn || Math.round((s.lengthFt || 0) * 12);
                    const hIn        = s.heightIn || Math.round((s.heightFt || 0) * 12);
                    const vendorSqft = s.sqft || (wIn && hIn ? r2(wIn * hIn / 144) : 0);
                    const landed     = s.landedCost || 0;
                    const selling    = s.sellingPrice || 0;
                    const margin     = selling > 0 && landed > 0 ? r2(((selling - landed) / landed) * 100) : null;
                    return (
                      <tr key={slab.id} className={`${slab.isSold ? 'bg-slate-50/50 opacity-50' : 'hover:bg-slate-50'} transition-colors`}>
                        <td className="px-3 py-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-black ${slab.isSold ? 'bg-slate-200 text-slate-400' : 'bg-indigo-100 text-indigo-700'}`}>{idx + 1}</div>
                        </td>
                        <td className="px-3 py-2.5 font-black text-slate-800">#{slab.slabNo}</td>
                        <td className="px-3 py-2.5 font-bold text-indigo-600">{wIn || '—'}"</td>
                        <td className="px-3 py-2.5 font-bold text-indigo-600">{hIn || '—'}"</td>
                        <td className="px-3 py-2.5">
                          <span className="font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg">{vendorSqft} SqFt</span>
                          <div className="text-[7px] text-slate-400 mt-0.5">From vendor</div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="font-black text-emerald-700">{landed > 0 ? fmt(landed) : '—'}</div>
                          {s.landedCostPerSqft > 0 && <div className="text-[7px] text-emerald-400">₹{s.landedCostPerSqft}/SqFt</div>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="font-black text-amber-700">{selling > 0 ? fmt(selling) : '—'}</div>
                          {s.sellingPricePerSqft > 0 && <div className="text-[7px] text-amber-400">₹{s.sellingPricePerSqft}/SqFt</div>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {margin !== null ? (
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${margin >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                              {margin >= 0 ? '+' : ''}{margin}%
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${slab.isSold ? 'bg-rose-100 text-rose-500' : 'bg-emerald-100 text-emerald-600'}`}>
                            {slab.isSold ? 'SOLD' : 'AVAIL'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {!slab.isSold && (
                            <button onClick={() => onRemove(slab.id)}
                              className="w-8 h-8 flex items-center justify-center text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all">
                              <i className="fas fa-trash-alt text-[10px]"></i>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td colSpan={5} className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">
                      {existingSlabs.length} slabs · {totalAvail} available · {totalAvailSqft} SqFt vendor total
                    </td>
                    <td className="px-3 py-3 text-right font-black text-emerald-700 text-xs">
                      {fmt(existingSlabs.filter(s => !s.isSold).reduce((a, s) => a + ((s as any).landedCost || 0), 0))}
                    </td>
                    <td className="px-3 py-3 text-right font-black text-amber-700 text-xs">
                      {fmt(existingSlabs.filter(s => !s.isSold).reduce((a, s) => a + ((s as any).sellingPrice || 0), 0))}
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

export default GraniteManager;
