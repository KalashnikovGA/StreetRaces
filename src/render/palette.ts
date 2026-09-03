/**
 * Палитра. Тот же гаражный кооператив, что и в интерфейсе: холодный бетон
 * под тёплым натриевым фонарём. Значения совпадают с токенами из theme.css —
 * если правишь там, поправь и здесь.
 */

export const PALETTE = {
  skyTop: '#08090b',
  skyBottom: '#14171a',
  cityFar: '#131619',
  cityNear: '#0d0f11',
  window: '#c08f4e',
  ground: '#131619',
  road: '#1c2024',
  roadEdge: '#282d33',
  lane: '#242a2f',
  marking: '#f1f4f6',
  shadow: 'rgba(0,0,0,0.5)',
  glass: '#1c2024',
  glassShine: 'rgba(241,244,246,0.14)',
  rubber: '#0b0d0f',
  rim: '#a2aab1',
  headlight: '#f0e6d4',
  taillight: '#a9704a',
  smoke: 'rgba(200,203,206,0.5)',
  nitro: '#6e9bb0',
  steam: 'rgba(178,182,186,0.45)',
  text: '#f1f4f6',
  textDim: '#a2aab1',
  accent: '#c08f4e',
  gate: '#6e9bb0',
  /** Зажжённая лампа светофора: тот же стальной акцент, но горящий. */
  gateLight: '#8fbccf',
  rust: '#a9704a',
} as const;

/**
 * Заводские окраски. Цвет — строка кода, а не отдельный файл рендера (§11).
 *
 * Красный взят из исходной модели: там кузов покрашен в #b81a1a. Остальные —
 * наши, подобранные под палитру интерфейса.
 */
export const PAINTS: Record<string, string> = {
  white: '#d8dce3',
  black: '#1c1f26',
  red: '#b81a1a',
  blue: '#2a5c9a',
  green: '#2f7d52',
  yellow: '#d8a521',
  orange: '#c86a2b',
  silver: '#9aa1ab',
  purple: '#5b3a86',
  cyan: '#2f8f9d',
};
