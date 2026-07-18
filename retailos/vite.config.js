import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pickPrimaryLanIp } from './pickLanIp.mjs'

/** Print one URL both PCs on the LAN should use (same as API / pickLanIp.mjs). */
function retailosLanUrlPlugin() {
  return {
    name: 'retailos-lan-url',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address()
        const port = typeof addr === 'object' && addr ? addr.port : 5173
        const ip = pickPrimaryLanIp()
        console.log(`\n  RetailOS — use this one URL on both PCs:  http://${ip}:${port}`)
        console.log('            (set RETAILOS_LAN_IP=192.168.x.x if the wrong interface is chosen)\n')
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), retailosLanUrlPlugin()],
  build: {
    // Keep previous hashed chunks during rolling/manual deploys so tabs
    // holding an older index.html can still finish their lazy imports.
    emptyOutDir: false,
  },
  server: {
    // Bind all network interfaces so other PCs on the LAN can open http://<this-ip>:5173
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: false,
  },
})
