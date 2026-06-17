/**
 * SlabInwardModal.tsx
 * ─────────────────────────────────────────────────────────────────────────
 * Dedicated slab inward modal for Kadapa / Granite / Marble items.
 * Used from Vendor Supply Chain → Items tab.
 *
 * This is completely SEPARATE from QuickAddInward (which only handles
 * tile/box products). It:
 *  • Lets user pick an existing slab product OR create a new one
 *  • Asks for dimensions (height ft × width ft) + finish type
 *  • Asks for number of slabs to inward
 *  • Auto-generates slab numbers matching KadapaManager format exactly
 *  • Updates the product's slab[] array + stockBoxes (unsold slab count)
 *  • Returns the product to the caller so it can be added as a VendorOrder item
 *
 * Does NOT call saveVendorOrder internally — the caller (VendorSupplyChain)
 * adds it as a line item and saves the full order.
 */
import React, { useState, useMemo } from 'react';
import { store } from '../store';
import type { Product } from '../types';

const SLAB_CATS = ['Kadapa', 'Granite', 'Marble'];

const KADAPA_PREFIX: Record<string, string> = {
  'Single Polish': 'SP', 'Double Polish': 'DP',
  'Big Single Polish': 'DSP', 'Big Double Polish': 'DDP',
};

interface Props {
  onClose: () => void;
  defaultVendorName?: string;
  /** Called when slabs are inwarded — passes back the updated product + slab metadata */
  onDone: (product: Product, slabCount: number, sqftPerSlab: number, costPerSqft: number, sellingPerSqft: number) => void;
}

const inp  = "w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl font-bold text-sm text-white outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition-all placeholder:text-slate-500";
const lbl  = "text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

const r2 = (n: number) => Math.round(n * 100) / 100;

const SlabInwardModal: React.FC<Props> = ({ onClose, defaultVendorName = '', onDone }) => {
  const products = (store.products || []).filter(p => SLAB_CATS.includes(p.category || ''));

  // ── Mode: pick existing or create new ─────────────────────────────────
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');

  // New product fields
  const [newCategory, setNewCategory] = useState<'Kadapa' | 'Granite' | 'Marble'>('Kadapa');
  const [newName, setNewName] = useState('');
  const [newBrand, setNewBrand] = useState('');

  // Slab dimensions (shared for both existing and new)
  const [heightFt,   setHeightFt]   = useState<number>(0);
  const [widthFt,    setWidthFt]    = useState<number>(0);
  const [finish,     setFinish]     = useState('Single Polish');
  const [slabCount,  setSlabCount]  = useState<number>(1);
  const [costPerSqft, setCostPerSqft] = useState<number>(0);
  const [sellingPerSqft, setSellingPerSqft] = useState<number>(0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return products.slice(0, 12);
    const q = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [search, products]);

  const selectedProduct = products.find(p => p.id === selectedProductId);

  // Auto-fill dimensions from selected product
  const onSelectProduct = (p: Product) => {
    setSelectedProductId(p.id);
    setSearch(p.name);
    // Try to extract dimensions from product
    const h = (p as any).slabHeightFt || (p.slabs?.[0] as any)?.heightFt || 0;
    const w = (p as any).slabLengthFt || (p.slabs?.[0] as any)?.lengthFt || 0;
    if (h) setHeightFt(h);
    if (w) setWidthFt(w);
    const finishVal = (p as any).kadapaType || (p.slabs?.[0] as any)?.finish || 'Single Polish';
    setFinish(finishVal);
    if (p.costPerSqft) setCostPerSqft(p.costPerSqft);
    if (p.sellingPricePerSqft) setSellingPerSqft(p.sellingPricePerSqft);
  };

  // Derived values
  const sqftPerSlab = heightFt && widthFt ? r2(heightFt * widthFt) : 0;
  const totalSqft   = r2(sqftPerSlab * slabCount);
  const totalCost   = r2(totalSqft * costPerSqft);
  const totalSelling = r2(totalSqft * sellingPerSqft);
  const margin = sellingPerSqft > costPerSqft ? r2(((sellingPerSqft - costPerSqft) / sellingPerSqft) * 100) : 0;

  // Generate slab numbers preview
  const slabBase = useMemo(() => {
    if (!heightFt || !widthFt) return '';
    const cat = mode === 'new' ? newCategory : selectedProduct?.category || 'Kadapa';
    const pfx = cat === 'Kadapa' ? (KADAPA_PREFIX[finish] || 'SP') : 'GR';
    const widthIn = Math.round(widthFt * 12);
    return `${pfx}-${heightFt}ft-${widthIn}in`;
  }, [heightFt, widthFt, finish, mode, newCategory, selectedProduct]);

  const existingMaxNum = useMemo(() => {
    if (!slabBase || !selectedProduct?.slabs) return 0;
    return (selectedProduct.slabs as any[]).filter(s => (s.slabNo || '').startsWith(slabBase))
      .reduce((m, s) => Math.max(m, parseInt((s.slabNo || '').split('-').pop() || '0') || 0), 0);
  }, [slabBase, selectedProduct]);

  const slabPreview = slabBase && slabCount > 0
    ? Array.from({ length: Math.min(slabCount, 5) }, (_, i) => `${slabBase}-${existingMaxNum + i + 1}`)
    : [];

  const autoName = useMemo(() => {
    if (mode !== 'new' || !heightFt || !widthFt) return newName;
    const cat = newCategory;
    const pfx = cat === 'Kadapa' ? (KADAPA_PREFIX[finish] || 'SP') : 'GR';
    return `${pfx}_${cat === 'Kadapa' ? 'KDP' : cat === 'Granite' ? 'GRN' : 'MBL'}_${heightFt}x${widthFt}`;
  }, [mode, newCategory, finish, heightFt, widthFt, newName]);

  const canSubmit = slabCount > 0 && heightFt > 0 && widthFt > 0 && costPerSqft > 0 &&
    (mode === 'existing' ? !!selectedProductId : true);

  const handleSubmit = async () => {
    setError('');
    setSaving(true);
    try {
      const now = Date.now();
      const landedPerSlab  = r2(sqftPerSlab * costPerSqft);
      const sellingPerSlab = r2(sqftPerSlab * sellingPerSqft);
      const widthIn = Math.round(widthFt * 12);
      const heightIn = Math.round(heightFt * 12);

      // Generate new slab objects
      const newSlabs = Array.from({ length: slabCount }, (_, i) => ({
        id:                  `slab-vendor-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
        slabNo:              `${slabBase}-${existingMaxNum + i + 1}`,
        heightFt, heightIn, lengthFt: widthFt, lengthIn: widthIn,
        sqft: sqftPerSlab,
        isSold: false,
        finish,
        landedCost:          landedPerSlab,
        landedCostPerSqft:   costPerSqft,
        sellingPrice:        sellingPerSlab,
        sellingPricePerSqft: sellingPerSqft,
      }));

      let product: Product;

      if (mode === 'existing' && selectedProduct) {
        // Append to existing product
        const existingSlabs = (selectedProduct.slabs || []) as any[];
        const mergedSlabs = [...existingSlabs, ...newSlabs];
        const unsoldCount = mergedSlabs.filter((s: any) => !s.isSold).length;
        const updated: Partial<Product> = {
          slabs: mergedSlabs,
          stockBoxes: unsoldCount,
          sqftPerBox: sqftPerSlab,
          purchasePrice: landedPerSlab,
          costPerSqft,
          sellingPricePerSqft: sellingPerSqft,
          sellingPrice: sellingPerSlab,
          totalCostPerUnit: costPerSqft,
          slabHeightFt: heightFt, slabLengthFt: widthFt,
          kadapaType: selectedProduct.category === 'Kadapa' ? finish as any : undefined,
          updatedAt: now,
        };
        await store.updateProduct(selectedProduct.id, updated);
        product = { ...selectedProduct, ...updated } as Product;
      } else {
        // Create new product
        const cat = newCategory;
        const pfx = cat === 'Kadapa' ? (KADAPA_PREFIX[finish] || 'SP') : 'GR';
        const finalName = newName.trim() || autoName;
        const prodId = `prod-${now}-${Math.random().toString(36).substr(2, 6)}`;
        product = {
          id: prodId, name: finalName, category: cat, brand: newBrand,
          size: `${heightFt}x${widthFt}`,
          unitType: 'Slab', tilesPerBox: 1, sqftPerBox: sqftPerSlab,
          purchasePrice: landedPerSlab, sellingPrice: sellingPerSlab,
          costPerSqft, sellingPricePerSqft: sellingPerSqft,
          totalCostPerUnit: costPerSqft,
          slabs: newSlabs, slabHeightFt: heightFt, slabLengthFt: widthFt,
          kadapaType: cat === 'Kadapa' ? finish as any : undefined,
          stockBoxes: slabCount, stockLoose: 0,
          reorderLevel: 5, status: 'Active', showInGallery: true,
          grade: 'Premium', shadeNo: '', batchNo: '',
          isTile: true, transportCost: 0, otherCharges: 0,
          transportCostType: 'Percentage', transportBasis: 'Per Unit',
          images: [], adjustmentLog: [], damageHistory: [], purchaseHistory: [],
          locationStock: store.godowns.map((g, i) => ({ godownId: g.id, boxes: i===0 ? slabCount : 0, loose: 0 })),
          updatedAt: now,
        } as unknown as Product;
        store.addProduct(product);
      }

      onDone(product, slabCount, sqftPerSlab, costPerSqft, sellingPerSqft);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const catColors: Record<string, string> = {
    Kadapa: 'border-amber-500/40 bg-amber-500/5',
    Granite: 'border-purple-500/40 bg-purple-500/5',
    Marble: 'border-blue-500/40 bg-blue-500/5',
  };
  const catBadge: Record<string, string> = {
    Kadapa: 'bg-amber-500/20 text-amber-400',
    Granite: 'bg-purple-500/20 text-purple-400',
    Marble: 'bg-blue-500/20 text-blue-400',
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[650] flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-[40px] shadow-2xl w-full max-w-2xl border-t-8 border-amber-500 max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-7 border-b border-white/10 flex justify-between items-start shrink-0">
          <div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white flex items-center gap-2">
              <i className="fas fa-layer-group text-amber-400"></i> Slab Inward
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
              Kadapa · Granite · Marble — generates slab numbers automatically
            </p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 text-slate-400 hover:text-white flex items-center justify-center">
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-7 space-y-6">

          {/* Step 1 — Product */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className={lbl}>Step 1 — Product</label>
              <div className="flex bg-white/5 rounded-xl p-1 gap-1">
                <button onClick={() => setMode('existing')}
                  className={`px-4 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${mode==='existing'?'bg-amber-500/30 text-amber-400':'text-slate-400 hover:text-white'}`}>
                  Existing
                </button>
                <button onClick={() => setMode('new')}
                  className={`px-4 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${mode==='new'?'bg-amber-500/30 text-amber-400':'text-slate-400 hover:text-white'}`}>
                  New Product
                </button>
              </div>
            </div>

            {mode === 'existing' ? (
              <div className="space-y-2">
                <input className={inp} placeholder="Search Kadapa / Granite / Marble items…"
                  value={search} onChange={e => { setSearch(e.target.value); setSelectedProductId(''); }} />
                {!selectedProductId && filtered.length > 0 && (
                  <div className="border border-white/10 rounded-2xl divide-y divide-white/5 max-h-48 overflow-y-auto">
                    {filtered.map(p => (
                      <button key={p.id} onClick={() => onSelectProduct(p)}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-amber-500/10 transition-all text-left">
                        <div>
                          <div className="text-white font-bold text-sm">{p.name}</div>
                          <div className="text-[9px] text-slate-400 font-bold uppercase">
                            {p.category} · {(p.slabs||[]).filter((s:any)=>!s.isSold).length} slabs in stock
                          </div>
                        </div>
                        <span className={`text-[9px] font-black px-2 py-1 rounded-lg ${catBadge[p.category||''] || 'bg-white/10 text-slate-400'}`}>{p.category}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedProduct && (
                  <div className={`flex items-center gap-3 px-4 py-3 border rounded-2xl ${catColors[selectedProduct.category||''] || ''}`}>
                    <i className="fas fa-check-circle text-amber-400"></i>
                    <div className="flex-1">
                      <div className="text-white font-black text-sm">{selectedProduct.name}</div>
                      <div className="text-[9px] text-slate-400 font-bold uppercase">
                        {selectedProduct.category} · {(selectedProduct.slabs||[]).filter((s:any)=>!s.isSold).length} slabs in stock
                      </div>
                    </div>
                    <button onClick={() => { setSelectedProductId(''); setSearch(''); }} className="text-slate-500 hover:text-rose-400">
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Category</label>
                  <select className={inp} value={newCategory} onChange={e => setNewCategory(e.target.value as any)}>
                    <option value="Kadapa">Kadapa</option>
                    <option value="Granite">Granite</option>
                    <option value="Marble">Marble</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Brand (optional)</label>
                  <input className={inp} value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="e.g. Local Quarry" />
                </div>
                <div className="col-span-2">
                  <label className={lbl}>Product Name (auto-generated if blank)</label>
                  <input className={inp} value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder={autoName || 'e.g. SP_KDP_6.5x1 (auto-fills from dimensions)'} />
                </div>
              </div>
            )}
          </div>

          {/* Step 2 — Slab Dimensions */}
          <div className="space-y-3">
            <label className={lbl}>Step 2 — Slab Dimensions & Finish</label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lbl}>Height (Ft)</label>
                <input type="number" step="0.1" className={inp} value={heightFt||''} onChange={e => setHeightFt(+e.target.value)} placeholder="e.g. 6.5" />
              </div>
              <div>
                <label className={lbl}>Width (Ft)</label>
                <input type="number" step="0.01" className={inp} value={widthFt||''} onChange={e => setWidthFt(+e.target.value)} placeholder="e.g. 1, 1.25" />
              </div>
              <div>
                <label className={lbl}>SqFt / Slab</label>
                <div className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-amber-400 font-black text-sm">
                  {sqftPerSlab > 0 ? sqftPerSlab : '—'}
                </div>
              </div>
            </div>
            <div>
              <label className={lbl}>Finish Type</label>
              <select className={inp} value={finish} onChange={e => setFinish(e.target.value)}>
                <option value="Single Polish">Single Polish (SP)</option>
                <option value="Double Polish">Double Polish (DP)</option>
                <option value="Big Single Polish">Big Single Polish (DSP)</option>
                <option value="Big Double Polish">Big Double Polish (DDP)</option>
                {(mode === 'existing' ? selectedProduct?.category : newCategory) !== 'Kadapa' && (
                  <option value="Natural">Natural (GR)</option>
                )}
              </select>
            </div>
          </div>

          {/* Step 3 — Pricing & Stock */}
          <div className="space-y-3">
            <label className={lbl}>Step 3 — Pricing & Number of Slabs</label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lbl}>No. of Slabs</label>
                <input type="number" min="1" step="1" className={inp} value={slabCount||''} onChange={e => setSlabCount(Math.max(1, Math.floor(+e.target.value)))} placeholder="10" />
              </div>
              <div>
                <label className={lbl}>Purchase Rate (₹/SqFt)</label>
                <input type="number" className={inp} value={costPerSqft||''} onChange={e => setCostPerSqft(+e.target.value)} placeholder="e.g. 28" />
              </div>
              <div>
                <label className={lbl}>Selling Price (₹/SqFt)</label>
                <input type="number" className={inp} value={sellingPerSqft||''} onChange={e => setSellingPerSqft(+e.target.value)} placeholder="e.g. 65" />
              </div>
            </div>
          </div>

          {/* Live Preview */}
          {sqftPerSlab > 0 && slabCount > 0 && costPerSqft > 0 && (
            <div className="bg-slate-800 rounded-2xl p-5 space-y-4">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Summary Preview</div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white/5 rounded-xl p-3">
                  <div className="text-[9px] text-slate-400 font-black uppercase mb-1">Total SqFt</div>
                  <div className="text-amber-400 font-black">{totalSqft} sqft</div>
                </div>
                <div className="bg-white/5 rounded-xl p-3">
                  <div className="text-[9px] text-slate-400 font-black uppercase mb-1">Total Cost</div>
                  <div className="text-rose-400 font-black">₹{totalCost.toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-white/5 rounded-xl p-3">
                  <div className="text-[9px] text-slate-400 font-black uppercase mb-1">Margin</div>
                  <div className={`font-black ${margin >= 20 ? 'text-emerald-400' : margin >= 10 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {margin > 0 ? `${margin}%` : '—'}
                  </div>
                </div>
              </div>

              {/* Slab number preview */}
              {slabBase && (
                <div>
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Slab Numbers ({existingMaxNum > 0 ? `continuing from ${existingMaxNum}` : 'starting from 1'})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {slabPreview.map(s => (
                      <span key={s} className="px-2 py-1 bg-amber-500/20 text-amber-400 rounded-lg text-[9px] font-black">{s}</span>
                    ))}
                    {slabCount > 5 && (
                      <span className="px-2 py-1 bg-white/10 text-slate-400 rounded-lg text-[9px] font-black">
                        … {slabBase}-{existingMaxNum + slabCount}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="px-4 py-3 bg-rose-500/20 border border-rose-500/30 rounded-2xl text-rose-400 text-xs font-bold">
              <i className="fas fa-exclamation-circle mr-2"></i>{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-7 border-t border-white/10 shrink-0">
          <button onClick={handleSubmit} disabled={!canSubmit || saving}
            className="w-full py-5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white rounded-3xl font-black text-sm uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-3">
            {saving
              ? <><i className="fas fa-spinner fa-spin"></i> Saving slabs…</>
              : <><i className="fas fa-layer-group"></i> Inward {slabCount > 0 ? slabCount : '—'} Slabs — Auto-Number &amp; Update Stock</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SlabInwardModal;
