/**
 * Сетка вариантов рендера: одна машина, девять клеток, одна картинка.
 *
 *   node scripts/render-grid.mjs --car <id> [--paint '#c0392b'] [--out <файл.png>]
 *
 * Зачем. Свет и лак нельзя подобрать перепиской: модель не видит результат
 * и на «сделай менее ярко» будет угадывать. Вместо девяти итераций — один
 * прогон, девять клеток и один ответ человека, какая клетка.
 *
 * По горизонтали — сила света, по вертикали — шероховатость лака. Остальное
 * зафиксировано и совпадает с боевым рендером (scripts/render-sprites.mjs):
 * та же камера из camera.json, та же кривая AgX, тот же средне-серый кузов,
 * те же площадные лампы. Клетка показана ровно так, как её увидит игрок:
 * кузов помножен на цвет окраски, блики положены сложением, фон — асфальт.
 *
 * Середина сетки выставляется автоматически: скрипт сначала снимает пробный
 * кадр, считает медианную яркость кузова и подбирает силу света так, чтобы
 * она попала в 0.62. Иначе крайние клетки уходят в чёрное и белое, и выбирать
 * оказывается не из чего.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, resolve, dirname } from 'node:path';
import { chromium } from 'playwright';

const rest = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};

const carId = flag('--car');
const paint = flag('--paint', '#c0392b');
const outFile = flag('--out', `.render/grid-${carId}.png`);

if (!carId) {
  console.error("Использование: node scripts/render-grid.mjs --car <id> [--paint '#c0392b']");
  process.exit(1);
}

const model = `assets/models/${carId}.glb`;
if (!existsSync(model)) {
  console.error(`Нет модели: ${model}`);
  process.exit(1);
}

const CONFIG = readFileSync('assets/render/camera.json', 'utf8');

// ── страница ─────────────────────────────────────────────────────────────────

const PAGE = `<!doctype html>
<meta charset="utf-8" />
<style>html,body{margin:0;background:#000}</style>
<script id="config" type="application/json">${CONFIG}</script>
<script type="importmap">
{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}
</script>
<script type="module">
import {
  AgXToneMapping, AmbientLight, Box3, HemisphereLight, LinearSRGBColorSpace,
  MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera, RectAreaLight,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const CONFIG = JSON.parse(document.getElementById('config').textContent);
const W = CONFIG.render.resolution_x;
const H = CONFIG.render.resolution_y;
const SS = 3;
const PAINT = new URLSearchParams(location.search).get('paint');

/** Ось сетки по горизонтали: во сколько раз сильнее света от середины. */
const KEYS = [0.55, 1.0, 1.75];
/** Ось сетки по вертикали: шероховатость лака. */
const ROUGH = [0.40, 0.50, 0.60];

const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W * SS, H * SS, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = AgXToneMapping;
renderer.toneMappingExposure = Math.pow(2, CONFIG.color_management?.exposure ?? 0);
document.body.append(renderer.domElement);

const scene = new Scene();

RectAreaLightUniformsLib.init();
/** Панели те же, что в боевом рендере; сетка крутит только общий множитель. */
const lamps = CONFIG.lights.map((item) => {
  const size = item.size ?? 2.5;
  const base = item.energy / (size * size * Math.PI);
  const light = new RectAreaLight(
    (item.color[0] * 255 << 16) | (item.color[1] * 255 << 8) | (item.color[2] * 255),
    base, size, size,
  );
  light.position.set(...item.location);
  light.lookAt(0, 0.7, 0);
  scene.add(light);
  return { light, base };
});
const sky = new HemisphereLight(0xdfe8f0, 0x0e1012, 0.30);
scene.add(sky);
scene.add(new AmbientLight(0xffffff, 0.06));

const setKey = (k) => {
  for (const lamp of lamps) lamp.light.intensity = lamp.base * k;
  sky.intensity = 0.30 * k;
};

const readback = document.createElement('canvas');
readback.width = W; readback.height = H;
const ctx = readback.getContext('2d', { willReadFrequently: true });

/**
 * Фильтр восстановления, он же Film → Filter Size в Blender. Кадр
 * размывается на ширину фильтра ещё в крупном разрешении и только потом
 * ужимается: одного ужимания мало, кромка остаётся ступенчатой.
 */
const FILTER = CONFIG.render.filter_size ?? 1.5;
const soft = document.createElement('canvas');
soft.width = W * SS; soft.height = H * SS;
const softCtx = soft.getContext('2d');
function downscale() {
  softCtx.clearRect(0, 0, soft.width, soft.height);
  softCtx.filter = FILTER > 1.5 ? 'blur(' + (FILTER * SS / 3).toFixed(2) + 'px)' : 'none';
  softCtx.drawImage(renderer.domElement, 0, 0);
  softCtx.filter = 'none';
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(soft, 0, 0, W, H);
}

function shoot() {
  renderer.render(scene, camera);
  downscale();
  const pixels = ctx.getImageData(0, 0, W, H);
  const copy = document.createElement('canvas');
  copy.width = W; copy.height = H;
  copy.getContext('2d').drawImage(readback, 0, 0);
  return { canvas: copy, pixels: pixels.data };
}

/** Медианная яркость непрозрачных пикселей: по ней выставляется середина. */
function medianLuma(pixels) {
  const values = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    values.push((pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255);
  }
  values.sort((a, b) => a - b);
  return values.length ? values[values.length >> 1] : 0;
}

let camera;
window.done = null;

new GLTFLoader().load('/source.glb', async (gltf) => {
  const root = gltf.scene;
  scene.add(root);
  root.updateWorldMatrix(true, true);

  const groups = { body: [], glass: [], light: [], tail: [], wheel: [] };
  root.traverse((node) => {
    if (node.isMesh && groups[node.material?.name]) groups[node.material.name].push(node);
  });
  if (groups.body.length === 0) { window.done = { error: 'в модели нет слоя body' }; return; }

  const box = new Box3().setFromObject(root);
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const half = CONFIG.camera.ortho_scale / 2;
  const dist = Math.max(size.x, size.z) * 4;
  camera = new OrthographicCamera(-half, half, half * H / W, -half * H / W, 0.01, dist * 4);
  camera.position.set(centre.x, centre.y, centre.z + dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(centre.x, centre.y, centre.z);

  const show = (names) => {
    for (const [key, list] of Object.entries(groups)) {
      for (const node of list) node.visible = names.includes(key);
    }
  };
  const original = new Map();
  for (const list of Object.values(groups)) for (const n of list) original.set(n, n.material);
  const swap = (list, material) => { for (const node of list) node.material = material; };

  const albedo = CONFIG.body?.albedo ?? 0.65;
  const grey = new MeshStandardMaterial({ metalness: 0 });
  grey.color.setRGB(albedo, albedo, albedo, LinearSRGBColorSpace);
  const gloss = new MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45,
  });

  // Калибровка: медиану кузова при среднем свете ставим в 0.55.
  show(['body']);
  swap(groups.body, grey);
  grey.roughness = ROUGH[1];
  setKey(1);
  const probe = medianLuma(shoot().pixels);
  const anchor = probe > 0.02 ? Math.min(8, Math.max(0.15, 0.55 / probe)) : 1;

  // Детали снимаются один раз: свет на них тот же, что на кузове.
  const cells = [];
  for (const rough of ROUGH) {
    for (const key of KEYS) {
      setKey(anchor * key);

      show(['body']);
      swap(groups.body, grey);
      grey.roughness = rough;
      const body = shoot();

      swap(groups.body, gloss);
      gloss.roughness = Math.max(0.45, rough + 0.1);
      const shade = shoot();
      swap(groups.body, original.get(groups.body[0]));

      show(['glass', 'light', 'tail', 'wheel']);
      const parts = shoot();

      cells.push({ rough, key, anchor, body, shade, parts, luma: medianLuma(body.pixels) });
    }
  }

  window.done = { sheet: draw(cells), anchor };

  /** Лист: клетки собираются ровно так, как их складывает игра. */
  function draw(cells) {
    const pad = 18;
    const head = 74;
    const foot = 26;
    const sheet = document.createElement('canvas');
    sheet.width = pad * 2 + W * 3;
    sheet.height = head + pad + (H + foot) * 3 + pad;
    const g = sheet.getContext('2d');

    g.fillStyle = '#16181a';
    g.fillRect(0, 0, sheet.width, sheet.height);

    g.fillStyle = '#d8d5ce';
    g.font = '600 20px system-ui, sans-serif';
    g.fillText('Сетка рендера: свет по горизонтали, шероховатость лака по вертикали', pad, 25);
    g.fillStyle = '#8e8b85';
    g.font = '13px system-ui, sans-serif';
    g.fillText(
      'Зафиксировано: AgX, базовый цвет кузова ' + albedo.toFixed(2)
      + ', Area-лампы 2.5-3 м, ключ : заполняющий : контровой = 1 : 1/3 : 1/6, рендер x3 с ужиманием.',
      pad, 44,
    );
    g.fillText('Клетка показана в масштабе спрайта — в игре машина в два с половиной раза мельче.', pad, 62);

    cells.forEach((cell, i) => {
      const col = i % 3;
      const row = (i / 3) | 0;
      const x = pad + col * W;
      const y = head + pad + row * (H + foot);

      g.fillStyle = '#101214';
      g.fillRect(x, y, W, H);

      // Кузов, помноженный на окраску, — то же умножение, что в игре.
      const tint = document.createElement('canvas');
      tint.width = W; tint.height = H;
      const t = tint.getContext('2d');
      t.drawImage(cell.body.canvas, 0, 0);
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = PAINT;
      t.fillRect(0, 0, W, H);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(cell.body.canvas, 0, 0);

      g.drawImage(tint, x, y);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.22;
      g.drawImage(cell.shade.canvas, x, y);
      g.restore();
      g.drawImage(cell.parts.canvas, x, y);

      g.strokeStyle = '#3d4247';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);

      g.fillStyle = '#8e8b85';
      g.font = '13px system-ui, sans-serif';
      // В подписи стоит ровно то, что уйдёт в camera.json для выбранной клетки.
      const label = (i + 1) + ')  lights_scale ' + (cell.anchor * cell.key).toFixed(2)
        + '   roughness ' + cell.rough.toFixed(2)
        + '   яркость кузова ' + cell.luma.toFixed(2);
      g.fillText(label, x + 4, y + H + 17);
    });

    return sheet.toDataURL('image/png');
  }
}, undefined, (error) => { window.done = { error: String(error) }; });
</script>
`;

// ── статика ──────────────────────────────────────────────────────────────────

const TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    const file = url === '/source.glb'
      ? resolve(model)
      : url.startsWith('/three/')
        ? resolve('node_modules/three', url.slice('/three/'.length))
        : null;
    if (!file) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((done) => server.listen(0, done));
const port = server.address().port;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('ошибка страницы:', error.message));

await page.goto(`http://localhost:${port}/?paint=${encodeURIComponent(paint)}`);
await page.waitForFunction(() => window.done !== null, null, { timeout: 300_000 });
const result = await page.evaluate(() => window.done);

await browser.close();
server.close();

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, Buffer.from(result.sheet.split(',')[1], 'base64'));
console.log(`${outFile}  (середина сетки: свет x${result.anchor.toFixed(2)} от паспортной мощности)`);
