import { defineConfig } from 'vite';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Keep original model URLs and directory layout in development and production.
const root = fileURLToPath(new URL('.', import.meta.url));
const labPath = 'experiments/body-lab';
const publishedPlayer = 'https://freedomintelligence.github.io/BodyVista/experiments/body-lab/player.html';

// The bookmarked lab URL opens the atlas tab. An ordinary build without local
// release assets can load the published player in that same tab's iframe.
function workspaceEntry(usePublishedPlayer = false) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>肌肉运动 · BodyVista</title>
<a href="../../?workspace=muscle-motion" target="_top">打开肌肉运动</a>
<script>
  const target = new URL(document.querySelector('a').href);
  const params = new URLSearchParams(location.search);
  const chosen = params.get('case');
  const destination = ${usePublishedPlayer ? `window.parent === window ? target : new URL('${publishedPlayer}')` : 'target'};
  if (chosen) destination.searchParams.set('case', chosen);
  if (['zh-CN', 'en', 'ja'].includes(params.get('lang'))) destination.searchParams.set('lang', params.get('lang'));
  if (location.href !== destination.href) location.replace(destination.href);
</script></html>`;
}

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
  server: {
    watch: { ignored: ['**/.runtime-cache/**', '**/.venv*/**', '**/.playwright-cli/**'] },
  },
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
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const {pathname} = new URL(req.url, 'http://localhost');
        if (req.method !== 'GET' || !pathname.includes('/experiments/body-lab/')) return next();
        const legacy = pathname.endsWith('/experiments/body-lab/') || pathname.endsWith('/experiments/body-lab/index.html');
        const player = pathname.endsWith('/experiments/body-lab/player.html');
        if (!legacy && !player) return next();
        try {
          const installed = player && ['motion-cache/catalog.json', 'atlas-muscles.bin', 'geometry/bone-volumes.bin']
            .every(file => existsSync(`${root}${labPath}/${file}`));
          const html = installed
            ? (await readFile(`${root}${labPath}/index.html`, 'utf8')).replace('<head>', '<head><meta name="bodyvista-mode" content="replay">')
            : workspaceEntry(player);
          res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
          res.end(html);
        } catch (error) { next(error); }
      });
    },
    async closeBundle() {
      await cp(`${root}dental/vendor`, `${root}dist/dental/vendor`, { recursive: true, filter: source => !source.includes('/vendor/src') });
      for (const directory of ['assets', 'thumbs', 'dental/models']) {
        const filter = directory === 'assets'
          ? source => !source.endsWith('/full_body.glb') && !source.endsWith('.js')
          : undefined;
        await cp(`${root}${directory}`, `${root}dist/${directory}`, { recursive: true, filter });
      }
      await convertModelScripts(`${root}assets`, `${root}dist/assets`);
      const labDir = `${root}dist/${labPath}`;
      await mkdir(labDir, { recursive: true });
      await writeFile(`${labDir}/index.html`, workspaceEntry());
      await writeFile(`${labDir}/player.html`, workspaceEntry(true));
    },
  }],
});
