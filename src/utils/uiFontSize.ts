export const UI_FONT_SIZE_MIN = 10
export const UI_FONT_SIZE_MAX = 24
export const UI_FONT_SIZE_DEFAULT = 14

export function normalizeUiFontSize(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return UI_FONT_SIZE_DEFAULT
  return Math.min(UI_FONT_SIZE_MAX, Math.max(UI_FONT_SIZE_MIN, Math.round(n)))
}

export function applyUiFontSize(px: number) {
  const size = normalizeUiFontSize(px)
  document.documentElement.style.setProperty('--font-size', `${size}px`)
  return size
}
