import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Preview aislada: sin variables de entorno, sin Supabase, sin PWA.
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
});
