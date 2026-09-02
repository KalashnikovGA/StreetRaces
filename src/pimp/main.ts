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
import { Garage, LIGHT_RIG, type LightId } from '../garage/scene.ts';
import { PAINTS } from '../render/palette.ts';
import { mountChrome, mountFooter } from '../ui/chrome.ts';
import { currentIndex, owned } from '../ui/state.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const index = currentIndex();
const entry = owned[index]!;
const model = getModel(entry.car.modelId);

let stage: Garage | null = null;

function renderPaints(): void {
  $('paints').replaceChildren(...Object.entries(PAINTS).map(([name, hex]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.background = hex;
    button.title = name;
    button.setAttribute('aria-pressed', String(name === entry.paint));
    button.addEventListener('click', () => {
      entry.paint = name;
      stage?.setBodyColor(hex);
      renderPaints();
    });
    return button;
  }));
}

function renderLamps(): void {
  $('lamps').replaceChildren(...LIGHT_RIG.map((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'true');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.label;
    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = 'горит';

    button.append(name, state);
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      state.textContent = on ? 'горит' : 'погашена';
      stage?.setLightEnabled(item.id as LightId, on);
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

stage = new Garage({
  canvas: $('scene') as unknown as HTMLCanvasElement,
  modelUrl: `/models/${entry.car.modelId}.glb`,
  onReady: () => {
    stage?.setBodyColor(PAINTS[entry.paint] ?? '#d8d5ce');
    $('loading').hidden = true;
  },
  onError: (error) => {
    console.error(error);
    $('loading').textContent = 'Модель не загрузилась: собери public/models';
  },
});
stage.setBodyColor(PAINTS[entry.paint] ?? '#d8d5ce');
stage.start();

window.addEventListener('resize', () => stage?.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stage?.stop();
  else stage?.start();
});

mountChrome('pimp');
mountFooter();
renderPaints();
renderLamps();
