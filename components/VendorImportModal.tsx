/**
 * VendorImportModal.tsx
 * ─────────────────────────────────────────────────────────────────────────
 * CSV import flow INSIDE the Vendor Supply Chain page.
 *
 * Workflow:
 *  1. Upload CSV (same format as Inventory import, can also use Kadapa template)
 *  2. Preview all rows in an editable table — fix mistakes before anything is saved
 *  3. Click "Confirm & Push to Inventory + This Order" to:
 *       a. Create / update each product in inventory
 *       b. Add each row as an item in the current vendor order
 *
 * Benefits over the old flow:
 *  • Nothing goes to inventory until the user confirms
 *  • Errors are visible and fixable in the table
 *  • Direct linkage to the vendor order — no extra mapping step
 */
import React, { useState, useRef, useMemo } from 'react';
import { store } from '../store';

interface ParsedRow {
  name:          string;
  category:      string;
  brand:         string;
  size:          string;
  finishType:    string;
  heightFt:      number;
  widthFt:       number;
  purchaseRate:  number;
  sellingPrice:  number;
  stockQty:      number;   // boxes for tiles, slabs for Kadapa, units for adhesive
  sqftPerBox:    number;
  tilesPerBox:   number;
  vendorName:    string;
  orderNo:       string;
  status:        string;
  // validation
  hasError:      boolean;
  errorMsg:      string;
  isExisting:    boolean;
  existingProductId: string;
}

interface Props {
  onClose: () => void;
  vendorName: string;
  orderNo: string;
  /** Called when user confirms — returns the items to add to the vendor order */
  onConfirm: (items: {productId:string; productName:string; category:string; qty:number; purchaseRate:number; sellingPrice:number}[]) => void;
}

const inp = "w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-amber-400";
const SLAB_CATS = ['Kadapa','Granite','Marble'];
const PREFIX: Record<string,string> = { 'Single Polish':'SP','Double Polish':'DP','Big Single Polish':'DSP','Big Double Polish':'DDP','Natural':'GR' };

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let field = '', inQ = false;
  for (let i=0;i<line.length;i++) {
    if (line[i]==='"') { inQ=!inQ; continue; }
    if (line[i]===',' && !inQ) { result.push(field.trim()); field=''; continue; }
    field += line[i];
  }
  result.push(field.trim());
  return result;
}

const VendorImportModal: React.FC<Props> = ({ onClose, vendorName, orderNo, onConfirm }) => {
  const [rows, setRows]         = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [saving, setSaving]     = useState(false);
  const [result, setResult]     = useState<{created:number;updated:number;items:number}|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existingProducts = store.products || [];

  const parseFile = (file: File) => {
    setFileName(file.name); setResult(null);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return;
      const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim().replace(/\s+/g,'_'));
      const getCol = (row: string[], ...names: string[]) => {
        for (const n of names) {
          const idx = headers.indexOf(n);
          if (idx >= 0 && row[idx]) return row[idx].trim();
        }
        return '';
      };

      const parsed: ParsedRow[] = [];
      for (let i=1; i<lines.length; i++) {
        if (!lines[i].trim()) continue;
        const row = parseCsvLine(lines[i]);
        const name       = getCol(row,'product_name','name','product','product_name');
        const category   = getCol(row,'category','cat');
        const brand      = getCol(row,'brand');
        const size       = getCol(row,'size');
        const finishType = getCol(row,'finish_type','finish');
        const heightFt   = parseFloat(getCol(row,'height_(ft)','height_ft','height') || '0');
        const widthFt    = parseFloat(getCol(row,'width_(ft)','width_ft','width') || '0');
        // Support all exported column name variants:
        //   Tile CSV: "Purchase Price",  Kadapa CSV: "Purchase Rate Per Sqft"
        const purchaseRate = parseFloat(
          getCol(row,
            'purchase_price',          // Wall/Floor Tile, Adhesive, etc.
            'purchase_rate_per_sqft',  // Kadapa/Granite/Marble
            'purchase_rate',
            'purchase',
            'rate'
          ) || '0');
        // Tile CSV: "Selling Price",  Kadapa CSV: "Selling Price Per Sqft"
        const sellingPrice = parseFloat(
          getCol(row,
            'selling_price',           // Wall/Floor Tile export
            'selling_price_per_sqft',  // Kadapa/Granite
            'selling_pri',
            'selling'
          ) || '0');
        // Tile CSV: "Stock Boxes",  Kadapa CSV: "Stock Slabs",  Adhesive: "Stock"
        const stockQty = parseInt(
          getCol(row,
            'stock_boxes',   // Wall/Floor Tile
            'stock_slabs',   // Kadapa/Granite
            'stock',         // Adhesive/Grout/Tools
            'qty',
            'quantity'
          ) || '0') || 0;
        // Extra fields
        const tilesPerBox = parseInt(getCol(row,'tiles_per_box','tiles_per') || '0') || 0;
        const sqftPerBox  = parseFloat(getCol(row,'sqft_per_box','sqft_per') || '0');
        const reorderLevel = parseInt(getCol(row,'reorder_level','reorder') || '0') || 0;
        const vendorN  = getCol(row,'vendor_name','vendor');
        const oNo      = getCol(row,'order_id','order_no','order');
        const status   = getCol(row,'status') || 'Active';

        // Resolve product name for slab products: auto-generate if empty
        let finalName = name;
        if (!finalName && category && SLAB_CATS.includes(category) && heightFt && widthFt && finishType) {
          const pfx = PREFIX[finishType] || 'SP';
          finalName = `${pfx}_KDP_${heightFt}x${widthFt}`;
        }

        const hasError = !finalName.trim();
        const existing = existingProducts.find(p =>
          p.name.trim().toLowerCase() === finalName.toLowerCase() &&
          p.category?.toLowerCase() === (category||'').toLowerCase()
        );

        parsed.push({
          name: finalName, category, brand, size: size || (heightFt&&widthFt?`${heightFt}x${widthFt}`:''),
          finishType, heightFt, widthFt, purchaseRate, sellingPrice,
          stockQty, sqftPerBox, tilesPerBox,
          vendorName: vendorN || vendorName, orderNo: oNo || orderNo, status,
          hasError, errorMsg: hasError ? 'Product name missing' : '',
          isExisting: !!existing, existingProductId: existing?.id || '',
        });
      }
      setRows(parsed);
    };
    reader.readAsText(file);
  };

  const updateRow = (idx: number, key: keyof ParsedRow, val: any) => {
    setRows(p => p.map((r,i) => {
      if (i !== idx) return r;
      const updated = { ...r, [key]: val };
      // Re-validate
      updated.hasError = !updated.name.trim();
      updated.errorMsg = updated.hasError ? 'Product name is required' : '';
      const ex = existingProducts.find(p =>
        p.name.trim().toLowerCase() === updated.name.toLowerCase()
      );
      updated.isExisting = !!ex;
      updated.existingProductId = ex?.id || '';
      return updated;
    }));
  };

  const validRows  = rows.filter(r => !r.hasError);
  const errorRows  = rows.filter(r => r.hasError);
  const newRows    = validRows.filter(r => !r.isExisting);
  const updateRows = validRows.filter(r => r.isExisting);

  const handleConfirm = async () => {
    if (validRows.length === 0) return;
    setSaving(true);
    const items: any[] = [];
    let created = 0, updated = 0;

    for (const row of validRows) {
      const isSlabCat = SLAB_CATS.includes(row.category);
      const sqft = row.heightFt && row.widthFt ? Math.round(row.heightFt*row.widthFt*100)/100 : 0;
      const landedPerUnit = isSlabCat && sqft > 0 ? row.purchaseRate : row.purchaseRate;
      const sellingPerUnit = isSlabCat && sqft > 0 ? row.sellingPrice : row.sellingPrice;

      let productId = row.existingProductId;

      if (row.isExisting && productId) {
        // Update existing product
        store.updateProduct(productId, {
          purchasePrice: landedPerUnit, sellingPrice: sellingPerUnit,
          costPerSqft: row.purchaseRate, sellingPricePerSqft: row.sellingPrice,
          status: row.status as any, updatedAt: Date.now(),
        });
        updated++;
      } else {
        // Create new product
        const now = Date.now();
        productId = `prod-vendor-import-${now}-${Math.random().toString(36).substr(2,5)}`;
        const newProd = {
          id: productId, name: row.name, category: row.category as any, brand: row.brand,
          size: row.size, unitType: isSlabCat ? 'Slab' : 'Box' as any, tilesPerBox: 1,
          sqftPerBox: row.sqftPerBox || sqft || 1, tilesPerBox: row.tilesPerBox || 1, purchasePrice: landedPerUnit, sellingPrice: sellingPerUnit,
          costPerSqft: row.purchaseRate, sellingPricePerSqft: row.sellingPrice,
          totalCostPerUnit: row.purchaseRate, transportCost: 0, otherCharges: 0,
          kadapaType: row.finishType as any, grade: 'Premium' as any,
          status: row.status as any, showInGallery: true, isTile: true,
          stockBoxes: isSlabCat ? 0 : row.stockQty,
          stockLoose: 0, reorderLevel: 5,
          slabs: [], damageHistory: [], purchaseHistory: [], adjustmentLog: [],
          locationStock: store.godowns.map((g, i) => ({ godownId: g.id, boxes: i===0 && !isSlabCat ? row.stockQty : 0, loose: 0 })),
          images: [],
          updatedAt: now,
        };
        store.addProduct(newProd as any);
        created++;
      }

      items.push({
        productId, productName: row.name, category: row.category,
        qty: row.stockQty || 1, purchaseRate: row.purchaseRate, sellingPrice: row.sellingPrice,
        sqftPerBox: row.sqftPerBox, tilesPerBox: row.tilesPerBox,
      });
    }

    setResult({ created, updated, items: items.length });
    setSaving(false);
    // Slight delay so user sees result, then close
    setTimeout(() => { onConfirm(items); }, 1800);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[700] flex flex-col" onClick={onClose}>
      <div className="flex-1 overflow-y-auto flex items-start justify-center p-4 pt-8" onClick={e=>e.stopPropagation()}>
        <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-5xl">
          {/* Header */}
          <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-black uppercase italic tracking-tighter flex items-center gap-2">
                <i className="fas fa-file-import text-amber-500"></i> Import Items to Vendor Order
              </h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                Review every item before confirming — nothing goes to inventory until you click Confirm
              </p>
              <div className="flex gap-3 mt-2">
                <span className="text-[9px] font-black bg-amber-50 text-amber-700 px-3 py-1 rounded-full border border-amber-100">
                  <i className="fas fa-truck text-[8px] mr-1"></i>{vendorName || 'Vendor not set'}
                </span>
                {orderNo && <span className="text-[9px] font-black bg-purple-50 text-purple-700 px-3 py-1 rounded-full border border-purple-100">
                  Order #{orderNo}
                </span>}
              </div>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 flex items-center justify-center">
              <i className="fas fa-times text-xs"></i>
            </button>
          </div>

          <div className="p-8 space-y-6">
            {/* Upload */}
            {rows.length === 0 && (
              <div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e=>{if(e.target.files?.[0])parseFile(e.target.files[0]);}}/>
                <button onClick={()=>fileRef.current?.click()}
                  className="w-full py-12 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 hover:border-amber-400 hover:text-amber-500 transition-all flex flex-col items-center gap-3">
                  <i className="fas fa-file-csv text-4xl"></i>
                  <div className="font-black text-sm">Drop CSV file here or click to browse</div>
                  <div className="text-[10px] font-bold">Supports Inventory CSV · Kadapa template · any standard format</div>
                </button>
              </div>
            )}

            {rows.length > 0 && !result && (
              <>
                {/* File + stats bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <i className="fas fa-file-csv text-emerald-500"></i>
                    <span className="font-bold text-sm">{fileName}</span>
                    <span className="text-[9px] font-black text-slate-400">{rows.length} rows</span>
                  </div>
                  <div className="flex gap-2 text-[9px] font-black">
                    <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full">{newRows.length} new</span>
                    <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full">{updateRows.length} updates</span>
                    {errorRows.length > 0 && <span className="bg-rose-50 text-rose-700 px-3 py-1 rounded-full">{errorRows.length} errors</span>}
                  </div>
                  <button onClick={()=>{setRows([]);setFileName('');}} className="text-[9px] font-black text-slate-400 hover:text-slate-700">
                    <i className="fas fa-times mr-1"></i>Clear & re-upload
                  </button>
                </div>

                {/* Editable preview table */}
                <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          {['#','Product Name','Category','Size','Sqft/Box','Qty/Boxes','Purchase ₹','Selling ₹','Vendor Name','Status','⚠'].map(h=>(
                            <th key={h} className="px-3 py-2.5 text-left text-[8px] font-black text-slate-400 uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {rows.map((r,idx)=>(
                          <tr key={idx} className={`${r.hasError?'bg-rose-50/60':r.isExisting?'bg-blue-50/30':'hover:bg-slate-50/50'}`}>
                            <td className="px-3 py-2 text-slate-400 font-bold">{idx+1}</td>
                            <td className="px-2 py-1.5 min-w-[160px]">
                              <input className={inp + (r.hasError?' border-rose-300 bg-rose-50':'')}
                                value={r.name} onChange={e=>updateRow(idx,'name',e.target.value)}/>
                              {r.isExisting && <div className="text-[8px] text-blue-600 font-black mt-0.5">↑ Will update existing</div>}
                            </td>
                            <td className="px-2 py-1.5 min-w-[100px]">
                              <input className={inp} value={r.category} onChange={e=>updateRow(idx,'category',e.target.value)}/>
                            </td>
                            <td className="px-2 py-1.5 min-w-[100px]">
                              <input className={inp} value={r.size||r.finishType} onChange={e=>updateRow(idx,'size',e.target.value)} placeholder="size or finish"/>
                            </td>
                            <td className="px-2 py-1.5 w-16 text-center text-[10px] font-bold text-slate-500">
                              {r.sqftPerBox > 0 ? r.sqftPerBox : '—'}
                            </td>
                            <td className="px-2 py-1.5 w-20">
                              <input type="number" className={inp + ' text-center font-black'} value={r.stockQty||''} onChange={e=>updateRow(idx,'stockQty',+e.target.value)} placeholder="0"/>
                            </td>
                            <td className="px-2 py-1.5 w-20">
                              <input type="number" className={inp} value={r.purchaseRate||''} onChange={e=>updateRow(idx,'purchaseRate',+e.target.value)} placeholder="0"/>
                            </td>
                            <td className="px-2 py-1.5 w-20">
                              <input type="number" className={inp + ' bg-emerald-50 border-emerald-200'} value={r.sellingPrice||''} onChange={e=>updateRow(idx,'sellingPrice',+e.target.value)} placeholder="0"/>
                            </td>
                            <td className="px-2 py-1.5 w-28 text-[10px] font-bold text-slate-600">
                              {r.vendorName || <span className="text-amber-500">—</span>}
                            </td>
                            <td className="px-2 py-1.5 w-20">
                              <select className={inp} value={r.status} onChange={e=>updateRow(idx,'status',e.target.value)}>
                                <option>Active</option><option>Inactive</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              {r.hasError
                                ? <span className="text-rose-500 text-[8px] font-black flex items-center gap-1"><i className="fas fa-exclamation-circle"></i>{r.errorMsg}</span>
                                : <i className="fas fa-check-circle text-emerald-400 text-xs"></i>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {errorRows.length > 0 && (
                  <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-[10px] font-bold">
                    <i className="fas fa-exclamation-triangle mr-2"></i>
                    {errorRows.length} row(s) have errors (highlighted in red). Fix them or they will be skipped.
                  </div>
                )}

                {/* Data sanity check */}
                {(() => {
                  const missingRate = validRows.filter(r=>!r.purchaseRate).length;
                  const missingQty  = validRows.filter(r=>!r.stockQty).length;
                  if (missingRate === 0 && missingQty === 0) return null;
                  return (
                    <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[10px] font-bold space-y-1">
                      <div className="flex items-center gap-2 font-black"><i className="fas fa-exclamation-triangle text-amber-500"></i>Data check before confirming:</div>
                      {missingRate > 0 && <div>• {missingRate} row(s) have Purchase Rate = 0 — verify column mapping</div>}
                      {missingQty > 0 && <div>• {missingQty} row(s) have Qty/Boxes = 0 — they will be added with qty 1</div>}
                    </div>
                  );
                })()}

                {/* Confirm button */}
                <button onClick={handleConfirm} disabled={validRows.length===0||saving}
                  className="w-full py-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-2xl font-black text-sm uppercase transition-all flex items-center justify-center gap-3">
                  {saving ? <><i className="fas fa-spinner fa-spin"></i>Saving…</> :
                    <><i className="fas fa-check-double"></i>
                      Confirm &amp; Push {validRows.length} Items → Inventory + Vendor Order</>}
                </button>
              </>
            )}

            {/* Result */}
            {result && (
              <div className="text-center py-10 space-y-4">
                <i className="fas fa-check-circle text-5xl text-emerald-500"></i>
                <div className="font-black text-2xl text-slate-900">Import Complete</div>
                <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto">
                  <div className="bg-emerald-50 rounded-2xl p-4">
                    <div className="text-2xl font-black text-emerald-600">{result.created}</div>
                    <div className="text-[9px] font-black text-slate-400 uppercase">Created</div>
                  </div>
                  <div className="bg-blue-50 rounded-2xl p-4">
                    <div className="text-2xl font-black text-blue-600">{result.updated}</div>
                    <div className="text-[9px] font-black text-slate-400 uppercase">Updated</div>
                  </div>
                  <div className="bg-amber-50 rounded-2xl p-4">
                    <div className="text-2xl font-black text-amber-600">{result.items}</div>
                    <div className="text-[9px] font-black text-slate-400 uppercase">Added to Order</div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 font-bold">Items have been added to the vendor order. Closing…</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorImportModal;
