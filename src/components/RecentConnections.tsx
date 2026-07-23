import { useMemo, useState } from 'react'
import type { ConnectionConfig } from '../vite-env'
import {
  clearRecentConnections,
  resolveRecentList,
  type RecentEntry,
} from '../utils/recentConnections'

interface Props {
  recent: RecentEntry[]
  connections: ConnectionConfig[]
  onConnect: (conn: ConnectionConfig) => void
  onClear: () => void
}

function HostIcon() {
  return (
    <svg className="recent-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5 6.5h6M5 9.5h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function RecentConnections({ recent, connections, onConnect, onClear }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const rows = useMemo(() => resolveRecentList(recent, connections), [recent, connections])

  function connectRow(row: (typeof rows)[number]) {
    if (row.missing || !row.conn) return
    onConnect(row.conn)
  }

  return (
    <div
      className="recent-panel"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !selectedId) return
        const row = rows.find((r) => r.id === selectedId)
        if (row) connectRow(row)
      }}
    >
      <div className="recent-head">
        <strong>最近连接</strong>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!rows.length}
          onClick={() => {
            clearRecentConnections()
            onClear()
            setSelectedId(null)
          }}
        >
          清空
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="recent-empty">暂无最近连接。从左侧选择主机连接后，会出现在这里。</div>
      ) : (
        <div className="recent-list" role="listbox" aria-label="最近连接">
          {rows.map((row) => {
            const title = row.name || row.host
            const folder = row.folder ? `/${row.folder}` : row.remark ? `/${row.remark}` : ''
            const disabled = !!row.missing
            return (
              <button
                key={`${row.id}-${row.at}`}
                type="button"
                role="option"
                aria-selected={selectedId === row.id}
                className={`recent-row ${selectedId === row.id ? 'selected' : ''} ${
                  disabled ? 'missing' : ''
                }`}
                title={
                  disabled
                    ? '该连接已从列表中删除'
                    : `双击连接 ${row.username}@${row.host}:${row.port}`
                }
                disabled={disabled}
                onClick={() => setSelectedId(row.id)}
                onDoubleClick={() => connectRow(row)}
              >
                <HostIcon />
                <span className="recent-host" title={title}>
                  {title}
                </span>
                <span className="recent-folder" title={folder}>
                  {folder}
                </span>
                <span className="recent-user">{row.username}</span>
              </button>
            )
          })}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="recent-hint">单击选中，双击连接</div>
      ) : null}
    </div>
  )
}
