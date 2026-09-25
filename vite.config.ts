import { svelte } from '@sveltejs/vite-plugin-svelte'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    svelte(),
    // `npm run dev:lan` serves over HTTPS with a self-signed certificate, so
    // the phone treats the Wi-Fi address as secure (needed for folder access).
    ...(mode === 'lan' ? [basicSsl()] : []),
  ],
  server: {
    // IPv4 loopback: Chrome's USB port forwarding connects to 127.0.0.1, and
    // "localhost" can resolve to IPv6 (::1) only on macOS.
    // `npm run dev:lan` overrides this with --host 0.0.0.0.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
}))
