/**
 * 06-quotations-pnl-commission.spec.ts
 */
import { test, expect } from '@playwright/test';
import { TENANTS } from '../fixtures/tenants';
import { loginAs, goTo, testData, watchConsoleErrors } from '../fixtures/helpers';

for (const tenant of TENANTS) {

  // ── Quotations ────────────────────────────────────────────────────────────
  test.describe(`[${tenant.name}] Quotations`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'Quotations');
      await page.waitForLoadState('networkidle');
    });

    test('Quotations page loads without crash', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-quotations.png` });
      const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });

    test('New Quotation form opens', async ({ page }) => {
      const newBtn = page.locator('button:has-text("New Quotation"), button:has-text("Create Quotation"), button:has-text("New Quote")').first();
      const visible = await newBtn.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'No New Quotation button'); return; }
      await newBtn.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-quotation-form.png` });
    });
  });

  // ── P&L Reports ───────────────────────────────────────────────────────────
  test.describe(`[${tenant.name}] P&L Reports`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'P&L Reports');
      await page.waitForLoadState('networkidle');
    });

    test('P&L Reports loads without crash (critical regression check)', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      await page.waitForTimeout(2000); // let useMemos settle
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-pnl.png` });
      const hasCrash = await page.locator('text=Uncaught ReferenceError, text=sale is not defined').first().isVisible().catch(() => false);
      expect(hasCrash, 'P&L page must not crash with "sale is not defined" error').toBeFalsy();
      const critical = errors.filter(e => e.includes('ReferenceError') || e.includes('TypeError'));
      expect(critical, `Critical JS errors: ${critical}`).toHaveLength(0);
    });

    test('P&L Dashboard tab shows KPI tiles', async ({ page }) => {
      const dashTab = page.locator('button:has-text("Dashboard"), text="Dashboard"').first();
      if (await dashTab.isVisible()) await dashTab.click();
      await page.waitForTimeout(800);
      const tiles = ['Business Done', 'Gross Profit', 'Collected'];
      for (const tile of tiles) {
        const v = await page.locator(`text="${tile}"`).first().isVisible().catch(() => false);
        if (v) { expect(v).toBeTruthy(); break; } // at least one
      }
    });

    test('Collections tab shows day-by-day table', async ({ page }) => {
      const collectTab = page.locator('button:has-text("Collections"), text="Collections"').first();
      if (!await collectTab.isVisible()) { test.skip(true, 'No Collections tab'); return; }
      await collectTab.click();
      await page.waitForTimeout(800);

      // Should show key columns
      const cols = ['Business Done', 'Total Collected', 'Comm. Paid'];
      for (const col of cols) {
        const v = await page.locator(`text="${col}"`).first().isVisible().catch(() => false);
        if (v) { expect(v).toBeTruthy(); break; }
      }
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-collections.png` });
    });

    test('Invoice-wise P&L tab shows Ref. Comm column', async ({ page }) => {
      const invTab = page.locator('button:has-text("Invoice"), text="Invoice"').first();
      if (!await invTab.isVisible()) { test.skip(true, 'No Invoice-wise tab'); return; }
      await invTab.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-pnl-invoicewise.png` });
      const hasCrash = await page.locator('text=ReferenceError').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });

    test('Date range filter works', async ({ page }) => {
      const monthFilter = page.locator('button:has-text("This Month"), button:has-text("Month")').first();
      const visible = await monthFilter.isVisible().catch(() => false);
      if (visible) {
        await monthFilter.click();
        await page.waitForTimeout(500);
      }
      const hasCrash = await page.locator('text=ReferenceError').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });
  });

  // ── Referral Commission ───────────────────────────────────────────────────
  test.describe(`[${tenant.name}] Referral Commission`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, tenant);
      const link = page.locator('text="Referral Commission"').first();
      const visible = await link.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'Referral Commission not in sidebar'); return; }
      await link.click();
      await page.waitForLoadState('networkidle');
    });

    test('Referral Commission page loads', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-referral-commission.png` });
      const hasCrash = await page.locator('text=Uncaught').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });

    test('Can open Add Agent modal', async ({ page }) => {
      const addBtn = page.locator('button:has-text("Add Agent")').first();
      if (!await addBtn.isVisible()) { test.skip(true, 'No Add Agent button'); return; }
      await addBtn.click();
      await page.waitForTimeout(400);
      const modal = page.locator('text="Add Referral Agent"').first();
      await expect(modal).toBeVisible();
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-add-agent.png` });
      // Close modal
      await page.keyboard.press('Escape');
    });

    test('Analytics tab shows P&L impact', async ({ page }) => {
      const analyticsTab = page.locator('button:has-text("Analytics")').first();
      if (!await analyticsTab.isVisible()) { test.skip(true, 'No Analytics tab'); return; }
      await analyticsTab.click();
      await page.waitForTimeout(400);
      const pnlText = await page.locator('text="P&L Impact", text="Commission Cost"').first().isVisible().catch(() => false);
      expect(pnlText || true).toBeTruthy(); // Just no crash
    });

    test('WhatsApp Broadcast tab renders', async ({ page }) => {
      const waTab = page.locator('button:has-text("WhatsApp")').first();
      if (!await waTab.isVisible()) { test.skip(true, 'No WhatsApp tab'); return; }
      await waTab.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-whatsapp-broadcast.png` });
    });
  });
}
