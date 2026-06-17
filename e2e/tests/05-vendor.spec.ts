/**
 * 05-vendor.spec.ts — Vendor Supply Chain, invoice modes, slab inward
 */
import { test, expect } from '@playwright/test';
import { TENANTS } from '../fixtures/tenants';
import { loginAs, goTo, testData, watchConsoleErrors } from '../fixtures/helpers';

for (const tenant of TENANTS) {
  test.describe(`[${tenant.name}] Vendor Supply Chain`, () => {

    test.beforeEach(async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'Vendor Tracking');
      await page.waitForLoadState('networkidle');
    });

    test('Vendor Tracking page loads without crash', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-vendor.png` });
      const hasCrash = await page.locator('text=Uncaught, text=TypeError').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });

    test('New Purchase Order form opens', async ({ page }) => {
      const newOrderBtn = page.locator('button:has-text("New Order"), button:has-text("Create Order"), button:has-text("New Purchase")').first();
      const visible = await newOrderBtn.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'New Order button not found'); return; }

      await newOrderBtn.click();
      await page.waitForLoadState('networkidle');

      const vendorInput = page.locator('input[placeholder*="Vendor Name"], input[placeholder*="vendor"]').first();
      await expect(vendorInput).toBeVisible({ timeout: 8_000 });
      await vendorInput.fill(testData.vendorName());
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-vendor-new-order.png` });
    });

    test('Invoice mode toggle renders 3 options', async ({ page }) => {
      const newOrderBtn = page.locator('button:has-text("New Order"), button:has-text("Create Order")').first();
      const visible = await newOrderBtn.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'New Order button not found'); return; }

      await newOrderBtn.click();
      await page.waitForLoadState('networkidle');

      // Navigate to Invoices tab
      const invoiceTab = page.locator('button:has-text("Invoices"), text="Invoices"').first();
      if (await invoiceTab.isVisible()) {
        await invoiceTab.click();
        await page.waitForTimeout(400);

        // Invoice mode toggle should be visible
        for (const mode of ['Billing Only', 'Actual Only', 'Both Invoices']) {
          const btn = page.locator(`button:has-text("${mode}"), text="${mode}"`).first();
          const isModeVisible = await btn.isVisible().catch(() => false);
          expect(isModeVisible, `Invoice mode "${mode}" should be visible`).toBeTruthy();
        }
        await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-vendor-invoice-mode.png` });
      }
    });

    test('Billing Only mode hides Actual Invoice panel', async ({ page }) => {
      const newOrderBtn = page.locator('button:has-text("New Order"), button:has-text("Create Order")').first();
      const visible = await newOrderBtn.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'No Order button'); return; }
      await newOrderBtn.click();
      await page.waitForLoadState('networkidle');

      const invoiceTab = page.locator('button:has-text("Invoices"), text="Invoices"').first();
      if (await invoiceTab.isVisible()) {
        await invoiceTab.click();
        await page.waitForTimeout(300);

        const billingOnlyBtn = page.locator('button:has-text("Billing Only")').first();
        if (await billingOnlyBtn.isVisible()) {
          await billingOnlyBtn.click();
          await page.waitForTimeout(300);
          const actualPanel = page.locator('text="Actual / Dispatch Invoice"');
          const isActualHidden = !await actualPanel.isVisible().catch(() => true);
          expect(isActualHidden, 'Actual invoice panel should hide in Billing Only mode').toBeTruthy();
        }
      }
    });

    test('Slab Inward button visible in Items tab', async ({ page }) => {
      const newOrderBtn = page.locator('button:has-text("New Order"), button:has-text("Create Order")').first();
      const visible = await newOrderBtn.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'No Order button'); return; }
      await newOrderBtn.click();
      await page.waitForLoadState('networkidle');

      const itemsTab = page.locator('button:has-text("Items"), text="Items"').first();
      if (await itemsTab.isVisible()) {
        await itemsTab.click();
        await page.waitForTimeout(300);
        const slabBtn = page.locator('text="Kadapa / Granite / Marble Slab", button:has-text("Slab")').first();
        await expect(slabBtn).toBeVisible({ timeout: 5_000 });
        await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-vendor-slab-btn.png` });
      }
    });

    test('Slab Inward Modal opens correctly', async ({ page }) => {
      const newOrderBtn = page.locator('button:has-text("New Order"), button:has-text("Create Order")').first();
      const visible = await newOrderBtn.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'No Order button'); return; }
      await newOrderBtn.click();
      await page.waitForLoadState('networkidle');

      const itemsTab = page.locator('button:has-text("Items"), text="Items"').first();
      if (await itemsTab.isVisible()) {
        await itemsTab.click();
        await page.waitForTimeout(300);
        const slabBtn = page.locator('text="Kadapa / Granite / Marble Slab"').first();
        if (await slabBtn.isVisible()) {
          await slabBtn.click();
          await page.waitForTimeout(500);
          await expect(page.locator('text="Slab Inward"').first()).toBeVisible();
          await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-slab-inward-modal.png` });
        }
      }
    });
  });
}
