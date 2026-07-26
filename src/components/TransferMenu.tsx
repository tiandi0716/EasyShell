import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TransferItem } from '../vite-env'
import { formatBytes } from '../utils/format'

function TransferIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 6.5h8M4 9.5h5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M11.2 8.2l1.8 1.8 1.8-1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function TransferMenu() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<TransferItem[]>([])
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.easyshell.listTransfers().then((list) => {
      if (!cancelled) setItems(list)
    })

    const offUpdate = window.easyshell.onTransferUpdate((item) => {
      setItems((prev) => {
        const idx = prev.findIndex((x) => x.id === item.id)
        if (idx === -1) return [item, ...prev]
        const next = prev.slice()
        next[idx] = item
        return next
      })
      // 有新任务时自动打开，方便看到进度
      if (item.status === 'active') setOpen(true)
    })
    const offRemove = window.easyshell.onTransferRemove(({ id }) => {
      setItems((prev) => prev.filter((x) => x.id !== id))
    })
    const offClear = window.easyshell.onTransferClear(() => setItems([]))
    const offSnap = window.easyshell.onTransferSnapshot((list) => setItems(list))

    return () => {
      cancelled = true
      offUpdate()
      offRemove()
      offClear()
      offSnap()
    }
  }, [])

  useEffect(() => {
    if (!open || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPos({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', () => setOpen(false))
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [items],
  )
  const activeCount = sorted.filter((x) => x.status === 'active').length
  const downloads = sorted.filter((x) => x.direction === 'download')
  const uploads = sorted.filter((x) => x.direction === 'upload')
  const lastDownloadDir =
    downloads.find((x) => x.localPath)?.localPath?.replace(/[/\\][^/\\]+$/, '') || ''

  const popover = open
    ? createPortal(
        <div
          ref={popRef}
          className="transfer-popover"
          role="dialog"
          aria-label="传输历史"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="transfer-popover-head">
            <strong>传输任务</strong>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void window.easyshell.clearFinishedTransfers()}
              disabled={!sorted.some((x) => x.status !== 'active')}
            >
              清除完成
            </button>
          </div>

          {lastDownloadDir ? (
            <div className="transfer-dir-line" title={lastDownloadDir}>
              下载目录：{lastDownloadDir}
            </div>
          ) : null}

          {!sorted.length ? (
            <div className="transfer-empty">暂无传输记录</div>
          ) : (
            <div className="transfer-popover-list">
              {sorted.map((item) => (
                <div key={item.id} className={`transfer-row status-${item.status}`}>
                  <span
                    className={`transfer-arrow ${item.direction}`}
                    title={item.direction === 'upload' ? '上传' : '下载'}
                  >
                    {item.direction === 'upload' ? '↑' : '↓'}
                  </span>
                  <div className="transfer-row-main">
                    <div className="transfer-row-name" title={item.localPath || item.remotePath}>
                      {item.name}
                    </div>
                    <div className="transfer-row-bar">
                      <i style={{ width: `${item.status === 'done' ? 100 : item.percent}%` }} />
                    </div>
                    <div className="transfer-row-meta">
                      {item.status === 'active'
                        ? item.total > 0
                          ? `${formatBytes(item.transferred)} / ${formatBytes(item.total)} · ${item.percent}%`
                          : formatBytes(item.transferred)
                        : item.status === 'done'
                          ? item.total > 0
                            ? formatBytes(item.total)
                            : ''
                          : item.error || '失败'}
                    </div>
                  </div>
                  <span className="transfer-row-status">
                    {item.status === 'active'
                      ? `${item.percent}%`
                      : item.status === 'done'
                        ? '已完成'
                        : '失败'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {sorted.length ? (
            <div className="transfer-popover-foot">
              上传 {uploads.length} · 下载 {downloads.length}
              {activeCount ? ` · 进行中 ${activeCount}` : ''}
            </div>
          ) : null}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="transfer-menu">
      <button
        ref={btnRef}
        type="button"
        className={`transfer-menu-btn ${open ? 'active' : ''} ${activeCount ? 'has-active' : ''}`}
        title="传输任务"
        aria-label="传输任务"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <TransferIcon />
        {activeCount > 0 ? (
          <span className="transfer-badge">{activeCount > 9 ? '9+' : activeCount}</span>
        ) : null}
      </button>
      {popover}
    </div>
  )
}
