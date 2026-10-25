import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': process.env.WORLD_API_ORIGIN || 'http://localhost:8788' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 350 },
});
