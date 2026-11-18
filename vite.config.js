import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Production builds must get the Supabase settings from the host (e.g. Vercel →
// Settings → Environment Variables), not a committed .env. Fail the build
// instead of shipping an app that cannot reach the database. Also refuse to
// build if a server secret was given a VITE_ name (it would be made public).
function checkEnv(mode) {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  if (mode !== 'production') return
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter(k => !env[k])
  if (missing.length) throw new Error(`Missing ${missing.join(', ')} for the production build. Add them in your hosting provider's environment variables.`)
  const leaked = Object.keys(env).filter(k => k.startsWith('VITE_') && /SERVICE_ROLE|SECRET|RESEND/i.test(k))
  if (leaked.length) console.warn(`[security] ${leaked.join(', ')} has a VITE_ name. Rename it without VITE_ (server-only); it is not used by the app.`)
}

export default defineConfig(({ mode }) => (checkEnv(mode), {
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
        // Allow larger bundles (jsPDF + html2canvas increase bundle size)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
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
              networkTimeoutSeconds: 2,
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
        // Customer-facing links (bill QR /b/…, customer link /c/…) always load the
        // latest app from the server, so a phone with an old cached app never shows
        // a blank page for them.
        navigateFallbackDenylist: [/^\/api/, /^\/b\//, /^\/c\//]
      },
      devOptions: {
        // Enable SW in dev mode so you can test offline locally
        enabled: false
      }
    })
  ],
}))
