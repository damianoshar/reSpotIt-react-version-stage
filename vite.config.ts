import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    host: true,
    port: 3002,
    strictPort: true,
  },
  // Ensure Capacitor assets resolve correctly
  base: './',
  optimizeDeps: {
    include: ['papaparse', 'jeep-sqlite/loader'],
  },
});
