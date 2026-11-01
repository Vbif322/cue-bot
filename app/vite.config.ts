import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@server': path.resolve(import.meta.dirname, '../src/app/server'),
    },
  },
  server: {
    port: 5174,
    // Dev-only: accept any Host so an ssh-tunnelled domain reaches the Vite server
    // (see README). Prod serves static via Node, so this has no production effect.
    allowedHosts: true,
    proxy: {
      '/api': {
        // E2E-тесты поднимают API на отдельном порту (см. e2e/setup).
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
