/**
 * Палитра. Тот же гаражный кооператив, что и в интерфейсе: холодный бетон
 * под тёплым натриевым фонарём. Значения совпадают с токенами из theme.css —
 * если правишь там, поправь и здесь.
 */

export const PALETTE = {
  skyTop: '#0e1012',
  skyBottom: '#1c1f21',
  cityFar: '#1b1e20',
  cityNear: '#131517',
  window: '#c9762f',
  ground: '#1b1e20',
  road: '#26292b',
  roadEdge: '#3d4247',
  lane: '#33383c',
  marking: '#d8d5ce',
  shadow: 'rgba(0,0,0,0.5)',
  glass: '#2a2e31',
  glassShine: 'rgba(216,213,206,0.14)',
  rubber: '#101214',
  rim: '#8e8b85',
  headlight: '#f0dcc0',
  taillight: '#c04a35',
  smoke: 'rgba(200,198,192,0.5)',
  nitro: '#79a8c2',
  steam: 'rgba(180,180,175,0.45)',
  text: '#d8d5ce',
  textDim: '#8e8b85',
  accent: '#e07b39',
  gate: '#3e6b5f',
  /** Зажжённая зелёная лампа светофора: тот же цвет ворот, но горящий. */
  gateLight: '#5f9e8b',
  rust: '#8c3b2e',
} as const;

/** Заводские окраски. Цвет — строка кода, а не отдельный файл рендера (§11). */
export const PAINTS: Record<string, string> = {
  white: '#d8dce3',
  black: '#1c1f26',
  red: '#c0392b',
  blue: '#2a5c9a',
  green: '#2f7d52',
  yellow: '#d8a521',
  orange: '#c86a2b',
  silver: '#9aa1ab',
  purple: '#5b3a86',
  cyan: '#2f8f9d',
};
