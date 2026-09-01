/** Палитра. Ночной двор: тёплый свет фонарей на холодном асфальте. */

export const PALETTE = {
  skyTop: '#0b0f1a',
  skyBottom: '#1b2233',
  cityFar: '#141b2b',
  cityNear: '#0e131f',
  window: '#f2c14e',
  ground: '#191d26',
  road: '#23262e',
  roadEdge: '#2f333d',
  lane: '#3a3f4a',
  marking: '#c9cdd6',
  shadow: 'rgba(0,0,0,0.45)',
  glass: '#2b3446',
  glassShine: 'rgba(255,255,255,0.18)',
  rubber: '#141519',
  rim: '#9aa3b2',
  headlight: '#ffe9b8',
  taillight: '#ff4d4d',
  smoke: 'rgba(210,214,222,0.55)',
  nitro: '#6fd3ff',
  steam: 'rgba(190,205,220,0.5)',
  text: '#e8ebf0',
  textDim: '#8b93a3',
  accent: '#ffb347',
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
