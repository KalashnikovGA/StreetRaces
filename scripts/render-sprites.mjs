/**
 * Рендер слоёных 2D-спрайтов. Шаг 8 из §14.
 *
 *   node scripts/render-sprites.mjs --car <id>
 *   node scripts/render-sprites.mjs --scene wall|road --from <файл.glb>
 *
 * Машина берётся из assets/models/<id>.glb — это подготовленная модель,
 * у которой меши уже разложены по слоям (scripts/prepare-car-model.mjs).
 * На выходе — public/sprites/<id>/ со слоями и layers.json.
 *
 * Незыблемое правило (render-pipeline): камера настраивается один раз и
 * больше не меняется. Параметры лежат в assets/render/camera.json, менять
 * только с полным перерендером всей библиотеки — иначе слои перестанут
 * совпадать по пикселям.
 *
 * Слои и как они складываются на канве:
 *
 *   body   белый, с мягкой диффузной тенью. Умножается на цвет окраски,
 *          поэтому любая окраска — строка конфига, а не файл (§11).
 *   shade  только блики, снятые на чёрном. Кладётся поверх режимом lighter,
 *          иначе тёмная машина выглядит плоской заливкой.
 *   glass  остекление.
 *   light  фары.
 *   tail   задние фонари. Отдельно от фар, потому что на финише и при
 *          торможении они загораются, а фары нет.
 *   wheel  одно колесо квадратом. Сцена крутит его вокруг центра, поэтому
 *          в общий слой оно не входит: центры и радиус лежат в layers.json.
 *
 * Браузер берётся из playwright; CHROMIUM_PATH переопределяет путь.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : null;
};

const carId = flag('car');
const sceneName = flag('scene');
const from = flag('from');

if (!carId && !sceneName) {
  console.error('Использование: --car <id> | --scene wall|road --from <файл.glb>');
  process.exit(1);
}

const CAMERA = JSON.parse(readFileSync('assets/render/camera.json', 'utf8'));
const source = carId ? `assets/models/${carId}.glb` : from;

if (!source || !existsSync(source)) {
  console.error(`Нет файла: ${source}`);
  process.exit(1);
}

const outDir = carId ? `public/sprites/${carId}` : 'public/sprites/scene';
mkdirSync(outDir, { recursive: true });

// ── страница ─────────────────────────────────────────────────────────────────
//
// Внимание: шаблонная строка. `\b` здесь — символ backspace, границы слов
// в регулярках экранируются двойным слэшем.

const PAGE = `<!doctype html>
<meta charset="utf-8" />
<style>html,body{margin:0;background:#000}</style>
<script type="importmap">
{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}
</script>
<script type="module">
import {
  AmbientLight, Box3, DirectionalLight, Mesh, MeshPhysicalMaterial,
  MeshStandardMaterial, OrthographicCamera, Scene, SRGBColorSpace, Vector3,
  WebGLRenderer, ACESFilmicToneMapping,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CONFIG = JSON.parse(document.getElementById('config').textContent);
const W = CONFIG.render.resolution_x;
const H = CONFIG.render.resolution_y;

const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.append(renderer.domElement);

const scene = new Scene();

/**
 * Риг из трёх ламп, одинаковый для всех деталей и всех машин. Разный свет —
 * и слои выглядят вырезанными из разных картинок (§11).
 */
for (const item of CONFIG.lights) {
  const light = new DirectionalLight(
    (item.color[0] * 255 << 16) | (item.color[1] * 255 << 8) | (item.color[2] * 255),
    item.energy / 300,
  );
  light.position.set(...item.location);
  scene.add(light);
}
scene.add(new AmbientLight(0xffffff, 0.35));

const readback = document.createElement('canvas');
readback.width = W; readback.height = H;
const ctx = readback.getContext('2d', { willReadFrequently: true });

function shoot() {
  renderer.render(scene, camera);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(renderer.domElement, 0, 0);
  return { png: readback.toDataURL('image/png'), pixels: ctx.getImageData(0, 0, W, H).data };
}

/** Габарит непрозрачного в кадре. */
function bounds(pixels) {
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (pixels[(y * W + x) * 4 + 3] <= 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, x1, y0, y1 };
}

/** Кусок кадра отдельной картинкой: колесо крутится, значит живёт само. */
function crop(png, box) {
  return new Promise((done) => {
    const image = new Image();
    image.onload = () => {
      const cut = document.createElement('canvas');
      cut.width = box.x1 - box.x0 + 1;
      cut.height = box.y1 - box.y0 + 1;
      cut.getContext('2d').drawImage(image, -box.x0, -box.y0);
      done(cut.toDataURL('image/png'));
    };
    image.src = png;
  });
}

let camera;
window.done = null;

const MODE = new URLSearchParams(location.search).get('mode');

new GLTFLoader().load('/source.glb', async (gltf) => {
  const root = gltf.scene;
  scene.add(root);
  root.updateWorldMatrix(true, true);

  if (MODE === 'car') await renderCar(root);
  else await renderScene(root);
}, undefined, (error) => { window.done = { error: String(error) }; });

// ── машина ───────────────────────────────────────────────────────────────────

async function renderCar(root) {
  const groups = { body: [], glass: [], light: [], tail: [], wheel: [] };
  root.traverse((node) => {
    if (!node.isMesh) return;
    const key = node.material?.name ?? node.name;
    if (groups[key]) groups[key].push(node);
  });

  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const length = Math.max(size.x, size.z);

  // Кадр задаётся ortho_scale из camera.json, а не габаритом конкретной машины.
  // Это и есть незыблемое правило: камера одна на всю библиотеку, иначе
  // спрайты разных машин нельзя сравнить между собой.
  const half = CONFIG.camera.ortho_scale / 2;
  const dist = length * 4;
  camera = new OrthographicCamera(-half, half, half * H / W, -half * H / W, 0.01, dist * 4);
  // Нос модели смотрит в +X, значит камера встаёт на +Z: тогда на экране
  // машина едет вправо, как и рисовалась вектором.
  camera.position.set(centre.x, centre.y, centre.z + dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(centre.x, centre.y, centre.z);

  const show = (names) => {
    for (const [key, list] of Object.entries(groups)) {
      for (const node of list) node.visible = names.includes(key);
    }
  };

  const white = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.66, metalness: 0.0 });
  // Блики снимаются на чёрном: в кадр попадает только то, что даёт лак.
  const gloss = new MeshPhysicalMaterial({
    color: 0x000000, roughness: 0.24, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.12,
  });
  const original = new Map();
  for (const list of Object.values(groups)) {
    for (const node of list) original.set(node, node.material);
  }

  const out = {};

  const swap = (list, material) => { for (const node of list) node.material = material; };

  show(['body']);
  swap(groups.body, white);
  const body = shoot();
  out.body = body.png;

  swap(groups.body, gloss);
  out.shade = shoot().png;
  swap(groups.body, original.get(groups.body[0]));

  show(['glass']);
  out.glass = shoot().png;

  show(['light']);
  out.light = shoot().png;

  show(['tail']);
  out.tail = shoot().png;

  show(['wheel']);
  const wheels = shoot();

  const bodyBox = bounds(body.pixels);
  const wheelBox = bounds(wheels.pixels);

  // Два колеса: делим кадр по середине машины и обмеряем каждую половину.
  const mid = (bodyBox.x0 + bodyBox.x1) / 2;
  const halves = [{ x0: W, x1: -1, y0: H, y1: -1 }, { x0: W, x1: -1, y0: H, y1: -1 }];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (wheels.pixels[(y * W + x) * 4 + 3] <= 24) continue;
      const slot = halves[x < mid ? 0 : 1];
      if (x < slot.x0) slot.x0 = x;
      if (x > slot.x1) slot.x1 = x;
      if (y < slot.y0) slot.y0 = y;
      if (y > slot.y1) slot.y1 = y;
    }
  }

  const circles = halves.map((h) => ({
    cx: Math.round((h.x0 + h.x1) / 2),
    cy: Math.round((h.y0 + h.y1) / 2),
    r: Math.round(Math.max(h.x1 - h.x0, h.y1 - h.y0) / 2),
  }));

  // Спрайт колеса — квадрат вокруг переднего: сцена крутит его вокруг центра.
  const front = circles[1];
  out.wheel = await crop(wheels.png, {
    x0: front.cx - front.r, x1: front.cx + front.r,
    y0: front.cy - front.r, y1: front.cy + front.r,
  });

  window.done = {
    images: out,
    meta: {
      frame: [W, H],
      box: bodyBox,
      ground: Math.max(bodyBox.y1, wheelBox.y1),
      wheels: circles,
      length_m: +length.toFixed(3),
    },
  };
}

// ── декорация: стена и дорога ────────────────────────────────────────────────

async function renderScene(root) {
  const axis = new URLSearchParams(location.search).get('axis') || 'z';

  // Дорога лежит в модели по диагонали. Главную ось считаем по облаку точек
  // и доворачиваем полотно вдоль X, иначе тайл не состыкуется сам с собой.
  if (axis === 'y') {
    let sxx = 0, szz = 0, sxz = 0, n = 0;
    const centreXZ = new Box3().setFromObject(root).getCenter(new Vector3());
    root.traverse((node) => {
      if (!node.isMesh) return;
      const pos = node.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 7) {
        const v = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(node.matrixWorld);
        const x = v.x - centreXZ.x, z = v.z - centreXZ.z;
        sxx += x * x; szz += z * z; sxz += x * z; n++;
      }
    });
    const angle = 0.5 * Math.atan2(2 * sxz / n, (sxx - szz) / n);
    // Поворот на +angle кладёт главную ось облака точек на X: полотно дороги
    // становится горизонтальным, и его можно тайлить вдоль экрана.
    root.rotation.y = angle;
    root.updateWorldMatrix(true, true);
  }

  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const plane = axis === 'y' ? [size.x, size.z] : [size.x, size.y];
  const dist = Math.max(size.x, size.y, size.z) * 4;

  const half = plane[0] / 2;
  const halfY = half * H / W;
  camera = new OrthographicCamera(-half, half, halfY, -halfY, 0.01, dist * 4);
  camera.position.copy(centre).add(
    axis === 'y' ? new Vector3(0, dist, 0) : new Vector3(0, 0, dist),
  );
  camera.up.set(...(axis === 'y' ? [0, 0, -1] : [0, 1, 0]));
  camera.lookAt(centre);

  // Декорация приходит с текстурами — в ней вся суть, снимать её нельзя.
  const shot = shoot();
  const box2d = bounds(shot.pixels);
  const cut = await crop(shot.png, box2d);

  window.done = {
    images: { sprite: cut },
    meta: { frame: [box2d.x1 - box2d.x0 + 1, box2d.y1 - box2d.y0 + 1], size_m: [+plane[0].toFixed(2), +plane[1].toFixed(2)] },
  };
}
</script>
`;

// ── статика ──────────────────────────────────────────────────────────────────

const TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary' };

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/' || url === '/index.html') {
      const html = PAGE.replace(
        '<script type="module">',
        `<script type="application/json" id="config">${JSON.stringify(CAMERA)}</script>\n<script type="module">`,
      );
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    const file = url === '/source.glb'
      ? resolve(source)
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

const mode = carId ? 'car' : 'scene';
const axis = sceneName === 'road' ? 'y' : 'z';
await page.goto(`http://localhost:${port}/?mode=${mode}&axis=${axis}`);
await page.waitForFunction(() => window.done !== null, null, { timeout: 300_000 });
const result = await page.evaluate(() => window.done);
await browser.close();
server.close();

if (result.error) {
  console.error('Не отрендерилось:', result.error);
  process.exit(1);
}

let total = 0;
for (const [name, dataUrl] of Object.entries(result.images)) {
  const file = carId ? `${outDir}/${name}.png` : `${outDir}/${sceneName}.png`;
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(file, bytes);
  total += bytes.length;
  console.log(`  ${file.padEnd(34)} ${(bytes.length / 1024).toFixed(0).padStart(5)} КБ`);
}

if (carId) {
  const manifest = {
    id: carId,
    ...result.meta,
    // Порядок наложения. Колесо в списке не участвует: сцена рисует его
    // отдельно и с поворотом.
    order: ['body', 'shade', 'glass', 'light', 'tail'],
  };
  writeFileSync(`${outDir}/layers.json`, JSON.stringify(manifest, null, 2));
  console.log(`  ${outDir}/layers.json`);
  console.log(`колёса: ${manifest.wheels.map((w) => `${w.cx},${w.cy} r${w.r}`).join('  ')}  земля ${manifest.ground}`);
}

console.log(`итого ${(total / 1024).toFixed(0)} КБ`);
