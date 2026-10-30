import { defineConfig } from 'vite';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Keep original model URLs and directory layout in development and production.
const root = fileURLToPath(new URL('.', import.meta.url));

async function convertModelScripts(sourceDir, outputDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  await mkdir(outputDir, { recursive: true });
  for (const entry of entries) {
    const sourcePath = `${sourceDir}/${entry.name}`;
    const outputPath = `${outputDir}/${entry.name.replace(/\.js$/, '.glb')}`;
    if (entry.isDirectory()) {
      await convertModelScripts(sourcePath, `${outputDir}/${entry.name}`);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const source = await readFile(sourcePath, 'utf8');
    const match = source.match(/\bglb"\s*:\s*"([A-Za-z0-9+/=]+)"/);
    if (match) await writeFile(outputPath, Buffer.from(match[1], 'base64'));
  }
}

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
        const filter = directory === 'assets'
          ? source => !source.endsWith('/full_body.glb') && !source.endsWith('.js')
          : undefined;
        await cp(`${root}${directory}`, `${root}dist/${directory}`, { recursive: true, filter });
      }
      await convertModelScripts(`${root}assets`, `${root}dist/assets`);
    },
  }],
});
