/**
 * Генератор 3D-моделей машин в формате GLB.
 *
 * Модель строится из того же силуэта, которым машина рисуется в заезде
 * (src/render/car.ts). Так витрина в гараже и машина на трассе — один объект,
 * а не две независимо нарисованные картинки, которые разъедутся при первой правке.
 *
 * Профиль сбоку протягивается по ширине: узко у крыши, широко на уровне пояса,
 * чуть уже у порогов. Из плоского контура получается правдоподобный объём.
 *
 *   node scripts/build-car-models.mjs
 *
 * Отладка: ONLY=0,6 собирает модель только из перечисленных кусков.
 * Порядок: 0 кузов, 1 стёкла, далее пары «покрышка, диск» по колёсам,
 * затем фара и фонарь. Так ищется, какая часть даёт артефакт.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { SILHOUETTES } from '../src/render/car.ts';

const OUT_DIR = 'assets/models';

/**
 * Машины, у которых в public/models лежит рендер из пайплайна, а не
 * процедурный плейсхолдер. Их GLB собирается отдельно и в git лежит готовым.
 */
const REAL_MODELS = new Set(['bavar_c40']);

/** Длина машины в метрах — модель приходит в сцену в реальном масштабе. */
const LENGTH = 4.0;
/**
 * Габаритный прямоугольник силуэта в 2D имеет высоту 0.42 от ширины
 * (см. drawCar в src/render/car.ts). Без этого множителя кузов
 * растягивается по вертикали втрое и перестаёт быть машиной.
 */
const HEIGHT_RATIO = 0.42;
/** Половина ширины кузова на уровне пояса. */
const HALF_WIDTH = 0.78;
/** На сколько частей дробится каждое ребро контура: больше — глаже борт. */
const SUBDIVISIONS = 6;

// ── работа с контуром ────────────────────────────────────────────────────────

/** Дробит контур, чтобы борт не выглядел гранёным. */
function resample(points, per, closed = true) {
  const out = [];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

/**
 * Линия порога с колёсными арками.
 *
 * Без арок колесо выглядит приклеенным сбоку: половина покрышки торчит ниже
 * ровного днища, и машина читается как тележка. Арка — то, из-за чего колесо
 * оказывается В кузове, а не ПОД ним.
 *
 * Радиус в долях: по X это доля длины, по Y — доля высоты габарита,
 * поэтому та же дуга по вертикали делится на HEIGHT_RATIO.
 */
function sillWithArches(wheels, sillY, segments = 14) {
  const path = [];
  // Идём от переднего края к заднему: контур кузова замыкается в эту сторону.
  for (const w of [...wheels].sort((a, b) => b.x - a.x)) {
    const rx = w.r * 1.09;
    const ry = rx / HEIGHT_RATIO;
    path.push([w.x + rx, sillY]);
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI;
      path.push([w.x + rx * Math.cos(angle), w.y - ry * Math.sin(angle)]);
    }
    path.push([w.x - rx, sillY]);
  }
  return path;
}

/** Профиль ширины по высоте: 0 — крыша, 1 — порог. */
function halfWidthAt(t) {
  const roof = 0.58;
  const belt = 1.0;
  const sill = 0.88;
  return t < 0.55
    ? roof + (belt - roof) * (t / 0.55)
    : belt + (sill - belt) * ((t - 0.55) / 0.45);
}

/**
 * Триангуляция вогнутого многоугольника отсечением ушей.
 * Веер от центра тяжести здесь не годится: линия крыши уходит внутрь контура,
 * и веерные треугольники вылезают за силуэт — кузов превращается в клин.
 */
function earClip(points) {
  const n = points.length;
  const indices = [...Array(n).keys()];
  const area = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);

  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    signedArea += a[0] * b[1] - b[0] * a[1];
  }
  // Работаем всегда против часовой стрелки — так знак площади уха предсказуем.
  if (signedArea < 0) indices.reverse();

  const inside = (p, a, b, c) => {
    const d1 = area(p, a, b);
    const d2 = area(p, b, c);
    const d3 = area(p, c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };

  const out = [];
  let guard = indices.length * indices.length;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const ia = indices[(i + indices.length - 1) % indices.length];
      const ib = indices[i];
      const ic = indices[(i + 1) % indices.length];
      const a = points[ia];
      const b = points[ib];
      const c = points[ic];
      if (area(a, b, c) <= 0) continue; // вершина вогнутая — не ухо
      let blocked = false;
      for (const other of indices) {
        if (other === ia || other === ib || other === ic) continue;
        if (inside(points[other], a, b, c)) { blocked = true; break; }
      }
      if (blocked) continue;
      out.push([ia, ib, ic]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) out.push([indices[0], indices[1], indices[2]]);
  return out;
}

/**
 * Разворачивает треугольники по заданному направлению «наружу».
 *
 * Подбирать обход вручную бесполезно: борта смотрят вдоль Z, лента по периметру —
 * в разные стороны по XY, а поверхность колёсной арки вообще внутрь, к колесу.
 * Поэтому для каждой грани направление задаётся явно, а функция лишь проверяет
 * знак и при необходимости меняет местами две вершины.
 */
function orient(positions, triangles) {
  const indices = [];
  for (const { tri, out } of triangles) {
    const [ia, ib, ic] = tri;
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) indices.push(ia, ib, ic);
    else indices.push(ia, ic, ib);
  }
  return indices;
}

/**
 * Замкнутая оболочка из плоского контура: два борта плюс лента по периметру,
 * которая и даёт капот, крышу и корму.
 *
 * `range` — диапазон высот КУЗОВА. Профиль ширины считается по нему, а не по
 * собственным границам контура: иначе стёкла, у которых свой диапазон, раздуются
 * до ширины порогов.
 */
function loft(points, halfWidth, range, groundFromTop, widthScale = 1) {
  const { top, span } = range;
  const positions = [];
  const indices = [];
  const toWorld = (px, py, pz) => [
    (px - 0.5) * LENGTH,
    groundFromTop - py * HEIGHT_RATIO * LENGTH,
    pz,
  ];
  const widthAt = (y) => halfWidth * halfWidthAt((y - top) / span) * widthScale;

  const fan = earClip(points);
  const triangles = [];

  for (const sign of [1, -1]) {
    const base = positions.length / 3;
    for (const [x, y] of points) positions.push(...toWorld(x, y, sign * widthAt(y)));
    // Борт смотрит вдоль своей оси Z.
    for (const [a, b, c] of fan) {
      triangles.push({ tri: [base + a, base + b, base + c], out: [0, 0, sign] });
    }
  }

  // Лента по периметру: капот, крыша, корма, пороги и поверхность колёсных арок.
  // Направление наружу — нормаль соответствующего ребра контура в плоскости XY.
  const left = 0;
  const right = points.length;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ax = (a[0] - 0.5) * LENGTH;
    const ay = groundFromTop - a[1] * HEIGHT_RATIO * LENGTH;
    const bx = (b[0] - 0.5) * LENGTH;
    const by = groundFromTop - b[1] * HEIGHT_RATIO * LENGTH;
    area += ax * by - bx * ay;
  }
  const ccw = area > 0;

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const a = points[i];
    const b = points[j];
    const dx = (b[0] - a[0]) * LENGTH;
    const dy = -(b[1] - a[1]) * HEIGHT_RATIO * LENGTH;
    const out = ccw ? [dy, -dx, 0] : [-dy, dx, 0];
    triangles.push({ tri: [left + i, left + j, right + j], out });
    triangles.push({ tri: [left + i, right + j, right + i], out });
  }

  return { positions, indices: orient(positions, triangles) };
}

/**
 * Только боковые панели, без ленты по периметру — для стёкол.
 *
 * Замкнутый объём здесь не годится: стекло шире кузова лишь на волос, и его
 * изнанка оказывается видна сквозь крышу. Получается не окно, а дыра.
 * Плоская панель, посаженная на борт поверх кузова, читается именно окном.
 */
function shell(points, halfWidth, range, groundFromTop, outset) {
  const { top, span } = range;
  const positions = [];
  const indices = [];
  const fan = earClip(points);
  const triangles = [];
  for (const sign of [1, -1]) {
    const base = positions.length / 3;
    for (const [x, y] of points) {
      const z = sign * (halfWidth * halfWidthAt((y - top) / span) + outset);
      positions.push((x - 0.5) * LENGTH, groundFromTop - y * HEIGHT_RATIO * LENGTH, z);
    }
    for (const [a, b, c] of fan) {
      triangles.push({ tri: [base + a, base + b, base + c], out: [0, 0, sign] });
    }
  }
  indices.push(...orient(positions, triangles));
  return { positions, indices };
}

/** Колесо: покрышка и диск отдельными кусками, чтобы красились по-разному. */
function wheel(cx, cy, radius, halfWidth, width, groundFromTop, segments = 24) {
  const positions = [];
  const indices = [];
  const y = groundFromTop - cy * HEIGHT_RATIO * LENGTH;
  const x = (cx - 0.5) * LENGTH;
  const r = radius * LENGTH;

  for (const sign of [1, -1]) {
    const z = sign * halfWidth;
    const zOut = z + sign * width * 0.5;
    const zIn = z - sign * width * 0.5;
    const capBase = positions.length / 3;
    positions.push(x, y, zOut);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(x + Math.cos(a) * r, y + Math.sin(a) * r, zOut);
    }
    for (let i = 0; i < segments; i++) {
      const p = capBase + 1 + i;
      const q = capBase + 1 + ((i + 1) % segments);
      if (sign > 0) indices.push(capBase, p, q);
      else indices.push(capBase, q, p);
    }
    // Протектор.
    const treadBase = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(x + Math.cos(a) * r, y + Math.sin(a) * r, zOut);
      positions.push(x + Math.cos(a) * r, y + Math.sin(a) * r, zIn);
    }
    for (let i = 0; i < segments; i++) {
      const p = treadBase + i * 2;
      const q = treadBase + ((i + 1) % segments) * 2;
      if (sign > 0) indices.push(p, q, q + 1, p, q + 1, p + 1);
      else indices.push(p, q + 1, q, p, p + 1, q + 1);
    }
  }
  return { positions, indices };
}

/** Диск: плоский круг чуть снаружи покрышки. */
function rim(cx, cy, radius, halfWidth, width, groundFromTop, segments = 20) {
  const positions = [];
  const indices = [];
  const y = groundFromTop - cy * HEIGHT_RATIO * LENGTH;
  const x = (cx - 0.5) * LENGTH;
  const r = radius * LENGTH * 0.62;
  for (const sign of [1, -1]) {
    const z = sign * (halfWidth + width * 0.5 + 0.004);
    const base = positions.length / 3;
    positions.push(x, y, z);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
    }
    for (let i = 0; i < segments; i++) {
      const p = base + 1 + i;
      const q = base + 1 + ((i + 1) % segments);
      if (sign > 0) indices.push(base, p, q);
      else indices.push(base, q, p);
    }
  }
  return { positions, indices };
}

/**
 * Фара — небольшая коробка, выступающая из борта.
 * Плоская пластина внутри кузова давала z-fighting и «отклеивалась» на вращении.
 */
function lamp(cx, cy, w, h, halfWidth, depth, groundFromTop) {
  const positions = [];
  const indices = [];
  const x = (cx - 0.5) * LENGTH;
  const y = groundFromTop - cy * HEIGHT_RATIO * LENGTH;
  const dx = (w * LENGTH) / 2;
  const dy = (h * HEIGHT_RATIO * LENGTH) / 2;
  for (const sign of [1, -1]) {
    const zIn = sign * (halfWidth - depth);
    const zOut = sign * (halfWidth + depth);
    const base = positions.length / 3;
    for (const z of [zIn, zOut]) {
      positions.push(x - dx, y - dy, z, x + dx, y - dy, z, x + dx, y + dy, z, x - dx, y + dy, z);
    }
    const quad = (a, b, c, d) => indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
    if (sign > 0) {
      quad(4, 5, 6, 7); quad(3, 2, 1, 0);
      quad(0, 1, 5, 4); quad(1, 2, 6, 5); quad(2, 3, 7, 6); quad(3, 0, 4, 7);
    } else {
      quad(7, 6, 5, 4); quad(0, 1, 2, 3);
      quad(4, 5, 1, 0); quad(5, 6, 2, 1); quad(6, 7, 3, 2); quad(7, 4, 0, 3);
    }
  }
  return { positions, indices };
}

// ── нормали ──────────────────────────────────────────────────────────────────

/** Сглаженные нормали: усреднение по граням, сходящимся в вершине. */
function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) {
      normals[o] += nx;
      normals[o + 1] += ny;
      normals[o + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

// ── сборка GLB ───────────────────────────────────────────────────────────────

function pad4(n) { return (4 - (n % 4)) % 4; }

function buildGlb(parts, materials) {
  const buffers = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  const primitives = [];

  for (const part of parts) {
    const positions = Float32Array.from(part.positions);
    const normals = computeNormals(part.positions, part.indices);
    const use32 = part.positions.length / 3 > 65535;
    const indices = use32 ? Uint32Array.from(part.indices) : Uint16Array.from(part.indices);

    const push = (typed, target) => {
      const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
      const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length, target };
      buffers.push(bytes);
      offset += bytes.length;
      const padding = pad4(offset);
      if (padding) { buffers.push(Buffer.alloc(padding)); offset += padding; }
      bufferViews.push(view);
      return bufferViews.length - 1;
    };

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[i + k]);
        max[k] = Math.max(max[k], positions[i + k]);
      }
    }

    const posView = push(positions, 34962);
    const normView = push(normals, 34962);
    const idxView = push(indices, 34963);

    accessors.push({ bufferView: posView, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max });
    const posAccessor = accessors.length - 1;
    accessors.push({ bufferView: normView, componentType: 5126, count: normals.length / 3, type: 'VEC3' });
    const normAccessor = accessors.length - 1;
    accessors.push({ bufferView: idxView, componentType: use32 ? 5125 : 5123, count: indices.length, type: 'SCALAR' });
    const idxAccessor = accessors.length - 1;

    primitives.push({
      attributes: { POSITION: posAccessor, NORMAL: normAccessor },
      indices: idxAccessor,
      material: part.material,
    });
  }

  const bin = Buffer.concat(buffers);
  const gltf = {
    asset: { version: '2.0', generator: 'na-slabo car builder' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Car', mesh: 0 }],
    meshes: [{ name: 'CarBody', primitives }],
    materials,
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors,
  };

  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = Buffer.alloc(pad4(json.length), 0x20);
  const jsonChunk = Buffer.concat([json, jsonPad]);
  const binPad = Buffer.alloc(pad4(bin.length), 0);
  const binChunk = Buffer.concat([bin, binPad]);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.write('JSON', 4, 'ascii');

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.write('BIN\0', 4, 'ascii');

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

// ── материалы ────────────────────────────────────────────────────────────────

/**
 * Кузов назван «body» намеренно: сцена находит его по имени и красит.
 * Базовый цвет белый — окраска накладывается кодом, как и в 2D (§11).
 */
const MATERIALS = [
  { name: 'body', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.55, roughnessFactor: 0.35 } },
  { name: 'glass', pbrMetallicRoughness: { baseColorFactor: [0.05, 0.07, 0.10, 1], metallicFactor: 0.6, roughnessFactor: 0.09 }, doubleSided: true },
  { name: 'tire', pbrMetallicRoughness: { baseColorFactor: [0.055, 0.06, 0.07, 1], metallicFactor: 0, roughnessFactor: 0.95 } },
  { name: 'rim', pbrMetallicRoughness: { baseColorFactor: [0.68, 0.71, 0.76, 1], metallicFactor: 0.95, roughnessFactor: 0.22 } },
  { name: 'headlight', pbrMetallicRoughness: { baseColorFactor: [1, 0.92, 0.74, 1], metallicFactor: 0.2, roughnessFactor: 0.1 }, emissiveFactor: [0.9, 0.82, 0.62] },
  { name: 'taillight', pbrMetallicRoughness: { baseColorFactor: [0.7, 0.12, 0.12, 1], metallicFactor: 0.2, roughnessFactor: 0.2 }, emissiveFactor: [0.55, 0.06, 0.06] },
];

const MATERIAL_INDEX = Object.fromEntries(MATERIALS.map((m, i) => [m.name, i]));

function buildCar(shape) {
  // Верх контура — как нарисован, низ — порог с арками под колёса.
  const upper = resample(shape.body, SUBDIVISIONS, false);
  const sillY = Math.max(...shape.body.map((p) => p[1]));
  const outline = [...upper, ...sillWithArches(shape.wheels, sillY)];
  const glassOutline = resample(shape.glass, SUBDIVISIONS);
  const parts = [];

  // Диапазон высот кузова — общая система отсчёта для профиля ширины.
  const ys = outline.map((p) => p[1]);
  const top = Math.min(...ys);
  const range = { top, span: Math.max(1e-6, Math.max(...ys) - top) };

  // Земля там, где нижняя точка колеса. Машина встаёт на подиум колёсами,
  // а не парит над ним и не проваливается внутрь.
  const groundFromTop = Math.max(
    ...shape.wheels.map((w) => w.y * HEIGHT_RATIO * LENGTH + w.r * LENGTH),
  );

  parts.push({ ...loft(outline, HALF_WIDTH, range, groundFromTop), material: MATERIAL_INDEX.body });

  // Стёкла — панели на бортах, посаженные на 8 мм поверх кузова.
  parts.push({
    ...shell(glassOutline, HALF_WIDTH, range, groundFromTop, 0.008),
    material: MATERIAL_INDEX.glass,
  });

  const tyreWidth = 0.24;
  const axleHalfWidth = HALF_WIDTH * 0.82;
  for (const w of shape.wheels) {
    parts.push({ ...wheel(w.x, w.y, w.r, axleHalfWidth, tyreWidth, groundFromTop), material: MATERIAL_INDEX.tire });
    parts.push({ ...rim(w.x, w.y, w.r, axleHalfWidth, tyreWidth, groundFromTop), material: MATERIAL_INDEX.rim });
  }

  // Фары и фонари сажаются на борт, чуть выступая наружу.
  const lampInset = HALF_WIDTH * 0.66;
  parts.push({ ...lamp(0.915, 0.575, 0.075, 0.075, lampInset, 0.022, groundFromTop), material: MATERIAL_INDEX.headlight });
  parts.push({ ...lamp(0.085, 0.60, 0.075, 0.08, lampInset, 0.022, groundFromTop), material: MATERIAL_INDEX.taillight });

  const only = process.env.ONLY;
  const selected = only
    ? parts.filter((_, i) => only.split(',').map(Number).includes(i))
    : parts;
  return buildGlb(selected, MATERIALS);
}

mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
for (const [id, shape] of Object.entries(SILHOUETTES)) {
  // Машины с настоящей моделью из пайплайна плейсхолдером не перезаписываются.
  if (REAL_MODELS.has(id)) {
    console.log(`${id}.glb`.padEnd(22), '     — настоящая модель, пропуск');
    continue;
  }
  const glb = buildCar(shape);
  writeFileSync(`${OUT_DIR}/${id}.glb`, glb);
  total += glb.length;
  console.log(`${id}.glb`.padEnd(22), (glb.length / 1024).toFixed(1).padStart(7), 'КБ');
}
console.log('\nвсего', (total / 1024).toFixed(1), 'КБ на', Object.keys(SILHOUETTES).length, 'моделей');
