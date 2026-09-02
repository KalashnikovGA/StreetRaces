/**
 * Самодостаточная страница игры одним HTML-файлом.
 *
 *   node scripts/build-standalone.mjs <страница> [--nav '{"garage":"https://…"}']
 *
 * Собирает одну страницу так, чтобы её можно было открыть по ссылке без
 * сервера: скрипт и стили вшиваются в разметку, спрайты — в data-URI.
 * Нужно, чтобы показать игру человеку, у которого нет ни репозитория,
 * ни node под рукой.
 *
 * Игровой код при этом не подменяется: страница собирается тем же vite
 * из тех же исходников. Единственная уступка — карта `window.__sprites`,
 * через которую загрузчик берёт картинки из самого файла, а не из сети.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const [, , page, ...rest] = process.argv;

if (!page) {
  console.error('Использование: node scripts/build-standalone.mjs <страница> [--nav <json>]');
  process.exit(1);
}

const navIndex = rest.indexOf('--nav');
const nav = navIndex >= 0 ? JSON.parse(rest[navIndex + 1]) : {};

const entry = page === 'race' ? 'index.html' : `${page}.html`;
const work = `.standalone/${page}`;
const outFile = `dist-standalone/${page}.html`;

// ── сборка одной страницы в один скрипт ──────────────────────────────────────

const config = `
import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    outDir: '${work}',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    rollupOptions: {
      input: '${entry}',
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app[extname]',
      },
    },
  },
});
`;

writeFileSync('vite.standalone.config.mjs', config);
try {
  execFileSync('npx', ['vite', 'build', '--config', 'vite.standalone.config.mjs'], { stdio: 'pipe' });
} finally {
  rmSync('vite.standalone.config.mjs', { force: true });
}

// ── спрайты в data-URI ───────────────────────────────────────────────────────

const MIME = { '.png': 'image/png', '.json': 'application/json' };

function collect(dir, prefix, into) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      collect(path, `${prefix}/${name}`, into);
      continue;
    }
    const mime = MIME[extname(name)];
    if (!mime) continue;
    into[`${prefix}/${name}`] = `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  }
  return into;
}

const sprites = collect('public/sprites', '/sprites', {});

// ── склейка ──────────────────────────────────────────────────────────────────

let html = readFileSync(`${work}/${entry}`, 'utf8');
const js = readFileSync(`${work}/app.js`, 'utf8');
const css = readFileSync(`${work}/app.css`, 'utf8');

html = html.replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, '');
html = html.replace(/<link rel="stylesheet"[^>]*href="\/?app\.css"[^>]*>/, '');

// Вкладки, которых в этой раздаче нет, гасим: мёртвая ссылка хуже её отсутствия.
const navScript = `window.__nav = ${JSON.stringify(nav)};`;

html = html.replace(
  '</head>',
  `  <style>\n${css}\n</style>\n</head>`,
);
html = html.replace(
  '</body>',
  `  <script>window.__sprites = ${JSON.stringify(sprites)}; ${navScript}</script>\n`
  + `  <script type="module">\n${js}\n</script>\n</body>`,
);

mkdirSync('dist-standalone', { recursive: true });
writeFileSync(outFile, html);
rmSync('.standalone', { recursive: true, force: true });

const size = statSync(outFile).size;
console.log(`${entry} -> ${outFile}`);
console.log(`спрайтов вшито ${Object.keys(sprites).length}, вес страницы ${(size / 1048576).toFixed(1)} МБ`);
