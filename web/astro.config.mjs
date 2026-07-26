// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// astro.config runs before Vite injects env vars, so read .env explicitly.
const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');
const API_TARGET = env.DROP_API_TARGET || 'http://localhost:8000';

// https://astro.build/config
export default defineConfig({
  server: { port: 3000 },

  // Two ways to reach the API, both driven by .env:
  //   PUBLIC_DROP_API_URL set   -> the browser calls the API directly, and the
  //                                API's DROP_CORS_ORIGINS must allow this origin.
  //   PUBLIC_DROP_API_URL empty -> requests stay same-origin and this proxy
  //                                forwards them, so no CORS is involved.
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/v1': { target: API_TARGET, changeOrigin: true },
        '/healthz': { target: API_TARGET, changeOrigin: true },
      },
    },
  },

  integrations: [react()],
});