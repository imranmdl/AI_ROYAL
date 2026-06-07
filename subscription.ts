/**
 * subscription.ts
 * Central feature registry and plan definitions.
 * Import this anywhere to check if a feature is available for the current tenant.
 */

import type { Plan, PlanId, PlanFeature, Subscription } from './types';

// ── Feature Registry ──────────────────────────────────────────────────────────
// Every gated feature in the app must be registered here.
export const FEATURES: PlanFeature[] = [
  // Inventory
  { id: 'inventory_basic',     name: 'Basic Inventory',         description: 'Add & manage products',            category: 'Inventory' },
  { id: 'inventory_unlimited', name: 'Unlimited Products',       description: 'No cap on product count',           category: 'Inventory' },
  { id: 'inventory_import',    name: 'Import / Export CSV',      description: 'Bulk upload & download inventory',  category: 'Inventory' },
  { id: 'inventory_granite',   name: 'Granite / Slab Manager',   description: 'Slab-level tracking with inch dims', category: 'Inventory' },
  { id: 'inventory_kadapa',    name: 'Kadapa Manager',           description: 'Kadapa size matrix & stock',        category: 'Inventory' },
  { id: 'inventory_images',    name: 'Product Images',           description: 'Upload product photos',             category: 'Inventory' },
  { id: 'inventory_batch',     name: 'Batch / Shade Tracking',   description: 'Batch numbers & shade codes',       category: 'Inventory' },

  // Sales & Billing
  { id: 'sales_pos',           name: 'POS Billing',              description: 'Cloud billing & invoicing',         category: 'Sales' },
  { id: 'sales_quotation',     name: 'Quotation Studio',         description: 'Estimate & margin guard',           category: 'Sales' },
  { id: 'sales_credit',        name: 'Credit Management',        description: 'Track outstanding & credits',       category: 'Sales' },
  { id: 'sales_returns',       name: 'Returns Management',       description: 'Handle product returns',            category: 'Sales' },
  { id: 'sales_offers',        name: 'Offers & Discounts',       description: 'Run promotions & price rules',      category: 'Sales' },

  // Reports & Analytics
  { id: 'reports_basic',       name: 'Basic Reports',            description: 'Sales & stock summaries',           category: 'Reports' },
  { id: 'reports_pl',          name: 'P&L Intelligence',         description: 'Real profit per item with COGS',    category: 'Reports' },
  { id: 'reports_commission',  name: 'Commission Reports',       description: 'Staff commission tracking',         category: 'Reports' },
  { id: 'reports_export',      name: 'Export Reports',           description: 'Download reports as CSV/PDF',       category: 'Reports' },

  // Customers & CRM
  { id: 'crm_basic',           name: 'Customer Management',      description: 'Customer profiles & history',       category: 'CRM' },
  { id: 'crm_gallery',         name: 'Public Gallery',           description: 'Customer-facing product gallery',   category: 'CRM' },
  { id: 'crm_whatsapp',        name: 'WhatsApp Integration',     description: 'Share quotes & stock via WhatsApp', category: 'CRM' },
  { id: 'crm_leads',           name: 'Gallery Leads',            description: 'Track enquiries from gallery',      category: 'CRM' },

  // Operations
  { id: 'ops_multiuser',       name: 'Multi-User Access',        description: 'Multiple staff logins',             category: 'Operations' },
  { id: 'ops_multilocation',   name: 'Multi-Location',           description: 'Multiple godowns/showrooms',        category: 'Operations' },
  { id: 'ops_vendor',          name: 'Vendor & Purchase',        description: 'Purchase orders & vendor tracking', category: 'Operations' },
  { id: 'ops_commission',      name: 'Commission Engine',        description: 'Auto-calculate staff commissions',  category: 'Operations' },
  { id: 'ops_expenses',        name: 'Expenses',                 description: 'Track business expenses',           category: 'Operations' },
  { id: 'ops_payroll',         name: 'Payroll',                  description: 'Staff salary & advances',           category: 'Operations' },

  // Platform
  { id: 'platform_api',        name: 'API Access',               description: 'Developer API for integrations',    category: 'Platform' },
  { id: 'platform_branding',   name: 'Custom Branding',          description: 'Your logo & colors on documents',   category: 'Platform' },
  { id: 'platform_support',    name: 'Priority Support',         description: '4-hour response SLA',               category: 'Platform' },
  { id: 'platform_mobile',     name: 'Mobile App',               description: 'Android & iOS access',              category: 'Platform' },
];

// ── Plan Definitions ──────────────────────────────────────────────────────────
export const PLANS: Plan[] = [
  {
    id:          'classic',
    name:        'Classic',
    tagline:     'Essential tools to get started',
    price:       999,
    yearlyPrice: 9990,   // 2 months free
    color:       '#64748b',
    limits:      { products: 100, users: 2, locations: 1 },
    features: [
      'inventory_basic', 'inventory_images',
      'sales_pos', 'reports_basic',
      'crm_basic',
      'ops_expenses',
      'platform_mobile',
    ],
  },
  {
    id:          'growth',
    name:        'Growth',
    tagline:     'Scale your showroom operations',
    price:       2499,
    yearlyPrice: 24990,
    color:       '#d97706',
    limits:      { products: -1, users: 10, locations: 3 },
    features: [
      'inventory_basic', 'inventory_unlimited', 'inventory_import',
      'inventory_granite', 'inventory_kadapa', 'inventory_images', 'inventory_batch',
      'sales_pos', 'sales_quotation', 'sales_returns', 'sales_offers',
      'reports_basic', 'reports_pl', 'reports_export',
      'crm_basic', 'crm_gallery', 'crm_whatsapp', 'crm_leads',
      'ops_multiuser', 'ops_vendor', 'ops_expenses',
      'platform_mobile', 'platform_branding',
    ],
  },
  {
    id:          'pro',
    name:        'Pro',
    tagline:     'Full power for serious businesses',
    price:       4999,
    yearlyPrice: 49990,
    color:       '#7c3aed',
    limits:      { products: -1, users: -1, locations: -1 },
    features: [
      // All features
      ...FEATURES.map(f => f.id),
    ],
  },
];

export const PLAN_MAP: Record<PlanId, Plan> = {
  classic: PLANS[0],
  growth:  PLANS[1],
  pro:     PLANS[2],
};

// ── Feature check helpers ─────────────────────────────────────────────────────

/** Check if a feature is available given a subscription
 *  Priority order (highest first):
 *  1. Tenant-level featureOverride (set by admin per-shop) — NEVER affected by plan changes
 *  2. Admin-configured plan features (from localStorage royal_plan_features)
 *  3. Default plan features (from PLANS constant)
 */
export function hasFeature(sub: Subscription | null | undefined, featureId: string): boolean {
  if (!sub) return true; // No subscription = legacy/single-shop mode, allow all
  if (sub.status === 'suspended' || sub.status === 'cancelled') return false;

  // 1. Shop-level admin override — highest priority, never touched by plan changes
  if (featureId in (sub.featureOverrides || {})) return sub.featureOverrides[featureId];

  // 2. Admin-configured plan features (operational matrix)
  try {
    const stored = JSON.parse(localStorage.getItem('royal_plan_features') || 'null');
    if (stored && stored[sub.planId]) return (stored[sub.planId] as string[]).includes(featureId);
  } catch {}

  // 3. Default plan definition
  const plan = PLAN_MAP[sub.planId];
  return plan ? plan.features.includes(featureId) : true;
}

/** Get the minimum plan that includes a feature */
export function minPlanForFeature(featureId: string): Plan | null {
  return PLANS.find(p => p.features.includes(featureId)) || null;
}

/** Check if subscription is expired */
export function isExpired(sub: Subscription): boolean {
  return new Date(sub.endDate) < new Date();
}

/** Days remaining on subscription */
export function daysRemaining(sub: Subscription): number {
  const diff = new Date(sub.endDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

/** Generate subscription access token */
export function makeSubscriptionToken(tenantId: string, planId: PlanId, endDate: string): string {
  const payload = btoa(JSON.stringify({ tenantId, planId, endDate, issued: new Date().toISOString() }));
  return `ROYAL-${planId.toUpperCase()}-${payload.slice(0, 16).replace(/=/g, '').toUpperCase()}`;
}
