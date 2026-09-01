/**
 * Страница заезда и повтора по ссылке. Шаги 2 и 3 из §14.
 *
 * Если в адресе есть повтор — проигрывается он, кадр в кадр, без регистрации.
 * Если нет — собирается показательный заезд, чтобы страница не была пустой.
 */

import '../styles.css';
import type { RaceResult } from '../core/race.ts';
import {
  CAR_MODELS, bestConfigFor, botCharacter, botConfig, getModel, horsepower, makeRng,
  race, randomSeed, strength, type Conditions, type RaceInput, type Racer, type Side,
} from '../core/index.ts';
import { decodeRace, replayUrl } from '../replay/codec.ts';
import { RaceScene, type SideVisual } from '../render/scene.ts';
import { RaceAudio } from '../audio/engine.ts';
import { PAINTS } from '../render/palette.ts';

const canvas = document.getElementById('track') as HTMLCanvasElement;
const runButton = document.getElementById('run') as HTMLButtonElement;
const againButton = document.getElementById('again') as HTMLButtonElement;
const soundButton = document.getElementById('sound') as HTMLButtonElement;
const copyButton = document.getElementById('copy') as HTMLButtonElement;
const linkInput = document.getElementById('link') as HTMLInputElement;
const oddsBox = document.getElementById('odds') as HTMLElement;
const eventsBox = document.getElementById('events') as HTMLElement;
const verdictBox = document.getElementById('verdict') as HTMLElement;

const audio = new RaceAudio();
let scene: RaceScene | null = null;
let current: RaceInput = readInputFromUrl() ?? demoRace();

const PAINT_KEYS = Object.keys(PAINTS);

function visualFor(input: RaceInput, side: Side): SideVisual {
  const rng = makeRng(`${input.seed}/paint/${side}`);
  return {
    name: input[side].name,
    pimp: {
      paint: PAINT_KEYS[Math.floor(rng() * PAINT_KEYS.length)]!,
      neon: rng() < 0.35 ? '#6fd3ff' : null,
      drop: rng(),
    },
  };
}

/** Показательный заезд: «Корытце» против случайного соперника. */
function demoRace(): RaceInput {
  const seed = randomSeed(Math.random);
  const rng = makeRng(`${seed}/demo`);
  const conditions: Conditions = {
    distance: (['short', 'medium', 'long'] as const)[Math.floor(rng() * 3)]!,
    surface: rng() < 0.35 ? 'wet' : 'dry',
    profile: rng() < 0.3 ? 'uphill' : 'flat',
  };
  const rival = CAR_MODELS[Math.floor(rng() * 4)]!;
  const level = () => Math.floor(rng() * 11);
  const a: Racer = {
    name: 'Ты',
    car: {
      modelId: 'zarya965',
      specs: { tires: 6, ignition: 5, clutch: 5, suspension: 4, boost: 7, intake: 5, radiator: 4 },
    },
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

function renderOdds(input: RaceInput, result: RaceResult): void {
  const rows: string[] = [];
  rows.push(`<div class="stat"><span>Условия</span><b>${
    [input.conditions.distance, input.conditions.surface, input.conditions.profile]
      .map((k) => CONDITION_WORDS[k]).join(' · ')
  }</b></div>`);
  for (const side of ['a', 'b'] as const) {
    const racer = input[side];
    const model = getModel(racer.car.modelId);
    const odds = result[side];
    rows.push(`
      <div class="stat" style="margin-top:10px"><span>${racer.name}</span>
        <b>${model.nick} · ${horsepower(racer.car)} л.с. · класс ${model.klass}</b></div>
      <div class="stat"><span>Сила</span><b>${strength(racer.car).toFixed(0)}</b></div>
      <div class="stat"><span>Настройка</span><b>${(odds.tuning.quality * 100).toFixed(0)}%</b></div>
      <div class="bar"><i style="width:${(odds.tuning.quality * 100).toFixed(0)}%"></i></div>
      <div class="muted">резина ${CONFIG_WORDS[racer.config.tires]} ·
        передаточные ${CONFIG_WORDS[racer.config.gearing]} ·
        давление ${CONFIG_WORDS[racer.config.pressure]} ·
        нитро ${CONFIG_WORDS[racer.config.nitro]} ·
        снятие веса ${racer.config.weightCut}</div>`);
  }
  const p = result.pWinA;
  rows.push(`<div class="stat" style="margin-top:12px"><span>Шансы до старта</span>
    <b>${(p * 100).toFixed(1)}% : ${((1 - p) * 100).toFixed(1)}%</b></div>`);
  if (result.strengthRatio >= 1.5) {
    rows.push(`<div class="muted">Соперники разошлись в силе в ${result.strengthRatio.toFixed(2)} раза.</div>`);
  }
  oddsBox.innerHTML = rows.join('');
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
  lines.push(`победитель: ${input[result.winner].name}`);
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
  const cls = result.winner === 'a' ? 'win' : 'lose';
  const tail = result.miracle
    ? ' — чудо'
    : result.photoFinish ? ' — фотофиниш' : result.upset ? ' — апсет' : '';
  verdictBox.innerHTML = `<span class="${cls}">${winner} забрал${tail}</span>`;
}

function load(input: RaceInput): void {
  current = input;
  scene?.stop();
  audio.stop();
  verdictBox.textContent = '';
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
  soundButton.textContent = audio.isMuted() ? 'Звук: выкл' : 'Звук: вкл';
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(linkInput.value);
  copyButton.textContent = 'Скопировано';
  setTimeout(() => { copyButton.textContent = 'Скопировать ссылку'; }, 1500);
});

window.addEventListener('resize', () => {
  scene?.resize();
  scene?.renderAt(-1);
});

window.addEventListener('hashchange', () => {
  const fromUrl = readInputFromUrl();
  if (fromUrl) load(fromUrl);
});

load(current);
