import { FormEvent, useMemo, useState } from 'react'

interface Props {
  title: string
  folders: string[]
  current?: string
  allowCreate?: boolean
  exclude?: string[]
  onConfirm: (folder: string) => void
  onClose: () => void
}

export default function FolderPickDialog({
  title,
  folders,
  current,
  allowCreate = true,
  exclude = [],
  onConfirm,
  onClose,
}: Props) {
  const options = useMemo(() => {
    const ban = new Set(['未分组', ...exclude])
    return [...new Set(folders)]
      .filter((f) => f && !ban.has(f))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [folders, exclude])

  const initial = options.includes(current || '') ? current! : options[0] || ''
  const [folder, setFolder] = useState(initial)
  const [mode, setMode] = useState<'select' | 'create'>(options.length ? 'select' : 'create')
  const [custom, setCustom] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const value = mode === 'create' ? custom.trim() : folder
    if (!value || value === '未分组') return
    onConfirm(value)
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="modal modal-sm" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        <div className="form-grid">
          {allowCreate ? (
            <div className="field">
              <label>方式</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'select' | 'create')}
              >
                <option value="select" disabled={!options.length}>
                  选择已有目录
                </option>
                <option value="create">新建目录</option>
              </select>
            </div>
          ) : null}
          {mode === 'select' ? (
            <div className="field">
              <label>目录</label>
              {options.length ? (
                <select value={folder} onChange={(e) => setFolder(e.target.value)}>
                  {options.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="dialog-message">暂无可用目录，请先新建目录</div>
              )}
            </div>
          ) : (
            <div className="field">
              <label>新目录名</label>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="输入目录名称"
                autoFocus
              />
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={mode === 'create' ? !custom.trim() : !folder}
          >
            确定
          </button>
        </div>
      </form>
    </div>
  )
}
