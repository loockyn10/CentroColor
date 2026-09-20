import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { parseSupabaseConfig } from './src/supabase-config';

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, '.', 'VITE_');
    parseSupabaseConfig(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
    );
  }
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'CentroColor',
          short_name: 'CentroColor',
          description: 'Espacio de trabajo CentroColor',
          lang: 'es',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#f7f7f4',
          theme_color: '#22332f',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
      }),
    ],
    server: { port: 5173, strictPort: true },
  };
});
