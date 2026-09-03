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
/** Сколько раз усреднить нормали кузова. 0 — не трогать. */
const smoothIndex = rest.indexOf('--smooth');
const smooth = smoothIndex >= 0 ? rest[smoothIndex + 1] : '2';
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
  // Рассеиватель фары идёт к фарам, а не к стёклам: остекление тёмное,
  // и вместе с ним чернела фара. Материал у рассеивателя свой, поэтому
  // развести их можно правилом.
  ['light', /\\bhl_|light|lamp|headlamp|lens/i],
  ['glass', /glass|window|windscreen|windshield|glazing/i],
  ['tyre', /tyre|tire/i],
  ['rim', /_rim|\\brim|spoke|\\bhub|calliper|caliper|brake|disc|bolt/i],
  ['wheel', /wheel/i],
  ['chrome', /chrome/i],
  // Пластик бывает и крылом: у Evo широкие панели пластиковые, но крашеные.
  // В trim идёт только заведомо нецветное — чёрное, решётки, зеркала, хром.
  ['trim', /grille|grill|mirror|exhaust|carbon|rubber|vent|molding|moulding|_black|\\bblack|\\btrim/i],
  ['body', /paint|coat|body|chassis|plastic|coloured|colored|base|kit|panel|material/i],
];

const LENGTH_M = 4.6;
const CELL = Number(new URLSearchParams(location.search).get('cell'));
const SMOOTH = Number(new URLSearchParams(location.search).get('smooth'));

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

/**
 * Сглаживание затенения слоя. Двигаются только нормали — позиции остаются
 * на месте, поэтому силуэт, складки и подштамповки никуда не деваются,
 * меняется лишь то, как по ним ложится свет.
 *
 * Два шага:
 *
 * 1. Сварка по положению. У стыка панелей — дверь и крыло, порог и юбка —
 *    вершины принадлежат разным мешам, нормали у них разные, и на рендере
 *    шов читается жёсткой границей, почти как царапина. Общая нормаль
 *    на общую точку эту границу убирает.
 * 2. Лапласиан по рёбрам: нормаль подтягивается к среднему по соседям.
 *    Убирает мелкую рябь, оставшуюся от децимации. Больше двух-трёх
 *    проходов уже слизывает бортовую линию, поэтому число — параметр.
 */
function smoothNormals(geometry, weld, iterations) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!nor || !index) return geometry;

  const count = pos.count;
  const slotOf = new Int32Array(count);
  const map = new Map();
  let slots = 0;
  for (let i = 0; i < count; i++) {
    const key = Math.round(pos.getX(i) / weld) + ',' +
                Math.round(pos.getY(i) / weld) + ',' +
                Math.round(pos.getZ(i) / weld);
    let slot = map.get(key);
    if (slot === undefined) { slot = slots++; map.set(key, slot); }
    slotOf[i] = slot;
  }

  let nx = new Float32Array(slots), ny = new Float32Array(slots), nz = new Float32Array(slots);
  for (let i = 0; i < count; i++) {
    const s = slotOf[i];
    nx[s] += nor.getX(i); ny[s] += nor.getY(i); nz[s] += nor.getZ(i);
  }
  const unit = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  for (let s = 0; s < slots; s++) {
    const [x, y, z] = unit(nx[s], ny[s], nz[s]);
    nx[s] = x; ny[s] = y; nz[s] = z;
  }

  if (iterations > 0) {
    // Соседи по рёбрам треугольников, уже в сваренных точках.
    const neighbours = Array.from({ length: slots }, () => new Set());
    for (let i = 0; i < index.count; i += 3) {
      const a = slotOf[index.getX(i)], b = slotOf[index.getX(i + 1)], c = slotOf[index.getX(i + 2)];
      neighbours[a].add(b); neighbours[a].add(c);
      neighbours[b].add(a); neighbours[b].add(c);
      neighbours[c].add(a); neighbours[c].add(b);
    }
    const LAMBDA = 0.5;
    for (let pass = 0; pass < iterations; pass++) {
      const ox = new Float32Array(slots), oy = new Float32Array(slots), oz = new Float32Array(slots);
      for (let s = 0; s < slots; s++) {
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const j of neighbours[s]) { sx += nx[j]; sy += ny[j]; sz += nz[j]; n++; }
        if (n === 0) { ox[s] = nx[s]; oy[s] = ny[s]; oz[s] = nz[s]; continue; }
        const [x, y, z] = unit(
          nx[s] + LAMBDA * (sx / n - nx[s]),
          ny[s] + LAMBDA * (sy / n - ny[s]),
          nz[s] + LAMBDA * (sz / n - nz[s]),
        );
        ox[s] = x; oy[s] = y; oz[s] = z;
      }
      nx = ox; ny = oy; nz = oz;
    }
  }

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = slotOf[i];
    out[i * 3] = nx[s]; out[i * 3 + 1] = ny[s]; out[i * 3 + 2] = nz[s];
  }
  geometry.setAttribute('normal', new Float32BufferAttribute(out, 3));
  return geometry;
}

/**
 * Слои с собственным цветом. Красится только body — остальное и делает
 * машину машиной: чёрные окантовки окон, решётки, зеркало, бампера, хромовые
 * молдинги, светлый диск на тёмной резине. Свали их в кузов, и от машины
 * останется одно цветное пятно.
 */
/**
 * Выбросить треугольники, чьи центры стоят близко к середине машины.
 * Настоящие колёса живут на осях, у краёв; всё колёсное в середине — запаска.
 */
function cullMiddle(geometry, alongX, middle, span, minOffset) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const verts = [];
  const norms = [];
  for (let i = 0; i < pos.count; i += 3) {
    const c = (alongX
      ? (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2))
      : (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2))) / 3;
    if (Math.abs(c - middle) / span <= minOffset) continue;
    for (let k = 0; k < 3; k++) {
      verts.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      if (nor) norms.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
    }
  }
  if (verts.length === 0) return null;

  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(verts, 3));
  if (nor) out.setAttribute('normal', new Float32BufferAttribute(norms, 3));
  out.computeBoundingBox();
  return out;
}

/**
 * Разделить треугольники по половине машины: wantFront — та половина,
 * куда смотрит нос. Возвращает { inside, outside }; пустая половина — null.
 */
function splitByHalf(geometry, alongX, middle, nose, wantFront) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const halves = [[[], []], [[], []]];
  for (let i = 0; i < pos.count; i += 3) {
    const c = (alongX
      ? (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2))
      : (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2))) / 3;
    const atFront = (c - middle) * nose > 0;
    const [verts, norms] = halves[atFront === wantFront ? 0 : 1];
    for (let k = 0; k < 3; k++) {
      verts.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      if (nor) norms.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
    }
  }
  const build = ([verts, norms]) => {
    if (verts.length === 0) return null;
    const out = new BufferGeometry();
    out.setAttribute('position', new Float32BufferAttribute(verts, 3));
    if (norms.length) out.setAttribute('normal', new Float32BufferAttribute(norms, 3));
    out.computeBoundingBox();
    return out;
  };
  return { inside: build(halves[0]), outside: build(halves[1]) };
}

/**
 * Занять решётку треугольниками: ключ ячейки -> есть/нет. Нужно, чтобы
 * спросить «а лежит ли этот треугольник там же, где лампа».
 */
function occupy(list, cell, ring) {
  const cells = new Set();
  for (const geometry of list) {
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const gx = Math.floor(pos.getX(i) / cell);
      const gy = Math.floor(pos.getY(i) / cell);
      const gz = Math.floor(pos.getZ(i) / cell);
      // Ячейка и её соседи: окантовка блока лежит впритык к стеклу,
      // но своих вершин с ним не делит.
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dz = -ring; dz <= ring; dz++) {
            cells.add((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz));
          }
        }
      }
    }
  }
  return cells;
}

/**
 * Разделить треугольники по тому, попадает ли центр в занятые ячейки.
 * Возвращает { inside, outside }; пустая половина приходит как null.
 */
function splitByCells(geometry, cells, cell) {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const halves = [[[], []], [[], []]];
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const key = Math.floor(cx / cell) + ',' + Math.floor(cy / cell) + ',' + Math.floor(cz / cell);
    const [verts, norms] = halves[cells.has(key) ? 0 : 1];
    for (let k = 0; k < 3; k++) {
      verts.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      if (nor) norms.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
    }
  }
  const build = ([verts, norms]) => {
    if (verts.length === 0) return null;
    const out = new BufferGeometry();
    out.setAttribute('position', new Float32BufferAttribute(verts, 3));
    if (norms.length) out.setAttribute('normal', new Float32BufferAttribute(norms, 3));
    out.computeBoundingBox();
    return out;
  };
  return { inside: build(halves[0]), outside: build(halves[1]) };
}

const LOOK = {
  body: { color: 0xffffff, roughness: 0.42, metalness: 0.15 },
  trim: { color: 0x24262a, roughness: 0.62, metalness: 0.0 },
  // Металл без карты окружения отражать нечего: при metalness под единицу
  // хром и диск выходят чёрными пятнами. Держим металличность низкой,
  // а светлоту берём базовым цветом — иначе деталей колеса просто не видно.
  chrome: { color: 0xc8ccd2, roughness: 0.22, metalness: 0.35 },
  // Стекло непрозрачное. Прозрачность нужна была салону, а салон
  // из модели выброшен; зато сквозь неё просвечивало зеркало заднего вида —
  // его стекло сидит в том же материале, и сбоку зеркало выходило призраком.
  // Стекло тёмное, но не чёрное: при нулевой шероховатости оно ловит
  // отражение софтбокса, и окно читается стеклом, а не дырой в кузове.
  glass: { color: 0x23282d, roughness: 0.04, metalness: 0.2 },
  // Резина в исходнике держалась на текстуре, а текстуры мы выбрасываем.
  // Без неё покрышка при шероховатости 0.85 — ровное чёрное кольцо.
  // На 0.6 по боковине идёт блик от окружения, и она становится круглой.
  tyre: { color: 0x17191c, roughness: 0.72, metalness: 0.02 },
  rim: { color: 0xb4b9c0, roughness: 0.4, metalness: 0.2 },
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

  /**
   * Подставка под машину. Авторы моделей часто кладут под неё плоскую плиту
   * или диск — сбоку он стоит ребром и не виден, а в три четверти это белый
   * лист под колёсами. Выбрасываем всё плоское и широкое: у настоящей детали
   * машины таких пропорций не бывает.
   */
  {
    const flat = (box) => {
      const s = box.getSize(new Vector3());
      const footprint = (s.x * s.z) / (rawSize.x * rawSize.z);
      return s.y < rawSize.y * 0.03 && footprint > 0.45;
    };
    for (const [name, list] of buckets) {
      const keep = list.filter((geometry) => !flat(geometry.boundingBox));
      if (keep.length !== list.length) dropped += list.length - keep.length;
      buckets.set(name, keep);
    }
  }
  // Габарит пересчитывается: подставку выбросили, и с ней уехали и размер,
  // и середина машины — а по ним отбираются запасные колёса.
  whole.makeEmpty();
  for (const list of buckets.values()) {
    for (const geometry of list) {
      geometry.computeBoundingBox();
      whole.union(geometry.boundingBox);
    }
  }
  rawSize.copy(whole.getSize(new Vector3()));

  /**
   * Запасные колёса. В сборках часто лежит несколько вариантов дисков,
   * сваленных к середине машины: сбоку они прятались за настоящими, а в три
   * четверти торчат прямо из двери. У машины ровно две оси, поэтому всё
   * колёсное вне краёв — лишнее.
   */
  {
    const alongX = rawSize.x >= rawSize.z;
    const span = alongX ? rawSize.x : rawSize.z;
    const centre = whole.getCenter(new Vector3());
    const middle = alongX ? centre.x : centre.z;
    for (const name of ['wheel', 'tyre', 'rim']) {
      const list = buckets.get(name);
      if (!list?.length) continue;
      // Отбираем по треугольникам, а не по мешам: все колёса, включая
      // запасные, обычно лежат одним мешем, и целиком его не выбросить.
      const keep = [];
      for (const geometry of list) {
        const cut = cullMiddle(geometry, alongX, middle, span, 0.16);
        if (cut) keep.push(cut); else dropped++;
      }
      buckets.set(name, keep);
    }
  }

  const cellUnits = CELL * (Math.max(rawSize.x, rawSize.z) / LENGTH_M);

  /**
   * Крупная панель — это кузов, а не накладка.
   *
   * Авторы моделей вешают «чёрный пластик» и на окантовку окна, и на всё
   * переднее крыло разом. Первое красить нельзя, второе — нужно, иначе
   * у машины одно крыло чёрное, а другое в цвет. Разбираем по площади
   * в виде сбоку: накладка занимает считанные проценты, панель — десятки.
   */
  const alongXRaw = rawSize.x >= rawSize.z;
  const sideArea = (box) => {
    const size = box.getSize(new Vector3());
    return (alongXRaw ? size.x : size.z) * size.y;
  };
  const wholeSide = (alongXRaw ? rawSize.x : rawSize.z) * rawSize.y;
  const PANEL_SHARE = 0.08;

  if (buckets.get('trim')?.length && buckets.get('body')) {
    const keep = [];
    for (const geometry of buckets.get('trim')) {
      if (sideArea(geometry.boundingBox) > wholeSide * PANEL_SHARE) {
        buckets.get('body').push(geometry);
      } else {
        keep.push(geometry);
      }
    }
    buckets.set('trim', keep);
  }

  /**
   * Красное — только сзади.
   *
   * Авторы вешают один материал «отражатель фонаря» и на задние фонари,
   * и на передние повторители, а один материал «рассеиватель» — и на фару,
   * и на фонарь. В итоге у машины спереди поперёк фары лежит красное пятно,
   * а сзади фонарь выходит белым.
   *
   * Разводим по месту, а не по имени: где перёд, а где корма, говорит сама
   * модель — центр тяжести фар лежит спереди, центр тяжести фонарей сзади.
   * Всё «фонарное» на передней половине уезжает в фары, всё «фарное»
   * на задней — в фонари.
   */
  {
    const alongLamp = rawSize.x >= rawSize.z;
    const middle = whole.getCenter(new Vector3());
    const mid = alongLamp ? middle.x : middle.z;
    const centreOf = (list) => {
      if (!list?.length) return null;
      let sum = 0, n = 0;
      for (const geometry of list) {
        const c = geometry.boundingBox.getCenter(new Vector3());
        sum += alongLamp ? c.x : c.z; n++;
      }
      return sum / n;
    };
    const front = centreOf(buckets.get('light'));
    const back = centreOf(buckets.get('tail'));
    if (front !== null && back !== null && front !== back) {
      // +1, если нос смотрит в плюс оси; -1, если в минус.
      const nose = front > back ? 1 : -1;
      const move = (from, to, wantFront) => {
        const keep = [];
        for (const geometry of buckets.get(from) ?? []) {
          const { inside, outside } = splitByHalf(geometry, alongLamp, mid, nose, wantFront);
          if (inside) buckets.get(to).push(inside);
          if (outside) keep.push(outside);
        }
        buckets.set(from, keep);
      };
      move('tail', 'light', true);
      move('light', 'tail', false);
    }
  }

  /**
   * Отражатель фары — не хром, а внутренность блока.
   *
   * У сборок весь хром сидит в одном материале: молдинги, зеркало, патрубки
   * выпуска и заодно чаша отражателя внутри фары. Строго сбоку стекло фары
   * стоит к камере ребром, и в проём крыла видно эту чашу — светлым клином
   * с острым концом, воткнутым в переднюю часть. На фотографии машины сбоку
   * такого клина нет: там фара читается узкой полосой стекла на крыле.
   *
   * Поэтому весь хром, лежащий в тех же ячейках решётки, что и стекло
   * лампы, уезжает в кузов: место фары становится продолжением крыла,
   * а от самой фары остаётся её стекло — ровно то, что видно сбоку.
   */
  {
    const lampCell = Math.max(rawSize.x, rawSize.z) * 0.012;
    const lamps = [...(buckets.get('light') ?? []), ...(buckets.get('tail') ?? [])];
    const chrome = buckets.get('chrome');
    if (lamps.length && chrome?.length && buckets.get('body')) {
      const cells = occupy(lamps, lampCell, 1);
      const keep = [];
      for (const geometry of chrome) {
        const { inside, outside } = splitByCells(geometry, cells, lampCell);
        if (inside) buckets.get('body').push(inside);
        if (outside) keep.push(outside);
      }
      buckets.set('chrome', keep);
    }

    /**
     * Внутренность блока фары — не кузов.
     *
     * Чаша фары у этой сборки сделана из того же «пластика», что бампера,
     * а бампера у машины крашеные, поэтому пластик уезжает в кузов. В итоге
     * поперёк фары ложилось красное пятно: сквозь стекло видно окрашенную
     * чашу. Всё кузовное внутри блока лампы уходит в тёмную накладку —
     * там ему и место, а заодно темнеет тонкое кольцо уплотнителя вокруг
     * стекла, что тоже правильно.
     */
    const body = buckets.get('body');
    if (lamps.length && body?.length && buckets.get('trim')) {
      const tight = occupy(lamps, lampCell, 0);
      const keep = [];
      for (const geometry of body) {
        const { inside, outside } = splitByCells(geometry, tight, lampCell);
        if (inside) buckets.get('trim').push(inside);
        if (outside) keep.push(outside);
      }
      buckets.set('body', keep);
    }
  }

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
    const geometry = BufferGeometryUtils.mergeGeometries(pieces, false);
    // Сглаживается только кузов: у стекла, фар и колёс своих швов нет,
    // а сварка нормалей колеса с кузовом была бы просто ошибкой.
    if (name === 'body' || name === 'trim') smoothNormals(geometry, cellUnits * 0.4, SMOOTH);
    merged.set(name, {
      before: list.reduce((sum, g) => sum + g.getAttribute('position').count / 3, 0),
      geometry,
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

await page.goto(`http://localhost:${port}/?cell=${cell}&smooth=${smooth}`);
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
