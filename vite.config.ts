import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    // Prevent code-splitting into separate chunks — all app code in one file
    // This stops "stale chunk" errors after Railway redeploys where old
    // cached index.js tries to import new-hash chunk files → black screen
    rollupOptions: {
      output: {
        // Single entry file with timestamp so browser never caches stale version
        entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        // Merge all component chunks into the main bundle (no lazy splits)
        // Only split out large third-party vendor libs to keep bundle manageable
        manualChunks(id) {
          // Keep large vendor libs split (they rarely change)
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) {
            return 'chart-vendor';
          }
          // All app code goes into one bundle — prevents stale chunk 404s
          return undefined;
        },
        chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,  // timestamp breaks browser cache
        assetFileNames: `assets/[name]-[hash].[ext]`
      }
    }
  }
});
