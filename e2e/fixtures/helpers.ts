/**
 * helpers.ts — Shared utilities for Royal ERP Playwright tests
 */
import { Page, expect } from '@playwright/test';
import type { Tenant } from './tenants';

// ── Selectors ────────────────────────────────────────────────────────────────
export const sel = {
  sidebar: '[data-testid="sidebar"], nav, aside',
  sidebarItem: (label: string) => `text=${label}`,
  toast: '.toast, [role="alert"], .notification',
  modal: '[role="dialog"], .modal, .fixed.inset-0',
  submitBtn: (label: string) => `button:has-text("${label}")`,
};

// ── Login helper ─────────────────────────────────────────────────────────────
export async function loginAs(page: Page, tenant: Tenant) {
  const url = `/?tenant=${tenant.slug}`;
  await page.goto(url);
  await page.waitForLoadState('networkidle');

  // If already logged in, skip
  const isLoggedIn = await page.locator('text=Dashboard, text=Inventory, text=Billing').first().isVisible().catch(() => false);
  if (isLoggedIn) return;

  // Fill login form
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i], input[placeholder*="Email" i]').first();
  const passInput  = page.locator('input[type="password"]').first();

  await emailInput.waitFor({ timeout: 10_000 });
  await emailInput.fill(tenant.email);
  await passInput.fill(tenant.password);

  const loginBtn = page.locator('button:has-text("Login"), button:has-text("Sign In"), button[type="submit"]').first();
  await loginBtn.click();
  await page.waitForLoadState('networkidle');

  // Confirm we're in
  await expect(page.locator('text=Dashboard').or(page.locator('text=Inventory')).or(page.locator('text=Billing'))).toBeVisible({ timeout: 12_000 });
}

// ── Navigate via sidebar ──────────────────────────────────────────────────────
export async function goTo(page: Page, sidebarLabel: string) {
  const link = page.locator(`text="${sidebarLabel}"`).first();
  await link.waitFor({ timeout: 8_000 });
  await link.click();
  await page.waitForLoadState('networkidle');
}

// ── Wait for content to load (no spinner) ────────────────────────────────────
export async function waitForContent(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.locator('.animate-spin, .loading').waitFor({ state: 'hidden' }).catch(() => {});
}

// ── Screenshot helper ─────────────────────────────────────────────────────────
export async function capture(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: false });
}

// ── Assert no console errors ──────────────────────────────────────────────────
export function watchConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

// ── Fill a form field by label ────────────────────────────────────────────────
export async function fillField(page: Page, label: string, value: string) {
  // Try: label → associated input, or input with placeholder matching label
  const field = page.locator(`label:has-text("${label}") + input, label:has-text("${label}") + * input`).first()
    .or(page.locator(`input[placeholder*="${label}" i]`).first());
  await field.fill(value);
}

// ── Click a button by partial text ───────────────────────────────────────────
export async function clickBtn(page: Page, text: string) {
  await page.locator(`button:has-text("${text}")`).first().click();
  await page.waitForLoadState('networkidle');
}

// ── Unique test data generators ───────────────────────────────────────────────
const TS = () => Date.now().toString().slice(-6);
export const testData = {
  productName: () => `E2E-TILE-${TS()}`,
  customerName: () => `E2E-Customer-${TS()}`,
  vendorName:   () => `E2E-Vendor-${TS()}`,
  invoiceNo:    () => `E2E-INV-${TS()}`,
  agentName:    () => `E2E-Agent-${TS()}`,
};
