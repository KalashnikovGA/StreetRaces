/**
 * Рендер слоёных 2D-спрайтов. Шаг 8 из §14.
 *
 *   node scripts/render-sprites.mjs --car <id> [--view race|garage]
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
/** Ракурс: race — строго сбоку, garage — три четверти. */
const view = flag('view') ?? 'race';
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

const outDir = carId
  ? (view === 'race' ? `public/sprites/${carId}` : `public/sprites/${carId}/${view}`)
  : 'public/sprites/scene';
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
  CanvasTexture, EquirectangularReflectionMapping, MeshBasicMaterial,
  MeshDepthMaterial, MeshNormalMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  NoToneMapping, OrthographicCamera, PerspectiveCamera, RGBADepthPacking,
  RectAreaLight, Scene, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const CONFIG = JSON.parse(document.getElementById('config').textContent);

/**
 * Множитель кадра. Для машин всегда 1: кадр один на всю библиотеку, на этом
 * держится совпадение слоёв. Декорации — другое дело, они тайлятся во всю
 * ширину экрана, и им кадр машины мелковат.
 */
const FRAME = Number(new URLSearchParams(location.search).get('frame')) || 1;
const VIEW = new URLSearchParams(location.search).get('view') || 'race';
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
 * Полусферический свет: сверху небо, снизу земля. Диффузная часть того же,
 * что делает окружение ниже, — нужна тем деталям, которые не блестят.
 */
scene.add(new HemisphereLight(0xdfe8f0, 0x0e1012, 0.22 * KEY));

// Общего света ровно столько, чтобы тень не проваливалась в чёрное.
scene.add(new AmbientLight(0xffffff, 0.05));

/**
 * Окружение — то, ради чего всё это.
 *
 * Строго сбоку машина повёрнута к камере одним боком, и нормаль по нему
 * почти не меняется: рассеянного света хватает на силуэт, но форму он
 * не показывает — дверь, крыло и порог сливаются в одну заливку. Форму
 * на фотографии рисует не свет, а **отражение**: борт зеркалит светлый
 * верх и тёмный низ, граница между ними ложится вдоль бортовой линии,
 * и каждая выпуклость гнёт эту границу по-своему. Отсюда и объём.
 *
 * Поэтому вместо контурного слоя (§68 — от него отказались, он читался
 * чертежом поверх машины) в сцену кладётся градиентное окружение: узкая
 * яркая полоса софтбокса под потолком, ровное небо над горизонтом, тёмный
 * пол под ним. Кузов достаточно гладкий, чтобы это отражать.
 */
{
  const spec = CONFIG.environment ?? {};
  const stops = spec.stops ?? [
    [0.00, '#12161a'], [0.34, '#2a3138'], [0.40, '#f2f6fa'],
    [0.47, '#8f9aa4'], [0.62, '#5b656e'], [0.63, '#20262b'], [1.00, '#0a0d10'],
  ];
  const sky = document.createElement('canvas');
  sky.width = 8; sky.height = 512;
  const g = sky.getContext('2d');
  const ramp = g.createLinearGradient(0, 0, 0, sky.height);
  for (const [at, color] of stops) ramp.addColorStop(at, color);
  g.fillStyle = ramp;
  g.fillRect(0, 0, sky.width, sky.height);

  const env = new CanvasTexture(sky);
  env.mapping = EquirectangularReflectionMapping;
  env.colorSpace = SRGBColorSpace;
  scene.environment = env;
  scene.environmentIntensity = spec.intensity ?? 1;
}

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
/**
 * Карта затенения в щелях.
 *
 * Три площадные лампы освещают машину ровно, и всё, что не поймало блик,
 * сливается в одну заливку: стык двери, посадка зеркала, кромка порога,
 * зазор фары. На фотографии их рисует не свет, а его отсутствие — в узкую
 * щель свет просто не заходит.
 *
 * Считается по буферу глубины, без трассировки лучей: пиксель сравнивается
 * с размытой окрестностью того же буфера. Дальше окрестности — значит,
 * утоплен, значит, щель.
 *
 * Размытие двустороннее: соседи дальше limit_m метров в расчёт не идут.
 * Без этого весь силуэт машины обводится чёрным — у края поверхность
 * уходит от камеры круто, и любая окрестность там «ближе». Обводки нам
 * не нужно: контурный слой мы уже пробовали и от него отказались, здесь
 * нужна тень в щели, а не линия по краю.
 *
 * Возвращает канву с чёрной заливкой и альфой по глубине каверны.
 */
function cavityMap(depth, solid, w, h, { radius, strength, limit, full, floor, range, soften, dilate }) {
  // Метры переводим в доли буфера: у ортокамеры глубина линейна, у длинного
  // фокуса витрины — почти линейна, и на щелях в миллиметры разница не видна.
  const near = limit / range;
  const deep = full / range;
  // Мёртвая зона. Децимация оставляет на крупных панелях рябь в доли
  // миллиметра; без порога карта каверн честно рисует её разводами,
  // и крыло выглядит помятым. Стык панели глубже на порядок.
  const dead = floor / range;

  const blurAxis = (src, dst, dx, dy) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const at = y * w + x;
        if (!solid[at]) { dst[at] = src[at]; continue; }
        const centre = depth[at];
        let sum = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = x + k * dx, sy = y + k * dy;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          const j = sy * w + sx;
          if (!solid[j]) continue;
          if (Math.abs(depth[j] - centre) > near) continue;
          sum += src[j]; n++;
        }
        dst[at] = n ? sum / n : src[at];
      }
    }
  };
  const tmp = new Float32Array(w * h);
  const soft = new Float32Array(w * h);
  blurAxis(depth, tmp, 1, 0);
  blurAxis(tmp, soft, 0, 1);

  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!solid[i]) continue;
    // Утоплен относительно окрестности — щель. Приподнят — ребро, его
    // не трогаем: подсветка рёбер и есть обводка.
    const dip = depth[i] - soft[i] - dead;
    const k = Math.min(1, Math.max(0, dip / (deep - dead)));
    alpha[i] = k * strength;
  }

  /**
   * Расширение по максимуму. Настоящий зазор редко идёт одной глубины:
   * где-то он на волос глубже порога, где-то на волос мельче, и линия
   * выходит пунктиром — именно это и читается «непонятными линиями».
   * Максимум по маленькой окрестности сшивает пунктир в сплошную линию
   * и при этом не рисует ничего нового: там, где не было ни одной точки,
   * максимум остаётся нулём.
   */
  if (dilate > 0) {
    const axis = (src, dst, dx, dy) => {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let best = 0;
          for (let k = -dilate; k <= dilate; k++) {
            const sx = x + k * dx, sy = y + k * dy;
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            const v = src[sy * w + sx];
            if (v > best) best = v;
          }
          dst[y * w + x] = best;
        }
      }
    };
    const mid = new Float32Array(w * h);
    axis(alpha, mid, 1, 0);
    axis(mid, alpha, 0, 1);
  }

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const image = out.getContext('2d').createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (!solid[i]) continue;
    image.data[i * 4 + 3] = Math.round(255 * alpha[i]);
  }
  out.getContext('2d').putImageData(image, 0, 0);
  if (soften <= 0) return out;

  // Буфер глубины снимается без сглаживания, иначе упаковка ломается,
  // — поэтому кромки каверн ступенчатые. Полпикселя размытия их снимает.
  const smooth = document.createElement('canvas');
  smooth.width = w; smooth.height = h;
  const sc = smooth.getContext('2d');
  sc.filter = 'blur(' + soften.toFixed(2) + 'px)';
  sc.drawImage(out, 0, 0);
  return smooth;
}

/**
 * Карта стыков панелей.
 *
 * Карта каверн (см. выше) меряет глубину, и на зазорах это подводит:
 * зазор двери редко идёт одной глубины — где-то он на волос глубже порога
 * отбора, где-то мельче, и линия выходит пунктиром. Пунктир поперёк крыла
 * и есть те самые «непонятные линии».
 *
 * Нормаль ведёт себя иначе. На гладкой панели она поворачивается на градусы
 * от пикселя к пикселю; на кромке зазора — на десятки, потому что там
 * поверхность уходит внутрь. Признак не зависит от того, насколько зазор
 * глубок, поэтому линия получается сплошной по всей длине стыка.
 *
 * Чтобы по силуэту не пошла обводка, перепад нормали засчитывается только
 * там, где сосед лежит на той же глубине: на краю машины и на границе
 * заслонённых частей нормаль тоже прыгает, но это не стык, а край.
 */
function seamMap(normals, depth, solid, w, h, { step, cosMin, cosFull, strength, limit, range, soften }) {
  const near = limit / range;
  const nx = new Float32Array(w * h);
  const ny = new Float32Array(w * h);
  const nz = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // MeshNormalMaterial пишет нормаль как (n * 0.5 + 0.5).
    nx[i] = normals[i * 4] / 127.5 - 1;
    ny[i] = normals[i * 4 + 1] / 127.5 - 1;
    nz[i] = normals[i * 4 + 2] / 127.5 - 1;
  }

  const alpha = new Float32Array(w * h);
  const around = [[step, 0], [0, step], [step, step], [step, -step]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = y * w + x;
      if (!solid[at]) continue;
      let worst = 1;
      for (const [dx, dy] of around) {
        const ax = x - dx, ay = y - dy, bx = x + dx, by = y + dy;
        if (ax < 0 || ay < 0 || bx >= w || by >= h) continue;
        const a = ay * w + ax, b = by * w + bx;
        if (!solid[a] || !solid[b]) continue;
        // Сосед за перепадом глубины — это край или заслон, а не стык.
        if (Math.abs(depth[a] - depth[at]) > near) continue;
        if (Math.abs(depth[b] - depth[at]) > near) continue;
        const dot = nx[a] * nx[b] + ny[a] * ny[b] + nz[a] * nz[b];
        if (dot < worst) worst = dot;
      }
      if (worst >= cosMin) continue;
      const k = Math.min(1, (cosMin - worst) / Math.max(1e-6, cosMin - cosFull));
      alpha[at] = k * strength;
    }
  }

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const image = out.getContext('2d').createImageData(w, h);
  for (let i = 0; i < w * h; i++) image.data[i * 4 + 3] = Math.round(255 * alpha[i]);
  out.getContext('2d').putImageData(image, 0, 0);
  if (soften <= 0) return out;

  const smooth = document.createElement('canvas');
  smooth.width = w; smooth.height = h;
  const sc = smooth.getContext('2d');
  sc.filter = 'blur(' + soften.toFixed(2) + 'px)';
  sc.drawImage(out, 0, 0);
  return smooth;
}

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
  const groups = {
    body: [], trim: [], chrome: [], glass: [], light: [], tail: [],
    wheel: [], tyre: [], rim: [],
  };
  // Подготовленные модели приходят с именами слоёв, процедурные плейсхолдеры
  // из build-car-models.mjs — со своими. Приводим к одному словарю.
  const ALIAS = {
    body: 'body', trim: 'trim', chrome: 'chrome', glass: 'glass',
    light: 'light', tail: 'tail', wheel: 'wheel', tyre: 'tyre', rim: 'rim',
    tire: 'tyre', headlight: 'light', taillight: 'tail',
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
  // Ближняя и дальняя плоскости обжимают машину вплотную. Диапазон в десятки
  // метров на объект в один метр съедает точность буфера глубины.
  const margin = Math.max(size.x, size.y, size.z) * 0.9 + 0.3;

  if (VIEW === 'garage') {
    /**
     * Три четверти для витрины — как в первой браузерной игре: машина
     * довёрнута к камере, камера чуть выше линии капота, ракурс
     * зафиксирован раз и навсегда. Перспектива длиннофокусная: так снимают
     * машину в каталоге, у широкого угла разъезжаются края.
     *
     * Доворачивается сама машина, а не камера: тогда риг из трёх ламп
     * остаётся на месте и свет во всех ракурсах один.
     */
    const spec = CONFIG.views?.garage ?? {};
    const fov = spec.fov_deg ?? 16;
    const reach = (CONFIG.camera.ortho_scale / 2) / Math.tan((fov / 2) * Math.PI / 180);
    root.rotation.y = -(spec.yaw_deg ?? 34) * Math.PI / 180;
    root.updateWorldMatrix(true, true);

    const pitch = (spec.pitch_deg ?? 11) * Math.PI / 180;
    camera = new PerspectiveCamera(fov, W / H, Math.max(0.05, reach - margin), reach + margin);
    camera.position.set(
      centre.x,
      centre.y + Math.sin(pitch) * reach,
      centre.z + Math.cos(pitch) * reach,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(centre.x, centre.y, centre.z);
  } else {
    camera = new OrthographicCamera(
      -half, half, half * H / W, -half * H / W,
      dist - margin, dist + margin,
    );
    // Нос модели смотрит в +X, значит камера встаёт на +Z: тогда на экране
    // машина едет вправо, как и рисовалась вектором.
    camera.position.set(centre.x, centre.y, centre.z + dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(centre.x, centre.y, centre.z);
  }

  const original = new Map();
  for (const list of Object.values(groups)) {
    for (const node of list) original.set(node, node.material);
  }

  /**
   * Названные слои видны, остальные работают заслонкой: пишут глубину,
   * но не цвет.
   *
   * Без этого деталь с дальней стороны машины — зеркало, воздуховод,
   * противоположный порог — попадала в кадр поверх кузова: слой снимается
   * отдельно, заслонять её нечем, и на двери появлялось чёрное пятно.
   */
  /**
   * Только названные слои, остальное скрыто совсем. Нужно остеклению:
   * кузов у этих моделей — замкнутая оболочка, стёкла сидят внутри неё,
   * и с заслонкой слой выходит пустым.
   */
  const only = (names) => {
    for (const [key, list] of Object.entries(groups)) {
      const wanted = names.includes(key);
      for (const node of list) {
        node.visible = wanted;
        if (wanted) node.material = original.get(node);
      }
    }
  };

  const maskMat = new MeshBasicMaterial({ colorWrite: false });
  const show = (names) => {
    for (const [key, list] of Object.entries(groups)) {
      const wanted = names.includes(key);
      for (const node of list) {
        node.visible = true;
        node.material = wanted ? original.get(node) : maskMat;
      }
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
  show(['body']);
  swap(groups.body, grey);
  const body = shoot();
  const bodyCanvas = flatten(grab(), {
    blur: px(STYLE.body_blur ?? 0.002),
    levels: STYLE.body_levels ?? null,
  });
  const sheets = { body: bodyCanvas };

  swap(groups.body, gloss);
  shoot();
  sheets.shade = flatten(grab(), {
    blur: px(STYLE.gloss_blur ?? 0.004),
    levels: STYLE.gloss_levels ?? null,
  });
  swap(groups.body, original.get(groups.body[0]));

  show(['glass']);
  shoot();
  // Слои с собственным цветом. Красится только кузов; чёрные окантовки,
  // решётки, зеркало и бампера остаются чёрными, хром — светлым. Из них
  // и складывается детализация, которой не даёт ни одна линия.
  show(['trim']);
  shoot();
  sheets.trim = flatten(grab(), { blur: px(0.0008), levels: null });

  show(['chrome']);
  shoot();
  sheets.chrome = flatten(grab(), { blur: px(0.0008), levels: null });

  only(['glass']);
  shoot();
  sheets.glass = flatten(grab(), { blur: px(0.001), levels: null });

  show(['light']);
  shoot();
  // Фара размывается сильнее прочих деталей. Строго сбоку стекло стоит
  // к камере ребром: на кадре от него остаётся узкая полоса, сходящая
  // на нет острым концом. Резкий край такой полосы читается не фарой,
  // а клином, воткнутым в крыло, — половина пикселя размытия его скругляет.
  sheets.light = flatten(grab(), { blur: px(0.0018), levels: null });

  show(['tail']);
  shoot();
  sheets.tail = flatten(grab(), { blur: px(0.0008), levels: null });

  show(['wheel', 'tyre', 'rim']);
  const wheels = shoot();
  // Резина тёмная, а диск должен читаться: спицы видно только по перепаду
  // между ступенями, своей линии у них нет — сбоку они сливаются в один круг.
  const wheelCanvas = flatten(grab(), { blur: px(0.0004), levels: null });

  /**
   * Пасс глубины по всей машине — из него считается карта каверн.
   *
   * Снимается в отдельную цель без мультисэмплинга и без тональной кривой:
   * глубина упакована в четыре байта, и любое усреднение соседних пикселей
   * или кривая превращают её в мусор.
   */
  {
    const depthMat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    show(['body', 'trim', 'chrome', 'glass', 'light', 'tail', 'wheel', 'tyre', 'rim']);
    swapAll(depthMat);
    const target = new WebGLRenderTarget(W, H, { samples: 0 });
    const tone = renderer.toneMapping;
    const space = renderer.outputColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const raw = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, raw);
    renderer.setRenderTarget(null);
    renderer.toneMapping = tone;
    renderer.outputColorSpace = space;
    target.dispose();
    restoreAll();

    // readRenderTargetPixels отдаёт кадр снизу вверх — переворачиваем.
    const pixels = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      pixels.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    }

    /**
     * Пасс нормалей — из него считается карта стыков. Тот же кадр, та же
     * цель без мультисэмплинга: усреднение соседних пикселей размывает
     * ровно тот перепад, который мы ищем.
     */
    swapAll(new MeshNormalMaterial());
    const nTarget = new WebGLRenderTarget(W, H, { samples: 0 });
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.setRenderTarget(nTarget);
    renderer.render(scene, camera);
    const nRaw = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(nTarget, 0, 0, W, H, nRaw);
    renderer.setRenderTarget(null);
    renderer.toneMapping = tone;
    renderer.outputColorSpace = space;
    nTarget.dispose();
    restoreAll();

    const normals = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      normals.set(nRaw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    }

    // Глубина: четыре байта на число, распаковывается один раз на обе карты.
    const depth = new Float32Array(W * H);
    const solid = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = pixels[i * 4] / 255, g = pixels[i * 4 + 1] / 255;
      const b = pixels[i * 4 + 2] / 255, a = pixels[i * 4 + 3] / 255;
      const d = r + g / 255 + b / 65025 + a / 16581375;
      depth[i] = d;
      // Фон лежит на дальней плоскости — в расчёт не берём.
      solid[i] = d < 0.999 ? 1 : 0;
    }

    const SEAM = CONFIG.style?.seams ?? {};
    const rad = (deg) => Math.cos((deg ?? 0) * Math.PI / 180);
    const seams = SEAM.strength > 0 ? seamMap(normals, depth, solid, W, H, {
      step: Math.max(1, Math.round((SEAM.step ?? 0.0007) * W)),
      cosMin: rad(SEAM.angle_min_deg ?? 34),
      cosFull: rad(SEAM.angle_full_deg ?? 70),
      strength: SEAM.strength ?? 0.5,
      limit: SEAM.limit_m ?? 0.03,
      range: margin * 2,
      soften: (SEAM.soften ?? 0.0004) * W,
    }) : null;

    const AO = CONFIG.style?.cavity ?? {};
    const cavity = cavityMap(depth, solid, W, H, {
      radius: Math.max(2, Math.round((AO.radius ?? 0.006) * W)),
      strength: AO.strength ?? 0.55,
      limit: AO.limit_m ?? 0.04,
      full: AO.full_m ?? 0.008,
      floor: AO.floor_m ?? 0.0015,
      soften: (AO.soften ?? 0.0005) * W,
      dilate: Math.round((AO.dilate ?? 0.0006) * W),
      range: margin * 2,
    });

    if (PARAMS.get('debug') === 'cavity') {
      out.cavity = cavity.toDataURL('image/png');
      if (seams) out.seams = seams.toDataURL('image/png');
    }
    /**
     * Тень кладётся умножением в каждый неподвижный слой. В профиль колесо
     * крутится, и запечённая в него тень арки ехала бы вместе со спицами;
     * в три четверти колесо стоит в кадре намертво — там оно тоже слой.
     */
    const shaded = VIEW === 'race' ? Object.values(sheets) : [...Object.values(sheets), wheelCanvas];
    for (const sheet of shaded) {
      // Маску слоя надо сохранить до умножения: умножение зальёт прозрачные
      // места чёрным, и вернуть их будет нечем.
      const mask = document.createElement('canvas');
      mask.width = W; mask.height = H;
      mask.getContext('2d').drawImage(sheet, 0, 0);

      const g = sheet.getContext('2d');
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.drawImage(cavity, 0, 0);
      if (seams) g.drawImage(seams, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(mask, 0, 0);
      g.restore();
    }
  }

  // Габарит считается по всем неподвижным слоям: у кузова после разделения
  // на детали свой контур уже, чем у машины.
  show(['body', 'trim', 'chrome', 'glass', 'light', 'tail']);
  const whole = shoot();
  const bodyBox = bounds(whole.pixels);
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

  for (const [name, sheet] of Object.entries(sheets)) {
    out[name] = sheet.toDataURL('image/png');
  }

  const circles = halves.map((h) => ({
    cx: Math.round((h.x0 + h.x1) / 2),
    cy: Math.round((h.y0 + h.y1) / 2),
    r: Math.round(Math.max(h.x1 - h.x0, h.y1 - h.y0) / 2),
  }));

  /**
   * Спрайт колеса — квадрат вокруг заднего, а не переднего: сцена крутит его
   * вокруг центра и ставит на оба места.
   *
   * Переднее в исходниках почти всегда стоит с вывернутым рулём: сбоку диск
   * тогда виден не в профиль, а вполоборота, и на трассе оба колеса едут
   * боком. Заднее стоит прямо всегда.
   */
  const front = circles[0];
  if (VIEW !== 'race') {
    // В три четверти колесо не крутится: витрина — статичная картинка,
    // как и в первой браузерной игре. Кладём его целым кадром, в общий стек.
    out.wheel = wheelCanvas.toDataURL('image/png');
    window.done = {
      images: out,
      meta: {
        frame: [W, H],
        box: bodyBox,
        ground: Math.max(bodyBox.y1, bounds(wheels.pixels).y1),
        wheels: [],
        length_m: CONFIG.car_length_m,
      },
    };
    return;
  }

  /**
   * Колесо снимается вдвое подробнее кадра.
   *
   * Сцена рисуется втрое крупнее кадра и ужимается до него — на кузове это
   * ровно то, что нужно, а колесо после ужимания остаётся кружком в двести
   * пикселей, и спицы, болты и тормозной диск в нём сливаются. Квадрат
   * вокруг колеса вырезается прямо из крупного буфера, до ужимания:
   * это те же самые отрисованные пиксели, просто не выброшенные.
   *
   * Спрайт всё равно кладётся по радиусу из meta, поэтому его разрешение
   * ни на что, кроме чёткости, не влияет: незыблемое правило про общий
   * кадр библиотеки не нарушено.
   */
  // Колесо снимается с запасом, но не вдвое: на двух оно выходило заметно
  // резче кузова, и машина рядом с ним казалась мыльной.
  const WHEEL_SS = 1.6;
  show(['wheel', 'tyre', 'rim']);
  renderer.render(scene, camera);
  {
    const src = { x: (front.cx - front.r) * SS, y: (front.cy - front.r) * SS, side: front.r * 2 * SS };
    const raw = document.createElement('canvas');
    raw.width = src.side; raw.height = src.side;
    const rawCtx = raw.getContext('2d');
    // Фильтр восстановления берётся вполсилы: он рассчитан на ужимание втрое,
    // а колесо ужимается всего в полтора раза — на полной ширине спицы
    // и болты уходили бы в мыло.
    rawCtx.filter = FILTER > 1.5 ? 'blur(' + (FILTER * SS / 6).toFixed(2) + 'px)' : 'none';
    rawCtx.drawImage(renderer.domElement, src.x, src.y, src.side, src.side, 0, 0, src.side, src.side);
    rawCtx.filter = 'none';

    const side = front.r * 2 * WHEEL_SS;
    const hi = document.createElement('canvas');
    hi.width = side; hi.height = side;
    const hiCtx = hi.getContext('2d');
    hiCtx.imageSmoothingQuality = 'high';
    hiCtx.drawImage(raw, 0, 0, side, side);
    out.wheel = flatten(hi, { blur: px(0.0002) * WHEEL_SS, levels: null }).toDataURL('image/png');
  }

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
// Декорации тайлятся во всю ширину экрана, поэтому снимаются кадром втрое
// крупнее машинного. Машинам кадр менять нельзя — см. «незыблемое правило».
const frame = mode === 'car' ? 1 : 2;
await page.goto(`http://localhost:${port}/?mode=${mode}&axis=${axis}&frame=${frame}&view=${view}&debug=${flag('debug') ?? ''}`);
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
    // Порядок наложения. В профиле колесо в список не входит: сцена рисует
    // его отдельно и с поворотом. В три четверти оно лежит в общем стеке.
    order: view === 'race'
      ? ['body', 'shade', 'trim', 'chrome', 'glass', 'light', 'tail']
      : ['body', 'shade', 'wheel', 'trim', 'chrome', 'glass', 'light', 'tail'],
  };
  writeFileSync(`${outDir}/layers.json`, JSON.stringify(manifest, null, 2));
  console.log(`  ${outDir}/layers.json`);
  console.log(manifest.wheels.length
    ? `колёса: ${manifest.wheels.map((w) => `${w.cx},${w.cy} r${w.r}`).join('  ')}  земля ${manifest.ground}`
    : `ракурс ${view}, колёса в кадре, земля ${manifest.ground}`);
}

console.log(`итого ${(total / 1024).toFixed(0)} КБ`);
