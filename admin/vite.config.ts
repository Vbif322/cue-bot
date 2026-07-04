import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@server': path.resolve(__dirname, '../src/admin/server'),
    },
  },
  server: {
    port: 5173,
    // Dev-only: accept any Host so an ssh-tunnelled domain reaches the Vite server
    // (see README). Prod serves static via Node, so this has no production effect.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
