# Royal ERP — Regression Test Suite

## Two test files

| File | Coverage | Requires |
|---|---|---|
| `logic-only.mjs` | Business logic, math, algorithms (22 tests) | Only Node.js |
| `regression.mjs` | Full API + DB integration (34 tests) | Live app + network |

---

## 1. Logic tests — run anywhere, anytime

```bash
node tests/logic-only.mjs
```

Tests covered:
- Stock adjustment math (adjustStock, loose normalisation)
- Damage report single vs double deduction
- P&L realised price (discount + commission apportioned per item)
- Return refund correctness (realised price, not gross rate)
- Vendor order consolidation (same vendor+date = 1 order)
- Kadapa/Granite slab numbering (SP-6.5ft-12in-1, continuation)
- Commission calculation (%, fixed, partial payment, outstanding balance)
- Tenant isolation logic

---

## 2. API integration tests — run from your machine

```bash
# Basic (uses defaults: test2shop-a626 tenant)
BASE_URL=https://pretty-stillness-production-cf79.up.railway.app \
TENANT_ID=test2shop-3622247e \
TENANT_EMAIL=admin@royal.com \
TENANT_PASSWORD=Admin@2024 \
node tests/regression.mjs

# Or against local dev server:
BASE_URL=http://localhost:3001 node tests/regression.mjs
```

Tests covered:
- Health & ping
- Login (valid + invalid + no-auth)
- Product CRUD (create, read, update, delete, tenant isolation)
- Vendor order lifecycle (create → visible in sync → delete)
- Sales invoice flow (create → sync verification)
- Referral commission agent (create → persist → delete cascade)
- Kadapa slab auto-generation
- Multi-tenant isolation (CSV import tenant scoping)

---

## Adding new tests

Add `test()` blocks inside any `describe()` in either file.  
For business logic: add to `logic-only.mjs` (no network needed, fast CI).  
For API/DB flows: add to `regression.mjs` (runs against live app).

---

## Expected results after a clean deployment

```
Logic-only: 22 pass, 0 fail
API integration: 30+ pass (API tests depend on test2shop tenant data)
```
