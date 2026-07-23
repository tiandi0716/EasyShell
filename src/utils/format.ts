export function formatBytes(size: number) {
  if (!Number.isFinite(size) || size < 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} K`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} M`
  if (size < 1024 ** 4) return `${(size / 1024 ** 3).toFixed(1)} G`
  return `${(size / 1024 ** 4).toFixed(1)} T`
}

export function formatRate(bps: number) {
  if (!bps) return '0'
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(1)} K/s`
  return `${(bps / 1024 ** 2).toFixed(1)} M/s`
}

export function formatTime(sec: number) {
  if (!sec) return '-'
  const d = new Date(sec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function joinPath(base: string, name: string) {
  if (!base || base === '.') return `/${name}`.replace(/\/+/g, '/')
  if (base === '/') return `/${name}`
  return `${base.replace(/\/$/, '')}/${name}`
}

export function parentPath(current: string) {
  if (!current || current === '/' || current === '.') return '/'
  const parts = current.replace(/\/$/, '').split('/')
  parts.pop()
  return parts.length ? parts.join('/') || '/' : '/'
}

export function pct(used: number, total: number) {
  if (!total) return 0
  return Math.max(0, Math.min(100, (used / total) * 100))
}
