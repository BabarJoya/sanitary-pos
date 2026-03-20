import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['*.png', '*.svg', '*.ico'],
      manifest: {
        name: 'EdgeX Digital POS',
        short_name: 'EdgeX POS',
        description: 'Point of Sale system for retail shops',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/edgex_pos_logo_platform.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/edgex_pos_logo_platform.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Cache all app assets (JS bundles, CSS, HTML)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Cache Supabase API responses for offline fallback
        runtimeCaching: [
          {
            // Supabase REST API — network first, fall back to cache
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Supabase Auth — network first, short cache
            urlPattern: /^https:\/\/.*\.supabase\.co\/auth\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-auth-cache',
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 // 1 hour
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ],
        // Don't cache these (they change dynamically)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/]
      },
      devOptions: {
        // Enable SW in dev mode so you can test offline locally
        enabled: false
      }
    })
  ],
})
