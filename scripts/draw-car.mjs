/**
 * Векторная перерисовка машины поверх 3D-рендера.
 *
 *   node scripts/draw-car.mjs --car <id>
 *
 * Зачем. Фотореалистичный рендер сбоку читается плохо: вылезает рельеф
 * исходной модели, а контур, снятый с пиксельной маски, всегда выходит
 * рваным и колючим. В рисованном оригинале машина — заливки и гладкие
 * кривые.
 *
 * Рисовать «на глаз» тоже нельзя: пропорции уедут. Поэтому обводы берутся
 * из готового рендера (там они точные), переводятся в кривые и заново
 * рисуются заливкой и линией. Пропорции модели, подача рисунка.
 *
 * Порядок: сначала scripts/render-sprites.mjs, потом этот скрипт. Он
 * переписывает те же PNG в public/sprites/<id>/, манифест не трогает —
 * геометрия колёс и габарит остаются от рендера.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const rest = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};

const carId = flag('--car');
if (!carId) {
  console.error('Использование: node scripts/draw-car.mjs --car <id>');
  process.exit(1);
}

const dir = `public/sprites/${carId}`;
if (!existsSync(`${dir}/layers.json`)) {
  console.error(`Нет рендера: ${dir}/layers.json. Сначала render-sprites.mjs.`);
  process.exit(1);
}

const META = JSON.parse(readFileSync(`${dir}/layers.json`, 'utf8'));
const STYLE = JSON.parse(readFileSync('assets/render/camera.json', 'utf8')).style ?? {};
const linesFile = `assets/render/lines/${carId}.json`;
const LINES = existsSync(linesFile) ? JSON.parse(readFileSync(linesFile, 'utf8')) : { lines: [] };

// ── страница ─────────────────────────────────────────────────────────────────

const PAGE = `<!doctype html>
<meta charset="utf-8" />
<style>html,body{margin:0;background:#000}</style>
<script id="meta" type="application/json">${JSON.stringify(META)}</script>
<script id="style" type="application/json">${JSON.stringify(STYLE)}</script>
<script id="lines" type="application/json">${JSON.stringify(LINES)}</script>
<script type="module">
const META = JSON.parse(document.getElementById('meta').textContent);
const STYLE = JSON.parse(document.getElementById('style').textContent);
const HAND = JSON.parse(document.getElementById('lines').textContent);
const [W, H] = META.frame;

/** Палитра рисунка. Кузов — оттенки серого: игра множит его на цвет окраски. */
const INK = STYLE.ink ?? '#111417';
const PAINT_TOP = STYLE.paint_top ?? '#ffffff';
const PAINT_BOTTOM = STYLE.paint_bottom ?? '#8f949a';
const TRIM = STYLE.trim_color ?? '#1b1e22';
const CHROME = STYLE.chrome_color ?? '#c9ced5';
const GLASS = STYLE.glass_color ?? '#2f3841';
const GLASS_HI = STYLE.glass_hi ?? '#4d5a66';
const LAMP = STYLE.lamp_color ?? '#f2e4c4';
const TAIL = STYLE.tail_color ?? '#c3402f';
const TYRE = STYLE.tyre_color ?? '#15171a';
const RIM = STYLE.rim_color ?? '#a8aeb6';

const OUTLINE_PX = STYLE.edge_outline_px ?? 11;
const LINE_PX = STYLE.edge_line_px ?? 6.5;

function load(src) {
  return new Promise((done) => {
    const image = new Image();
    image.onload = () => done(image);
    image.onerror = () => done(null);
    image.src = src;
  });
}

/** Альфа слоя как двоичная маска. */
function maskOf(image) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  // Порог низкий нарочно: остекление прозрачное, у него альфа около 0.3,
  // и по «половине» оно в маску не попадает.
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 40 ? 1 : 0;
  return mask;
}

/**
 * Обход границы связной области по Муру. Даёт замкнутый контур в пикселях —
 * дальше он упрощается и сглаживается, и линия перестаёт быть пиксельной.
 */
function trace(mask, w, h, minArea) {
  const seen = new Uint8Array(mask.length);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const shapes = [];

  // Площадь области — заливкой, чтобы отбросить мелочь.
  const stack = new Int32Array(mask.length);
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const p = sy * w + sx;
      if (!mask[p] || seen[p]) continue;
      let top = 0, area = 0, startX = sx, startY = sy;
      stack[top++] = p; seen[p] = 1;
      while (top > 0) {
        const q = stack[--top];
        area++;
        const x = q % w, y = (q / w) | 0;
        if (y < startY || (y === startY && x < startX)) { startX = x; startY = y; }
        for (const n of [q - 1, q + 1, q - w, q + w]) {
          if (n < 0 || n >= mask.length || !mask[n] || seen[n]) continue;
          seen[n] = 1; stack[top++] = n;
        }
      }
      if (area < minArea) continue;

      // Обход: идём по границе, держась «правой руки».
      const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      const points = [];
      let cx = startX, cy = startY, dir = 6;
      const first = [cx, cy];
      let guard = 0;
      do {
        points.push([cx, cy]);
        let moved = false;
        for (let k = 0; k < 8; k++) {
          const d = (dir + 6 + k) % 8;
          const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
          if (!at(nx, ny)) continue;
          cx = nx; cy = ny; dir = d; moved = true;
          break;
        }
        if (!moved) break;
      } while ((cx !== first[0] || cy !== first[1]) && ++guard < 400000);

      if (points.length > 12) shapes.push(points);
    }
  }
  return shapes;
}

/** Упрощение Рамера—Дугласа—Пекера: убирает пиксельную лесенку. */
function simplify(points, eps) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const work = [[0, points.length - 1]];
  while (work.length) {
    const [a, b] = work.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    let best = -1, bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; work.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Сглаживание Чайкина: углы срезаются, ломаная становится кривой. */
function smooth(points, passes) {
  let out = points;
  for (let n = 0; n < passes; n++) {
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const [x0, y0] = out[i];
      const [x1, y1] = out[(i + 1) % out.length];
      next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      next.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out = next;
  }
  return out;
}

/** Кривая через точки: середины отрезков соединяются квадратичными дугами. */
function path(g, points) {
  g.beginPath();
  const n = points.length;
  let [px, py] = points[n - 1];
  let [x, y] = points[0];
  g.moveTo((px + x) / 2, (py + y) / 2);
  for (let i = 0; i < n; i++) {
    const [cxp, cyp] = points[i];
    const [nx, ny] = points[(i + 1) % n];
    g.quadraticCurveTo(cxp, cyp, (cxp + nx) / 2, (cyp + ny) / 2);
  }
  g.closePath();
}

/** Контуры слоя, готовые к рисованию. */
function shapesOf(mask, { minArea = 400, eps = 2.2, passes = 2 } = {}) {
  return trace(mask, W, H, minArea).map((pts) => smooth(simplify(pts, eps), passes));
}

function blank() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}

window.done = null;

(async () => {
  const layers = {};
  const report = [];
  for (const name of ['body', 'trim', 'chrome', 'glass', 'light', 'tail']) {
    const image = await load(name + '.png');
    if (!image) { layers[name] = []; report.push(name + ': нет файла'); continue; }
    const mask = maskOf(image);
    let on = 0;
    for (let i = 0; i < mask.length; i++) on += mask[i];
    // Мелкие детали — фары, молдинги — ловим порогом пониже.
    layers[name] = shapesOf(mask, name === 'body' ? {} : { minArea: 60, eps: 1.6 });
    report.push(name + ': пикселей ' + on + ', контуров ' + layers[name].length);
  }

  const out = {};

  // ── кузов ──────────────────────────────────────────────────────────────────
  //
  // Серым, а не цветом: игра множит слой на цвет окраски. Растяжка сверху вниз
  // даёт объём без единой ступени, а контур обводит уже кривую, а не маску.
  {
    const c = blank();
    const g = c.getContext('2d');
    const box = META.box;
    const fill = g.createLinearGradient(0, box.y0, 0, box.y1);
    fill.addColorStop(0, PAINT_TOP);
    fill.addColorStop(0.55, PAINT_TOP);
    fill.addColorStop(1, PAINT_BOTTOM);
    for (const shape of layers.body) {
      path(g, shape);
      g.fillStyle = fill;
      g.fill();
    }
    out.body = c.toDataURL('image/png');
  }

  // Блик кладётся сложением — отдельным слоем, как и в рендере.
  {
    const c = blank();
    const g = c.getContext('2d');
    const box = META.box;
    const band = g.createLinearGradient(0, box.y0, 0, box.y0 + (box.y1 - box.y0) * 0.55);
    band.addColorStop(0, 'rgba(255,255,255,0.55)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    for (const shape of layers.body) {
      path(g, shape);
      g.fillStyle = band;
      g.fill();
    }
    out.shade = c.toDataURL('image/png');
  }

  const plain = (shapes, color, stroke) => {
    const c = blank();
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const shape of shapes) {
      path(g, shape);
      g.fillStyle = color;
      g.fill();
      if (stroke) {
        g.strokeStyle = INK;
        g.lineWidth = LINE_PX * 0.7;
        g.stroke();
      }
    }
    return c.toDataURL('image/png');
  };

  out.trim = plain(layers.trim, TRIM, false);
  out.chrome = plain(layers.chrome, CHROME, true);
  out.light = plain(layers.light, LAMP, true);
  out.tail = plain(layers.tail, TAIL, true);

  // ── стёкла ────────────────────────────────────────────────────────────────
  {
    const c = blank();
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    for (const shape of layers.glass) {
      path(g, shape);
      g.fillStyle = GLASS;
      g.fill();
      // Косая светлая полоса по стеклу — так рисуют отражение неба.
      g.save();
      g.clip();
      g.fillStyle = GLASS_HI;
      g.globalAlpha = 0.5;
      const box = META.box;
      g.beginPath();
      g.moveTo(box.x0, box.y0 + (box.y1 - box.y0) * 0.30);
      g.lineTo(box.x1, box.y0 - (box.y1 - box.y0) * 0.10);
      g.lineTo(box.x1, box.y0 + (box.y1 - box.y0) * 0.02);
      g.lineTo(box.x0, box.y0 + (box.y1 - box.y0) * 0.42);
      g.closePath();
      g.fill();
      g.restore();
      path(g, shape);
      g.strokeStyle = INK;
      g.lineWidth = LINE_PX;
      g.stroke();
    }
    out.glass = c.toDataURL('image/png');
  }

  // ── контур и линии панелей ────────────────────────────────────────────────
  {
    const c = blank();
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = INK;

    g.lineWidth = OUTLINE_PX;
    for (const shape of layers.body) { path(g, shape); g.stroke(); }

    g.lineWidth = LINE_PX;
    for (const item of HAND.lines ?? []) {
      g.beginPath();
      if (item.arc) {
        const [cx, cy, r, from, to] = item.arc;
        g.arc(cx * W, cy * H, r * W, from * Math.PI / 180, to * Math.PI / 180);
      } else if (item.path?.length > 1) {
        const pts = item.path.map(([x, y]) => [x * W, y * H]);
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i];
          const [x1, y1] = pts[i + 1];
          if (i === pts.length - 2) g.lineTo(x1, y1);
          else g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        if (item.closed) g.closePath();
      }
      g.stroke();
    }
    out.edge = c.toDataURL('image/png');
  }

  // ── колесо ────────────────────────────────────────────────────────────────
  //
  // Рисуется параметрически: резина, диск, спицы, ступица. Обводить рендер
  // колеса незачем — сбоку это круг, и в рисунке он такой же.
  {
    const r = META.wheels[0].r;
    const size = r * 2 + 1;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const mid = size / 2;
    const spokes = STYLE.wheel_spokes ?? 5;

    g.beginPath(); g.arc(mid, mid, r, 0, Math.PI * 2);
    g.fillStyle = TYRE; g.fill();
    g.strokeStyle = INK; g.lineWidth = LINE_PX * 0.8; g.stroke();

    g.beginPath(); g.arc(mid, mid, r * 0.66, 0, Math.PI * 2);
    g.fillStyle = RIM; g.fill();
    g.strokeStyle = INK; g.lineWidth = LINE_PX * 0.7; g.stroke();

    g.strokeStyle = INK;
    g.lineWidth = LINE_PX * 0.8;
    g.lineCap = 'round';
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      g.beginPath();
      g.moveTo(mid + Math.cos(a) * r * 0.20, mid + Math.sin(a) * r * 0.20);
      g.lineTo(mid + Math.cos(a) * r * 0.60, mid + Math.sin(a) * r * 0.60);
      g.stroke();
    }

    g.beginPath(); g.arc(mid, mid, r * 0.20, 0, Math.PI * 2);
    g.fillStyle = CHROME; g.fill();
    g.strokeStyle = INK; g.lineWidth = LINE_PX * 0.6; g.stroke();

    out.wheel = c.toDataURL('image/png');
  }

  window.done = { images: out, report };
})();
</script>
`;

// ── статика ──────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  const file = resolve(join(dir, url));
  if (!existsSync(file) || extname(file) !== '.png') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'image/png' });
  res.end(readFileSync(file));
});

await new Promise((done) => server.listen(0, done));
const port = server.address().port;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('ошибка страницы:', error.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.done !== null, null, { timeout: 300_000 });
const result = await page.evaluate(() => window.done);
await browser.close();
server.close();

if (result.report) console.log(result.report.join('\n'));

let total = 0;
for (const [name, dataUrl] of Object.entries(result.images)) {
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(`${dir}/${name}.png`, bytes);
  total += bytes.length;
  console.log(`  ${dir}/${name}.png`.padEnd(44) + `${(bytes.length / 1024).toFixed(0)} КБ`);
}

// Слой контура добавляется к манифесту: в рисунке он поверх всего.
META.order = ['body', 'shade', 'trim', 'chrome', 'glass', 'light', 'tail', 'edge'];
writeFileSync(`${dir}/layers.json`, JSON.stringify(META, null, 2));
console.log(`итого ${(total / 1024).toFixed(0)} КБ`);
