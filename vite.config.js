import { defineConfig } from 'vite';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Keep original model URLs and directory layout in development and production.
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    target: 'es2022',
    assetsDir: 'app',
    rollupOptions: {
      input: { main: `${root}index.html`, dental: `${root}dental/index.html` },
      output: {
        manualChunks(id) {
          if (id.includes('/src/vendor/') && !id.includes('/dental/')) return 'three';
          if (id.endsWith('/catalog.json')) return 'catalog';
        },
      },
    },
  },
  plugins: [{
    name: 'atlas-model-assets',
    async closeBundle() {
      await cp(`${root}dental/vendor`, `${root}dist/dental/vendor`, { recursive: true, filter: source => !source.includes('/vendor/src') });
      for (const directory of ['assets', 'thumbs', 'dental/models']) {
        await cp(`${root}${directory}`, `${root}dist/${directory}`, { recursive: true });
      }
    },
  }],
});
