#!/usr/bin/env node
/**
 * setup.mjs — One-time setup for Royal ERP E2E tests
 * Run: node e2e/setup.mjs
 */

import { execSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';

console.log('\n🚀 Royal ERP — E2E Test Setup\n');

const run = (cmd, label) => {
  console.log(`  → ${label}…`);
  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log(`  ✓ ${label} done`);
  } catch (e) {
    console.error(`  ✗ ${label} failed: ${e.message}`);
    process.exit(1);
  }
};

// 1. Install Playwright
run('npm install -D @playwright/test', 'Install @playwright/test');

// 2. Install Chromium browser
run('npx playwright install chromium', 'Install Chromium browser');

// 3. Create output dirs
for (const dir of ['test-results/screenshots', 'test-reports/html']) {
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); console.log(`  ✓ Created ${dir}`); }
}

console.log('\n✅ Setup complete! Run tests with:\n');
console.log('  npm run e2e                        # headless, all tenants');
console.log('  npm run e2e:ui                     # interactive Playwright UI');
console.log('  TENANT=test2shop-a626 npm run e2e  # specific tenant\n');
