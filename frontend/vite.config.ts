import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
const apiPort = Number(process.env.ORACLE_API_PORT || '8011');
if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535)
  throw new Error('Invalid ORACLE_API_PORT');
const proxy = {
  '/api': `http://127.0.0.1:${apiPort}`,
  '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
};
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    strictPort: true,
    proxy,
  },
  preview: {
    port: 4181,
    strictPort: true,
    proxy,
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom/client', 'zustand'] } },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
