import { FormEvent, useEffect, useState } from 'react'
import type { ConnectionConfig, PortForwardRule } from '../vite-env'

interface Props {
  connection: ConnectionConfig
  sessionId?: string | null
  onClose: () => void
  onSaved: (conn: ConnectionConfig) => Promise<void>
}

function emptyRule(): PortForwardRule {
  return { listenPort: 8080, destHost: '127.0.0.1', destPort: 80 }
}

export default function PortForwardDialog({ connection, sessionId, onClose, onSaved }: Props) {
  const [rules, setRules] = useState<PortForwardRule[]>(
    connection.forwards?.length ? connection.forwards.map((r) => ({ ...r })) : [emptyRule()],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [live, setLive] = useState<string>('')

  useEffect(() => {
    if (!sessionId) return
    void window.easyshell.listForwards(sessionId).then((list) => {
      if (!list.length) return
      setLive(
        list
          .map((item) =>
            item.status === 'listening'
              ? `127.0.0.1:${item.listenPort} → ${item.destHost}:${item.destPort}`
              : `${item.listenPort} 失败：${item.error || item.status}`,
          )
          .join('；'),
      )
    })
  }, [sessionId])

  function update(index: number, patch: Partial<PortForwardRule>) {
    setRules((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const cleaned = rules
      .map((r) => ({
        listenPort: Number(r.listenPort),
        destHost: String(r.destHost || '127.0.0.1').trim() || '127.0.0.1',
        destPort: Number(r.destPort),
      }))
      .filter((r) => r.listenPort > 0 && r.listenPort <= 65535 && r.destPort > 0 && r.destPort <= 65535)
    setSaving(true)
    setError('')
    try {
      const next = { ...connection, forwards: cleaned }
      await onSaved(next)
      if (sessionId) {
        const status = await window.easyshell.setForwards(sessionId, cleaned)
        const bad = status.filter((s) => s.status === 'error')
        if (bad.length) {
          setError(bad.map((s) => `${s.listenPort}: ${s.error || '监听失败'}`).join('；'))
          setSaving(false)
          return
        }
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>端口转发</h3>
        <p className="dialog-message">
          本机 127.0.0.1:本地端口 转发到远端 {connection.host} 能访问的地址。适合连内网库、Web、RDP。
        </p>
        {live ? <p className="dialog-message">当前会话：{live}</p> : null}
        <div className="pf-list">
          {rules.map((rule, index) => (
            <div key={index} className="pf-row">
              <label>
                本地端口
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={rule.listenPort || ''}
                  onChange={(e) => update(index, { listenPort: Number(e.target.value) })}
                />
              </label>
              <label>
                远端主机
                <input
                  value={rule.destHost}
                  onChange={(e) => update(index, { destHost: e.target.value })}
                  placeholder="127.0.0.1"
                />
              </label>
              <label>
                远端端口
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={rule.destPort || ''}
                  onChange={(e) => update(index, { destPort: Number(e.target.value) })}
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRules((prev) => [...prev, emptyRule()])}>
          添加一条
        </button>
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? '保存中…' : '保存并应用'}
          </button>
        </div>
      </form>
    </div>
  )
}
