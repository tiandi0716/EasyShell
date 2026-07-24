import { useCallback, useEffect, useState } from 'react'
import type { PrivateKeyInfo } from '../vite-env'
import PromptDialog from './PromptDialog'

interface Props {
  selectedId?: string
  /** pick=选进连接；manage=仅管理私钥库 */
  mode?: 'pick' | 'manage'
  onSelect?: (key: PrivateKeyInfo) => void
  onClose: () => void
}

export default function KeyPickDialog({
  selectedId,
  mode = 'pick',
  onSelect,
  onClose,
}: Props) {
  const manage = mode === 'manage'
  const [keys, setKeys] = useState<PrivateKeyInfo[]>([])
  const [activeId, setActiveId] = useState(selectedId || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [renameTarget, setRenameTarget] = useState<PrivateKeyInfo | null>(null)

  const load = useCallback(async () => {
    const list = await window.easyshell.listKeys()
    setKeys(list)
    setActiveId((prev) => {
      if (prev && list.some((k) => k.id === prev)) return prev
      if (selectedId && list.some((k) => k.id === selectedId)) return selectedId
      return list[0]?.id || ''
    })
    return list
  }, [selectedId])

  useEffect(() => {
    void load().catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [load])

  async function handleImport() {
    setBusy(true)
    setError('')
    try {
      const item = await window.easyshell.importKey()
      if (!item) return
      await load()
      setActiveId(item.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!activeId) return
    const target = keys.find((k) => k.id === activeId)
    if (!target) return
    if (!window.confirm(`确定删除私钥「${target.name}」？`)) return
    setBusy(true)
    setError('')
    try {
      await window.easyshell.deleteKey(activeId)
      const next = keys.filter((k) => k.id !== activeId)
      setKeys(next)
      setActiveId(next[0]?.id || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function confirm() {
    const key = keys.find((k) => k.id === activeId)
    if (!key || !onSelect) return
    onSelect(key)
  }

  return (
    <>
      <div className="modal-mask" onClick={onClose}>
        <div className="modal modal-key-pick" onClick={(e) => e.stopPropagation()}>
          <h3>{manage ? '私钥管理' : '选择私钥'}</h3>
          <div className="key-pick-layout">
            <div className="key-pick-table-wrap">
              <table className="key-pick-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>类型</th>
                    <th>长度</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.length ? (
                    keys.map((k) => (
                      <tr
                        key={k.id}
                        className={k.id === activeId ? 'active' : ''}
                        onClick={() => setActiveId(k.id)}
                        onDoubleClick={() => {
                          if (!manage && onSelect) onSelect(k)
                        }}
                      >
                        <td>{k.name}</td>
                        <td>{k.keyType || 'KEY'}</td>
                        <td>{k.bits || '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="key-pick-empty">
                        暂无私钥，请先导入
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="key-pick-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={handleImport}>
                导入…
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !activeId}
                onClick={() => {
                  const t = keys.find((k) => k.id === activeId)
                  if (t) setRenameTarget(t)
                }}
              >
                编辑
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !activeId}
                onClick={handleDelete}
              >
                删除
              </button>
            </div>
          </div>
          {error ? <div className="dialog-message" style={{ color: '#c0392b' }}>{error}</div> : null}
          <div className="modal-actions">
            {manage ? (
              <button type="button" className="btn btn-primary" onClick={onClose}>
                关闭
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!activeId}
                  onClick={confirm}
                >
                  确定
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {renameTarget ? (
        <PromptDialog
          title="编辑私钥名称"
          label="名称"
          defaultValue={renameTarget.name}
          onClose={() => setRenameTarget(null)}
          onConfirm={async (name) => {
            try {
              const updated = await window.easyshell.renameKey(renameTarget.id, name)
              setRenameTarget(null)
              await load()
              setActiveId(updated.id)
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
              setRenameTarget(null)
            }
          }}
        />
      ) : null}
    </>
  )
}
