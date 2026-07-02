/**
 * UnitConfig.tsx
 *
 * Smart unit configuration panel for the inventory Add/Edit form.
 *
 * Features:
 *  - Category drives the default unit and allowed units list
 *  - Weight variants: for Bag/Pouch/Kg categories, user can define
 *    sub-units (250g, 500g, 1kg) each with their own purchase/selling price
 *  - Pricing panel adapts labels to the selected unit:
 *    "Per Box", "Per Bag", "Per Piece", "Per Litre", "Per Pouch (250g)" etc.
 *  - For sqft-based units (Box of tiles), sqft-per-unit field shown
 *  - For weight-based units, weight-per-unit field shown
 */

import React, { useEffect } from 'react';
import { store } from '../store';
import type { UnitType, UnitVariant } from '../types';

export interface UnitConfigValue {
  unitType: UnitType;
  tilesPerBox: number;       // pieces per unit (tiles in a box, pieces in a bag, etc.)
  sqftPerBox: number;        // sqft per unit (0 if not applicable)
  baseWeightGrams: number;   // grams per unit (0 if not applicable)
  unitVariants: UnitVariant[];
  purchasePrice: number;     // price per primary unit
  sellingPrice: number;      // selling price per primary unit
}

interface Props {
  category: string;
  value: UnitConfigValue;
  onChange: (v: UnitConfigValue) => void;
}

const WEIGHT_UNITS: UnitType[] = ['Bag', 'Pouch', 'Kg', 'Gram'];
const SQFT_UNITS: UnitType[]   = ['Box', 'Sft'];
const SLAB_UNITS: UnitType[]   = ['Slab'];

const DEFAULT_VARIANTS: Record<string, UnitVariant[]> = {
  'Adhesive': [
    { id: 'v250', label: '250g Pouch', weightGrams: 250,  purchasePrice: 0, sellingPrice: 0 },
    { id: 'v500', label: '500g Pouch', weightGrams: 500,  purchasePrice: 0, sellingPrice: 0 },
    { id: 'v1kg', label: '1 Kg Bag',   weightGrams: 1000, purchasePrice: 0, sellingPrice: 0 },
    { id: 'v5kg', label: '5 Kg Bag',   weightGrams: 5000, purchasePrice: 0, sellingPrice: 0 },
  ],
  'Grout': [
    { id: 'v250', label: '250g Pouch', weightGrams: 250,  purchasePrice: 0, sellingPrice: 0 },
    { id: 'v500', label: '500g Pouch', weightGrams: 500,  purchasePrice: 0, sellingPrice: 0 },
    { id: 'v1kg', label: '1 Kg Bag',   weightGrams: 1000, purchasePrice: 0, sellingPrice: 0 },
  ],
};

const UnitConfig: React.FC<Props> = ({ category, value, onChange }) => {
  const catMap = (store.settings as any).categoryUnitMap || {};
  const catConfig = catMap[category] || { defaultUnit: 'Piece', allowedUnits: ['Box','Bag','Piece','Unit','Sft','Litre','Pouch','Kg','Gram','Slab'], hasVariants: false };
  const isWeightBased = WEIGHT_UNITS.includes(value.unitType as UnitType);
  const isSqftBased   = SQFT_UNITS.includes(value.unitType as UnitType);
  const isSlabBased   = SLAB_UNITS.includes(value.unitType as UnitType);
  const hasVariants   = catConfig.hasVariants && isWeightBased;

  // Auto-set default unit when category changes
  useEffect(() => {
    if (catConfig.defaultUnit !== value.unitType && catConfig.allowedUnits.length > 0) {
      const presets = DEFAULT_VARIANTS[category] || [];
      onChange({
        ...value,
        unitType: catConfig.defaultUnit as UnitType,
        unitVariants: catConfig.hasVariants ? presets : [],
        sqftPerBox: catConfig.defaultUnit === 'Slab' ? 0 : value.sqftPerBox,
      });
    }
  }, [category]);

  const setUnit = (u: UnitType) => {
    const presets = DEFAULT_VARIANTS[category] || [];
    onChange({
      ...value,
      unitType: u,
      unitVariants: WEIGHT_UNITS.includes(u) && catConfig.hasVariants ? (value.unitVariants.length ? value.unitVariants : presets) : [],
      sqftPerBox:   SQFT_UNITS.includes(u) ? value.sqftPerBox : 0,
    });
  };

  const updateVariant = (id: string, field: keyof UnitVariant, val: string | number) => {
    onChange({
      ...value,
      unitVariants: value.unitVariants.map(v => v.id === id ? { ...v, [field]: val } : v),
    });
  };

  const addVariant = () => {
    const newV: UnitVariant = {
      id: `v-${Date.now()}`,
      label: '',
      weightGrams: 0,
      purchasePrice: 0,
      sellingPrice: 0,
    };
    onChange({ ...value, unitVariants: [...value.unitVariants, newV] });
  };

  const removeVariant = (id: string) => {
    onChange({ ...value, unitVariants: value.unitVariants.filter(v => v.id !== id) });
  };

  const inp = "w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-blue-400 transition-all";
  const lbl = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1";

  const unitLabel = (() => {
    switch (value.unitType) {
      case 'Box':   return 'Box';
      case 'Bag':   return 'Bag';
      case 'Piece': return 'Piece';
      case 'Litre': return 'Litre';
      case 'Sft':   return 'SqFt';
      case 'Slab':  return 'Slab';
      case 'Pouch': return 'Pouch';
      case 'Kg':    return 'Kg';
      case 'Gram':  return 'Gram';
      default:      return value.unitType;
    }
  })();

  return (
    <div className="space-y-4">

      {/* ── Unit type selector ──────────────────────────────────────────── */}
      <div className="bg-blue-50/60 border border-blue-100 rounded-[24px] p-4 space-y-3">
        <div className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Unit Configuration</div>

        <div className="flex flex-wrap gap-2">
          {catConfig.allowedUnits.map((u: UnitType) => (
            <button key={u} onClick={() => setUnit(u)}
              className={`px-4 py-2 rounded-full font-black text-[10px] uppercase tracking-widest transition-all
                ${value.unitType === u
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-white border border-blue-100 text-blue-500 hover:bg-blue-50'}`}>
              {u}
            </button>
          ))}
        </div>

        {/* Qty / dimension fields */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {isSqftBased && (
            <>
              <div>
                <label className={lbl}>Pieces per {unitLabel}</label>
                <input type="number" className={inp}
                  placeholder="e.g. 4"
                  value={value.tilesPerBox > 0 ? value.tilesPerBox : ''}
                  onChange={e => onChange({ ...value, tilesPerBox: parseInt(e.target.value || '0') })} />
              </div>
              <div>
                <label className={lbl}>SqFt per {unitLabel}</label>
                <input type="number" step="0.01" className={inp}
                  placeholder="e.g. 16"
                  value={value.sqftPerBox > 0 ? value.sqftPerBox : ''}
                  onChange={e => onChange({ ...value, sqftPerBox: parseFloat(e.target.value || '0') })} />
              </div>
            </>
          )}

          {isWeightBased && !hasVariants && (
            <div>
              <label className={lbl}>Weight per {unitLabel} (grams)</label>
              <input type="number" className={inp}
                placeholder="e.g. 500"
                value={value.baseWeightGrams || ''}
                onChange={e => onChange({ ...value, baseWeightGrams: parseFloat(e.target.value || '0') })} />
            </div>
          )}

          {!isWeightBased && !isSqftBased && !isSlabBased && (
            <div>
              <label className={lbl}>Qty per {unitLabel}</label>
              <input type="number" className={inp}
                placeholder="1"
                value={value.tilesPerBox || ''}
                onChange={e => onChange({ ...value, tilesPerBox: parseInt(e.target.value || '1') })} />
            </div>
          )}
        </div>
      </div>

      {/* ── Weight variants (Adhesive, Grout, etc.) ─────────────────────── */}
      {hasVariants && (
        <div className="bg-orange-50/60 border border-orange-100 rounded-[24px] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-black text-orange-500 uppercase tracking-widest">
              Weight Variants
              <span className="font-normal text-orange-400 normal-case ml-1">— e.g. 250g pouch, 500g bag, 1kg bag</span>
            </div>
            <button onClick={addVariant}
              className="text-[9px] font-black text-orange-500 hover:underline uppercase">
              + Add Variant
            </button>
          </div>

          {value.unitVariants.length === 0 && (
            <div className="text-[10px] text-orange-300 font-bold text-center py-4 border-2 border-dashed border-orange-100 rounded-2xl">
              No variants yet — click "+ Add Variant" or they'll be auto-suggested
            </div>
          )}

          <div className="space-y-2">
            {value.unitVariants.map(v => (
              <div key={v.id} className="grid grid-cols-5 gap-2 items-center bg-white rounded-2xl px-3 py-2 border border-orange-100">
                <div>
                  <label className={lbl}>Label</label>
                  <input className="w-full px-2 py-1.5 bg-orange-50 border border-orange-100 rounded-lg font-bold text-xs outline-none"
                    placeholder="e.g. 250g Pouch"
                    value={v.label}
                    onChange={e => updateVariant(v.id, 'label', e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Weight (g)</label>
                  <input type="number" className="w-full px-2 py-1.5 bg-orange-50 border border-orange-100 rounded-lg font-bold text-xs outline-none"
                    placeholder="250"
                    value={v.weightGrams || ''}
                    onChange={e => updateVariant(v.id, 'weightGrams', parseFloat(e.target.value || '0'))} />
                </div>
                <div>
                  <label className={lbl}>Purchase ₹</label>
                  <input type="number" className="w-full px-2 py-1.5 bg-orange-50 border border-orange-100 rounded-lg font-bold text-xs outline-none"
                    placeholder="0"
                    value={v.purchasePrice || ''}
                    onChange={e => updateVariant(v.id, 'purchasePrice', parseFloat(e.target.value || '0'))} />
                </div>
                <div>
                  <label className={lbl}>Selling ₹</label>
                  <input type="number" className="w-full px-2 py-1.5 bg-amber-50 border border-amber-100 rounded-lg font-bold text-xs outline-none"
                    placeholder="0"
                    value={v.sellingPrice || ''}
                    onChange={e => updateVariant(v.id, 'sellingPrice', parseFloat(e.target.value || '0'))} />
                </div>
                <div className="flex justify-end pt-4">
                  <button onClick={() => removeVariant(v.id)}
                    className="w-8 h-8 flex items-center justify-center text-rose-400 hover:bg-rose-50 rounded-xl">
                    <i className="fas fa-trash-alt text-[10px]"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {value.unitVariants.length > 0 && (
            <div className="text-[8px] text-orange-400 font-bold bg-orange-50 rounded-xl px-3 py-2">
              ℹ Each variant is sold as a separate unit. Stock is tracked in the primary unit ({unitLabel}).
              Pricing per variant is shown at POS separately.
            </div>
          )}
        </div>
      )}

      {/* ── Base pricing (non-variant) ──────────────────────────────────── */}
      {!hasVariants && !isSlabBased && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
            <label className={lbl}>Purchase Price / {unitLabel} (₹)</label>
            <input type="number" step="0.01" className="w-full bg-transparent font-black text-slate-800 text-xl outline-none"
              placeholder="0"
              value={value.purchasePrice || ''}
              onChange={e => onChange({ ...value, purchasePrice: parseFloat(e.target.value || '0') })} />
          </div>
          <div className="bg-amber-50 rounded-2xl p-3 border border-amber-100">
            <label className={lbl + " text-amber-500"}>Selling Price / {unitLabel} (₹)</label>
            <input type="number" step="0.01" className="w-full bg-transparent font-black text-amber-700 text-xl outline-none"
              placeholder="0"
              value={value.sellingPrice || ''}
              onChange={e => onChange({ ...value, sellingPrice: parseFloat(e.target.value || '0') })} />
            {value.purchasePrice > 0 && value.sellingPrice > 0 && (
              <div className={`text-[9px] font-black mt-1 ${value.sellingPrice >= value.purchasePrice ? 'text-emerald-500' : 'text-rose-500'}`}>
                Margin: {value.sellingPrice >= value.purchasePrice ? '+' : ''}₹{(value.sellingPrice - value.purchasePrice).toFixed(2)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UnitConfig;
