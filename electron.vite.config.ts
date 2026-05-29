import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
        // Native addon must stay external. v5 also auto-externalizes deps,
        // but we list it explicitly so this is correct on v2–v5.
        external: ['secure-browser-core'],
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          autofill: resolve(__dirname, 'electron/content/autofill.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'electron/renderer',
    plugins: [svelte()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/renderer/index.html') },
      },
    },
  },
});
