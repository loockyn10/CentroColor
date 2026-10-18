import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // La CSP de Tauri (`img-src 'self'`) no admite data: URIs: nada se inlinea.
  build: { assetsInlineLimit: 0 },
  server: {
    port: 5174,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/**'] },
  },
  clearScreen: false,
});
