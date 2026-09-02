/**
 * Гараж: разводка интерфейса поверх трёхмерной сцены.
 *
 * Порядок разделов взят из оригинала (§9): гараж списком, характеристики
 * таблицей, Pimp под своим именем и отдельно от характеристик (§2).
 * Косметика на заезд не влияет — это железное правило §4 и §5.
 */

import './garage.css';
import {
  CLASS_RANGES, MAX_SPEC_LEVEL, getModel, horsepower, strength,
  type Car, type SpecKey,
} from '../core/index.ts';
import { PAINTS } from '../render/palette.ts';
import { Garage, LIGHT_RIG, type LightId } from './scene.ts';

const SPEC_LABELS: Record<SpecKey, string> = {
  tires: 'Шины',
  ignition: 'Зажигание',
  clutch: 'Сцепление',
  suspension: 'Подвеска',
  boost: 'Наддув',
  intake: 'Впуск',
  radiator: 'Радиатор',
};

/** Гараж игрока. До бэкенда (шаг 4) — набор показательных машин. */
const OWNED: { car: Car; paint: string; plate: string }[] = [
  {
    car: { modelId: 'zarya965', specs: { tires: 8, ignition: 7, clutch: 6, suspension: 5, boost: 9, intake: 7, radiator: 4 } },
    paint: 'red', plate: 'К 348 ЕЕ',
  },
  {
    car: { modelId: 'lada6', specs: { tires: 4, ignition: 3, clutch: 3, suspension: 2, boost: 5, intake: 4, radiator: 3 } },
    paint: 'white', plate: 'О 006 ОО',
  },
  {
    car: { modelId: 'ronin_gx', specs: { tires: 6, ignition: 6, clutch: 5, suspension: 6, boost: 4, intake: 5, radiator: 6 } },
    paint: 'cyan', plate: 'Х 777 УЙ',
  },
  {
    car: { modelId: 'bavar320', specs: { tires: 2, ignition: 1, clutch: 2, suspension: 1, boost: 0, intake: 1, radiator: 2 } },
    paint: 'black', plate: 'В 001 МР',
  },
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let index = 0;
let garage: Garage | null = null;
/**
 * Откуда брать GLB. В приложении это файл из public, в самодостаточной
 * странице — data-URI, вшитый в сборку: там внешние загрузки запрещены.
 */
let resolveModelUrl: (modelId: string) => string = (id) => `/models/${id}.glb`;

// ── список машин ─────────────────────────────────────────────────────────────

function renderCarList(): void {
  const list = $('car-list');
  list.replaceChildren(...OWNED.map((entry, i) => {
    const model = getModel(entry.car.modelId);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(i === index));
    button.innerHTML =
      `<span class="klass">${model.klass}</span>` +
      `<span class="nick">${model.nick}</span>` +
      `<span class="hp">${horsepower(entry.car)}</span>`;
    button.addEventListener('click', () => select(i));
    item.append(button);
    return item;
  }));
}

// ── характеристики ───────────────────────────────────────────────────────────

function renderSpecs(): void {
  const entry = OWNED[index]!;
  const model = getModel(entry.car.modelId);
  const table = $('specs');
  table.replaceChildren(...(Object.keys(SPEC_LABELS) as SpecKey[]).map((key) => {
    const level = entry.car.specs[key];
    const row = document.createElement('tr');

    const label = document.createElement('td');
    label.textContent = SPEC_LABELS[key];

    const trackCell = document.createElement('td');
    const track = document.createElement('div');
    track.className = 'track';
    for (let i = 0; i < MAX_SPEC_LEVEL; i++) {
      const tick = document.createElement('i');
      // Последнее закрашенное деление другого цвета: видно, где ты сейчас.
      if (i < level) tick.className = i === level - 1 ? 'on head' : 'on';
      track.append(tick);
    }
    trackCell.append(track);

    const value = document.createElement('td');
    value.textContent = String(level);

    row.append(label, trackCell, value);
    return row;
  }));

  const value = strength(entry.car);
  $('rating').textContent = value.toFixed(0);

  const ceiling = CLASS_RANGES[model.klass].max;
  const left = ceiling - value;
  $('ceiling').textContent = left < 0.5
    ? `Потолок класса ${model.klass} взят. Дальше — только следующая машина.`
    : `До потолка класса ${model.klass} ещё ${left.toFixed(0)} баллов.`;
}

// ── Pimp ─────────────────────────────────────────────────────────────────────

function renderPaints(): void {
  const entry = OWNED[index]!;
  const box = $('paints');
  box.replaceChildren(...Object.entries(PAINTS).map(([name, hex]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.background = hex;
    button.title = name;
    button.setAttribute('aria-pressed', String(name === entry.paint));
    button.addEventListener('click', () => {
      entry.paint = name;
      garage?.setBodyColor(hex);
      renderPaints();
    });
    return button;
  }));
}

// ── лампы ────────────────────────────────────────────────────────────────────

function renderLamps(): void {
  const box = $('lamps');
  box.replaceChildren(...LIGHT_RIG.map((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    button.style.color = `#${item.color.toString(16).padStart(6, '0')}`;
    button.setAttribute('aria-pressed', 'true');
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      garage?.setLightEnabled(item.id as LightId, on);
    });
    return button;
  }));
}

// ── выбор машины ─────────────────────────────────────────────────────────────

function select(next: number): void {
  index = next;
  const entry = OWNED[index]!;
  const model = getModel(entry.car.modelId);

  $('car-nick').textContent = model.nick;
  $('car-model').textContent = model.name;
  ($('plate') as HTMLInputElement).value = entry.plate;

  renderCarList();
  renderSpecs();
  renderPaints();

  $('loading').hidden = false;
  $('loading').textContent = 'Загружаю модель…';
  garage?.dispose();
  garage = new Garage({
    canvas: $('scene') as unknown as HTMLCanvasElement,
    modelUrl: resolveModelUrl(entry.car.modelId),
    onReady: () => {
      garage?.setBodyColor(PAINTS[entry.paint] ?? '#d8dce3');
      $('loading').hidden = true;
    },
    onError: (error) => {
      console.error(error);
      $('loading').textContent = 'Модель не загрузилась. Проверьте, собран ли public/models.';
    },
  });
  garage.setBodyColor(PAINTS[entry.paint] ?? '#d8dce3');
  garage.start();
  $('toggle-spin').setAttribute('aria-pressed', 'true');
}

// ── прочее ───────────────────────────────────────────────────────────────────

$('toggle-spin').addEventListener('click', () => {
  if (!garage) return;
  const spinning = !garage.isSpinning();
  garage.setSpinning(spinning);
  $('toggle-spin').setAttribute('aria-pressed', String(spinning));
});

$('plate').addEventListener('input', (event) => {
  OWNED[index]!.plate = (event.target as HTMLInputElement).value;
});

window.addEventListener('resize', () => garage?.resize());

// Вкладку свернули — не жжём батарею на вращающемся подиуме.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) garage?.stop();
  else garage?.start();
});

/** Точка входа. `resolve` подменяется в сборке страницы-артефакта. */
export function mountGarage(resolve?: (modelId: string) => string): void {
  if (resolve) resolveModelUrl = resolve;
  renderLamps();
  select(0);
}
