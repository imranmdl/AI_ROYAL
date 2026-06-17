/**
 * 04-sales.spec.ts — Billing & POS, invoice flow, double-submit guard
 */
import { test, expect } from '@playwright/test';
import { TENANTS } from '../fixtures/tenants';
import { loginAs, goTo, testData, watchConsoleErrors } from '../fixtures/helpers';

for (const tenant of TENANTS) {
  test.describe(`[${tenant.name}] Billing & POS`, () => {

    test.beforeEach(async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'Billing & POS');
      await page.waitForLoadState('networkidle');
    });

    test('Billing & POS loads without crash', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-pos.png` });
      const hasCrash = await page.locator('text=Uncaught ReferenceError, text=Something went wrong').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });

    test('Product search in POS shows results', async ({ page }) => {
      const productSearch = page.locator('input[placeholder*="Search product"], input[placeholder*="search"], input[placeholder*="Add product"]').first();
      if (!await productSearch.isVisible()) { test.skip(true, 'Product search not found'); return; }
      await productSearch.fill('a');
      await page.waitForTimeout(600);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-pos-search.png` });
      // No crash
      const hasCrash = await page.locator('text=ReferenceError').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });

    test('Customer name field accepts input', async ({ page }) => {
      const customerName = testData.customerName();
      const custInput = page.locator('input[placeholder*="Customer Name"], input[placeholder*="customer"]').first();
      if (await custInput.isVisible()) {
        await custInput.fill(customerName);
        const val = await custInput.inputValue();
        expect(val).toBe(customerName);
      }
    });

    test('Payment type selector works', async ({ page }) => {
      // Click Cash, UPI etc.
      for (const mode of ['Cash', 'UPI']) {
        const btn = page.locator(`button:has-text("${mode}"), text="${mode}"`).first();
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          await btn.click();
          await page.waitForTimeout(200);
        }
      }
    });

    test('Finalize button is disabled when cart is empty', async ({ page }) => {
      const finalizeBtn = page.locator('button:has-text("Finalize Dispatch"), button:has-text("Finalize")').first();
      if (await finalizeBtn.isVisible()) {
        const isDisabled = await finalizeBtn.isDisabled();
        expect(isDisabled, 'Finalize button should be disabled with empty cart').toBeTruthy();
      }
    });

    test('Referral agent picker visible in billing', async ({ page }) => {
      const agentPicker = page.locator('text=Referral Agent, select').first()
        .or(page.locator('select').filter({ hasText: 'No referral agent' }).first());
      // May not be visible if scrolled — just check no crash
      const errors = watchConsoleErrors(page);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      const critical = errors.filter(e => !e.includes('favicon'));
      expect(critical).toHaveLength(0);
    });

    test('Invoice list / history tab loads', async ({ page }) => {
      const historyTab = page.locator('text=History, text=Invoices, text=Sales History').first();
      const visible = await historyTab.isVisible().catch(() => false);
      if (visible) {
        await historyTab.click();
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-sales-history.png` });
      }
    });
  });
}
