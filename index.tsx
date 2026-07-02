
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { store } from './store';

// ── One-time purge of legacy 'royal_jwt' key that caused cross-tenant contamination ──
store.purgeLegacyJwt?.();

// ── Auto-reload on chunk load failure (Railway redeploy invalidates hashed JS chunks) ──
// When the server has new JS bundles but the browser tries to load old cached ones,
// we get "Failed to fetch dynamically imported module" → black screen.
// Catch this globally and force a hard reload to pick up the new bundle.
window.addEventListener('error', (e) => {
  const msg = e?.message || '';
  if (msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('Expected a JavaScript')) {
    console.warn('[RoyalERP] JS chunk stale after deploy — reloading...');
    // Delay slightly to avoid reload loops
    setTimeout(() => { window.location.reload(); }, 500);
  }
});

// Also catch unhandledrejection (dynamic import returns a rejected promise)
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e?.reason?.message || e?.reason || '');
  if (msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed')) {
    console.warn('[RoyalERP] Module chunk load failed — reloading...');
    e.preventDefault();
    setTimeout(() => { window.location.reload(); }, 500);
  }
});

/**
 * RESILIENT NETWORK BRIDGE RESET
 * Safely purges stale Service Workers and Caches that cause 404s.
 * Uses try/catch and state checks to avoid "Document in invalid state" errors.
 */
const purgeNetworkCache = async () => {
  if (typeof window === 'undefined') return;

  // Wait for document to be fully ready
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => setTimeout(purgeNetworkCache, 500));
    return;
  }

  try {
    // Purge Service Workers
    if ('serviceWorker' in navigator && window.isSecureContext) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
        console.log('--- Bridge Reset: ServiceWorker Purged ---');
      }
    }

    // Purge Caches
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
        console.log(`--- Bridge Reset: Cache [${key}] Cleared ---`);
      }
    }
  } catch (err) {
    // Silently fail if document state becomes invalid during async purge
    console.debug('Cache purge skipped: context changed');
  }
};

// Trigger purge with a safe delay
setTimeout(purgeNetworkCache, 1000);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Target node 'root' not detected in DOM.");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
