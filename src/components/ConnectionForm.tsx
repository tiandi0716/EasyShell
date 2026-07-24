import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { ConnectionConfig } from '../vite-env'
import KeyPickDialog from './KeyPickDialog'
import PasswordInput from './PasswordInput'
import ScrollSelect from './ScrollSelect'

const empty: ConnectionConfig = {
  connType: 'ssh',
  name: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password',
  password: '',
  privateKeyId: '',
  privateKeyPath: '',
  passphrase: '',
  remark: '',
  folder: '',
}

interface Props {
  initial?: ConnectionConfig | null
  folders?: string[]
  /** 新建时的默认连接类型 */
  defaultConnType?: 'ssh' | 'rdp'
  onClose: () => void
  onSave: (conn: ConnectionConfig) => Promise<void>
}

export default function ConnectionForm({
  initial,
  folders = [],
  defaultConnType = 'ssh',
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<ConnectionConfig>(initial || { ...empty, connType: defaultConnType })
  const [saving, setSaving] = useState(false)
  const [folderMode, setFolderMode] = useState<'select' | 'create'>('select')
  const [customFolder, setCustomFolder] = useState('')
  const [keyLabel, setKeyLabel] = useState('')
  const [showKeyPick, setShowKeyPick] = useState(false)

  const folderOptions = useMemo(() => {
    const set = new Set<string>(folders.filter((f) => f && f !== '未分组'))
    if (initial?.folder && initial.folder !== '未分组') set.add(initial.folder)
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [folders, initial?.folder])

  const isRdp = (form.connType || 'ssh') === 'rdp'

  useEffect(() => {
    const next = { ...(initial || { ...empty, connType: defaultConnType }) }
    if (!next.connType) next.connType = defaultConnType
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
  }, [initial, folderOptions, defaultConnType])

  useEffect(() => {
    let cancelled = false
    async function resolveLabel() {
      if (form.authType !== 'key') {
        setKeyLabel('')
        return
      }
      if (form.privateKeyId) {
        try {
          const info = await window.easyshell.getKeyInfo(form.privateKeyId)
          if (!cancelled) setKeyLabel(info?.name || form.privateKeyId)
          return
        } catch {
          if (!cancelled) setKeyLabel(form.privateKeyId)
          return
        }
      }
      if (form.privateKeyPath) {
        if (!cancelled) setKeyLabel(form.privateKeyPath)
        return
      }
      if (!cancelled) setKeyLabel('')
    }
    void resolveLabel()
    return () => {
      cancelled = true
    }
  }, [form.authType, form.privateKeyId, form.privateKeyPath])

  function setConnType(connType: 'ssh' | 'rdp') {
    if (connType === 'rdp') {
      setForm((prev) => ({
        ...prev,
        connType,
        port: prev.connType === 'rdp' ? prev.port : 3389,
        username:
          prev.connType === 'rdp'
            ? prev.username
            : prev.username === 'root'
              ? 'Administrator'
              : prev.username,
        authType: 'password',
      }))
      return
    }
    setForm((prev) => ({
      ...prev,
      connType,
      port: prev.connType === 'ssh' ? prev.port : 22,
      username:
        prev.connType === 'ssh'
          ? prev.username
          : prev.username === 'Administrator'
            ? 'root'
            : prev.username,
    }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) return
    const folder =
      folderMode === 'create' ? customFolder.trim() : (form.folder || '').trim()
    if (!folder || folder === '未分组') return
    const connType = form.connType || 'ssh'
    const authType = connType === 'rdp' ? 'password' : form.authType
    if (authType === 'key' && !form.privateKeyId && !form.privateKeyPath) {
      window.alert('请先浏览并选择私钥')
      return
    }
    setSaving(true)
    try {
      await onSave({
        ...form,
        connType,
        port: Number(form.port) || (connType === 'rdp' ? 3389 : 22),
        authType,
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
        <h3>{form.id ? '编辑连接' : isRdp ? '新建 Windows 远程桌面' : '新建 SSH'}</h3>
        <div className="form-grid">
          <div className="field">
            <label>连接类型</label>
            <select
              value={form.connType || 'ssh'}
              onChange={(e) => setConnType(e.target.value as 'ssh' | 'rdp')}
            >
              <option value="ssh">SSH（Linux / 服务器）</option>
              <option value="rdp">Windows 远程桌面（RDP）</option>
            </select>
          </div>
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
                <ScrollSelect
                  value={form.folder || folderOptions[0]}
                  options={folderOptions}
                  onChange={(folder) => setForm({ ...form, folder })}
                  placeholder="选择目录"
                />
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
              placeholder={isRdp ? 'Win-跳板 / 办公电脑' : '生产机 / 测试环境'}
              required
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label>主机</label>
              <input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="完整 IP，如 192.168.1.100"
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
              placeholder={isRdp ? 'Administrator' : 'root'}
              required
            />
          </div>
          {isRdp ? (
            <div className="field">
              <label>密码（可选，连接时自动复制到剪贴板）</label>
              <PasswordInput
                value={form.password || ''}
                onChange={(password) => setForm({ ...form, password })}
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label>认证方式</label>
                <select
                  value={form.authType}
                  onChange={(e) =>
                    setForm({ ...form, authType: e.target.value as 'password' | 'key' })
                  }
                >
                  <option value="password">密码</option>
                  <option value="key">公钥</option>
                </select>
              </div>
              {form.authType === 'password' ? (
                <div className="field">
                  <label>密码</label>
                  <PasswordInput
                    value={form.password || ''}
                    onChange={(password) => setForm({ ...form, password })}
                  />
                </div>
              ) : (
                <>
                  <div className="field">
                    <label>私钥</label>
                    <div className="field-with-btn">
                      <input
                        value={keyLabel}
                        readOnly
                        placeholder="点击浏览选择私钥"
                        onClick={() => setShowKeyPick(true)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setShowKeyPick(true)}
                      >
                        浏览…
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label>私钥口令（可选）</label>
                    <PasswordInput
                      value={form.passphrase || ''}
                      onChange={(passphrase) => setForm({ ...form, passphrase })}
                    />
                  </div>
                </>
              )}
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
          {isRdp ? (
            <div className="dialog-message">
              Windows 远程桌面将在应用内标签中打开，使用已保存的账号密码自动登录。
            </div>
          ) : null}
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
      {showKeyPick ? (
        <KeyPickDialog
          selectedId={form.privateKeyId}
          onClose={() => setShowKeyPick(false)}
          onSelect={(key) => {
            setForm({
              ...form,
              privateKeyId: key.id,
              privateKeyPath: '',
              authType: 'key',
            })
            setKeyLabel(key.name)
            setShowKeyPick(false)
          }}
        />
      ) : null}
    </div>
  )
}
