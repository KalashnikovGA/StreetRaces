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
  AgXToneMapping, AmbientLight, Box3, HemisphereLight, LinearSRGBColorSpace, Mesh,
  MeshNormalMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoToneMapping,
  OrthographicCamera, RectAreaLight, Scene, SRGBColorSpace, Vector3,
  WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const CONFIG = JSON.parse(document.getElementById('config').textContent);
const HAND = JSON.parse(document.getElementById('hand')?.textContent ?? '{"lines":[]}');

/**
 * Множитель кадра. Для машин всегда 1: кадр один на всю библиотеку, на этом
 * держится совпадение слоёв. Декорации — другое дело, они тайлятся во всю
 * ширину экрана, и им кадр машины мелковат.
 */
const FRAME = Number(new URLSearchParams(location.search).get('frame')) || 1;
const W = Math.round(CONFIG.render.resolution_x * FRAME);
const H = Math.round(CONFIG.render.resolution_y * FRAME);

/**
 * Суперсэмплинг: сцена рисуется втрое крупнее кадра и ужимается до него.
 * Обычного сглаживания мало — на низкополигональном кузове кромка остаётся
 * ступенчатой.
 *
 * На маленьком кадре суперсэмплинг работает и вторым делом: мелкие огрехи
 * исходной геометрии — стыки панелей, обвес поверх стокового кузова —
 * усредняются в полтона вместо того, чтобы читаться вмятиной.
 */
const SS = 3;

const PARAMS = new URLSearchParams(location.search);
const number = (name, fallback) => {
  const raw = PARAMS.get(name);
  return raw === null || raw === '' ? fallback : Number(raw);
};

/**
 * Свет, экспозиция, базовый цвет кузова и лак. Значения по умолчанию лежат
 * в camera.json; ключи запроса нужны сетке вариантов (scripts/render-grid.mjs),
 * которая гоняет одну и ту же сцену с разными числами.
 */
/**
 * Общий множитель силы света. Единица — паспортная мощность ламп из
 * camera.json; итоговое число выбирается человеком по сетке вариантов
 * (scripts/render-grid.mjs) и живёт в camera.json как lights_scale.
 */
const KEY = number('key', CONFIG.lights_scale ?? 1);
// Экспозиция задаётся в ступенях, как в Blender: 0 — без поправки.
const EXPOSURE = Math.pow(2, number('exposure', CONFIG.color_management?.exposure ?? 0));
const ALBEDO = number('albedo', CONFIG.body?.albedo ?? 0.65);
const ROUGHNESS = number('rough', CONFIG.body?.roughness ?? 0.5);

const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W * SS, H * SS, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = SRGBColorSpace;
/**
 * Тональная кривая. Без неё (View Transform = Standard в терминах Blender)
 * всё ярче единицы становится плоским белым: блик слипается, и деталь под
 * ним — подштамповки, бортовая линия — пропадает совсем. AgX держит плечо,
 * поэтому экспозицию можно поднимать, не срезая светА.
 */
renderer.toneMapping = AgXToneMapping;
renderer.toneMappingExposure = EXPOSURE;
document.body.append(renderer.domElement);

const scene = new Scene();

/**
 * Риг из трёх ламп, одинаковый для всех деталей и всех машин. Разный свет —
 * и слои выглядят вырезанными из разных картинок (§11).
 *
 * Лампы площадные, а не направленные. Направленная (Sun) и точечная дают
 * жёсткую границу тени при любых настройках: мягкость даёт размер источника,
 * это физика. Панель в несколько метров размывает переход сама.
 *
 * Мощность берётся из camera.json в ваттах, как в Blender, и переводится
 * в яркость панели: L = P / (площадь · π). При таком переводе освещённость
 * машины зависит только от мощности и расстояния, а размер панели меняет
 * лишь мягкость — ровно как в Blender.
 */
RectAreaLightUniformsLib.init();
for (const item of CONFIG.lights) {
  const size = item.size ?? 2.5;
  const light = new RectAreaLight(
    (item.color[0] * 255 << 16) | (item.color[1] * 255 << 8) | (item.color[2] * 255),
    (item.energy / (size * size * Math.PI)) * KEY,
    size,
    size,
  );
  light.position.set(...item.location);
  light.lookAt(0, 0.7, 0);
  scene.add(light);
}
/**
 * Полусферический свет: сверху небо, снизу земля. На фотографии машины
 * бортовую линию и подштамповки рисует именно это — отражение светлого верха
 * и тёмного низа, а не диффузное затенение. Без него плоская дверь освещена
 * ровно и после умножения на цвет становится пятном.
 */
scene.add(new HemisphereLight(0xdfe8f0, 0x0e1012, 0.30 * KEY));

// Общего света ровно столько, чтобы тень не проваливалась в чёрное.
scene.add(new AmbientLight(0xffffff, 0.06));

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
  return { png: readback.toDataURL('image/png'), pixels: ctx.getImageData(0, 0, W, H).data };
}

/**
 * Служебный снимок в крупном разрешении: нормаль и глубина, по ним ищутся
 * контурные линии.
 *
 * Снимается мимо экрана, в буфер без сглаживания. Сглаживание тут не помощь,
 * а порча: глубина упакована в четыре байта, и усреднение двух соседних
 * значений на границе треугольников даёт не среднюю глубину, а мусор —
 * контур после этого обводит каждый треугольник сетки. Заодно буфер минует
 * тональную кривую и sRGB, которые сделали бы с числом то же самое.
 */
const RAW_W = W * SS, RAW_H = H * SS;
const rawTarget = new WebGLRenderTarget(RAW_W, RAW_H, { samples: 0 });
function shootRaw(buffer) {
  renderer.setRenderTarget(rawTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(rawTarget, 0, 0, RAW_W, RAW_H, buffer);
  return buffer;
}

/**
 * Рисованное затенение: сначала сильно размыть, потом разложить на ступени.
 *
 * Размытие убирает рельеф — все бугры, стыки панелей и следы децимации,
 * из-за которых кузов выглядел куском фотографии. Ступени превращают
 * оставшийся плавный перепад в две-три ровные плоскости: ровно так рисуют
 * машину сбоку, светлый верх и тёмный низ одной заливкой.
 *
 * Форму после этого держит не затенение, а контурная линия — она рисуется
 * отдельным слоем и кладётся поверх.
 *
 * Тональные полосы three.js (MeshToonMaterial) тут не годятся: они не
 * освещаются площадными лампами, а весь наш риг построен на них.
 */
function flatten(canvas, { blur, levels }) {
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext('2d');

  if (blur > 0) {
    const copy = document.createElement('canvas');
    copy.width = w; copy.height = h;
    const c = copy.getContext('2d');
    c.filter = 'blur(' + blur.toFixed(2) + 'px)';
    c.drawImage(canvas, 0, 0);
    c.filter = 'none';
    // Размытие съело кромку — возвращаем исходную альфу.
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(canvas, 0, 0);
    c.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.drawImage(copy, 0, 0);
  }

  if (!levels || levels.length < 2) return canvas;

  const image = g.getImageData(0, 0, w, h);
  const px = image.data;
  const bands = levels.length;
  for (let i = 0; i < px.length; i += 4) {
    // Почти прозрачные пиксели не трогаем. Фильтр восстановления размазывает
    // по кадру еле заметный след, и ступень вытянула бы его в видимую дымку
    // вокруг фар и стёкол.
    if (px[i + 3] < 24) continue;
    const luma = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
    if (luma < 1) continue;
    // Куда попал пиксель — та ступень ему и достаётся. Уровни ступеней
    // заданы явно: равные доли уводят самую тёмную полосу почти в чёрное,
    // и кузов после умножения на цвет становится грязным.
    const step = Math.min(bands - 1, Math.floor((luma / 256) * bands));
    const target = levels[step] * 255;
    // Потолок усиления: иначе почти чёрный пиксель в тени улетает в белое.
    const gain = Math.min(4, target / luma);
    px[i] = Math.min(255, px[i] * gain);
    px[i + 1] = Math.min(255, px[i + 1] * gain);
    px[i + 2] = Math.min(255, px[i + 2] * gain);
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Контурные линии. В рисованной подаче форму держит не затенение, а линия:
 * силуэт, проёмы дверей, арки, стык капота.
 *
 * Линии ищутся по разрыву глубины, а не по излому нормали. Нормали
 * у децимированной сетки ломаются на каждом треугольнике, и контур выходит
 * проволочной сеткой. Глубина же непрерывна по всей гладкой панели и рвётся
 * ровно там, где одна деталь заходит за другую: щель двери, кромка арки,
 * стык капота. Именно там рисовальщик и провёл бы карандашом.
 *
 * mask даёт силуэт: у карты глубины альфа занята упаковкой числа, поэтому
 * непрозрачность берётся с отдельного прохода.
 */
/**
 * Контур детали: граница её собственного пятна.
 *
 * Раньше линии искались по излому глубины — и внутри кузова получались
 * рваными и колючими. Иначе и не выйдет: глубина снимается с децимированной
 * модели, где обвес лежит поверх стокового кузова, и никакая обработка
 * не превратит такой излом в проведённую от руки линию.
 *
 * Зато граница слоя — это точная замкнутая кривая, а не находка алгоритма.
 * Силуэт кузова, проёмы окон, оправы фар и фонарей: ровно те линии, которыми
 * рисовальщик и подчёркивает детали машины сбоку.
 */
function outlineOf(alpha, width, height) {
  const size = width * height;
  const solid = new Uint8Array(size);
  for (let p = 0; p < size; p++) solid[p] = alpha[p * 4 + 3] > 8 ? 1 : 0;

  // Фон заливается от края кадра. Иначе в контур попадают и внутренние дырки
  // кузова — щели между панелями, прорези обвеса, — а они на рендере рваные
  // и дают тот самый пунктир вместо линии. Снаружи такая дырка недостижима,
  // поэтому заливка её и отсекает.
  const outside = new Uint8Array(size);
  const stack = new Int32Array(size);
  let top = 0;
  const push = (p) => { if (!solid[p] && !outside[p]) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (top > 0) {
    const p = stack[--top];
    const x = p % width, y = (p / width) | 0;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }

  const edge = new Uint8Array(size);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (!solid[p]) continue;
      if (outside[p - 1] || outside[p + 1] || outside[p - width] || outside[p + width]) edge[p] = 1;
    }
  }
  return edge;
}

/** Раскраска маски в слой линий. */
function paintLines(layers, width, height, tint) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (const { mask, alpha } of layers) {
    const value = Math.round(255 * alpha);
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      if (out[i + 3] >= value) continue;
      out[i] = tint[0];
      out[i + 1] = tint[1];
      out[i + 2] = tint[2];
      out[i + 3] = value;
    }
  }
  return new ImageData(out, width, height);
}

/**
 * Сглаживание штриха: пиксель остаётся, если вокруг него достаточно своих.
 * Линия, снятая с пиксельной сетки, идёт ступеньками и выглядит колючей.
 *
 * Только после утолщения: голосование стирает штрих шириной в один пиксель
 * целиком — своих у него в окне меньше трети.
 */
function smoothMask(mask, width, height, radius) {
  if (radius <= 0) return;
  const out = new Uint8Array(mask.length);
  const area = (radius * 2 + 1) * (radius * 2 + 1);
  const need = Math.max(2, Math.round(area * 0.34));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const base = ny * width;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          n += mask[base + nx];
        }
      }
      out[y * width + x] = n >= need ? 1 : 0;
    }
  }
  mask.set(out);
}

/**
 * Утолщение линии. Без него штрих шириной в один пиксель крупного буфера
 * после ужатия втрое превращается в треть пикселя — линия и получалась
 * еле заметной.
 *
 * Расширение делается двумя проходами, по строкам и по столбцам: так оно
 * стоит O(радиус), а не O(радиус в квадрате).
 */
function dilate(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const pass = (src, dst, stride, outer, inner) => {
    for (let a = 0; a < outer; a++) {
      const base = a * (stride === 1 ? width : 1);
      for (let b = 0; b < inner; b++) {
        const p = base + b * stride;
        let on = 0;
        for (let k = -radius; k <= radius && !on; k++) {
          const c = b + k;
          if (c < 0 || c >= inner) continue;
          if (src[base + c * stride]) on = 1;
        }
        dst[p] = on;
      }
    }
  };
  const rows = new Uint8Array(mask.length);
  pass(mask, rows, 1, height, width);
  const out = new Uint8Array(mask.length);
  pass(rows, out, width, width, height);
  return out;
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
  // Подготовленные модели приходят с именами слоёв, процедурные плейсхолдеры
  // из build-car-models.mjs — со своими. Приводим к одному словарю.
  const ALIAS = {
    body: 'body', glass: 'glass', light: 'light', tail: 'tail', wheel: 'wheel',
    tire: 'wheel', rim: 'wheel', headlight: 'light', taillight: 'tail',
  };
  root.traverse((node) => {
    if (!node.isMesh) return;
    const key = ALIAS[node.material?.name ?? node.name];
    if (key) groups[key].push(node);
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
  const depthRange = dist * 4;
  camera = new OrthographicCamera(-half, half, half * H / W, -half * H / W, 0.01, depthRange);
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

  if (groups.body.length === 0) { window.done = { error: 'в модели нет слоя body' }; return; }

  /**
   * Кузов рендерится средне-серым, а не белым. Чистый белый выбивает светА:
   * блик уходит в 255, и всё, что под ним, из файла пропадает — умножением
   * на цвет окраски эту деталь уже не вернуть. На 0.65 остаётся запас
   * по яркости, а яркость картинки добирается экспозицией, которую кривая
   * AgX сжимает, а не срезает.
   */
  const grey = new MeshStandardMaterial({ roughness: ROUGHNESS, metalness: 0.0 });
  // Значение линейное, как Base Color в Blender, а не как код цвета в вёрстке.
  grey.color.setRGB(ALBEDO, ALBEDO, ALBEDO, LinearSRGBColorSpace);
  // Блики снимаются на чёрном: в кадр попадает только то, что даёт лак.
  // В рисованной подаче это не блик лака, а светлое пятно на верхних
  // плоскостях — поэтому размывается сильнее всего и кладётся одной ступенью.
  const gloss = new MeshPhysicalMaterial({
    color: 0x000000, roughness: Math.max(0.45, ROUGHNESS + 0.1), metalness: 0.0,
    clearcoat: 0.35, clearcoatRoughness: 0.45,
  });
  const normalMat = new MeshNormalMaterial();
  const maskBuf = new Uint8Array(RAW_W * RAW_H * 4);
  const original = new Map();
  for (const list of Object.values(groups)) {
    for (const node of list) original.set(node, node.material);
  }

  const out = {};

  const swap = (list, material) => { for (const node of list) node.material = material; };
  const swapAll = (material) => {
    for (const list of Object.values(groups)) swap(list, material);
  };
  const restoreAll = () => {
    for (const [node, material] of original) node.material = material;
  };

  /** Копия текущего кадра отдельной канвой: её потом мнут заливками. */
  const grab = () => {
    const copy = document.createElement('canvas');
    copy.width = W; copy.height = H;
    copy.getContext('2d').drawImage(readback, 0, 0);
    return copy;
  };

  const STYLE = CONFIG.style ?? {};
  // Размытие задаётся в долях ширины кадра, чтобы не зависеть от разрешения.
  const px = (share) => share * W;

  /**
   * Контурный слой: силуэт, проёмы, арки, стык капота. Снимается по нормалям
   * и глубине сразу для кузова, стёкол и фонарей — они на канве неподвижны
   * и лежат одним куском. Колесо крутится, поэтому его контур запекается
   * в само колесо.
   */
  /**
   * Слой линий: силуэт кузова жирнее, проёмы окон и оправы фар тоньше.
   * Каждая линия — граница своего слоя, поэтому замкнута и не рвётся.
   */
  const radius = (widthPx) => Math.max(1, Math.round((widthPx * SS) / 2));
  const smoothRadius = Math.max(1, Math.round((STYLE.edge_smooth_px ?? 1.4) * SS / 2));

  const outlineFor = (names, widthPx) => {
    show(names);
    swapAll(normalMat);
    const alpha = shootRaw(maskBuf);
    restoreAll();
    const mask = dilate(outlineOf(alpha, RAW_W, RAW_H), RAW_W, RAW_H, radius(widthPx));
    smoothMask(mask, RAW_W, RAW_H, smoothRadius);
    return mask;
  };

  const linesTo = (layers) => {
    const image = paintLines(layers, RAW_W, RAW_H, STYLE.edge_tint ?? [16, 18, 20]);
    const big = document.createElement('canvas');
    big.width = RAW_W; big.height = RAW_H;
    big.getContext('2d').putImageData(image, 0, 0);
    const small = document.createElement('canvas');
    small.width = W; small.height = H;
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    // Буфер видеопамяти читается снизу вверх — переворачиваем обратно.
    // Разворот обязательно внутри save/restore: канва отдаётся дальше,
    // и рисовать по ней надо в обычных координатах.
    sctx.save();
    sctx.translate(0, H);
    sctx.scale(1, -1);
    sctx.drawImage(big, 0, 0, W, H);
    sctx.restore();
    return small;
  };

  show(['body']);
  swap(groups.body, grey);
  const body = shoot();
  const bodyCanvas = flatten(grab(), {
    blur: px(STYLE.body_blur ?? 0.010),
    levels: STYLE.body_levels ?? [0.45, 0.72, 0.95],
  });
  out.body = bodyCanvas.toDataURL('image/png');

  swap(groups.body, gloss);
  shoot();
  out.shade = flatten(grab(), {
    blur: px(STYLE.gloss_blur ?? 0.016),
    levels: STYLE.gloss_levels ?? [0.0, 0.85],
  }).toDataURL('image/png');
  swap(groups.body, original.get(groups.body[0]));

  show(['glass']);
  shoot();
  out.glass = flatten(grab(), { blur: px(0.002), levels: [0.16, 0.34] }).toDataURL('image/png');

  show(['light']);
  shoot();
  out.light = flatten(grab(), { blur: px(0.0015), levels: [0.6, 0.95] }).toDataURL('image/png');

  show(['tail']);
  shoot();
  out.tail = flatten(grab(), { blur: px(0.0015), levels: [0.6, 0.95] }).toDataURL('image/png');

  const outlineAlpha = STYLE.edge_outline_alpha ?? 1.0;
  const lineAlpha = STYLE.edge_alpha ?? 0.85;

  /**
   * Контуры панелей, нарисованные руками (assets/render/lines/<id>.json).
   *
   * Проёмы дверей, кромки арок, подоконная линия. В геометрии исходника их
   * нет — точнее, есть, но рвано: обвес лежит поверх стокового кузова,
   * и уступ на щели то есть, то нет. Четыре подхода к автоматическому поиску
   * кончились одинаково, поэтому эти линии просто заданы координатами.
   */
  const drawHand = (canvas) => {
    if (!HAND.lines?.length) return canvas;
    const g = canvas.getContext('2d');
    const tint = STYLE.edge_tint ?? [16, 18, 20];
    g.strokeStyle = 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ',' + lineAlpha + ')';
    g.lineWidth = STYLE.edge_line_px ?? 1.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    for (const item of HAND.lines) {
      g.beginPath();
      if (item.arc) {
        const [cx, cy, r, from, to] = item.arc;
        g.arc(cx * W, cy * H, r * W, from * Math.PI / 180, to * Math.PI / 180);
      } else if (item.path?.length > 1) {
        const pts = item.path.map(([x, y]) => [x * W, y * H]);
        g.moveTo(pts[0][0], pts[0][1]);
        // Через точки ведём кривую, а не ломаную: на изгибе борта углы видно.
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i];
          const [x1, y1] = pts[i + 1];
          if (i === pts.length - 2) g.lineTo(x1, y1);
          else g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
      }
      g.stroke();
    }
    return canvas;
  };

  out.edge = drawHand(linesTo([
    { mask: outlineFor(['glass'], STYLE.edge_line_px ?? 1.6), alpha: lineAlpha },
    { mask: outlineFor(['light'], STYLE.edge_line_px ?? 1.6), alpha: lineAlpha },
    { mask: outlineFor(['tail'], STYLE.edge_line_px ?? 1.6), alpha: lineAlpha },
    { mask: outlineFor(['body'], STYLE.edge_outline_px ?? 2.6), alpha: outlineAlpha },
  ])).toDataURL('image/png');

  show(['wheel']);
  const wheels = shoot();
  // Резина тёмная, а диск должен читаться: спицы видно только по перепаду
  // между ступенями, своей линии у них нет — сбоку они сливаются в один круг.
  const wheelCanvas = flatten(grab(), { blur: px(0.0005), levels: [0.07, 0.32, 0.80] });
  // Контур колеса запекается в него же: колесо крутится отдельным спрайтом.
  wheelCanvas.getContext('2d').drawImage(
    linesTo([{ mask: outlineFor(['wheel'], STYLE.edge_line_px ?? 1.6), alpha: lineAlpha }]),
    0, 0,
  );
  show(['wheel']);

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
  out.wheel = await crop(wheelCanvas.toDataURL('image/png'), {
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

/**
 * Контуры панелей, нарисованные руками. Файла может не быть — тогда машина
 * идёт с одними границами слоёв.
 */
const handFile = carId ? `assets/render/lines/${carId}.json` : null;
const HAND = handFile && existsSync(handFile)
  ? JSON.parse(readFileSync(handFile, 'utf8'))
  : { lines: [] };

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/' || url === '/index.html') {
      const html = PAGE.replace(
        '<script type="module">',
        `<script type="application/json" id="config">${JSON.stringify(CAMERA)}</script>\n`
        + `<script type="application/json" id="hand">${JSON.stringify(HAND)}</script>\n<script type="module">`,
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
// Декорации тайлятся во всю ширину экрана, поэтому снимаются кадром втрое
// крупнее машинного. Машинам кадр менять нельзя — см. «незыблемое правило».
const frame = mode === 'car' ? 1 : 2;
await page.goto(`http://localhost:${port}/?mode=${mode}&axis=${axis}&frame=${frame}`);
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
    order: ['body', 'shade', 'glass', 'light', 'tail', 'edge'],
  };
  writeFileSync(`${outDir}/layers.json`, JSON.stringify(manifest, null, 2));
  console.log(`  ${outDir}/layers.json`);
  console.log(`колёса: ${manifest.wheels.map((w) => `${w.cx},${w.cy} r${w.r}`).join('  ')}  земля ${manifest.ground}`);
}

console.log(`итого ${(total / 1024).toFixed(0)} КБ`);
