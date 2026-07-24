import { FormEvent, useMemo, useState } from 'react'

interface Props {
  folders: string[]
  /** 目录对应的连接数，便于选择时参考 */
  counts?: Record<string, number>
  initialSelected?: string[]
  onConfirm: (folders: string[]) => void
  onClose: () => void
}

export default function FolderExportDialog({
  folders,
  counts = {},
  initialSelected = [],
  onConfirm,
  onClose,
}: Props) {
  const options = useMemo(
    () =>
      [...new Set(folders)]
        .filter((f) => f && f !== '未分组')
        .sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [folders],
  )

  const [picked, setPicked] = useState<Set<string>>(() => {
    const init = initialSelected.filter((f) => options.includes(f))
    return new Set(init.length ? init : [])
  })

  function toggle(folder: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  function selectAll() {
    setPicked(new Set(options))
  }

  function clearAll() {
    setPicked(new Set())
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!picked.size) return
    onConfirm([...picked].sort((a, b) => a.localeCompare(b, 'zh-CN')))
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="modal modal-export-folders" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>导出部分目录</h3>
        <p className="dialog-message">勾选需要导出的目录，未勾选的不会写入导出结果。</p>
        <div className="export-folder-toolbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={selectAll}>
            全选
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
            清空
          </button>
          <span className="export-folder-hint">已选 {picked.size} / {options.length}</span>
        </div>
        <div className="export-folder-list">
          {options.length ? (
            options.map((folder) => {
              const checked = picked.has(folder)
              const count = counts[folder] ?? 0
              return (
                <label key={folder} className={`export-folder-item ${checked ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(folder)}
                  />
                  <span className="export-folder-name">{folder}</span>
                  <span className="export-folder-count">{count}</span>
                </label>
              )
            })
          ) : (
            <div className="dialog-message">暂无目录可导出</div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={!picked.size}>
            导出所选
          </button>
        </div>
      </form>
    </div>
  )
}
