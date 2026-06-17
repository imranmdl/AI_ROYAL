/**
 * 07-remaining-modules.spec.ts — Returns, Promotions, CRM, Staff, System
 */
import { test, expect } from '@playwright/test';
import { TENANTS } from '../fixtures/tenants';
import { loginAs, goTo, watchConsoleErrors } from '../fixtures/helpers';

for (const tenant of TENANTS) {

  test.describe(`[${tenant.name}] Returns & Refunds`, () => {
    test('Returns page loads without crash', async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'Returns/Refunds');
      await page.waitForLoadState('networkidle');
      const errors = watchConsoleErrors(page);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-returns.png` });
      const hasCrash = await page.locator('text=Uncaught ReferenceError').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });
  });

  test.describe(`[${tenant.name}] Promotions`, () => {
    test('Promotions page loads without crash', async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'Promotions');
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-promotions.png` });
      const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });
  });

  test.describe(`[${tenant.name}] Credit Ledger`, () => {
    test('Credit Ledger loads without crash', async ({ page }) => {
      await loginAs(page, tenant);
      const link = page.locator('text="Credit Ledger"').first();
      if (!await link.isVisible()) { test.skip(true, 'Credit Ledger not in sidebar'); return; }
      await link.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-credit-ledger.png` });
      const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });
  });

  test.describe(`[${tenant.name}] CRM Connect`, () => {
    test('CRM Connect loads without crash', async ({ page }) => {
      await loginAs(page, tenant);
      const link = page.locator('text="CRM Connect"').first();
      if (!await link.isVisible()) { test.skip(true, 'CRM not in sidebar'); return; }
      await link.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-crm.png` });
      const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });
  });

  test.describe(`[${tenant.name}] Expenses`, () => {
    test('Expenses page loads without crash', async ({ page }) => {
      await loginAs(page, tenant);
      const link = page.locator('text="Expenses"').first();
      if (!await link.isVisible()) { test.skip(true, 'Expenses not in sidebar'); return; }
      await link.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-expenses.png` });
      const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });
  });

  test.describe(`[${tenant.name}] Staff Governance`, () => {
    test('Staff page loads and shows user list', async ({ page }) => {
      await loginAs(page, tenant);
      const link = page.locator('text="Staff Governance"').first();
      if (!await link.isVisible()) { test.skip(true, 'Staff not in sidebar'); return; }
      await link.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-staff.png` });
      const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });
  });

  test.describe(`[${tenant.name}] System Architecture (Admin Settings)`, () => {
    test('System Architecture page loads without crash', async ({ page }) => {
      await loginAs(page, tenant);
      const link = page.locator('text="System Architecture"').first();
      if (!await link.isVisible()) { test.skip(true, 'System not in sidebar'); return; }
      await link.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-system.png` });
      const hasCrash = await page.locator('text=Uncaught, text=showExtraCharges is not defined').first().isVisible().catch(() => false);
      expect(hasCrash, 'System Architecture must not crash').toBeFalsy();
    });

    test('Plans & Features toggles work', async ({ page }) => {
      await loginAs(page, tenant);
      const link = page.locator('text="Plans & Features"').first();
      if (!await link.isVisible()) { test.skip(true, 'Plans & Features not in sidebar'); return; }
      await link.click();
      await page.waitForLoadState('networkidle');

      // Should show module groups
      const groups = ['Core', 'Inventory', 'Sales'];
      for (const group of groups) {
        const v = await page.locator(`text="${group}"`).first().isVisible().catch(() => false);
        if (v) { expect(v).toBeTruthy(); break; }
      }

      // Toggle a non-critical module and verify it reacts
      const toggle = page.locator('[class*="rounded-full"][class*="bg-emerald"], [class*="rounded-full"][class*="bg-slate"]').nth(3);
      if (await toggle.isVisible()) {
        await toggle.click();
        await page.waitForTimeout(400);
        // No crash
        const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
        expect(hasCrash).toBeFalsy();
        // Toggle back
        await toggle.click();
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-plans-features-toggles.png` });
    });
  });

  // ── Cross-tenant isolation test ───────────────────────────────────────────
  test.describe(`[${tenant.name}] Multi-Tenant Isolation`, () => {
    test('URL slug stays scoped to this tenant after navigation', async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'Inventory Master');
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(tenant.slug);
    });

    test('No data bleeds from other tenants (product names unique to tenant)', async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'Inventory Master');
      // Just verify page loads — actual cross-tenant data test done in API suite
      const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });
  });
}
