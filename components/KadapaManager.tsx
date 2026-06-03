/**
 * KadapaManager.tsx
 *
 * Unified Kadapa slab manager.
 * Works for ALL slab entry paths:
 *   1. Matrix size selection (Step 2 click → handleAdd)
 *   2. CSV file import    (server auto-generates slabs[])
 *   3. Inward batch       (addSlab in Inventory.tsx passes slabs without pricing)
 *
 * Every slab — regardless of how it was added — shows the same row with:
 *   - Editable slab number
 *   - Size, SqFt, Finish
 *   - Landed, Selling, Margin
 *   - Remove button
 *
 * Naming convention (same for all paths):
 *   Height <  5ft → SP-KDP-3ft-14in-1   DP-KDP-3ft-14in-1
 *   Height >= 5ft → DSP-KDP-5ft-23in-1  DDP-KDP-6ft-29in-1
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { store } from '../store';
import type { KadapaItemType, Slab } from '../types';

// ── Size matrix ───────────────────────────────────────────────────────────────
const HEIGHTS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];
const WIDTHS: { inches: number; label: string; ft: number }[] = [
  { inches:  9, label: '9 in\n(1 Ft)',      ft: 1    },
  { inches: 11, label: '11 in\n(1 Ft)',      ft: 1    },
  { inches: 14, label: '14 in\n(1.25 Ft)',   ft: 1.25 },
  { inches: 17, label: '17 in\n(1.5 Ft)',    ft: 1.5  },
  { inches: 23, label: '23 in\n(2 Ft)',      ft: 2    },
  { inches: 29, label: '29 in\n(2.5 Ft)',    ft: 2.5  },
];
const lookupSqft = (h: number, wIdx: number) =>
  Math.round(h * WIDTHS[wIdx].ft * 100) / 100;

// ── Helpers ───────────────────────────────────────────────────────────────────
const r2  = (n: number) => Math.round(n * 100) / 100;
const INR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// Canonical slab-number builder — same format everywhere
const FINISH_PREFIX: Record<string, { lt5: string; gte5: string }> = {
  'Single Polish':     { lt5: 'SP-KDP',  gte5: 'DSP-KDP' },
  'Double Polish':     { lt5: 'DP-KDP',  gte5: 'DDP-KDP' },
  'Big Single Polish': { lt5: 'DSP-KDP', gte5: 'DSP-KDP' },
  'Big Double Polish': { lt5: 'DDP-KDP', gte5: 'DDP-KDP' },
};
const buildSlabPrefix = (finish: string, hFt: number, wIn: number): string => {
  const fp  = FINISH_PREFIX[finish] || { lt5: 'KD-KDP', gte5: 'KD-KDP' };
  const pfx = hFt >= 5 ? fp.gte5 : fp.lt5;
  return `${pfx}-${hFt}ft-${wIn}in`;   // e.g. SP-KDP-3ft-14in
};

interface Props {
  existingSlabs: Slab[];
  onAdd:         (slabs: Slab[]) => void;
  onRemove:      (id: string) => void;
  onUpdateSlab?: (id: string, updates: Partial<Slab>) => void;
}

const KadapaManager: React.FC<Props> = ({ existingSlabs, onAdd, onRemove, onUpdateSlab }) => {
  const kadapaTypes: KadapaItemType[] = store.settings.kadapaItemTypes || [
    { id: 'ksp',  name: 'Single Polish',     ratePerSqft: 28 },
    { id: 'kdp',  name: 'Double Polish',     ratePerSqft: 35 },
    { id: 'kbsp', name: 'Big Single Polish', ratePerSqft: 45 },
    { id: 'kbdp', name: 'Big Double Polish', ratePerSqft: 55 },
  ];

  // ── Form state ────────────────────────────────────────────────────────────
  const [selH, setSelH]           = useState<number | null>(null);
  const [selWIdx, setSelWIdx]     = useState<number | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [customH, setCustomH]     = useState(0);
  const [customW, setCustomW]     = useState(0);
  const [selectedFinish, setSelectedFinish] = useState(kadapaTypes[0]?.name || '');
  const [sellingPerSqft, setSellingPerSqft] = useState(0);
  const [startSlabNo, setStartSlabNo]       = useState('');
  const [count, setCount]                   = useState(1);
  const [userTouchedSize, setUserTouchedSize] = useState(false); // tracks if user manually changed size

  // ── Sync form state whenever existingSlabs change (CSV import / inward batch) ──
  // Runs on mount and every time slabs are added/updated from any source.
  React.useEffect(() => {
    if (!existingSlabs.length) return;
    const first = existingSlabs[0] as any;
    const hFt   = first.heightFt || 0;
    const wFt   = first.lengthFt || 0;

    // ── Resolve finish ─────────────────────────────────────────────────────
    // Priority:
    //  1. slab.finish field (set by KadapaManager.handleAdd and server import)
    //  2. Product name prefix: SP_KDP_5x2 → 'Single Polish'
    //  3. Slab number prefix: SP-KDP-3ft-14in-1 → 'Single Polish'
    //  4. First kadapaType as fallback
    let fin = first.finish || '';

    // Helper: prefix → finish name
    const prefixToFinish = (pfx: string): string => {
      const p = pfx.toUpperCase();
      if (p.startsWith('DDP')) return 'Double Polish';   // DDP before DP
      if (p.startsWith('DSP')) return 'Single Polish';   // DSP before SP (big single)
      if (p.startsWith('DP'))  return 'Double Polish';
      if (p.startsWith('SP'))  return 'Single Polish';
      return '';
    };

    if (!fin) {
      // Try slab.slabNo  e.g.  "SP-KDP-3ft-14in-1"  or  "DSP-KDP-5ft-23in-1"
      if (first.slabNo) {
        fin = prefixToFinish(first.slabNo.split('-')[0] || '');
      }
    }

    // If still no finish, try to derive from the parent product name
    // Product names: SP_KDP_2x1, DSP_KDP_5x2, DP_KDP_3x1.25, DDP_KDP_6x2.5
    if (!fin) {
      const prodName = (store.products.find((p: any) => p.slabs?.some((s: any) => s.id === first.id))?.name || '');
      if (prodName) fin = prefixToFinish(prodName.split('_')[0] || '');
    }

    if (!fin) fin = kadapaTypes[0]?.name || '';

    // ── Resolve size ───────────────────────────────────────────────────────
    // Sources (in order):
    //  1. slab.heightFt / slab.lengthFt (set directly by KadapaManager or server import)
    //  2. Parse slab.slabNo: "SP-KDP-5ft-23in-1" → h=5, w=23in=1.917ft
    //  3. Parse product name: "SP_KDP_5x2" → h=5, w=2 (in feet)
    let resolvedH = hFt;
    let resolvedW = wFt; // width in feet

    if (!resolvedH || !resolvedW) {
      const noStr = first.slabNo || '';
      // Format: SP-KDP-5ft-23in-1
      const ftIn = noStr.match(/(\d+\.?\d*)ft-(\d+\.?\d*)in/);
      if (ftIn) {
        resolvedH = parseFloat(ftIn[1]);
        resolvedW = parseFloat(ftIn[2]) / 12;
      } else {
        // Format: SP_KDP_5x2 or SP-KDP-5x2 (height x widthFt)
        const xFmt = noStr.match(/(\d+\.?\d*)[x×](\d+\.?\d*)/);
        if (xFmt) { resolvedH = parseFloat(xFmt[1]); resolvedW = parseFloat(xFmt[2]); }
      }
    }

    // If slab dimensions still missing, try parsing from product size field "5x2"
    if (!resolvedH || !resolvedW) {
      const prod = store.products.find((p: any) => p.slabs?.some((s: any) => s.id === first.id));
      if (prod?.size) {
        const m = prod.size.match(/(\d+\.?\d*)[x×](\d+\.?\d*)/);
        if (m) { resolvedH = parseFloat(m[1]); resolvedW = parseFloat(m[2]); }
      }
    }

    // ── Selling price ──────────────────────────────────────────────────────
    const sellSqft = first.sellingPricePerSqft || 0;

    // ── Only update form if user hasn't manually selected a different size ──
    if (!userTouchedSize) {
      const wIdx = WIDTHS.findIndex(w => Math.abs(w.ft - resolvedW) < 0.01);
      if (wIdx >= 0 && HEIGHTS.includes(resolvedH)) {
        setSelH(resolvedH);
        setSelWIdx(wIdx);
        setUseCustom(false);
      } else if (resolvedH > 0 && resolvedW > 0) {
        setCustomH(resolvedH);
        setCustomW(resolvedW);
        setUseCustom(true);
      }
    }

    // Always update finish and selling price from slabs
    setSelectedFinish(fin);
    if (sellSqft > 0) setSellingPerSqft(sellSqft);

  }, [existingSlabs.length, existingSlabs[0]?.id]); // re-run when slab count or first slab changes

  // ── Editing state for individual slab numbers ─────────────────────────────
  const [editingSlabId, setEditingSlabId]   = useState<string | null>(null);
  const [editingSlabNo, setEditingSlabNo]   = useState('');

  // ── Derived ───────────────────────────────────────────────────────────────
  const sqft = useMemo(() => {
    if (useCustom) return r2(customH * customW);
    if (selH !== null && selWIdx !== null) return lookupSqft(selH, selWIdx);
    return 0;
  }, [useCustom, customH, customW, selH, selWIdx]);

  // Width in inches for the active selection
  const activeWIn = selWIdx !== null ? WIDTHS[selWIdx].inches : 0;

  // Canonical prefix string
  const activePrefix = useMemo(() => {
    const hFt = useCustom ? customH : (selH ?? 0);
    const wIn = useCustom ? Math.round(customW * 12) : activeWIn;
    return buildSlabPrefix(selectedFinish, hFt, wIn);
  }, [selectedFinish, selH, selWIdx, useCustom, customH, customW, activeWIn]);

  // ── Auto-slab-number ───────────────────────────────────────────────────────
  const computeNextSlabNo = useCallback((pfx: string): string => {
    const nums = existingSlabs
      .map(s => s.slabNo)
      .filter(n => n.startsWith(pfx + '-'))
      .map(n => parseInt(n.slice(pfx.length + 1)) || 0)
      .sort((a, b) => b - a);
    return `${pfx}-${(nums[0] || 0) + 1}`;
  }, [existingSlabs]);

  const refreshSlabNo = useCallback(() => {
    setStartSlabNo(computeNextSlabNo(activePrefix));
  }, [activePrefix, computeNextSlabNo]);

  // ── Finish buttons ────────────────────────────────────────────────────────
  const handleFinishChange = (name: string) => {
    setSelectedFinish(name);
    // Recompute prefix with new finish and re-suggest slab number
    const hFt = useCustom ? customH : (selH ?? 0);
    const wIn = useCustom ? Math.round(customW * 12) : activeWIn;
    if (hFt && wIn) {
      const pfx = buildSlabPrefix(name, hFt, wIn);
      setStartSlabNo(computeNextSlabNo(pfx));
    }
  };

  // ── Size cell click ───────────────────────────────────────────────────────
  const handleCellClick = (h: number, wIdx: number) => {
    setSelH(h); setSelWIdx(wIdx);
    setUserTouchedSize(true);
    const pfx = buildSlabPrefix(selectedFinish, h, WIDTHS[wIdx].inches);
    setStartSlabNo(computeNextSlabNo(pfx));
  };

  // ── Generate slab numbers ─────────────────────────────────────────────────
  const generateSlabNos = (): string[] => {
    const base  = startSlabNo.trim() || `${activePrefix}-1`;
    const match = base.match(/^(.*?)(\d+)$/);
    if (!match) return Array.from({ length: count }, (_, i) => i === 0 ? base : `${base}-${i + 1}`);
    return Array.from({ length: count }, (_, i) => `${match[1]}${parseInt(match[2]) + i}`);
  };

  // ── Costs ─────────────────────────────────────────────────────────────────
  const finishType    = kadapaTypes.find(t => t.name === selectedFinish);
  const ratePerSqft   = finishType?.ratePerSqft || 0;
  const landedPerSlab = r2(sqft * ratePerSqft);
  const sellingPerSlab = r2(sqft * sellingPerSqft);
  const marginPct      = landedPerSlab > 0 ? r2(((sellingPerSlab - landedPerSlab) / landedPerSlab) * 100) : 0;

  // ── Add slabs ─────────────────────────────────────────────────────────────
  const handleAdd = () => {
    if (!sqft || !selectedFinish) return;
    const slabNos = generateSlabNos();
    const now     = Date.now();
    const hFt = useCustom ? customH : (selH ?? 0);
    const wFt = useCustom ? customW : (selWIdx !== null ? WIDTHS[selWIdx].ft : 0);

    const newSlabs: Slab[] = slabNos.map((no, i) => {
      const isDup = existingSlabs.some(s => s.slabNo.toLowerCase() === no.toLowerCase());
      return {
        id:                  `slab-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
        slabNo:              isDup ? `${no}-dup` : no,
        heightFt: hFt, heightIn: 0,
        lengthFt: wFt, lengthIn: 0,
        sqft, isSold: false,
        finish:              selectedFinish,
        landedCost:          landedPerSlab,
        landedCostPerSqft:   ratePerSqft,
        sellingPrice:        sellingPerSlab,
        sellingPricePerSqft: sellingPerSqft,
      } as any;
    });

    onAdd(newSlabs);

    // Advance slab number
    const last  = slabNos[slabNos.length - 1];
    const m     = last.match(/^(.*?)(\d+)$/);
    if (m) setStartSlabNo(`${m[1]}${parseInt(m[2]) + 1}`);
  };

  // ── Patch existing slabs that are missing pricing (from inward batch / old import) ──
  const patchSlab = useCallback((slab: any): any => {
    // If slab has no finish or no landedCost, backfill from current form state
    const finish      = slab.finish || selectedFinish;
    const ft          = kadapaTypes.find(t => t.name === finish);
    const rate        = ft?.ratePerSqft || ratePerSqft;
    const slabSqft    = slab.sqft || r2((slab.heightFt || 0) * (slab.lengthFt || 0));
    const landed      = slab.landedCost > 0 ? slab.landedCost : r2(slabSqft * rate);
    const landedPerSq = slab.landedCostPerSqft > 0 ? slab.landedCostPerSqft : rate;
    const selling     = slab.sellingPrice > 0 ? slab.sellingPrice : r2(slabSqft * sellingPerSqft);
    const sellPerSq   = slab.sellingPricePerSqft > 0 ? slab.sellingPricePerSqft : sellingPerSqft;
    return { ...slab, finish, sqft: slabSqft, landedCost: landed, landedCostPerSqft: landedPerSq, sellingPrice: selling, sellingPricePerSqft: sellPerSq };
  }, [selectedFinish, ratePerSqft, sellingPerSqft, kadapaTypes]);

  // ── Summary ───────────────────────────────────────────────────────────────
  const summaryByFinish = useMemo(() => {
    const m: Record<string, { count: number; available: number; sqft: number; availSqft: number }> = {};
    existingSlabs.forEach(s => {
      const f = (s as any).finish || selectedFinish || 'Unknown';
      if (!m[f]) m[f] = { count: 0, available: 0, sqft: 0, availSqft: 0 };
      m[f].count++;
      const ss = (s as any).sqft || r2((s.heightFt || 0) * (s.lengthFt || 0));
      m[f].sqft += ss;
      if (!s.isSold) { m[f].available++; m[f].availSqft += ss; }
    });
    return m;
  }, [existingSlabs, selectedFinish]);

  const totalAvailSqft = r2(existingSlabs.filter(s => !s.isSold).reduce((a, s) => a + ((s as any).sqft || r2((s.heightFt || 0) * (s.lengthFt || 0))), 0));

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp = "w-full px-3 py-3 bg-white border-2 border-slate-200 rounded-xl font-black text-base outline-none focus:border-indigo-400 transition-all";
  const lbl = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

  return (
    <div className="space-y-5">

      {/* ══ Entry form ══ */}
      <div className="bg-amber-50 border-2 border-amber-100 rounded-[28px] p-5 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[9px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-2">
            <i className="fas fa-layer-group"></i> Add Kadapa Slabs
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none text-[9px] font-bold text-slate-500">
            <span>Custom size</span>
            <button type="button"
              onClick={() => { setUseCustom(v => !v); setSelH(null); setSelWIdx(null); }}
              className={`w-10 h-5 rounded-full relative transition-all ${useCustom ? 'bg-amber-500' : 'bg-slate-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${useCustom ? 'left-5' : 'left-0.5'}`} />
            </button>
          </label>
        </div>

        {/* ① Finish */}
        <div>
          <label className={lbl}>① Finish / Polish Type</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {kadapaTypes.map(t => (
              <button key={t.id} type="button" onClick={() => handleFinishChange(t.name)}
                className={`rounded-2xl border-2 p-3 text-left transition-all active:scale-95 ${selectedFinish === t.name ? 'border-amber-500 bg-white shadow-md' : 'border-slate-100 bg-white hover:border-amber-200'}`}>
                <div className="font-black text-slate-800 text-xs leading-tight">{t.name}</div>
                <div className="text-amber-600 font-black text-sm mt-0.5">₹{t.ratePerSqft}/SqFt</div>
                {selectedFinish === t.name && <div className="flex items-center gap-1 mt-1"><div className="w-1.5 h-1.5 bg-amber-500 rounded-full"/><span className="text-[8px] font-black text-amber-500 uppercase">Selected</span></div>}
              </button>
            ))}
          </div>
        </div>

        {/* ② Size */}
        {!useCustom ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className={lbl + " mb-0"}>② Select Size — tap any cell</label>
              {selH !== null && selWIdx !== null && (
                <div className="flex items-center gap-2 bg-amber-500 text-white rounded-xl px-3 py-1.5 shadow-md">
                  <i className="fas fa-check-circle text-xs"/>
                  <span className="font-black text-sm">{selH} ft × {WIDTHS[selWIdx].inches} in</span>
                  <span className="text-amber-200 font-bold text-xs">= {lookupSqft(selH, selWIdx)} SqFt</span>
                  <button type="button" onClick={() => { setSelH(null); setSelWIdx(null); }} className="text-amber-200 hover:text-white ml-1"><i className="fas fa-times text-[9px]"></i></button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto rounded-2xl border border-amber-200 shadow-sm bg-white">
              <table className="w-full min-w-[500px] border-collapse">
                <thead>
                  <tr>
                    <th className="bg-slate-800 text-white px-3 py-3 text-left text-[9px] font-black uppercase tracking-wide whitespace-nowrap rounded-tl-2xl">Height ↓ / Width →</th>
                    {WIDTHS.map((w, wIdx) => (
                      <th key={w.inches} className={`px-2 py-3 text-center text-[9px] font-black whitespace-pre-line leading-tight ${wIdx === WIDTHS.length - 1 ? 'rounded-tr-2xl' : ''} ${selWIdx === wIdx ? 'bg-amber-500 text-white' : 'bg-slate-800 text-amber-300'}`}>{w.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HEIGHTS.map((h, hIdx) => (
                    <tr key={h} className={hIdx % 2 === 0 ? 'bg-white' : 'bg-amber-50/40'}>
                      <td className={`px-3 py-0.5 font-black text-[10px] whitespace-nowrap border-r border-amber-100 ${selH === h ? 'bg-amber-500 text-white' : 'bg-slate-50 text-slate-700'}`}>{h} Feet</td>
                      {WIDTHS.map((w, wIdx) => {
                        const sf    = lookupSqft(h, wIdx);
                        const isSel = selH === h && selWIdx === wIdx;
                        const isHil = selH === h || selWIdx === wIdx;
                        return (
                          <td key={w.inches} className="px-1 py-0.5">
                            <button type="button" onClick={() => handleCellClick(h, wIdx)}
                              className={`w-full rounded-xl py-2 px-1 transition-all text-center font-black leading-none active:scale-95 ${isSel ? 'bg-amber-500 text-white shadow-lg scale-105 ring-2 ring-amber-300' : isHil ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100' : 'bg-white text-slate-600 border border-slate-100 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200'}`}>
                              <div className="text-[9px] font-black">{sf.toFixed(2)}</div>
                              <div className={`text-[7px] font-bold mt-0.5 ${isSel ? 'text-amber-100' : 'text-slate-400'}`}>Sq Ft</div>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[8px] text-slate-400 font-bold px-1">Heights in feet · Widths in inches · SqFt uses rounded-foot equivalents</div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className={lbl}>② Custom Size</label>
            <div className="grid grid-cols-3 gap-3 bg-white rounded-2xl p-4 border border-amber-100">
              <div><label className={lbl}>Height (Ft)</label><input type="number" step="0.5" className={inp} placeholder="e.g. 3.5" value={customH || ''} onChange={e => { const v = parseFloat(e.target.value||'0'); setCustomH(v); const pfx = buildSlabPrefix(selectedFinish, v, Math.round(customW*12)); setStartSlabNo(computeNextSlabNo(pfx)); }} /></div>
              <div><label className={lbl}>Width (Ft)</label><input type="number" step="0.25" className={inp} placeholder="e.g. 1.25" value={customW || ''} onChange={e => { const v = parseFloat(e.target.value||'0'); setCustomW(v); const pfx = buildSlabPrefix(selectedFinish, customH, Math.round(v*12)); setStartSlabNo(computeNextSlabNo(pfx)); }} /></div>
              <div><label className={lbl}>= SqFt</label><div className="px-3 py-3 bg-amber-50 border border-amber-100 rounded-xl font-black text-amber-700 text-lg text-center">{customH && customW ? r2(customH * customW) : '—'}</div></div>
            </div>
          </div>
        )}

        {/* ③ Pricing */}
        {sqft > 0 && (
          <div className="space-y-3">
            <label className={lbl}>③ Pricing</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-100 rounded-2xl p-3 text-center shadow-sm">
                <div className="text-[7px] font-black text-slate-400 uppercase mb-1">This Slab</div>
                <div className="text-xl font-black text-slate-900">{sqft}</div>
                <div className="text-[9px] font-bold text-indigo-600">SqFt / slab</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-center">
                <div className="text-[7px] font-black text-emerald-500 uppercase mb-1">Landed / Slab</div>
                <div className="text-xl font-black text-emerald-700">{INR(landedPerSlab)}</div>
                <div className="text-[8px] text-emerald-400">{sqft} × ₹{ratePerSqft}</div>
              </div>
              <div>
                <label className={lbl + " text-amber-600"}>Selling / SqFt (₹)</label>
                <input type="number" className="w-full px-3 py-3 bg-amber-50 border-2 border-amber-300 rounded-xl font-black text-lg text-amber-800 outline-none focus:border-amber-500 transition-all"
                  placeholder="Enter price…" value={sellingPerSqft || ''} onChange={e => setSellingPerSqft(parseFloat(e.target.value||'0'))} />
              </div>
              <div className={`rounded-2xl p-3 text-center border ${sellingPerSlab > 0 ? (marginPct >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100') : 'bg-white border-slate-100'}`}>
                <div className={`text-[7px] font-black uppercase mb-1 ${sellingPerSlab > 0 ? (marginPct >= 0 ? 'text-emerald-500' : 'text-rose-400') : 'text-slate-400'}`}>Margin</div>
                <div className={`text-xl font-black ${sellingPerSlab > 0 ? (marginPct >= 0 ? 'text-emerald-700' : 'text-rose-700') : 'text-slate-300'}`}>
                  {sellingPerSlab > 0 ? `${marginPct >= 0 ? '+' : ''}${marginPct}%` : '—'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ④ Count & Numbering */}
        {sqft > 0 && (
          <div className="space-y-2">
            <label className={lbl}>④ Slab Count & Numbering</label>

            {/* Slab number pattern info */}
            <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-[9px] font-bold text-slate-500">
              Pattern: <span className="font-black text-slate-700">{activePrefix}-N</span>
              &nbsp;·&nbsp; e.g. <span className="text-amber-600 font-black">{activePrefix}-1</span>, <span className="text-amber-600 font-black">{activePrefix}-2</span>…
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={lbl}>No. of Slabs</label>
                <input type="number" min={1} className={inp} value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value||'1')))} />
              </div>
              <div>
                <label className={lbl}>Start Slab No.</label>
                <input type="text" className={inp} value={startSlabNo} onChange={e => setStartSlabNo(e.target.value)} placeholder={`${activePrefix}-1`} />
                <button type="button" onClick={refreshSlabNo} className="mt-1 text-[8px] text-indigo-500 font-black hover:underline">↺ Auto-suggest</button>
              </div>
              <div className="md:col-span-2 flex items-end">
                <button type="button" onClick={handleAdd} disabled={!sqft || !selectedFinish}
                  className="w-full py-3.5 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-700 transition-all disabled:opacity-40 active:scale-95 flex items-center justify-center gap-2">
                  <i className="fas fa-plus-circle text-xs"></i>
                  Add {count} Slab{count > 1 ? 's' : ''}
                  {sqft > 0 && ratePerSqft > 0 && <span className="text-amber-200 font-bold normal-case ml-1">({sqft} SqFt · {INR(landedPerSlab)} each)</span>}
                </button>
              </div>
            </div>

            {/* Preview of slab numbers */}
            {count > 0 && sqft > 0 && (
              <div className="bg-slate-50 rounded-xl px-4 py-2.5 flex flex-wrap gap-1.5">
                <span className="text-[8px] font-black text-slate-400 uppercase mr-1">Will create:</span>
                {generateSlabNos().slice(0, 10).map(n => (
                  <span key={n} className="text-[8px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">#{n}</span>
                ))}
                {count > 10 && <span className="text-[8px] text-slate-400 font-bold">+{count - 10} more</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ Slab inventory list ══ */}
      {existingSlabs.length > 0 && (
        <div className="space-y-3">

          {/* Summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-100 rounded-2xl px-5 py-3 shadow-sm">
            <div>
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Slab Inventory</div>
              <div className="text-xl font-black text-slate-800 mt-0.5">
                {existingSlabs.filter(s => !s.isSold).length}
                <span className="text-slate-300 text-sm">/{existingSlabs.length}</span>
                <span className="text-[10px] font-bold text-slate-400 ml-1">available</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[8px] font-black text-emerald-500 uppercase">Available SqFt</div>
              <div className="text-xl font-black text-emerald-700">{totalAvailSqft}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summaryByFinish).map(([fin, s]) => (
                <div key={fin} className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-1.5">
                  <div className="text-[8px] font-black text-amber-600 uppercase truncate">{fin}</div>
                  <div className="text-sm font-black text-slate-800">{s.available}/{s.count} slabs</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Per-slab table with editable slab numbers ── */}
          <div className="bg-white border border-slate-100 rounded-[24px] overflow-hidden shadow-sm">
            <div className="bg-slate-800 px-5 py-3 flex items-center justify-between">
              <div className="font-black text-white text-sm">Slab Register</div>
              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Click slab# to edit · each slab has unique ID</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[620px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Sr.','Slab ID (editable)','Size (ft)','SqFt','Finish','Landed ₹','Selling ₹','Margin','Status',''].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-black text-[8px] text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {existingSlabs.map((rawSlab, idx) => {
                    const slab      = patchSlab(rawSlab as any) as any;
                    const margin    = slab.sellingPrice > 0 ? r2(((slab.sellingPrice - slab.landedCost) / (slab.landedCost || 1)) * 100) : null;
                    const isEditing = editingSlabId === slab.id;
                    return (
                      <tr key={slab.id} className={`transition-colors ${slab.isSold ? 'bg-slate-50/60 opacity-60' : 'hover:bg-amber-50/30'}`}>

                        {/* Sr no */}
                        <td className="px-3 py-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-black ${slab.isSold ? 'bg-slate-200 text-slate-400' : 'bg-amber-100 text-amber-700'}`}>{idx + 1}</div>
                        </td>

                        {/* Slab ID — editable inline */}
                        <td className="px-3 py-2.5 min-w-[160px]">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                autoFocus
                                className="w-36 px-2 py-1.5 bg-amber-50 border-2 border-amber-400 rounded-lg font-black text-xs outline-none text-amber-800"
                                value={editingSlabNo}
                                onChange={e => setEditingSlabNo(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    if (onUpdateSlab) onUpdateSlab(slab.id, { slabNo: editingSlabNo } as any);
                                    setEditingSlabId(null);
                                  }
                                  if (e.key === 'Escape') setEditingSlabId(null);
                                }}
                              />
                              <button onClick={() => { if (onUpdateSlab) onUpdateSlab(slab.id, { slabNo: editingSlabNo } as any); setEditingSlabId(null); }}
                                className="px-2 py-1.5 bg-amber-600 text-white rounded-lg font-black text-[8px] uppercase">✓</button>
                              <button onClick={() => setEditingSlabId(null)}
                                className="px-2 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-black text-[8px]">✕</button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditingSlabId(slab.id); setEditingSlabNo(slab.slabNo); }}
                              className="flex items-center gap-1.5 group cursor-pointer">
                              <span className="font-black text-slate-800 text-[11px] tracking-tight">#{slab.slabNo}</span>
                              <i className="fas fa-pencil-alt text-[8px] text-slate-300 group-hover:text-amber-500 transition-colors"></i>
                            </button>
                          )}
                        </td>

                        {/* Size */}
                        <td className="px-3 py-2.5 font-bold text-slate-600 whitespace-nowrap">{slab.heightFt} × {slab.lengthFt}</td>

                        {/* SqFt */}
                        <td className="px-3 py-2.5">
                          <span className="font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">{slab.sqft || r2((slab.heightFt||0)*(slab.lengthFt||0))}</span>
                        </td>

                        {/* Finish */}
                        <td className="px-3 py-2.5">
                          <span className="text-[8px] font-black bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full">{slab.finish || selectedFinish}</span>
                        </td>

                        {/* Landed */}
                        <td className="px-3 py-2.5 text-right">
                          <div className="font-black text-emerald-700">{slab.landedCost > 0 ? INR(slab.landedCost) : '—'}</div>
                          {slab.landedCostPerSqft > 0 && <div className="text-[7px] text-emerald-400">₹{slab.landedCostPerSqft}/sqft</div>}
                        </td>

                        {/* Selling */}
                        <td className="px-3 py-2.5 text-right">
                          <div className="font-black text-amber-700">{slab.sellingPrice > 0 ? INR(slab.sellingPrice) : '—'}</div>
                          {slab.sellingPricePerSqft > 0 && <div className="text-[7px] text-amber-400">₹{slab.sellingPricePerSqft}/sqft</div>}
                        </td>

                        {/* Margin */}
                        <td className="px-3 py-2.5 text-right">
                          {margin !== null ? (
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${margin >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                              {margin >= 0 ? '+' : ''}{margin}%
                            </span>
                          ) : <span className="text-slate-300 text-[9px]">—</span>}
                        </td>

                        {/* Status */}
                        <td className="px-3 py-2.5">
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${slab.isSold ? 'bg-rose-100 text-rose-500' : 'bg-emerald-100 text-emerald-600'}`}>
                            {slab.isSold ? 'SOLD' : 'AVAIL'}
                          </span>
                        </td>

                        {/* Remove */}
                        <td className="px-3 py-2.5">
                          {!slab.isSold && (
                            <button type="button" onClick={() => onRemove(slab.id)}
                              className="w-8 h-8 flex items-center justify-center text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all">
                              <i className="fas fa-trash-alt text-[10px]"></i>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* Footer totals */}
                {existingSlabs.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td colSpan={5} className="px-3 py-3 text-[9px] font-black text-slate-500 uppercase">
                        {existingSlabs.length} slabs · {existingSlabs.filter(s=>!s.isSold).length} available · {totalAvailSqft} SqFt
                      </td>
                      <td className="px-3 py-3 text-right font-black text-emerald-700 text-xs">
                        {INR(existingSlabs.filter(s=>!s.isSold).reduce((a,s)=>a+((s as any).landedCost||0),0))}
                      </td>
                      <td className="px-3 py-3 text-right font-black text-amber-700 text-xs">
                        {INR(existingSlabs.filter(s=>!s.isSold).reduce((a,s)=>a+((s as any).sellingPrice||0),0))}
                      </td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KadapaManager;
