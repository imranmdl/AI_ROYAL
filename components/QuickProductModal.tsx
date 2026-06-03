
import React, { useState, useMemo, useEffect } from 'react';
import { store } from '../store';
import { Product, Category, UnitType, TileGrade, TransportCostType, TransportBasis, Slab } from '../types';

interface QuickProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (productId: string) => void;
}

const QuickProductModal: React.FC<QuickProductModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState<'details' | 'stock'>('details');
  const [categories, setCategories] = useState<string[]>(store.settings.categories || []);
  const [productForm, setProductForm] = useState<Partial<Product & { bulkCount: number; bulkNames: string[]; graniteName: string }>>({
    name: '', category: store.settings.categories[0] || 'Floor Tile', brand: '', isTile: true, unitType: 'Box',
    size: '600x1200 mm', tilesPerBox: 4, sqftPerBox: 16, purchasePrice: 0, 
    slabHeightFt: 0, slabHeightIn: 0, slabLengthFt: 0, slabLengthIn: 0, costPerSqft: 0, sellingPricePerSqft: 0,
    transportCost: 0, transportCostType: 'Percentage', transportBasis: 'Per Unit', 
    otherCharges: 0, sellingPrice: 0, reorderLevel: 10, images: [], status: 'Active',
    grade: 'Premium', shadeNo: '', batchNo: '',
    bulkCount: 1, bulkNames: [''],
    slabs: [],
    kadapaType: 'Single Polish',
    graniteName: ''
  });

  const [inwardForm, setInwardForm] = useState({
    qtyBoxes: 0,
    rate: 0,
    vendorName: 'Direct Inward',
    vehicleNumber: '',
    godownId: 'g1',
    date: new Date().toISOString().split('T')[0]
  });

  const grades: TileGrade[] = ['Premium', 'Standard', 'Commercial', 'Budget'];

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setCategories([...(store.settings.categories || [])]);
    });
    return unsubscribe;
  }, []);

  const calculatedLandedCost = useMemo(() => {
    const base = productForm.purchasePrice || 0;
    const transVal = productForm.transportCost || 0;
    const other = productForm.otherCharges || 0;
    const sqft = productForm.sqftPerBox || 1;
    let transportAmount = 0;
    if (productForm.transportCostType === 'Percentage') transportAmount = (base * transVal) / 100;
    else transportAmount = productForm.transportBasis === 'Per Sft' ? transVal * sqft : transVal;
    
    return base + transportAmount + other;
  }, [productForm]);

  // Auto-generate names for Kadapa/Granite
  useEffect(() => {
    if (productForm.category === 'Kadapa' && productForm.kadapaType && productForm.size) {
      const dimensions = productForm.size.split(/[x*]/);
      const isBig = dimensions.some(d => {
        const val = parseFloat(d.trim());
        return !isNaN(val) && val >= 5.5;
      });
      const prefix = productForm.kadapaType === 'Single Polish' ? 'SP' : 'DP';
      const bigPrefix = isBig ? 'Big ' : '';
      const generatedName = `${bigPrefix}${productForm.kadapaType} ${prefix}_KDP_${productForm.size}`;
      if (productForm.name !== generatedName) setProductForm(prev => ({ ...prev, name: generatedName }));
    }
  }, [productForm.category, productForm.kadapaType, productForm.size]);

  useEffect(() => {
    if (productForm.category === 'Granite' && productForm.graniteName && productForm.size) {
      const generatedName = `${productForm.graniteName}_${productForm.size}`;
      if (productForm.name !== generatedName) setProductForm(prev => ({ ...prev, name: generatedName }));
    }
  }, [productForm.category, productForm.graniteName, productForm.size]);

  // Slab logic
  useEffect(() => {
    if (productForm.category === 'Kadapa' || productForm.category === 'Granite' || productForm.category === 'Marble') {
      const hFt = productForm.slabHeightFt || 0;
      const hIn = productForm.slabHeightIn || 0;
      const lFt = productForm.slabLengthFt || 0;
      const lIn = productForm.slabLengthIn || 0;
      const costPerSqft = productForm.costPerSqft || 0;
      const sellingPricePerSqft = productForm.sellingPricePerSqft || 0;

      const totalHeight = hFt + (hIn / 12);
      const totalLength = lFt + (lIn / 12);
      const areaPerPiece = totalHeight * totalLength;
      const unitSqft = areaPerPiece > 0 ? areaPerPiece : 1;
      
      const unitCost = unitSqft * costPerSqft;
      const unitSelling = unitSqft * sellingPricePerSqft;

      const roundedSqft = parseFloat(unitSqft.toFixed(2));
      const roundedCost = parseFloat(unitCost.toFixed(2));
      const roundedSelling = parseFloat(unitSelling.toFixed(2));

      if (productForm.unitType !== 'Slab' || productForm.sqftPerBox !== roundedSqft || productForm.purchasePrice !== roundedCost || productForm.sellingPrice !== roundedSelling) {
        setProductForm(prev => ({
          ...prev,
          unitType: 'Slab',
          sqftPerBox: roundedSqft,
          purchasePrice: roundedCost,
          sellingPrice: roundedSelling,
          tilesPerBox: 1
        }));
      }
    }
  }, [productForm.category, productForm.slabHeightFt, productForm.slabHeightIn, productForm.slabLengthFt, productForm.slabLengthIn, productForm.costPerSqft, productForm.sellingPricePerSqft]);

  const handleCreateAndInward = () => {
    if (!productForm.name) return;

    const productId = `prod-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const isSlabProduct = (productForm.category === 'Kadapa' || productForm.category === 'Granite' || productForm.category === 'Marble');
    
    const finalProduct: Product = {
      ...productForm,
      id: productId,
      totalCostPerUnit: calculatedLandedCost,
      stockBoxes: 0,
      stockLoose: 0,
      damagedPieces: 0,
      status: 'Active',
      images: productForm.images?.length ? productForm.images : ['https://images.unsplash.com/photo-1517646331032-9e8563c520a1?auto=format&fit=crop&q=80&w=1000'],
      locationStock: store.godowns.map(g => ({ godownId: g.id, boxes: 0, loose: 0 })),
      damageHistory: [],
      purchaseHistory: [],
      adjustmentLog: []
    } as Product;

    store.addProduct(finalProduct);

    // If stock is provided, inward it
    if (inwardForm.qtyBoxes > 0) {
      store.addPurchase({
        id: `pur-${Date.now()}`,
        vendorName: inwardForm.vendorName,
        vehicleNumber: inwardForm.vehicleNumber,
        gstInvoiceNo: 'QUICK-INWARD',
        date: inwardForm.date,
        godownId: inwardForm.godownId,
        items: [{
          productId: productId,
          productName: finalProduct.name,
          qtyBoxes: inwardForm.qtyBoxes,
          rate: inwardForm.rate || productForm.purchasePrice || 0
        }]
      });
    }

    onSuccess(productId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden animate-in zoom-in duration-300 my-8">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic">Quick Item Provisioning</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Create & Inward in Single Transaction</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-8 space-y-8">
          {/* Step Indicator */}
          <div className="flex items-center gap-4">
            <div className={`flex-1 h-1.5 rounded-full transition-all ${step === 'details' ? 'bg-amber-500' : 'bg-slate-100'}`}></div>
            <div className={`flex-1 h-1.5 rounded-full transition-all ${step === 'stock' ? 'bg-amber-500' : 'bg-slate-100'}`}></div>
          </div>

          {step === 'details' ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Category</label>
                  <select 
                    className="w-full px-5 py-4 bg-slate-50 rounded-2xl border-2 border-slate-50 focus:border-amber-500 outline-none font-bold text-sm appearance-none"
                    value={productForm.category}
                    onChange={e => setProductForm({...productForm, category: e.target.value as Category})}
                  >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Brand</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Kajaria, Somany"
                    className="w-full px-5 py-4 bg-slate-50 rounded-2xl border-2 border-slate-50 focus:border-amber-500 outline-none font-bold text-sm"
                    value={productForm.brand}
                    onChange={e => setProductForm({...productForm, brand: e.target.value})}
                  />
                </div>
              </div>

              {productForm.category === 'Kadapa' ? (
                <div className="grid grid-cols-2 gap-4 p-4 bg-indigo-50 rounded-3xl border border-indigo-100">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest px-1">Kadapa Type</label>
                    <select className="w-full px-4 py-3 bg-white rounded-xl border-0 font-bold text-sm outline-none" value={productForm.kadapaType} onChange={e => setProductForm({...productForm, kadapaType: e.target.value as any})}>
                      <option value="Single Polish">Single Polish (SP)</option>
                      <option value="Double Polish">Double Polish (DP)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest px-1">Size (ft)</label>
                    <input type="text" placeholder="e.g. 2x2, 5x2.5" className="w-full px-4 py-3 bg-white rounded-xl border-0 font-bold text-sm outline-none" value={productForm.size} onChange={e => setProductForm({...productForm, size: e.target.value})} />
                  </div>
                </div>
              ) : productForm.category === 'Granite' ? (
                <div className="grid grid-cols-2 gap-4 p-4 bg-amber-50 rounded-3xl border border-amber-100">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest px-1">Granite Name</label>
                    <input type="text" placeholder="e.g. Black Galaxy" className="w-full px-4 py-3 bg-white rounded-xl border-0 font-bold text-sm outline-none" value={productForm.graniteName} onChange={e => setProductForm({...productForm, graniteName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest px-1">Size (ft)</label>
                    <input type="text" placeholder="e.g. 10x3" className="w-full px-4 py-3 bg-white rounded-xl border-0 font-bold text-sm outline-none" value={productForm.size} onChange={e => setProductForm({...productForm, size: e.target.value})} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Item Name</label>
                    <input 
                      type="text" 
                      className="w-full px-5 py-4 bg-slate-50 rounded-2xl border-2 border-slate-50 focus:border-amber-500 outline-none font-bold text-sm"
                      value={productForm.name}
                      onChange={e => setProductForm({...productForm, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Size</label>
                    <input 
                      type="text" 
                      className="w-full px-5 py-4 bg-slate-50 rounded-2xl border-2 border-slate-50 focus:border-amber-500 outline-none font-bold text-sm"
                      value={productForm.size}
                      onChange={e => setProductForm({...productForm, size: e.target.value})}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Purchase Price</label>
                  <input type="number" className="w-full px-4 py-3 bg-slate-50 rounded-xl border-0 font-bold text-sm outline-none" value={productForm.purchasePrice} onChange={e => setProductForm({...productForm, purchasePrice: Number(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Selling Price</label>
                  <input type="number" className="w-full px-4 py-3 bg-slate-50 rounded-xl border-0 font-bold text-sm outline-none" value={productForm.sellingPrice} onChange={e => setProductForm({...productForm, sellingPrice: Number(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Pcs/Box</label>
                  <input type="number" className="w-full px-4 py-3 bg-slate-50 rounded-xl border-0 font-bold text-sm outline-none" value={productForm.tilesPerBox} onChange={e => setProductForm({...productForm, tilesPerBox: Number(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Sqft/Box</label>
                  <input type="number" className="w-full px-4 py-3 bg-slate-50 rounded-xl border-0 font-bold text-sm outline-none" value={productForm.sqftPerBox} onChange={e => setProductForm({...productForm, sqftPerBox: Number(e.target.value)})} />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button 
                  onClick={() => setStep('stock')}
                  className="bg-slate-900 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-amber-600 transition-all shadow-xl active:scale-95"
                >
                  Next: Stock Provisioning
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100">
                <h4 className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-4">Initial Stock Inward (Optional)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Quantity (Boxes/Slabs)</label>
                    <input type="number" className="w-full px-4 py-3 bg-white rounded-xl border-0 font-bold text-sm outline-none" value={inwardForm.qtyBoxes} onChange={e => setInwardForm({...inwardForm, qtyBoxes: Number(e.target.value)})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Purchase Rate (Actual)</label>
                    <input type="number" className="w-full px-4 py-3 bg-white rounded-xl border-0 font-bold text-sm outline-none" value={inwardForm.rate} onChange={e => setInwardForm({...inwardForm, rate: Number(e.target.value)})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Vendor Name</label>
                    <input type="text" className="w-full px-4 py-3 bg-white rounded-xl border-0 font-bold text-sm outline-none" value={inwardForm.vendorName} onChange={e => setInwardForm({...inwardForm, vendorName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Godown</label>
                    <select className="w-full px-4 py-3 bg-white rounded-xl border-0 font-bold text-sm outline-none" value={inwardForm.godownId} onChange={e => setInwardForm({...inwardForm, godownId: e.target.value})}>
                      {store.godowns.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <button 
                  onClick={() => setStep('details')}
                  className="text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-600 transition-all"
                >
                  Back to Details
                </button>
                <button 
                  onClick={handleCreateAndInward}
                  className="bg-amber-600 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-amber-700 transition-all shadow-xl active:scale-95"
                >
                  Finalize & Add to Document
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickProductModal;
