import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { store } from '../store';
import { Product } from '../types';
import QRCode from 'qrcode';

interface WebGalleryProps {
  initialProductId?: string | null;
  onAdminAccess: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const INR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const r2  = (n: number) => Math.round(n * 100) / 100;
const SLAB_CATS = ['Kadapa', 'Granite', 'Marble'];
const isSlabCat = (cat?: string) => SLAB_CATS.includes(cat || '');

// ── Review type ───────────────────────────────────────────────────────────────
interface Review {
  id: string;
  productId: string;
  name: string;
  rating: number;
  comment: string;
  date: string;
}

// ── Cart item ─────────────────────────────────────────────────────────────────
interface CartItem {
  productId: string;
  productName: string;
  category?: string;
  sqft: number;
  boxes: number;
  loose: number;
  unitPrice: number;
  originalPrice?: number;
  discountAmount?: number;
  appliedOfferId?: string;
  purpose: string;
  selectedSlabIds?: string[];
  selectedSlabNos?: string[];
  slabDetails?: any[];
}

const WebGallery: React.FC<WebGalleryProps> = ({ initialProductId, onAdminAccess }) => {
  // ── Store data ──────────────────────────────────────────────────────────────
  const [prods, setProds]         = useState<Product[]>(store.products);
  const [settings, setSettings]   = useState(store.settings);
  const [offers, setOffers]       = useState(store.offers);

  // ── Public mode: fetch from API when no user is logged in ──────────────────
  useEffect(() => {
    const tenantSlug = new URLSearchParams(window.location.search).get('tenant') || '';
    const isPublic   = !store.currentUser;

    if (isPublic) {
      // Build the URL — always use same origin
      const apiUrl = `${window.location.origin}/api/public/gallery${tenantSlug ? '?tenant=' + tenantSlug : ''}`;
      fetch(apiUrl)
        .then(r => r.json())
        .then(data => {
          if (data.products) setProds(data.products);
          if (data.settings) setSettings(prev => ({ ...prev, ...data.settings }));
        })
        .catch(e => console.warn('[Gallery] Could not load public products:', e.message));
      return; // don't subscribe to store
    }

    // Logged in — use store subscription as before
    const unsub = store.subscribe(() => {
      setProds([...store.products]);
      setSettings({ ...store.settings });
      setOffers([...store.offers]);
    });
    return unsub;
  }, []);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeCat, setActiveCat]         = useState('All');
  const [searchQ, setSearchQ]             = useState('');
  const [viewMode, setViewMode]           = useState<'grid'|'list'>('grid');
  const [sortBy, setSortBy]               = useState<'default'|'price-asc'|'price-desc'|'name'>('default');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeImgIdx, setActiveImgIdx]   = useState(0);
  const [showCart, setShowCart]           = useState(false);
  const [cart, setCart]                   = useState<CartItem[]>([]);
  const [compareList, setCompareList]     = useState<string[]>([]);
  const [showCompare, setShowCompare]     = useState(false);
  const [showQR, setShowQR]               = useState(false);
  const [qrUrl, setQrUrl]                 = useState('');

  // Config modal
  const [configuring, setConfiguring]     = useState<{ product: Product; sqft: number; purpose: string; selectedSlabIds: string[] } | null>(null);
  const [configDone, setConfigDone]       = useState(false);

  // Reviews
  const [reviews, setReviews]             = useState<Review[]>(() => {
    try { return JSON.parse(localStorage.getItem('royal_reviews') || '[]'); } catch { return []; }
  });
  const [reviewForm, setReviewForm]       = useState({ name: '', rating: 5, comment: '' });
  const [showReviewForm, setShowReviewForm] = useState(false);

  // Checkout
  const [checkoutForm, setCheckoutForm]   = useState({ name: '', mobile: '', place: '', remarks: '' });
  const [otpSent, setOtpSent]             = useState(false);
  const [otpInput, setOtpInput]           = useState('');
  const [generatedOtp, setGeneratedOtp]   = useState('');
  const [otpVerified, setOtpVerified]     = useState(false);
  const [otpError, setOtpError]           = useState('');
  const [isSubmitting, setIsSubmitting]   = useState(false);
  const [orderSuccess, setOrderSuccess]   = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const categories = useMemo(() => ['All', ...(settings.categories || [])], [settings]);

  const publishedOffers = useMemo(() => {
    const now = new Date().toISOString().split('T')[0];
    return offers.filter(o => o.status === 'Published' && o.startDate <= now && o.expiryDate >= now);
  }, [offers]);

  const getOffer = (p: Product) =>
    publishedOffers.find(o => o.targetProductIds.includes(p.id) || o.targetCategories.includes(p.category));

  const visibleProds = useMemo(() => {
    let list = prods.filter(p =>
      p.showInGallery !== false &&
      (activeCat === 'All' || p.category === activeCat) &&
      (!searchQ || p.name.toLowerCase().includes(searchQ.toLowerCase()) || p.brand.toLowerCase().includes(searchQ.toLowerCase()))
    );
    if (sortBy === 'price-asc')  list = [...list].sort((a, b) => (a.sellingPrice || 0) - (b.sellingPrice || 0));
    if (sortBy === 'price-desc') list = [...list].sort((a, b) => (b.sellingPrice || 0) - (a.sellingPrice || 0));
    if (sortBy === 'name')       list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [prods, activeCat, searchQ, sortBy]);

  const compareProds = useMemo(() => prods.filter(p => compareList.includes(p.id)), [prods, compareList]);

  const cartTotal    = cart.reduce((s, i) => {
    const p = prods.find(x => x.id === i.productId);
    const isSlab = isSlabCat(p?.category);
    if (isSlab && i.slabDetails?.length) return s + i.slabDetails.reduce((t: number, sl: any) => t + (sl.sellingPrice || sl.sqft * i.unitPrice), 0);
    if (isSlab) return s + i.sqft * i.unitPrice;
    const tpb = p?.tilesPerBox || 1;
    return s + i.boxes * i.unitPrice + (i.loose / tpb) * i.unitPrice;
  }, 0);

  const cartSavings  = cart.reduce((s, i) => {
    const p = prods.find(x => x.id === i.productId);
    const isSlab = isSlabCat(p?.category);
    const disc = i.discountAmount || 0;
    if (isSlab) return s + i.sqft * disc;
    const tpb = p?.tilesPerBox || 1;
    return s + (i.boxes + i.loose / tpb) * disc;
  }, 0);

  // Product reviews
  const productReviews = (pid: string) => reviews.filter(r => r.productId === pid);
  const avgRating      = (pid: string) => {
    const rs = productReviews(pid);
    return rs.length ? r2(rs.reduce((s, r) => s + r.rating, 0) / rs.length) : 0;
  };

  // ── Deep link ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialProductId) {
      const p = prods.find(x => x.id === initialProductId);
      if (p) { setSelectedProduct(p); setActiveImgIdx(0); }
    }
  }, [initialProductId, prods]);

  // ── QR ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedProduct && showQR) {
      const url = `${window.location.origin}${window.location.pathname}?viewProduct=${selectedProduct.id}&mode=public`;
      QRCode.toDataURL(url, { width: 300, margin: 2 }, (err: any, u: string) => { if (!err) setQrUrl(u); });
    }
  }, [selectedProduct, showQR]);

  // ── Cart helpers ──────────────────────────────────────────────────────────────
  const removeFromCart = (pid: string) => setCart(c => c.filter(i => i.productId !== pid));

  const confirmAddToCart = useCallback(() => {
    if (!configuring) return;
    const { product, sqft, purpose, selectedSlabIds } = configuring;
    const isSlab = isSlabCat(product.category);
    const offer  = getOffer(product);
    let unitPrice = product.sellingPrice || 0;
    let origPrice = unitPrice;
    let disc = 0;
    if (offer) {
      disc = offer.type === 'Percentage' ? (unitPrice * offer.value) / 100 : offer.value;
      unitPrice -= disc;
    }
    let boxes = 0, loose = 0;
    let slabDetails: any[] = [];
    let finalSqft = sqft;
    let finalUnitPrice = unitPrice;

    if (isSlab && selectedSlabIds.length > 0) {
      const slabs = (product.slabs || []).filter((s: any) => selectedSlabIds.includes(s.id) && !s.isSold);
      slabDetails = slabs.map((s: any) => ({ id: s.id, slabNo: s.slabNo, sqft: s.sqft || 0, finish: s.finish, sellingPrice: s.sellingPrice, sellingPricePerSqft: s.sellingPricePerSqft }));
      finalSqft = slabs.reduce((t: number, s: any) => t + (s.sqft || 0), 0);
      finalUnitPrice = slabs[0]?.sellingPricePerSqft || (product.sellingPricePerSqft || (origPrice / (product.sqftPerBox || 1)));
      boxes = 0; loose = 0;
    } else if (isSlab) {
      finalUnitPrice = product.sqftPerBox > 0 ? origPrice / product.sqftPerBox : origPrice;
    } else {
      const sqftPB = product.sqftPerBox || 1;
      const tpb    = product.tilesPerBox || 1;
      const sqftPT = sqftPB / tpb;
      boxes = Math.floor(sqft / sqftPB);
      const rem = sqft % sqftPB;
      loose = Math.ceil(rem / sqftPT);
      if (loose >= tpb) { boxes += Math.floor(loose / tpb); loose %= tpb; }
    }

    const item: CartItem = {
      productId: product.id, productName: product.name, category: product.category,
      sqft: finalSqft, boxes, loose,
      unitPrice: finalUnitPrice, originalPrice: isSlab ? finalUnitPrice : origPrice,
      discountAmount: isSlab ? 0 : disc,
      appliedOfferId: offer?.id, purpose,
      selectedSlabIds: isSlab ? selectedSlabIds : undefined,
      selectedSlabNos: slabDetails.map(s => s.slabNo),
      slabDetails: slabDetails.length > 0 ? slabDetails : undefined,
    };

    setCart(prev => {
      const existing = prev.find(x => x.productId === product.id);
      return existing ? prev.map(x => x.productId === product.id ? item : x) : [...prev, item];
    });
    setConfigDone(true);
  }, [configuring, prods, publishedOffers]);

  // ── OTP ───────────────────────────────────────────────────────────────────────
  const sendOtp = () => {
    if (!checkoutForm.mobile || checkoutForm.mobile.length < 10) return;
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    setGeneratedOtp(otp); setOtpSent(true); setOtpError('');
    alert(`[DEMO] OTP: ${otp}`);
  };
  const verifyOtp = () => {
    if (otpInput === generatedOtp) { setOtpVerified(true); setOtpError(''); }
    else setOtpError('Invalid OTP');
  };

  // ── Submit order ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settings.dashboardVisibility.enableGalleryOtp && !otpVerified) { alert('Please verify OTP'); return; }
    setIsSubmitting(true);
    try {
      const success = await store.addGalleryLead({
        customerName: checkoutForm.name, customerMobile: checkoutForm.mobile,
        customerPlace: checkoutForm.place, remarks: checkoutForm.remarks,
        source: 'Gallery', totalAmount: cartTotal - cartSavings, totalDiscount: cartSavings,
        items: cart.map(item => {
          const p = prods.find(x => x.id === item.productId);
          const isSlab = isSlabCat(p?.category);
          const tpb = p?.tilesPerBox || 1;
          let totalValue: number;
          if (isSlab && item.slabDetails?.length) totalValue = item.slabDetails.reduce((s: number, sl: any) => s + (sl.sellingPrice || sl.sqft * item.unitPrice), 0);
          else if (isSlab) totalValue = item.sqft * item.unitPrice;
          else totalValue = item.boxes * item.unitPrice + (item.loose / tpb) * item.unitPrice;
          return {
            productId: item.productId, productName: item.productName, category: item.category,
            requestedSqft: item.sqft, calculatedBoxes: item.boxes,
            unitPrice: item.unitPrice, totalValue, purpose: item.purpose,
            appliedOfferId: item.appliedOfferId, discountAmount: (item.discountAmount || 0) * (isSlab ? item.sqft : item.boxes + item.loose / tpb),
            originalPrice: item.originalPrice,
            selectedSlabIds: item.selectedSlabIds, selectedSlabNos: item.selectedSlabNos, slabDetails: item.slabDetails,
          };
        })
      });
      if (success) { setOrderSuccess(true); setCart([]); }
      setCheckoutForm({ name: '', mobile: '', place: '', remarks: '' });
      setOtpSent(false); setOtpVerified(false); setOtpInput('');
      setTimeout(() => { setOrderSuccess(false); setShowCart(false); }, 4000);
    } catch { alert('Failed. Try again.'); }
    finally { setIsSubmitting(false); }
  };

  // ── Review submission ─────────────────────────────────────────────────────────
  const submitReview = () => {
    if (!selectedProduct || !reviewForm.name || !reviewForm.comment) return;
    const rev: Review = {
      id: `rev-${Date.now()}`, productId: selectedProduct.id,
      name: reviewForm.name, rating: reviewForm.rating, comment: reviewForm.comment,
      date: new Date().toLocaleDateString('en-IN'),
    };
    const updated = [rev, ...reviews];
    setReviews(updated);
    localStorage.setItem('royal_reviews', JSON.stringify(updated));
    setReviewForm({ name: '', rating: 5, comment: '' });
    setShowReviewForm(false);
  };

  // ── Stars ─────────────────────────────────────────────────────────────────────
  const Stars = ({ rating, size = 'sm', interactive = false, onChange }: { rating: number; size?: string; interactive?: boolean; onChange?: (r: number) => void }) => (
    <div className={`flex gap-0.5 ${size === 'lg' ? 'text-lg' : 'text-sm'}`}>
      {[1,2,3,4,5].map(i => (
        <button key={i} type="button"
          onClick={() => interactive && onChange?.(i)}
          className={`${i <= rating ? 'text-amber-400' : 'text-slate-200'} ${interactive ? 'hover:text-amber-300 transition-colors cursor-pointer' : 'cursor-default'}`}>
          ★
        </button>
      ))}
    </div>
  );

  // ── Product card ──────────────────────────────────────────────────────────────
  const ProductCard = ({ p }: { p: Product }) => {
    const offer      = getOffer(p);
    const inCart     = cart.some(c => c.productId === p.id);
    const inCompare  = compareList.includes(p.id);
    const rating     = avgRating(p.id);
    const revCount   = productReviews(p.id).length;
    const isSlab     = isSlabCat(p.category);
    const availSlabs = isSlab ? (p.slabs || []).filter((s: any) => !s.isSold).length : 0;
    const stockOk    = isSlab ? availSlabs > 0 : p.stockBoxes > (p.reorderLevel || 0);

    return (
      <div className={`group relative bg-white rounded-3xl overflow-hidden transition-all duration-300 border cursor-pointer
        ${inCompare ? 'border-indigo-400 ring-2 ring-indigo-200 shadow-indigo-100' : 'border-stone-100 hover:border-stone-300 hover:shadow-xl hover:-translate-y-1'}
        ${viewMode === 'list' ? 'flex items-center gap-0' : ''}`}>

        {/* Image */}
        <div className={`relative overflow-hidden bg-stone-100 ${viewMode === 'list' ? 'w-36 h-36 shrink-0 rounded-l-3xl' : 'h-64'}`}
          onClick={() => { setSelectedProduct(p); setActiveImgIdx(0); setShowQR(false); }}>
          <img src={p.images?.[0] || 'https://picsum.photos/seed/tile/400/400'} alt={p.name}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-108"
            loading="lazy" referrerPolicy="no-referrer" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

          {/* Badges */}
          <div className="absolute top-3 left-3 flex flex-col gap-1.5">
            {offer && (
              <span className="bg-amber-500 text-white text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shadow-lg">
                {offer.type === 'Percentage' ? `${offer.value}% OFF` : `₹${offer.value} OFF`}
              </span>
            )}
            {inCart && (
              <span className="bg-emerald-600 text-white text-[9px] font-black px-2.5 py-1 rounded-full uppercase shadow">✓ In Cart</span>
            )}
          </div>
          <div className="absolute top-3 right-3">
            <span className={`text-[8px] font-black px-2 py-1 rounded-full border backdrop-blur-sm uppercase
              ${stockOk ? 'bg-white/90 text-emerald-700 border-emerald-200' : 'bg-white/90 text-rose-600 border-rose-200'}`}>
              {isSlab ? `${availSlabs} slabs` : stockOk ? `${p.stockBoxes} boxes` : 'Low'}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className={`${viewMode === 'list' ? 'flex-1 flex items-center justify-between px-5 py-4 gap-4' : 'p-5'}`}>
          <div className={`${viewMode === 'list' ? 'flex-1 min-w-0' : 'space-y-3'}`}
            onClick={() => { setSelectedProduct(p); setActiveImgIdx(0); }}>
            <div>
              <div className="text-[9px] font-black text-amber-600 uppercase tracking-[0.12em]">{p.brand}</div>
              <h3 className="font-black text-slate-900 leading-tight mt-0.5 truncate" style={{ fontSize: '15px' }}>{p.name}</h3>
              {p.size && <div className="text-[9px] text-stone-400 font-bold mt-0.5">{p.size} · {p.finish || p.category}</div>}
            </div>

            {rating > 0 && (
              <div className="flex items-center gap-1.5">
                <Stars rating={Math.round(rating)} />
                <span className="text-[9px] text-stone-400 font-bold">({revCount})</span>
              </div>
            )}

            {viewMode !== 'list' && p.sellingPrice > 0 && (
              <div className="flex items-baseline gap-2 pt-1">
                <span className="text-lg font-black text-slate-900">{INR(p.sellingPrice)}</span>
                <span className="text-[9px] text-stone-400 font-bold">/{isSlab ? 'slab' : p.unitType || 'box'}</span>
                {offer && (
                  <span className="text-xs text-stone-400 line-through font-bold">
                    {INR(offer.type === 'Percentage' ? p.sellingPrice / (1 - offer.value / 100) : p.sellingPrice + offer.value)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Action row */}
          <div className={`flex gap-2 mt-0 ${viewMode === 'list' ? 'flex-col w-36 shrink-0' : 'pt-3 border-t border-stone-100'}`}>
            {settings.dashboardVisibility.enableGalleryCart && (
              <button onClick={e => { e.stopPropagation(); setConfiguring({ product: p, sqft: p.sqftPerBox || 10, purpose: '', selectedSlabIds: [] }); setConfigDone(false); }}
                className={`flex-1 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all active:scale-95
                  ${inCart ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-900 text-white hover:bg-amber-600'}`}>
                {inCart ? '✓ Added' : '+ Add'}
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); setCompareList(prev => inCompare ? prev.filter(x => x !== p.id) : prev.length < 3 ? [...prev, p.id] : prev); }}
              className={`px-3 py-2.5 rounded-xl font-black text-[9px] uppercase transition-all
                ${inCompare ? 'bg-indigo-600 text-white' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}
              title="Compare">
              <i className="fas fa-balance-scale text-[10px]"></i>
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── RENDER ────────────────────────────────────────────────────────────────────
  const { galleryTitle, gallerySubTitle, galleryNotification, showroomName, showroomPhone, decimalPlaceText, dashboardVisibility } = settings;
  const { showGalleryStock, enableGalleryCart } = dashboardVisibility;

  return (
    <div className="min-h-screen bg-stone-50 selection:bg-amber-100">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=DM+Sans:wght@400;500;700&display=swap');
        .gal-body { font-family: 'DM Sans', sans-serif; }
        .gal-display { font-family: 'Playfair Display', serif; }
        @keyframes mq { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .mq-anim { animation: mq 22s linear infinite; }
        .group-hover\\:scale-108:hover { transform: scale(1.08); }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.5s ease both; }
      `}</style>

      {/* ── Marquee ── */}
      {galleryNotification && (
        <div className="bg-amber-600 text-white py-2 overflow-hidden whitespace-nowrap z-[110] relative">
          <div className="inline-block mq-anim font-black text-[10px] uppercase tracking-widest">
            {Array(4).fill(galleryNotification + ' &nbsp;·&nbsp; ').join('')}
          </div>
        </div>
      )}

      {/* ── Navbar ── */}
      <nav className="bg-white/95 backdrop-blur-sm border-b border-stone-200 sticky top-0 z-[100]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center">
              <span className="text-amber-400 font-black text-lg gal-display">{(galleryTitle || 'R')[0]}</span>
            </div>
            <div className="hidden sm:block">
              <div className="gal-display font-bold text-slate-900 leading-none" style={{ fontSize: '17px' }}>{galleryTitle}</div>
              <div className="text-[8px] font-black text-amber-600 uppercase tracking-[0.15em] mt-0.5">{gallerySubTitle}</div>
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 flex items-center gap-2 bg-stone-100 rounded-2xl px-4 py-2.5 max-w-md">
            <i className="fas fa-search text-stone-400 text-sm"></i>
            <input ref={searchRef} type="text" placeholder="Search tiles, granite, brand…"
              className="flex-1 bg-transparent outline-none text-sm text-slate-700 font-medium"
              value={searchQ} onChange={e => setSearchQ(e.target.value)} />
            {searchQ && <button onClick={() => setSearchQ('')} className="text-stone-400 hover:text-slate-700"><i className="fas fa-times text-xs"></i></button>}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Compare badge */}
            {compareList.length > 0 && (
              <button onClick={() => setShowCompare(true)}
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-indigo-700 transition-all">
                <i className="fas fa-balance-scale text-xs"></i>
                Compare ({compareList.length})
              </button>
            )}
            {/* Cart */}
            {enableGalleryCart && (
              <button onClick={() => setShowCart(true)}
                className="relative w-11 h-11 bg-stone-100 rounded-xl flex items-center justify-center text-slate-700 hover:bg-amber-100 hover:text-amber-700 transition-all">
                <i className="fas fa-shopping-bag"></i>
                {cart.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-white w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center border-2 border-white">{cart.length}</span>
                )}
              </button>
            )}
            <button onClick={onAdminAccess}
              className="hidden sm:block px-4 py-2 border border-stone-300 text-slate-700 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all">
              Login
            </button>
          </div>
        </div>
      </nav>

      {/* ── Category strip ── */}
      <div className="bg-white border-b border-stone-100 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 px-4 sm:px-6 py-3 max-w-7xl mx-auto">
          {categories.map(cat => (
            <button key={cat} onClick={() => setActiveCat(cat)}
              className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all
                ${activeCat === cat ? 'bg-slate-900 text-white shadow' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main ── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 gal-body">

        {/* Hero — only on All */}
        {activeCat === 'All' && !searchQ && (
          <div className="relative h-72 sm:h-96 rounded-3xl overflow-hidden mb-10 shadow-xl group">
            <img src="https://images.unsplash.com/photo-1600585154363-67eb9e2e2099?w=1600&q=80"
              alt="Hero" className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
              referrerPolicy="no-referrer" />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900/85 via-slate-900/50 to-transparent flex flex-col justify-center px-8 sm:px-16 space-y-4">
              <div className="text-amber-400 font-black text-[10px] uppercase tracking-[0.3em]">Premium Collection 2026</div>
              <h2 className="gal-display text-3xl sm:text-5xl font-bold text-white leading-tight italic">
                Elevate Your<br/>Living Space
              </h2>
              <p className="text-stone-300 max-w-sm text-sm leading-relaxed hidden sm:block">
                Curated tiles, granites & sanitaryware for modern architecture.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setActiveCat('Wall Tile')}
                  className="bg-amber-600 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-700 transition-all shadow-lg">
                  Explore Tiles
                </button>
                <button onClick={() => setActiveCat('Granite')}
                  className="bg-white/15 backdrop-blur text-white border border-white/25 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/25 transition-all">
                  View Granite
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="text-sm font-bold text-stone-500">
            {visibleProds.length} <span className="text-stone-400">products</span>
            {searchQ && <span className="ml-2 text-amber-600">for "{searchQ}"</span>}
          </div>
          <div className="flex items-center gap-2">
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              className="text-[10px] font-black uppercase bg-white border border-stone-200 rounded-xl px-3 py-2 outline-none text-stone-600">
              <option value="default">Sort: Default</option>
              <option value="price-asc">Price: Low → High</option>
              <option value="price-desc">Price: High → Low</option>
              <option value="name">Name A→Z</option>
            </select>
            <div className="flex bg-stone-100 rounded-xl p-1 gap-1">
              {(['grid','list'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${viewMode === m ? 'bg-white shadow text-slate-900' : 'text-stone-400 hover:text-stone-600'}`}>
                  <i className={`fas fa-${m === 'grid' ? 'th-large' : 'list'} text-xs`}></i>
                </button>
              ))}
            </div>
            {compareList.length > 0 && (
              <button onClick={() => setShowCompare(true)}
                className="sm:hidden flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase">
                <i className="fas fa-balance-scale text-[10px]"></i> {compareList.length}
              </button>
            )}
          </div>
        </div>

        {/* Grid */}
        {visibleProds.length === 0 ? (
          <div className="py-32 text-center space-y-4">
            <div className="text-7xl opacity-10 gal-display">∅</div>
            <div className="text-xl gal-display font-bold text-stone-400 italic">Nothing matched your search</div>
            <button onClick={() => { setSearchQ(''); setActiveCat('All'); }}
              className="text-[10px] font-black uppercase text-amber-600 hover:underline">Clear filters</button>
          </div>
        ) : (
          <div className={viewMode === 'grid'
            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5'
            : 'flex flex-col gap-3'}>
            {visibleProds.map(p => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════
          PRODUCT DETAIL MODAL
      ═══════════════════════════════════════════════════ */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 gal-body">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setSelectedProduct(null)} />
          <div className="relative bg-white w-full sm:max-w-4xl rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-black bg-stone-100 text-stone-500 px-2.5 py-1 rounded-full uppercase">{selectedProduct.category}</span>
                <span className="text-[9px] font-bold text-stone-400">{selectedProduct.brand}</span>
              </div>
              <button onClick={() => setSelectedProduct(null)}
                className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center text-stone-500 hover:bg-stone-200">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2">

                {/* Images */}
                <div className="relative bg-stone-100">
                  <div className="aspect-square relative overflow-hidden">
                    <img src={selectedProduct.images?.[activeImgIdx] || 'https://picsum.photos/seed/tile/600/600'}
                      alt={selectedProduct.name}
                      className="w-full h-full object-cover transition-all duration-500"
                      referrerPolicy="no-referrer" />
                    {selectedProduct.images?.length > 1 && (
                      <>
                        <button onClick={() => setActiveImgIdx(i => (i - 1 + selectedProduct.images.length) % selectedProduct.images.length)}
                          className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 rounded-xl flex items-center justify-center shadow hover:bg-white">
                          <i className="fas fa-chevron-left text-sm text-slate-700"></i>
                        </button>
                        <button onClick={() => setActiveImgIdx(i => (i + 1) % selectedProduct.images.length)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/90 rounded-xl flex items-center justify-center shadow hover:bg-white">
                          <i className="fas fa-chevron-right text-sm text-slate-700"></i>
                        </button>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                          {selectedProduct.images.map((_, i) => (
                            <button key={i} onClick={() => setActiveImgIdx(i)}
                              className={`rounded-full transition-all ${i === activeImgIdx ? 'bg-amber-500 w-5 h-2' : 'bg-white/70 w-2 h-2'}`} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Thumbnail strip */}
                  {selectedProduct.images?.length > 1 && (
                    <div className="flex gap-2 p-3 overflow-x-auto scrollbar-hide">
                      {selectedProduct.images.map((img, i) => (
                        <button key={i} onClick={() => setActiveImgIdx(i)}
                          className={`shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${i === activeImgIdx ? 'border-amber-500' : 'border-transparent hover:border-stone-300'}`}>
                          <img src={img} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-6 space-y-5 flex flex-col">
                  <div>
                    <h2 className="gal-display text-2xl font-bold text-slate-900 leading-tight">{selectedProduct.name}</h2>
                    {selectedProduct.size && <div className="text-sm text-stone-500 font-bold mt-1">{selectedProduct.size} · {selectedProduct.finish || 'Standard'}</div>}

                    {/* Rating summary */}
                    {avgRating(selectedProduct.id) > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <Stars rating={Math.round(avgRating(selectedProduct.id))} />
                        <span className="text-sm font-bold text-stone-500">{avgRating(selectedProduct.id)} · {productReviews(selectedProduct.id).length} reviews</span>
                      </div>
                    )}
                  </div>

                  {/* Price */}
                  {selectedProduct.sellingPrice > 0 && (
                    <div className="bg-stone-50 rounded-2xl px-4 py-3 space-y-1">
                      {(() => {
                        const offer = getOffer(selectedProduct);
                        const origPrice = offer
                          ? (offer.type === 'Percentage' ? selectedProduct.sellingPrice / (1 - offer.value / 100) : selectedProduct.sellingPrice + offer.value)
                          : selectedProduct.sellingPrice;
                        const isSlab = isSlabCat(selectedProduct.category);
                        const unit = isSlab ? '/slab' : `/${selectedProduct.unitType || 'box'}`;
                        return (
                          <>
                            <div className="flex items-baseline gap-3">
                              <span className="text-2xl font-black text-slate-900">{INR(selectedProduct.sellingPrice)}</span>
                              <span className="text-sm text-stone-400 font-bold">{unit}</span>
                              {offer && <span className="text-sm text-stone-400 line-through">{INR(origPrice)}</span>}
                            </div>
                            {offer && (
                              <div className="text-sm font-black text-emerald-600">
                                Save {offer.type === 'Percentage' ? `${offer.value}%` : INR(offer.value)} · {offer.title}
                              </div>
                            )}
                            {selectedProduct.sellingPricePerSqft && (
                              <div className="text-[10px] font-bold text-stone-400">= ₹{selectedProduct.sellingPricePerSqft}/SqFt</div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* Specs grid */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: 'Category', val: selectedProduct.category },
                      { label: 'Brand',    val: selectedProduct.brand },
                      { label: 'Size',     val: selectedProduct.size },
                      { label: 'Finish',   val: selectedProduct.finish },
                      { label: 'Grade',    val: (selectedProduct as any).grade },
                      { label: 'Stock',    val: isSlabCat(selectedProduct.category)
                          ? `${(selectedProduct.slabs||[]).filter((s:any)=>!s.isSold).length} slabs`
                          : showGalleryStock ? `${selectedProduct.stockBoxes} boxes` : 'Available' },
                    ].filter(s => s.val).map(({ label, val }) => (
                      <div key={label} className="bg-stone-50 rounded-xl px-3 py-2">
                        <div className="text-[8px] font-black text-stone-400 uppercase tracking-widest mb-0.5">{label}</div>
                        <div className="font-bold text-slate-700 text-xs truncate">{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Slab preview for Kadapa/Granite */}
                  {isSlabCat(selectedProduct.category) && (selectedProduct.slabs || []).length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[9px] font-black text-stone-400 uppercase tracking-widest">Available Slabs</div>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {(selectedProduct.slabs || []).filter((s:any) => !s.isSold).map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between bg-stone-50 rounded-xl px-3 py-2">
                            <div>
                              <span className="font-black text-slate-800 text-xs">#{s.slabNo}</span>
                              {s.finish && <span className="text-amber-600 text-[9px] font-bold ml-2">{s.finish}</span>}
                              <span className="text-stone-400 text-[9px] ml-2">{s.sqft} sqft</span>
                            </div>
                            {s.sellingPrice && <span className="font-black text-emerald-700 text-sm">{INR(s.sellingPrice)}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 mt-auto pt-2">
                    {enableGalleryCart && (
                      <button onClick={() => { setConfiguring({ product: selectedProduct, sqft: selectedProduct.sqftPerBox || 10, purpose: '', selectedSlabIds: [] }); setConfigDone(false); setSelectedProduct(null); }}
                        className="flex-1 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95">
                        {cart.some(c => c.productId === selectedProduct.id) ? '✓ Update Cart' : '+ Add to Cart'}
                      </button>
                    )}
                    <button onClick={() => setShowQR(!showQR)}
                      className="w-12 py-3 bg-stone-100 text-stone-500 rounded-2xl flex items-center justify-center hover:bg-stone-200 transition-all">
                      <i className="fas fa-qrcode"></i>
                    </button>
                    <button onClick={() => {
                      const msg = `Hi! I'm interested in *${selectedProduct.name}* from ${showroomName}. Size: ${selectedProduct.size}. Please share availability.`;
                      window.open(`https://wa.me/${(showroomPhone || '').replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
                    }} className="w-12 py-3 bg-emerald-500 text-white rounded-2xl flex items-center justify-center hover:bg-emerald-600 transition-all">
                      <i className="fab fa-whatsapp text-sm"></i>
                    </button>
                  </div>

                  {showQR && qrUrl && (
                    <div className="flex flex-col items-center gap-2 bg-stone-50 rounded-2xl p-4">
                      <img src={qrUrl} alt="QR" className="w-32 h-32 rounded-xl" />
                      <div className="text-[9px] font-bold text-stone-400 text-center">Scan to share this product</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Reviews section */}
              <div className="border-t border-stone-100 px-6 py-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="gal-display font-bold text-lg text-slate-900">Customer Reviews</h3>
                    {productReviews(selectedProduct.id).length > 0 && (
                      <div className="flex items-center gap-2 mt-1">
                        <Stars rating={Math.round(avgRating(selectedProduct.id))} size="lg" />
                        <span className="font-black text-slate-700">{avgRating(selectedProduct.id)}/5</span>
                        <span className="text-stone-400 text-sm">· {productReviews(selectedProduct.id).length} reviews</span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => setShowReviewForm(v => !v)}
                    className="px-4 py-2 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-amber-700 transition-all">
                    + Write Review
                  </button>
                </div>

                {/* Review form */}
                {showReviewForm && (
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 space-y-4 fade-up">
                    <div className="font-black text-slate-800">Your Review</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[8px] font-black text-stone-400 uppercase block mb-1">Your Name</label>
                        <input className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400"
                          placeholder="Name" value={reviewForm.name} onChange={e => setReviewForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-stone-400 uppercase block mb-1">Rating</label>
                        <Stars rating={reviewForm.rating} size="lg" interactive onChange={r => setReviewForm(f => ({ ...f, rating: r }))} />
                      </div>
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-stone-400 uppercase block mb-1">Your Experience</label>
                      <textarea className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400 h-20 resize-none"
                        placeholder="Tell others about this product…" value={reviewForm.comment} onChange={e => setReviewForm(f => ({ ...f, comment: e.target.value }))} />
                    </div>
                    <div className="flex gap-3">
                      <button onClick={submitReview} className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase hover:bg-amber-700">Submit Review</button>
                      <button onClick={() => setShowReviewForm(false)} className="px-4 py-2.5 bg-stone-100 text-stone-500 rounded-xl font-black text-[10px] uppercase hover:bg-stone-200">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Review list */}
                {productReviews(selectedProduct.id).length === 0 ? (
                  <div className="text-center py-8 text-stone-300 font-bold text-sm italic gal-display">
                    Be the first to review this product
                  </div>
                ) : (
                  <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
                    {productReviews(selectedProduct.id).map(rev => (
                      <div key={rev.id} className="bg-stone-50 rounded-2xl px-4 py-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center font-black text-amber-700 text-sm">
                              {rev.name[0]?.toUpperCase()}
                            </div>
                            <div>
                              <div className="font-black text-slate-800 text-sm">{rev.name}</div>
                              <div className="text-[8px] text-stone-400 font-bold">{rev.date}</div>
                            </div>
                          </div>
                          <Stars rating={rev.rating} />
                        </div>
                        <p className="text-sm text-slate-600 font-medium leading-relaxed">{rev.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          CONFIGURE / ADD TO CART MODAL
      ═══════════════════════════════════════════════════ */}
      {configuring && (
        <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-0 sm:p-4 gal-body">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => { setConfiguring(null); setConfigDone(false); }} />
          <div className="relative bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl max-h-[88vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95">

            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 shrink-0">
              <div>
                <div className="font-black text-slate-900 text-base">{configuring.product.name}</div>
                <div className="text-[9px] text-stone-400 font-bold mt-0.5">{configuring.product.brand} · {configuring.product.category}</div>
              </div>
              <button onClick={() => { setConfiguring(null); setConfigDone(false); }}
                className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center text-stone-400 hover:bg-stone-200">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {configDone ? (
                /* Success state */
                <div className="py-8 text-center space-y-4 fade-up">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                    <i className="fas fa-check text-2xl text-emerald-600"></i>
                  </div>
                  <div className="font-black text-slate-800 text-lg">Added to cart!</div>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => { setConfiguring(null); setConfigDone(false); }}
                      className="px-6 py-3 bg-stone-100 text-stone-700 rounded-2xl font-black text-[10px] uppercase hover:bg-stone-200 transition-all">
                      Continue Shopping
                    </button>
                    <button onClick={() => { setConfiguring(null); setConfigDone(false); setShowCart(true); }}
                      className="px-6 py-3 bg-amber-600 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-amber-700 transition-all">
                      View Cart ({cart.length})
                    </button>
                  </div>
                </div>
              ) : isSlabCat(configuring.product.category) ? (
                /* Slab selector */
                <div className="space-y-4">
                  <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Select Individual Slabs</div>
                  <p className="text-sm text-stone-500 font-medium">Tap each slab to select. Price and sqft calculated automatically.</p>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {((configuring.product.slabs || []) as any[]).filter(s => !s.isSold).length === 0 ? (
                      <div className="text-center py-8 text-stone-300 font-bold text-sm italic">No slabs available currently</div>
                    ) : ((configuring.product.slabs || []) as any[]).filter(s => !s.isSold).map((slab: any) => {
                      const sel = (configuring.selectedSlabIds || []).includes(slab.id);
                      const sqft = slab.sqft || 0;
                      const price = slab.sellingPrice || sqft * (slab.sellingPricePerSqft || configuring.product.sellingPricePerSqft || 0);
                      return (
                        <button key={slab.id}
                          onClick={() => {
                            const cur = configuring.selectedSlabIds || [];
                            const next = sel ? cur.filter(id => id !== slab.id) : [...cur, slab.id];
                            setConfiguring({ ...configuring, selectedSlabIds: next });
                          }}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 text-left transition-all active:scale-98
                            ${sel ? 'border-amber-500 bg-amber-50 shadow-sm' : 'border-stone-100 bg-stone-50 hover:border-stone-300'}`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${sel ? 'bg-amber-500 border-amber-500' : 'border-stone-300'}`}>
                              {sel && <i className="fas fa-check text-white text-[8px]"></i>}
                            </div>
                            <div>
                              <div className="font-black text-slate-800 text-sm">#{slab.slabNo}</div>
                              <div className="text-[9px] font-bold text-stone-400 mt-0.5">
                                {slab.lengthFt && `${slab.lengthFt}' × ${slab.heightFt}' · `}{sqft} SqFt
                                {slab.finish && <span className="text-amber-500 ml-1.5">{slab.finish}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            {price > 0 && <div className="font-black text-emerald-700">{INR(Math.round(price))}</div>}
                            {slab.sellingPricePerSqft && <div className="text-[8px] text-stone-400">₹{slab.sellingPricePerSqft}/SqFt</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Selection summary */}
                  {(configuring.selectedSlabIds || []).length > 0 && (() => {
                    const selSlabs = ((configuring.product.slabs || []) as any[]).filter(s => (configuring.selectedSlabIds || []).includes(s.id));
                    const totalSqft = selSlabs.reduce((t: number, s: any) => t + (s.sqft || 0), 0);
                    const totalAmt  = selSlabs.reduce((t: number, s: any) => t + (s.sellingPrice || (s.sqft || 0) * (s.sellingPricePerSqft || configuring.product.sellingPricePerSqft || 0)), 0);
                    return (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex justify-between items-center">
                        <div>
                          <div className="font-black text-emerald-800">{selSlabs.length} slab{selSlabs.length > 1 ? 's' : ''} · {totalSqft.toFixed(1)} SqFt</div>
                          <div className="text-[9px] text-emerald-600 font-bold">Selected</div>
                        </div>
                        {totalAmt > 0 && <div className="font-black text-xl text-emerald-700">{INR(Math.round(totalAmt))}</div>}
                      </div>
                    );
                  })()}

                  <div>
                    <label className="text-[8px] font-black text-stone-400 uppercase block mb-1.5">Purpose / Area (optional)</label>
                    <input className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400"
                      placeholder="e.g. Main hall, Kitchen floor…"
                      value={configuring.purpose}
                      onChange={e => setConfiguring({ ...configuring, purpose: e.target.value })} />
                  </div>
                </div>
              ) : (
                /* Tile configurator */
                <div className="space-y-5">
                  <div>
                    <label className="text-[8px] font-black text-stone-400 uppercase block mb-2">Area Required (SqFt)</label>
                    <div className="relative">
                      <input type="number" min="0" step="0.5"
                        className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-2xl font-black text-2xl outline-none focus:border-amber-400 focus:bg-white transition-all"
                        value={configuring.sqft || ''}
                        onChange={e => setConfiguring({ ...configuring, sqft: parseFloat(e.target.value) || 0 })} />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-stone-400 text-sm">SqFt</span>
                    </div>
                    {configuring.sqft > 0 && configuring.product.sqftPerBox > 0 && (
                      <div className="mt-2 text-[10px] font-bold text-stone-400">
                        ≈ {Math.ceil(configuring.sqft / configuring.product.sqftPerBox)} boxes
                        {configuring.product.sellingPrice > 0 && (
                          <span className="ml-3 text-emerald-600 font-black">
                            Est. {INR(Math.ceil(configuring.sqft / configuring.product.sqftPerBox) * configuring.product.sellingPrice)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[8px] font-black text-stone-400 uppercase block mb-2">Purpose / Area</label>
                    <input className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400"
                      placeholder="e.g. Living room, Bathroom, Kitchen…"
                      value={configuring.purpose}
                      onChange={e => setConfiguring({ ...configuring, purpose: e.target.value })} />
                  </div>
                </div>
              )}
            </div>

            {!configDone && (
              <div className="px-6 py-4 border-t border-stone-100 shrink-0">
                <button onClick={confirmAddToCart}
                  disabled={isSlabCat(configuring.product.category) && (configuring.selectedSlabIds || []).length === 0}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">
                  {isSlabCat(configuring.product.category) && (configuring.selectedSlabIds || []).length === 0
                    ? 'Select at least one slab'
                    : `Add to Cart${isSlabCat(configuring.product.category) && (configuring.selectedSlabIds || []).length > 0 ? ` (${(configuring.selectedSlabIds || []).length} slabs)` : ''}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          COMPARE DRAWER
      ═══════════════════════════════════════════════════ */}
      {showCompare && compareProds.length > 0 && (
        <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-0 sm:p-4 gal-body">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowCompare(false)} />
          <div className="relative bg-white w-full sm:max-w-5xl rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 shrink-0">
              <div>
                <h3 className="gal-display font-bold text-lg text-slate-900">Compare Products</h3>
                <p className="text-[9px] font-bold text-stone-400 uppercase mt-0.5">Side-by-side comparison</p>
              </div>
              <button onClick={() => setShowCompare(false)}
                className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center text-stone-400 hover:bg-stone-200">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            <div className="overflow-auto flex-1 p-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100">
                    <th className="text-left py-3 pr-4 font-black text-[9px] text-stone-400 uppercase w-32">Attribute</th>
                    {compareProds.map(p => (
                      <th key={p.id} className="px-4 py-3 text-center align-top">
                        <div className="relative">
                          <button onClick={() => setCompareList(prev => prev.filter(id => id !== p.id))}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-rose-100 text-rose-500 rounded-full text-[9px] flex items-center justify-center hover:bg-rose-200">×</button>
                          <img src={p.images?.[0]} className="w-24 h-24 object-cover rounded-2xl mx-auto mb-2 shadow-sm" referrerPolicy="no-referrer" />
                          <div className="font-black text-slate-800 text-xs leading-tight">{p.name}</div>
                          <div className="text-[9px] text-stone-400 font-bold">{p.brand}</div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {[
                    { label: 'Price',      fn: (p: Product) => p.sellingPrice > 0 ? INR(p.sellingPrice) : '—' },
                    { label: '₹/SqFt',    fn: (p: Product) => (p as any).sellingPricePerSqft ? INR((p as any).sellingPricePerSqft) : p.sqftPerBox > 0 ? INR(p.sellingPrice / p.sqftPerBox) : '—' },
                    { label: 'Category',   fn: (p: Product) => p.category },
                    { label: 'Size',       fn: (p: Product) => p.size || '—' },
                    { label: 'Finish',     fn: (p: Product) => p.finish || '—' },
                    { label: 'Brand',      fn: (p: Product) => p.brand },
                    { label: 'Grade',      fn: (p: Product) => (p as any).grade || '—' },
                    { label: 'Stock',      fn: (p: Product) => isSlabCat(p.category) ? `${(p.slabs||[]).filter((s:any)=>!s.isSold).length} slabs` : `${p.stockBoxes} boxes` },
                    { label: 'Rating',     fn: (p: Product) => avgRating(p.id) > 0 ? `${avgRating(p.id)} / 5 (${productReviews(p.id).length} reviews)` : 'No reviews yet' },
                  ].map(({ label, fn }) => (
                    <tr key={label} className="hover:bg-stone-50">
                      <td className="py-3 pr-4 font-black text-[9px] text-stone-400 uppercase tracking-widest">{label}</td>
                      {compareProds.map(p => {
                        const val = fn(p);
                        const vals = compareProds.map(fn);
                        const isBest = label === 'Rating' && val === [...vals].sort().reverse()[0];
                        const isCheapest = label === 'Price' && val === [...vals].sort()[0];
                        return (
                          <td key={p.id} className="px-4 py-3 text-center font-bold text-slate-700">
                            {val}
                            {isCheapest && vals.filter(v => v !== '—').length > 1 && <span className="ml-1 text-[8px] text-emerald-600 font-black">✓ Best</span>}
                            {isBest && vals.filter(v => v !== 'No reviews yet').length > 1 && <span className="ml-1 text-[8px] text-amber-600 font-black">★ Top</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Add to cart from compare */}
              {enableGalleryCart && (
                <div className="flex gap-3 mt-6 pt-4 border-t border-stone-100">
                  <div className="w-32 shrink-0"></div>
                  {compareProds.map(p => (
                    <div key={p.id} className="flex-1 px-4">
                      <button onClick={() => { setConfiguring({ product: p, sqft: p.sqftPerBox || 10, purpose: '', selectedSlabIds: [] }); setConfigDone(false); setShowCompare(false); }}
                        className={`w-full py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all
                          ${cart.some(c => c.productId === p.id) ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-amber-600'}`}>
                        {cart.some(c => c.productId === p.id) ? '✓ In Cart' : 'Add to Cart'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          CART DRAWER
      ═══════════════════════════════════════════════════ */}
      {showCart && (
        <div className="fixed inset-0 z-[300] flex justify-end gal-body">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setShowCart(false)} />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">

            <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
              <div>
                <h2 className="gal-display font-bold text-xl italic">Your Selection</h2>
                <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mt-0.5">{cart.length} item{cart.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setShowCart(false)} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-times"></i></button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 opacity-40">
                  <i className="fas fa-shopping-bag text-5xl text-stone-300"></i>
                  <p className="font-black uppercase tracking-widest text-xs text-stone-400">Your cart is empty</p>
                </div>
              ) : (
                <div className="p-5 space-y-3">
                  {cart.map(item => {
                    const p = prods.find(x => x.id === item.productId);
                    const isSlab = isSlabCat(p?.category);
                    const tpb = p?.tilesPerBox || 1;
                    const lineTotal = isSlab && item.slabDetails?.length
                      ? item.slabDetails.reduce((t: number, s: any) => t + (s.sellingPrice || s.sqft * item.unitPrice), 0)
                      : isSlab ? item.sqft * item.unitPrice
                      : item.boxes * item.unitPrice + (item.loose / tpb) * item.unitPrice;

                    return (
                      <div key={item.productId} className="bg-stone-50 rounded-2xl p-4 space-y-3 border border-stone-100">
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex gap-3 flex-1 min-w-0">
                            <img src={p?.images?.[0]} className="w-12 h-12 rounded-xl object-cover shrink-0 bg-stone-200" referrerPolicy="no-referrer" />
                            <div className="min-w-0">
                              <div className="font-black text-slate-900 text-sm truncate">{item.productName}</div>
                              <div className="text-[9px] text-stone-400 font-bold">{item.purpose || 'No purpose specified'}</div>
                            </div>
                          </div>
                          <button onClick={() => removeFromCart(item.productId)} className="text-stone-300 hover:text-rose-500 transition-colors shrink-0">
                            <i className="fas fa-trash-alt text-xs"></i>
                          </button>
                        </div>

                        {/* Slab details */}
                        {isSlab && item.slabDetails && item.slabDetails.length > 0 && (
                          <div className="space-y-1">
                            {item.slabDetails.map((s: any, i: number) => (
                              <div key={i} className="flex justify-between text-[10px] bg-amber-50 rounded-lg px-2.5 py-1.5">
                                <span className="font-bold text-slate-700">#{s.slabNo} {s.finish ? `· ${s.finish}` : ''} · {s.sqft}sqft</span>
                                <span className="font-black text-emerald-700">{s.sellingPrice ? INR(s.sellingPrice) : '—'}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex justify-between items-center pt-2 border-t border-stone-200">
                          <div className="text-[9px] font-bold text-stone-400">
                            {isSlab
                              ? `${item.sqft.toFixed(1)} SqFt`
                              : `${item.boxes}${item.loose > 0 ? ` + ${item.loose}pcs` : ''} boxes`}
                          </div>
                          <div className="font-black text-slate-900">{INR(Math.round(lineTotal))}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="border-t border-stone-100 p-5 space-y-5 shrink-0">
                {/* Totals */}
                <div className="space-y-2">
                  {cartSavings > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-emerald-600 font-black">Savings</span>
                      <span className="font-black text-emerald-600">- {INR(Math.round(cartSavings))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base border-t border-stone-100 pt-2">
                    <span className="font-black text-slate-900">Total Estimate</span>
                    <span className="font-black text-xl text-slate-900">{INR(Math.round(cartTotal - cartSavings))}</span>
                  </div>
                </div>

                {/* Order form */}
                {orderSuccess ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center space-y-2 fade-up">
                    <div className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center mx-auto">
                      <i className="fas fa-check text-white text-lg"></i>
                    </div>
                    <div className="font-black text-emerald-800">Order Submitted!</div>
                    <div className="text-sm text-emerald-600 font-medium">We'll contact you shortly to confirm.</div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="text-[9px] font-black text-stone-400 uppercase tracking-widest">Your Details</div>
                    {[
                      { key: 'name',    placeholder: 'Full Name',     type: 'text',  required: true },
                      { key: 'mobile',  placeholder: 'Mobile Number', type: 'tel',   required: true },
                      { key: 'place',   placeholder: 'City / Place',  type: 'text',  required: true },
                    ].map(({ key, placeholder, type, required }) => (
                      <input key={key} type={type} required={required} placeholder={placeholder}
                        className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400 focus:bg-white transition-all"
                        value={(checkoutForm as any)[key]}
                        onChange={e => setCheckoutForm(f => ({ ...f, [key]: e.target.value }))} />
                    ))}
                    <textarea placeholder="Project notes or requirements…" required
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400 focus:bg-white h-16 resize-none transition-all"
                      value={checkoutForm.remarks} onChange={e => setCheckoutForm(f => ({ ...f, remarks: e.target.value }))} />

                    {/* OTP */}
                    {settings.dashboardVisibility.enableGalleryOtp && (
                      <div className="space-y-2 pt-1">
                        {!otpVerified ? (
                          <>
                            {!otpSent ? (
                              <button type="button" onClick={sendOtp}
                                className="w-full py-2.5 bg-stone-100 text-stone-700 rounded-xl font-black text-[9px] uppercase hover:bg-stone-200 transition-all">
                                <i className="fas fa-mobile-alt mr-1.5"></i> Send OTP to verify mobile
                              </button>
                            ) : (
                              <div className="flex gap-2">
                                <input type="text" maxLength={4} placeholder="OTP"
                                  className="flex-1 px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl font-black text-sm outline-none focus:border-amber-400"
                                  value={otpInput} onChange={e => setOtpInput(e.target.value)} />
                                <button type="button" onClick={verifyOtp}
                                  className="px-4 py-2.5 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-700">Verify</button>
                              </div>
                            )}
                            {otpError && <p className="text-[9px] font-bold text-rose-500">{otpError}</p>}
                          </>
                        ) : (
                          <div className="text-[9px] font-black text-emerald-600 flex items-center gap-1.5">
                            <i className="fas fa-check-circle"></i> Mobile verified
                          </div>
                        )}
                      </div>
                    )}

                    <button type="submit" disabled={isSubmitting}
                      className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95 disabled:opacity-50">
                      {isSubmitting ? <><i className="fas fa-spinner fa-spin mr-2"></i>Submitting…</> : 'Submit Interest →'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating compare bar (mobile) */}
      {compareList.length > 0 && !showCompare && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-4">
          <button onClick={() => setShowCompare(true)}
            className="flex items-center gap-3 px-6 py-3.5 bg-indigo-600 text-white rounded-full shadow-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 active:scale-95 transition-all">
            <i className="fas fa-balance-scale"></i>
            Compare {compareList.length} items
            <span className="ml-1 opacity-60 text-[8px]">· tap to view</span>
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-slate-900 text-white mt-16 px-6 py-10 gal-body">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start gap-6">
          <div>
            <div className="gal-display font-bold text-xl italic text-amber-400">{showroomName}</div>
            <div className="text-stone-400 text-sm font-medium mt-1">{settings.showroomCity}</div>
          </div>
          <div className="flex gap-6 text-sm text-stone-400 font-bold">
            <a href={`https://wa.me/${(showroomPhone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="hover:text-emerald-400 transition-colors flex items-center gap-2">
              <i className="fab fa-whatsapp"></i> WhatsApp
            </a>
            <button onClick={onAdminAccess} className="hover:text-amber-400 transition-colors">Admin Login</button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-white/10 text-[10px] text-stone-500 font-bold">
          © {new Date().getFullYear()} {showroomName} · All rights reserved
        </div>
      </footer>
    </div>
  );
};

export default WebGallery;
