import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { ConnectionConfig } from '../vite-env'

const empty: ConnectionConfig = {
  name: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  remark: '',
  folder: '',
}

interface Props {
  initial?: ConnectionConfig | null
  folders?: string[]
  onClose: () => void
  onSave: (conn: ConnectionConfig) => Promise<void>
}

export default function ConnectionForm({ initial, folders = [], onClose, onSave }: Props) {
  const [form, setForm] = useState<ConnectionConfig>(initial || empty)
  const [saving, setSaving] = useState(false)
  const [folderMode, setFolderMode] = useState<'select' | 'create'>('select')
  const [customFolder, setCustomFolder] = useState('')

  const folderOptions = useMemo(() => {
    const set = new Set<string>(folders.filter((f) => f && f !== '未分组'))
    if (initial?.folder && initial.folder !== '未分组') set.add(initial.folder)
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [folders, initial?.folder])

  useEffect(() => {
    const next = { ...(initial || empty) }
    const folder = next.folder && next.folder !== '未分组' ? next.folder : folderOptions[0] || ''
    next.folder = folder
    setForm(next)
    if (folder && folderOptions.includes(folder)) {
      setFolderMode('select')
      setCustomFolder('')
    } else if (folderOptions.length === 0) {
      setFolderMode('create')
      setCustomFolder('')
    } else {
      setFolderMode('select')
      setCustomFolder('')
    }
  }, [initial, folderOptions])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) return
    const folder =
      folderMode === 'create' ? customFolder.trim() : (form.folder || '').trim()
    if (!folder || folder === '未分组') return
    setSaving(true)
    try {
      await onSave({
        ...form,
        port: Number(form.port) || 22,
        folder,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3>{form.id ? '编辑连接' : '新建连接'}</h3>
        <div className="form-grid">
          <div className="field">
            <label>目录分组</label>
            <select
              value={folderMode}
              onChange={(e) => setFolderMode(e.target.value as 'select' | 'create')}
            >
              <option value="select">选择已有目录</option>
              <option value="create">新建目录</option>
            </select>
          </div>
          {folderMode === 'select' ? (
            <div className="field">
              <label>选择目录</label>
              {folderOptions.length ? (
                <select
                  value={form.folder || folderOptions[0]}
                  onChange={(e) => setForm({ ...form, folder: e.target.value })}
                >
                  {folderOptions.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="dialog-message">暂无目录，请切换到「新建目录」</div>
              )}
            </div>
          ) : (
            <div className="field">
              <label>新目录名</label>
              <input
                value={customFolder}
                onChange={(e) => setCustomFolder(e.target.value)}
                placeholder="例如：平台服务器"
                required
              />
            </div>
          )}
          <div className="field">
            <label>名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="生产机 / 测试环境"
              required
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label>主机</label>
              <input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="完整 IP，如 192.168.1.213"
                required
              />
            </div>
            <div className="field">
              <label>端口</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                min={1}
                max={65535}
              />
            </div>
          </div>
          <div className="field">
            <label>用户名</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>认证方式</label>
            <select
              value={form.authType}
              onChange={(e) =>
                setForm({ ...form, authType: e.target.value as 'password' | 'key' })
              }
            >
              <option value="password">密码</option>
              <option value="key">私钥文件</option>
            </select>
          </div>
          {form.authType === 'password' ? (
            <div className="field">
              <label>密码</label>
              <input
                type="password"
                value={form.password || ''}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label>私钥路径</label>
                <input
                  value={form.privateKeyPath || ''}
                  onChange={(e) => setForm({ ...form, privateKeyPath: e.target.value })}
                  placeholder="/Users/you/.ssh/id_rsa"
                />
              </div>
              <div className="field">
                <label>私钥口令（可选）</label>
                <input
                  type="password"
                  value={form.passphrase || ''}
                  onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
                />
              </div>
            </>
          )}
          <div className="field">
            <label>备注</label>
            <input
              value={form.remark || ''}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              placeholder="可选"
            />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}
