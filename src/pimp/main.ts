/**
 * Pimp: окраска, номер, свет в боксе.
 *
 * Раздел живёт отдельной вкладкой и под своим именем — так было в оригинале,
 * и это одна из немногих деталей, по которым игра узнаётся (§2, §9).
 * Ничего отсюда не влияет на заезд.
 */

import '../ui/theme.css';
import '../garage/garage.css';
import './pimp.css';
import { getModel } from '../core/index.ts';
import { Stage } from '../garage/stage.ts';
import { PAINTS } from '../render/palette.ts';
import { mountChrome, mountFooter } from '../ui/chrome.ts';
import { currentIndex, owned } from '../ui/state.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const index = currentIndex();
const entry = owned[index]!;
const model = getModel(entry.car.modelId);

let stage: Stage | null = null;

function renderPaints(): void {
  $('paints').replaceChildren(...Object.entries(PAINTS).map(([name, hex]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.background = hex;
    button.title = name;
    button.setAttribute('aria-pressed', String(name === entry.paint));
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

stage = new Stage({ canvas: $('scene') as unknown as HTMLCanvasElement });
stage.setCar(entry.car.modelId, entry.paint);
stage.start();

window.addEventListener('resize', () => stage?.resize());

mountChrome('pimp');
mountFooter();
renderPaints();
