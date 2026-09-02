/**
 * Подготовка исходной 3D-модели машины к игре.
 *
 * На вход — GLB как его отдал автор: с текстурами, салоном, двигателем и
 * шильдиками, весом в десятки мегабайт. На выходе — модель для витрины
 * в гараже: четыре меша с именами слоёв пайплайна, кузов красится параметром,
 * вес в сотни килобайт.
 *
 *   node scripts/prepare-car-model.mjs <вход.glb> <id-машины> [--cell 0.018]
 *
 * Браузер берётся из playwright (`npx playwright install chromium`);
 * если готовый Chromium лежит в другом месте — CHROMIUM_PATH=/путь/к/chrome.
 *
 * Что делает и почему:
 *
 * 1. Выбрасывает салон и двигатель — §11: при виде сбоку их не видно,
 *    а это 40% треугольников.
 * 2. Выбрасывает шильдики и таблички производителя — логотипы мы не
 *    воспроизводим (CLAUDE.md, юридические ограничения).
 * 3. Выбрасывает текстуры: цвет кузова в этой игре параметр, а не файл (§11).
 * 4. Сливает всё в пять мешей: body, glass, wheel, light, tail.
 *    Гараж красит материал с именем body — на этом держится окраска.
 * 5. Децимирует кластеризацией по решётке: вершины в одной ячейке сливаются
 *    в одну. Честный QEM был бы точнее, но требует внешней зависимости,
 *    а на витрине высотой 300 пикселей разница не читается.
 * 6. Ставит машину колёсами на ноль, длиной LENGTH_M метров и носом в +X —
 *    туда же, куда смотрят процедурные плейсхолдеры.
 *
 * Считает three.js в headless-Chromium: движок и браузер уже стоят в проекте,
 * так что ни одной новой зависимости.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const [, , input, carId, ...rest] = process.argv;

if (!input || !carId) {
  console.error('Использование: node scripts/prepare-car-model.mjs <вход.glb> <id-машины> [--cell 0.018]');
  process.exit(1);
}
if (!existsSync(input)) {
  console.error(`Нет файла: ${input}`);
  process.exit(1);
}

const cellIndex = rest.indexOf('--cell');
const cell = cellIndex >= 0 ? rest[cellIndex + 1] : '0.018';
/** --dry печатает разбор материалов по слоям и ничего не пишет на диск. */
const dry = rest.includes('--dry');
const output = `assets/models/${carId}.glb`;

// ── страница, которая делает всю работу в браузере ───────────────────────────
//
// Внимание: это шаблонная строка, и `\b` в ней — символ backspace, а не граница
// слова. Все границы слов в регулярках ниже экранированы двойным слэшем.

const PAGE = `<!doctype html>
<meta charset="utf-8" />
<script type="importmap">
{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}
</script>
<script type="module">
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Салон, двигатель, шильдики и таблички в игру не едут: первого и второго
 * сбоку не видно (§11), третье не воспроизводим по юридическим причинам.
 * Слои размытых дисков (*_Blur) — это ассеты для эффекта скорости
 * в исходной игре, нам они только мешают.
 */
const DROP = /badge|emblem|logo|plate_d|nameplate|manufacturerplate|\\bint_|interior|seat|carpet|stitch|dashboard|odometer|gauge|speaker|pedal|\\beng_|engine|blur|chassis_under/i;

/**
 * Материал исходника -> слой пайплайна. Порядок важен: первое совпадение.
 * Фары идут до стекла: HL_Glass и TL_Glass — это фонари, а не остекление.
 */
const GROUPS = [
  ['tail', /\\btl_|taillight|tail_?lamp|red_?glass/i],
  ['light', /\\bhl_|light|lamp|headlamp/i],
  ['glass', /glass|window|windscreen|windshield|glazing/i],
  ['wheel', /wheel|tyre|tire|_rim|\\brim|calliper|caliper|brake|disc/i],
  ['body', /paint|body|chassis|plastic|black|chrome|exhaust|mirror|coloured|colored|base|carbon|grille|kit|panel|trim|material/i],
];

const LENGTH_M = 4.6;
const CELL = Number(new URLSearchParams(location.search).get('cell'));

window.done = null;

/**
 * Слияние вершин по решётке: ячейка -> одна вершина, вырожденные грани вон.
 *
 * Нормали берутся из исходника и усредняются по ячейке, а не считаются заново
 * по огрублённой сетке. Это принципиально: затенение держится на нормалях,
 * и пересчёт по децимированной геометрии делает гладкий кузов гранёным.
 */
function cluster(geometry, cell) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  const count = index ? index.count : pos.count;
  const at = (i) => (index ? index.getX(i) : i);

  const map = new Map();
  const verts = [];
  const norms = [];
  const hits = [];
  const remap = new Int32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = Math.round(x / cell) + ',' + Math.round(y / cell) + ',' + Math.round(z / cell);
    let slot = map.get(key);
    if (slot === undefined) {
      slot = verts.length / 3;
      map.set(key, slot);
      verts.push(0, 0, 0);
      norms.push(0, 0, 0);
      hits.push(0);
    }
    // Вершина ячейки — центр тяжести попавших в неё, а не первая из них.
    // Первая сдвигает поверхность на целую ячейку в случайную сторону,
    // и на гладкой панели это читается как вмятина.
    verts[slot * 3] += x;
    verts[slot * 3 + 1] += y;
    verts[slot * 3 + 2] += z;
    if (nor) {
      norms[slot * 3] += nor.getX(i);
      norms[slot * 3 + 1] += nor.getY(i);
      norms[slot * 3 + 2] += nor.getZ(i);
    }
    hits[slot]++;
    remap[i] = slot;
  }

  const tris = [];
  for (let i = 0; i < count; i += 3) {
    const a = remap[at(i)], b = remap[at(i + 1)], c = remap[at(i + 2)];
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
  }

  for (let i = 0; i < hits.length; i++) {
    verts[i * 3] /= hits[i];
    verts[i * 3 + 1] /= hits[i];
    verts[i * 3 + 2] /= hits[i];
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(verts, 3));
  out.setIndex(tris);

  if (nor) {
    for (let i = 0; i < hits.length; i++) {
      const x = norms[i * 3], y = norms[i * 3 + 1], z = norms[i * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      norms[i * 3] = x / len;
      norms[i * 3 + 1] = y / len;
      norms[i * 3 + 2] = z / len;
    }
    out.setAttribute('normal', new Float32BufferAttribute(norms, 3));
  } else {
    out.computeVertexNormals();
  }
  return out;
}

const LOOK = {
  body: { color: 0xffffff, roughness: 0.42, metalness: 0.15 },
  glass: { color: 0x20262b, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 },
  wheel: { color: 0x1a1c1e, roughness: 0.55, metalness: 0 },
  light: { color: 0xf0dcc0, roughness: 0.25, metalness: 0 },
  tail: { color: 0xc04a35, roughness: 0.3, metalness: 0 },
};

new GLTFLoader().load('/car.glb', (gltf) => {
  const car = gltf.scene;
  car.updateWorldMatrix(true, true);

  const buckets = new Map(GROUPS.map(([name]) => [name, []]));
  let dropped = 0;

  const mapping = new Map();

  car.traverse((node) => {
    if (!node.isMesh) return;
    const label = (node.material?.name ?? '') + ' ' + (node.name ?? '');
    const material = node.material?.name ?? '(без имени)';
    if (DROP.test(label)) { dropped++; mapping.set(material, 'выброшен'); return; }
    const hit = GROUPS.find(([, re]) => re.test(label));
    if (!hit) { dropped++; mapping.set(material, 'выброшен (не опознан)'); return; }
    mapping.set(material, hit[0]);
    const geometry = new BufferGeometry();
    const src = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry;
    geometry.setAttribute('position', src.getAttribute('position').clone());
    const normal = src.getAttribute('normal');
    if (normal) geometry.setAttribute('normal', normal.clone());
    // applyMatrix4 сам приводит нормали нормальной матрицей — вращение
    // и масштаб доедут до них правильно.
    geometry.applyMatrix4(node.matrixWorld);
    buckets.get(hit[0]).push(geometry);
  });

  // Габарит в единицах исходника: решётка задаётся в метрах, а модель
  // приходит в своём масштабе — без пересчёта ячейка врёт в сотни раз.
  const whole = new Box3();
  for (const list of buckets.values()) {
    for (const geometry of list) {
      geometry.computeBoundingBox();
      whole.union(geometry.boundingBox);
    }
  }
  const rawSize = whole.getSize(new Vector3());
  const cellUnits = CELL * (Math.max(rawSize.x, rawSize.z) / LENGTH_M);

  /**
   * Решётка накладывается на каждый исходный меш отдельно, а не на слитый слой.
   * Иначе соседние панели — дверь и крыло, порог и юбка — свариваются в одну
   * вершину, и по стыкам расходятся щели. Именно они и читаются как царапины.
   *
   * Мелкие детали не трогаем совсем: там нечего экономить, а испортить легко.
   */
  const KEEP_WHOLE = 240;

  // mergeGeometries требует одинакового набора атрибутов и одинаковой
  // индексации у всех кусков — приводим к общему виду.
  const ready = (geometry) => {
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    if (!geometry.getIndex()) {
      const n = geometry.getAttribute('position').count;
      geometry.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    return geometry;
  };

  const merged = new Map();
  for (const [name, list] of buckets) {
    if (list.length === 0) continue;
    const pieces = list.map((geometry) => {
      const tris = geometry.getAttribute('position').count / 3;
      return ready(tris <= KEEP_WHOLE ? geometry : cluster(geometry, cellUnits));
    });
    merged.set(name, {
      before: list.reduce((sum, g) => sum + g.getAttribute('position').count / 3, 0),
      geometry: BufferGeometryUtils.mergeGeometries(pieces, false),
    });
  }

  const group = new Group();
  const stats = {};
  for (const [name, item] of merged) {
    const { geometry, before } = item;
    const decimated = geometry;
    const faces = decimated.getIndex()
      ? decimated.getIndex().count / 3
      : decimated.getAttribute('position').count / 3;
    stats[name] = { before: Math.round(before), after: Math.round(faces) };
    const material = new MeshStandardMaterial(LOOK[name]);
    material.name = name;
    const mesh = new Mesh(decimated, material);
    mesh.name = name;
    group.add(mesh);
  }

  const box = new Box3().setFromObject(group);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const alongX = size.x >= size.z;
  const scale = LENGTH_M / (alongX ? size.x : size.z);
  // Плейсхолдеры лежат длиной по X и носом в +X. Модель, снятая длиной по Z,
  // доворачивается на 90°, иначе в гараже она стоит боком к остальным.
  const turn = alongX ? 0 : Math.PI / 2;

  for (const mesh of group.children) {
    mesh.geometry.translate(-centre.x, -box.min.y, -centre.z);
    mesh.geometry.scale(scale, scale, scale);
    mesh.geometry.rotateY(turn);
  }

  new GLTFExporter().parse(group, (glb) => {
    const bytes = new Uint8Array(glb);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    window.done = {
      glb: btoa(binary),
      stats,
      dropped,
      mapping: [...mapping.entries()],
      sizeM: [size.x, size.y, size.z].map((v) => +(v * scale).toFixed(2)),
    };
  }, (error) => { window.done = { error: String(error) }; }, { binary: true });
}, undefined, (error) => { window.done = { error: String(error) }; });
</script>
`;

// ── статика для страницы ─────────────────────────────────────────────────────

const TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    const file = url === '/car.glb'
      ? resolve(input)
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

// В обычной среде браузер ставится через `npx playwright install`.
// CHROMIUM_PATH нужен там, где готовый Chromium лежит в другом месте.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('ошибка страницы:', error.message));

await page.goto(`http://localhost:${port}/?cell=${cell}`);
await page.waitForFunction(() => window.done !== null, null, { timeout: 300_000 });
const result = await page.evaluate(() => window.done);
await browser.close();
server.close();

if (result.error) {
  console.error('Не собралось:', result.error);
  process.exit(1);
}

if (dry) {
  console.log(`разбор материалов ${input}:`);
  for (const [material, layer] of result.mapping.sort()) {
    console.log(`  ${layer.padEnd(22)} ${material}`);
  }
  process.exit(0);
}

writeFileSync(output, Buffer.from(result.glb, 'base64'));

console.log(`${input} -> ${output}`);
console.log(`габарит ${result.sizeM.join(' x ')} м, ячейка ${cell} м, выброшено мешей ${result.dropped}`);
for (const [name, s] of Object.entries(result.stats)) {
  console.log(`  ${name.padEnd(6)} ${String(s.before).padStart(7)} -> ${String(s.after).padStart(6)} треугольников`);
}
console.log(`вес ${(readFileSync(output).length / 1024).toFixed(0)} КБ`);
