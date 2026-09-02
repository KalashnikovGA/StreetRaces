/**
 * Миниатюра машины в клетке: тот же спрайт, что в витрине и в заезде.
 *
 * Отдельной картинки-превью нет и не будет — §11 требует, чтобы машина
 * везде была одним объектом. Клетка просто рисует его мелко.
 */

import { drawCar } from '../render/car.ts';
import { PAINTS } from '../render/palette.ts';
import { loadCarSprites } from '../render/sprites.ts';

export function drawThumb(canvas: HTMLCanvasElement, modelId: string, paint: string): void {
  const render = (): void => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, rect.width, rect.height);

    const width = rect.width * 0.94;
    const height = width * 0.42;
    ctx.save();
    ctx.translate((rect.width - width) / 2, rect.height - height * 0.96);
    drawCar(ctx, {
      modelId,
      pimp: { paint: PAINTS[paint] ?? paint },
      width,
      wheelAngle: 0,
      squat: 0,
    });
    ctx.restore();
  };

  render();
  void loadCarSprites(modelId).then(render);
}
