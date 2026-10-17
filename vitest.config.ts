import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Edge Functions import `npm:libphonenumber-js@<version>/max` (native in Deno).
    alias: [
      {
        find: /^npm:libphonenumber-js@[^/]+\/max$/,
        replacement: 'libphonenumber-js/max',
      },
    ],
  },
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
      'supabase/functions/_shared/**/*.test.ts',
    ],
  },
});
