# Royal ERP — Multi-Tenant Architecture Guide

## How it works

```
                        ┌─────────────────────────────────────────┐
                        │           ONE SERVER (royalerp.com)      │
                        │                                         │
  Shop A logs in ──────▶│  JWT: { tenantId: "royal_tiles" }       │
  Shop B logs in ──────▶│  JWT: { tenantId: "granite_palace" }    │
                        │                                         │
                        │  Every DB query:                        │
                        │    WHERE tenant_id = 'royal_tiles'      │
                        │                                         │
                        │  ┌─────────────────────────────────┐   │
                        │  │         ONE MySQL Database       │   │
                        │  │  tenants table                   │   │
                        │  │  products (tenant_id col)        │   │
                        │  │  sales    (tenant_id col)        │   │
                        │  │  users    (tenant_id col)        │   │
                        │  │  ...all tables have tenant_id    │   │
                        │  └─────────────────────────────────┘   │
                        └─────────────────────────────────────────┘
```

## Security model

- Each shop gets a unique `tenantId` (e.g. "royal-tiles-kdp-001")
- Login returns a JWT with that tenantId embedded
- Every single API endpoint verifies the JWT and appends `tenant_id = ?` to queries
- **A shop can never access another shop's data — even if they know the API**

## Adding a new shop

Hit one API endpoint:
```
POST /api/admin/tenants
{
  "shopName": "Granite Palace",
  "ownerEmail": "admin@granite.com",
  "password": "secure123",
  "phone": "9876543210",
  "address": "123 Stone Street, Bangalore",
  "gst": "29XXXXX1234Z1Z5",
  "plan": "standard"
}
```
Returns a `tenantId` and the shop is live immediately. No DB provisioning needed.

## URL options

Option 1 — Single URL (simplest):
  https://royalerp.com  → login screen asks for Shop Code
  
Option 2 — Subdomain (professional):
  https://royal.royalerp.com    → Shop: Royal Tiles
  https://granite.royalerp.com  → Shop: Granite Palace
