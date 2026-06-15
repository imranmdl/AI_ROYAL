
import React, { useState, useMemo, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useCamera } from '../hooks/useCamera';
import { store } from '../store';
import StockLedger from './StockLedger';
import { Product, Purchase, PurchaseItem, Category, UnitType, UserRole, TransportCostType, TransportBasis, TileGrade, VendorOrder, VendorOrderItem, Slab } from '../types';
import QRCode from 'qrcode';
import KadapaManager from './KadapaManager';
import KadapaInventoryGenerator from './KadapaInventoryGenerator';
import GraniteManager from './GraniteManager';
import UnitConfig from './UnitConfig';
import DependentItemsManager from './DependentItemsManager';
import InventoryImportExport from './InventoryImportExport';
import QuickAddInward from './QuickAddInward';

interface InventoryProps {
  currentRole: UserRole;
  setActiveTab?: (tab: string) => void;
}

// ── Collapsed action menu ─────────────────────────────────────────────────────
const ActionMenu: React.FC<{
  product: any; currentRole: string; allowPhotos: boolean;
  onPhoto:()=>void; onLedger:()=>void; onAddStock:()=>void; onHistory:()=>void;
  onAdjust:()=>void; onQR:()=>void; onGallery:()=>void;
  onStatus:()=>void; onEdit:()=>void;
  showInGallery:boolean; status:string;
}> = ({ currentRole, allowPhotos, onPhoto, onLedger, onAddStock, onHistory, onAdjust, onQR, onGallery, onStatus, onEdit, showInGallery, status }) => {
  const [open, setOpen] = React.useState(false);
  const [pos,  setPos]  = React.useState({ top: 0, right: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen(v => !v);
  };

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const isAdmin = currentRole === UserRole.ADMIN;
  const actions = [
    ...(allowPhotos ? [{ label:'📷 Upload Photo', fn: onPhoto, color: 'text-pink-700 hover:bg-pink-50' }] : []),
    { label:'📊 Stock Ledger',  fn: onLedger,   color: 'text-indigo-700 hover:bg-indigo-50' },
    { label:'➕ Add Inward',    fn: onAddStock, color: 'text-emerald-700 hover:bg-emerald-50' },
    { label:'🕑 History',       fn: onHistory,  color: 'text-blue-700 hover:bg-blue-50' },
    { label:'📦 Adjust Stock',  fn: onAdjust,   color: 'text-amber-700 hover:bg-amber-50' },
    { label:'📷 QR Code',       fn: onQR,       color: 'text-slate-700 hover:bg-slate-50' },
    ...(isAdmin ? [
      { label: showInGallery ? '👁 Hide Gallery' : '👁 Show Gallery', fn: onGallery, color: 'text-purple-700 hover:bg-purple-50' },
      { label: status === 'Suspended' ? '▶ Activate' : '⏸ Suspend',  fn: onStatus,  color: status === 'Suspended' ? 'text-emerald-700 hover:bg-emerald-50' : 'text-rose-600 hover:bg-rose-50' },
      { label:'✏️ Edit Product', fn: onEdit, color: 'text-slate-700 hover:bg-slate-50' },
    ] : []),
  ];

  return (
    <>
      <button ref={btnRef} onClick={toggle}
        className={`w-9 h-9 rounded-xl border-2 transition-all flex items-center justify-center font-black text-lg leading-none ${open ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white border-slate-200 text-slate-500 hover:border-amber-400 hover:text-slate-900'}`}
        title="Actions">
        ···
      </button>

      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          style={{ position:'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-2xl shadow-2xl py-1.5 min-w-[180px]"
          onMouseDown={e => e.stopPropagation()}>
          {actions.map((a, i) => (
            <button key={a.label} onClick={() => { a.fn(); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-xs font-bold transition-colors ${a.color} ${i > 0 && actions[i-1].color !== a.color ? 'border-t border-slate-100' : ''}`}>
              {a.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

const Inventory: React.FC<InventoryProps> = ({ currentRole, setActiveTab }) => {
  const [products, setProducts] = useState<Product[]>(store.products);
  const [predefinedSizes, setPredefinedSizes] = useState<string[]>(store.settings.predefinedSizes || []);
  const [categories, setCategories] = useState<string[]>(store.settings.categories || []);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddStock, setShowAddStock] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [ledgerProduct, setLedgerProduct]         = useState<Product | null>(null);
  const [photoProduct,  setPhotoProduct]          = useState<Product | null>(null);
  const { takePhoto, loading: camLoading }         = useCamera();

  // Admin setting: allow staff to upload product photos
  const allowProductPhotos = store.settings.allowProductPhotos !== false; // default true
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [showGallery, setShowGallery] = useState<Product | null>(null);
  const [showQR, setShowQR] = useState<Product | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [showLocations, setShowLocations] = useState<Product | null>(null);
  const [errorMessage, setErrorMessage] = useState<React.ReactNode | null>(null);

  // Pagination & Filters
  const [filters, setFilters] = useState({
    category: 'All',
    brand: 'All',
    size: 'All',
    stockStatus: 'All',
    grade: 'All',
    status: 'Active'
  });

  const [filterOptions, setFilterOptions] = useState<{
    brands: string[],
    categories: string[],
    sizes: string[],
    grades: string[]
  }>({
    brands: [],
    categories: [],
    sizes: [],
    grades: []
  });

  // Fetch filter options from server
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const jwtF = typeof localStorage !== 'undefined' ? localStorage.getItem('royal_jwt') || '' : '';
        const hF: Record<string,string> = {}; if (jwtF) hF['Authorization'] = `Bearer ${jwtF}`;
        const res = await fetch('/api/products/filters', { headers: hF });
        if (res.ok) {
          const data = await res.ok ? await res.json() : null;
          if (data) setFilterOptions(data);
        }
      } catch (e) {
        console.error('Error fetching filter options:', e);
      }
    };
    fetchFilters();
  }, []);

  // Derived Lists for Filter Dropdowns (use filterOptions from server)
  const uniqueBrands = filterOptions.brands;
  const uniqueCategories = filterOptions.categories;
  const uniqueSizes = filterOptions.sizes;
  const uniqueGrades = filterOptions.grades;

  // Server-side Pagination & Filters
  const [serverProducts, setServerProducts] = useState<Product[]>([]);
  const [totalServerProducts, setTotalServerProducts] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [serverPage, setServerPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const currentRequestId = useRef(0);
  // FIX: stable refs so fetchProducts always reads latest values
  const filtersRef = useRef(filters);
  const searchRef = useRef(debouncedSearchTerm);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { searchRef.current = debouncedSearchTerm; }, [debouncedSearchTerm]);

  const fetchProducts = async (page: number, currentSearch: string, currentFilters: any, isLoadMore: boolean = false) => {
    // Only block load-more when already loading — always allow fresh page-1 fetches
    if (isLoading && isLoadMore) return;

    const reqId = ++currentRequestId.current;
    setIsLoading(true);
    try {
      const result = await store.fetchProductsPage(page, itemsPerPage, currentSearch, currentFilters);
      // FIX: only discard if a NEWER request has already started
      if (reqId !== currentRequestId.current) return;

      if (isLoadMore) {
        setServerProducts(prev => [...prev, ...result.data]);
      } else {
        setServerProducts(result.data);
      }
      setTotalServerProducts(result.total);
      setHasMore(result.data.length === itemsPerPage);
    } catch (e) {
      console.error('[Inventory] fetchProducts error:', e);
    } finally {
      if (reqId === currentRequestId.current) {
        setIsLoading(false);
      }
    }
  };

  // Re-fetch on search / filter / page-size change
  useEffect(() => {
    fetchProducts(1, debouncedSearchTerm, filters, false);
    setServerPage(1);
  }, [debouncedSearchTerm, filters, itemsPerPage]);

  // FIX: Re-fetch when store.products changes (catches add, edit, delete, vendor inward)
  // Uses a 600ms delay so the async DB write has time to commit before we query
  useEffect(() => {
    const unsub = store.subscribe(() => {
      setTimeout(() => {
        fetchProducts(1, searchRef.current, filtersRef.current, false);
        setServerPage(1);
      }, 600);
    }, (s) => s.products);  // selector: only fires when products slice changes
    return unsub;
  }, []);

  const loadMore = () => {
    const nextPage = serverPage + 1;
    setServerPage(nextPage);
    fetchProducts(nextPage, debouncedSearchTerm, filters, true);
  };

  // FIX: expose a manual refresh helper used after add/edit/delete
  const refreshProducts = (delayMs = 600) => {
    setTimeout(() => {
      fetchProducts(1, searchRef.current, filtersRef.current, false);
      setServerPage(1);
    }, delayMs);
  };

  const displayProducts = serverProducts;

  // Skeleton Loader Component
  const SkeletonRow = () => (
    <tr className="animate-pulse border-b border-slate-100">
      <td className="p-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
      <td className="p-4"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
      <td className="p-4"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
      <td className="p-4"><div className="h-4 bg-slate-200 rounded w-12"></div></td>
      <td className="p-4"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
      <td className="p-4"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
      <td className="p-4"><div className="h-4 bg-slate-200 rounded w-12"></div></td>
    </tr>
  );

  // FIX: subscribe for settings changes only (predefined sizes, categories)
  // Product list refresh is handled by the products-selector subscription above
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setPredefinedSizes([...(store.settings.predefinedSizes || [])]);
      setCategories([...(store.settings.categories || [])]);
    });
    return unsubscribe;
  }, []);

  const initialFormState: Partial<Product & { bulkCount: number; bulkNames: string[]; graniteName: string }> = {
    name: '', category: store.settings.categories[0] || 'Floor Tile', brand: '', isTile: true, unitType: 'Box',
    size: '', tilesPerBox: 4, sqftPerBox: 0, purchasePrice: 0, 
    slabHeightFt: 0, slabHeightIn: 0, slabLengthFt: 0, slabLengthIn: 0, costPerSqft: 0, sellingPricePerSqft: 0,
    transportCost: 0, transportCostType: 'Percentage', transportBasis: 'Per Unit', 
    otherCharges: 0, sellingPrice: 0, reorderLevel: 10, images: [], status: 'Active',
    showInGallery: true,
    grade: 'Premium', shadeNo: '', batchNo: '',
    lastPurchaseVendor: '', lastPurchaseDate: '', lastPurchaseVehicle: '',
    bulkCount: 1, bulkNames: [''],
    slabs: [],
    kadapaType: 'Single Polish',
    graniteName: ''
  };

  const [productForm, setProductForm] = useState<Partial<Product & { bulkCount: number; bulkNames: string[]; graniteName: string }>>(initialFormState);
  const [slabForm, setSlabForm] = useState({
    slabNo: '',
    heightFt: 0,
    heightIn: 0,
    lengthFt: 0,
    lengthIn: 0,
    sqft: 0,
    count: 1
  });

  const addSlab = () => {
    if (!slabForm.slabNo) return;
    
    const hFt = slabForm.heightFt || 0;
    const hIn = slabForm.heightIn || 0;
    const lFt = slabForm.lengthFt || 0;
    const lIn = slabForm.lengthIn || 0;
    const totalHeight = hFt + (hIn / 12);
    const totalLength = lFt + (lIn / 12);
    const sqft = parseFloat((totalHeight * totalLength).toFixed(2));

    const newSlabs: Slab[] = [];
    const baseSlabNo = slabForm.slabNo;
    const count = slabForm.count || 1;

    for (let i = 0; i < count; i++) {
        let currentSlabNo = baseSlabNo;
        if (i > 0) {
            const match = baseSlabNo.match(/^(.*?)(\d+)$/);
            if (match) {
                const prefix = match[1];
                const num = parseInt(match[2]);
                currentSlabNo = `${prefix}${num + i}`;
            } else {
                currentSlabNo = `${baseSlabNo}-${i + 1}`;
            }
        }

        // Check for duplicate slab number
        const isDuplicate = [...(productForm.slabs || []), ...newSlabs].some(s => s.slabNo.toLowerCase() === currentSlabNo.toLowerCase());
        if (isDuplicate) {
            alert(`Slab number ${currentSlabNo} already exists! Skipping...`);
            continue;
        }

        // Compute landed cost from product kadapaType setting
        const kadapaRate = (() => {
          const kadapaTypes = store.settings.kadapaItemTypes || [
            { name: 'Single Polish', ratePerSqft: 28 }, { name: 'Double Polish', ratePerSqft: 35 },
            { name: 'Big Single Polish', ratePerSqft: 45 }, { name: 'Big Double Polish', ratePerSqft: 55 },
          ];
          const ft = kadapaTypes.find((t: any) => t.name === productForm.kadapaType);
          return ft?.ratePerSqft || 0;
        })();
        const inwardLanded  = sqft > 0 && kadapaRate > 0 ? Math.round(sqft * kadapaRate * 100) / 100 : 0;
        const inwardSelling = sqft > 0 && (productForm.sellingPricePerSqft || 0) > 0
          ? Math.round(sqft * (productForm.sellingPricePerSqft || 0) * 100) / 100 : 0;

        // Canonical slab number prefix: SP-KDP-3ft-14in or similar
        const FINISH_P: Record<string, { lt5: string; gte5: string }> = {
          'Single Polish': { lt5:'SP-KDP', gte5:'DSP-KDP' }, 'Double Polish': { lt5:'DP-KDP', gte5:'DDP-KDP' },
          'Big Single Polish': { lt5:'DSP-KDP', gte5:'DSP-KDP' }, 'Big Double Polish': { lt5:'DDP-KDP', gte5:'DDP-KDP' },
        };
        const fp = FINISH_P[productForm.kadapaType || ''] || { lt5:'KD-KDP', gte5:'KD-KDP' };
        const pfx = totalHeight >= 5 ? fp.gte5 : fp.lt5;
        const wIn = lFt > 0 ? Math.round(lFt * 12) : 0;
        const canonicalBase = currentSlabNo.startsWith(pfx)
          ? currentSlabNo
          : `${pfx}-${totalHeight}ft-${wIn}in-${i+1}`;
        const finalSlabNo = currentSlabNo || canonicalBase;

        newSlabs.push({
            id: `slab-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
            slabNo: finalSlabNo,
            heightFt: hFt,
            heightIn: hIn,
            lengthFt: lFt,
            lengthIn: lIn,
            sqft: sqft,
            isSold: false,
            finish:              productForm.kadapaType || 'Single Polish',
            landedCost:          inwardLanded,
            landedCostPerSqft:   kadapaRate,
            sellingPrice:        inwardSelling,
            sellingPricePerSqft: productForm.sellingPricePerSqft || 0,
        } as any);
    }

    setProductForm(prev => ({
        ...prev,
        slabs: [...(prev.slabs || []), ...newSlabs]
    }));

    setSlabForm({
        slabNo: '',
        heightFt: slabForm.heightFt,
        heightIn: slabForm.heightIn,
        lengthFt: slabForm.lengthFt,
        lengthIn: slabForm.lengthIn,
        sqft: 0,
        count: 1
    });
  };

  const removeSlab = (id: string) => {
    setProductForm(prev => ({
        ...prev,
        slabs: prev.slabs?.filter(s => s.id !== id)
    }));
  };

  // Auto-generate Kadapa name — format: SP_KDP_2x1 / DSP_KDP_5x2 / DP_KDP_4x2.5 / DDP_KDP_6x2.5
  useEffect(() => {
    if (productForm.category === 'Kadapa' && productForm.kadapaType && productForm.size) {
      const type = productForm.kadapaType;
      const size = productForm.size; // e.g. "2x1" or "5x2"

      // Determine if height >= 5 (big size)
      const parts = size.split(/[x×*,]/);
      const h = parseFloat(parts[0]?.trim() || '0');
      const isBig = h >= 5;

      // Map finish → prefix
      const prefixMap: Record<string, { normal: string; big: string }> = {
        'Single Polish':     { normal: 'SP',  big: 'DSP' },
        'Double Polish':     { normal: 'DP',  big: 'DDP' },
        'Big Single Polish': { normal: 'DSP', big: 'DSP' },
        'Big Double Polish': { normal: 'DDP', big: 'DDP' },
      };
      const px = (prefixMap[type] || { normal: 'SP', big: 'DSP' })[isBig ? 'big' : 'normal'];

      const generatedName = `${px}_KDP_${size}`;

      if (productForm.name !== generatedName) {
        setProductForm(prev => ({ ...prev, name: generatedName }));
      }
    }
  }, [productForm.category, productForm.kadapaType, productForm.size]);

  // Auto-generate Granite name
  useEffect(() => {
    if (productForm.category === 'Granite' && productForm.graniteName && productForm.size) {
      const generatedName = `${productForm.graniteName}_${productForm.size}`;
      if (productForm.name !== generatedName) {
        setProductForm(prev => ({ ...prev, name: generatedName }));
      }
    }
  }, [productForm.category, productForm.graniteName, productForm.size]);

  // Inward (Purchase) Logic
  const [newPurchase, setNewPurchase] = useState({
    vendorName: '', 
    vehicleNumber: '', 
    gstInvoiceNo: '', 
    date: new Date().toISOString().split('T')[0], 
    godownId: 'g1', 
    syncToSupplyChain: false,
    items: [] as { productId: string; qtyBoxes: number; rate: number }[]
  });

  const grades: TileGrade[] = ['Premium', 'Standard', 'Commercial', 'Budget'];

  const calculatedLandedCost = useMemo(() => {
    const isGranite = productForm.category === 'Granite' || productForm.category === 'Marble';
    const isKadapa  = productForm.category === 'Kadapa';

    if (isGranite) {
      // For Granite: purchasePrice IS the landed cost per sqft (set by GraniteManager)
      // The "Landed Intelligence" panel shows per-sqft; per-slab varies by slab size
      return productForm.purchasePrice || 0;
    }

    const base = productForm.purchasePrice || 0;
    const transVal = productForm.transportCost || 0;
    const other = productForm.otherCharges || 0;
    const sqft = productForm.sqftPerBox || 1;
    let transportAmount = 0;
    if (productForm.transportCostType === 'Percentage') transportAmount = (base * transVal) / 100;
    else transportAmount = productForm.transportBasis === 'Per Sft' ? transVal * sqft : transVal;

    return base + transportAmount + other;
  }, [productForm]);

  useEffect(() => {
    if (showQR) {
      const url = `${window.location.origin}${window.location.pathname}?viewProduct=${showQR.id}&mode=public`;
      QRCode.toDataURL(url, { width: 300, margin: 2 }, (err: any, url: string) => {
        if (!err) setQrCodeUrl(url);
      });
    } else setQrCodeUrl('');
  }, [showQR]);

  // Remove the problematic useEffect that was overwriting manual rates
  // and move calculation logic to specific field handlers instead.
  // This ensures manual overrides are preserved while still offering auto-calculation.

  const handleUpsertProduct = () => {
    const namesToCreate = productForm.bulkCount && productForm.bulkCount > 1 
      ? (productForm.bulkNames || []).filter(n => n.trim() !== '')
      : [productForm.name];

    if (namesToCreate.length === 0) return;

    // Duplicate check
    for (const name of namesToCreate) {
      const duplicate = store.products.find(p => p.name === name && p.size === productForm.size && p.id !== editProduct?.id);
      if (duplicate) {
        setErrorMessage(
          <div className="flex flex-col gap-2">
            <span className="font-black text-rose-800">A product with name "{name}" and size "{productForm.size}" already exists.</span>
            <button 
              onClick={() => {
                setActiveTab?.('inward');
                setShowAddProduct(false);
              }}
              className="bg-rose-100 text-rose-900 px-4 py-2 rounded-xl font-black uppercase text-[10px] hover:bg-rose-200 transition-all flex items-center justify-center gap-2 border border-rose-200"
            >
              <i className="fas fa-arrow-right"></i> Go to Inward Stock instead
            </button>
          </div>
        );
        return;
      }
    }

    setErrorMessage(null);

    namesToCreate.forEach((name, idx) => {
      const finalProductData = { 
        ...productForm, 
        name, 
        totalCostPerUnit: calculatedLandedCost 
      } as Product;
      
      // Remove bulk specific fields before saving
      delete (finalProductData as any).bulkCount;
      delete (finalProductData as any).bulkNames;

      const isSlabProduct = (finalProductData.category === 'Kadapa' || finalProductData.category === 'Granite' || finalProductData.category === 'Marble');
      const availableSlabs = finalProductData.slabs?.filter(s => !s.isSold).length || 0;

      if (editProduct && idx === 0) {
        if (isSlabProduct) {
          finalProductData.stockBoxes = availableSlabs;
          // For simplicity in this manual sync, we update the first godown's stock if it exists
          if (finalProductData.locationStock && finalProductData.locationStock.length > 0) {
            const totalOtherGodowns = finalProductData.locationStock.slice(1).reduce((acc, l) => acc + l.boxes, 0);
            finalProductData.locationStock[0].boxes = Math.max(0, availableSlabs - totalOtherGodowns);
          }
        }
        store.updateProduct(editProduct.id, finalProductData);
        // FIX: optimistic update for edits so the row updates instantly
        setServerProducts(prev => prev.map(p => p.id === editProduct.id ? { ...p, ...finalProductData } : p));
      } else {
        const initialStock = isSlabProduct ? availableSlabs : 0;
        const newProduct = {
          ...finalProductData,
          id: `prod-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
          stockBoxes: initialStock, stockLoose: 0, damagedPieces: 0, status: 'Active',
          images: productForm.images?.length ? productForm.images : ['https://images.unsplash.com/photo-1517646331032-9e8563c520a1?auto=format&fit=crop&q=80&w=1000'],
          locationStock: store.godowns.map((g, gIdx) => ({ godownId: g.id, boxes: (idx === 0 && gIdx === 0) ? initialStock : 0, loose: 0 })),
          damageHistory: [], purchaseHistory: [], adjustmentLog: []
        } as Product;
        store.addProduct(newProduct);
        // FIX: show new product immediately in the list without waiting for server
        setServerProducts(prev => [newProduct, ...prev]);
        setTotalServerProducts(prev => prev + 1);
      }
    });

    setShowAddProduct(false);
    setEditProduct(null);
    setProductForm(initialFormState);
    // FIX: re-fetch from server after delay to confirm DB write landed
    refreshProducts(700);
  };

  const handleAddStockFromPurchase = () => {
    if (newPurchase.items.length === 0 || newPurchase.items.some(i => !i.productId)) { alert('Please select a product for each item'); return; }
    
    const isLinkedOrder = newPurchase.gstInvoiceNo.startsWith('ORDER_');
    
    if (isLinkedOrder) {
      const orderId = newPurchase.gstInvoiceNo.split('_')[1];
      // When receiving via Inventory inward for a linked order, we assume 0 damages for this specific quick inward
      // For detailed damage reporting, use the Vendor Tracking module
      // Mark the linked vendor order as received via the new supply chain module
      const linkedOrder = store.vendorOrders.find(o => o.id === orderId);
      if (linkedOrder) {
        const updatedOrder = {
          ...linkedOrder,
          status: 'Received' as any,
          receivedDate: newPurchase.date,
          items: linkedOrder.items.map((it: any) => ({
            ...it,
            receivedQty: it.receivedQty || it.actualQty || it.qtyBoxes || 0,
            damagedQty: 0,
            goodQty: it.actualQty || it.qtyBoxes || 0,
          })),
          updatedAt: Date.now(),
        };
        store.saveVendorOrder(updatedOrder);
      }
    } else if (newPurchase.vendorName.trim() && newPurchase.syncToSupplyChain) {
      // ── Quick Vendor Purchase: create a VendorOrder so it shows in Vendor Supply Chain,
      // and auto-inwards stock + purchase history via saveVendorOrder (single source of truth) ──
      const orderId = `inw-${Date.now()}`;
      let totalActual = 0;

      const orderItems: VendorOrderItem[] = newPurchase.items.map((it, i) => {
        const product = products.find(p => p.id === it.productId);
        const actualAmount = it.qtyBoxes * it.rate;
        totalActual += actualAmount;
        const sellingPrice = product?.sellingPrice || 0;
        const landed = it.rate;
        const margin = sellingPrice > 0 ? ((sellingPrice - landed) / sellingPrice) * 100 : 0;
        return {
          id: `item-${orderId}-${i}`,
          productId: it.productId,
          productName: product?.name || 'Unknown Product',
          category: product?.category || '',
          unit: product?.unitType || 'Box',
          orderedQty: it.qtyBoxes,
          billedQty: it.qtyBoxes, billedRate: it.rate, billedAmount: actualAmount,
          actualQty: it.qtyBoxes, actualRate: it.rate, actualAmount,
          receivedQty: it.qtyBoxes, damagedQty: 0, goodQty: it.qtyBoxes,
          transportShare: 0, laborShare: 0,
          landedCostPerUnit: landed,
          sellingPrice, marginPct: margin,
        };
      });

      const newOrder: VendorOrder = {
        id: orderId,
        orderNo: newPurchase.gstInvoiceNo || `INW-${Date.now().toString().slice(-6)}`,
        vendorName: newPurchase.vendorName.trim(),
        orderDate: newPurchase.date,
        receivedDate: newPurchase.date,
        status: 'Received' as any,
        paymentStatus: 'Pending' as any,
        items: orderItems,
        laborCharges: 0, miscCharges: 0,
        totalBilledAmount: totalActual,
        totalActualAmount: totalActual,
        totalTransportCost: 0,
        grandTotal: totalActual,
        cashAmount: 0, rtgsAmount: 0, paidAmount: 0, balanceAmount: totalActual,
        paymentHistory: [],
        damagedItems: [],
        receivedGodownId: newPurchase.godownId,
        remarks: 'Quick Inward from Inventory Ecosystem',
        isFullyReceived: true,
        updatedAt: Date.now(),
      };

      // saveVendorOrder auto-inwards stock + purchase history + appears in Vendor Supply Chain
      store.saveVendorOrder(newOrder);
    } else {
      // Manual inward — no vendor / not syncing to supply chain
      const purchase: Purchase = {
        id: `pur-${Date.now()}`,
        vendorName: newPurchase.vendorName || 'Manual Entry',
        vehicleNumber: newPurchase.vehicleNumber,
        gstInvoiceNo: newPurchase.gstInvoiceNo || 'MANUAL-INWARD',
        date: newPurchase.date,
        godownId: newPurchase.godownId,
        items: newPurchase.items.map(it => ({
          productId: it.productId,
          productName: store.products.find(p => p.id === it.productId)?.name || 'Unknown',
          qtyBoxes: it.qtyBoxes,
          rate: it.rate
        }))
      };

      store.addPurchase(purchase);
      // Note: addPurchase already updates stockBoxes via adjustStock — no need to update here
    }
    
    setShowAddStock(false);
    setNewPurchase({ 
      vendorName: '', 
      vehicleNumber: '', 
      gstInvoiceNo: '', 
      date: new Date().toISOString().split('T')[0], 
      godownId: 'g1', 
      syncToSupplyChain: false,
      items: []
    });
  };

  const [showAdjustStock, setShowAdjustStock] = useState<Product | null>(null);
  const [showItemHistory, setShowItemHistory] = useState<Product | null>(null);
  const [adjustForm, setAdjustForm] = useState({
    actionType: 'Correction' as 'Damage' | 'Correction',
    godownId: 'g1',
    qtyBoxes: 0,
    qtyLoose: 0,
    notes: '',
    vendorOrderId: ''
  });

  const handleAdjustStock = () => {
    if (!showAdjustStock) return;
    const { actionType, godownId, qtyBoxes, qtyLoose, notes, vendorOrderId } = adjustForm;
    if (qtyBoxes === 0 && qtyLoose === 0) return;

    if (actionType === 'Damage') {
      // reportDamage calls adjustStock(-qty) which updates store.products internally
      store.reportDamage(showAdjustStock.id, qtyBoxes, qtyLoose, godownId, vendorOrderId || undefined);
      // Read updated value directly from store (not serverProducts which may be stale)
      const updated = store.products.find(p => p.id === showAdjustStock.id);
      if (updated) {
        setServerProducts(prev => prev.map(p =>
          p.id === showAdjustStock.id ? { ...p, stockBoxes: updated.stockBoxes, stockLoose: updated.stockLoose } : p
        ));
      }
    } else {
      // adjustStock(+/-qty) updates store.products internally
      store.adjustStock(showAdjustStock.id, godownId, qtyBoxes, qtyLoose, actionType, notes);
      const updated = store.products.find(p => p.id === showAdjustStock.id);
      if (updated) {
        setServerProducts(prev => prev.map(p =>
          p.id === showAdjustStock.id ? { ...p, stockBoxes: updated.stockBoxes, stockLoose: updated.stockLoose } : p
        ));
      }
    }

    refreshProducts(800);
    setShowAdjustStock(null);
    setAdjustForm({ actionType: 'Correction', godownId: 'g1', qtyBoxes: 0, qtyLoose: 0, notes: '', vendorOrderId: '' });
  };


  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tighter uppercase leading-none italic">Inventory Ecosystem</h1>
          <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest mt-2 italic">Industry Traceability • Shade & Batch Management</p>
        </div>
        <div className="flex flex-wrap gap-3 w-full lg:w-auto">
            <button onClick={() => setShowQuickAdd(true)}
              className="flex-1 lg:flex-none bg-emerald-600 text-white px-8 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-emerald-700 shadow-xl flex items-center justify-center gap-2">
              <i className="fas fa-bolt text-xs"></i>
              Add &amp; Inward Item
            </button>
            <button onClick={() => { 
              setEditProduct(null); 
              setProductForm(initialFormState); 
              setErrorMessage(null);
              setShowAddProduct(true); 
            }} className="flex-1 lg:flex-none bg-white text-slate-800 border-2 border-slate-100 px-6 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-50">Create Master</button>
            <button onClick={() => setShowAddStock(true)} className="flex-1 lg:flex-none bg-amber-600 text-white px-8 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-amber-700 shadow-xl">Inward Stock (Advanced)</button>
            <button onClick={() => setShowImportExport(v => !v)}
              className={`flex-1 lg:flex-none px-6 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest transition-all flex items-center gap-2 ${showImportExport ? 'bg-blue-600 text-white shadow-xl' : 'bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100'}`}>
              <i className="fas fa-file-import text-xs"></i>
              Import / Export
            </button>
        </div>
      </header>

      {/* ── Import/Export Panel ── */}
      {showImportExport && (
        <div className="bg-white border border-slate-100 rounded-[32px] p-6 shadow-sm">
          <InventoryImportExport />
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4">
          <i className="fas fa-search text-slate-300 ml-2"></i>
          <input 
            type="text" 
            placeholder="Search by Name, Brand, Category, Size, Shade..." 
            className="flex-1 py-2 font-bold outline-none text-slate-600 bg-transparent" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
        </div>
        
        <div className="flex gap-2 overflow-x-auto pb-2 lg:pb-0">
          <select 
            className="px-4 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-xs outline-none min-w-[140px]"
            value={filters.category}
            onChange={e => setFilters({...filters, category: e.target.value})}
          >
            <option value="All">All Categories</option>
            {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select 
            className="px-4 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-xs outline-none min-w-[140px]"
            value={filters.size}
            onChange={e => setFilters({...filters, size: e.target.value})}
          >
            <option value="All">All Sizes</option>
            {uniqueSizes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select 
            className="px-4 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-xs outline-none min-w-[140px]"
            value={filters.brand}
            onChange={e => setFilters({...filters, brand: e.target.value})}
          >
            <option value="All">All Brands</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <select 
            className="px-4 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-xs outline-none min-w-[140px]"
            value={filters.grade}
            onChange={e => setFilters({...filters, grade: e.target.value})}
          >
            <option value="All">All Grades</option>
            {uniqueGrades.map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          <select 
            className="px-4 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-xs outline-none min-w-[140px]"
            value={filters.stockStatus}
            onChange={e => setFilters({...filters, stockStatus: e.target.value})}
          >
            <option value="All">All Stock Levels</option>
            <option value="In">In Stock</option>
            <option value="Low">Low Stock</option>
            <option value="Out">Out of Stock</option>
          </select>

          <select 
            className="px-4 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-xs outline-none min-w-[100px]"
            value={itemsPerPage}
            onChange={e => setItemsPerPage(Number(e.target.value))}
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>

          <select 
            className="px-4 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-xs outline-none min-w-[140px]"
            value={filters.status}
            onChange={e => setFilters({...filters, status: e.target.value})}
          >
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1000px]">
            <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[10px] tracking-widest">
              <tr>
                <th className="px-8 py-5">Product Definition</th>
                <th className="px-8 py-5 text-center">Grade/Shade</th>
                <th className="px-8 py-5 text-right">Physical Volume</th>
                <th className="px-8 py-5 text-right">Showroom Rate</th>
                <th className="px-8 py-5 text-center">Status</th>
                <th className="px-8 py-5 text-center sticky right-0 bg-slate-50 z-10 shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.05)]">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                  {isLoading && serverPage === 1 ? (
                    Array(5).fill(0).map((_, i) => <SkeletonRow key={i} />)
                  ) : displayProducts.length === 0 ? (
                    <tr><td colSpan={6} className="p-20 text-center text-slate-200 font-black italic uppercase tracking-tighter text-2xl">No material found matching criteria.</td></tr>
                  ) : displayProducts.map((p, pIdx) => {
                    const isLow = p.stockBoxes <= p.reorderLevel;
                    return (
                      <tr key={p.id || `prod-${pIdx}`} className="hover:bg-slate-50/50 group transition-all">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <img src={p.images?.[0] || 'https://images.unsplash.com/photo-1517646331032-9e8563c520a1?auto=format&fit=crop&q=80&w=1000'} onClick={() => setShowGallery(p)} className="w-16 h-16 rounded-2xl object-cover cursor-pointer hover:scale-110 transition-transform shadow-sm" alt="" referrerPolicy="no-referrer" />
                        <div>
                          <div className="font-black text-slate-900 leading-none text-sm uppercase">{p.name}</div>
                          <div className="text-[9px] text-amber-600 font-black uppercase mt-1 tracking-wider">{p.category} • {p.size}</div>
                          <div className="text-[8px] text-slate-400 font-bold uppercase mt-0.5">{p.brand}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-center">
                        <span className="text-[10px] font-black uppercase text-slate-700 bg-slate-100 px-3 py-1 rounded-lg">{p.grade || 'Premium'}</span>
                        <div className="text-[8px] font-bold text-slate-400 mt-1 uppercase">SH: {p.shadeNo || '---'}</div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="font-black text-lg tracking-tighter text-slate-900">
                        {p.stockBoxes} {p.unitType === 'Box' ? 'B' : p.unitType === 'Bag' ? 'Bag' : p.unitType}
                        {p.stockLoose > 0 && ` + ${p.stockLoose} Pcs`}
                      </div>
                      <button onClick={() => setShowLocations(p)} className="text-[8px] font-black text-blue-500 hover:underline uppercase">Warehouse Breakdown</button>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="text-slate-900 font-black italic tracking-tighter text-lg">₹{p.sellingPrice.toLocaleString()}</div>
                      <div className="text-[8px] font-black text-slate-400 uppercase">Per {p.unitType}</div>
                      {p.sqftPerBox > 0 && (
                        <div className="text-[7px] font-bold text-amber-600 uppercase mt-0.5">₹{(p.sellingPrice / p.sqftPerBox).toFixed(2)} / SqFt</div>
                      )}
                    </td>
                    <td className="px-8 py-6 text-center">
                       {p.status === 'Suspended' ? (
                          <span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[8px] font-black uppercase border border-slate-200">Suspended</span>
                       ) : isLow ? (
                          <span className="bg-rose-50 text-rose-600 px-3 py-1 rounded-full text-[8px] font-black uppercase border border-rose-100 animate-pulse">Low Stock</span>
                       ) : (
                          <span className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-[8px] font-black uppercase border border-emerald-100">Healthy</span>
                       )}
                    </td>
                    <td className="px-4 py-6 sticky right-0 bg-white z-10 shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.05)] group-hover:bg-slate-50 transition-colors">
                      {/* Collapsed action menu — click ⋯ to reveal */}
                      <ActionMenu
                        product={p}
                        currentRole={currentRole}
                        allowPhotos={allowProductPhotos}
                        onPhoto={() => setPhotoProduct(p)}
                        onLedger={() => setLedgerProduct(p)}
                        onAddStock={() => {
                          if (!newPurchase.items) return;
                          const existingItemIdx = newPurchase.items.findIndex(it => it.productId === p.id);
                          let nextItems = [...newPurchase.items];
                          if (existingItemIdx === -1) nextItems.push({ productId: p.id, qtyBoxes: 1, rate: p.purchasePrice || 0 });
                          setNewPurchase({ ...newPurchase, vendorName: p.lastPurchaseVendor || newPurchase.vendorName || '', vehicleNumber: p.lastPurchaseVehicle || newPurchase.vehicleNumber || '', items: nextItems });
                          setShowAddStock(true);
                        }}
                        onHistory={() => setShowItemHistory(p)}
                        onAdjust={() => setShowAdjustStock(p)}
                        onQR={() => setShowQR(p)}
                        onGallery={() => { store.updateProduct(p.id, { showInGallery: !p.showInGallery }); setServerProducts(prev => prev.map(prod => prod.id === p.id ? { ...prod, showInGallery: !prod.showInGallery } : prod)); }}
                        onStatus={() => { store.toggleProductStatus(p.id); setServerProducts(prev => prev.map(prod => prod.id === p.id ? { ...prod, status: prod.status === 'Active' ? 'Suspended' : 'Active' } : prod)); }}
                        onEdit={() => { setEditProduct(p); const graniteName = p.graniteName || (p.category === 'Granite' && p.name.includes('_') ? p.name.split('_')[0] : ''); setProductForm({ ...p, graniteName }); setErrorMessage(null); setShowAddProduct(true); }}
                        showInGallery={p.showInGallery}
                        status={p.status}
                      />
                    </td>
                  </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <div className="p-8 border-t border-slate-100 flex justify-center">
            <button 
              onClick={loadMore}
              disabled={isLoading}
              className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 transition-all disabled:opacity-50"
            >
              {isLoading ? 'Loading More Material...' : 'Load More Material'}
            </button>
          </div>
        )}
        
        {/* Record Count */}
        {displayProducts.length > 0 && (
          <div className="p-6 border-t border-slate-100 flex flex-col lg:flex-row justify-between items-center gap-4">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Showing {serverProducts.length} of {totalServerProducts} Records
            </div>
          </div>
        )}
      </div>

      {/* Quick Add & Inward — one-screen flow */}
      {showQuickAdd && (
        <QuickAddInward
          onClose={() => setShowQuickAdd(false)}
          onDone={() => refreshProducts(500)}
        />
      )}

      {/* Inward Stock Modal */}
      {showAddStock && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
           <div className="bg-white rounded-[50px] shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 border-t-8 border-amber-600">
              <div className="p-8 bg-slate-50 border-b flex justify-between items-center">
                 <div>
                    <h2 className="text-2xl font-black uppercase italic tracking-tighter">Material Inward Terminal</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Recording Arrival of Material</p>
                 </div>
                 <button onClick={() => setShowAddStock(false)} className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i className="fas fa-times"></i></button>
              </div>
              <div className="p-10 space-y-6">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Source: Vendor Order (Optional)</label>
                       <select 
                          className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-black outline-none appearance-none" 
                          value={newPurchase.gstInvoiceNo.startsWith('ORDER_') ? newPurchase.gstInvoiceNo.split('_')[1] : ''} 
                          onChange={e => {
                             const orderId = e.target.value;
                             const order = store.vendorOrders.find(o => o.id === orderId);
                             if (order) {
                                setNewPurchase({
                                   ...newPurchase,
                                   vendorName: order.vendorName,
                                   vehicleNumber: order.vehicleNumber || '',
                                   gstInvoiceNo: `ORDER_${order.id}`,
                                   items: order.items.map(it => ({
                                      productId: it.productId,
                                      qtyBoxes: it.qtyBoxes,
                                      rate: it.rate
                                   }))
                                });
                             } else {
                                setNewPurchase({ ...newPurchase, gstInvoiceNo: '', vendorName: '', vehicleNumber: '', items: [] });
                             }
                          }}
                       >
                          <option value="">Manual Entry (No Order Link)</option>
                          {store.vendorOrders.filter(o => o.status === 'Ordered' || o.status === 'Partial').map(o => (
                             <option key={`inward-order-${o.id}`} value={o.id}>#{o.orderNo} - {o.vendorName} ({o.orderDate})</option>
                          ))}
                       </select>
                    </div>
                    {/* Vendor Name (optional) — when provided, this inward is recorded as a
                        Vendor Purchase and automatically appears in Vendor Supply Chain,
                        with stock + purchase history synced — no double entry needed. */}
                    {!newPurchase.gstInvoiceNo.startsWith('ORDER_') && (
                      <div className="col-span-2 grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Vendor Name (Optional)</label>
                          <input type="text" list="inward-vendor-list"
                            className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-bold outline-none"
                            placeholder="e.g. Pradeep Suppliers"
                            value={newPurchase.vendorName}
                            onChange={e => setNewPurchase({ ...newPurchase, vendorName: e.target.value,
                              syncToSupplyChain: e.target.value.trim().length > 0 })} />
                          <datalist id="inward-vendor-list">
                            {[...new Set(store.vendorOrders.map(o => o.vendorName))].filter(Boolean).map(v => (
                              <option key={v} value={v} />
                            ))}
                          </datalist>
                        </div>
                        <div className="space-y-2 flex flex-col">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Invoice / Ref No</label>
                          <input type="text"
                            className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-bold outline-none"
                            placeholder="Optional invoice no."
                            value={newPurchase.gstInvoiceNo}
                            onChange={e => setNewPurchase({ ...newPurchase, gstInvoiceNo: e.target.value })} />
                        </div>
                        {newPurchase.vendorName.trim() && (
                          <label className="col-span-2 flex items-center gap-3 px-5 py-3 bg-amber-50 border border-amber-100 rounded-2xl cursor-pointer">
                            <input type="checkbox" className="w-5 h-5 accent-amber-600"
                              checked={newPurchase.syncToSupplyChain}
                              onChange={e => setNewPurchase({ ...newPurchase, syncToSupplyChain: e.target.checked })} />
                            <div>
                              <div className="text-[11px] font-black text-amber-800">Sync to Vendor Supply Chain</div>
                              <div className="text-[9px] font-bold text-amber-600 uppercase tracking-wide">
                                Creates a vendor purchase record automatically — no need to re-enter on the Vendor page
                              </div>
                            </div>
                          </label>
                        )}
                      </div>
                    )}
                    <div className="col-span-2 space-y-4">
                       <div className="flex justify-between items-center">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Material Batch</label>
                          <button 
                             onClick={() => setNewPurchase({
                                ...newPurchase,
                                items: [...newPurchase.items, { productId: '', qtyBoxes: 0, rate: 0 }]
                             })}
                             className="text-[9px] font-black text-blue-600 uppercase hover:underline"
                          >
                             + Add Item
                          </button>
                       </div>
                       <div className="space-y-3 max-h-[300px] overflow-y-auto scrollbar-hide pr-2">
                          {newPurchase.items.map((item, idx) => (
                             <div key={`inward-item-${idx}`} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                                <div className="flex justify-between items-center">
                                   <select 
                                      className="flex-1 bg-transparent font-black text-xs outline-none uppercase"
                                      value={item.productId}
                                      onChange={e => {
                                         const next = [...newPurchase.items];
                                         const p = products.find(x => x.id === e.target.value);
                                         next[idx] = { ...next[idx], productId: e.target.value, rate: p?.purchasePrice || 0 };
                                         setNewPurchase({ ...newPurchase, items: next });
                                      }}
                                   >
                                      <option value="">Select Product...</option>
                                      {products.map(p => <option key={`batch-prod-${p.id}`} value={p.id}>{p.name} ({p.brand})</option>)}
                                   </select>
                                   <button 
                                      onClick={() => setNewPurchase({ ...newPurchase, items: newPurchase.items.filter((_, i) => i !== idx) })}
                                      className="text-rose-500 ml-2"
                                   >
                                      <i className="fas fa-trash-alt text-xs"></i>
                                   </button>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                   <div className="space-y-1">
                                      <label className="text-[8px] font-black text-slate-400 uppercase ml-1">Qty (Boxes)</label>
                                      <input 
                                         type="number" 
                                         className="w-full px-3 py-2 bg-white border rounded-xl font-black text-xs outline-none"
                                         value={item.qtyBoxes}
                                         onChange={e => {
                                            const next = [...newPurchase.items];
                                            next[idx].qtyBoxes = parseInt(e.target.value || '0');
                                            setNewPurchase({ ...newPurchase, items: next });
                                         }}
                                      />
                                   </div>
                                   <div className="space-y-1">
                                      <label className="text-[8px] font-black text-slate-400 uppercase ml-1">Rate (₹)</label>
                                      <input 
                                         type="number" 
                                         className="w-full px-3 py-2 bg-white border rounded-xl font-black text-xs outline-none"
                                         value={item.rate}
                                         onChange={e => {
                                            const next = [...newPurchase.items];
                                            next[idx].rate = parseFloat(e.target.value || '0');
                                            setNewPurchase({ ...newPurchase, items: next });
                                         }}
                                      />
                                   </div>
                                </div>
                             </div>
                          ))}
                          {newPurchase.items.length === 0 && (
                             <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 font-bold italic text-xs">
                                No items in batch. Click "+ Add Item" or use the "+" button in the table.
                             </div>
                          )}
                       </div>
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Inward Date</label>
                       <input type="date" className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-bold" value={newPurchase.date} onChange={e => setNewPurchase({...newPurchase, date: e.target.value})} />
                    </div>

                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Target Warehouse</label>
                       <select className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-black outline-none appearance-none" value={newPurchase.godownId} onChange={e => setNewPurchase({...newPurchase, godownId: e.target.value})}>
                          {store.godowns.map(g => <option key={`inward-godown-${g.id}`} value={g.id}>{g.name}</option>)}
                       </select>
                    </div>
                 </div>
                 <button onClick={handleAddStockFromPurchase} className="w-full py-6 bg-slate-900 text-white rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl active:scale-95 mt-4">Initialize Inward Transmission</button>
              </div>
           </div>
        </div>
      )}

      {/* Product Master Modal */}
      {showAddProduct && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
           <div className="bg-white rounded-[50px] shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in-95 border-t-8 border-slate-900 flex flex-col max-h-[90vh]">
              <div className="p-8 bg-slate-50 border-b flex justify-between items-center">
                 <div>
                    <h2 className="text-3xl font-black uppercase tracking-tighter leading-none italic">{editProduct ? 'Modify Master Node' : 'Provision Master Node'}</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2 italic">Defining Physical & Commercial Attributes</p>
                 </div>
                 <button onClick={() => setShowAddProduct(false)} className="w-12 h-12 rounded-full bg-white border text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i className="fas fa-times text-xl"></i></button>
              </div>
              <div className="p-10 flex flex-col lg:flex-row gap-10 overflow-y-auto scrollbar-hide flex-1">
                 <div className="flex-1 space-y-8">
                    {errorMessage && (
                      <div className="bg-rose-50 border-2 border-rose-100 p-6 rounded-3xl flex items-center gap-4 animate-in slide-in-from-top-4">
                        <div className="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-rose-200">
                          <i className="fas fa-exclamation-triangle"></i>
                        </div>
                        <div className="flex-1">
                          <div className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Duplicate Detected</div>
                          <div className="text-xs font-bold text-rose-700 leading-relaxed">{errorMessage}</div>
                        </div>
                        <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-600"><i className="fas fa-times"></i></button>
                      </div>
                    )}
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Identity Profile</label>
                          <div className="flex items-center gap-4">
                            {currentRole === UserRole.ADMIN && (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-slate-400 uppercase">Show in Gallery</span>
                                <input 
                                  type="checkbox" 
                                  className="w-4 h-4 accent-blue-600" 
                                  checked={productForm.showInGallery} 
                                  onChange={e => setProductForm({...productForm, showInGallery: e.target.checked})}
                                />
                              </div>
                            )}
                            {!editProduct && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-400 uppercase">Bulk Mode</span>
                              <input 
                                type="checkbox" 
                                className="w-4 h-4 accent-slate-900" 
                                checked={(productForm.bulkCount || 1) > 1} 
                                onChange={e => {
                                  const isBulk = e.target.checked;
                                  setProductForm({
                                    ...productForm, 
                                    bulkCount: isBulk ? 2 : 1,
                                    bulkNames: isBulk ? [productForm.name || '', ''] : [productForm.name || '']
                                  });
                                }}
                              />
                            </div>
                          )}
                          </div>
                        </div>
                        
                        {(productForm.bulkCount || 1) > 1 ? (
                          <div className="space-y-3 bg-slate-50 p-6 rounded-3xl border-2 border-slate-100">
                            <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Bulk Product Names (Same Specs)</div>
                            {(productForm.bulkNames || []).map((name, idx) => (
                              <div key={`bulk-name-${idx}`} className="flex gap-2">
                                <input 
                                  type="text" 
                                  placeholder={`Product Name ${idx + 1}`} 
                                  className="flex-1 px-4 py-3 bg-white border rounded-xl font-black outline-none" 
                                  value={name} 
                                  onChange={e => {
                                    const next = [...(productForm.bulkNames || [])];
                                    next[idx] = e.target.value;
                                    setProductForm({...productForm, bulkNames: next, name: next[0]});
                                  }} 
                                />
                                {idx > 1 && (
                                  <button onClick={() => {
                                    const next = (productForm.bulkNames || []).filter((_, i) => i !== idx);
                                    setProductForm({...productForm, bulkNames: next, bulkCount: next.length});
                                  }} className="text-rose-500 px-2"><i className="fas fa-trash-alt"></i></button>
                                )}
                              </div>
                            ))}
                            <button 
                              onClick={() => {
                                const next = [...(productForm.bulkNames || []), ''];
                                setProductForm({...productForm, bulkNames: next, bulkCount: next.length});
                              }}
                              className="text-[10px] font-black text-blue-600 uppercase hover:underline mt-2"
                            >
                              + Add Another Product
                            </button>
                          </div>
                        ) : (
                          <input type="text" placeholder="Full Product Name (e.g. Statutario White Glossy)" className="w-full px-6 py-4 bg-slate-100 rounded-2xl font-black outline-none border-2 border-transparent focus:border-slate-900 transition-all" value={productForm.name} onChange={e => setProductForm({...productForm, name: e.target.value})} />
                        )}
                       <div className="grid grid-cols-3 gap-4">
                          <select className="w-full px-6 py-4 bg-slate-100 rounded-2xl font-black outline-none" value={productForm.category} onChange={e => setProductForm({...productForm, category: e.target.value as Category})}>
                             {categories.map(c => <option key={`cat-${c}`} value={c}>{c}</option>)}
                          </select>
                          <input type="text" placeholder="Origin Brand" className="w-full px-6 py-4 bg-slate-100 rounded-2xl font-black outline-none" value={productForm.brand} onChange={e => setProductForm({...productForm, brand: e.target.value})} />
                          {productForm.category === 'Kadapa' && (
                            <select className="w-full px-6 py-4 bg-amber-100 rounded-2xl font-black outline-none border-2 border-amber-200"
                              value={productForm.kadapaType}
                              onChange={e => {
                                const type = e.target.value;
                                // Immediately regenerate name if size is already set
                                const size = productForm.size;
                                let autoName = productForm.name;
                                if (size) {
                                  const parts = size.split(/[x×*,]/);
                                  const h = parseFloat(parts[0]?.trim() || '0');
                                  const isBig = h >= 5;
                                  const prefixMap: Record<string, { normal: string; big: string }> = {
                                    'Single Polish':     { normal: 'SP',  big: 'DSP' },
                                    'Double Polish':     { normal: 'DP',  big: 'DDP' },
                                    'Big Single Polish': { normal: 'DSP', big: 'DSP' },
                                    'Big Double Polish': { normal: 'DDP', big: 'DDP' },
                                  };
                                  const px = (prefixMap[type] || { normal: 'SP', big: 'DSP' })[isBig ? 'big' : 'normal'];
                                  autoName = `${px}_KDP_${size}`;
                                }
                                setProductForm({ ...productForm, kadapaType: type, name: autoName });
                              }}>
                              <option value="">-- Select finish --</option>
                              {(store.settings.kadapaItemTypes || [
                                { id:'ksp', name:'Single Polish', ratePerSqft:28 },
                                { id:'kdp', name:'Double Polish', ratePerSqft:35 },
                                { id:'kbsp', name:'Big Single Polish', ratePerSqft:45 },
                                { id:'kbdp', name:'Big Double Polish', ratePerSqft:55 },
                              ]).map(t => (
                                <option key={t.id} value={t.name}>{t.name} — ₹{t.ratePerSqft}/SqFt</option>
                              ))}
                            </select>
                          )}
                          {productForm.category === 'Granite' && (
                            <input 
                              type="text" 
                              placeholder="Granite Name (e.g. Star Black)" 
                              className="w-full px-6 py-4 bg-amber-100 rounded-2xl font-black outline-none border-2 border-amber-200" 
                              value={productForm.graniteName || ''} 
                              onChange={e => setProductForm({...productForm, graniteName: e.target.value})} 
                            />
                          )}
                          <div className="relative">
                            <input 
                                type="text" 
                                list="predefined-sizes"
                                placeholder="Size (e.g. 600x1200)" 
                                className="w-full px-6 py-4 bg-slate-100 rounded-2xl font-black outline-none border-2 border-transparent focus:border-blue-500 transition-all" 
                                value={productForm.size} 
                                onChange={e => setProductForm({...productForm, size: e.target.value})} 
                            />
                            <datalist id="predefined-sizes">
                                {predefinedSizes.map(size => (
                                    <option key={size} value={size} />
                                ))}
                            </datalist>
                          </div>
                       </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 bg-slate-50 p-6 rounded-3xl border-2 border-slate-100">
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Grade</label>
                            <select className="w-full px-4 py-3 bg-white border rounded-xl font-black outline-none appearance-none" value={productForm.grade} onChange={e => setProductForm({...productForm, grade: e.target.value as TileGrade})}>
                                {grades.map(g => <option key={`grade-${g}`} value={g}>{g}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Shade No.</label>
                            <input type="text" placeholder="e.g. SH-10" className="w-full px-4 py-3 bg-white border rounded-xl font-bold outline-none" value={productForm.shadeNo} onChange={e => setProductForm({...productForm, shadeNo: e.target.value})} />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Batch No.</label>
                            <input type="text" placeholder="e.g. B-4" className="w-full px-4 py-3 bg-white border rounded-xl font-bold outline-none" value={productForm.batchNo} onChange={e => setProductForm({...productForm, batchNo: e.target.value})} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 bg-blue-50/50 p-6 rounded-3xl border-2 border-blue-100/50">
                        <div className="col-span-3">
                            <label className="text-[10px] font-black text-blue-600 uppercase ml-1 tracking-widest">Initial Purchase / Vendor Link</label>
                        </div>
                        <div className="col-span-3 space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Link to Vendor Order</label>
                            <select 
                                className="w-full px-4 py-3 bg-white border rounded-xl font-black outline-none appearance-none" 
                                value={productForm.linkedOrderId || ''} 
                                onChange={e => {
                                    const orderId = e.target.value;
                                    const order = store.vendorOrders.find(o => o.id === orderId);
                                    if (order) {
                                        setProductForm({
                                            ...productForm,
                                            linkedOrderId: orderId,
                                            lastPurchaseVendor: order.vendorName,
                                            lastPurchaseDate: order.orderDate,
                                            lastPurchaseVehicle: order.vehicleNumber || ''
                                        });
                                    } else {
                                        setProductForm({
                                            ...productForm,
                                            linkedOrderId: undefined,
                                            lastPurchaseVendor: '',
                                            lastPurchaseDate: '',
                                            lastPurchaseVehicle: ''
                                        });
                                    }
                                }}
                            >
                                <option value="">Select Vendor Order (Optional)</option>
                                {store.vendorOrders.map(o => (
                                    <option key={`vendor-order-${o.id}`} value={o.id}>#{o.orderNo} - {o.vendorName} ({o.orderDate})</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Vendor Name</label>
                            <input type="text" placeholder="e.g. Kajaria" className="w-full px-4 py-3 bg-white border rounded-xl font-bold outline-none" value={productForm.lastPurchaseVendor} onChange={e => setProductForm({...productForm, lastPurchaseVendor: e.target.value})} disabled={!!productForm.linkedOrderId} />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Purchase Date</label>
                            <input type="date" className="w-full px-4 py-3 bg-white border rounded-xl font-bold outline-none" value={productForm.lastPurchaseDate} onChange={e => setProductForm({...productForm, lastPurchaseDate: e.target.value})} disabled={!!productForm.linkedOrderId} />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Vehicle No.</label>
                            <input type="text" placeholder="KA-01-..." className="w-full px-4 py-3 bg-white border rounded-xl font-bold outline-none" value={productForm.lastPurchaseVehicle} onChange={e => setProductForm({...productForm, lastPurchaseVehicle: e.target.value})} disabled={!!productForm.linkedOrderId} />
                        </div>
                    </div>

                    {/* ── Smart Unit Config (replaces old unit/tiles/sqft grid) ── */}
                    {productForm.category !== 'Kadapa' && productForm.category !== 'Granite' && productForm.category !== 'Marble' && (
                      <UnitConfig
                        category={productForm.category || ''}
                        value={{
                          unitType:         (productForm.unitType as any) || 'Box',
                          tilesPerBox:      productForm.tilesPerBox  || 1,
                          sqftPerBox:       productForm.sqftPerBox   || 0,
                          baseWeightGrams:  (productForm as any).baseWeightGrams || 0,
                          unitVariants:     (productForm as any).unitVariants || [],
                          purchasePrice:    productForm.purchasePrice  || 0,
                          sellingPrice:     productForm.sellingPrice   || 0,
                        }}
                        onChange={v => setProductForm(prev => ({
                          ...prev,
                          unitType:        v.unitType as any,
                          tilesPerBox:     v.tilesPerBox,
                          sqftPerBox:      v.sqftPerBox,
                          baseWeightGrams: v.baseWeightGrams,
                          unitVariants:    v.unitVariants,
                          purchasePrice:   v.purchasePrice,
                          sellingPrice:    v.sellingPrice,
                        }))}
                      />
                    )}

                    {/* For Kadapa/Granite/Marble keep the original unit display (managed by slab managers) */}
                    {(productForm.category === 'Kadapa' || productForm.category === 'Granite' || productForm.category === 'Marble') && (
                      <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
                        <i className="fas fa-info-circle text-amber-400"></i>
                        <span className="text-[10px] font-bold text-amber-600">
                          Unit is <strong>Slab</strong> — pricing is set per-SqFt in the calculator below.
                        </span>
                      </div>
                    )}

                    {/* ── Kadapa: dedicated manager ── */}
                    {productForm.category === 'Kadapa' && (
                      <div className="flex justify-end mb-2">
                        <button onClick={() => setShowKadapaGen(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-700 transition-all active:scale-95 shadow-lg shadow-amber-900/20">
                          <i className="fas fa-magic text-[9px]"></i> Auto-Generate All Kadapa Sizes
                        </button>
                      </div>
                    )}
                    {productForm.category === 'Kadapa' && (
                      <KadapaManager
                        existingSlabs={productForm.slabs || []}
                        onUpdateSlab={(id, updates) => {
                          setProductForm(prev => ({
                            ...prev,
                            slabs: (prev.slabs || []).map(s => s.id === id ? { ...s, ...updates } : s),
                          }));
                        }}
                        onAdd={newSlabs => {
                          setProductForm(prev => {
                            const firstSlab = newSlabs[0] as any;
                            const hFt = firstSlab?.heightFt || 0;
                            const wFt = firstSlab?.lengthFt || 0;

                            // Build size string: "2x1", "3.5x1.25" etc.
                            const hStr = hFt % 1 === 0 ? `${hFt}` : `${hFt}`;
                            const wStr = wFt % 1 === 0 ? `${wFt}` : `${wFt}`;
                            const autoSize = hFt && wFt ? `${hStr}x${wStr}` : prev.size;

                            // Derive name immediately — same logic as useEffect
                            const type = prev.kadapaType || 'Single Polish';
                            const h = parseFloat(hStr || '0');
                            const isBig = h >= 5;
                            const prefixMap: Record<string, { normal: string; big: string }> = {
                              'Single Polish':     { normal: 'SP',  big: 'DSP' },
                              'Double Polish':     { normal: 'DP',  big: 'DDP' },
                              'Big Single Polish': { normal: 'DSP', big: 'DSP' },
                              'Big Double Polish': { normal: 'DDP', big: 'DDP' },
                            };
                            const px = (prefixMap[type] || { normal: 'SP', big: 'DSP' })[isBig ? 'big' : 'normal'];
                            const autoName = autoSize ? `${px}_KDP_${autoSize}` : prev.name;

                            return {
                              ...prev,
                              slabs: [...(prev.slabs || []), ...newSlabs],
                              // Set size + name immediately so Identity Profile updates
                              size:  autoSize || prev.size,
                              name:  autoName || prev.name,
                              sqftPerBox: firstSlab?.sqft || prev.sqftPerBox,
                              // Cost sync
                              purchasePrice: newSlabs.length > 0
                                ? Math.round(newSlabs.reduce((s, sl) => s + ((sl as any).landedCost || 0), 0) / newSlabs.length)
                                : prev.purchasePrice,
                              sellingPrice: newSlabs.length > 0 && (newSlabs[0] as any).sellingPrice
                                ? Math.round(newSlabs.reduce((s, sl) => s + ((sl as any).sellingPrice || 0), 0) / newSlabs.length)
                                : prev.sellingPrice,
                              sellingPricePerSqft: newSlabs.length > 0 && (newSlabs[0] as any).sellingPricePerSqft
                                ? (newSlabs[0] as any).sellingPricePerSqft
                                : prev.sellingPricePerSqft,
                            };
                          });
                        }}
                        onRemove={id => setProductForm(prev => ({
                          ...prev,
                          slabs: (prev.slabs || []).filter(s => s.id !== id),
                        }))}
                      />
                    )}

                    {/* ── Granite / Marble: GraniteManager ── */}
                    {(productForm.category === 'Granite' || productForm.category === 'Marble') && (
                      <GraniteManager
                        existingSlabs={productForm.slabs || []}
                        initialCostConfig={{
                          purchaseRatePerSqft: productForm.costPerSqft || 0,
                          transportPct:        productForm.transportCost || 0,
                          unloadingPerSqft:    0,
                          otherChargesPerSqft: productForm.otherCharges || 0,
                          sellingPricePerSqft: productForm.sellingPricePerSqft || 0,
                        }}
                        onAdd={(newSlabs, costConfig) => {
                          const base      = costConfig.purchaseRatePerSqft;
                          const transport = base * (costConfig.transportPct / 100);
                          const landed    = parseFloat((base + transport + costConfig.unloadingPerSqft + costConfig.otherChargesPerSqft).toFixed(2));

                          setProductForm(prev => {
                            const allSlabs = [...(prev.slabs || []), ...newSlabs];
                            const availSlabs = allSlabs.filter(s => !s.isSold);

                            // ── Issue 4: Auto-update Showroom Selling Price ──
                            // Use costConfig.sellingPricePerSqft (set in Step 1)
                            const sellPerSqft = costConfig.sellingPricePerSqft || prev.sellingPricePerSqft || 0;
                            // Avg sqft per slab (for per-box proxy)
                            const avgSqft = availSlabs.length > 0
                              ? availSlabs.reduce((s, sl) => s + (sl.sqft || 0), 0) / availSlabs.length
                              : newSlabs[0]?.sqft || 1;
                            const sellPerSlab = parseFloat((sellPerSqft * avgSqft).toFixed(2));

                            return {
                              ...prev,
                              slabs:               allSlabs,
                              costPerSqft:         base,
                              transportCost:       costConfig.transportPct,
                              transportCostType:   'Percentage',
                              otherCharges:        costConfig.otherChargesPerSqft,
                              sellingPricePerSqft: sellPerSqft,
                              // sellingPrice = avg selling price per slab (proxy for "per box" in POS)
                              sellingPrice:        sellPerSlab,
                              purchasePrice:       landed,
                              totalCostPerUnit:    landed,
                              // sqftPerBox = avg sqft per slab (for per-sqft syncing in POS)
                              sqftPerBox:          parseFloat(avgSqft.toFixed(2)),
                            };
                          });
                        }}
                        onRemove={id => setProductForm(prev => ({
                          ...prev,
                          slabs: (prev.slabs || []).filter(s => s.id !== id),
                        }))}
                      />
                    )}

                    <div className="grid grid-cols-2 gap-4 bg-slate-50 p-6 rounded-3xl border-2 border-slate-100">
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Reorder Level (Low Stock Alert)</label>
                            <input type="number" className="w-full px-4 py-3 bg-white border rounded-xl font-bold outline-none" value={productForm.reorderLevel} onChange={e => setProductForm({...productForm, reorderLevel: parseInt(e.target.value || '0')})} />
                        </div>
                        <div className="space-y-2 col-span-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Product Images</label>
                            <div className="flex flex-col gap-3">
                              <div className="flex gap-2 overflow-x-auto py-2">
                                {productForm.images?.map((img, idx) => (
                                  <div key={`form-img-${idx}`} className="relative group shrink-0">
                                    <img src={img} alt="Preview" className="w-16 h-16 rounded-xl object-cover border border-slate-200" referrerPolicy="no-referrer" />
                                    <button 
                                      onClick={() => setProductForm({...productForm, images: productForm.images?.filter((_, i) => i !== idx)})}
                                      className="absolute -top-2 -right-2 bg-rose-500 text-white w-5 h-5 rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <i className="fas fa-times"></i>
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <input 
                                type="file" 
                                accept="image/*"
                                multiple
                                className="w-full px-4 py-2 bg-white border rounded-xl font-bold outline-none text-[10px]" 
                                onChange={e => {
                                  const files = Array.from(e.target.files || []);
                                  const newImages: string[] = [];
                                  
                                  files.forEach(file => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                      const img = new Image();
                                      img.onload = () => {
                                        const canvas = document.createElement('canvas');
                                        const MAX_WIDTH = 800;
                                        const MAX_HEIGHT = 800;
                                        let width = img.width;
                                        let height = img.height;

                                        if (width > height) {
                                          if (width > MAX_WIDTH) {
                                            height *= MAX_WIDTH / width;
                                            width = MAX_WIDTH;
                                          }
                                        } else {
                                          if (height > MAX_HEIGHT) {
                                            width *= MAX_HEIGHT / height;
                                            height = MAX_HEIGHT;
                                          }
                                        }

                                        canvas.width = width;
                                        canvas.height = height;
                                        const ctx = canvas.getContext('2d');
                                        ctx?.drawImage(img, 0, 0, width, height);
                                        
                                        // Compress to JPEG with 0.7 quality
                                        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                                        newImages.push(compressedDataUrl);
                                        
                                        if (newImages.length === files.length) {
                                          setProductForm(prev => ({
                                            ...prev, 
                                            images: [...(prev.images || []), ...newImages]
                                          }));
                                        }
                                      };
                                      img.src = reader.result as string;
                                    };
                                    reader.readAsDataURL(file);
                                  });
                                }} 
                              />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Landed Cost Engine (Internal Data Only)</label>
                       <div className="grid grid-cols-3 gap-4">
                          <div className="bg-slate-50 p-5 rounded-3xl border-2 border-slate-100">
                             <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Purchase Rate / {productForm.unitType}</label>
                             <input type="number" className={`w-full bg-transparent font-black text-slate-800 text-xl outline-none`} value={productForm.purchasePrice || ''} onChange={e => setProductForm({...productForm, purchasePrice: parseFloat(e.target.value || '0')})} />
                              {(productForm.category === 'Kadapa' || productForm.category === 'Granite') && (
                                <div className="absolute top-2 right-4 text-[7px] font-black text-amber-500 uppercase tracking-widest bg-amber-100 px-2 py-0.5 rounded-full">Auto-Calculated</div>
                              )}
                          </div>
                          <div className="bg-slate-50 p-5 rounded-3xl border-2 border-slate-100">
                             <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Transport Factor</label>
                             <div className="flex gap-2 items-center">
                                <input type="number" className="flex-1 bg-transparent font-black text-slate-800 text-xl outline-none" value={productForm.transportCost || ''} onChange={e => setProductForm({...productForm, transportCost: parseFloat(e.target.value || '0')})} />
                                <select className="bg-slate-200 text-[8px] font-black p-1 rounded uppercase" value={productForm.transportCostType} onChange={e => setProductForm({...productForm, transportCostType: e.target.value as any})}>
                                   <option value="Percentage">%</option>
                                   <option value="Fixed">₹</option>
                                </select>
                             </div>
                          </div>
                          <div className="bg-slate-50 p-5 rounded-3xl border-2 border-slate-100">
                             <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">Misc Charges</label>
                             <input type="number" className="w-full bg-transparent font-black text-slate-800 text-xl outline-none" value={productForm.otherCharges || ''} onChange={e => setProductForm({...productForm, otherCharges: parseFloat(e.target.value || '0')})} />
                          </div>
                       </div>
                    </div>
                 </div>

                 <div className="w-full lg:w-80 space-y-6">
                    <div className="bg-slate-900 p-6 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
                       <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-[50px] pointer-events-none"></div>
                       <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Landed Intelligence</h3>
                       <div className="mt-3">
                          <div className="text-[8px] font-black text-slate-500 uppercase mb-1">Per {productForm.unitType || 'Box'}</div>
                          <div className="text-4xl font-black italic tracking-tighter text-amber-500">₹{calculatedLandedCost.toFixed(2)}</div>
                       </div>
                       {(productForm.sqftPerBox || 0) > 0 && (
                         <div className="mt-3 pt-3 border-t border-white/10">
                           <div className="text-[8px] font-black text-slate-500 uppercase mb-1">Per SqFt</div>
                           <div className="text-2xl font-black text-teal-400">
                             ₹{(calculatedLandedCost / (productForm.sqftPerBox || 1)).toFixed(2)}
                           </div>
                           <div className="text-[8px] text-slate-500 mt-1">
                             {productForm.sqftPerBox} SqFt/Box
                           </div>
                         </div>
                       )}
                       {(productForm.sellingPrice || 0) > 0 && calculatedLandedCost > 0 && (
                         <div className="mt-3 pt-3 border-t border-white/10">
                           <div className="text-[8px] font-black text-slate-500 uppercase mb-1">Margin / Box</div>
                           <div className={`text-xl font-black ${(productForm.sellingPrice || 0) >= calculatedLandedCost ? 'text-emerald-400' : 'text-rose-400'}`}>
                             ₹{((productForm.sellingPrice || 0) - calculatedLandedCost).toFixed(2)}
                           </div>
                           {(productForm.sqftPerBox || 0) > 0 && (
                             <div className="text-[8px] text-slate-500">
                               ₹{(((productForm.sellingPrice || 0) - calculatedLandedCost) / (productForm.sqftPerBox || 1)).toFixed(2)} / SqFt
                             </div>
                           )}
                         </div>
                       )}
                    </div>

                    <div className="bg-amber-50 p-6 rounded-[40px] border-2 border-amber-100 space-y-3 relative">
                       <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest block">Showroom Selling Price</label>
                       {(productForm.category === 'Kadapa' || productForm.category === 'Granite') && (
                         <div className="absolute top-4 right-6 text-[7px] font-black text-amber-500 uppercase tracking-widest bg-amber-100 px-2 py-0.5 rounded-full">Auto-Calculated</div>
                       )}

                       {/* Per Box — primary POS field */}
                       <div>
                         <label className="text-[8px] font-black text-amber-400 uppercase block mb-1">Per Box (₹) — POS Base Rate</label>
                         <input type="number"
                           className="w-full px-4 py-4 bg-white border-2 border-amber-200 rounded-2xl font-black text-center text-2xl outline-none text-amber-800 focus:border-amber-400 transition-all"
                           value={productForm.sellingPrice || ''}
                           onChange={e => {
                             const box = parseFloat(e.target.value || '0');
                             const sqft = productForm.sqftPerBox || 1;
                             setProductForm({
                               ...productForm,
                               sellingPrice: box,
                               sellingPricePerSqft: sqft > 0 ? parseFloat((box / sqft).toFixed(2)) : 0
                             });
                           }} />
                       </div>

                       {/* Per SqFt — synced automatically */}
                       {(productForm.sqftPerBox || 0) > 0 && (
                         <div>
                           <label className="text-[8px] font-black text-amber-400 uppercase block mb-1">Per SqFt (₹) — in sync with box price</label>
                           <input type="number"
                             className="w-full px-4 py-3 bg-white border-2 border-amber-100 rounded-2xl font-black text-center text-lg outline-none text-amber-700 focus:border-amber-300 transition-all"
                             value={productForm.sellingPricePerSqft || ''}
                             onChange={e => {
                               const sqftPrice = parseFloat(e.target.value || '0');
                               const sqft = productForm.sqftPerBox || 1;
                               setProductForm({
                                 ...productForm,
                                 sellingPricePerSqft: sqftPrice,
                                 sellingPrice: sqft > 0 ? parseFloat((sqftPrice * sqft).toFixed(2)) : 0
                               });
                             }} />
                           <div className="text-center text-[8px] font-black text-amber-400 mt-1">
                             ₹{((productForm.sellingPricePerSqft || 0)).toFixed(2)}/SqFt × {productForm.sqftPerBox} SqFt = ₹{((productForm.sellingPrice || 0)).toFixed(0)}/Box
                           </div>
                         </div>
                       )}

                       <div className="text-center text-[8px] font-black text-amber-400 uppercase italic pt-1">
                         Base rate per {(productForm.unitType || 'unit').toLowerCase()} for POS module
                       </div>
                    </div>

                    <div className="flex flex-col gap-4">
                       {/* ── Dependent Items — only for non-slab products ── */}
                       {productForm.category !== 'Kadapa' && productForm.category !== 'Granite' && productForm.category !== 'Marble' && (
                         <div className="space-y-2">
                           <DependentItemsManager
                             dependentItems={(productForm as any).dependentItems || []}
                             parentUnit={productForm.unitType || 'Box'}
                             onChange={items => setProductForm(prev => ({ ...prev, dependentItems: items } as any))}
                           />
                         </div>
                       )}

                       <button onClick={handleUpsertProduct} className="w-full py-6 bg-slate-900 text-white rounded-[30px] font-black text-xs uppercase tracking-widest hover:bg-slate-800 shadow-2xl transition-all active:scale-95">Commit to Registry</button>
                       <button onClick={() => setShowAddProduct(false)} className="w-full py-4 text-[10px] font-black text-slate-400 uppercase hover:text-slate-900 transition-colors">Discard Master</button>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {showAdjustStock && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
           <div className="bg-white rounded-[50px] shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 border-t-8 border-amber-600">
              <div className="p-8 bg-slate-50 border-b flex justify-between items-center">
                 <div>
                    <h2 className="text-2xl font-black uppercase italic tracking-tighter">Stock Adjustment</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Modify Stock or Report Damage for {showAdjustStock.name}</p>
                 </div>
                 <button onClick={() => setShowAdjustStock(null)} className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i className="fas fa-times"></i></button>
              </div>
              <div className="p-10 space-y-6">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Action Type</label>
                       <select className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-black outline-none appearance-none" value={adjustForm.actionType} onChange={e => setAdjustForm({...adjustForm, actionType: e.target.value as any})}>
                          <option value="Correction">Stock Correction (Add/Remove)</option>
                          <option value="Damage">Report Damage (Remove)</option>
                       </select>
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Volume ({showAdjustStock.unitType}s)</label>
                       <input type="number" className="w-full px-5 py-4 bg-slate-900 text-amber-500 rounded-2xl font-black text-2xl" value={adjustForm.qtyBoxes} onChange={e => setAdjustForm({...adjustForm, qtyBoxes: parseInt(e.target.value || '0')})} />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Volume (Loose Pieces)</label>
                       <input type="number" className="w-full px-5 py-4 bg-slate-900 text-amber-500 rounded-2xl font-black text-2xl" value={adjustForm.qtyLoose} onChange={e => setAdjustForm({...adjustForm, qtyLoose: parseInt(e.target.value || '0')})} />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Target Warehouse</label>
                       <select className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-black outline-none appearance-none" value={adjustForm.godownId} onChange={e => setAdjustForm({...adjustForm, godownId: e.target.value})}>
                          {store.godowns.map(g => <option key={`adjust-godown-${g.id}`} value={g.id}>{g.name}</option>)}
                       </select>
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Notes</label>
                       <input type="text" className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-bold" value={adjustForm.notes} onChange={e => setAdjustForm({...adjustForm, notes: e.target.value})} placeholder="Reason for adjustment" />
                    </div>
                    {adjustForm.actionType === 'Damage' && (
                       <div className="col-span-2 space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-2 tracking-widest">Link to Vendor Order (Optional)</label>
                          <select 
                             className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-black outline-none appearance-none border-2 border-transparent focus:border-rose-500 transition-all" 
                             value={adjustForm.vendorOrderId} 
                             onChange={e => setAdjustForm({...adjustForm, vendorOrderId: e.target.value})}
                          >
                             <option value="">No Link (Independent Damage)</option>
                             {store.vendorOrders
                                .filter(o => o.status === 'Received' && o.items.some(i => i.productId === showAdjustStock?.id))
                                .map(o => (
                                   <option key={`link-order-${o.id}`} value={o.id}>
                                      Order #{o.orderNo} - {o.vendorName} ({o.orderDate})
                                   </option>
                                ))
                             }
                          </select>
                          <p className="text-[9px] font-bold text-slate-400 ml-2 italic">Linking will update the damage report in the selected vendor order for audit consistency.</p>
                       </div>
                    )}
                 </div>
                 <button onClick={handleAdjustStock} className={`w-full py-6 text-white rounded-3xl font-black text-sm uppercase tracking-widest transition-all shadow-xl active:scale-95 mt-4 ${adjustForm.actionType === 'Damage' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-900 hover:bg-slate-800'}`}>
                   {adjustForm.actionType === 'Damage' ? 'Confirm Damage Report' : 'Apply Stock Correction'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Item History Modal */}
      {showItemHistory && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
           <div className="bg-white rounded-[50px] shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 border-t-8 border-blue-600 flex flex-col max-h-[90vh]">
              <div className="p-8 bg-slate-50 border-b flex justify-between items-center shrink-0">
                 <div>
                    <h2 className="text-2xl font-black uppercase italic tracking-tighter">Item Traceability Log</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Lifecycle of {showItemHistory.name}</p>
                 </div>
                 <button onClick={() => setShowItemHistory(null)} className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i className="fas fa-times"></i></button>
              </div>
              <div className="p-8 overflow-y-auto scrollbar-hide flex-1">
                 <div className="space-y-6">
                    {!showItemHistory.adjustmentLog || showItemHistory.adjustmentLog.length === 0 ? (
                      <div className="text-center p-10 text-slate-400 font-bold uppercase tracking-widest">No history recorded for this item.</div>
                    ) : (
                      <div className="relative border-l-2 border-slate-100 ml-4 space-y-8">
                        {showItemHistory.adjustmentLog.map((log, idx) => (
                          <div key={log.id || `log-${idx}`} className="relative pl-8">
                            <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-4 border-white ${
                              log.actionType === 'Sale' ? 'bg-emerald-500' :
                              log.actionType === 'Purchase' ? 'bg-blue-500' :
                              log.actionType === 'Damage' ? 'bg-rose-500' :
                              log.actionType === 'Return' ? 'bg-purple-500' :
                              'bg-amber-500'
                            }`}></div>
                            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${
                                    log.actionType === 'Sale' ? 'bg-emerald-100 text-emerald-700' :
                                    log.actionType === 'Purchase' ? 'bg-blue-100 text-blue-700' :
                                    log.actionType === 'Damage' ? 'bg-rose-100 text-rose-700' :
                                    log.actionType === 'Return' ? 'bg-purple-100 text-purple-700' :
                                    'bg-amber-100 text-amber-700'
                                  }`}>{log.actionType}</span>
                                  <span className="text-xs font-bold text-slate-500 ml-3">{log.date}</span>
                                </div>
                                <div className="text-right">
                                  <div className={`font-black text-lg ${log.qtyBoxes > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {log.qtyBoxes > 0 ? '+' : ''}{log.qtyBoxes} {showItemHistory.unitType === 'Box' ? 'B' : showItemHistory.unitType === 'Bag' ? 'Bag' : showItemHistory.unitType}
                                    {log.qtyLoose !== 0 && ` ${log.qtyLoose > 0 ? '+' : ''}${log.qtyLoose} Pcs`}
                                  </div>
                                </div>
                              </div>
                              <div className="text-sm font-bold text-slate-700 mt-2">{log.notes || 'No details provided'}</div>
                              <div className="text-[10px] font-black text-slate-400 uppercase mt-3 flex items-center gap-4">
                                <span><i className="fas fa-user mr-1"></i> {log.userName}</span>
                                <span><i className="fas fa-warehouse mr-1"></i> {log.godownName}</span>
                                {log.vendorOrderId && (
                                  <button 
                                    onClick={() => {
                                      if (setActiveTab) {
                                        setActiveTab('vendor_tracking');
                                        setShowItemHistory(null);
                                      }
                                    }}
                                    className="text-blue-500 hover:underline font-black"
                                  >
                                    <i className="fas fa-link mr-1"></i> View Vendor Order
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQR && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-4">
           <div className="bg-white rounded-[50px] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 border-t-8 border-slate-900">
              <div className="p-8 bg-slate-50 border-b flex justify-between items-center">
                 <div>
                    <h2 className="text-2xl font-black uppercase italic tracking-tighter">Product QR Bridge</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Shareable Inventory Link</p>
                 </div>
                 <button onClick={() => setShowQR(null)} className="w-10 h-10 rounded-full bg-white border text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i className="fas fa-times"></i></button>
              </div>
              <div className="p-10 flex flex-col items-center space-y-8">
                 <div className="text-center">
                    <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">{showQR.brand}</div>
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">{showQR.name}</h3>
                 </div>
                 
                 <div className="w-64 h-64 bg-white p-4 rounded-[40px] border-4 border-slate-50 shadow-inner flex items-center justify-center">
                    {qrCodeUrl ? (
                       <img src={qrCodeUrl} className="w-full h-full" alt="QR Code" referrerPolicy="no-referrer" />
                    ) : (
                       <div className="animate-spin text-slate-200"><i className="fas fa-circle-notch text-4xl"></i></div>
                    )}
                 </div>

                 <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 w-full text-center">
                    <p className="text-[10px] font-bold text-slate-500 leading-relaxed">Scan this code to view live stock, photos, and technical specifications in the public gallery.</p>
                 </div>

                 <button 
                    onClick={() => {
                       const link = document.createElement('a');
                       link.href = qrCodeUrl;
                       link.download = `QR_${showQR.name.replace(/\s+/g, '_')}.png`;
                       link.click();
                    }}
                    className="w-full py-5 bg-slate-900 text-white rounded-[25px] font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl flex items-center justify-center gap-3"
                 >
                    <i className="fas fa-download"></i> Download QR Image
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Product Gallery Modal */}
      {showGallery && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-[600] flex items-center justify-center p-4">
          <div className="w-full max-w-6xl h-full max-h-[90vh] flex flex-col gap-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center text-white">
              <div>
                <h2 className="text-3xl font-black uppercase italic tracking-tighter">{showGallery.name}</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{showGallery.brand} • {showGallery.category}</p>
              </div>
              <button 
                onClick={() => setShowGallery(null)} 
                className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex items-center justify-center"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            
            <div className="flex-1 bg-white/5 rounded-[50px] border border-white/10 overflow-hidden flex flex-col">
              <div className="flex-1 relative group">
                <img 
                  src={showGallery.images?.[0] || 'https://images.unsplash.com/photo-1517646331032-9e8563c520a1?auto=format&fit=crop&q=80&w=1000'} 
                  className="w-full h-full object-contain" 
                  alt={showGallery.name}
                  referrerPolicy="no-referrer"
                />
              </div>
              
              {showGallery.images && showGallery.images.length > 1 && (
                <div className="p-8 bg-black/20 flex gap-4 overflow-x-auto scrollbar-hide">
                  {showGallery.images.map((img, idx) => (
                    <img 
                      key={`gallery-thumb-${idx}`}
                      src={img} 
                      className="w-24 h-24 rounded-2xl object-cover cursor-pointer hover:scale-105 transition-transform border-2 border-transparent hover:border-white/50"
                      alt={`Thumbnail ${idx + 1}`}
                      referrerPolicy="no-referrer"
                    />
                  ))}
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                <div className="text-[8px] font-black text-slate-500 uppercase mb-1">Current Stock</div>
                <div className="text-xl font-black text-white">{showGallery.stockBoxes} {showGallery.unitType}s</div>
              </div>
              <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                <div className="text-[8px] font-black text-slate-500 uppercase mb-1">Dimensions</div>
                <div className="text-xl font-black text-white">{showGallery.size}</div>
              </div>
              <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                <div className="text-[8px] font-black text-slate-500 uppercase mb-1">Grade</div>
                <div className="text-xl font-black text-white">{showGallery.grade || 'Premium'}</div>
              </div>
              <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                <div className="text-[8px] font-black text-slate-500 uppercase mb-1">Shade</div>
                <div className="text-xl font-black text-white">{showGallery.shadeNo || '---'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Photo Upload Modal */}
      {photoProduct && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-[28px] sm:max-w-sm shadow-2xl overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <div className="font-black text-base">Upload Product Photo</div>
                <div className="text-[9px] text-slate-400 font-bold mt-0.5 truncate max-w-[220px]">{photoProduct.name}</div>
              </div>
              <button onClick={() => setPhotoProduct(null)} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {/* Current photo */}
              {photoProduct.images?.[0] && (
                <div className="relative">
                  <img src={photoProduct.images[0]} alt={photoProduct.name}
                    className="w-full h-48 object-cover rounded-2xl border border-slate-100"/>
                  <button
                    onClick={() => {
                      if (!confirm('Remove current photo?')) return;
                      store.updateProduct(photoProduct.id, { images: [] });
                      setPhotoProduct({ ...photoProduct, images: [] });
                    }}
                    className="absolute top-2 right-2 w-8 h-8 bg-rose-500 text-white rounded-xl flex items-center justify-center text-[10px] font-black hover:bg-rose-600">
                    <i className="fas fa-trash-alt"></i>
                  </button>
                </div>
              )}
              {!photoProduct.images?.[0] && (
                <div className="w-full h-40 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-300">
                  <i className="fas fa-image text-4xl mb-2"></i>
                  <span className="text-[9px] font-black uppercase tracking-widest">No photo yet</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={camLoading}
                  onClick={async () => {
                    const photo = await takePhoto('camera');
                    if (!photo) return;
                    const images = [photo.dataUrl, ...(photoProduct.images || []).slice(0, 3)];
                    store.updateProduct(photoProduct.id, { images });
                    setPhotoProduct({ ...photoProduct, images });
                  }}
                  className="flex flex-col items-center gap-2 py-5 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-wide hover:bg-amber-600 transition-all disabled:opacity-40 active:scale-95">
                  {camLoading
                    ? <><i className="fas fa-spinner fa-spin text-lg"></i><span>Opening…</span></>
                    : <><i className="fas fa-camera text-2xl"></i><span>Take Photo</span></>}
                </button>
                <button
                  disabled={camLoading}
                  onClick={async () => {
                    const photo = await takePhoto('gallery');
                    if (!photo) return;
                    const images = [photo.dataUrl, ...(photoProduct.images || []).slice(0, 3)];
                    store.updateProduct(photoProduct.id, { images });
                    setPhotoProduct({ ...photoProduct, images });
                  }}
                  className="flex flex-col items-center gap-2 py-5 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-wide hover:bg-indigo-700 transition-all disabled:opacity-40 active:scale-95">
                  <i className="fas fa-images text-2xl"></i>
                  <span>Choose Photo</span>
                </button>
              </div>
              <div className="text-[9px] text-slate-400 font-bold text-center">
                Photos are compressed to 1024px · Max 4 photos per product
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Ledger Modal */}
      {ledgerProduct && (
        <StockLedger
          product={ledgerProduct}
          onClose={() => setLedgerProduct(null)}
        />
      )}
    </div>
  );
};

export default Inventory;
