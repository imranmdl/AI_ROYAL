
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { store } from '../store';
import { Product, SaleItem, Sale, Quotation, Customer, Offer, UserRole, CustomFieldValue, Return, ReturnItem } from '../types';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import QuickProductModal from './QuickProductModal';

interface SalesProps {
  initialQuotation?: Quotation | null;
  onInvoiceCreated?: () => void;
}

const Sales: React.FC<SalesProps> = ({ initialQuotation, onInvoiceCreated }) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [customer, setCustomer] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [customerGst, setCustomerGst] = useState('');
  const [remarks, setRemarks] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [referralAgentId, setReferralAgentId]     = useState('');
  const [refCommType, setRefCommType]             = useState<'Percentage'|'Fixed'>('Percentage');
  const [refCommValue, setRefCommValue]           = useState(0);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [purpose, setPurpose] = useState(''); 
  const [boxQty, setBoxQty] = useState(1);
  const [looseQty, setLooseQty] = useState(0);
  const [rate, setRate] = useState(0);
  const [sourceGodownId, setSourceGodownId] = useState('g1');
  const [priceBasis, setPriceBasis] = useState<'Box' | 'Sqft'>('Box');
  const [paymentType, setPaymentType] = useState<'Cash' | 'UPI' | 'Card' | 'Credit' | 'Mixed'>('Cash');
  const [amountPaid, setAmountPaid] = useState(0);
  const [isFullPayment, setIsFullPayment] = useState(true);
  const [viewMode, setViewMode]     = useState<'billing' | 'history' | 'preview'>('billing');
  const [showItemImages, setShowItemImages] = useState(store.settings.allowItemImagesInDocs === true);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [sqft, setSqft] = useState(0);
  const [selectedSlabIds, setSelectedSlabIds] = useState<string[]>([]);
  const [sellingSlabSqft, setSellingSlabSqft] = useState<number>(0); // manual override at billing
  
  const [markup, setMarkup] = useState(0);
  
  const [, setTick] = useState(0);

  const isAdmin = store.currentUser?.role === UserRole.ADMIN;

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setTick(t => t + 1);
    });
    return unsubscribe;
  }, []);

  const [customFields, setCustomFields] = useState<CustomFieldValue[]>(
    store.settings.customInvoiceFieldLabels.map(label => ({ label, value: '' }))
  );

  const [selectedOfferId, setSelectedOfferId] = useState<string>('');
  const activeOffers = useMemo(() => store.offers.filter(o => o.status === 'Published'), [store.offers]);

  const [historySearch, setHistorySearch] = useState('');
  const [discountValue, setDiscountValue] = useState(0);
  const [discountType, setDiscountType] = useState<'Fixed' | 'Percentage'>('Fixed');
  const [gstPercent, setGstPercent] = useState(18);
  const [isGstIncluded, setIsGstIncluded] = useState(false);
  const [showQuickProduct, setShowQuickProduct] = useState(false);

  const [commissionValue, setCommissionValue] = useState(0);
  const [commissionType, setCommissionType] = useState<'Fixed' | 'Percentage'>('Percentage');

  const groupedItems = useMemo(() => {
    if (!selectedSale) return null;
    const groups: Record<string, SaleItem[]> = {};
    selectedSale.items.forEach(item => {
      const cat = item.productCategory || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [selectedSale]);

  const categoryTotals = useMemo(() => {
    if (!selectedSale) return null;
    const totals: Record<string, { sqft: number, boxes: number, loose: number, amount: number }> = {};
    selectedSale.items.forEach(item => {
      const cat = item.productCategory || 'Other';
      if (!totals[cat]) totals[cat] = { sqft: 0, boxes: 0, loose: 0, amount: 0 };
      totals[cat].sqft += item.sqft || 0;
      totals[cat].boxes += item.qtyBoxes || 0;
      totals[cat].loose += item.qtyLoose || 0;
      totals[cat].amount += item.amount || 0;
    });
    return totals;
  }, [selectedSale]);

  const selectedProduct = useMemo(() => 
    store.products.find(p => p.id === selectedProductId),
    [selectedProductId, store.products]
  );

  // Auto-apply selected offer logic
  useEffect(() => {
    const offer = activeOffers.find(o => o.id === selectedOfferId);
    
    setCart(prev => prev.map(item => {
      const product = store.products.find(p => p.id === item.productId);
      const isTargeted = offer ? (offer.targetProductIds.includes(item.productId) || (product && offer.targetCategories.includes(product.category))) : false;
      
      const tpb = product?.tilesPerBox || 1;
      const totalUnitsAsBoxes = item.qtyBoxes + (item.qtyLoose / tpb);
      const baseAmount = item.priceBasis === 'Box' ? totalUnitsAsBoxes * item.rate : item.sqft * item.rate;

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

  const currentSubTotal = cart.reduce((sum, i) => sum + (i.amount + (i.discountAmount || 0)), 0);
  const currentGlobalDiscount = discountType === 'Fixed' ? discountValue : (currentSubTotal * discountValue) / 100;
  const currentTaxable = cart.reduce((sum, i) => sum + i.amount, 0) - currentGlobalDiscount;
  const currentGst = isGstIncluded ? 0 : (currentTaxable * gstPercent) / 100;
  
  const loadingCharges = useMemo(() => store.calculateLoadingCharges(cart), [cart]);
  
  const currentTotal = parseFloat((currentTaxable + currentGst + loadingCharges).toFixed(2));

  useEffect(() => {
    if (isFullPayment) setAmountPaid(currentTotal);
    else if (paymentType === 'Credit') setAmountPaid(0);
  }, [currentTotal, isFullPayment, paymentType]);

  useEffect(() => {
    if (['Cash', 'UPI', 'Card'].includes(paymentType)) setIsFullPayment(true);
    else setIsFullPayment(false);
  }, [paymentType]);

  useEffect(() => {
    if (selectedProduct) {
      const isSlab = selectedProduct.category === 'Kadapa' || selectedProduct.category === 'Granite' || selectedProduct.category === 'Marble';
      const sqftPerBox = selectedProduct.sqftPerBox || 1;
      
      const initialRate = priceBasis === 'Sqft' ? selectedProduct.sellingPrice / sqftPerBox : selectedProduct.sellingPrice;
      setRate(parseFloat(initialRate.toFixed(2)));
      
      const cost = selectedProduct.totalCostPerUnit || 0;
      if (cost > 0) {
        const initialMarkup = ((selectedProduct.sellingPrice - cost) / cost) * 100;
        setMarkup(parseFloat(initialMarkup.toFixed(2)));
      } else {
        setMarkup(0);
      }

      const suggested = store.suggestCommission(store.currentUser?.id || 'sys', selectedProduct.id);
      setCommissionValue(suggested.value);
      setCommissionType(suggested.type as 'Fixed' | 'Percentage');
      
      // Auto-calc initial sqft
      const hasSlabs = isSlab && selectedProduct.slabs && selectedProduct.slabs.length > 0;
      
      if (hasSlabs) {
        setBoxQty(0);
        setLooseQty(0);
        setSqft(0);
      } else {
        setSqft(parseFloat((boxQty * sqftPerBox).toFixed(2)));
      }
      setSelectedSlabIds([]);
      setSellingSlabSqft(0);
    }
  }, [selectedProduct, priceBasis]);

  // Update sqft when slabs are selected
  useEffect(() => {
    if (selectedProduct && selectedSlabIds.length > 0 && selectedProduct.slabs) {
      const selectedSlabs = selectedProduct.slabs.filter(s => selectedSlabIds.includes(s.id));
      const totalSqft = selectedSlabs.reduce((acc, s) => acc + s.sqft, 0);
      setSqft(parseFloat(totalSqft.toFixed(2)));
      setBoxQty(selectedSlabIds.length);
      setLooseQty(0);
    }
  }, [selectedSlabIds, selectedProduct]);

  // Auto-calculation logic for quantities
  const syncFromUnits = (boxes: number, pieces: number) => {
    if (!selectedProduct) return;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    const pcsPerBox = selectedProduct.tilesPerBox || 1;
    const totalSqft = (boxes * sqftPerBox) + (pieces * (sqftPerBox / pcsPerBox));
    setBoxQty(boxes);
    setLooseQty(pieces);
    setSqft(parseFloat(totalSqft.toFixed(2)));
  };

  const syncFromSqft = (val: number) => {
    if (!selectedProduct) return;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    const pcsPerBox = selectedProduct.tilesPerBox || 1;
    const sqftPerPiece = sqftPerBox / pcsPerBox;
    const boxes = Math.floor(val / sqftPerBox);
    const pieces = Math.ceil((val % sqftPerBox) / sqftPerPiece);
    setBoxQty(boxes);
    setLooseQty(pieces);
    setSqft(val);
  };

  useEffect(() => {
    if (initialQuotation) {
      setCustomer(initialQuotation.customerName);
      setMobile(initialQuotation.customerMobile);
      setAddress(initialQuotation.customerAddress);
      // ── Commission ───────────────────────────────────────────────────────
      setCommissionValue(initialQuotation.globalCommission || 0);
      setCommissionType(initialQuotation.globalCommissionType || 'Percentage');
      // ── Referral agent — auto-populated from quotation ───────────────────
      if ((initialQuotation as any).referralAgentId) {
        setReferralAgentId((initialQuotation as any).referralAgentId);
        setRefCommValue((initialQuotation as any).referralCommissionValue || 0);
        setRefCommType((initialQuotation as any).referralCommissionType || 'Percentage');
      }
      // ── Discount — Direct Commercial Offset from quotation ────────────────
      setDiscountValue(initialQuotation.discountValue || 0);
      setDiscountType(initialQuotation.discountType || 'Percentage');
      // ── Other fields ─────────────────────────────────────────────────────
      setGstPercent(initialQuotation.gstPercent || 18);
      setIsGstIncluded(initialQuotation.isGstIncluded);
      setSelectedOfferId(initialQuotation.appliedOfferId || '');
      setCart(initialQuotation.items.map(it => ({
        productId: it.productId, 
        productName: it.productName, 
        productCategory: it.productCategory,
        purpose: it.purpose || 'General', 
        qtyBoxes: it.qtyBoxes, 
        qtyLoose: it.qtyPieces, 
        rate: it.rate, 
        costRate: it.costRate,
        priceBasis: it.priceBasis, 
        sqft: it.reqSqft, 
        amount: it.amount,
        discountAmount: it.discountAmount,   // ← item-level discount preserved
        sourceGodownId: 'g1',
        selectedSlabIds: it.selectedSlabIds
      })));
    }
  }, [initialQuotation]);

  const handleEditSale = (sale: Sale) => {
    setEditingSaleId(sale.id);
    setCustomer(sale.customerName);
    setMobile(sale.customerMobile || '');
    setAddress(sale.customerAddress || '');
    setCustomerGst(sale.customerGst || '');
    setRemarks(sale.remarks || '');
    setCart(sale.items);
    setDiscountValue(sale.discountValue);
    setDiscountType(sale.discountType);
    setGstPercent(sale.gstPercent);
    setIsGstIncluded(sale.isGstIncluded);
    setCommissionValue(sale.commissionValue);
    setCommissionType(sale.commissionType);
    setPaymentType(sale.paymentType);
    setAmountPaid(sale.amountPaid);
    setCustomFields(sale.customFields || store.settings.customInvoiceFieldLabels.map(label => ({ label, value: '' })));
    setViewMode('billing');
  };

  const handleMarkupChange = (val: number) => {
    setMarkup(val);
    if (selectedProduct) {
      const sqftPerBox = selectedProduct.sqftPerBox || 1;
      const cost = selectedProduct.totalCostPerUnit || 0; 
      
      let costPerBasis = cost;
      if (priceBasis === 'Sqft') {
        costPerBasis = cost / sqftPerBox;
      }
        
      const newRate = costPerBasis + (costPerBasis * val) / 100;
      setRate(parseFloat(newRate.toFixed(2)));
    }
  };

  const handleRateChange = (val: number) => {
    setRate(val);
    if (selectedProduct) {
      const sqftPerBox = selectedProduct.sqftPerBox || 1;
      const cost = selectedProduct.totalCostPerUnit || 0;
      
      if (cost > 0) {
        let costPerBasis = cost;
        if (priceBasis === 'Sqft') {
          costPerBasis = cost / sqftPerBox;
        }
          
        const newMarkup = ((val - costPerBasis) / costPerBasis) * 100;
        setMarkup(parseFloat(newMarkup.toFixed(2)));
      }
    }
  };

  const ratePerSqft = useMemo(() => {
    if (!selectedProduct) return 0;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    return priceBasis === 'Box' ? parseFloat((rate / sqftPerBox).toFixed(2)) : rate;
  }, [rate, priceBasis, selectedProduct]);

  const handleRatePerSqftChange = (val: number) => {
    if (!selectedProduct) return;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    if (priceBasis === 'Box') {
      handleRateChange(parseFloat((val * sqftPerBox).toFixed(2)));
    } else {
      handleRateChange(val);
    }
  };

  const handleAddItem = () => {
    if (!selectedProduct) return;
    const tpb = selectedProduct.tilesPerBox || 1;
    const sqftPerBox = selectedProduct.sqftPerBox || 1;
    
    let finalSqft = sqft;
    let finalBoxQty = boxQty;
    let finalLooseQty = looseQty;

    if (selectedSlabIds.length > 0 && selectedProduct.slabs) {
        const selectedSlabs = selectedProduct.slabs.filter(s => selectedSlabIds.includes(s.id));
        finalSqft = selectedSlabs.reduce((acc, s) => acc + s.sqft, 0);
        finalBoxQty = selectedSlabs.length;
        finalLooseQty = 0;
    }

    let baseAmount = priceBasis === 'Box' ? (finalBoxQty + (finalLooseQty / tpb)) * rate : finalSqft * rate;
    
    setCart([...cart, {
      productId: selectedProduct.id, 
      productName: selectedProduct.name, 
      productCategory: selectedProduct.category,
      purpose: purpose || 'General',
      qtyBoxes: finalBoxQty, qtyLoose: finalLooseQty, rate: rate, costRate: selectedProduct.totalCostPerUnit,
      priceBasis: priceBasis, sqft: parseFloat(finalSqft.toFixed(2)), amount: parseFloat(baseAmount.toFixed(2)),
      sourceGodownId,
      selectedSlabIds: selectedSlabIds.length > 0 ? selectedSlabIds : undefined
    }]);
    setBoxQty(1); setLooseQty(0); setSqft(0); setPurpose(''); setSelectedProductId(''); setProductSearch('');
    setSelectedSlabIds([]);
  };

  const handleGenerateInvoice = (status: Sale['status'] = 'Active') => {
    if (cart.length === 0 || isSaving) return;   // ← prevent double-submit
    setIsSaving(true);
    try {
      const finalAmountPaid = isFullPayment ? currentTotal : amountPaid;
      const genInvoiceNo = editingSaleId
        ? (store.sales.find(s => s.id === editingSaleId)?.invoiceNo || `RT-${Math.floor(1000 + Math.random() * 9000)}`)
        : `RT-${Math.floor(1000 + Math.random() * 9000)}`;
      const saleDate = new Date().toLocaleDateString();

      // Referral commission amount (computed here once with correct total)
      const refCommissionAmt = referralAgentId && refCommValue > 0
        ? (refCommType === 'Percentage' ? +((currentTotal * refCommValue / 100).toFixed(2)) : refCommValue)
        : undefined;

      const saleData: Sale = {
        id: editingSaleId || Date.now().toString(),
        invoiceNo: genInvoiceNo,
        customerName: customer || 'Walk-in',
        customerMobile: mobile, customerAddress: address, customerGst, date: saleDate,
        items: cart, subTotal: currentSubTotal, discountValue, discountType,
        gstPercent: gstPercent, gstAmount: currentGst,
        loadingCharges,
        totalAmount: currentTotal, isGstIncluded, amountPaid: finalAmountPaid, balance: parseFloat((currentTotal - finalAmountPaid).toFixed(2)),
        paymentType, salesPersonId: store.currentUser?.id || 'sys', salesPersonName: store.currentUser?.name || 'Admin',
        referralAgentId: referralAgentId || undefined,
        referralAgentName: referralAgentId ? (store.referralAgents||[]).find(a=>a.id===referralAgentId)?.name : undefined,
        referralCommissionType: referralAgentId ? refCommType : undefined,
        referralCommissionValue: referralAgentId ? refCommValue : undefined,
        referralCommissionAmount: refCommissionAmt,
        commissionValue, commissionType, commissionStatus: 'Accrued', remarks, customFields,
        appliedOfferId: selectedOfferId || undefined,
        status
      };

      if (editingSaleId) {
        store.updateSale(editingSaleId, saleData);
      } else {
        store.addSale(saleData);
        // Auto-create referral commission tracking entry
        if (referralAgentId && refCommValue > 0 && refCommissionAmt) {
          store.linkSaleToReferralAgent(
            saleData.id, genInvoiceNo, saleData.customerName, saleDate,
            currentTotal, referralAgentId, refCommType, refCommValue
          );
        }
      }

      setSelectedSale(saleData);
      // Reset cart + form fields and ALWAYS route to invoice preview
      setCart([]); setCustomer(''); setMobile(''); setAddress(''); setAmountPaid(0);
      setIsFullPayment(true); setEditingSaleId(null);
      setReferralAgentId(''); setRefCommValue(0);
      setViewMode('preview');   // ← always navigate to PDF/preview immediately
      onInvoiceCreated?.();
    } finally {
      setIsSaving(false);
    }
  };

  const [serverSales, setServerSales] = useState<Sale[]>([]);
  const [totalServerSales, setTotalServerSales] = useState(0);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);

  const fetchSales = async (page: number, isLoadMore: boolean = false) => {
    if (isHistoryLoading) return;
    setIsHistoryLoading(true);
    try {
      const result = await store.fetchSalesPage(page, 50, historySearch);
      if (isLoadMore) {
        setServerSales(prev => [...prev, ...result.data]);
      } else {
        setServerSales(result.data);
      }
      setTotalServerSales(result.total);
      setHasMoreHistory(result.data.length === 50);
    } catch (e) {
      console.error(e);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'history') {
      fetchSales(1, false);
      setHistoryPage(1);
    }
  }, [viewMode, historySearch]);

  const loadMoreHistory = () => {
    const nextPage = historyPage + 1;
    setHistoryPage(nextPage);
    fetchSales(nextPage, true);
  };

  const filteredSalesHistory = useMemo(() => {
    if (serverSales.length > 0) return serverSales;
    return store.sales.filter(s => {
      const q = historySearch.toLowerCase();
      return s.customerName.toLowerCase().includes(q) || s.invoiceNo.toLowerCase().includes(q);
    }).sort((a, b) => b.id.localeCompare(a.id));
  }, [store.sales, historySearch, serverSales]);

  // Skeleton Row for Sales
  const SalesSkeletonRow = () => (
    <tr className="animate-pulse border-b border-slate-100">
      <td className="px-8 py-6"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
      <td className="px-8 py-6"><div className="h-4 bg-slate-200 rounded w-32"></div></td>
      <td className="px-8 py-6"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
      <td className="px-8 py-6"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
      <td className="px-8 py-6"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
      <td className="px-8 py-6 text-center"><div className="h-4 bg-slate-200 rounded w-16 mx-auto"></div></td>
      <td className="px-8 py-6 text-center"><div className="h-4 bg-slate-200 rounded w-20 mx-auto"></div></td>
    </tr>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20 px-2 sm:px-0">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="w-full">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tighter uppercase italic">Cloud Billing & POS</h1>
          <p className="text-slate-500 font-bold uppercase text-[9px] sm:text-[10px] tracking-widest mt-1 italic">Precision Node Real-time Synchronicity</p>
        </div>
        <div className="flex bg-white p-1 rounded-2xl border shadow-sm w-full md:w-auto">
          <button onClick={() => setViewMode('billing')} className={`flex-1 md:px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${viewMode === 'billing' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-400'}`}>New Billing</button>
          <button onClick={() => setViewMode('history')} className={`flex-1 md:px-8 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${viewMode === 'history' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-400'}`}>Sales Ledger</button>
        </div>
      </header>

      {viewMode === 'billing' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           <div className="lg:col-span-2 space-y-6">
              {/* Step 1: Customer Identity */}
              <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600 text-xs font-black">01</div>
                     <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Customer Identity Node</h3>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <input type="text" placeholder="Customer Name" className="px-5 py-4 bg-slate-50 rounded-2xl border-2 border-slate-50 focus:border-amber-500 outline-none font-bold transition-all text-sm" value={customer} onChange={e => setCustomer(e.target.value)} />
                   <input type="text" placeholder="Mobile Number" className="px-5 py-4 bg-slate-50 rounded-2xl border-2 border-slate-50 focus:border-amber-500 outline-none font-bold transition-all text-sm" value={mobile} onChange={e => setMobile(e.target.value)} />
                   <input type="text" placeholder="Project Address" className="md:col-span-2 px-5 py-4 bg-slate-50 rounded-2xl border-2 border-slate-50 focus:border-amber-500 outline-none font-bold transition-all text-sm" value={address} onChange={e => setAddress(e.target.value)} />
                </div>

                {/* Logistics Trace (Vehicle / Site Engineer) */}
                <div className="mt-6 pt-6 border-t border-slate-50">
                   <h4 className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-4">Operational Logistics Trace</h4>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {customFields.map((field, idx) => (
                         <div key={idx} className="relative">
                            <label className="absolute left-4 -top-2 px-2 bg-white text-[8px] font-black text-slate-400 uppercase">{field.label}</label>
                            <input 
                              type="text" 
                              className="w-full px-5 py-4 bg-white rounded-xl border-2 border-slate-100 font-black text-xs outline-none focus:border-amber-500"
                              value={field.value}
                              onChange={e => {
                                 const next = [...customFields];
                                 next[idx].value = e.target.value;
                                 setCustomFields(next);
                              }}
                            />
                         </div>
                      ))}
                   </div>
                </div>
              </div>

              {/* Step 2: Material Requirement */}
              <div className="bg-slate-900 p-8 rounded-[40px] shadow-2xl relative overflow-hidden text-white">
                <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 blur-[80px] pointer-events-none"></div>
                <div className="flex items-center gap-3 mb-8">
                   <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-amber-500 text-xs font-black">02</div>
                   <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Material Provisioning</h3>
                   <button 
                     onClick={() => setShowQuickProduct(true)}
                     className="ml-auto bg-amber-500 text-white px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-amber-600 transition-all shadow-lg active:scale-95 flex items-center gap-2"
                   >
                     <i className="fas fa-plus"></i> New Item
                   </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div className="md:col-span-2 space-y-4">
                      <div className="relative">
                         <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                         <input 
                           type="text" 
                           placeholder="Search Item Name, Size or Category..." 
                           className="w-full pl-12 pr-5 py-4 bg-white/5 border-0 rounded-2xl font-black text-white focus:ring-2 focus:ring-amber-500 outline-none"
                           value={productSearch}
                           onChange={e => setProductSearch(e.target.value)}
                         />
                      </div>
                      <select className="w-full px-5 py-4 bg-white/5 border-0 rounded-2xl font-black text-white focus:ring-2 focus:ring-amber-500 outline-none appearance-none" value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
                         <option value="" className="bg-slate-900">Select Tile/Granite Model...</option>
                         {store.products
                           .filter(p => p.status === 'Active' && (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.category.toLowerCase().includes(productSearch.toLowerCase()) || p.size.toLowerCase().includes(productSearch.toLowerCase())))
                           .map(p => (
                            <option key={p.id} value={p.id} className="bg-slate-900">{p.name} ({p.size}) - {p.stockBoxes}B Avail.</option>
                         ))}
                      </select>
                   </div>
                   
                   <div className="grid grid-cols-3 gap-4">
                      {(selectedProduct?.category === 'Granite' || selectedProduct?.category === 'Marble' || selectedProduct?.category === 'Kadapa') && selectedProduct.slabs && selectedProduct.slabs.length > 0 ? (
                         <div className="col-span-1">
                            <div className="flex justify-between items-center">
                               <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Select Slabs (Slide No. & Size)</label>
                               <div className="text-[10px] font-black text-indigo-300 italic">{selectedSlabIds.length} Slabs Selected</div>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-2">
                               {selectedProduct.slabs.filter(s => !s.isSold).map(slab => (
                                  <button 
                                    key={slab.id} 
                                    onClick={() => {
                                       if (selectedSlabIds.includes(slab.id)) {
                                           setSelectedSlabIds(selectedSlabIds.filter(id => id !== slab.id));
                                       } else {
                                           setSelectedSlabIds([...selectedSlabIds, slab.id]);
                                       }
                                    }}
                                    className={`p-2 rounded-xl border text-[10px] font-black transition-all flex flex-col items-center justify-center gap-1 ${selectedSlabIds.includes(slab.id) ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg scale-95' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
                                  >
                                     <span className="uppercase tracking-tighter">#{slab.slabNo}</span>
                                     <span className="text-[8px] opacity-60">{slab.sqft} SF</span>
                                  </button>
                               ))}
                            </div>
                            {selectedSlabIds.length > 0 && (
                               <div className="pt-3 border-t border-indigo-500/20 flex justify-between items-center">
                                  <div className="text-[9px] font-black text-indigo-400 uppercase">Total Selected Area</div>
                                  <div className="text-lg font-black italic text-white">
                                     {selectedProduct.slabs.filter(s => selectedSlabIds.includes(s.id)).reduce((acc, s) => acc + s.sqft, 0).toFixed(2)} SqFt
                                  </div>
                               </div>
                            )}
                         </div>
                      ) : (
                         <>
                           <div>
                               <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block px-1">Boxes</label>
                               <input type="number" className="w-full px-5 py-3 bg-white/5 rounded-xl border-0 font-black text-white outline-none focus:ring-1 focus:ring-amber-500" value={boxQty} onChange={e => syncFromUnits(Number(e.target.value), looseQty)} />
                           </div>
                           <div>
                               <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block px-1">Pieces</label>
                               <input type="number" className="w-full px-5 py-3 bg-white/5 rounded-xl border-0 font-black text-white outline-none focus:ring-1 focus:ring-amber-500" value={looseQty} onChange={e => syncFromUnits(boxQty, Number(e.target.value))} />
                           </div>
                           <div>
                               <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block px-1">Sqft</label>
                               <input type="number" className="w-full px-5 py-3 bg-white/5 rounded-xl border-0 font-black text-white outline-none focus:ring-1 focus:ring-amber-500" value={sqft} onChange={e => syncFromSqft(Number(e.target.value))} />
                           </div>
                         </>
                      )}
                   </div>

                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block px-1">Rate / {priceBasis}</label>
                          <div className="flex gap-2">
                             <input type="number" className="flex-1 px-5 py-3 bg-white/5 rounded-xl border-0 font-black text-white outline-none focus:ring-1 focus:ring-amber-500" value={rate} onChange={e => handleRateChange(Number(e.target.value))} />
                             <div className="flex bg-white/5 rounded-xl p-1">
                                <button onClick={() => setPriceBasis('Box')} className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase transition-all ${priceBasis === 'Box' ? 'bg-amber-600 text-white' : 'text-slate-500'}`}>Box</button>
                                <button onClick={() => setPriceBasis('Sqft')} className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase transition-all ${priceBasis === 'Sqft' ? 'bg-amber-600 text-white' : 'text-slate-50'}`}>Sqft</button>
                             </div>
                          </div>
                       </div>
                       <div>
                          <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block px-1">Markup %</label>
                          <div className="relative">
                             <input type="number" className="w-full px-5 py-3 bg-white/5 rounded-xl border-0 font-black text-amber-500 outline-none focus:ring-1 focus:ring-amber-500" value={markup} onChange={e => handleMarkupChange(Number(e.target.value))} />
                             <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-600">%</span>
                          </div>
                       </div>
                    </div>

                    <div className="md:col-span-2 grid grid-cols-2 gap-6">
                      <select className="px-5 py-4 bg-white/5 border-0 rounded-2xl font-black text-white outline-none focus:ring-2 focus:ring-amber-500 appearance-none" value={sourceGodownId} onChange={e => setSourceGodownId(e.target.value)}>
                         {store.godowns.map(g => <option key={g.id} value={g.id} className="bg-slate-900">From: {g.name}</option>)}
                      </select>
                      <button onClick={handleAddItem} disabled={!selectedProductId} className="bg-white text-slate-900 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-amber-500 hover:text-white transition-all shadow-xl disabled:opacity-20 active:scale-95">Push to Cart Trace</button>
                   </div>
                </div>
              </div>

              {/* Cart List */}
              <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
                 <div className="p-8 border-b bg-slate-50/50 flex justify-between items-center">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Invoiced Material Stack</h3>
                    <div className="bg-slate-900 text-white px-3 py-1 rounded-lg text-[9px] font-black uppercase">{cart.length} Items</div>
                 </div>
                 <div className="overflow-x-auto">
                    <table className="w-full text-left">
                       <thead className="bg-white text-[9px] font-black uppercase tracking-widest text-slate-400 border-b">
                          <tr>
                             <th className="px-8 py-4">Item Node</th>
                             <th className="px-8 py-4 text-center">Volume</th>
                             <th className="px-8 py-4 text-center">Rate</th>
                             <th className="px-8 py-4 text-right">Amount</th>
                             <th className="px-8 py-4 text-center"></th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-100">
                          {cart.length === 0 ? (
                             <tr><td colSpan={5} className="p-20 text-center italic text-slate-200 font-black text-2xl uppercase tracking-tighter">Stack Empty</td></tr>
                          ) : (
                             cart.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                   <td className="px-8 py-6">
                                      <div className="font-black text-slate-800 uppercase text-xs">{item.productName}</div>
                                      <div className="text-[9px] font-bold text-amber-600 uppercase mt-1 tracking-widest flex items-center gap-2">
                                         Godown: {store.godowns.find(g => g.id === item.sourceGodownId)?.name}
                                         {item.selectedSlabIds && (
                                             <span className="bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full text-[8px]">
                                                 Slabs: {item.selectedSlabIds.map(id => {
                                                     const p = store.products.find(prod => prod.id === item.productId);
                                                     return p?.slabs?.find(s => s.id === id)?.slabNo;
                                                 }).join(', ')}
                                             </span>
                                         )}
                                      </div>
                                   </td>
                                   <td className="px-8 py-6 text-center font-black text-slate-700 italic">
                                      {item.qtyBoxes}{store.products.find(p => p.id === item.productId)?.unitType === 'Box' ? 'B' : store.products.find(p => p.id === item.productId)?.unitType === 'Bag' ? 'Bag' : store.products.find(p => p.id === item.productId)?.unitType || 'U'} {item.qtyLoose > 0 ? `+ ${item.qtyLoose}P` : ''}
                                      <div className="text-[8px] font-bold text-slate-400 mt-1 uppercase">({item.sqft} Sqft)</div>
                                   </td>
                                   <td className="px-8 py-6 text-center">
                                      <div className="font-bold text-slate-800 text-sm">₹{item.rate}</div>
                                      <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Per {item.priceBasis}</div>
                                      {item.priceBasis === 'Box' && (
                                         <div className="text-[7px] font-black text-emerald-600 uppercase mt-1">₹{(item.amount / (item.sqft || 1)).toFixed(2)} / Sqft</div>
                                      )}
                                   </td>
                                   <td className="px-8 py-6 text-right font-black text-slate-900 text-lg italic">₹{item.amount.toLocaleString()}</td>
                                   <td className="px-8 py-6 text-center">
                                      <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-rose-300 hover:text-rose-600 transition-colors"><i className="fas fa-trash-alt"></i></button>
                                   </td>
                                </tr>
                             ))
                          )}
                       </tbody>
                    </table>
                 </div>
              </div>
           </div>

           <div className="space-y-6">
              {/* Step 3: Commercial Settlement */}
              <div className="bg-slate-900 p-10 rounded-[50px] shadow-2xl text-white space-y-8 sticky top-10">
                 <div>
                    <h3 className="text-xl font-black italic tracking-tighter uppercase leading-none">Commercial Settlement</h3>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-2">Authorization Pulse</p>
                 </div>

                 <div className="space-y-6 border-t border-white/5 pt-8">
                    {/* Offers Selection */}
                    <div className="space-y-3">
                       <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] px-1">Active Promotional Strategy</label>
                       <select 
                         className="w-full px-5 py-4 bg-white/5 border-2 border-white/5 rounded-2xl font-black text-white outline-none focus:border-amber-600 appearance-none"
                         value={selectedOfferId}
                         onChange={e => setSelectedOfferId(e.target.value)}
                       >
                          <option value="" className="bg-slate-900">None Applied</option>
                          {activeOffers.map(o => (
                             <option key={o.id} value={o.id} className="bg-slate-900">{o.title} ({o.type === 'Percentage' ? `${o.value}%` : `₹${o.value}`})</option>
                          ))}
                       </select>
                    </div>

                    <div className="flex justify-between text-slate-400 text-[10px] font-black uppercase tracking-widest">
                       <span>Gross Material Value</span>
                       <span className="text-white">₹{currentSubTotal.toLocaleString()}</span>
                    </div>

                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10 space-y-4">
                       <div className="flex justify-between items-center">
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Direct Commercial Offset</label>
                          <div className="flex bg-slate-950 p-1 rounded-xl">
                             <button onClick={() => setDiscountType('Percentage')} className={`px-2 py-0.5 rounded text-[8px] font-black transition-all ${discountType === 'Percentage' ? 'bg-amber-600 text-white' : 'text-slate-50'}`}>%</button>
                             <button onClick={() => setDiscountType('Fixed')} className={`px-2 py-0.5 rounded text-[8px] font-black transition-all ${discountType === 'Fixed' ? 'bg-amber-600 text-white' : 'text-slate-50'}`}>₹</button>
                          </div>
                       </div>
                       <div className="flex gap-4 items-center">
                          <input type="number" className="flex-1 bg-transparent border-b-2 border-white/10 outline-none text-2xl font-black text-amber-500 focus:border-amber-500 transition-all" value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))} />
                          <div className="text-right">
                             <div className="text-[8px] font-bold text-slate-500 uppercase">Savings</div>
                             <div className="text-xs font-black text-emerald-400">- ₹{currentGlobalDiscount.toLocaleString()}</div>
                          </div>
                       </div>
                    </div>

                    {/* Commission Configuration */}
                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10 space-y-4">
                       <div className="flex justify-between items-center">
                          <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Incentive Protocol (Comm.)</label>
                          <div className="flex bg-slate-950 p-1 rounded-xl">
                             <button onClick={() => setCommissionType('Percentage')} className={`px-2 py-0.5 rounded text-[8px] font-black transition-all ${commissionType === 'Percentage' ? 'bg-purple-600 text-white' : 'text-slate-50'}`}>%</button>
                             <button onClick={() => setCommissionType('Fixed')} className={`px-2 py-0.5 rounded text-[8px] font-black transition-all ${commissionType === 'Fixed' ? 'bg-purple-600 text-white' : 'text-slate-50'}`}>₹</button>
                          </div>
                       </div>
                       <div className="flex gap-4 items-center">
                          <input type="number" className="flex-1 bg-transparent border-b-2 border-white/10 outline-none text-xl font-black text-purple-400 focus:border-purple-500 transition-all" value={commissionValue} onChange={e => setCommissionValue(Number(e.target.value))} />
                          <div className="text-right">
                             <div className="text-[8px] font-bold text-slate-500 uppercase">Agent Share</div>
                             <div className="text-xs font-black text-purple-400">₹{(commissionType === 'Fixed' ? commissionValue : (currentTaxable * commissionValue) / 100).toLocaleString()}</div>
                          </div>
                       </div>
                    </div>

                    <div className="flex justify-between items-center">
                       <div className="flex items-center gap-3">
                          <button onClick={() => setIsGstIncluded(!isGstIncluded)} className={`w-10 h-5 rounded-full transition-all relative ${isGstIncluded ? 'bg-amber-500' : 'bg-slate-700'}`}>
                             <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isGstIncluded ? 'left-6' : 'left-1'}`}></div>
                          </button>
                          <span className="text-[10px] font-black uppercase text-slate-400">GST Included in Rate</span>
                       </div>
                       <span className="font-black text-slate-200 italic">{isGstIncluded ? 'Inclusive' : `₹${currentGst.toLocaleString()}`}</span>
                    </div>

                    {loadingCharges > 0 && (
                       <div className="flex justify-between items-center text-amber-500">
                          <span className="text-[10px] font-black uppercase tracking-widest">Loading Charges</span>
                          <span className="font-black italic">₹{loadingCharges.toLocaleString()}</span>
                       </div>
                    )}

                    <div className="border-t border-white/10 pt-8 space-y-2">
                       <div className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Aggregate Net Payable</div>
                       <div className="text-5xl font-black italic tracking-tighter text-white">₹{currentTotal.toLocaleString()}</div>
                    </div>

                    <div className="space-y-4">
                       <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Settlement Node</label>
                       <div className="grid grid-cols-2 gap-2">
                          {['Cash', 'UPI', 'Card', 'Credit'].map(m => (
                             <button key={m} onClick={() => setPaymentType(m as any)} className={`py-3 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${paymentType === m ? 'bg-white text-slate-900 border-white' : 'bg-transparent border-white/10 text-slate-500'}`}>{m}</button>
                          ))}
                       </div>
                    </div>

                    {!isFullPayment && (
                       <div className="animate-in slide-in-from-top-4 duration-300">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block px-1">Received Magnitude (₹)</label>
                          <input type="number" className="w-full px-6 py-4 bg-white/5 border-2 border-white/10 rounded-2xl text-white font-black text-2xl outline-none focus:border-amber-500 transition-all" value={amountPaid} onChange={e => setAmountPaid(Number(e.target.value))} />
                       </div>
                    )}

                    <div className="flex items-center gap-3">
                       <input type="checkbox" className="w-5 h-5 rounded-lg accent-amber-600" checked={isFullPayment} onChange={e => setIsFullPayment(e.target.checked)} />
                       <span className="text-[10px] font-black uppercase text-slate-400">Full Real-time Dispatch Settlement</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                       <button onClick={() => handleGenerateInvoice('Draft')} className="py-4 bg-slate-800 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-700 transition-all">Save as Draft</button>
                       <button onClick={() => handleGenerateInvoice('Hold')} className="py-4 bg-amber-900/40 text-amber-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-900/60 transition-all">Hold Protocol</button>
                    </div>

                    {/* ── Referral Agent Commission (optional) ── */}
                    <div className="border border-white/10 rounded-2xl p-4 space-y-3 bg-white/3">
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <i className="fas fa-user-tag text-amber-500"></i> Referral Agent (optional)
                      </div>
                      <select
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-bold text-sm outline-none focus:border-amber-500 transition-all appearance-none"
                        value={referralAgentId}
                        onChange={e => {
                          const agent = (store.referralAgents||[]).find(a=>a.id===e.target.value);
                          setReferralAgentId(e.target.value);
                          if (agent) { setRefCommType(agent.defaultCommissionType); setRefCommValue(agent.defaultCommissionValue); }
                          else { setRefCommValue(0); }
                        }}>
                        <option value="">No referral agent for this sale</option>
                        {(store.referralAgents||[]).filter(a=>a.isActive).map(a=>(
                          <option key={a.id} value={a.id}>{a.name} ({a.agentType}) — Default: {a.defaultCommissionType==='Percentage'?`${a.defaultCommissionValue}%`:`₹${a.defaultCommissionValue}`}</option>
                        ))}
                      </select>
                      {referralAgentId && (
                        <div className="grid grid-cols-2 gap-3">
                          <select className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-xs font-bold outline-none" value={refCommType} onChange={e=>setRefCommType(e.target.value as any)}>
                            <option value="Percentage">% of Sale</option>
                            <option value="Fixed">Fixed ₹</option>
                          </select>
                          <input type="number" placeholder={refCommType==='Percentage'?'e.g. 2':'e.g. 500'}
                            className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-amber-400 text-sm font-black outline-none"
                            value={refCommValue||''} onChange={e=>setRefCommValue(+e.target.value)} />
                        </div>
                      )}
                      {referralAgentId && refCommValue > 0 && (
                        <div className="text-[10px] text-amber-400 font-black flex items-center gap-1.5">
                          <i className="fas fa-calculator text-xs"></i>
                          Commission: {refCommType==='Percentage' ? `${refCommValue}% of sale = ₹${Math.round(currentTotal * refCommValue / 100).toLocaleString('en-IN')}` : `₹${refCommValue} fixed`}
                        </div>
                      )}
                    </div>

                    <button onClick={() => handleGenerateInvoice('Active')} disabled={cart.length === 0 || isSaving} className="w-full py-6 bg-amber-600 text-white rounded-[30px] font-black text-sm uppercase tracking-widest hover:bg-amber-700 shadow-2xl transition-all active:scale-95 disabled:opacity-20 flex items-center justify-center gap-3">
                       {isSaving ? <><i className="fas fa-spinner fa-spin"></i> Processing…</> : (editingSaleId ? 'Update Dispatch Protocol' : 'Finalize Dispatch Protocol')}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {viewMode === 'preview' && selectedSale && (() => {
        const showCoGst   = store.settings.printShowCompanyGst !== false;
        const showCustGst = store.settings.printShowCustomerGst !== false;
        const SLAB_CATS   = ['Kadapa', 'Granite', 'Marble'];

        // Rich category summary
        const catSummary: Record<string, { sqft: number; boxes: number; loose: number; slabs: number; slabNos: string[]; amount: number }> = {};
        selectedSale.items.forEach(item => {
          const cat = item.productCategory || 'Other';
          if (!catSummary[cat]) catSummary[cat] = { sqft: 0, boxes: 0, loose: 0, slabs: 0, slabNos: [], amount: 0 };
          catSummary[cat].sqft   += item.sqft || 0;
          catSummary[cat].boxes  += item.qtyBoxes || 0;
          catSummary[cat].loose  += item.qtyLoose || 0;
          catSummary[cat].amount += item.amount || 0;
          if (item.selectedSlabIds?.length) {
            catSummary[cat].slabs += item.selectedSlabIds.length;
            const prod = store.products.find(p => p.id === item.productId);
            item.selectedSlabIds.forEach(sid => {
              const s = prod?.slabs?.find(sl => sl.id === sid);
              if (s) catSummary[cat].slabNos.push(s.slabNo);
            });
          }
        });
        const totalBoxes  = selectedSale.items.reduce((s, i) => s + i.qtyBoxes, 0);
        const totalLoose  = selectedSale.items.reduce((s, i) => s + i.qtyLoose, 0);
        const totalSlabs  = selectedSale.items.reduce((s, i) => s + (i.selectedSlabIds?.length || 0), 0);
        const totalSqft   = selectedSale.items.reduce((s, i) => s + (i.sqft || 0), 0);
        const discAmt = selectedSale.discountType === 'Fixed'
          ? selectedSale.discountValue
          : (selectedSale.subTotal * selectedSale.discountValue) / 100;

        return (
          <div className="min-h-screen bg-slate-100 print:bg-white">
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                @page { size: A4; margin: 8mm 10mm; }
                body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .no-print { display: none !important; }
                #inv-print { box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; max-width: 100% !important; }
              }
            `}} />

            {/* Screen toolbar */}
            <div className="no-print sticky top-0 z-50 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
              <button onClick={() => setViewMode('billing')}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200">
                <i className="fas fa-arrow-left text-xs"></i> Back
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-black text-slate-800 text-sm truncate">{selectedSale.invoiceNo}</div>
                <div className="text-[9px] text-slate-400 font-bold">{selectedSale.customerName} · {selectedSale.date}</div>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                {/* Image toggle — only when admin allows */}
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
                <button onClick={() => {
                  const url = `${window.location.origin}/?viewInvoice=${selectedSale.id}`;
                  navigator.clipboard?.writeText(url);
                  alert('Invoice link copied!');
                }} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-blue-700 transition-all">
                  <i className="fas fa-link text-xs"></i> Share Link
                </button>
              </div>
            </div>

            {/* Printable invoice */}
            <div ref={previewRef} id="inv-print"
              className="max-w-4xl mx-auto bg-white shadow-xl rounded-2xl sm:rounded-3xl overflow-hidden my-4 sm:my-6 print:my-0 print:shadow-none">

              <div className="h-2 bg-slate-900"></div>

              <div className="px-6 sm:px-10 py-6 sm:py-8 space-y-6">

                {/* ── Company header ── */}
                <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center text-white font-black text-lg">
                        {(store.settings.showroomName || 'R')[0]}
                      </div>
                      <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tighter uppercase">{store.settings.showroomName}</div>
                    </div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide max-w-xs leading-relaxed">{store.settings.showroomAddress}</div>
                    <div className="flex flex-wrap gap-4 pt-1 text-[9px] font-black uppercase text-slate-500">
                      {showCoGst && store.settings.showroomGst && (
                        <span className="flex items-center gap-1"><i className="fas fa-building text-slate-400"></i> GSTIN: {store.settings.showroomGst}</span>
                      )}
                      {store.settings.showroomPhone && (
                        <span className="flex items-center gap-1"><i className="fas fa-phone text-slate-400"></i> {store.settings.showroomPhone}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-left sm:text-right space-y-1 border-t sm:border-0 pt-3 sm:pt-0">
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Tax Invoice</div>
                    <div className="text-2xl sm:text-3xl font-black text-slate-900">{selectedSale.invoiceNo}</div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase">Date: {selectedSale.date}</div>
                    <div className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full inline-block ${selectedSale.balance <= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {selectedSale.balance <= 0 ? '✓ Paid' : 'Credit Balance'}
                    </div>
                  </div>
                </header>

                {/* ── Customer / Logistics / Auth ── */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 rounded-2xl px-5 py-4">
                  <div>
                    <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Bill To</div>
                    <div className="text-base font-black text-slate-900">{selectedSale.customerName}</div>
                    <div className="text-[10px] font-bold text-slate-500 mt-0.5">+91 {selectedSale.customerMobile}</div>
                    {selectedSale.customerAddress && (
                      <div className="text-[9px] text-slate-400 font-bold mt-0.5">{selectedSale.customerAddress}</div>
                    )}
                    {showCustGst && selectedSale.customerGst && (
                      <div className="text-[9px] font-black text-slate-500 mt-1">GSTIN: {selectedSale.customerGst}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Delivery Info</div>
                    <div className="space-y-0.5">
                      {selectedSale.customFields?.map((f, i) => (
                        <div key={i} className="flex justify-between text-[9px]">
                          <span className="font-bold text-slate-500">{f.label}</span>
                          <span className="font-black text-slate-700">{f.value || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Transaction</div>
                    <div className="space-y-0.5 text-[9px]">
                      <div className="flex justify-between">
                        <span className="font-bold text-slate-500">Executive</span>
                        <span className="font-black text-slate-700">{selectedSale.salesPersonName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold text-slate-500">Payment</span>
                        <span className="font-black text-slate-700">{selectedSale.paymentType}</span>
                      </div>
                    </div>
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
                              <td colSpan={4} className="px-3 sm:px-4 py-2 bg-slate-50 border-y border-slate-200">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{category}</span>
                              </td>
                            </tr>
                            {catItems.map((it, idx) => {
                              const prod = store.products.find(p => p.id === it.productId);
                              const slabNos = it.selectedSlabIds?.map(sid => prod?.slabs?.find(s => s.id === sid)?.slabNo).filter(Boolean) || [];
                              const itemImage = prod?.images?.[0] || null;
                              return (
                                <tr key={idx} className="hover:bg-slate-50/50">
                                  <td className="px-3 sm:px-4 py-3">
                                    <div className="flex items-start gap-3">
                                      {/* Product image — shown when toggle is ON */}
                                      {showItemImages && itemImage && (
                                        <img src={itemImage} alt={it.productName}
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
                                        <div className="font-black text-slate-800 text-[11px] sm:text-xs">{it.productName}</div>

                                        {/* Size + brand for tile/box items */}
                                        {!isSlab && (prod?.size || prod?.brand) && (
                                          <div className="text-[8px] text-slate-500 font-bold mt-0.5 flex items-center gap-1 flex-wrap">
                                            {prod?.size && <><i className="fas fa-ruler-combined text-[7px] opacity-50"></i><span>{prod.size}</span></>}
                                            {prod?.brand && <span className="opacity-70">· {prod.brand}</span>}
                                            {prod?.grade && prod.grade !== 'Standard' && <span className="opacity-60">· {prod.grade}</span>}
                                          </div>
                                        )}

                                        {it.purpose && it.purpose !== 'General' && <div className="text-[8px] text-slate-400 font-bold mt-0.5">{it.purpose}</div>}

                                        {/* Kadapa — show count per size, NOT individual slab numbers (too many) */}
                                        {isSlab && it.productCategory === 'Kadapa' && slabNos.length > 0 && (
                                          <div className="text-[8px] text-amber-700 font-bold mt-0.5">
                                            {slabNos.length} slab{slabNos.length > 1 ? 's' : ''} · {it.sqft?.toFixed(2)} SqFt total
                                            {prod?.size && ` · ${prod.size} ft`}
                                          </div>
                                        )}

                                        {/* Granite / Marble — show individual slab numbers (for verification at site) */}
                                        {isSlab && it.productCategory !== 'Kadapa' && slabNos.length > 0 && (
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
                                        {slabNos.length > 0 && (
                                          <div className="font-black text-slate-700 text-sm">{slabNos.length} Slab{slabNos.length > 1 ? 's' : ''}</div>
                                        )}
                                        {(it.sqft || 0) > 0 && (
                                          <div className="text-[9px] text-slate-400 font-bold">{it.sqft?.toFixed(2)} SqFt</div>
                                        )}
                                        {/* Per-slab sqft for Kadapa */}
                                        {it.productCategory === 'Kadapa' && slabNos.length > 0 && (it.sqft || 0) > 0 && (
                                          <div className="text-[8px] text-amber-600 font-bold">
                                            {((it.sqft || 0) / slabNos.length).toFixed(2)} SqFt/slab
                                          </div>
                                        )}
                                      </div>
                                    ) : (() => {
                                      // Non-sqft categories (Adhesive, Grout, Cement, Tools, etc.) —
                                      // NEVER show SqFt; show unit count in the correct unit label.
                                      const NON_SQFT_CATS = ['Adhesive','Grout','Cement','Tools','Sanitary','Epoxy','Putty','Primer'];
                                      const isNonSqft = NON_SQFT_CATS.includes(it.productCategory || '');
                                      // Resolve display unit: use item.unit if set, else product.unitType, else 'Box'
                                      const dispUnit = it.unit || prod?.unitType || 'Box';
                                      const unitLabel = isNonSqft ? dispUnit : 'Box';
                                      const unitLabelPlural = (n: number, lbl: string) =>
                                        n > 1 ? (lbl === 'Box' ? 'Boxes' : `${lbl}s`) : lbl;
                                      const totalCount = it.qtyBoxes || 0;
                                      // For tile/sqft categories: also show sqft
                                      const isTileCat = ['Floor Tile','Wall Tile','Floor','Vitrified','Ceramic','Wooden'].some(
                                        c => (it.productCategory||'').toLowerCase().includes(c.toLowerCase())
                                      );
                                      return (
                                        <div>
                                          <div className="font-black text-slate-700 text-sm">
                                            {totalCount > 0 && `${totalCount} ${unitLabelPlural(totalCount, unitLabel)}`}
                                            {it.qtyLoose > 0 && ` + ${it.qtyLoose} Pcs`}
                                          </div>
                                          {/* SqFt — only for tile/sqft categories, NOT for Adhesive/Grout/Tools */}
                                          {!isNonSqft && (it.sqft || 0) > 0 && (
                                            <div className="text-[9px] text-slate-400 font-bold">{(it.sqft||0).toFixed(2)} SqFt</div>
                                          )}
                                          {/* Size badge for tiles */}
                                          {isTileCat && prod?.size && (
                                            <div className="text-[8px] text-slate-500 font-bold">{prod.size}</div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-3 sm:px-4 py-3 text-center">{(() => {
                                    const NON_SQFT_CATS = ['Adhesive','Grout','Cement','Tools','Sanitary','Epoxy','Putty','Primer'];
                                    const isNonSqft = NON_SQFT_CATS.includes(it.productCategory || '');
                                    const dispUnit = it.unit || prod?.unitType || 'Box';
                                    const priceBasis = it.priceBasis || dispUnit;
                                    return (
                                      <div>
                                        <div className="font-bold text-slate-700 text-sm">₹{it.rate.toLocaleString()}</div>
                                        <div className="text-[8px] text-slate-400 font-bold uppercase">
                                          {isNonSqft ? `/ ${dispUnit}` : `/ ${priceBasis}`}
                                        </div>
                                        {/* For tiles: show ₹/SqFt equivalent if priced per box */}
                                        {!isNonSqft && priceBasis === 'Box' && (it.sqft || 0) > 0 && (
                                          <div className="text-[8px] text-emerald-600 font-black mt-0.5">
                                            ₹{(it.amount / (it.sqft || 1)).toFixed(2)}/SqFt
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  </td>
                                  <td className="px-3 sm:px-4 py-3 text-right font-black text-slate-900 text-sm">₹{it.amount.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── Category Breakdown ── */}
                <div className="space-y-3 border-t-2 border-slate-900 pt-4">
                  <div className="text-[9px] font-black text-slate-900 uppercase tracking-widest">Category Breakdown</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(catSummary).map(([cat, s]) => {
                      const isSlab = SLAB_CATS.includes(cat);
                      return (
                        <div key={cat} className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2">
                          <div className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{cat}</div>
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
                                    <span key={no} className="text-[7px] font-black bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">#{no}</span>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              {s.boxes > 0 && (
                                <div className="flex justify-between text-[10px]">
                                  <span className="font-bold text-slate-500">Boxes</span>
                                  <span className="font-black text-slate-800">{s.boxes} Box{s.boxes > 1 ? 'es' : ''}</span>
                                </div>
                              )}
                              {s.loose > 0 && (
                                <div className="flex justify-between text-[10px]">
                                  <span className="font-bold text-slate-500">Pieces</span>
                                  <span className="font-black text-slate-800">{s.loose} Pcs</span>
                                </div>
                              )}
                            </>
                          )}
                          {s.sqft > 0 && (
                            <div className="flex justify-between text-[10px] border-t border-slate-100 pt-1">
                              <span className="font-bold text-slate-500">Total SqFt</span>
                              <span className="font-black text-indigo-700">{s.sqft.toFixed(2)} SqFt</span>
                            </div>
                          )}
                          <div className="flex justify-between text-[10px] font-black border-t border-slate-200 pt-1">
                            <span className="text-slate-600">Subtotal</span>
                            <span className="text-slate-900">₹{s.amount.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Grand totals pill row ── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  {[
                    { label: 'Total Boxes',  val: `${totalBoxes}`,            show: totalBoxes > 0 },
                    { label: 'Total Pieces', val: `${totalLoose}`,            show: totalLoose > 0 },
                    { label: 'Total Slabs',  val: `${totalSlabs}`,            show: totalSlabs > 0 },
                    { label: 'Total SqFt',   val: `${totalSqft.toFixed(2)}`,  show: true },
                  ].map(({ label, val, show }) => show ? (
                    <div key={label} className="text-center">
                      <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
                      <div className="text-base font-black text-slate-800 mt-0.5">{val}</div>
                    </div>
                  ) : null)}
                </div>

                {/* ── Financials + Remarks ── */}
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="flex-1 space-y-3">
                    <div className="bg-slate-50 rounded-xl p-4 text-[10px] font-medium text-slate-600 italic border border-slate-100">
                      <div className="font-black text-slate-400 text-[8px] uppercase tracking-widest mb-1 not-italic">Remarks</div>
                      {selectedSale.remarks || 'Material once sold cannot be returned. Please verify shades before fixing.'}
                      {store.settings.decimalPlaceText && (
                        <div className="mt-2 pt-2 border-t border-slate-200 text-amber-600 font-black text-[8px] uppercase tracking-widest not-italic">
                          {store.settings.decimalPlaceText}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-8 pt-4">
                      <div className="text-center">
                        <div className="w-full h-px bg-slate-300 mb-1.5"></div>
                        <div className="text-[8px] font-black text-slate-400 uppercase">Customer Signature</div>
                      </div>
                      <div className="text-center">
                        <div className="w-full h-px bg-slate-300 mb-1.5"></div>
                        <div className="text-[8px] font-black text-slate-400 uppercase">For {store.settings.showroomName}</div>
                      </div>
                    </div>
                  </div>

                  <div className="w-full md:w-64 space-y-1.5 shrink-0">
                    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      <span>Gross Value</span><span>₹{selectedSale.subTotal.toLocaleString()}</span>
                    </div>
                    {selectedSale.discountValue > 0 && (
                      <div className="flex justify-between text-[9px] font-black text-emerald-600 uppercase tracking-widest">
                        <span>Discount</span><span>- ₹{discAmt.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      <span>GST ({selectedSale.gstPercent}%)</span>
                      <span>₹{selectedSale.gstAmount.toLocaleString()}</span>
                    </div>
                    {selectedSale.loadingCharges ? (
                      <div className="flex justify-between text-[9px] font-black text-amber-600 uppercase tracking-widest">
                        <span>Loading Charges</span><span>₹{selectedSale.loadingCharges.toLocaleString()}</span>
                      </div>
                    ) : null}
                    <div className="bg-slate-900 text-white rounded-2xl p-5 mt-2">
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Amount</div>
                      <div className="text-2xl sm:text-3xl font-black mt-1">₹{selectedSale.totalAmount.toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 space-y-1">
                      <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase">
                        <span>Amount Paid</span><span className="text-emerald-700 font-black">₹{selectedSale.amountPaid.toLocaleString()}</span>
                      </div>
                      {selectedSale.balance > 0 && (
                        <div className="flex justify-between text-[9px] font-black text-rose-600 uppercase">
                          <span>Balance Due</span><span>₹{selectedSale.balance.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="h-2 bg-slate-900"></div>
            </div>

            <div className="no-print max-w-4xl mx-auto pb-8 px-4 flex flex-wrap gap-3 justify-center">
              <button onClick={() => window.print()}
                className="flex items-center gap-2 px-8 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95">
                <i className="fas fa-print"></i> Print / Export PDF
              </button>
              <button onClick={() => setViewMode('billing')}
                className="flex items-center gap-2 px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">
                <i className="fas fa-arrow-left"></i> Back to Billing
              </button>
            </div>
          </div>
        );
      })()}


      {viewMode === 'history' && (
         <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4">
               <i className="fas fa-search text-slate-300 ml-2"></i>
               <input type="text" placeholder="Filter Ledger by Profile or Trace ID..." className="flex-1 py-2 font-bold outline-none text-slate-600 text-sm" value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
            </div>

            <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
               <div className="overflow-x-auto">
                  <table className="w-full text-left">
                     <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b">
                        <tr>
                           <th className="px-8 py-5">Trace ID</th>
                           <th className="px-8 py-5">Identity Profile</th>
                           <th className="px-8 py-5">Invoiced Net</th>
                           <th className="px-8 py-5">Realized</th>
                           <th className="px-8 py-5">Arrears</th>
                           <th className="px-8 py-5 text-center">Node Status</th>
                           <th className="px-8 py-5 text-center">Manage</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {isHistoryLoading && historyPage === 1 ? (
                           Array(5).fill(0).map((_, i) => <SalesSkeletonRow key={i} />)
                        ) : filteredSalesHistory.length === 0 ? (
                           <tr><td colSpan={7} className="p-20 text-center italic text-slate-200 font-black text-2xl uppercase tracking-tighter">No History Records</td></tr>
                        ) : (
                           filteredSalesHistory.map(s => (
                              <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                 <td className="px-8 py-6 font-black text-blue-600 tracking-tighter">{s.invoiceNo}</td>
                                 <td className="px-8 py-6">
                                    <div className="font-black text-slate-800 uppercase text-xs">{s.customerName}</div>
                                    <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">{s.date} • {s.paymentType} Node</div>
                                 </td>
                                 <td className="px-8 py-6 font-black text-slate-900 italic text-base">₹{s.totalAmount.toLocaleString()}</td>
                                 <td className="px-8 py-6 font-black text-emerald-600">₹{s.amountPaid.toLocaleString()}</td>
                                 <td className={`px-8 py-6 font-black italic ${s.balance > 0 ? 'text-rose-600' : 'text-slate-200'}`}>₹{s.balance.toLocaleString()}</td>
                                  <td className="px-8 py-6 text-center">
                                    <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase border ${
                                      s.status === 'Deleted' ? 'bg-rose-100 text-rose-600 border-rose-200' :
                                      s.status === 'Draft' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                                      s.status === 'Hold' ? 'bg-amber-100 text-amber-600 border-amber-200' :
                                      s.balance <= 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                                      'bg-amber-50 text-amber-600 border-amber-100'
                                    }`}>
                                       {s.status === 'Deleted' ? 'Deleted' : s.status === 'Draft' ? 'Draft' : s.status === 'Hold' ? 'On Hold' : s.balance <= 0 ? 'Settled' : 'Open Due'}
                                    </span>
                                 </td>
                                 <td className="px-8 py-6 text-center">
                                    <div className="flex justify-center gap-2">
                                       <button onClick={() => { setSelectedSale(s); setViewMode('preview'); }} className="w-10 h-10 rounded-xl bg-slate-50 border text-slate-400 hover:text-slate-900 transition-all"><i className="fas fa-eye"></i></button>
                                       {isAdmin && (
                                          <>
                                             <button onClick={() => handleEditSale(s)} className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 text-blue-400 hover:text-blue-600 transition-all"><i className="fas fa-edit"></i></button>
                                             <button onClick={() => { if(confirm('Soft delete this invoice?')) store.deleteSale(s.id); }} className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 text-rose-400 hover:text-rose-600 transition-all"><i className="fas fa-trash-alt"></i></button>
                                          </>
                                       )}
                                    </div>
                                 </td>
                              </tr>
                           ))
                        )}
                     </tbody>
                  </table>
               </div>

               {hasMoreHistory && (
                  <div className="p-8 border-t border-slate-100 flex justify-center">
                    <button 
                      onClick={loadMoreHistory}
                      disabled={isHistoryLoading}
                      className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 transition-all disabled:opacity-50"
                    >
                      {isHistoryLoading ? 'Loading More Records...' : 'Load More Records'}
                    </button>
                  </div>
                )}
            </div>
         </div>
      )}
      {/* Quick Product Modal */}
      <QuickProductModal 
        isOpen={showQuickProduct} 
        onClose={() => setShowQuickProduct(false)} 
        onSuccess={(productId) => {
          setSelectedProductId(productId);
        }} 
      />
    </div>
  );
};

export default Sales;
