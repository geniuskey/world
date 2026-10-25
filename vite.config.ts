import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const previewOrigin = process.env.WORLD_PREVIEW_ORIGIN;
const preview = previewOrigin ? new URL(previewOrigin) : undefined;
if (
  preview &&
  (preview.protocol !== 'https:' ||
    !preview.hostname.endsWith('.ts.net') ||
    preview.origin !== previewOrigin)
)
  throw new Error(
    'WORLD_PREVIEW_ORIGIN must be an HTTPS Tailscale origin without a trailing slash.',
  );

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    allowedHosts: preview ? [preview.hostname] : [],
    proxy: {
      '/api': {
        target: process.env.WORLD_API_ORIGIN || 'http://127.0.0.1:8788',
        changeOrigin: Boolean(preview),
        configure(proxy) {
          // An explicitly configured, tailnet-only preview may use the local playtest API.
          // All other origins on the preview host must fail the Worker's origin check.
          proxy.on('proxyReq', (request, incoming) => {
            if (preview && incoming.headers.host === preview.host)
              request.setHeader(
                'Origin',
                incoming.headers.origin === preview.origin ? 'http://localhost:5174' : 'null',
              );
          });
          proxy.on('proxyRes', (response, incoming) => {
            if (preview && incoming.headers.host === preview.host)
              response.headers['set-cookie'] = response.headers['set-cookie']?.map((cookie) =>
                /;\s*Secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`,
              );
          });
        },
      },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 350 },
});
