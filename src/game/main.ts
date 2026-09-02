/**
 * Страница заезда и повтора по ссылке. Шаги 2 и 3 из §14.
 *
 * Если в адресе есть повтор — проигрывается он, кадр в кадр, без регистрации.
 * Если нет — собирается заезд на выбранной в гараже машине, чтобы переход
 * «гараж → гонки» вёл туда же, куда вёл в оригинале.
 */

import '../ui/theme.css';
import './race.css';
import type { RaceResult } from '../core/race.ts';
import {
  CAR_MODELS, bestConfigFor, botCharacter, botConfig, getModel, horsepower, makeRng,
  race, randomSeed, strength, type Conditions, type RaceInput, type Racer, type Side,
} from '../core/index.ts';
import { decodeRace, replayUrl } from '../replay/codec.ts';
import { RaceScene, type SideVisual } from '../render/scene.ts';
import { RaceAudio } from '../audio/engine.ts';
import { PAINTS } from '../render/palette.ts';
import { mountChrome, mountFooter } from '../ui/chrome.ts';
import { currentIndex, owned } from '../ui/state.ts';

const canvas = document.getElementById('track') as HTMLCanvasElement;
const runButton = document.getElementById('run') as HTMLButtonElement;
const againButton = document.getElementById('again') as HTMLButtonElement;
const soundButton = document.getElementById('sound') as HTMLButtonElement;
const copyButton = document.getElementById('copy') as HTMLButtonElement;
const linkInput = document.getElementById('link') as HTMLInputElement;
const oddsBox = document.getElementById('odds') as HTMLElement;
const conditionsBox = document.getElementById('conditions') as HTMLElement;
const eventsBox = document.getElementById('events') as HTMLElement;
const verdictBox = document.getElementById('verdict') as HTMLElement;

const audio = new RaceAudio();
let scene: RaceScene | null = null;
let current: RaceInput = readInputFromUrl() ?? demoRace();

const PAINT_KEYS = Object.keys(PAINTS);

function visualFor(input: RaceInput, side: Side): SideVisual {
  const rng = makeRng(`${input.seed}/paint/${side}`);
  // Своя машина едет в своей окраске: она выбрана в Pimp и должна быть узнана.
  const mine = side === 'a' ? owned[currentIndex()] : undefined;
  return {
    name: input[side].name,
    pimp: {
      paint: mine?.paint ?? PAINT_KEYS[Math.floor(rng() * PAINT_KEYS.length)]!,
      neon: rng() < 0.35 ? '#6fd3ff' : null,
      drop: rng(),
    },
  };
}

/** Заезд на машине из гаража против случайного соседа. */
function demoRace(): RaceInput {
  const seed = randomSeed(Math.random);
  const rng = makeRng(`${seed}/demo`);
  const conditions: Conditions = {
    distance: (['short', 'medium', 'long'] as const)[Math.floor(rng() * 3)]!,
    surface: rng() < 0.35 ? 'wet' : 'dry',
    profile: rng() < 0.3 ? 'uphill' : 'flat',
  };
  const mine = owned[currentIndex()]!;
  const rival = CAR_MODELS[Math.floor(rng() * 4)]!;
  const level = () => Math.floor(rng() * 11);
  const a: Racer = {
    name: 'Ты',
    car: { modelId: mine.car.modelId, specs: { ...mine.car.specs } },
    config: bestConfigFor(conditions),
  };
  const b: Racer = {
    name: 'Сосед по двору',
    car: {
      modelId: rival.id,
      specs: {
        tires: level(), ignition: level(), clutch: level(), suspension: level(),
        boost: level(), intake: level(), radiator: level(),
      },
    },
    config: botConfig(conditions, 'regular', botCharacter(rng), rng),
  };
  return { a, b, conditions, seed };
}

function readInputFromUrl(): RaceInput | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const code = params.get('r');
  if (!code) return null;
  try {
    return decodeRace(code, { a: params.get('a') ?? undefined, b: params.get('b') ?? undefined });
  } catch (error) {
    console.warn('Повтор не читается:', error);
    return null;
  }
}

const CONDITION_WORDS: Record<string, string> = {
  short: '402 метра', medium: '800 метров', long: '1600 метров',
  dry: 'сухо', wet: 'мокро', flat: 'ровно', uphill: 'в подъём',
};

const CONFIG_WORDS: Record<string, string> = {
  slick: 'слик', sport: 'спорт', rain: 'дождевая',
  short: 'короткие', medium: 'средние', long: 'длинные',
  low: 'спущено', normal: 'штатное', high: 'подкачано',
  none: 'не жать', early: 'на старте', mid: 'в середине', late: 'под конец',
};

const WEIGHT_WORDS = ['нет', 'частично', 'полностью'];

/**
 * Расклад — таблица в две колонки. Числа сравнивают, значит они стоят
 * друг под другом, а не в двух отдельных абзацах.
 */
function renderOdds(input: RaceInput, result: RaceResult): void {
  const { conditions } = input;
  conditionsBox.textContent = [
    CONDITION_WORDS[conditions.distance],
    CONDITION_WORDS[conditions.surface],
    CONDITION_WORDS[conditions.profile],
  ].join(', ');

  const rows: { label: string; key?: boolean; value: (side: Side) => string }[] = [
    { label: 'Машина', value: (s) => getModel(input[s].car.modelId).nick },
    { label: 'Класс', value: (s) => getModel(input[s].car.modelId).klass },
    { label: 'Мощность', value: (s) => `${horsepower(input[s].car)} л.с.` },
    { label: 'Рейтинг', value: (s) => strength(input[s].car).toFixed(0) },
    { label: 'Настройка', value: (s) => `${(result[s].tuning.quality * 100).toFixed(0)}%` },
    { label: 'Резина', value: (s) => CONFIG_WORDS[input[s].config.tires]! },
    { label: 'Передаточные', value: (s) => CONFIG_WORDS[input[s].config.gearing]! },
    { label: 'Давление', value: (s) => CONFIG_WORDS[input[s].config.pressure]! },
    { label: 'Нитро', value: (s) => CONFIG_WORDS[input[s].config.nitro]! },
    { label: 'Снятие веса', value: (s) => WEIGHT_WORDS[input[s].config.weightCut]! },
    {
      label: 'Шанс до старта',
      key: true,
      value: (s) => `${((s === 'a' ? result.pWinA : 1 - result.pWinA) * 100).toFixed(1)}%`,
    },
  ];

  const head = document.createElement('tr');
  head.append(th(''), th(input.a.name), th(input.b.name));
  const body = rows.map((row) => {
    const tr = document.createElement('tr');
    if (row.key) tr.className = 'key';
    tr.append(td(row.label), td(row.value('a')), td(row.value('b')));
    return tr;
  });

  oddsBox.replaceChildren(head, ...body);
}

function th(text: string): HTMLTableCellElement {
  const node = document.createElement('th');
  node.textContent = text;
  return node;
}

function td(text: string): HTMLTableCellElement {
  const node = document.createElement('td');
  node.textContent = text;
  return node;
}

const EVENT_WORDS: Record<string, string> = {
  start: 'зелёный',
  wheelspin: 'сорвал колёса на старте',
  bog: 'не поехал с места — длинные передачи',
  shift: 'переключился',
  nitro: 'нитро',
  nitroWasted: 'нитро мимо момента',
  noNitro: 'без нитро',
  fade: 'встал на второй половине',
  unstable: 'машину таскает',
  overheat: 'перегрев',
  lead: 'вышел вперёд',
  finish: 'финиш',
};

function renderEvents(input: RaceInput, result: RaceResult): void {
  const lines = result.events
    .filter((event) => event.kind !== 'shift')
    .map((event) => {
      const who = event.side ? input[event.side].name : '';
      const gear = event.gear ? ` (${event.gear})` : '';
      return `${event.t.toFixed(2).padStart(5)}с  ${who.padEnd(16)} ${EVENT_WORDS[event.kind]}${gear}`;
    });
  lines.push('');
  lines.push(`забрал: ${input[result.winner].name}`);
  lines.push(`шанс победителя до старта: ${((result.winner === 'a' ? result.pWinA : 1 - result.pWinA) * 100).toFixed(1)}%`);
  lines.push(`бросок: ${result.roll.toFixed(6)}   сид: ${result.seed}`);
  if (result.miracle) lines.push('ЧУДО: слабейший вынес машину втрое сильнее');
  else if (result.upset) lines.push('апсет: победил не фаворит');
  eventsBox.textContent = lines.join('\n');
}

function updateLink(input: RaceInput): void {
  const url = replayUrl(input, location.origin);
  linkInput.value = url;
  history.replaceState(null, '', url.slice(url.indexOf('#')));
}

function verdict(input: RaceInput, result: RaceResult): void {
  const winner = input[result.winner].name;
  verdictBox.className = `verdict ${result.winner === 'a' ? 'won' : 'lost'}`;
  const tail = result.miracle
    ? ', и это чудо'
    : result.photoFinish ? ', фотофиниш' : result.upset ? ', не фаворит' : '';
  verdictBox.textContent = `${winner} забрал${tail}`;
}

function load(input: RaceInput): void {
  current = input;
  scene?.stop();
  audio.stop();
  verdictBox.textContent = '';
  verdictBox.className = 'verdict';
  const result = race(input);
  // Опорная скорость для питча двигателя — реальный максимум этого заезда.
  const topSpeed = Math.max(
    ...result.frames.map((frame) => Math.max(frame.a.speed, frame.b.speed)),
  );
  scene = new RaceScene({
    canvas,
    input,
    result,
    visuals: { a: visualFor(input, 'a'), b: visualFor(input, 'b') },
    onLights: (step) => audio.light(step),
    onFrame: (frame, t) => {
      audio.frame(frame, topSpeed);
      if (t >= 0 && t < 0.1) {
        for (const side of ['a', 'b'] as const) {
          if (result[side].tuning.flags.wheelspin) audio.wheelspin(side === 'a' ? 1 : 0.6);
        }
      }
    },
    onFinish: () => {
      audio.finish();
      runButton.disabled = false;
      verdict(input, result);
    },
  });
  scene.renderAt(-1);
  renderOdds(input, result);
  renderEvents(input, result);
  updateLink(input);
  // Полный результат в консоли — Шаг 1 требует именно вывод в консоль.
  console.log('заезд', result);
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  await audio.start();
  scene?.stop();
  load(current);
  scene?.play();
});

againButton.addEventListener('click', () => {
  load(demoRace());
});

soundButton.addEventListener('click', () => {
  audio.setMuted(!audio.isMuted());
  soundButton.textContent = audio.isMuted() ? 'Звук выключен' : 'Звук включён';
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(linkInput.value);
  copyButton.textContent = 'Скопировано';
  setTimeout(() => { copyButton.textContent = 'Скопировать'; }, 1500);
});

window.addEventListener('resize', () => {
  scene?.resize();
  scene?.renderAt(-1);
});

window.addEventListener('hashchange', () => {
  const fromUrl = readInputFromUrl();
  if (fromUrl) load(fromUrl);
});

mountChrome('race');
mountFooter();
load(current);
