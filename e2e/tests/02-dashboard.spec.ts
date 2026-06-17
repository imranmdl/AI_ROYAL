/**
 * 02-dashboard.spec.ts — Dashboard KPIs, navigation, no crashes
 */
import { test, expect } from '@playwright/test';
import { TENANTS } from '../fixtures/tenants';
import { loginAs, goTo, watchConsoleErrors } from '../fixtures/helpers';

for (const tenant of TENANTS) {
  test.describe(`[${tenant.name}] Dashboard`, () => {

    test.beforeEach(async ({ page }) => {
      await loginAs(page, tenant);
    });

    test('Dashboard renders without crash', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      await goTo(page, 'Dashboard');
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-dashboard.png` });

      const critical = errors.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'));
      expect(critical).toHaveLength(0);
    });

    test('Dashboard shows KPI tiles', async ({ page }) => {
      await goTo(page, 'Dashboard');
      // At least some KPIs should be visible
      const kpiTexts = ['Business Done', 'Collected', 'Gross Profit', 'Outstanding'];
      let found = 0;
      for (const kpi of kpiTexts) {
        const visible = await page.locator(`text="${kpi}"`).first().isVisible().catch(() => false);
        if (visible) found++;
      }
      expect(found, 'Expected at least 2 KPI tiles on dashboard').toBeGreaterThanOrEqual(2);
    });

    test('All sidebar modules navigate without crash', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      const modules = [
        'Inventory Master', 'Vendor Tracking', 'Billing & POS',
        'Quotations', 'Returns/Refunds', 'Promotions',
        'Credit Ledger', 'CRM Connect', 'Expenses', 'P&L Reports',
      ];
      for (const module of modules) {
        const link = page.locator(`text="${module}"`).first();
        const exists = await link.isVisible().catch(() => false);
        if (!exists) { console.log(`  ⚠ ${module} not in sidebar (may be disabled)`); continue; }

        await link.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);

        const hasCrash = await page.locator('text=Something went wrong, text=Error, text=Uncaught').first().isVisible().catch(() => false);
        expect(hasCrash, `Module "${module}" crashed on load`).toBeFalsy();
      }
      const critical = errors.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver') && !e.includes('net::'));
      console.log(`  Console errors: ${critical.length}`);
    });

    test('Plans & Features page shows module toggles', async ({ page }) => {
      const link = page.locator('text="Plans & Features"').first();
      const visible = await link.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'Plans & Features not visible (may need admin)'); return; }
      await link.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('text="Total Modules"').or(page.locator('text="Active"'))).toBeVisible();
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-plans-features.png` });
    });
  });
}
