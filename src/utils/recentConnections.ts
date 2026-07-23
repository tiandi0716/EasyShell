import type { ConnectionConfig } from '../vite-env'

const KEY = 'easyshell.recentConnectionIds'
const MAX = 40

export interface RecentEntry {
  id: string
  name: string
  host: string
  port: number
  username: string
  folder?: string
  remark?: string
  at: number
}

export function readRecentEntries(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list
      .filter((item) => item && typeof item.id === 'string' && item.host)
      .slice(0, MAX)
  } catch {
    return []
  }
}

function writeRecentEntries(list: RecentEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
}

export function pushRecentConnection(conn: ConnectionConfig): RecentEntry[] {
  if (!conn?.id || !conn.host) return readRecentEntries()
  const entry: RecentEntry = {
    id: conn.id,
    name: conn.name || conn.host,
    host: conn.host,
    port: Number(conn.port) || 22,
    username: conn.username || 'root',
    folder: conn.folder || '',
    remark: conn.remark || '',
    at: Date.now(),
  }
  const next = [entry, ...readRecentEntries().filter((item) => item.id !== entry.id)].slice(
    0,
    MAX,
  )
  writeRecentEntries(next)
  return next
}

export function clearRecentConnections() {
  writeRecentEntries([])
}

/** 用当前连接列表刷新展示信息；已删除的仍保留快照以便展示 */
export function resolveRecentList(
  recent: RecentEntry[],
  connections: ConnectionConfig[],
): Array<RecentEntry & { missing?: boolean; conn?: ConnectionConfig }> {
  const byId = new Map(connections.filter((c) => c.id).map((c) => [c.id!, c]))
  return recent.map((item) => {
    const conn = byId.get(item.id)
    if (!conn) return { ...item, missing: true }
    return {
      ...item,
      name: conn.name || conn.host,
      host: conn.host,
      port: Number(conn.port) || 22,
      username: conn.username || 'root',
      folder: conn.folder || '',
      remark: conn.remark || '',
      conn,
      missing: false,
    }
  })
}
