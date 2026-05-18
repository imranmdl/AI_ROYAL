
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

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
