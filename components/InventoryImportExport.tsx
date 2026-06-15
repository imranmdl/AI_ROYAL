/**
 * InventoryImportExport.tsx
 *
 * Full import/export center for inventory:
 *  - Export: downloads one Excel-like CSV per category sheet (Wall Tile, Adhesive…)
 *            OR a single combined CSV with a "Sheet" column
 *  - Import: drag-and-drop or file picker for CSV/Excel (.csv, .xls, .xlsx)
 *            Parses on the client, shows live preview, maps columns,
 *            then POSTs rows to server for DB upsert
 *  - Vendor linking: if VendorName column present, links/creates vendor order
 *  - Import history: timestamped log of every import with user + stats
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { store } from '../store';

// ── Types ──────────────────────────────────────────────────────────────────
interface ImportSession {
  id: string;
  timestamp: string;
  user: string;
  fileName: string;
  category: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  status: 'success' | 'partial' | 'failed';
}

interface ParsedRow {
  _rowNum: number;
  _sheet?: string;
  [key: string]: any;
}

// ── Category sheet definitions ────────────────────────────────────────────
const CATEGORY_COLUMNS: Record<string, string[]> = {
  // 'Category' column is always first — ensures correct category on re-import
  'Wall Tile':  ['Category','Product Name','Brand','Size','Grade','Shade No','Tiles Per Box','Sqft Per Box','Purchase Price','Selling Price','Stock Boxes','Reorder Level','Vendor Name','Status'],
  'Floor Tile': ['Category','Product Name','Brand','Size','Grade','Shade No','Tiles Per Box','Sqft Per Box','Purchase Price','Selling Price','Stock Boxes','Reorder Level','Vendor Name','Status'],
  'Floor':      ['Category','Product Name','Brand','Size','Grade','Shade No','Tiles Per Box','Sqft Per Box','Purchase Price','Selling Price','Stock Boxes','Reorder Level','Vendor Name','Status'],
  'Granite':    ['Category','Product Name','Brand','Grade','Purchase Rate Per Sqft','Transport Pct','Selling Price Per Sqft','Vendor Name','Status'],
  'Marble':     ['Category','Product Name','Brand','Grade','Purchase Rate Per Sqft','Transport Pct','Selling Price Per Sqft','Vendor Name','Status'],
  'Kadapa':     ['Category','Product Name','Finish Type','Height (Ft)','Width (Ft)','Purchase Rate Per Sqft','Selling Price Per Sqft','Stock Slabs','Vendor Name','Status'],
  'Adhesive':   ['Category','Product Name','Brand','Unit','Weight Grams','Purchase Price','Selling Price','Stock','Reorder Level','Vendor Name','Status'],
  'Grout':      ['Category','Product Name','Brand','Unit','Weight Grams','Purchase Price','Selling Price','Stock','Reorder Level','Vendor Name','Status'],
  'Sanitary':   ['Category','Product Name','Brand','Size','Purchase Price','Selling Price','Stock','Reorder Level','Vendor Name','Status'],
  'Tools':      ['Category','Product Name','Brand','Purchase Price','Selling Price','Stock','Reorder Level','Vendor Name','Status'],
};

const SAMPLE_ROWS: Record<string, string[][]> = {
  // Category is always first column
  'Wall Tile':  [['Wall Tile','Porcelain White Matt','Kajaria','600x1200 mm','Premium','SH-01','4','16','450','620','50','10','ABC Ceramics','Active']],
  'Floor Tile': [['Floor Tile','Galaxy Glossy Black','Somany','800x800 mm','Standard','SH-04','4','17.6','380','520','30','8','Somany Direct','Active']],
  'Floor':      [['Floor','Mosaic Brown','Nitco','300x300 mm','Commercial','','9','7.3','180','260','100','20','Nitco Dealers','Active']],
  'Granite':    [['Granite','Galaxy Black','Local Quarry','Premium','40','30','95','Karnataka Granite','Active']],
  'Marble':     [['Marble','Statuario White','Italian Imports','Premium','120','25','280','Marble World','Active']],
  'Kadapa':     [['Kadapa','SP_KDP_2x1','Single Polish','2','1','28','65','20','Kadapa Stone Co','Active']],
  'Adhesive':   [['Adhesive','Tile Fix Pro','Pidilite','Kg','1000','38','55','200','50','Pidilite Direct','Active']],
  'Grout':      [['Grout','White Grout','Mapei','Kg','1000','42','68','100','30','Mapei India','Active']],
  'Sanitary':   [['Sanitary','Closet P-Trap','Hindware','Standard','850','1250','15','5','Hindware Dist','Active']],
  'Tools':      [['Tools','Tile Cutter 600mm','Rubi','1800','2800','5','2','Tools Hub','Active']],
};

// ── CSV helpers ───────────────────────────────────────────────────────────
function escapeCell(v: any): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map(r => r.map(escapeCell).join(',')).join('\n');
}

function parseCsvText(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map((line, i) => {
    const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
    const obj: ParsedRow = { _rowNum: i + 2 };
    headers.forEach((h, hi) => { obj[h] = vals[hi] || ''; });
    return obj;
  }).filter(r => Object.values(r).some(v => v && v !== r._rowNum?.toString()));
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Component ─────────────────────────────────────────────────────────────
const InventoryImportExport: React.FC = () => {
  const categories  = store.settings.categories || Object.keys(CATEGORY_COLUMNS);
  const currentUser = store.currentUser;

  // ── Import state
  const [activeTab, setActiveTab]       = useState<'export'|'import'|'history'|'mapping'>('export');
  const [dragOver, setDragOver]         = useState(false);
  const [parsedRows, setParsedRows]     = useState<ParsedRow[]>([]);
  const [fileName, setFileName]         = useState('');
  const [detectedCategory, setDetectedCategory] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(categories[0] || 'Wall Tile');
  const [isImporting, setIsImporting]   = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importHistory, setImportHistory] = useState<ImportSession[]>(() => {
    try { return JSON.parse(localStorage.getItem('royal_import_history') || '[]'); } catch { return []; }
  });

  // ── Export state
  const [exportMode, setExportMode]     = useState<'category'|'all'|'current'>('category');
  const [exportCategory, setExportCategory] = useState(categories[0] || 'Wall Tile');
  const [includeStock, setIncludeStock] = useState(true);

  const [duplicateWarning, setDuplicateWarning] = useState('');
  const [existingDuplicates, setExistingDuplicates] = useState<string[]>([]);   // names that already exist in inventory
  const [skipExisting, setSkipExisting] = useState(false);                       // if true, don't import rows that already exist

  // ── Vendor Mapping (shown after successful import) ─────────────────────
  const [importedProducts, setImportedProducts] = useState<any[]>([]);
  const [mapVendorName, setMapVendorName] = useState('');
  const [mapDate, setMapDate] = useState(new Date().toISOString().slice(0,10));
  const [mapInvoiceNo, setMapInvoiceNo] = useState('');
  const [mapItems, setMapItems] = useState<{ productId:string; name:string; category:string; qty:number; purchaseRate:number; sellingPrice:number }[]>([]);
  const [mapTransport, setMapTransport] = useState({ totalWeightTons: 0, ratePerTon: 3500, loadingCharges: 0, unloadingCharges: 0, driverExpenses: 0 });
  const [mapLaborCharges, setMapLaborCharges] = useState(0);
  const [mapSaving, setMapSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Save import history ────────────────────────────────────────────────
  const saveHistory = (sessions: ImportSession[]) => {
    setImportHistory(sessions);
    localStorage.setItem('royal_import_history', JSON.stringify(sessions.slice(0, 50)));
  };

  // ── Export ────────────────────────────────────────────────────────────
  const fetchAllProducts = async (): Promise<any[]> => {
    try {
      const headers: Record<string,string> = store.getAuthHeaders();
      let all: any[] = [];
      let page = 1;
      while (true) {
        const r = await fetch(`/api/products?page=${page}&limit=100&status=All&category=All&brand=All&size=All&stockStatus=All&grade=All`, { headers });
        const d = await r.json();
        if (!d.data?.length) break;
        all = [...all, ...d.data];
        if (all.length >= d.total || d.data.length < 100) break;
        page++;
      }
      return all.length > 0 ? all : store.products;
    } catch { return store.products; }
  };

  const mapProductCol = (p: any, col: string, cat: string): string => {
    switch (col) {
      case 'Product Name':          return p.name || '';
      case 'Brand':                 return p.brand || '';
      case 'Size':                  return p.size || '';
      case 'Grade':                 return p.grade || 'Premium';
      case 'Shade No':              return p.shadeNo || '';
      case 'Tiles Per Box':         return String(p.tilesPerBox || 4);
      case 'Sqft Per Box':          return String(p.sqftPerBox || 16);
      case 'Purchase Price':        return String(p.purchasePrice || 0);
      case 'Purchase Rate Per Sqft':return String(p.costPerSqft || 0);
      case 'Transport Pct':         return String(p.transportCost || 0);
      case 'Selling Price':         return String(p.sellingPrice || 0);
      case 'Selling Price Per Sqft':return String(p.sellingPricePerSqft || 0);
      case 'Stock Boxes':           return String(p.stockBoxes || 0);
      case 'Stock Slabs':           return String(p.slabs?.filter((s: any) => !s.isSold).length || 0);
      case 'Stock':                 return String(p.stockBoxes || 0);
      case 'Reorder Level':         return String(p.reorderLevel || 10);
      case 'Vendor Name':           return p.lastPurchaseVendor || '';
      case 'Finish Type':           return p.kadapaType || p.finish || '';
      case 'Height (Ft)':           return String(p.slabHeightFt || (p.slabs?.[0]?.heightFt) || '');
      case 'Width (Ft)':            return String(p.slabLengthFt || (p.slabs?.[0]?.lengthFt) || '');
      case 'Unit':                  return p.unitType || 'Box';
      case 'Weight Grams':          return String(p.baseWeightGrams || '');
      case 'Category':              return p.category || cat;
      case 'Status':                return p.status || 'Active';
      default:                      return '';
    }
  };

  const exportCategory_ = (cat: string) => {
    const cols = CATEGORY_COLUMNS[cat] || CATEGORY_COLUMNS['Wall Tile'];
    if (includeStock) {
      fetchAllProducts().then(allProds => {
        const seen = new Set<string>();
        const products = allProds
          .filter((p: any) => p.category === cat)
          .filter((p: any) => {
            const key = `${(p.name||'').trim().toLowerCase()}|${(p.size||'').trim().toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        const rows = products.map((p: any) => cols.map(col => mapProductCol(p, col, cat)));
        const sample = rows.length === 0 ? (SAMPLE_ROWS[cat] || []) : [];
        const csvContent = buildCsv(cols, rows.length > 0 ? rows : sample);
        downloadCsv(`Royal_${cat.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.csv`, csvContent);
      });
    } else {
      const sample = SAMPLE_ROWS[cat] || [];
      const csvContent = buildCsv(cols, sample);
      downloadCsv(`Template_${cat.replace(/\s+/g,'_')}.csv`, csvContent);
    }
  };

  const exportAll = () => {
    const allCols = ['Sheet', 'Product Name', 'Brand', 'Category', 'Size', 'Unit', 'Purchase Price', 'Selling Price', 'Stock', 'Status', 'Vendor Name'];
    fetchAllProducts().then(allProds => {
      const rows: string[][] = [];
      const seen = new Set<string>();
      allProds
        .slice()
        .sort((a: any, b: any) => (a.name||'').localeCompare(b.name||''))
        .forEach((p: any) => {
          const key = `${(p.name||'').trim().toLowerCase()}|${(p.size||'').trim().toLowerCase()}|${(p.category||'').trim().toLowerCase()}`;
          if (seen.has(key)) return;
          seen.add(key);
          rows.push([
            p.category, p.name, p.brand || '', p.category, p.size || '',
            p.unitType || 'Box',
            String(p.purchasePrice || 0),
            String(p.sellingPrice || 0),
            String(p.stockBoxes || 0),
            p.status || 'Active',
            p.lastPurchaseVendor || '',
          ]);
        });
      downloadCsv(`Royal_Full_Inventory_${new Date().toISOString().slice(0,10)}.csv`, buildCsv(allCols, rows));
    });
  };

  // ── File parsing ──────────────────────────────────────────────────────
  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    setImportResult(null);
    setParsedRows([]);

    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();

    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCsvText(text);
      if (rows.length === 0) return;

      // Auto-detect category from first row
      const firstRow = rows[0];
      const headers  = Object.keys(firstRow).filter(k => !k.startsWith('_'));

      let detected = '';
      if (headers.includes('Tiles Per Box') || headers.includes('Sqft Per Box')) {
        detected = firstRow['Category'] || 'Wall Tile';
      } else if (headers.includes('Purchase Rate Per Sqft') && headers.includes('Transport Pct')) {
        detected = 'Granite';
      } else if (headers.includes('Finish Type')) {
        detected = 'Kadapa';
      } else if (headers.includes('Weight Grams')) {
        detected = firstRow['Category'] || 'Adhesive';
      } else {
        detected = firstRow['Category'] || firstRow['Sheet'] || selectedCategory;
      }

      setDetectedCategory(detected);
      setSelectedCategory(detected || selectedCategory);

      // ── Deduplicate rows within the file (same name+size = same product) ──
      const seen = new Set<string>();
      const dupNames: string[] = [];
      const dedupedRows = rows.filter(row => {
        const name = (row['Product Name'] || row['name'] || row['Name'] || '').toString().trim().toLowerCase();
        const size = (row['Size'] || row['size'] || '').toString().trim().toLowerCase();
        if (!name) return true; // keep blank for error reporting
        const key = `${name}|${size}`;
        if (seen.has(key)) { dupNames.push(row['Product Name'] || name); return false; }
        seen.add(key);
        return true;
      });

      if (dupNames.length > 0) {
        setDuplicateWarning(`${dupNames.length} duplicate row(s) removed from import preview: ${dupNames.slice(0, 5).join(', ')}${dupNames.length > 5 ? '…' : ''}`);
      } else {
        setDuplicateWarning('');
      }

      // ── Check against EXISTING inventory — flag items that already exist ──
      const existingNames = dedupedRows
        .map(row => {
          const n = (row['Product Name'] || row['name'] || row['Name'] || '').toString().trim();
          const s = (row['Size'] || row['size'] || '').toString().trim();
          return store.productExists(n, s) ? n : '';
        })
        .filter(Boolean);
      setExistingDuplicates(existingNames);

      setParsedRows(dedupedRows);
    };

    reader.readAsText(file);
  }, [selectedCategory]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  // ── Import submission ─────────────────────────────────────────────────
  const handleImport = async () => {
    if (!parsedRows.length) return;
    setIsImporting(true);
    setImportResult(null);

    // If "skip existing" is enabled, filter out rows that already exist in inventory
    const rowsToSend = skipExisting
      ? parsedRows.filter(row => {
          const n = (row['Product Name'] || row['name'] || row['Name'] || '').toString().trim();
          const s = (row['Size'] || row['size'] || '').toString().trim();
          return !store.productExists(n, s);
        })
      : parsedRows;

    if (rowsToSend.length === 0) {
      setImportResult({ error: 'All rows already exist in inventory and "Skip existing items" is enabled. Nothing to import.' });
      setIsImporting(false);
      return;
    }

    const importHeaders: Record<string,string> = { 'Content-Type': 'application/json', ...store.getAuthHeaders() };

    const base = (store.settings as any).backendUrl || '';
    try {
      const res = await fetch(`${base}/api/admin/import-products-csv`, {
        method: 'POST',
        headers: importHeaders,
        body: JSON.stringify({ rows: rowsToSend, category: selectedCategory }),
      });
      const data = await res.json();

      const session: ImportSession = {
        id: `imp-${Date.now()}`,
        timestamp: new Date().toLocaleString(),
        user: currentUser?.name || 'Unknown',
        fileName,
        category: selectedCategory,
        created: data.results?.created || 0,
        updated: data.results?.updated || 0,
        skipped: data.results?.skipped || 0,
        errors:  data.results?.errors  || [],
        status: data.results?.errors?.length > 0 ? 'partial' : res.ok ? 'success' : 'failed',
      };

      saveHistory([session, ...importHistory]);
      setImportResult(data);

      if (res.ok) {
        await store.refreshFromServer(true);

        // ── Set up the Vendor Mapping screen with the imported items ──
        const imported = (data.importedProducts || []) as any[];
        if (imported.length > 0) {
          setImportedProducts(imported);
          setMapItems(imported.map(p => ({
            productId: p.id, name: p.name, category: p.category,
            qty: p.qty || 0, purchaseRate: p.purchasePrice || 0, sellingPrice: p.sellingPrice || 0,
          })));
          // Prefill vendor name from CSV if all rows share the same vendor
          const vendors = [...new Set(imported.map(p=>p.vendorName).filter(Boolean))];
          setMapVendorName(vendors.length === 1 ? vendors[0] : '');
          setActiveTab('mapping');
        }

        setParsedRows([]);
        setFileName('');
        setExistingDuplicates([]);
        if (fileRef.current) fileRef.current.value = '';
      }
    } catch (e: any) {
      setImportResult({ error: e.message });
    } finally {
      setIsImporting(false);
    }
  };

  // ── Preview table headers (first 8) ──────────────────────────────────
  const previewHeaders = useMemo(() => {
    if (!parsedRows.length) return [];
    return Object.keys(parsedRows[0]).filter(k => !k.startsWith('_')).slice(0, 8);
  }, [parsedRows]);

  // ── UI helpers ─────────────────────────────────────────────────────────
  const TAB = (id: typeof activeTab, label: string, icon: string) => (
    <button onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-black text-[10px] uppercase tracking-widest transition-all
        ${activeTab === id ? 'bg-slate-900 text-white shadow' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
      <i className={`fas ${icon} text-[10px]`}></i> {label}
    </button>
  );

  const statusBadge = (s: ImportSession['status']) =>
    s === 'success' ? 'bg-emerald-100 text-emerald-700' :
    s === 'partial' ? 'bg-amber-100 text-amber-700' :
    'bg-rose-100 text-rose-600';

  return (
    <div className="space-y-5 pb-10">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">
            Import / Export Center
          </h2>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
            Category-wise templates · Bulk upload · Vendor linking · Timestamped history
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {TAB('export',  'Export / Templates', 'fa-file-export')}
          {TAB('import',  'Import Data',        'fa-file-import')}
          {importedProducts.length > 0 && TAB('mapping', `Vendor Mapping (${importedProducts.length})`, 'fa-link')}
          {TAB('history', `History (${importHistory.length})`, 'fa-history')}
        </div>
      </div>

      {/* ── EXPORT TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'export' && (
        <div className="space-y-5">

          {/* Export mode */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {([
              { id: 'category', label: 'By Category', sub: 'One sheet for the selected category', icon: 'fa-layer-group' },
              { id: 'all',      label: 'Full Inventory', sub: 'All products in one file', icon: 'fa-database' },
            ] as const).map(opt => (
              <button key={opt.id} onClick={() => setExportMode(opt.id)}
                className={`p-4 rounded-2xl border-2 text-left transition-all
                  ${exportMode === opt.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 bg-white hover:border-slate-300'}`}>
                <i className={`fas ${opt.icon} mb-2 ${exportMode === opt.id ? 'text-amber-400' : 'text-slate-400'}`}></i>
                <div className={`font-black text-sm ${exportMode === opt.id ? 'text-white' : 'text-slate-800'}`}>{opt.label}</div>
                <div className={`text-[9px] font-bold mt-0.5 ${exportMode === opt.id ? 'text-slate-400' : 'text-slate-400'}`}>{opt.sub}</div>
              </button>
            ))}
          </div>

          {/* Options */}
          <div className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <div onClick={() => setIncludeStock(v => !v)}
                className={`w-10 h-5 rounded-full transition-all relative cursor-pointer ${includeStock ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${includeStock ? 'left-5' : 'left-0.5'}`}/>
              </div>
              <span className="text-xs font-bold text-slate-600">Include current stock data</span>
            </label>
            <span className="text-slate-300">|</span>
            <span className="text-[9px] text-slate-400 font-bold">
              {includeStock ? 'Exports live data from inventory' : 'Downloads blank template with sample row'}
            </span>
          </div>

          {/* Category grid */}
          {exportMode === 'category' && (
            <div className="space-y-3">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Select Category to Export</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {categories.map(cat => {
                  const count = store.products.filter(p => p.category === cat).length;
                  const cols  = CATEGORY_COLUMNS[cat] || CATEGORY_COLUMNS['Wall Tile'];
                  return (
                    <button key={cat} onClick={() => exportCategory_(cat)}
                      className="bg-white border border-slate-100 rounded-2xl p-4 text-left hover:border-slate-900 hover:shadow-md transition-all group active:scale-95">
                      <div className="w-8 h-8 bg-slate-100 group-hover:bg-slate-900 rounded-xl flex items-center justify-center mb-2 transition-all">
                        <i className="fas fa-file-csv text-slate-400 group-hover:text-amber-400 text-xs transition-all"></i>
                      </div>
                      <div className="font-black text-sm text-slate-800 leading-tight">{cat}</div>
                      <div className="text-[8px] text-slate-400 font-bold mt-1">{count} products · {cols.length} columns</div>
                      <div className="mt-2 text-[8px] font-black text-emerald-600 opacity-0 group-hover:opacity-100 transition-all">
                        ↓ Download CSV
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {exportMode === 'all' && (
            <button onClick={exportAll}
              className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-slate-700 transition-all active:scale-95 flex items-center justify-center gap-3">
              <i className="fas fa-file-export"></i>
              Download Full Inventory ({store.products.length} products)
            </button>
          )}

          {/* Column guide */}
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-3">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Column Reference by Category</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(CATEGORY_COLUMNS).slice(0, 6).map(([cat, cols]) => (
                <div key={cat} className="space-y-1">
                  <div className="text-[9px] font-black text-slate-600 uppercase">{cat}</div>
                  <div className="text-[8px] text-slate-400 font-bold leading-relaxed">
                    {cols.join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── IMPORT TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'import' && (
        <div className="space-y-5">

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-[28px] p-10 text-center cursor-pointer transition-all
              ${dragOver
                ? 'border-blue-400 bg-blue-50 scale-[1.01]'
                : fileName
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-white'}`}>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all
              ${dragOver ? 'bg-blue-100' : fileName ? 'bg-emerald-100' : 'bg-white border border-slate-200'}`}>
              <i className={`fas ${dragOver ? 'fa-cloud-upload-alt text-blue-500' : fileName ? 'fa-check text-emerald-500' : 'fa-file-import text-slate-400'} text-xl`}></i>
            </div>
            {fileName ? (
              <>
                <div className="font-black text-emerald-700 text-sm">{fileName}</div>
                <div className="text-[9px] text-emerald-500 font-bold mt-1">{parsedRows.length} rows detected</div>
                {detectedCategory && (
                  <div className="text-[9px] text-blue-500 font-bold mt-1">Detected: {detectedCategory}</div>
                )}
              </>
            ) : (
              <>
                <div className="font-black text-slate-700 text-base">Drop CSV file here or click to browse</div>
                <div className="text-[9px] text-slate-400 font-bold mt-2">Accepts .csv files · Use Export tab to download templates</div>
              </>
            )}
          </div>

          {/* Duplicate warning banner */}
          {duplicateWarning && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3.5">
              <i className="fas fa-exclamation-triangle text-amber-500 text-sm mt-0.5 shrink-0"></i>
              <div>
                <div className="font-black text-amber-700 text-sm">Duplicate Rows Removed</div>
                <div className="text-[10px] text-amber-600 font-bold mt-0.5">{duplicateWarning}</div>
              </div>
            </div>
          )}

          {/* Existing-inventory duplicate banner */}
          {existingDuplicates.length > 0 && (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3.5">
              <i className="fas fa-info-circle text-blue-500 text-sm mt-0.5 shrink-0"></i>
              <div className="flex-1">
                <div className="font-black text-blue-700 text-sm">{existingDuplicates.length} item(s) already exist in inventory</div>
                <div className="text-[10px] text-blue-600 font-bold mt-0.5">
                  {existingDuplicates.slice(0,5).join(', ')}{existingDuplicates.length > 5 ? '…' : ''}
                </div>
                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600"
                    checked={skipExisting} onChange={e=>setSkipExisting(e.target.checked)} />
                  <span className="text-[10px] font-black text-blue-700 uppercase tracking-wide">
                    Skip these — only import new items (uncheck to update existing prices/stock)
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Category confirmation + import controls */}
          {parsedRows.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">
                    Fallback Category <span className="text-amber-500 normal-case font-bold">(used only for rows without a Category column)</span>
                  </label>
                  <select className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-sm outline-none"
                    value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="pt-5">
                  <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Rows to import</div>
                  <div className="text-2xl font-black text-slate-800">{parsedRows.length}</div>
                </div>
                <div className="pt-5">
                  <button onClick={handleImport} disabled={isImporting}
                    className="px-8 py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2">
                    <i className={`fas ${isImporting ? 'fa-spinner fa-spin' : 'fa-upload'}`}></i>
                    {isImporting ? 'Importing...' : 'Import to Inventory'}
                  </button>
                </div>
              </div>

              {/* Preview table */}
              {previewHeaders.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="text-[8px] font-black text-slate-400 uppercase">Preview (first 5 rows)</div>
                    {parsedRows[0]?.['Category'] ? (
                      <div className="text-[8px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                        ✓ Category column found — each row uses its own category
                      </div>
                    ) : (
                      <div className="text-[8px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                        ⚠ No Category column — fallback category applies to all rows
                      </div>
                    )}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="text-[10px] w-full">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="px-3 py-2 text-left font-black text-slate-400 text-[8px]">#</th>
                          {previewHeaders.map(h => (
                            <th key={h} className="px-3 py-2 text-left font-black text-slate-500 text-[8px] whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-300 font-bold">{row._rowNum}</td>
                            {previewHeaders.map(h => (
                              <td key={h} className="px-3 py-2 font-bold text-slate-600 whitespace-nowrap max-w-[120px] truncate" title={row[h]}>
                                {row[h] || <span className="text-slate-200">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsedRows.length > 5 && (
                      <div className="px-3 py-2 text-[9px] text-slate-400 font-bold text-center bg-slate-50 border-t border-slate-100">
                        +{parsedRows.length - 5} more rows
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Import result */}
          {importResult && (
            <div className={`rounded-2xl px-5 py-4 border ${importResult.error ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
              {importResult.error ? (
                <div className="font-black text-rose-700">✗ {importResult.error}</div>
              ) : (
                <div className="space-y-1">
                  <div className="font-black text-emerald-700 text-sm flex items-center gap-2">
                    <i className="fas fa-check-circle"></i> Import Complete
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    {[
                      { label: 'Created',  val: importResult.results?.created || 0, color: 'text-emerald-600' },
                      { label: 'Updated',  val: importResult.results?.updated || 0, color: 'text-blue-600' },
                      { label: 'Skipped',  val: importResult.results?.skipped || 0, color: 'text-amber-600' },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="bg-white rounded-xl p-2 text-center">
                        <div className={`text-xl font-black ${color}`}>{val}</div>
                        <div className="text-[8px] font-black text-slate-400 uppercase">{label}</div>
                      </div>
                    ))}
                  </div>
                  {importResult.results?.errors?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="text-[8px] font-black text-amber-600 uppercase">Rows with issues:</div>
                      {importResult.results.errors.slice(0, 5).map((e: string, i: number) => (
                        <div key={i} className="text-[9px] text-amber-600 bg-amber-50 rounded px-2 py-1">{e}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tips */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4 space-y-2">
            <div className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Tips for smooth import</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[9px] text-blue-500 font-bold">
              <div>• Download a template from the Export tab first — column names must match exactly</div>
              <div>• Each category has different required columns — use the right template</div>
              <div>• Products matched by Name + Size — existing items will be updated, not duplicated</div>
              <div>• Add Vendor Name column to auto-link products to vendor purchase history</div>
              <div>• Leave cells blank to keep existing values (on update)</div>
              <div>• Status column: Active or Suspended (defaults to Active if blank)</div>
            </div>
          </div>
        </div>
      )}

      {/* ── VENDOR MAPPING TAB (shown after a successful import) ─────────── */}
      {activeTab === 'mapping' && (
        <div className="space-y-5">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 flex items-start gap-3">
            <i className="fas fa-check-circle text-emerald-500 text-lg mt-0.5"></i>
            <div>
              <div className="font-black text-emerald-700 text-sm">{importedProducts.length} item(s) imported successfully</div>
              <div className="text-[10px] text-emerald-600 font-bold mt-0.5">
                Now map this batch to a vendor — set purchase rates, selling prices, and transport so
                landed cost and vendor analytics are accurate. Stock levels from the CSV are kept as-is
                (this step will NOT add stock again).
              </div>
            </div>
          </div>

          {/* Vendor + date */}
          <div className="bg-white border border-slate-100 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Vendor Name</label>
              <input className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400"
                list="import-vendor-list" value={mapVendorName} onChange={e=>setMapVendorName(e.target.value)} placeholder="e.g. Pradeep Suppliers" />
              <datalist id="import-vendor-list">
                {[...new Set((store.vendorOrders||[]).map(o=>o.vendorName))].filter(Boolean).map(v=><option key={v} value={v} />)}
              </datalist>
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Date</label>
              <input type="date" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400"
                value={mapDate} onChange={e=>setMapDate(e.target.value)} />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Invoice / Ref No (optional)</label>
              <input className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400"
                value={mapInvoiceNo} onChange={e=>setMapInvoiceNo(e.target.value)} placeholder="INV-1234" />
            </div>
          </div>

          {/* Items table — qty, purchase rate, selling price, landed cost (live) */}
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 font-black text-sm text-slate-900">Items — Review Pricing</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {['Item','Category','Qty','Purchase Rate','Selling Price','Landed Cost','Margin'].map(h=>(
                      <th key={h} className="px-4 py-2.5 text-left text-[9px] font-black text-slate-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(() => {
                    const totalQty = mapItems.reduce((s,i)=>s+(i.qty||0),0);
                    const freight = (mapTransport.totalWeightTons||0) * (mapTransport.ratePerTon||0);
                    const totalTransport = freight + (mapTransport.loadingCharges||0) + (mapTransport.unloadingCharges||0) + (mapTransport.driverExpenses||0);
                    const transportPerUnit = totalQty>0 ? totalTransport/totalQty : 0;
                    const laborPerUnit = totalQty>0 ? mapLaborCharges/totalQty : 0;
                    return mapItems.map((it, idx) => {
                      const landed = it.purchaseRate + transportPerUnit + laborPerUnit;
                      const margin = it.sellingPrice>0 ? ((it.sellingPrice-landed)/it.sellingPrice)*100 : 0;
                      return (
                        <tr key={it.productId}>
                          <td className="px-4 py-2.5 font-bold text-slate-900">{it.name}</td>
                          <td className="px-4 py-2.5 text-slate-500">{it.category}</td>
                          <td className="px-4 py-2.5">
                            <input type="number" className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"
                              value={it.qty} onChange={e=>setMapItems(p=>p.map((x,i)=>i===idx?{...x,qty:+e.target.value}:x))} />
                          </td>
                          <td className="px-4 py-2.5">
                            <input type="number" className="w-24 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"
                              value={it.purchaseRate} onChange={e=>setMapItems(p=>p.map((x,i)=>i===idx?{...x,purchaseRate:+e.target.value}:x))} />
                          </td>
                          <td className="px-4 py-2.5">
                            <input type="number" className="w-24 px-2 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg font-bold text-xs"
                              value={it.sellingPrice} onChange={e=>setMapItems(p=>p.map((x,i)=>i===idx?{...x,sellingPrice:+e.target.value}:x))} />
                          </td>
                          <td className="px-4 py-2.5 font-black text-purple-600">₹{landed.toFixed(2)}</td>
                          <td className={`px-4 py-2.5 font-black ${margin>=20?'text-emerald-600':margin>=10?'text-amber-600':'text-rose-600'}`}>{margin.toFixed(1)}%</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transport */}
          <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
            <div className="font-black text-sm text-slate-900 flex items-center gap-2">
              <i className="fas fa-truck text-purple-500"></i> Transport &amp; Logistics (allocated across all items)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Total Weight (Tons)</label>
                <input type="number" step="0.1" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                  value={mapTransport.totalWeightTons||''} onChange={e=>setMapTransport(p=>({...p,totalWeightTons:+e.target.value}))} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Rate / Ton (₹)</label>
                <input type="number" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                  value={mapTransport.ratePerTon||''} onChange={e=>setMapTransport(p=>({...p,ratePerTon:+e.target.value}))} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Loading (₹)</label>
                <input type="number" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                  value={mapTransport.loadingCharges||''} onChange={e=>setMapTransport(p=>({...p,loadingCharges:+e.target.value}))} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Unloading (₹)</label>
                <input type="number" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                  value={mapTransport.unloadingCharges||''} onChange={e=>setMapTransport(p=>({...p,unloadingCharges:+e.target.value}))} />
              </div>
              <div>
                <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Driver Extra (₹)</label>
                <input type="number" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                  value={mapTransport.driverExpenses||''} onChange={e=>setMapTransport(p=>({...p,driverExpenses:+e.target.value}))} />
              </div>
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-400 uppercase block mb-1.5">Labor Charges (₹)</label>
              <input type="number" className="w-full md:w-48 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                value={mapLaborCharges||''} onChange={e=>setMapLaborCharges(+e.target.value)} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={async ()=>{
                setMapSaving(true);
                try {
                  await store.linkImportBatchToVendor({
                    vendorName: mapVendorName, date: mapDate, invoiceNo: mapInvoiceNo || undefined,
                    items: mapItems.map(i=>({ productId:i.productId, qty:i.qty, purchaseRate:i.purchaseRate, sellingPrice:i.sellingPrice })),
                    transport: mapTransport, laborCharges: mapLaborCharges,
                  });
                  await store.refreshFromServer(true);
                  setImportedProducts([]);
                  setMapItems([]);
                  setActiveTab('import');
                } finally { setMapSaving(false); }
              }}
              disabled={mapSaving || !mapVendorName.trim()}
              className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2">
              {mapSaving ? <><i className="fas fa-spinner fa-spin"></i> Saving…</> : <><i className="fas fa-link"></i> Confirm Mapping — Link to Vendor</>}
            </button>
            <button
              onClick={()=>{ setImportedProducts([]); setMapItems([]); setActiveTab('import'); }}
              className="px-8 py-3.5 bg-white border-2 border-slate-200 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">
              Skip — Map Later from Vendor Supply Chain
            </button>
          </div>
          {!mapVendorName.trim() && (
            <div className="text-[10px] font-bold text-rose-500 uppercase">Enter a vendor name to confirm mapping</div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {importHistory.length === 0 ? (
            <div className="text-center py-16 text-slate-300 font-black text-lg uppercase">
              No import history yet
            </div>
          ) : (
            <>
              <div className="flex justify-end">
                <button onClick={() => { saveHistory([]); }}
                  className="text-[9px] font-black text-rose-400 hover:underline uppercase">
                  Clear History
                </button>
              </div>
              {importHistory.map(session => (
                <div key={session.id} className="bg-white border border-slate-100 rounded-2xl p-4 hover:shadow-md transition-all">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        session.status === 'success' ? 'bg-emerald-100' :
                        session.status === 'partial' ? 'bg-amber-100' : 'bg-rose-100'
                      }`}>
                        <i className={`fas ${
                          session.status === 'success' ? 'fa-check text-emerald-500' :
                          session.status === 'partial' ? 'fa-exclamation text-amber-500' :
                          'fa-times text-rose-500'
                        } text-xs`}></i>
                      </div>
                      <div>
                        <div className="font-black text-slate-800 text-sm">{session.fileName}</div>
                        <div className="text-[9px] text-slate-400 font-bold">
                          {session.timestamp} · {session.user} · {session.category}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${statusBadge(session.status)}`}>
                      {session.status}
                    </span>
                  </div>
                  <div className="flex gap-4 mt-3 ml-12">
                    {[
                      { label: 'Created', val: session.created, color: 'text-emerald-600' },
                      { label: 'Updated', val: session.updated, color: 'text-blue-600' },
                      { label: 'Skipped', val: session.skipped, color: 'text-amber-600' },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="text-center">
                        <div className={`text-base font-black ${color}`}>{val}</div>
                        <div className="text-[7px] font-black text-slate-400 uppercase">{label}</div>
                      </div>
                    ))}
                    {session.errors.length > 0 && (
                      <div className="text-center">
                        <div className="text-base font-black text-rose-500">{session.errors.length}</div>
                        <div className="text-[7px] font-black text-slate-400 uppercase">Errors</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default InventoryImportExport;
