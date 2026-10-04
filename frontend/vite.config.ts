import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8011', '/ws': { target: 'ws://127.0.0.1:8011', ws: true } },
  },
  preview: {
    port: 4181,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8011', '/ws': { target: 'ws://127.0.0.1:8011', ws: true } },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom/client', 'zustand'] } },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
