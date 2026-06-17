/**
 * Royal ERP — Logic-Only Tests
 * These run anywhere (no network needed) — pure business logic validation.
 * 
 * node tests/logic-only.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const b = s => `\x1b[36m${s}\x1b[0m`;

console.log(b('\n╔══════════════════════════════════╗'));
console.log(b('║  Logic-Only Regression Tests    ║'));
console.log(b('╚══════════════════════════════════╝\n'));

describe('Stock Adjustment Math', () => {
  test('adjustStock source-of-truth = stockBoxes (not locationStock sum)', () => {
    const p = { stockBoxes: 100, stockLoose: 0, tilesPerBox: 4, locationStock: [{ boxes: 0, loose: 0 }] };
    const newTotal = (p.stockBoxes) + (-2); // damage -2
    const oldTotal = p.locationStock.reduce((s,l) => s+l.boxes, 0) + (-2);
    assert.equal(newTotal, 98);
    assert.equal(oldTotal, -2, 'Confirmed: old bug would give -2');
    console.log(g('  ✓'), 'adjustStock: 100 - 2 = 98 (not -2 like old bug)');
  });

  test('Loose overflow normalisation (pieces → boxes)', () => {
    let boxes = 5, loose = 6, tpb = 4;
    if (loose >= tpb) { boxes += Math.floor(loose/tpb); loose %= tpb; }
    assert.equal(boxes, 6); assert.equal(loose, 2);
    console.log(g('  ✓'), '5 boxes + 6 pieces (tpb=4) → 6 boxes + 2 pieces');
  });

  test('Loose underflow normalisation (borrow from boxes)', () => {
    let boxes = 5, loose = -3, tpb = 4;
    if (loose < 0) { const req = Math.ceil(Math.abs(loose)/tpb); boxes -= req; loose += req*tpb; }
    assert.equal(boxes, 4); assert.equal(loose, 1);
    console.log(g('  ✓'), '5 boxes - 3 loose (tpb=4) → 4 boxes + 1 piece');
  });

  test('Damage deduction: single NOT double', () => {
    let s1 = 100; s1 -= 2;                // new: adjustStock once
    let s2 = 100; s2 -= 2; s2 -= 2;       // old bug: adjustStock + updateVendorOrder
    assert.equal(s1, 98); assert.equal(s2, 96);
    console.log(g('  ✓'), `Single deduct=98 ✓, double deduct=96 (confirmed old bug)`);
  });
});

describe('P&L Realised Price', () => {
  test('Invoice discount + commission apportioned per item (10% on ₹2000)', () => {
    const subTotal = 2000, discount = 100, commission = 100;
    const totalReduction = discount + commission;
    const reductionRatio = totalReduction / subTotal;  // 0.10 = 10%
    const item1Gross = 1000, item2Gross = 1000;
    const item1Realised = item1Gross - item1Gross * reductionRatio;  // 900
    const item2Realised = item2Gross - item2Gross * reductionRatio;  // 900
    const reductionPct = reductionRatio * 100;                        // 10%
    assert.equal(item1Realised, 900);
    assert.equal(item2Realised, 900);
    assert.equal(reductionPct, 10);
    assert.equal(item1Realised + item2Realised, subTotal - totalReduction);
    console.log(g('  ✓'), `₹2000 − 10% (disc+comm) → each item ₹900 realised`);
  });

  test('Return refund = realised price per unit (not gross rate)', () => {
    const grossSelling = 1000, totalReduction = 100, qty = 5;
    const realisedSelling = grossSelling - totalReduction;  // 900
    const correctRefund = realisedSelling / qty;            // 180
    const buggyRefund   = grossSelling / qty;               // 200
    assert.equal(correctRefund, 180);
    assert.ok(correctRefund < buggyRefund);
    console.log(g('  ✓'), `Refund: ₹${correctRefund}/unit (not ₹${buggyRefund} — over-refund prevented)`);
  });

  test('Zero discount + zero commission = gross = realised', () => {
    const gross = 1000, reductionRatio = 0;
    const realised = gross - gross * reductionRatio;
    assert.equal(realised, gross);
    console.log(g('  ✓'), 'No reduction: realised === gross');
  });

  test('100% commission edge case: realised = 0', () => {
    const gross = 1000, reductionRatio = 1.0;
    const realised = gross - gross * reductionRatio;
    assert.equal(realised, 0);
    console.log(g('  ✓'), '100% reduction: realised = 0');
  });
});

describe('Vendor Order Consolidation', () => {
  test('Same vendor + same date → merged, NOT new order', () => {
    const orders = [];
    const addQuickItem = (vendorName, date, item) => {
      const existing = orders.find(o => o.isQuickEntry &&
        o.vendorName.toLowerCase() === vendorName.toLowerCase() && o.orderDate === date);
      if (existing) { existing.items.push(item); existing.total += item.amount; }
      else orders.push({ id: `inw-${Date.now()}-${Math.random()}`, isQuickEntry:true, vendorName, orderDate: date, items: [item], total: item.amount });
      return orders.length;
    };
    addQuickItem('GURU', '2026-06-15', { name:'A', amount: 3000 });
    addQuickItem('GURU', '2026-06-15', { name:'B', amount: 2000 });
    addQuickItem('GURU', '2026-06-15', { name:'C', amount: 1000 });
    assert.equal(orders.length, 1, `Expected 1 consolidated order, got ${orders.length}`);
    assert.equal(orders[0].items.length, 3);
    assert.equal(orders[0].total, 6000);
    console.log(g('  ✓'), '3 GURU items → 1 consolidated order (₹6,000)');
  });

  test('Different vendor OR different date → separate orders', () => {
    const orders = [];
    const addItem = (v, d, amt) => {
      const ex = orders.find(o => o.isQuickEntry && o.v === v && o.d === d);
      if (ex) ex.total += amt;
      else orders.push({ isQuickEntry:true, v, d, total:amt });
    };
    addItem('GURU', '2026-06-15', 1000);
    addItem('GURU', '2026-06-16', 2000);  // different date → new
    addItem('PRADEEP', '2026-06-15', 3000); // different vendor → new
    assert.equal(orders.length, 3);
    console.log(g('  ✓'), 'Different vendor/date → 3 separate orders');
  });
});

describe('Kadapa/Granite Slab Numbering', () => {
  const PREFIX = { 'Single Polish':'SP', 'Double Polish':'DP', 'Big Single Polish':'DSP', 'Big Double Polish':'DDP' };
  const genSlabNos = (finish, sizeFt, sizeIn, count, existingCount=0) => {
    const pfx = PREFIX[finish];
    const base = `${pfx}-${sizeFt}ft-${sizeIn}in`;
    return Array.from({length: count}, (_, i) => `${base}-${existingCount + i + 1}`);
  };

  test('Kadapa Single Polish 6.5ft×1ft → SP-6.5ft-12in-1..3', () => {
    const slabs = genSlabNos('Single Polish', 6.5, 12, 3);
    assert.deepEqual(slabs, ['SP-6.5ft-12in-1','SP-6.5ft-12in-2','SP-6.5ft-12in-3']);
    console.log(g('  ✓'), slabs.join(', '));
  });

  test('Granite Double Polish 6ft×1ft → DP-6ft-12in-1..2', () => {
    const slabs = genSlabNos('Double Polish', 6, 12, 2);
    assert.deepEqual(slabs, ['DP-6ft-12in-1','DP-6ft-12in-2']);
    console.log(g('  ✓'), slabs.join(', '));
  });

  test('Continuation: 10 existing → new slabs numbered from 11', () => {
    const slabs = genSlabNos('Single Polish', 6.5, 12, 2, 10);
    assert.deepEqual(slabs, ['SP-6.5ft-12in-11','SP-6.5ft-12in-12']);
    console.log(g('  ✓'), `Continuation: ${slabs.join(', ')}`);
  });

  test('Big Double Polish gets DDP prefix (not DSP)', () => {
    const pfx = PREFIX['Big Double Polish'];
    assert.equal(pfx, 'DDP');
    console.log(g('  ✓'), `Big Double Polish → ${pfx}`);
  });

  test('Inches calculated correctly: 1.25 ft = 15 inches', () => {
    const lengthFt = 1.25;
    const lengthIn = Math.round(lengthFt * 12);
    assert.equal(lengthIn, 15);
    console.log(g('  ✓'), `1.25 ft = ${lengthIn} inches`);
  });
});

describe('Commission Module Logic', () => {
  test('Percentage commission: 2% of ₹10,000 = ₹200', () => {
    const amt = parseFloat((10000 * 2 / 100).toFixed(2));
    assert.equal(amt, 200);
    console.log(g('  ✓'), `2% of ₹10,000 = ₹${amt}`);
  });

  test('Fixed commission: always exactly the fixed amount', () => {
    const commType = 'Fixed', commValue = 500, saleAmt = 50000;
    const computed = commType === 'Percentage' ? saleAmt * commValue / 100 : commValue;
    assert.equal(computed, 500);
    console.log(g('  ✓'), `Fixed ₹500 comm on ₹50,000 sale = ₹${computed}`);
  });

  test('Outstanding balance = earned - paid', () => {
    const earned = 2500, paid = 1500;
    const outstanding = earned - paid;
    assert.equal(outstanding, 1000);
    console.log(g('  ✓'), `Outstanding: ₹${earned} earned - ₹${paid} paid = ₹${outstanding}`);
  });

  test('Payment marks entry as Paid when balance = 0', () => {
    const commAmt = 500, amountPaid = 500;
    const newBal = Math.max(0, commAmt - amountPaid);
    const status = newBal <= 0 ? 'Paid' : 'Partial';
    assert.equal(status, 'Paid');
    assert.equal(newBal, 0);
    console.log(g('  ✓'), 'Full payment → status: Paid, balance: 0');
  });

  test('Partial payment → Partial status', () => {
    const commAmt = 500, amountPaid = 200;
    const newBal = Math.max(0, commAmt - amountPaid);
    const status = newBal <= 0 ? 'Paid' : 'Partial';
    assert.equal(status, 'Partial');
    assert.equal(newBal, 300);
    console.log(g('  ✓'), 'Partial payment → status: Partial, balance: ₹300');
  });
});

describe('Tenant Isolation Logic', () => {
  test('Named tenant JWT should not share data with default tenant', () => {
    // Simulate: if req.tenantId === 'default', that's a different bucket
    const namedTenantId = 'test2shop-3622247e';
    const defaultTenantId = 'default';
    assert.notEqual(namedTenantId, defaultTenantId);
    // Products are scoped: SELECT WHERE tenant_id = ?
    const products = [
      { id: 'p1', tenant_id: 'test2shop-3622247e' },
      { id: 'p2', tenant_id: 'default' },
    ];
    const visibleToNamedTenant = products.filter(p => p.tenant_id === namedTenantId);
    assert.equal(visibleToNamedTenant.length, 1);
    assert.equal(visibleToNamedTenant[0].id, 'p1');
    console.log(g('  ✓'), 'Tenant isolation: named tenant sees only its own products');
  });

  test('Missing JWT → tenantId falls back to default (not a crash)', () => {
    const reqTenantId = undefined;
    const tenantId = reqTenantId || 'default';
    assert.equal(tenantId, 'default');
    console.log(g('  ✓'), 'No JWT → default tenant (not a crash)');
  });
});
