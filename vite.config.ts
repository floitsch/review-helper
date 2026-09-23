import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'src/web',
  plugins: [svelte()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7777',
      '/mcp': 'http://localhost:7777',
      '/ws': { target: 'ws://localhost:7777', ws: true },
    },
  },
});
