/**
 * Royal ERP — Tenant Configuration for UI Tests
 * ───────────────────────────────────────────────
 * Add or edit tenants here. Each test will run for every configured tenant.
 */

export interface Tenant {
  name: string;            // display name
  slug: string;            // URL param: /?tenant=<slug>
  tenantId: string;        // internal DB id
  email: string;
  password: string;
  adminOnly?: boolean;     // skip non-admin tests
}

export const TENANTS: Tenant[] = [
  {
    name: 'Royal Mudhol',
    slug: 'royal-mudhol',
    tenantId: 'royal-mudhol-d81d2d03',
    email: 'admin@royal.com',
    password: 'Admin@2024',
  },
  {
    name: 'Test2Shop',
    slug: 'test2shop-a626',
    tenantId: 'test2shop-3622247e',
    email: 'admin@royal.com',
    password: 'Admin@2024',
  },
];

/** Get tenant from TENANT env var or default to first */
export function getActiveTenant(): Tenant {
  const slug = process.env.TENANT;
  if (slug) {
    const t = TENANTS.find(t => t.slug === slug);
    if (t) return t;
  }
  return TENANTS[0];
}
