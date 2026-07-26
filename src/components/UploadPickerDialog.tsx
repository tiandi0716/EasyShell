import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { LocalFileItem } from '../vite-env'
import { formatBytes, formatTime } from '../utils/format'

interface Props {
  onConfirm: (paths: string[]) => void
  onClose: () => void
}

interface SpecialDirs {
  home: string
  desktop: string
  documents: string
  downloads: string
}

export default function UploadPickerDialog({ onConfirm, onClose }: Props) {
  const [special, setSpecial] = useState<SpecialDirs | null>(null)
  const [cwd, setCwd] = useState('')
  const [items, setItems] = useState<LocalFileItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (dir?: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await window.easyshell.listLocalDir(dir)
      setCwd(result.path)
      setItems(result.items)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const dirs = await window.easyshell.getSpecialDirs()
      setSpecial(dirs)
      await load(dirs.desktop || dirs.home)
    })()
  }, [load])

  const selectedCount = selected.size
  const crumbs = useMemo(() => {
    if (!cwd) return []
    const parts = cwd.split(/[/\\]/).filter(Boolean)
    const list: Array<{ label: string; path: string }> = []
    if (cwd.startsWith('/')) {
      list.push({ label: '/', path: '/' })
      let acc = ''
      for (const part of parts) {
        acc += `/${part}`
        list.push({ label: part, path: acc })
      }
    } else {
      // Windows
      let acc = ''
      for (let i = 0; i < parts.length; i++) {
        acc = i === 0 ? `${parts[0]}\\` : pathJoin(acc, parts[i])
        list.push({ label: parts[i], path: acc.endsWith('\\') && i === 0 ? acc : acc })
      }
    }
    return list
  }, [cwd])

  function pathJoin(a: string, b: string) {
    if (!a) return b
    return a.endsWith('\\') || a.endsWith('/') ? `${a}${b}` : `${a}\\${b}`
  }

  function toggleSelect(item: LocalFileItem) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(item.path)) next.delete(item.path)
      else next.add(item.path)
      return next
    })
  }

  function onRowClick(item: LocalFileItem, e: MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      toggleSelect(item)
      return
    }
    setSelected(new Set([item.path]))
  }

  async function goUp() {
    const parent = await window.easyshell.getParentDir(cwd)
    if (parent && parent !== cwd) await load(parent)
  }

  function submit() {
    if (!selected.size) return
    onConfirm([...selected])
  }

  const shortcuts = special
    ? [
        { label: '桌面', path: special.desktop },
        { label: '下载', path: special.downloads },
        { label: '文稿', path: special.documents },
        { label: '主目录', path: special.home },
      ].filter((x) => x.path)
    : []

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal upload-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h3>选择要上传的文件或文件夹</h3>
        <p className="upload-picker-hint">
          双击文件夹可进入；勾选文件/文件夹后，点「上传」才会开始传输。
        </p>

        <div className="upload-picker-path">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void goUp()} disabled={loading}>
            上级
          </button>
          <div className="upload-picker-crumbs">
            {crumbs.map((c, i) => (
              <button
                key={`${c.path}-${i}`}
                type="button"
                className="crumb"
                onClick={() => void load(c.path)}
                title={c.path}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="upload-picker-body">
          <aside className="upload-picker-side">
            {shortcuts.map((s) => (
              <button
                key={s.path}
                type="button"
                className={`side-item ${cwd === s.path ? 'active' : ''}`}
                onClick={() => void load(s.path)}
              >
                {s.label}
              </button>
            ))}
          </aside>

          <div className="upload-picker-list-wrap">
            <div className="upload-picker-head">
              <span className="col-check" />
              <span className="col-name">名称</span>
              <span className="col-size">大小</span>
              <span className="col-time">修改时间</span>
            </div>
            <div className="upload-picker-list">
              {loading ? (
                <div className="upload-picker-empty">加载中…</div>
              ) : error ? (
                <div className="upload-picker-empty error">{error}</div>
              ) : !items.length ? (
                <div className="upload-picker-empty">空目录</div>
              ) : (
                items.map((item) => {
                  const checked = selected.has(item.path)
                  return (
                    <div
                      key={item.path}
                      className={`upload-picker-row ${checked ? 'selected' : ''}`}
                      onClick={(e) => onRowClick(item, e)}
                      onDoubleClick={() => {
                        if (item.isDir) void load(item.path)
                      }}
                    >
                      <label className="col-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev)
                              if (next.has(item.path)) next.delete(item.path)
                              else next.add(item.path)
                              return next
                            })
                          }}
                        />
                      </label>
                      <span className="col-name" title={item.name}>
                        <i className={item.isDir ? 'icon-dir' : 'icon-file'} />
                        <span className="name-text">{item.name}</span>
                      </span>
                      <span className="col-size">{item.isDir ? '-' : formatBytes(item.size)}</span>
                      <span className="col-time">{formatTime(item.mtime)}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions upload-picker-actions">
          <span className="upload-picker-count">已选 {selectedCount} 项</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={!selectedCount} onClick={submit}>
            上传
          </button>
        </div>
      </div>
    </div>
  )
}
