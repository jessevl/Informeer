import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// API server URL for dev proxy
const apiUrl = process.env.API_URL || 'http://localhost:3011';

export default defineConfig({
  plugins: [
    react(),
    TanStackRouterVite(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png', 'icons/*.svg'],
      manifest: false, // Use existing public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        runtimeCaching: [
          {
            // Cache feed icons from the API
            urlPattern: /\/v1\/feeds\/\d+\/icon/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'feed-icons-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache book covers — rarely change
            urlPattern: /\/v1\/books\/\d+\/cover/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'book-covers',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // API list responses — network-first with 5s timeout fallback to cache
            urlPattern: /\/v1\/(entries|feeds|categories|me|feeds\/counters)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-responses',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 24 * 60 * 60, // 1 day
              },
              networkTimeoutSeconds: 5,
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
        ],
        navigateFallbackDenylist: [
          /^\/v1\//,
          /^\/files\//,
          /^\/health/,
          /^\/cover\//,
          /^\/manifest\.json$/,
          /^\/favicon/,
          /^\/sw\.js$/,
          /^\/registerSW\.js$/,
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@frameer': resolve(__dirname, './src/frameer/src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/v1': {
        target: apiUrl,
        changeOrigin: true,
      },
      '/files': {
        target: apiUrl,
        changeOrigin: true,
      },
      '/health': {
        target: apiUrl,
        changeOrigin: true,
      },
      '/cover-proxy': {
        target: apiUrl,
        changeOrigin: true,
      },
      '/cover': {
        target: apiUrl,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
