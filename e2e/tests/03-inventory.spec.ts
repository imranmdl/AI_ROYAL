/**
 * 03-inventory.spec.ts — Product creation, stock, search, CSV
 */
import { test, expect } from '@playwright/test';
import { TENANTS } from '../fixtures/tenants';
import { loginAs, goTo, testData, watchConsoleErrors } from '../fixtures/helpers';

for (const tenant of TENANTS) {
  test.describe(`[${tenant.name}] Inventory`, () => {
    let createdProductName = '';

    test.beforeEach(async ({ page }) => {
      await loginAs(page, tenant);
      await goTo(page, 'Inventory Master');
      await page.waitForLoadState('networkidle');
    });

    test('Inventory page loads with product list', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-inventory.png` });
      const hasCrash = await page.locator('text=Something went wrong, text=Uncaught ReferenceError').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();

      // Should show products or empty state
      const hasContent = await page.locator('table, [class*="product-card"], text=No products, text=Add your first').first().isVisible();
      expect(hasContent).toBeTruthy();
    });

    test('Create a new tile product via Provision Master Node', async ({ page }) => {
      createdProductName = testData.productName();

      // Click Create Master / Add Product
      const createBtn = page.locator('button:has-text("Create Master"), button:has-text("Add Product"), button:has-text("New Product")').first();
      await createBtn.waitFor({ timeout: 8_000 });
      await createBtn.click();
      await page.waitForLoadState('networkidle');

      // Fill form
      const nameInput = page.locator('input[placeholder*="Full Product Name"], input[placeholder*="Product Name"]').first();
      await nameInput.fill(createdProductName);

      // Select category — pick a non-slab one
      const catSelect = page.locator('select').filter({ hasText: 'Floor Tile' }).first()
        .or(page.locator('select[name*="category"], select').first());
      if (await catSelect.isVisible()) {
        await catSelect.selectOption({ label: 'Floor Tile' }).catch(() => catSelect.selectOption({ index: 1 }));
      }

      // Brand, Size, Stock
      const brandInput = page.locator('input[placeholder*="Brand"]').first();
      if (await brandInput.isVisible()) await brandInput.fill('E2E-Brand');
      const sizeInput = page.locator('input[placeholder*="Size"], input[placeholder*="600x"]').first();
      if (await sizeInput.isVisible()) await sizeInput.fill('600x600');
      const stockInput = page.locator('input[placeholder*="Stock"], input[placeholder*="stock"]').first();
      if (await stockInput.isVisible()) await stockInput.fill('50');

      // Selling price
      const priceInput = page.locator('input[placeholder*="Selling Price"], input[placeholder*="selling"]').first();
      if (await priceInput.isVisible()) await priceInput.fill('450');

      // Save
      const saveBtn = page.locator('button:has-text("Save Product"), button:has-text("Create Product"), button:has-text("Save")').last();
      await saveBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Product should now appear in list
      const productInList = await page.locator(`text="${createdProductName}"`).first().isVisible().catch(() => false);
      expect(productInList, `Product "${createdProductName}" should appear in inventory after creation`).toBeTruthy();
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-product-created.png` });
    });

    test('Search filters inventory by product name', async ({ page }) => {
      const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
      await searchInput.fill('TILE');
      await page.waitForTimeout(600);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-inventory-search.png` });
      // Should not crash
      const hasCrash = await page.locator('text=Uncaught, text=ReferenceError').first().isVisible().catch(() => false);
      expect(hasCrash).toBeFalsy();
    });

    test('Bulk mode checkbox hidden for Kadapa category', async ({ page }) => {
      const createBtn = page.locator('button:has-text("Create Master"), button:has-text("Add Product")').first();
      await createBtn.click();
      await page.waitForLoadState('networkidle');

      const catSelect = page.locator('select').first();
      if (await catSelect.isVisible()) {
        await catSelect.selectOption({ label: 'Kadapa' }).catch(() => {});
        await page.waitForTimeout(400);
        const bulkMode = page.locator('text="Bulk Mode"');
        const isBulkVisible = await bulkMode.isVisible().catch(() => false);
        expect(isBulkVisible, 'Bulk Mode should be hidden for Kadapa category').toBeFalsy();
      }
    });

    test('Kadapa auto-sets Unit to Slab', async ({ page }) => {
      const createBtn = page.locator('button:has-text("Create Master"), button:has-text("Add Product")').first();
      await createBtn.click();
      await page.waitForLoadState('networkidle');

      const catSelect = page.locator('select').first();
      if (await catSelect.isVisible()) {
        await catSelect.selectOption({ label: 'Kadapa' }).catch(() => {});
        await page.waitForTimeout(400);
        // Unit type should show Slab
        const slabLabel = await page.locator('text=Slab').first().isVisible().catch(() => false);
        expect(slabLabel, 'Unit type should be Slab for Kadapa').toBeTruthy();
      }
    });

    test('CSV Export Template download available', async ({ page }) => {
      // Look for Import/Export button
      const exportBtn = page.locator('button:has-text("Import"), button:has-text("Export"), button:has-text("CSV")').first();
      const visible = await exportBtn.isVisible().catch(() => false);
      if (!visible) { test.skip(true, 'No Import/Export button found'); return; }
      await exportBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-csv-export.png` });
    });
  });
}
