# Royal ERP — UI Automation Test Suite

End-to-end tests using **Playwright** — covers all ERP modules across multiple tenants.

---

## Quick Start (run from your machine)

```bash
# 1. Clone / pull latest code
git pull origin main

# 2. One-time setup (installs Playwright + Chromium)
node e2e/setup.mjs

# 3. Run all tests against live app
npm run e2e
```

### All run commands

| Command | What it does |
|---|---|
| `npm run e2e` | All tests, all tenants, headless |
| `npm run e2e:ui` | Playwright interactive UI (see tests live) |
| `npm run e2e:headed` | Visible browser window |
| `TENANT=royal-mudhol npm run e2e` | Only one tenant |
| `npm run e2e:report` | Open last HTML report |

---

## Test files

| File | Coverage |
|---|---|
| `tests/01-auth.spec.ts` | Login, wrong password, tenant slug, sidebar modules |
| `tests/02-dashboard.spec.ts` | Dashboard KPIs, all module navigation (no-crash check), Plans & Features |
| `tests/03-inventory.spec.ts` | Product CRUD, Kadapa slab/unit auto-set, Bulk Mode hidden, CSV export |
| `tests/04-sales.spec.ts` | Billing & POS, product search, empty cart guard, referral agent picker |
| `tests/05-vendor.spec.ts` | Vendor page, New Order, invoice mode toggle, Slab Inward modal |
| `tests/06-quotations-pnl-commission.spec.ts` | Quotations, P&L Reports (sale crash regression), Collections, Referral Commission |
| `tests/07-remaining-modules.spec.ts` | Returns, Promotions, Credit, CRM, Expenses, Staff, System, Plans & Features, multi-tenant isolation |

---

## Multi-tenant configuration

Edit `e2e/fixtures/tenants.ts` to add/edit tenants:

```ts
export const TENANTS: Tenant[] = [
  {
    name: 'Royal Mudhol',
    slug: 'royal-mudhol',
    tenantId: 'royal-mudhol-d81d2d03',
    email: 'admin@royal.com',
    password: 'Admin@2024',
  },
  // Add more tenants here...
];
```

Each test automatically runs for every configured tenant.

---

## CI / GitHub Actions integration

Add to `.github/workflows/e2e.yml`:

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: node e2e/setup.mjs
      - run: npm run e2e
        env:
          BASE_URL: https://pretty-stillness-production-cf79.up.railway.app
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: test-reports/
```

---

## Key regression tests (bugs we fixed — covered by tests)

| Bug Fixed | Test |
|---|---|
| P&L crash: `sale is not defined` | `06` → "P&L Reports loads without crash" |
| `showExtraCharges is not defined` crash | `07` → "System Architecture must not crash" |
| Finalize button submits multiple invoices | `04` → "Finalize button is disabled when cart is empty" |
| Bulk Mode shown for Kadapa (should hide) | `03` → "Bulk mode hidden for Kadapa category" |
| Kadapa unit not auto-set to Slab | `03` → "Kadapa auto-sets Unit to Slab" |
| Invoice mode toggle hides panels | `05` → "Billing Only mode hides Actual Invoice panel" |
| Slab Inward button accessible from vendor | `05` → "Slab Inward button visible in Items tab" |
| Plans & Features toggles work | `07` → "Plans & Features toggles work" |

---

## Output

- **Screenshots**: `test-results/screenshots/<tenant-slug>-<module>.png`
- **HTML Report**: `test-reports/html/index.html` (open with `npm run e2e:report`)
- **Videos** (on failure): `test-results/` directory
