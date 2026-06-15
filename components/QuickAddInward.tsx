/**
 * QuickAddInward.tsx
 * ONE-SCREEN flow: create/select a product + vendor details + pricing + quantity
 * → creates/updates the inventory item AND a VendorOrder (auto-inward) in a single submit.
 *
 * Used from:
 *  - Inventory toolbar ("Add & Inward Item")
 *  - Vendor Supply Chain item picker ("+ New Product")
 */
import React, { useState, useMemo } from 'react';
import { store } from '../store';
import type { Product, VendorOrderItem } from '../types';

interface QuickAddInwardProps {
  onClose: () => void;
  /** Optional: prefill vendor name when opened from Vendor Supply Chain */
  defaultVendorName?: string;
  /** Called after successful submit with the created/updated product */
  onDone?: (product: Product) => void;
  /** Which page opened this modal — used to enforce admin item-creation restrictions */
  source?: 'inventory' | 'vendor';
}

const inp = "w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all";
const label = "text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block mb-1.5";

const QuickAddInward: React.FC<QuickAddInwardProps> = ({ onClose, defaultVendorName = '', onDone, source = 'inventory' }) => {
  const products = store.products || [];

  // ── Step 1: product — pick existing or create new ──────────────────────────
  const [mode, setMode] = useState<'existing'|'new'>('existing');
  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)).slice(0, 8);
  }, [search, products]);

  const selectedProduct = products.find(p => p.id === selectedProductId);

  // New product fields (only used when mode === 'new')
  // Size / Brand / Grade / Shade / Batch are admin-controlled registries —
  // staff pick from dropdowns, they do NOT type free text for these.
  const predefinedSizes   = store.settings.predefinedSizes   || [];
  const predefinedBrands  = store.settings.predefinedBrands  || [];
  const predefinedGrades  = store.settings.predefinedGrades  || [];
  const predefinedShades  = store.settings.predefinedShades  || [];
  const predefinedBatches = store.settings.predefinedBatches || [];

  const [newName,     setNewName]     = useState('');
  const [newCategory, setNewCategory] = useState(store.settings.categories[0] || 'Floor Tile');
  const [newBrand,    setNewBrand]    = useState(predefinedBrands[0] || '');
  const [newSize,     setNewSize]     = useState(predefinedSizes[0] || '');
  const [newUnit,     setNewUnit]     = useState<'Box'|'Slab'|'Piece'|'Bag'>('Box');
  const [newGrade,    setNewGrade]    = useState(predefinedGrades[0] || 'Premium');
  const [newShadeNo,  setNewShadeNo]  = useState(predefinedShades[0] || '');
  const [newBatchNo,  setNewBatchNo]  = useState(predefinedBatches[0] || '');

  // ── Admin access control ────────────────────────────────────────────────
  const itemCreationSource = store.settings.itemCreationSource || 'both';
  const canCreateNewHere = itemCreationSource === 'both' || itemCreationSource === source;

  // ── Step 2: vendor + pricing + quantity ─────────────────────────────────────
  const [vendorName, setVendorName] = useState(defaultVendorName);
  const [qty,         setQty]        = useState<number>(0);
  const [purchaseRate,setPurchaseRate]= useState<number>(0);
  const [sellingPrice,setSellingPrice]= useState<number>(0);
  const [invoiceNo,   setInvoiceNo]  = useState('');
  const [date,        setDate]       = useState(new Date().toISOString().slice(0,10));

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const vendors = [...new Set((store.vendorOrders||[]).map(o=>o.vendorName))].filter(Boolean).sort();

  const canSubmit = qty > 0
    && (mode === 'existing' ? !!selectedProductId : (canCreateNewHere && newName.trim().length > 0))
    && purchaseRate >= 0;

  const submit = async () => {
    setError('');
    if (qty <= 0) { setError('Enter a quantity greater than 0'); return; }
    setSaving(true);

    try {
      let product: Product;

      if (mode === 'existing') {
        product = selectedProduct!;
      } else {
        // ── Create new product ────────────────────────────────────────────────
        if (store.productExists(newName, newSize)) {
          setError(`A product named "${newName}"${newSize ? ` (${newSize})` : ''} already exists. Switch to "Use Existing" and search for it.`);
          setSaving(false);
          return;
        }
        const id = `prod-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
        product = {
          id, name: newName.trim(), category: newCategory, brand: newBrand, size: newSize,
          unitType: newUnit, isTile: true, tilesPerBox: 4, sqftPerBox: 0,
          purchasePrice: purchaseRate, sellingPrice: sellingPrice || purchaseRate,
          stockBoxes: 0, stockLoose: 0, reorderLevel: 10, status: 'Active',
          showInGallery: true, grade: newGrade as any, shadeNo: newShadeNo, batchNo: newBatchNo,
          images: [], slabs: [], adjustmentLog: [], damageHistory: [], purchaseHistory: [],
          locationStock: store.godowns.map(g=>({ godownId:g.id, boxes:0, loose:0 })),
          costPerSqft: 0, sellingPricePerSqft: 0, transportCost: 0,
          transportCostType: 'Percentage', transportBasis: 'Per Unit', otherCharges: 0,
        } as unknown as Product;
        store.addProduct(product);
      }

      // ── Build VendorOrder item — auto-inwards via store.saveVendorOrder ──────
      // Items added on the SAME DAY for the SAME VENDOR are consolidated into
      // one order (instead of creating a new duplicate order each time).
      const itemId = `item-${Date.now()}-0`;
      const actualAmount = qty * purchaseRate;
      const sp = sellingPrice || product.sellingPrice || purchaseRate;
      const margin = sp > 0 ? ((sp - purchaseRate) / sp) * 100 : 0;

      const item: VendorOrderItem = {
        id: itemId,
        productId: product.id, productName: product.name,
        category: product.category, unit: product.unitType,
        orderedQty: qty,
        billedQty: qty, billedRate: purchaseRate, billedAmount: actualAmount,
        actualQty: qty, actualRate: purchaseRate, actualAmount,
        receivedQty: qty, damagedQty: 0, goodQty: qty,
        transportShare: 0, laborShare: 0,
        landedCostPerUnit: purchaseRate,
        sellingPrice: sp, marginPct: margin,
      };

      await store.addQuickVendorItem(vendorName, date, item, {
        invoiceNo: invoiceNo || undefined,
        remarks: 'Quick Add & Inward (single-screen entry)',
      });

      // Update selling price on existing product if changed
      if (mode === 'existing' && sellingPrice > 0 && sellingPrice !== product.sellingPrice) {
        await store.updateProduct(product.id, { sellingPrice });
      }

      onDone?.(product);
      onClose();
    } catch (e:any) {
      setError(e.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[600] flex items-center justify-center p-4">
      <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-2xl overflow-hidden border-t-8 border-emerald-500 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-7 bg-slate-50 border-b flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter">Add &amp; Inward Item</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
              One screen: product · vendor · pricing · quantity — syncs to Inventory &amp; Vendor Supply Chain
            </p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-7 space-y-6 overflow-y-auto flex-1">
          {/* ── STEP 1: Product ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className={label}>Step 1 — Item</label>
              <div className="flex bg-slate-100 rounded-xl p-1">
                <button onClick={()=>setMode('existing')}
                  className={`px-4 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all ${mode==='existing'?'bg-white shadow text-slate-900':'text-slate-400'}`}>
                  Use Existing
                </button>
                <button onClick={()=>setMode('new')} disabled={!canCreateNewHere}
                  title={!canCreateNewHere ? `New item creation is restricted to the ${itemCreationSource} page` : ''}
                  className={`px-4 py-1.5 rounded-lg font-black text-[10px] uppercase transition-all flex items-center gap-1.5 ${mode==='new'?'bg-white shadow text-slate-900':'text-slate-400'} ${!canCreateNewHere?'opacity-50 cursor-not-allowed':''}`}>
                  {!canCreateNewHere && <i className="fas fa-lock text-[9px]"></i>}
                  New Item
                </button>
              </div>
            </div>

            {mode === 'existing' ? (
              <div className="space-y-2">
                <input className={inp} placeholder="Search product by name or category…"
                  value={search} onChange={e=>{ setSearch(e.target.value); setSelectedProductId(''); }} />
                {search && filtered.length > 0 && !selectedProductId && (
                  <div className="border border-slate-100 rounded-2xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {filtered.map(p=>(
                      <button key={p.id} onClick={()=>{
                        setSelectedProductId(p.id); setSearch(p.name);
                        setPurchaseRate(p.purchasePrice||0);
                        setSellingPrice(p.sellingPrice||0);
                      }} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-amber-50 transition-all text-left">
                        <div>
                          <div className="font-bold text-sm">{p.name}</div>
                          <div className="text-[9px] text-slate-400 font-bold uppercase">{p.category} · Stock: {p.stockBoxes} {p.unitType}</div>
                        </div>
                        <span className="text-emerald-600 font-black text-xs">₹{p.sellingPrice}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedProduct && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                    <i className="fas fa-check-circle text-emerald-500"></i>
                    <div className="flex-1">
                      <div className="font-black text-sm">{selectedProduct.name}</div>
                      <div className="text-[9px] text-slate-500 font-bold uppercase">{selectedProduct.category} · Current stock: {selectedProduct.stockBoxes} {selectedProduct.unitType}</div>
                    </div>
                    <button onClick={()=>{ setSelectedProductId(''); setSearch(''); }} className="text-slate-400 hover:text-rose-500"><i className="fas fa-times"></i></button>
                  </div>
                )}
                {search && filtered.length === 0 && !selectedProductId && (
                  <div className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-2xl text-amber-700 text-xs font-bold flex items-center justify-between">
                    No matching product found.
                    {canCreateNewHere ? (
                      <button onClick={()=>{ setMode('new'); setNewName(search); }} className="underline font-black">Create "{search}" as new item →</button>
                    ) : (
                      <span className="text-rose-500 text-[10px] uppercase"><i className="fas fa-lock mr-1"></i>New items: {itemCreationSource} page only</span>
                    )}
                  </div>
                )}
              </div>
            ) : !canCreateNewHere ? (
              <div className="px-4 py-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold flex items-start gap-3">
                <i className="fas fa-lock mt-0.5"></i>
                <div>
                  Creating new items is restricted to the {itemCreationSource === 'vendor' ? 'Vendor Supply Chain' : 'Inventory'} page by your administrator.
                  Please switch to "Use Existing" or create this item from {itemCreationSource === 'vendor' ? 'a Vendor Purchase Order' : 'the Inventory page'}.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className={label}>Item Name *</label><input className={inp} value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. AP_GR_STAR_BLACK" /></div>
                <div>
                  <label className={label}>Category</label>
                  <select className={inp} value={newCategory} onChange={e=>setNewCategory(e.target.value)}>
                    {store.settings.categories.map((c:string)=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Brand</label>
                  <select className={inp} value={newBrand} onChange={e=>setNewBrand(e.target.value)}>
                    <option value="">Select brand…</option>
                    {predefinedBrands.map(b=><option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Size</label>
                  <select className={inp} value={newSize} onChange={e=>setNewSize(e.target.value)}>
                    <option value="">Select size…</option>
                    {predefinedSizes.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Unit</label>
                  <select className={inp} value={newUnit} onChange={e=>setNewUnit(e.target.value as any)}>
                    {['Box','Slab','Piece','Bag'].map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Grade</label>
                  <select className={inp} value={newGrade} onChange={e=>setNewGrade(e.target.value)}>
                    {predefinedGrades.map(g=><option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Shade No</label>
                  <select className={inp} value={newShadeNo} onChange={e=>setNewShadeNo(e.target.value)}>
                    <option value="">Select shade…</option>
                    {predefinedShades.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Batch No</label>
                  <select className={inp} value={newBatchNo} onChange={e=>setNewBatchNo(e.target.value)}>
                    <option value="">Select batch…</option>
                    {predefinedBatches.map(b=><option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* ── STEP 2: Vendor + Pricing + Qty ── */}
          <div className="space-y-3">
            <label className={label}>Step 2 — Vendor, Pricing &amp; Quantity</label>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={label}>Vendor Name</label>
                <input className={inp} list="qa-vendor-list" value={vendorName} onChange={e=>setVendorName(e.target.value)} placeholder="e.g. Pradeep Suppliers" />
                <datalist id="qa-vendor-list">{vendors.map(v=><option key={v} value={v} />)}</datalist>
              </div>
              <div><label className={label}>Quantity ({mode==='new'?newUnit:selectedProduct?.unitType||'Box'})</label>
                <input type="number" className={inp} value={qty||''} onChange={e=>setQty(+e.target.value)} placeholder="100" />
              </div>
              <div><label className={label}>Purchase Rate (₹/unit)</label>
                <input type="number" className={inp} value={purchaseRate||''} onChange={e=>setPurchaseRate(+e.target.value)} placeholder="0" />
              </div>
              <div><label className={label}>Selling Price (₹/unit)</label>
                <input type="number" className={inp} value={sellingPrice||''} onChange={e=>setSellingPrice(+e.target.value)} placeholder={selectedProduct ? String(selectedProduct.sellingPrice) : '0'} />
              </div>
              <div><label className={label}>Date</label>
                <input type="date" className={inp} value={date} onChange={e=>setDate(e.target.value)} />
              </div>
              <div className="col-span-2"><label className={label}>Invoice / Ref No (optional)</label>
                <input className={inp} value={invoiceNo} onChange={e=>setInvoiceNo(e.target.value)} placeholder="INV-1234" />
              </div>
            </div>

            {/* Live summary */}
            {qty > 0 && purchaseRate >= 0 && (
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div className="bg-slate-50 rounded-2xl px-4 py-3">
                  <div className="text-[9px] font-black text-slate-400 uppercase">Total Cost</div>
                  <div className="font-black text-sm text-amber-600">₹{(qty*purchaseRate).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-slate-50 rounded-2xl px-4 py-3">
                  <div className="text-[9px] font-black text-slate-400 uppercase">New Stock</div>
                  <div className="font-black text-sm text-slate-900">{(selectedProduct?.stockBoxes||0) + qty} {mode==='new'?newUnit:selectedProduct?.unitType||'Box'}</div>
                </div>
                <div className="bg-slate-50 rounded-2xl px-4 py-3">
                  <div className="text-[9px] font-black text-slate-400 uppercase">Margin</div>
                  <div className={`font-black text-sm ${sellingPrice>purchaseRate?'text-emerald-600':'text-rose-600'}`}>
                    {sellingPrice>0 ? (((sellingPrice-purchaseRate)/sellingPrice)*100).toFixed(1)+'%' : '—'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="px-4 py-3 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold">
              <i className="fas fa-exclamation-circle mr-2"></i>{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-7 border-t bg-slate-50 shrink-0">
          <button onClick={submit} disabled={!canSubmit || saving}
            className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl active:scale-95 disabled:opacity-40 flex items-center justify-center gap-3">
            {saving
              ? <><i className="fas fa-spinner fa-spin"></i> Saving…</>
              : <><i className="fas fa-bolt"></i> Save &amp; Inward — Updates Inventory + Vendor Tracking</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickAddInward;
