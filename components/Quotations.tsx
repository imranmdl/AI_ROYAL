
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { store } from '../store';
import { Product, Quotation, QuotationItem, UserRole, GalleryLead } from '../types';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import QuickProductModal from './QuickProductModal';


// ── Room Dimension Calculator — proper component (hooks must not be in IIFEs) ──
const RoomCalc: React.FC<{
  selectedProduct: any;
  onApply: (sqft: number, boxes: number, pieces: number) => void;
}> = ({ selectedProduct, onApply }) => {
  const [showCalc, setShowCalc] = React.useState(false);
  const [dimUnit,  setDimUnit]  = React.useState<'ft'|'inch'>('ft');
  const [dimH,     setDimH]     = React.useState('');
  const [dimW,     setDimW]     = React.useState('');
  const toFt = (v: string) => dimUnit === 'inch' ? parseFloat(v||'0')/12 : parseFloat(v||'0');
  const computedSqft = (() => { const h=toFt(dimH), w=toFt(dimW); return h>0&&w>0?Math.round(h*w*100)/100:0; })();
  return (
    <div className="space-y-2">
      <button onClick={()=>setShowCalc(p=>!p)}
        className="flex items-center gap-2 text-[9px] font-black text-slate-400 hover:text-amber-400 transition-all px-2">
        <i className={`fas fa-ruler-combined text-[10px] ${showCalc?'text-amber-400':'text-slate-500'}`}></i>
        {showCalc ? 'Hide Room Calculator' : 'Use Room Calculator (H × W)'}
        <i className={`fas fa-chevron-${showCalc?'up':'down'} text-[8px]`}></i>
      </button>
      {showCalc && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Room Dimensions</div>
            <div className="flex gap-1">
              {(['ft','inch'] as const).map(u => (
                <button key={u} onClick={()=>{ setDimUnit(u); setDimH(''); setDimW(''); }}
                  className={`px-3 py-1 rounded-xl text-[8px] font-black transition-all ${dimUnit===u?'bg-amber-500 text-white':'bg-white/10 text-slate-400 hover:text-white'}`}>
                  {u === 'ft' ? 'Feet' : 'Inches'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[8px] font-black text-slate-500 uppercase mb-1.5">Height ({dimUnit === 'ft' ? 'ft' : 'inches'})</div>
              <input type="number" step="0.1" placeholder={dimUnit==='ft'?'e.g. 12':'e.g. 144'}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white font-black text-lg outline-none focus:border-amber-400 transition-all"
                value={dimH} onChange={e=>setDimH(e.target.value)} />
            </div>
            <div>
              <div className="text-[8px] font-black text-slate-500 uppercase mb-1.5">Width ({dimUnit === 'ft' ? 'ft' : 'inches'})</div>
              <input type="number" step="0.1" placeholder={dimUnit==='ft'?'e.g. 10':'e.g. 120'}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white font-black text-lg outline-none focus:border-amber-400 transition-all"
                value={dimW} onChange={e=>setDimW(e.target.value)} />
            </div>
          </div>
          {computedSqft > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <div>
                <div className="text-[8px] font-black text-amber-400 uppercase">Calculated Area</div>
                <div className="text-2xl font-black italic text-amber-300">{computedSqft} SqFt</div>
                {dimUnit === 'inch' && (
                  <div className="text-[8px] text-slate-500 mt-0.5">
                    ({dimH}" × {dimW}") = ({(parseFloat(dimH||'0')/12).toFixed(2)}ft × {(parseFloat(dimW||'0')/12).toFixed(2)}ft)
                  </div>
                )}
              </div>
              <button onClick={()=>{ if(computedSqft>0){ const b=selectedProduct?Math.ceil(computedSqft/(selectedProduct.sqftPerBox||1)):0; const p=selectedProduct?Math.round(((computedSqft/(selectedProduct.sqftPerBox||1))-b+1)*(selectedProduct.tilesPerBox||1)):0; onApply(computedSqft,Math.max(0,b),Math.max(0,p)); } }}
                className="px-5 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-black text-xs uppercase transition-all flex items-center gap-2">
                <i className="fas fa-arrow-right"></i> Apply
              </button>
            </div>
          )}
          <div className="text-[8px] text-slate-500">Enter room dimensions → click Apply to fill SqFt coverage below</div>
        </div>
      )}
    </div>
  );
};

const Quotations: React.FC<{ 
  onConvertToSale?: (q: Quotation) => void;
  initialLead?: GalleryLead | null;
  onLeadConverted?: () => void;
}> = ({ onConvertToSale, initialLead, onLeadConverted }) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [customer, setCustomer] = useState({ name: '', mobile: '', address: '', gst: '' });
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [isGstIncluded, setIsGstIncluded] = useState(true);
  const [gstPercent, setGstPercent] = useState(18);
  const [viewMode, setViewMode]     = useState<'edit' | 'preview' | 'history'>('edit');
  const [showItemImages, setShowItemImages] = useState(store.settings.allowItemImagesInDocs === true);
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null);
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [showQuickProduct, setShowQuickProduct] = useState(false);
  
  // Commercial Overlays
  const [discountValue, setDiscountValue] = useState(0);
  const [discountType, setDiscountType] = useState<'Fixed' | 'Percentage'>('Percentage');
  // ── Incentive + Referral (mirrors Billing & POS) ─────────────────────────
  const [commissionValue, setCommissionValue] = useState(0);
  const [commissionType,  setCommissionType]  = useState<'Fixed'|'Percentage'>('Percentage');
  const [referralAgentId, setReferralAgentId] = useState('');
  const [refCommValue,    setRefCommValue]    = useState(0);
  const [refCommType,     setRefCommType]     = useState<'Fixed'|'Percentage'>('Percentage');
  const [globalComm, setGlobalComm] = useState(0);
  const [globalCommType, setGlobalCommType] = useState<'Fixed' | 'Percentage'>('Fixed');
  
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (initialLead) {
      setCustomer({
        name: initialLead.customerName,
        mobile: initialLead.customerMobile,
        address: initialLead.customerPlace,
        gst: ''
      });
      
      const newItems: QuotationItem[] = initialLead.items.map(item => {
        const product = store.products.find(p => p.id === item.productId);
        const isSlab = ['Granite', 'Marble', 'Kadapa'].includes(product?.category || '');
        
        // For slabs, we use Sqft basis. For others, we use Box basis.
        const priceBasis = isSlab ? 'Sqft' : 'Box';
        
        // Calculate boxes and pieces from requestedSqft for tiles
        let qtyBoxes = item.calculatedBoxes;
        let qtyPieces = 0;
        
        if (!isSlab && product) {
          const tpb = product.tilesPerBox || 1;
          const sqftPerBox = product.sqftPerBox || 1;
          const sqftPerTile = sqftPerBox / tpb;
          
          qtyBoxes = Math.floor(item.requestedSqft / sqftPerBox);
          const remainingSqft = item.requestedSqft % sqftPerBox;
          qtyPieces = Math.ceil(remainingSqft / sqftPerTile);
          
          if (qtyPieces >= tpb) {
            qtyBoxes += Math.floor(qtyPieces / tpb);
            qtyPieces %= tpb;
          }
        }

        // For slab products with selected slabs, use total slab sqft
        let finalSqft = item.requestedSqft;
        if (isSlab && (item as any).slabDetails?.length > 0) {
          finalSqft = (item as any).slabDetails.reduce((s: number, sl: any) => s + (sl.sqft || 0), 0);
        }
        // Per-sqft rate for slabs
        let rate = item.unitPrice;
        if (isSlab && (item as any).slabDetails?.length > 0) {
          rate = (item as any).slabDetails[0]?.sellingPricePerSqft || item.unitPrice;
        }
        const amt = isSlab ? finalSqft * rate : item.totalValue;

        return {
          id: Math.random().toString(36).substr(2, 9),
          productId: item.productId,
          productName: item.productName,
          productCategory: product?.category,
          purpose: item.purpose || 'Gallery Interest',
          reqSqft: finalSqft,
          qtyBoxes: isSlab ? 0 : qtyBoxes,
          qtyPieces: isSlab ? 0 : qtyPieces,
          rate,
          costRate: product?.totalCostPerUnit || 0,
          priceBasis: priceBasis,
          amount: amt,
          selectedSlabIds: (item as any).selectedSlabIds,
        };
      });
      
      setItems(newItems);
      onLeadConverted?.();
    }
  }, [initialLead, onLeadConverted]);

  const isAdmin = store.currentUser?.role === UserRole.ADMIN;

  // Offers Integration
  const [selectedOfferId, setSelectedOfferId] = useState<string>('');
  const activeOffers = useMemo(() => store.offers.filter(o => o.status === 'Published'), [store.offers]);

  const [builder, setBuilder] = useState({
    productId: '',
    purpose: '',
    reqSqft: 0,
    qtyBoxes: 0,
    qtyPieces: 0,
    rate: 0,
    priceBasis: 'Box' as 'Box' | 'Sqft',
    selectedSlabIds: [] as string[],
    sellingSlabSqft: 0,
    // True once the user manually edits Selling SqFt — until then, it
    // auto-tracks the TOTAL sqft of all selected slabs (count × per-slab sqft).
    sellingSqftManuallySet: false,
  });

  // Re-fetch the selected product whenever store.products changes (e.g. after a
  // new Kadapa inward merges slabs into this product) — without this, the slab
  // list shown here would stay stale at the snapshot from when it was selected.
  const [, forceProductRefresh] = useState(0);
  useEffect(() => {
    const unsub = store.subscribe(() => forceProductRefresh(n => n + 1), (s) => s.products);
    return unsub;
  }, []);

  const selectedProduct = useMemo(() => 
    store.products.find(p => p.id === builder.productId), 
    [builder.productId, store.products]
  );

  useEffect(() => {
    const offer = activeOffers.find(o => o.id === selectedOfferId);
    
    setItems(prev => prev.map(item => {
      const product = store.products.find(p => p.id === item.productId);
      const isTargeted = offer ? (offer.targetProductIds.includes(item.productId) || (product && offer.targetCategories.includes(product.category))) : false;
      
      const tilesPerBox = product?.tilesPerBox || 1;
      const totalUnitsAsBoxes = item.qtyBoxes + (item.qtyPieces / tilesPerBox);
      const baseAmount = item.priceBasis === 'Box' ? totalUnitsAsBoxes * item.rate : item.reqSqft * item.rate;

      if (offer && isTargeted) {
        const offerDiscount = offer.type === 'Percentage' ? (baseAmount * offer.value) / 100 : offer.value;
        return {
          ...item,
          appliedOfferId: offer.id,
          discountAmount: offerDiscount,
          amount: baseAmount - offerDiscount
        };
      } else {
        return {
          ...item,
          appliedOfferId: undefined,
          discountAmount: undefined,
          amount: baseAmount
        };
      }
    }));
  }, [selectedOfferId, activeOffers]);

  const filteredQuotations = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return store.quotations.filter(quo => 
      quo.customerName.toLowerCase().includes(q) ||
      quo.customerMobile.toLowerCase().includes(q) ||
      quo.quotationNo.toLowerCase().includes(q)
    );
  }, [searchQuery, store.quotations]);

  const groupedItems = useMemo(() => {
    if (!selectedQuotation) return null;
    const groups: Record<string, QuotationItem[]> = {};
    selectedQuotation.items.forEach(item => {
      const cat = item.productCategory || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [selectedQuotation]);

  const categoryTotals = useMemo(() => {
    if (!selectedQuotation) return null;
    const totals: Record<string, { sqft: number, boxes: number, pieces: number, amount: number }> = {};
    selectedQuotation.items.forEach(item => {
      const cat = item.productCategory || 'Other';
      if (!totals[cat]) totals[cat] = { sqft: 0, boxes: 0, pieces: 0, amount: 0 };
      totals[cat].sqft += item.reqSqft || 0;
      totals[cat].boxes += item.qtyBoxes || 0;
      totals[cat].pieces += item.qtyPieces || 0;
      totals[cat].amount += item.amount || 0;
    });
    return totals;
  }, [selectedQuotation]);

  const handleProductSelect = (id: string) => {
    const p = store.products.find(prod => prod.id === id);
    if (p) {
      const hasSlabs = (p.category === 'Granite' || p.category === 'Marble' || p.category === 'Kadapa') && p.slabs && p.slabs.length > 0;
      const isSl = ['Granite','Marble','Kadapa'].includes(p.category || '');
      // For slab products: price basis always Sqft; rate = sellingPricePerSqft or sellingPrice/sqftPerBox
      const slabRate = isSl
        ? (p.sellingPricePerSqft || (p.sqftPerBox > 0 ? p.sellingPrice / p.sqftPerBox : p.sellingPrice))
        : p.sellingPrice;
      setBuilder({
        ...builder,
        productId: id,
        rate: slabRate,
        priceBasis: isSl ? 'Sqft' : 'Box',
        reqSqft: 0,
        qtyBoxes: 0,
        qtyPieces: 0,
        selectedSlabIds: [],
        sellingSlabSqft: 0,
        sellingSqftManuallySet: false,
      });
    }
  };

  // Update reqSqft when slabs are selected
  // RULE: reqSqft = sellingSlabSqft (your measurement) if entered, else vendorSqft from inventory
  useEffect(() => {
    if (selectedProduct && builder.selectedSlabIds.length > 0 && selectedProduct.slabs) {
      const selectedSlabs = selectedProduct.slabs.filter(s => builder.selectedSlabIds.includes(s.id));
      // TOTAL sqft across ALL selected slabs (e.g. 10 slabs × 6.5 sqft = 65 sqft)
      const vendorTotal   = parseFloat(selectedSlabs.reduce((acc, s) => acc + (s.sqft || 0), 0).toFixed(2));
      // Auto-track vendor total UNLESS the user has manually edited Selling SqFt —
      // this re-syncs correctly as more/fewer slabs are selected.
      const sellingSqft = builder.sellingSqftManuallySet ? builder.sellingSlabSqft : vendorTotal;
      setBuilder(prev => ({
        ...prev,
        reqSqft:  sellingSqft,          // ← selling sqft drives billing
        qtyBoxes: builder.selectedSlabIds.length,
        qtyPieces: 0,
        sellingSlabSqft: sellingSqft,
      }));
    } else if (selectedProduct && builder.selectedSlabIds.length === 0) {
      // No slabs selected — reset selling sqft tracking
      setBuilder(prev => ({ ...prev, sellingSlabSqft: 0, sellingSqftManuallySet: false }));
    }
  }, [builder.selectedSlabIds, selectedProduct]);

  const SLAB_CATS = ['Granite', 'Marble', 'Kadapa'];
  const isSlabProduct = (p?: typeof selectedProduct) =>
    SLAB_CATS.includes((p || selectedProduct)?.category || '');

  const syncFromSqft = (val: number) => {
    if (!selectedProduct) return;
    if (isSlabProduct()) {
      // Slab products: sqft drives amount directly — don't change box/piece counts
      setBuilder(prev => ({ ...prev, reqSqft: val }));
    } else {
      const sqftPerBox   = selectedProduct.sqftPerBox || 1;
      const pcsPerBox    = selectedProduct.tilesPerBox || 1;
      const sqftPerPiece = sqftPerBox / pcsPerBox;
      const boxes  = Math.floor(val / sqftPerBox);
      const pieces = Math.ceil((val % sqftPerBox) / sqftPerPiece);
      setBuilder({ ...builder, reqSqft: val, qtyBoxes: boxes, qtyPieces: pieces });
    }
  };

  const syncFromUnits = (boxes: number, pieces: number) => {
    if (!selectedProduct) return;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    const pcsPerBox = selectedProduct.tilesPerBox || 1;
    const totalSqft = (boxes * sqftPerBox) + (pieces * (sqftPerBox / pcsPerBox));
    setBuilder({ ...builder, qtyBoxes: boxes, qtyPieces: pieces, reqSqft: parseFloat(totalSqft.toFixed(2)) });
  };

  const handlePriceBasisToggle = (basis: 'Box' | 'Sqft') => {
    if (!selectedProduct) return;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    let newRate = builder.rate;
    if (basis === 'Sqft' && builder.priceBasis === 'Box') {
      newRate = parseFloat((builder.rate / sqftPerBox).toFixed(2));
    } else if (basis === 'Box' && builder.priceBasis === 'Sqft') {
      newRate = parseFloat((builder.rate * sqftPerBox).toFixed(2));
    }
    setBuilder(prev => ({ ...prev, priceBasis: basis, rate: newRate }));
  };

  const ratePerSqft = useMemo(() => {
    if (!selectedProduct) return 0;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    return builder.priceBasis === 'Box' ? parseFloat((builder.rate / sqftPerBox).toFixed(2)) : builder.rate;
  }, [builder.rate, builder.priceBasis, selectedProduct]);

  const handleRatePerSqftChange = (val: number) => {
    if (!selectedProduct) return;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    if (builder.priceBasis === 'Box') {
      setBuilder(prev => ({ ...prev, rate: parseFloat((val * sqftPerBox).toFixed(2)) }));
    } else {
      setBuilder(prev => ({ ...prev, rate: val }));
    }
  };

  const addItem = () => {
    if (!builder.productId || !selectedProduct) return;
    const boxes = builder.qtyBoxes;
    const pieces = builder.qtyPieces;
    const tilesPerBox = selectedProduct.tilesPerBox || 1;
    const totalUnitsAsBoxes = boxes + (pieces / tilesPerBox);
    let finalSqft = builder.reqSqft;
    let finalBoxes = boxes;
    let finalPieces = pieces;

    if (builder.selectedSlabIds.length > 0 && selectedProduct.slabs) {
        const selectedSlabs = selectedProduct.slabs.filter(s => builder.selectedSlabIds.includes(s.id));
        const vendorSqft    = selectedSlabs.reduce((acc, s) => acc + (s.sqft || 0), 0);
        // SELLING SQFT — use manually entered value if set, else fall back to vendor
        finalSqft   = builder.sellingSlabSqft > 0 ? builder.sellingSlabSqft : parseFloat(vendorSqft.toFixed(2));
        finalBoxes  = selectedSlabs.length;
        finalPieces = 0;
    }

    const isSlabCat = SLAB_CATS.includes(selectedProduct.category || '');
    let calcAmount: number;
    if (isSlabCat) {
      // Slab products always price by sqft
      calcAmount = finalSqft * builder.rate;
    } else {
      calcAmount = builder.priceBasis === 'Box'
        ? (finalBoxes + (finalPieces / tilesPerBox)) * builder.rate
        : finalSqft * builder.rate;
    }

    const newItem: QuotationItem = {
      id: Date.now().toString(),
      productId: builder.productId,
      productName: selectedProduct.name || '',
      productCategory: selectedProduct.category,
      purpose: builder.purpose,
      reqSqft: parseFloat(finalSqft.toFixed(2)),
      qtyBoxes: finalBoxes,
      qtyPieces: finalPieces,
      rate: builder.rate,
      // costRate = landed cost per SqFt for slabs, landed per box for tiles
      // This is what liveProfitability uses: COGS = reqSqft × costRate (slab) or boxes × costRate (tile)
      costRate: SLAB_CATS.includes(selectedProduct.category || '')
        ? (selectedProduct.costPerSqft || selectedProduct.totalCostPerUnit / (selectedProduct.sqftPerBox || 1) || selectedProduct.totalCostPerUnit)
        : selectedProduct.totalCostPerUnit,
      priceBasis: builder.priceBasis,
      amount: calcAmount,
      selectedSlabIds: builder.selectedSlabIds.length > 0 ? builder.selectedSlabIds : undefined
    };

    // Apply current offer if any
    const offer = activeOffers.find(o => o.id === selectedOfferId);
    const isTargeted = offer ? (offer.targetProductIds.includes(newItem.productId) || offer.targetCategories.includes(selectedProduct.category)) : false;
    
    if (offer && isTargeted) {
      const offerDiscount = offer.type === 'Percentage' ? (newItem.amount * offer.value) / 100 : offer.value;
      newItem.appliedOfferId = offer.id;
      newItem.discountAmount = offerDiscount;
      newItem.amount = newItem.amount - offerDiscount;
    }

    setItems([...items, newItem]);
    setBuilder({ productId: '', purpose: '', reqSqft: 0, qtyBoxes: 0, qtyPieces: 0, rate: 0, priceBasis: 'Box', selectedSlabIds: [], sellingSlabSqft: 0, sellingSqftManuallySet: false });
  };

  /** Edit rate on any item in the stack → recalculate amount */
  const updateItemRate = (id: string, newRate: number) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const product = store.products.find(p => p.id === item.productId);
      const SLAB_C = ['Granite','Marble','Kadapa'];
      const isSlab = SLAB_C.includes(product?.category || '') || SLAB_C.includes(item.productCategory || '');
      const baseAmount = isSlab
        ? (item.reqSqft || 0) * newRate
        : (item.qtyBoxes + (item.qtyPieces / (product?.tilesPerBox || 1))) * newRate;
      return { ...item, rate: newRate, amount: Math.round(baseAmount * 100) / 100 };
    }));
  };

  /** For slab items in the list: directly edit reqSqft → recalculate amount */
  const updateSlabSqft = (id: string, newSqft: number) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const baseAmount = newSqft * item.rate;
      const offer = activeOffers.find(o => o.id === selectedOfferId);
      const product = store.products.find(p => p.id === item.productId);
      const isTargeted = offer ? (offer.targetProductIds.includes(item.productId) || (product && offer.targetCategories.includes(product.category))) : false;
      if (offer && isTargeted) {
        const disc = offer.type === 'Percentage' ? (baseAmount * offer.value) / 100 : offer.value;
        return { ...item, reqSqft: newSqft, discountAmount: disc, amount: baseAmount - disc };
      }
      return { ...item, reqSqft: newSqft, amount: baseAmount };
    }));
  };

  const updateItemQty = (id: string, deltaBoxes: number, deltaPieces: number) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      
      const product = store.products.find(p => p.id === item.productId);
      if (!product) return item;
      
      const tilesPerBox = product.tilesPerBox || 1;
      const sqftPerBox = product.sqftPerBox || 1;
      
      let newBoxes = Math.max(0, item.qtyBoxes + deltaBoxes);
      let newPieces = item.qtyPieces + deltaPieces;
      
      if (newPieces >= tilesPerBox) {
        newBoxes += Math.floor(newPieces / tilesPerBox);
        newPieces = newPieces % tilesPerBox;
      } else if (newPieces < 0) {
        const boxesToTake = Math.ceil(Math.abs(newPieces) / tilesPerBox);
        if (newBoxes >= boxesToTake) {
          newBoxes -= boxesToTake;
          newPieces = (boxesToTake * tilesPerBox) + newPieces;
        } else {
          newBoxes = 0;
          newPieces = 0;
        }
      }

      const totalUnitsAsBoxes = newBoxes + (newPieces / tilesPerBox);
      const totalSqft = parseFloat((totalUnitsAsBoxes * sqftPerBox).toFixed(2));
      
      let baseAmount = item.priceBasis === 'Box' ? totalUnitsAsBoxes * item.rate : totalSqft * item.rate;

      const updatedItem = {
        ...item,
        qtyBoxes: newBoxes,
        qtyPieces: newPieces,
        reqSqft: totalSqft,
        amount: baseAmount
      };

      // Re-apply offer
      const offer = activeOffers.find(o => o.id === selectedOfferId);
      const isTargeted = offer ? (offer.targetProductIds.includes(item.productId) || offer.targetCategories.includes(product.category)) : false;
      
      if (offer && isTargeted) {
        const offerDiscount = offer.type === 'Percentage' ? (baseAmount * offer.value) / 100 : offer.value;
        updatedItem.appliedOfferId = offer.id;
        updatedItem.discountAmount = offerDiscount;
        updatedItem.amount = baseAmount - offerDiscount;
      } else {
        updatedItem.appliedOfferId = undefined;
        updatedItem.discountAmount = undefined;
      }

      return updatedItem;
    }));
  };

  const loadingCharges = useMemo(() => store.calculateLoadingCharges(items), [items]);
  const subTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const currentGlobalDiscount = discountType === 'Fixed' ? discountValue : (subTotal * discountValue) / 100;
  const taxableAmount = subTotal - currentGlobalDiscount;
  const gstAmount = isGstIncluded ? 0 : (taxableAmount * gstPercent) / 100;
  const totalAmount = taxableAmount + gstAmount + loadingCharges;
  const totalSavings = items.reduce((sum, i) => sum + (i.discountAmount || 0), 0) + currentGlobalDiscount;

  const liveProfitability = useMemo(() => {
    const SLAB_C = ['Granite', 'Marble', 'Kadapa'];
    let totalCogs = 0;

    items.forEach(item => {
      const product = store.products.find(p => p.id === item.productId);
      const isSlab  = SLAB_C.includes(item.productCategory || product?.category || '');

      if (isSlab) {
        // ── SLAB ITEM: COGS = reqSqft × landedCostPerSqft ──────────────────
        //
        // Priority for landedCostPerSqft:
        //  1. Sum of actual per-slab landed costs (most accurate — each slab different size)
        //  2. item.costRate — stored as landedPerSqft at item creation time (after Fix 1 above)
        //  3. product.costPerSqft — base purchase rate per sqft
        //  4. product.totalCostPerUnit / product.sqftPerBox — derive perSqft from perSlab

        let landedCogs = 0;

        // Option 1: Sum actual slab landed costs from product.slabs
        const slabIds: string[] = item.selectedSlabIds || [];
        if (slabIds.length > 0 && product?.slabs?.length) {
          let slabSum = 0;
          slabIds.forEach(sid => {
            const s = product!.slabs!.find((sl: any) => sl.id === sid);
            if (s) slabSum += ((s as any).landedCost || 0);
          });
          if (slabSum > 0) { landedCogs = slabSum; }
        }

        if (!landedCogs) {
          // Option 2–4: use per-sqft rate × total sqft
          const sqft = item.reqSqft || 0;
          if (sqft > 0) {
            // item.costRate is now stored as landedPerSqft (fixed in addItem above)
            // If older items have costRate = landedPerSlab, detect and correct:
            //   if costRate >> sqft × (any reasonable sqft rate), it's likely per-slab
            let landedPerSqft = item.costRate || 0;

            // Sanity check: costRate should be per-sqft (≤ ~500 typically)
            // If costRate × sqft gives something way higher than amount, it's probably per-slab
            const isPerSlab = landedPerSqft > 0 && sqft > 0 && (landedPerSqft * sqft) > (item.amount * 3);
            if (isPerSlab && sqft > 0) {
              // costRate was stored as per-slab, convert to per-sqft
              landedPerSqft = landedPerSqft / sqft;
            }

            if (!landedPerSqft && product) {
              // Fall back to product fields
              landedPerSqft = product.costPerSqft
                || (product.sqftPerBox > 0 ? product.totalCostPerUnit / product.sqftPerBox : 0)
                || product.totalCostPerUnit;
            }

            landedCogs = sqft * landedPerSqft;
          } else if (product) {
            // No sqft recorded — use per-slab cost × slab count
            const slabCount = slabIds.length || item.qtyBoxes || 1;
            landedCogs = product.purchasePrice * slabCount;
          }
        }

        totalCogs += Math.round(landedCogs * 100) / 100;

      } else {
        // ── TILE / BOX ITEM: COGS = effective boxes × costRate ─────────────
        if (!product) return;
        const boxes = item.qtyBoxes + (item.qtyPieces / (product.tilesPerBox || 1));
        totalCogs += boxes * (item.costRate || product.totalCostPerUnit || 0);
      }
    });

    const netSelling = taxableAmount;
    const comm    = globalCommType === 'Fixed' ? globalComm : (netSelling * globalComm) / 100;
    const refComm = referralAgentId && refCommValue > 0
      ? (refCommType === 'Fixed' ? refCommValue : (netSelling * refCommValue) / 100) : 0;
    const totalComms         = comm + refComm;
    const netAfterDeductions = netSelling - totalComms;
    const profit   = netAfterDeductions - totalCogs;
    // Margin % = Profit / COGS × 100  (Markup % — retail standard: what % above cost you earned)
    const margin   = totalCogs > 0 ? (profit / totalCogs) * 100 : 0;
    return { profit, margin, totalCogs: Math.round(totalCogs), comm, refComm, totalComms, netSelling, netAfterDeductions };
  }, [items, taxableAmount, globalComm, globalCommType, refCommValue, refCommType, referralAgentId]);

  const saveQuotation = (status: Quotation['status'] = 'Active') => {
    const q: Quotation = {
      id: editingQuotationId || Date.now().toString(),
      quotationNo: editingQuotationId ? store.quotations.find(quo => quo.id === editingQuotationId)?.quotationNo || '' : `QUO-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: customer.name || 'Walk-in Customer',
      customerMobile: customer.mobile,
      customerAddress: customer.address,
      customerGst: customer.gst,
      date: new Date().toLocaleDateString(),
      items,
      subTotal,
      loadingCharges,
      discountValue,
      discountType,
      gstPercent,
      gstAmount,
      totalAmount,
      isGstIncluded,
      globalCommission: globalComm,
      globalCommissionType: globalCommType,
      salesPersonId: store.currentUser?.id || 'unknown',
      appliedOfferId: selectedOfferId || undefined,
      // Referral agent — persisted so billing can pick it up automatically
      referralAgentId: referralAgentId || undefined,
      referralAgentName: referralAgentId ? (store.referralAgents||[]).find(a=>a.id===referralAgentId)?.name : undefined,
      referralCommissionValue: refCommValue || undefined,
      referralCommissionType: refCommType || undefined,
      remarks,
      status
    };
    
    if (editingQuotationId) {
      store.updateQuotation(editingQuotationId, q);
    } else {
      store.addQuotation(q);
      // Stamp the gallery lead with this quotation ID so customer portal shows it
      if (initialLead) {
        store.updateGalleryLead(initialLead.id, {
          convertedQuotationId: q.id,
          status: 'Converted',
          convertedAt: new Date().toISOString(),
        });
      }
    }

    setSelectedQuotation(q);
    setEditingQuotationId(null);
    setViewMode('preview');
  };

  const handleEditQuotation = (q: Quotation) => {
    setEditingQuotationId(q.id);
    setCustomer({ name: q.customerName, mobile: q.customerMobile, address: q.customerAddress, gst: q.customerGst || '' });
    setRemarks(q.remarks || '');
    setItems(q.items);
    setIsGstIncluded(q.isGstIncluded);
    setGstPercent(q.gstPercent);
    setDiscountValue(q.discountValue);
    setDiscountType(q.discountType);
    // Restore commission and referral agent from saved quotation
    setCommissionValue((q as any).globalCommission || 0);
    setCommissionType((q as any).globalCommissionType || 'Percentage');
    setReferralAgentId((q as any).referralAgentId || '');
    setRefCommValue((q as any).referralCommissionValue || 0);
    setRefCommType((q as any).referralCommissionType || 'Percentage');
    setGlobalComm(q.globalCommission);
    setGlobalCommType(q.globalCommissionType);
    setSelectedOfferId(q.appliedOfferId || '');
    setViewMode('edit');
  };

  // ── HISTORY — full page early return ──────────────────────────────────────
  if (viewMode === 'history') {
    return (
      <div className="space-y-0 pb-20">
        {/* Sticky header bar */}
        <div className="sticky top-0 z-50 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 shadow-sm mb-6">
          <button onClick={() => setViewMode('edit')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
            <i className="fas fa-arrow-left text-xs"></i> Back to Builder
          </button>
          <h2 className="font-black text-slate-900 text-base tracking-tight flex-shrink-0">Recent Quotes</h2>
          <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 max-w-sm">
            <i className="fas fa-search text-slate-300 text-sm"></i>
            <input className="flex-1 bg-transparent outline-none text-slate-700 font-bold text-sm"
              placeholder="Search name, mobile or quote no…"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              autoFocus />
          </div>
          <div className="text-[9px] font-black text-slate-400 uppercase">{filteredQuotations.length} quotes</div>
        </div>

        <div className="px-4 sm:px-6 space-y-3">
          {filteredQuotations.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-[28px] py-24 text-center space-y-3">
              <i className="fas fa-file-alt text-5xl text-slate-200"></i>
              <div className="font-black text-slate-400 uppercase text-sm">No quotations found</div>
              <button onClick={() => setViewMode('edit')} className="text-amber-600 font-black text-sm hover:underline">+ Create New Quotation</button>
            </div>
          ) : (
            <div className="space-y-3">
              {[...filteredQuotations].sort((a, b) => b.id.localeCompare(a.id)).map(q => {
                const isConverted = store.sales.some((s: any) => s.quotationId === q.id);
                const discAmt = q.discountType === 'Fixed' ? q.discountValue : (q.subTotal * q.discountValue) / 100;
                return (
                  <div key={q.id} className="bg-white border border-slate-100 rounded-[24px] p-5 hover:shadow-md hover:border-slate-200 transition-all group">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">

                      {/* Left: Info */}
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                          q.status === 'Active' ? 'bg-emerald-50 text-emerald-600' :
                          q.status === 'Hold'   ? 'bg-amber-50 text-amber-600' :
                          q.status === 'Draft'  ? 'bg-slate-100 text-slate-400' :
                          'bg-rose-50 text-rose-500'}`}>
                          <i className="fas fa-file-alt text-lg"></i>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-black text-slate-900 text-base">{q.quotationNo}</span>
                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${
                              q.status === 'Active' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                              q.status === 'Hold'   ? 'bg-amber-50 text-amber-600 border-amber-200' :
                              q.status === 'Draft'  ? 'bg-slate-100 text-slate-500 border-slate-200' :
                              'bg-rose-50 text-rose-500 border-rose-200'
                            }`}>{q.status}</span>
                            {isConverted && <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">✓ Invoiced</span>}
                          </div>
                          <div className="text-sm font-black text-slate-700 mt-0.5">{q.customerName}</div>
                          <div className="text-[9px] font-bold text-slate-400 flex flex-wrap gap-3 mt-0.5">
                            <span><i className="fas fa-phone text-[8px] mr-1"></i>{q.customerMobile}</span>
                            <span><i className="fas fa-calendar text-[8px] mr-1"></i>{q.date}</span>
                            <span><i className="fas fa-boxes text-[8px] mr-1"></i>{q.items.length} item{q.items.length !== 1 ? 's' : ''}</span>
                          </div>
                          {/* Item names preview */}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {q.items.slice(0, 3).map((item, i) => (
                              <span key={i} className="text-[8px] font-bold bg-slate-50 border border-slate-100 text-slate-500 px-2 py-0.5 rounded-full truncate max-w-[120px]">{item.productName}</span>
                            ))}
                            {q.items.length > 3 && <span className="text-[8px] text-slate-400 font-bold">+{q.items.length - 3} more</span>}
                          </div>
                        </div>
                      </div>

                      {/* Right: Amount + Actions */}
                      <div className="flex items-center gap-4 flex-shrink-0 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-right">
                          <div className="text-2xl font-black text-slate-900">₹{q.totalAmount.toLocaleString('en-IN')}</div>
                          {discAmt > 0 && <div className="text-[9px] font-black text-emerald-600">Saved ₹{Math.round(discAmt).toLocaleString('en-IN')}</div>}
                          {q.gstAmount > 0 && <div className="text-[8px] text-slate-400 font-bold">GST: ₹{Math.round(q.gstAmount).toLocaleString('en-IN')}</div>}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <button onClick={() => { setSelectedQuotation(q); setViewMode('preview'); }}
                            className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-600 transition-all whitespace-nowrap">
                            <i className="fas fa-eye text-[9px] mr-1.5"></i> Preview
                          </button>
                          <button onClick={() => handleEditQuotation(q)}
                            className="px-5 py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-black text-[9px] uppercase hover:bg-amber-100 transition-all whitespace-nowrap">
                            <i className="fas fa-pencil-alt text-[9px] mr-1.5"></i> Edit
                          </button>
                          {onConvertToSale && !isConverted && (
                            <button onClick={() => { onConvertToSale(q); }}
                              className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all whitespace-nowrap">
                              <i className="fas fa-file-invoice text-[9px] mr-1.5"></i> Invoice
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (viewMode === 'preview' && selectedQuotation) {
    const showCoGst  = store.settings.printShowCompanyGst !== false;
    const showCustGst = store.settings.printShowCustomerGst !== false;
    const SLAB_CATS  = ['Kadapa', 'Granite', 'Marble'];

    // Rich category summary: boxes, pieces, slabs, sqft per category
    const catSummary: Record<string, {
      sqft: number; boxes: number; pieces: number; slabs: number;
      slabNos: string[]; amount: number; category: string;
    }> = {};
    selectedQuotation.items.forEach(item => {
      const cat = item.productCategory || 'Other';
      if (!catSummary[cat]) catSummary[cat] = { sqft: 0, boxes: 0, pieces: 0, slabs: 0, slabNos: [], amount: 0, category: cat };
      catSummary[cat].sqft   += item.reqSqft || 0;
      catSummary[cat].boxes  += item.qtyBoxes || 0;
      catSummary[cat].pieces += item.qtyPieces || 0;
      catSummary[cat].amount += item.amount || 0;
      if (item.selectedSlabIds?.length) {
        catSummary[cat].slabs  += item.selectedSlabIds.length;
        const prod = store.products.find(p => p.id === item.productId);
        item.selectedSlabIds.forEach(sid => {
          const s = prod?.slabs?.find(sl => sl.id === sid);
          if (s) catSummary[cat].slabNos.push(s.slabNo);
        });
      }
    });
    const totalBoxes  = selectedQuotation.items.reduce((s, i) => s + (i.qtyBoxes || 0), 0);
    const totalPieces = selectedQuotation.items.reduce((s, i) => s + (i.qtyPieces || 0), 0);
    const totalSlabs  = selectedQuotation.items.reduce((s, i) => s + (i.selectedSlabIds?.length || 0), 0);
    const totalSqft   = selectedQuotation.items.reduce((s, i) => s + (i.reqSqft || 0), 0);
    const discAmt = selectedQuotation.discountType === 'Fixed'
      ? selectedQuotation.discountValue
      : (selectedQuotation.subTotal * selectedQuotation.discountValue) / 100;
    const totalSavings = discAmt + selectedQuotation.items.reduce((s, i) => s + (i.discountAmount || 0), 0);

    return (
      <div className="min-h-screen bg-slate-100 print:bg-white">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            @page { size: A4; margin: 8mm 10mm; }
            body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            #q-print { box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; max-width: 100% !important; }
            .page-break { page-break-before: always; }
          }
        `}} />

        {/* ── Screen action bar (hidden on print) ── */}
        <div className="no-print sticky top-0 z-50 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <button onClick={() => setViewMode('edit')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
            <i className="fas fa-arrow-left text-xs"></i> Back
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-black text-slate-800 text-sm truncate">{selectedQuotation.quotationNo}</div>
            <div className="text-[9px] text-slate-400 font-bold">{selectedQuotation.customerName} · {selectedQuotation.date}</div>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* Image toggle — only shown if admin has enabled it */}
            {store.settings.allowItemImagesInDocs && (
              <label className="no-print flex items-center gap-2 cursor-pointer bg-slate-100 hover:bg-slate-200 rounded-xl px-3 py-2 transition-all">
                <div onClick={() => setShowItemImages(v => !v)}
                  className={`w-9 h-5 rounded-full relative transition-all ${showItemImages ? 'bg-amber-500' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${showItemImages ? 'left-4' : 'left-0.5'}`}/>
                </div>
                <span className="text-[9px] font-black text-slate-600 uppercase tracking-wide whitespace-nowrap">
                  <i className="fas fa-image text-[9px] mr-1"></i> Item Images
                </span>
              </label>
            )}
            <button onClick={() => window.print()}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-600 transition-all">
              <i className="fas fa-print text-xs"></i> Print / PDF
            </button>
            {onConvertToSale && (
              <button onClick={() => onConvertToSale(selectedQuotation)}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-emerald-700 transition-all">
                <i className="fas fa-file-invoice text-xs"></i> Convert to Invoice
              </button>
            )}
          </div>
        </div>

        {/* ── Printable document ── */}
        <div ref={previewRef} id="q-print"
          className="max-w-4xl mx-auto bg-white shadow-xl rounded-2xl sm:rounded-3xl overflow-hidden my-4 sm:my-6 print:my-0 print:shadow-none">

          {/* Document header strip */}
          <div className="h-2 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600"></div>

          <div className="px-6 sm:px-10 py-6 sm:py-8 space-y-6">

            {/* ── Company + Doc header ── */}
            <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div className="space-y-1">
                <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tighter uppercase">{store.settings.showroomName}</div>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide max-w-xs leading-relaxed">{store.settings.showroomAddress}</div>
                <div className="flex flex-wrap gap-4 pt-1 text-[9px] font-black uppercase text-slate-500">
                  {showCoGst && store.settings.showroomGst && (
                    <span className="flex items-center gap-1"><i className="fas fa-building text-amber-500"></i> GSTIN: {store.settings.showroomGst}</span>
                  )}
                  {store.settings.showroomPhone && (
                    <span className="flex items-center gap-1"><i className="fas fa-phone text-amber-500"></i> {store.settings.showroomPhone}</span>
                  )}
                </div>
              </div>
              <div className="text-left sm:text-right space-y-1 border-t sm:border-0 pt-3 sm:pt-0 w-full sm:w-auto">
                <div className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Quotation</div>
                <div className="text-2xl font-black text-slate-900">{selectedQuotation.quotationNo}</div>
                <div className="text-[9px] font-bold text-slate-400 uppercase">Date: {selectedQuotation.date}</div>
                <div className="text-[9px] font-bold text-slate-400 uppercase">Valid: 7 days</div>
              </div>
            </header>

            {/* ── Customer section ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 rounded-2xl px-5 py-4">
              <div>
                <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Quotation For</div>
                <div className="text-lg font-black text-slate-900">{selectedQuotation.customerName}</div>
                <div className="text-[10px] font-bold text-slate-500 mt-0.5">+91 {selectedQuotation.customerMobile}</div>
                {selectedQuotation.customerAddress && (
                  <div className="text-[9px] text-slate-400 font-bold mt-0.5">{selectedQuotation.customerAddress}</div>
                )}
                {showCustGst && selectedQuotation.customerGst && (
                  <div className="text-[9px] font-black text-slate-500 mt-1">GSTIN: {selectedQuotation.customerGst}</div>
                )}
              </div>
              <div className="border-t sm:border-0 pt-3 sm:pt-0 sm:text-right">
                <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</div>
                <div className="text-sm font-black text-slate-700">Proforma Estimate</div>
                <div className="text-[9px] text-slate-400 font-bold mt-0.5">Subject to stock availability</div>
              </div>
            </div>

            {/* ── Items table ── */}
            <div className="overflow-x-auto -mx-2 sm:mx-0">
              <table className="w-full text-left min-w-[540px]">
                <thead>
                  <tr className="border-b-2 border-slate-900 bg-slate-50">
                    <th className="px-3 sm:px-4 py-3 text-[9px] font-black uppercase tracking-widest">Product</th>
                    <th className="px-3 sm:px-4 py-3 text-[9px] font-black uppercase tracking-widest text-center">Qty / Area</th>
                    <th className="px-3 sm:px-4 py-3 text-[9px] font-black uppercase tracking-widest text-center">Rate</th>
                    <th className="px-3 sm:px-4 py-3 text-[9px] font-black uppercase tracking-widest text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupedItems && Object.entries(groupedItems).map(([category, catItems]) => {
                    const isSlab = SLAB_CATS.includes(category);
                    return (
                      <React.Fragment key={category}>
                        <tr>
                          <td colSpan={4} className="px-3 sm:px-4 py-2 bg-amber-50 border-y border-amber-100">
                            <span className="text-[9px] font-black text-amber-700 uppercase tracking-widest">{category}</span>
                          </td>
                        </tr>
                        {catItems.map(item => {
                          const prod = store.products.find(p => p.id === item.productId);
                          const slabNos = item.selectedSlabIds?.map(sid => prod?.slabs?.find(s => s.id === sid)?.slabNo).filter(Boolean) || [];
                          const itemImage = prod?.images?.[0] || null;
                          return (
                            <tr key={item.id} className="hover:bg-slate-50/50">
                              <td className="px-3 sm:px-4 py-3">
                                <div className="flex items-start gap-3">
                                  {/* Product image — shown when toggle is ON */}
                                  {showItemImages && itemImage && (
                                    <img src={itemImage} alt={item.productName}
                                      className="w-14 h-14 object-cover rounded-xl border border-slate-100 flex-shrink-0 print:w-12 print:h-12"
                                      referrerPolicy="no-referrer"
                                      onError={e => { (e.target as HTMLImageElement).style.display='none'; }}
                                    />
                                  )}
                                  {showItemImages && !itemImage && (
                                    <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0 print:w-12 print:h-12">
                                      <i className="fas fa-image text-slate-300 text-xl"></i>
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="font-black text-slate-800 text-[11px] sm:text-xs">{item.productName}</div>

                                    {/* Size + brand for tile/box items */}
                                    {!isSlab && (prod?.size || prod?.brand) && (
                                      <div className="text-[8px] text-slate-500 font-bold mt-0.5 flex items-center gap-1 flex-wrap">
                                        {prod?.size && <><i className="fas fa-ruler-combined text-[7px] opacity-50"></i><span>{prod.size}</span></>}
                                        {prod?.brand && <span className="opacity-70">· {prod.brand}</span>}
                                        {prod?.grade && prod.grade !== 'Standard' && <span className="opacity-60">· {prod.grade}</span>}
                                      </div>
                                    )}

                                    {item.purpose && item.purpose !== 'General' && (
                                      <div className="text-[8px] text-slate-400 font-bold mt-0.5">{item.purpose}</div>
                                    )}

                                    {/* Kadapa — count + total sqft, no slab#s */}
                                    {isSlab && item.productCategory === 'Kadapa' && slabNos.length > 0 && (
                                      <div className="text-[8px] text-amber-700 font-bold mt-0.5">
                                        {slabNos.length} slab{slabNos.length > 1 ? 's' : ''} · {item.reqSqft.toFixed(2)} SqFt
                                        {prod?.size && ` · ${prod.size} ft`}
                                      </div>
                                    )}

                                    {/* Granite / Marble — individual slab numbers for site verification */}
                                    {isSlab && item.productCategory !== 'Kadapa' && slabNos.length > 0 && (
                                      <div className="mt-1 space-y-0.5">
                                        <div className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Slab Nos:</div>
                                        <div className="flex flex-wrap gap-1">
                                          {slabNos.map(no => (
                                            <span key={no} className="text-[7px] font-black bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full border border-purple-100">#{no}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-center">
                                {isSlab ? (
                                  <div>
                                    {slabNos.length > 0 ? (
                                      <div className="font-black text-slate-700 text-sm">{slabNos.length} Slab{slabNos.length > 1 ? 's' : ''}</div>
                                    ) : null}
                                    <div className="font-bold text-slate-600 text-xs">{item.reqSqft.toFixed(2)} SqFt</div>
                                  </div>
                                ) : (() => {
                                  const NON_SQFT_CATS = ['Adhesive','Grout','Cement','Tools','Sanitary','Epoxy','Putty','Primer'];
                                  const isNonSqft = NON_SQFT_CATS.includes(item.productCategory || '');
                                  const dispUnit = item.unit || prod?.unitType || 'Box';
                                  const unitLabelPlural = (n: number, lbl: string) =>
                                    n > 1 ? (lbl === 'Box' ? 'Boxes' : `${lbl}s`) : lbl;
                                  const isTileCat = ['Floor Tile','Wall Tile','Floor','Vitrified','Ceramic','Wooden'].some(
                                    c => (item.productCategory||'').toLowerCase().includes(c.toLowerCase())
                                  );
                                  return (
                                    <div>
                                      <div className="font-black text-slate-700 text-sm">
                                        {item.qtyBoxes > 0 && `${item.qtyBoxes} ${unitLabelPlural(item.qtyBoxes, isNonSqft ? dispUnit : 'Box')}`}
                                        {item.qtyPieces > 0 && ` + ${item.qtyPieces} Pcs`}
                                      </div>
                                      {!isNonSqft && item.reqSqft > 0 && (
                                        <div className="text-[9px] text-slate-400 font-bold">{item.reqSqft.toFixed(2)} SqFt</div>
                                      )}
                                      {isTileCat && prod?.size && (
                                        <div className="text-[8px] text-slate-500 font-bold">{prod.size}</div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-center">{(() => {
                                const NON_SQFT_CATS = ['Adhesive','Grout','Cement','Tools','Sanitary','Epoxy','Putty','Primer'];
                                const isNonSqft = NON_SQFT_CATS.includes(item.productCategory || '');
                                const dispUnit = item.unit || prod?.unitType || 'Box';
                                const priceBasis = item.priceBasis || dispUnit;
                                return (
                                  <div>
                                    <div className="font-bold text-slate-700 text-sm">₹{item.rate.toLocaleString()}</div>
                                    <div className="text-[8px] text-slate-400 font-bold uppercase">
                                      {isNonSqft ? `/ ${dispUnit}` : `/ ${priceBasis}`}
                                    </div>
                                    {!isNonSqft && priceBasis === 'Box' && item.reqSqft > 0 && (
                                      <div className="text-[8px] text-amber-600 font-black mt-0.5">
                                        ₹{(item.amount / item.reqSqft).toFixed(2)}/SqFt
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-right">
                                <div className="font-black text-slate-900 text-sm">₹{item.amount.toLocaleString()}</div>
                                {(item.discountAmount || 0) > 0 && (
                                  <div className="text-[8px] font-black text-emerald-600">Saved ₹{item.discountAmount?.toLocaleString()}</div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Category Summary ── */}
            <div className="space-y-3">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1">Category Breakdown</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(catSummary).map(([cat, s]) => {
                  const isSlab = SLAB_CATS.includes(cat);
                  return (
                    <div key={cat} className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2">
                      <div className="text-[9px] font-black text-amber-600 uppercase tracking-widest">{cat}</div>
                      {isSlab ? (
                        <>
                          {s.slabs > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="font-bold text-slate-500">Slabs</span>
                              <span className="font-black text-slate-800">{s.slabs} slab{s.slabs > 1 ? 's' : ''}</span>
                            </div>
                          )}
                          {s.slabNos.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {s.slabNos.map(no => (
                                <span key={no} className="text-[7px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">#{no}</span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex justify-between text-[10px]">
                          <span className="font-bold text-slate-500">Boxes + Pcs</span>
                          <span className="font-black text-slate-800">{s.boxes}B {s.pieces > 0 ? `+ ${s.pieces}P` : ''}</span>
                        </div>
                      )}
                      {s.sqft > 0 && (
                        <div className="flex justify-between text-[10px] border-t border-slate-100 pt-1">
                          <span className="font-bold text-slate-500">Total SqFt</span>
                          <span className="font-black text-indigo-700">{s.sqft.toFixed(2)} SqFt</span>
                        </div>
                      )}
                      <div className="flex justify-between text-[10px] font-black border-t border-slate-200 pt-1 mt-1">
                        <span className="text-slate-600">Subtotal</span>
                        <span className="text-slate-900">₹{s.amount.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Grand totals row ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 rounded-2xl p-4 border border-slate-100">
              {[
                { label: 'Total Boxes',  val: `${totalBoxes}`,            show: totalBoxes > 0 },
                { label: 'Total Pieces', val: `${totalPieces}`,           show: totalPieces > 0 },
                { label: 'Total Slabs',  val: `${totalSlabs}`,            show: totalSlabs > 0 },
                { label: 'Total SqFt',   val: `${totalSqft.toFixed(2)}`,  show: totalSqft > 0 },
              ].filter(x => x.show || true).map(({ label, val }) => (
                <div key={label} className="text-center">
                  <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
                  <div className="text-base font-black text-slate-800 mt-0.5">{val}</div>
                </div>
              ))}
            </div>

            {/* ── Financial totals + Remarks ── */}
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="flex-1 space-y-3">
                {selectedQuotation.remarks && (
                  <div className="bg-slate-50 rounded-xl p-4 text-[10px] font-medium text-slate-600 italic border border-slate-100">
                    <div className="font-black text-slate-400 text-[8px] uppercase tracking-widest mb-1 not-italic">Remarks</div>
                    {selectedQuotation.remarks}
                  </div>
                )}
                <div className="bg-slate-50 rounded-xl p-4 text-[8px] sm:text-[9px] text-slate-400 space-y-0.5 border border-slate-100">
                  <p>• Prices subject to stock availability at time of order.</p>
                  <p>• Transportation charges extra unless specified.</p>
                  <p>• Payments in favour of '{store.settings.showroomName}'.</p>
                  {store.settings.decimalPlaceText && <p>• {store.settings.decimalPlaceText}</p>}
                </div>
              </div>

              <div className="w-full md:w-64 space-y-1.5 shrink-0">
                <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  <span>Gross Value</span><span>₹{selectedQuotation.subTotal.toLocaleString()}</span>
                </div>
                {selectedQuotation.discountValue > 0 && (
                  <div className="flex justify-between text-[9px] font-black text-emerald-600 uppercase tracking-widest">
                    <span>Discount</span><span>- ₹{discAmt.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  <span>GST ({selectedQuotation.gstPercent}%)</span>
                  <span>{selectedQuotation.isGstIncluded ? 'Inclusive' : `₹${selectedQuotation.gstAmount.toLocaleString()}`}</span>
                </div>
                {selectedQuotation.loadingCharges ? (
                  <div className="flex justify-between text-[9px] font-black text-amber-600 uppercase tracking-widest">
                    <span>Loading Charges</span><span>₹{selectedQuotation.loadingCharges.toLocaleString()}</span>
                  </div>
                ) : null}
                <div className="bg-slate-900 text-white rounded-2xl p-5 mt-2">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Estimate</div>
                  <div className="text-2xl sm:text-3xl font-black mt-1">₹{selectedQuotation.totalAmount.toLocaleString()}</div>
                  {totalSavings > 0 && (
                    <div className="text-[9px] font-black text-emerald-400 mt-2 border-t border-white/10 pt-2 flex justify-between">
                      <span>YOU SAVE</span><span>₹{totalSavings.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Signature line ── */}
            <div className="flex justify-between pt-6 border-t border-slate-100">
              <div className="text-center">
                <div className="w-28 h-px bg-slate-300 mb-1.5"></div>
                <div className="text-[8px] font-black text-slate-400 uppercase">Customer Signature</div>
              </div>
              <div className="text-center">
                <div className="w-36 h-px bg-slate-300 mb-1.5"></div>
                <div className="text-[8px] font-black text-slate-400 uppercase">For {store.settings.showroomName}</div>
              </div>
            </div>

          </div>
          <div className="h-1.5 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600"></div>
        </div>

        {/* Bottom action bar (hidden on print) */}
        <div className="no-print max-w-4xl mx-auto pb-8 px-4 flex flex-wrap gap-3 justify-center">
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-8 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95">
            <i className="fas fa-print"></i> Print / Export PDF
          </button>
          {onConvertToSale && (
            <button onClick={() => onConvertToSale(selectedQuotation)}
              className="flex items-center gap-2 px-8 py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all active:scale-95">
              <i className="fas fa-file-invoice"></i> Convert to Sale
            </button>
          )}
          <button onClick={() => setViewMode('edit')}
            className="flex items-center gap-2 px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">
            <i className="fas fa-edit"></i> Edit
          </button>
        </div>
      </div>
    );
  }


  return (
    <div className="space-y-8 pb-20 px-2 sm:px-0">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 italic uppercase tracking-tighter leading-none">Quotation Studio</h1>
          <p className="text-slate-500 font-bold uppercase text-[9px] sm:text-[10px] tracking-widest mt-2">Estimate Orchestration • Real-time Margin Guard</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
           <button onClick={() => setViewMode('history')} className="flex-1 md:flex-none bg-white border-2 border-slate-100 px-6 py-3 rounded-2xl font-black text-[10px] text-slate-500 uppercase tracking-widest hover:bg-slate-50 transition-all">
             <i className="fas fa-history mr-2"></i> Recent Quotes
           </button>
           <button onClick={() => saveQuotation('Draft')} className="flex-1 md:flex-none bg-slate-800 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-700 transition-all">
             Save Draft
           </button>
           <button onClick={() => saveQuotation('Hold')} className="flex-1 md:flex-none bg-amber-900/40 text-amber-500 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-900/60 transition-all">
             Hold
           </button>
           <button onClick={() => saveQuotation('Active')} className="flex-1 md:flex-none bg-amber-600 text-white px-10 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-700 shadow-xl shadow-amber-900/20 active:scale-95 transition-all">
             {editingQuotationId ? 'Update Estimate' : 'Initialize Estimate'}
           </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white p-6 sm:p-8 rounded-[30px] sm:rounded-[40px] shadow-sm border border-slate-100 space-y-6">
            <h3 className="font-black text-slate-800 uppercase tracking-widest text-[9px] sm:text-[10px] flex items-center gap-2"><i className="fas fa-user-circle text-amber-500"></i> Client Profile</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <input type="text" placeholder="Customer Name" className="px-5 py-4 bg-slate-50 rounded-2xl border outline-none font-bold focus:ring-2 focus:ring-slate-900 transition-all text-sm" value={customer.name} onChange={e => setCustomer({...customer, name: e.target.value})} />
              <input type="text" placeholder="Mobile Number" className="px-5 py-4 bg-slate-50 rounded-2xl border outline-none font-bold focus:ring-2 focus:ring-slate-900 transition-all text-sm" value={customer.mobile} onChange={e => setCustomer({...customer, mobile: e.target.value})} />
              <textarea placeholder="Site / Delivery Address" className="px-5 py-4 bg-slate-50 rounded-2xl border outline-none font-bold focus:ring-2 focus:ring-slate-900 transition-all col-span-1 md:col-span-2 h-24 text-sm" value={customer.address} onChange={e => setCustomer({...customer, address: e.target.value})} />
            </div>
          </div>

          <div className="bg-slate-950 p-6 sm:p-8 rounded-[30px] sm:rounded-[40px] shadow-2xl space-y-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 blur-[100px] pointer-events-none"></div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/10 pb-4 gap-3">
              <h3 className="font-black text-white uppercase tracking-widest text-[10px]">Add Project Requirement</h3>
              <button 
                onClick={() => setShowQuickProduct(true)}
                className="bg-amber-500 text-white px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-amber-600 transition-all shadow-lg active:scale-95 flex items-center gap-2"
              >
                <i className="fas fa-plus"></i> New Item
              </button>
              {selectedProduct && (
                <div className={`text-[8px] sm:text-[9px] font-black px-3 py-1 rounded-full uppercase ${selectedProduct.stockBoxes <= selectedProduct.reorderLevel ? 'bg-rose-500 text-white animate-pulse' : 'bg-emerald-500/20 text-emerald-400'}`}>
                  Stock: {selectedProduct.stockBoxes}B, {selectedProduct.stockLoose}P
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="col-span-1 sm:col-span-2 space-y-4">
                <div className="relative">
                  <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                  <input 
                    type="text" 
                    placeholder="Search Item Name, Size or Category..." 
                    className="w-full pl-12 pr-5 py-4 bg-white/5 border-0 rounded-2xl font-black text-white focus:ring-2 focus:ring-amber-500 outline-none text-sm"
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <select className="w-full px-5 py-4 bg-white/5 text-white border-0 rounded-2xl font-black focus:ring-2 focus:ring-amber-500 outline-none appearance-none text-sm" value={builder.productId} onChange={e => handleProductSelect(e.target.value)}>
                    <option value="" className="bg-slate-900">Select Tile / Granite Model...</option>
                    {store.products
                      .filter(p => p.status === 'Active' && (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.category.toLowerCase().includes(productSearch.toLowerCase()) || p.size.toLowerCase().includes(productSearch.toLowerCase())))
                      .map(p => <option key={p.id} value={p.id} className="bg-slate-900">{p.name} ({p.size})</option>)}
                  </select>
                  {selectedProduct && (
                    <div className="absolute right-10 top-1/2 -translate-y-1/2 text-[9px] font-black text-amber-500 uppercase bg-amber-500/10 px-2 py-1 rounded-lg pointer-events-none">
                      {selectedProduct.category}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-[9px] sm:text-[10px] font-black text-slate-500 uppercase block mb-2 px-2">Project Area</label>
                <input type="text" placeholder="Usage (e.g. Hall)..." className="w-full px-5 py-4 bg-white/5 text-white border-0 rounded-2xl font-bold text-sm" value={builder.purpose} onChange={e => setBuilder({...builder, purpose: e.target.value})} />
              </div>

              {/* ── Room Dimension Calculator — proper component (hooks at top level) ── */}
              <RoomCalc
                selectedProduct={selectedProduct}
                onApply={(sqft, boxes, pieces) => setBuilder(prev => ({ ...prev, reqSqft: sqft, qtyBoxes: boxes, qtyPieces: pieces }))}
              />
              <div>
                {isSlabProduct() && builder.selectedSlabIds.length > 0 && (()=>{
                  const _slabs = selectedProduct?.slabs?.filter((s:any) => builder.selectedSlabIds.includes(s.id)) || [];
                  const vendorTotal = parseFloat(_slabs.reduce((a:number, s:any) => a + (s.sqft || 0), 0).toFixed(2));
                  return (
                    <div className="bg-indigo-900/30 border border-indigo-700/30 rounded-2xl p-4 mb-3 space-y-3">
                      <div className="text-[9px] font-black text-indigo-300 uppercase tracking-widest">Slab SqFt — Vendor vs Selling</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Vendor SqFt (from inventory)</div>
                          <div className="px-4 py-3 bg-slate-800 rounded-xl font-black text-slate-300 text-lg">{vendorTotal} SqFt</div>
                          <div className="text-[8px] text-slate-500 mt-1">{slabs.length} slab{slabs.length > 1 ? 's' : ''} as measured by vendor</div>
                        </div>
                        <div>
                          <div className="text-[8px] font-black text-amber-400 uppercase mb-1">Selling SqFt <span className="text-amber-300 normal-case">(your actual measurement)</span></div>
                          <input type="number" step="0.01"
                            className="w-full px-4 py-3 bg-amber-900/30 border-2 border-amber-600/50 rounded-xl font-black text-amber-300 text-lg outline-none focus:border-amber-500 transition-all"
                            placeholder={`${vendorTotal}`}
                            value={builder.sellingSlabSqft || ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value || '0');
                              const manuallySet = e.target.value.trim() !== '';
                              setBuilder(prev => ({
                                ...prev,
                                sellingSlabSqft: manuallySet ? v : vendorTotal,
                                reqSqft: manuallySet ? (v || vendorTotal) : vendorTotal,
                                sellingSqftManuallySet: manuallySet,
                              }));
                            }}
                          />
                          <div className="text-[8px] text-amber-500 mt-1">Enter your measured size — used for billing & margin</div>
                        </div>
                      </div>
                      {builder.sellingSlabSqft > 0 && Math.abs(builder.sellingSlabSqft - vendorTotal) > 0.01 && (
                        <div className={`flex items-center gap-2 text-[9px] font-bold rounded-xl px-3 py-2 ${builder.sellingSlabSqft > vendorTotal ? 'bg-amber-900/30 text-amber-400' : 'bg-rose-900/30 text-rose-400'}`}>
                          <i className={`fas ${builder.sellingSlabSqft > vendorTotal ? 'fa-arrow-up' : 'fa-arrow-down'} text-[9px]`}></i>
                          {builder.sellingSlabSqft > vendorTotal
                            ? `You gain ${(builder.sellingSlabSqft - vendorTotal).toFixed(2)} SqFt over vendor — extra revenue`
                            : `You lose ${(vendorTotal - builder.sellingSlabSqft).toFixed(2)} SqFt vs vendor — check deductions`}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <label className="text-[9px] sm:text-[10px] font-black text-slate-500 uppercase block mb-2 px-2">
                  {isSlabProduct() && builder.selectedSlabIds.length > 0 ? 'Selling SqFt (auto-filled · editable)' : 'Total Coverage (Sqft) — Selling Size'}
                  {isSlabProduct() && (
                    <span className="ml-2 text-amber-400 normal-case font-bold text-[8px]">(auto-filled from above · editable)</span>
                  )}
                </label>
                <input
                  type="number"
                  step="0.01"
                  className={`w-full px-5 py-4 border-0 rounded-2xl font-black text-sm outline-none transition-all ${
                    isSlabProduct()
                      ? 'bg-amber-600/20 text-amber-200 focus:bg-amber-600/30 ring-2 ring-amber-500/40'
                      : 'bg-white/5 text-white focus:ring-2 focus:ring-amber-500'
                  }`}
                  placeholder={isSlabProduct() ? "Enter total sqft…" : "0"}
                  value={builder.reqSqft > 0 ? builder.reqSqft : ''}
                  onChange={e => syncFromSqft(parseFloat(e.target.value || '0'))}
                />
                {isSlabProduct() && builder.reqSqft > 0 && builder.rate > 0 && (
                  <div className="mt-1.5 px-2 flex justify-between text-[9px] font-black">
                    <span className="text-slate-400">{builder.reqSqft} SqFt × ₹{builder.rate}/SqFt</span>
                    <span className="text-amber-400">= ₹{Math.round(builder.reqSqft * builder.rate).toLocaleString('en-IN')}</span>
                  </div>
                )}
              </div>

              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(selectedProduct?.category === 'Granite' || selectedProduct?.category === 'Marble' || selectedProduct?.category === 'Kadapa') && selectedProduct.slabs && selectedProduct.slabs.length > 0 ? (
                    <div className="col-span-1 sm:col-span-2 bg-white/5 p-5 rounded-3xl border border-white/10 space-y-3">
                        {/* Header */}
                        <div className="flex justify-between items-center">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Select Slabs</label>
                          <div className="flex items-center gap-3">
                            <span className="text-[9px] text-slate-400 font-bold">
                              {selectedProduct.slabs.filter((s:any)=>!s.isSold).length} avail
                            </span>
                            {builder.selectedSlabIds.length > 0 && (
                              <button onClick={()=>setBuilder({...builder,selectedSlabIds:[]})} className="text-[8px] font-black text-rose-400 hover:text-rose-300">
                                Clear all
                              </button>
                            )}
                            <button onClick={()=>setBuilder({...builder,selectedSlabIds:selectedProduct.slabs!.filter((s:any)=>!s.isSold).map((s:any)=>s.id)})}
                              className="text-[8px] font-black text-amber-400 hover:text-amber-300">
                              Select all
                            </button>
                          </div>
                        </div>
                        {/* Table */}
                        <div className="max-h-52 overflow-y-auto rounded-2xl border border-white/10">
                          <table className="w-full text-xs">
                            <thead className="bg-white/10 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-[8px] font-black text-slate-400 uppercase w-6">✓</th>
                                <th className="px-3 py-2 text-left text-[8px] font-black text-slate-400 uppercase">Slab No.</th>
                                <th className="px-3 py-2 text-center text-[8px] font-black text-slate-400 uppercase">Size</th>
                                <th className="px-3 py-2 text-center text-[8px] font-black text-slate-400 uppercase">SqFt</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                              {selectedProduct.slabs.filter((s:any)=>!s.isSold).map((slab:any)=>{
                                const isSel = builder.selectedSlabIds.includes(slab.id);
                                const parts = (slab.slabNo||'').split('-');
                                const serial = parts[parts.length-1];
                                const prefix = parts.slice(0,-1).join('-');
                                const hFt = slab.heightFt||slab.lengthFt||0;
                                const wIn = slab.lengthIn||slab.heightIn||0;
                                const sizeLabel = hFt && wIn ? `${hFt}ft × ${wIn}"` : '';
                                return (
                                  <tr key={slab.id}
                                    onClick={()=>{
                                      if(isSel) setBuilder({...builder,selectedSlabIds:builder.selectedSlabIds.filter(id=>id!==slab.id)});
                                      else setBuilder({...builder,selectedSlabIds:[...builder.selectedSlabIds,slab.id]});
                                    }}
                                    className={`cursor-pointer transition-all ${isSel?'bg-amber-600/30 hover:bg-amber-600/40':'hover:bg-white/5'}`}>
                                    <td className="px-3 py-2">
                                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSel?'bg-amber-500 border-amber-400':'border-white/20'}`}>
                                        {isSel && <i className="fas fa-check text-[8px] text-white"></i>}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="font-black text-white text-xs">#{serial}</div>
                                      <div className="text-[8px] text-slate-500 font-bold truncate">{prefix}</div>
                                    </td>
                                    <td className="px-3 py-2 text-center text-[10px] font-bold text-slate-300 whitespace-nowrap">{sizeLabel}</td>
                                    <td className="px-3 py-2 text-center font-black text-amber-400 text-xs">{(slab.sqft||0).toFixed(2)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {/* Total bar */}
                        {builder.selectedSlabIds.length > 0 && (
                          <div className="flex justify-between items-center px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                            <div className="text-[9px] font-black text-amber-400 uppercase">{builder.selectedSlabIds.length} slabs selected</div>
                            <div className="text-lg font-black italic text-amber-300">
                              {selectedProduct.slabs.filter((s:any)=>builder.selectedSlabIds.includes(s.id)).reduce((a:number,s:any)=>a+(s.sqft||0),0).toFixed(2)} SqFt
                            </div>
                          </div>
                        )}
                    </div>
                ) : (
                    <div className="p-5 sm:p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4">
                        <h4 className="text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-widest">Inferred Units</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[8px] sm:text-[9px] font-bold text-slate-600 block mb-1">{selectedProduct?.unitType === 'Box' ? 'Boxes' : selectedProduct?.unitType === 'Bag' ? 'Bags' : selectedProduct?.unitType || 'Units'}</label>
                                <input type="number" className="w-full px-3 py-3 bg-slate-900 text-white border-0 rounded-xl font-black text-sm" value={builder.qtyBoxes} onChange={e => syncFromUnits(parseInt(e.target.value || '0'), builder.qtyPieces)} />
                            </div>
                            <div>
                                <label className="text-[8px] sm:text-[9px] font-bold text-slate-600 block mb-1">Loose Pcs</label>
                                <input type="number" className="w-full px-3 py-3 bg-slate-900 text-white border-0 rounded-xl font-black text-sm" value={builder.qtyPieces} onChange={e => syncFromUnits(builder.qtyBoxes, parseInt(e.target.value || '0'))} />
                            </div>
                        </div>
                    </div>
                )}

                <div className="p-5 sm:p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4">
                   <div className="flex justify-between items-center">
                     <h4 className="text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-widest">Rate ({builder.priceBasis})</h4>
                     <div className="flex bg-slate-900 rounded-lg p-0.5 border border-white/5">
                        <button onClick={() => handlePriceBasisToggle('Box')} className={`px-2 py-1 text-[8px] font-black rounded uppercase transition-all ${builder.priceBasis === 'Box' ? 'bg-amber-600 text-white' : 'text-slate-500'}`}>Box</button>
                        <button onClick={() => handlePriceBasisToggle('Sqft')} className={`px-2 py-1 text-[8px] font-black rounded uppercase transition-all ${builder.priceBasis === 'Sqft' ? 'bg-amber-600 text-white' : 'text-slate-500'}`}>Sqft</button>
                     </div>
                   </div>
                   <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-black italic">₹</span>
                      <input type="number" className="w-full pl-10 pr-4 py-3 bg-slate-900 text-white border-0 rounded-xl font-black text-xl" value={builder.rate} onChange={e => setBuilder({...builder, rate: parseFloat(e.target.value || '0')})} />
                    </div>
                    <div className="relative">
                       <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 font-black italic">₹</span>
                       <input type="number" className="w-full pl-10 pr-4 py-3 bg-slate-900 text-emerald-400 border-0 rounded-xl font-black text-xl" value={ratePerSqft} onChange={e => handleRatePerSqftChange(parseFloat(e.target.value || '0'))} />
                       <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-slate-600 uppercase">Per Sqft</span>
                   </div>
                </div>
              </div>
            </div>

            <button onClick={addItem} className="w-full py-5 bg-white text-slate-950 rounded-3xl font-black text-lg sm:text-xl hover:bg-slate-100 transition-all shadow-2xl active:scale-95 uppercase tracking-tighter">
                Add Entry to Estimate
            </button>
          </div>
        </div>

        <div className="space-y-8">
           {isAdmin && (
               <div className={`p-8 rounded-[30px] sm:rounded-[40px] shadow-2xl transition-all duration-500 border-2 ${liveProfitability.profit < 0 ? 'bg-rose-950 border-rose-500' : 'bg-slate-950 border-emerald-900/30'} text-white space-y-4`}>
                  <div className="flex justify-between items-center opacity-60">
                     <h4 className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em]">Margin Intelligence</h4>
                     <i className={`fas ${liveProfitability.profit < 0 ? 'fa-exclamation-triangle text-rose-500 animate-pulse' : 'fa-check-circle text-emerald-500'}`}></i>
                  </div>
                  <div className="flex justify-between items-end">
                     <div>
                        <div className="text-2xl sm:text-3xl font-black italic tracking-tighter">
                           {liveProfitability.margin.toFixed(1)}%
                        </div>
                        <div className="text-[8px] font-bold text-slate-500 uppercase">Markup % on Cost</div>
                        {(liveProfitability as any).totalCogs > 0 && (
                          <div className="text-[8px] font-bold text-slate-600 mt-1">
                            COGS: ₹{(liveProfitability as any).totalCogs.toLocaleString('en-IN')}
                          </div>
                        )}
                        {(liveProfitability as any).comm > 0 && (
                          <div className="text-[8px] font-bold text-purple-500 mt-0.5">
                            Comm: -₹{Math.round((liveProfitability as any).comm).toLocaleString('en-IN')}
                          </div>
                        )}
                        {(liveProfitability as any).refComm > 0 && (
                          <div className="text-[8px] font-bold text-rose-500 mt-0.5">
                            Referral: -₹{Math.round((liveProfitability as any).refComm).toLocaleString('en-IN')}
                          </div>
                        )}
                     </div>
                     <div className="text-right">
                        <div className={`text-lg sm:text-xl font-black italic ${liveProfitability.profit < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                           ₹{liveProfitability.profit.toLocaleString()}
                        </div>
                        <div className="text-[8px] font-bold text-slate-500 uppercase">Contribution</div>
                     </div>
                  </div>
               </div>
           )}

           <div className="bg-white p-6 sm:p-8 rounded-[30px] sm:rounded-[40px] shadow-sm border border-slate-100 flex flex-col min-h-[400px]">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3">
                <h3 className="font-black text-slate-800 uppercase tracking-widest text-[9px] sm:text-[10px]">Stack ({items.length})</h3>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-[9px] font-black text-slate-400 uppercase">Offer:</span>
                  <select className="flex-1 sm:w-32 bg-slate-50 border rounded-xl px-3 py-1.5 font-black text-[9px] uppercase outline-none focus:ring-1 focus:ring-amber-500" value={selectedOfferId} onChange={e => setSelectedOfferId(e.target.value)}>
                    <option value="">None</option>
                    {activeOffers.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto max-h-[400px] scrollbar-hide">
                 {items.length === 0 ? (
                    <div className="py-20 text-center text-slate-200 font-black italic text-2xl uppercase tracking-tighter">Empty</div>
                 ) : (
                    items.map((item, idx) => {
                       const isSlab = ['Granite','Marble','Kadapa'].includes(item.productCategory || '');
                       const product = store.products.find(p => p.id === item.productId);
                       return (
                         <div key={item.id} className="bg-white border border-slate-200 rounded-2xl p-4 group hover:shadow-md hover:border-slate-300 transition-all relative">

                           {/* Delete */}
                           <button onClick={() => setItems(items.filter((_, i) => i !== idx))}
                             className="absolute -top-2 -right-2 bg-rose-500 text-white w-6 h-6 rounded-full text-[10px] opacity-0 group-hover:opacity-100 flex items-center justify-center shadow-lg transition-all z-10">
                             <i className="fas fa-times"></i>
                           </button>

                           {/* Row 1: Product name + category badge + amount */}
                           <div className="flex items-start justify-between gap-3">
                             <div className="flex-1 min-w-0">
                               <div className="font-black text-slate-900 text-sm leading-tight">{item.productName}</div>
                               <div className="flex items-center gap-2 mt-1 flex-wrap">
                                 {item.productCategory && (
                                   <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">{item.productCategory}</span>
                                 )}
                                 {item.purpose && (
                                   <span className="text-[8px] font-bold text-amber-600 italic">{item.purpose}</span>
                                 )}
                                 {item.discountAmount ? (
                                   <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">Offer Active</span>
                                 ) : null}
                               </div>
                             </div>
                             <div className="text-right shrink-0">
                               {item.discountAmount ? (
                                 <>
                                   <div className="text-[10px] text-slate-300 line-through">₹{Math.round(item.amount + item.discountAmount).toLocaleString('en-IN')}</div>
                                   <div className="font-black text-emerald-600 text-base">₹{Math.round(item.amount).toLocaleString('en-IN')}</div>
                                 </>
                               ) : (
                                 <div className="font-black text-slate-900 text-base">₹{Math.round(item.amount).toLocaleString('en-IN')}</div>
                               )}
                               <div className="text-[8px] text-slate-400 font-bold mt-0.5">{isSlab ? `${item.reqSqft} SqFt` : `${item.qtyBoxes}B ${item.qtyPieces > 0 ? `+ ${item.qtyPieces}P` : ''}`}</div>
                             </div>
                           </div>

                           {/* Row 2: Editable fields */}
                           <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2 items-center">

                             {isSlab ? (
                               /* Slab: editable SqFt + rate/sqft */
                               <>
                                 <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                   <span className="text-[8px] font-black text-amber-500 uppercase shrink-0">SqFt</span>
                                   <input type="number" step="0.01"
                                     className="w-16 bg-transparent text-amber-800 font-black text-sm outline-none"
                                     value={item.reqSqft || ''}
                                     onChange={e => updateSlabSqft(item.id, parseFloat(e.target.value || '0'))} />
                                 </div>
                                 <span className="text-slate-400 text-xs font-bold">×</span>
                                 <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
                                   <span className="text-[8px] font-black text-indigo-400 uppercase shrink-0">₹/SqFt</span>
                                   <input type="number" step="0.5"
                                     className="w-16 bg-transparent text-indigo-700 font-black text-sm outline-none"
                                     value={item.rate || ''}
                                     onChange={e => updateItemRate(item.id, parseFloat(e.target.value || '0'))} />
                                 </div>
                                 <span className="text-[9px] font-black text-slate-400">=</span>
                                 <span className="text-sm font-black text-slate-800">₹{Math.round(item.amount).toLocaleString('en-IN')}</span>
                               </>
                             ) : (
                               /* Tile: box/piece steppers + editable rate */
                               <>
                                 <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
                                   <button onClick={() => updateItemQty(item.id, -1, 0)} className="w-7 h-7 rounded-lg bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50 shadow-sm text-[10px]"><i className="fas fa-minus"></i></button>
                                   <span className="px-3 text-sm font-black text-slate-800 min-w-[32px] text-center">{item.qtyBoxes}</span>
                                   <button onClick={() => updateItemQty(item.id, 1, 0)} className="w-7 h-7 rounded-lg bg-white text-slate-600 flex items-center justify-center hover:bg-slate-50 shadow-sm text-[10px]"><i className="fas fa-plus"></i></button>
                                 </div>
                                 <span className="text-[9px] font-bold text-slate-400">{product?.unitType === 'Bag' ? 'Bags' : 'Boxes'}</span>
                                 {item.qtyPieces > 0 && (
                                   <span className="text-[9px] font-black text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">+{item.qtyPieces} pcs</span>
                                 )}
                                 <span className="text-slate-300 text-xs mx-1">|</span>
                                 <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
                                   <span className="text-[8px] font-black text-indigo-400 uppercase shrink-0">₹/{item.priceBasis}</span>
                                   <input type="number" step="0.5"
                                     className="w-16 bg-transparent text-indigo-700 font-black text-sm outline-none"
                                     value={item.rate || ''}
                                     onChange={e => updateItemRate(item.id, parseFloat(e.target.value || '0'))} />
                                 </div>
                                 {item.reqSqft > 0 && (
                                   <span className="text-[8px] text-slate-400 font-bold ml-auto">{item.reqSqft} SqFt</span>
                                 )}
                               </>
                             )}
                           </div>
                         </div>
                       );
                    })
                 )}
              </div>

              <div className="mt-8 space-y-4">
                 <div className="bg-slate-900 p-5 sm:p-6 rounded-[25px] sm:rounded-[30px] text-white space-y-6">
                    <div className="space-y-4">
                       <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-2">Settlement</label>
                       
                       <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/10 gap-2">
                          <div>
                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Discount</div>
                            <div className="flex gap-2">
                               <input type="number" className="w-14 bg-transparent border-b border-white/20 outline-none text-xs font-black text-amber-500" value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))} />
                               <select className="bg-transparent text-[8px] font-black outline-none cursor-pointer" value={discountType} onChange={e => setDiscountType(e.target.value as any)}>
                                  <option value="Percentage" className="text-slate-900">%</option>
                                  <option value="Fixed" className="text-slate-900">₹</option>
                               </select>
                            </div>
                          </div>
                          <div className="text-right">
                             <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Savings</div>
                             <div className="font-black text-amber-500 text-[10px]">- ₹{currentGlobalDiscount.toLocaleString()}</div>
                          </div>
                       </div>

                       <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/10 gap-2">
                          <div>
                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Commission</div>
                            <div className="flex gap-2">
                               <input type="number" className="w-14 bg-transparent border-b border-white/20 outline-none text-xs font-black text-purple-400" value={globalComm} onChange={e => setGlobalComm(Number(e.target.value))} />
                               <select className="bg-transparent text-[8px] font-black outline-none cursor-pointer" value={globalCommType} onChange={e => setGlobalCommType(e.target.value as any)}>
                                  <option value="Percentage" className="text-slate-900">%</option>
                                  <option value="Fixed" className="text-slate-900">₹</option>
                               </select>
                            </div>
                          </div>
                          <div className="text-right">
                             <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Payout</div>
                             <div className="font-black text-purple-400 text-[10px]">₹{(globalCommType === 'Fixed' ? globalComm : (taxableAmount * globalComm) / 100).toLocaleString()}</div>
                          </div>
                       </div>

                       {/* Referral Agent — mirrors Billing & POS */}
                       <div className="bg-white/5 p-4 rounded-2xl border border-white/10 space-y-2">
                         <div className="text-[8px] font-black text-amber-400 uppercase tracking-widest">Referral Agent (optional)</div>
                         <select className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none focus:border-amber-400 appearance-none" style={{colorScheme:'dark'}}
                           value={referralAgentId} onChange={e=>setReferralAgentId(e.target.value)}>
                           <option value="">No referral agent</option>
                           {(store.referralAgents||[]).map(a=>(
                             <option key={a.id} value={a.id} style={{background:'#1e293b'}}>{a.name} ({a.type})</option>
                           ))}
                         </select>
                         {referralAgentId && (
                           <div className="flex gap-2 items-center">
                             <span className="text-[8px] text-slate-400 font-black">Commission:</span>
                             <input type="number" className="w-14 bg-transparent border-b border-white/20 outline-none text-xs font-black text-amber-400"
                               value={refCommValue} onChange={e=>setRefCommValue(+e.target.value)} placeholder="0"/>
                             <select className="bg-transparent text-[8px] font-black outline-none" value={refCommType} onChange={e=>setRefCommType(e.target.value as any)} style={{colorScheme:'dark'}}>
                               <option value="Percentage" style={{background:'#1e293b'}}>%</option>
                               <option value="Fixed" style={{background:'#1e293b'}}>₹</option>
                             </select>
                             <span className="text-amber-400 font-black text-[10px] ml-auto">
                               ₹{(refCommType==='Fixed'?refCommValue:(taxableAmount*refCommValue)/100).toLocaleString()}
                             </span>
                           </div>
                         )}
                       </div>
                    </div>

                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-2 block">Remarks</label>
                    <textarea 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-xs font-bold outline-none focus:border-amber-500 transition-all text-white placeholder:text-white/10 text-sm"
                      rows={2}
                      placeholder="Estimate notes..."
                      value={remarks}
                      onChange={e => setRemarks(e.target.value)}
                    />
                 </div>

                 <div className="bg-slate-100 p-5 sm:p-6 rounded-[25px] sm:rounded-[30px] border-2 border-slate-200 flex justify-between items-center shadow-inner">
                    <div className="flex flex-col">
                       <span className="font-black text-slate-900 uppercase text-[10px] sm:text-xs leading-none">Total</span>
                       <span className="text-[7px] sm:text-[9px] font-bold text-emerald-600 uppercase tracking-tighter mt-1">Saved ₹{totalSavings.toLocaleString()}</span>
                       {loadingCharges > 0 && (
                          <span className="text-[7px] sm:text-[8px] font-bold text-amber-600 uppercase tracking-tighter mt-0.5">Incl. Loading ₹{loadingCharges.toLocaleString()}</span>
                       )}
                       {referralAgentId && refCommValue > 0 && (
                         <span className="text-[7px] sm:text-[8px] font-bold text-rose-500 uppercase tracking-tighter mt-0.5">
                           Referral: -₹{Math.round(refCommType==='Fixed'?refCommValue:(totalAmount*refCommValue)/100).toLocaleString()}
                         </span>
                       )}
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-2xl sm:text-3xl font-black text-slate-900 italic tracking-tighter">₹{totalAmount.toLocaleString()}</span>
                      {referralAgentId && refCommValue > 0 && (() => {
                        const refAmt = Math.round(refCommType==='Fixed'?refCommValue:(totalAmount*refCommValue)/100);
                        const netAfterRef = totalAmount - refAmt;
                        return (
                          <span className="text-[10px] font-black text-rose-600 mt-0.5">
                            Net after referral: ₹{netAfterRef.toLocaleString()}
                          </span>
                        );
                      })()}
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>
      {/* ── HISTORY VIEW ── */}


      {/* Quick Product Modal */}
      <QuickProductModal 
        isOpen={showQuickProduct} 
        onClose={() => setShowQuickProduct(false)} 
        onSuccess={(productId) => {
          handleProductSelect(productId);
        }} 
      />
    </div>
  );
};

export default Quotations;
