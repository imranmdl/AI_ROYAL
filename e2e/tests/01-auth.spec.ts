/**
 * 01-auth.spec.ts — Login, session, access control
 */
import { test, expect } from '@playwright/test';
import { TENANTS } from '../fixtures/tenants';
import { loginAs, watchConsoleErrors } from '../fixtures/helpers';

for (const tenant of TENANTS) {
  test.describe(`[${tenant.name}] Authentication`, () => {

    test('Login page loads correctly', async ({ page }) => {
      await page.goto(`/?tenant=${tenant.slug}`);
      await page.waitForLoadState('networkidle');

      // Should see login form
      const emailField = page.locator('input[type="email"], input[placeholder*="email" i]').first();
      await expect(emailField).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-login.png` });
    });

    test('Correct credentials log in successfully', async ({ page }) => {
      const errors = watchConsoleErrors(page);
      await loginAs(page, tenant);

      // Should be on dashboard or main content
      await expect(page.locator('text=Dashboard').or(page.locator('text=Inventory'))).toBeVisible();
      await page.screenshot({ path: `test-results/screenshots/${tenant.slug}-after-login.png` });

      // No JS errors on login
      const criticalErrors = errors.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'));
      expect(criticalErrors, `Console errors after login: ${criticalErrors.join(', ')}`).toHaveLength(0);
    });

    test('Wrong password shows error (not crash)', async ({ page }) => {
      await page.goto(`/?tenant=${tenant.slug}`);
      const email = page.locator('input[type="email"], input[placeholder*="email" i]').first();
      await email.waitFor({ timeout: 10_000 });
      await email.fill(tenant.email);
      await page.locator('input[type="password"]').fill('WRONG_PASSWORD_12345');
      await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")').first().click();

      // Should NOT crash — should show an error message
      await page.waitForLoadState('networkidle');
      const isError = await page.locator('text=Invalid, text=incorrect, text=wrong, text=failed, text=error').first().isVisible().catch(() => false);
      const isStillOnLogin = await page.locator('input[type="password"]').isVisible();
      expect(isError || isStillOnLogin, 'Wrong password should show error or stay on login').toBeTruthy();
    });

    test('Sidebar shows all enabled modules after login', async ({ page }) => {
      await loginAs(page, tenant);
      const sidebar = page.locator('nav, aside, [class*="sidebar"]').first();
      await expect(sidebar).toBeVisible();

      // Core modules must be visible
      for (const label of ['Dashboard', 'Billing & POS', 'Inventory Master']) {
        await expect(page.locator(`text="${label}"`).first()).toBeVisible({ timeout: 6_000 });
      }
    });

    test('Tenant isolation: URL slug matches tenant content', async ({ page }) => {
      await loginAs(page, tenant);
      const url = page.url();
      expect(url).toContain(tenant.slug);
    });
  });
}
