/**
 * Pimp: окраска и номер. Раздел живёт отдельной вкладкой и под своим именем —
 * так было в оригинале, и это одна из немногих деталей, по которым игра
 * узнаётся (§2, §9). Ничего отсюда не влияет на заезд.
 *
 * Порядок блоков из макета: витрина → ряд вкладок → сетка образцов →
 * поле номера → финишная лента.
 */

import '../ui/theme.css';
import './pimp.css';
import { getModel } from '../core/index.ts';
import { Stage } from '../garage/stage.ts';
import { PAINTS } from '../render/palette.ts';
import { mountChrome, mountFooter } from '../ui/chrome.ts';
import { currentIndex, owned } from '../ui/state.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const PAINT_NAMES: Record<string, string> = {
  white: 'Белый',
  black: 'Чёрный',
  red: 'Красный',
  blue: 'Синий',
  green: 'Зелёный',
  yellow: 'Жёлтый',
  orange: 'Оранжевый',
  silver: 'Серебро',
  purple: 'Фиолетовый',
  cyan: 'Бирюза',
};

const index = currentIndex();
const entry = owned[index]!;
const model = getModel(entry.car.modelId);
const startPaint = entry.paint;
const startPlate = entry.plate;

let stage: Stage | null = null;

/** Вкладки раздела. Живых две — остальное появится вместе со слоями рендера. */
const TABS = [
  { id: 'paint', label: 'Окраска' },
  { id: 'plate', label: 'Номер' },
];

function renderTabs(active: string): void {
  $('pimp-tabs').replaceChildren(...TABS.map((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = tab.label;
    button.setAttribute('aria-current', String(tab.id === active));
    button.addEventListener('click', () => {
      renderTabs(tab.id);
      const target = tab.id === 'paint' ? $('paints') : $('plate');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (tab.id === 'plate') ($('plate') as HTMLInputElement).focus();
    });
    return button;
  }));
}

function renderPaints(): void {
  $('paints').replaceChildren(...Object.entries(PAINTS).map(([name, hex]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(name === entry.paint));

    const swatch = document.createElement('i');
    swatch.style.background = hex;
    const label = document.createElement('span');
    label.textContent = PAINT_NAMES[name] ?? name;

    button.append(swatch, label);
    button.addEventListener('click', () => {
      entry.paint = name;
      stage?.setPaint(hex);
      renderPaints();
    });
    return button;
  }));
}

$('car-nick').textContent = model.nick;
$('car-model').textContent = model.name;
($('plate') as HTMLInputElement).value = entry.plate;

$('plate').addEventListener('input', (event) => {
  entry.plate = (event.target as HTMLInputElement).value;
});

$('reset').addEventListener('click', () => {
  entry.paint = startPaint;
  entry.plate = startPlate;
  ($('plate') as HTMLInputElement).value = startPlate;
  stage?.setPaint(PAINTS[startPaint] ?? startPaint);
  renderPaints();
});

stage = new Stage({ canvas: $('scene') as unknown as HTMLCanvasElement });
stage.setCar(entry.car.modelId, entry.paint);
stage.start();

window.addEventListener('resize', () => stage?.resize());

mountChrome('pimp');
mountFooter();
renderTabs('paint');
renderPaints();
