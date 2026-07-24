import { useEffect, useState } from 'react'
import {
  UI_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  applyUiFontSize,
  normalizeUiFontSize,
} from '../utils/uiFontSize'

interface Props {
  onClose: () => void
}

type SettingsTab = 'appearance' | 'network'

const TABS: Array<{ id: SettingsTab; label: string; desc: string }> = [
  { id: 'appearance', label: '外观', desc: '字体与显示' },
  { id: 'network', label: '网络', desc: '代理与连接' },
]

export default function SettingsDialog({ onClose }: Props) {
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const [fontSize, setFontSize] = useState(UI_FONT_SIZE_DEFAULT)
  const [savedFontSize, setSavedFontSize] = useState(UI_FONT_SIZE_DEFAULT)
  const [useSystemProxy, setUseSystemProxy] = useState(true)
  const [detectedProxy, setDetectedProxy] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await window.easyshell.getSettings()
        if (!alive) return
        const size = normalizeUiFontSize(s.uiFontSize)
        setFontSize(size)
        setSavedFontSize(size)
        setUseSystemProxy(s.useSystemProxy !== false)
        setDetectedProxy(s.detectedProxy || null)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  function closeWithoutSave() {
    applyUiFontSize(savedFontSize)
    onClose()
  }

  function restoreFontDefault() {
    setFontSize(UI_FONT_SIZE_DEFAULT)
    applyUiFontSize(UI_FONT_SIZE_DEFAULT)
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const size = applyUiFontSize(fontSize)
      await window.easyshell.setSettings({
        uiFontSize: size,
        useSystemProxy,
      })
      setSavedFontSize(size)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-mask" onMouseDown={closeWithoutSave}>
      <div
        className="modal settings-dialog"
        role="dialog"
        aria-labelledby="settings-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-shell">
          <aside className="settings-nav">
            <h3 id="settings-title">设置</h3>
            <nav className="settings-nav-list">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${tab === item.id ? 'active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  <span className="settings-nav-label">{item.label}</span>
                  <span className="settings-nav-desc">{item.desc}</span>
                </button>
              ))}
            </nav>
          </aside>

          <div className="settings-main">
            {tab === 'appearance' ? (
              <section className="settings-panel">
                <header className="settings-panel-head">
                  <h4>外观</h4>
                  <p>调整界面文字大小，拖动可即时预览。</p>
                </header>

                <div className="settings-field">
                  <div className="settings-row-head">
                    <label htmlFor="ui-font-size">界面字体大小</label>
                    <strong>{fontSize}px</strong>
                  </div>
                  <input
                    id="ui-font-size"
                    className="settings-range"
                    type="range"
                    min={UI_FONT_SIZE_MIN}
                    max={UI_FONT_SIZE_MAX}
                    step={1}
                    value={fontSize}
                    onChange={(e) => {
                      const next = normalizeUiFontSize(e.target.value)
                      setFontSize(next)
                      applyUiFontSize(next)
                    }}
                  />
                  <div className="settings-range-marks">
                    <span>小 {UI_FONT_SIZE_MIN}</span>
                    <span>默认 {UI_FONT_SIZE_DEFAULT}</span>
                    <span>大 {UI_FONT_SIZE_MAX}</span>
                  </div>
                  <div className="settings-field-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={restoreFontDefault}
                      disabled={fontSize === UI_FONT_SIZE_DEFAULT}
                    >
                      恢复默认
                    </button>
                    <span className="settings-hint inline">
                      {fontSize === UI_FONT_SIZE_DEFAULT
                        ? '当前已是默认大小'
                        : `默认 ${UI_FONT_SIZE_DEFAULT}px`}
                    </span>
                  </div>
                </div>
              </section>
            ) : (
              <section className="settings-panel">
                <header className="settings-panel-head">
                  <h4>网络</h4>
                  <p>SSH 连接时的代理行为。</p>
                </header>

                <div className="settings-field">
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={useSystemProxy}
                      onChange={(e) => setUseSystemProxy(e.target.checked)}
                    />
                    <span>自动使用系统代理（Clash 等）</span>
                  </label>
                  <p className="settings-hint">
                    {detectedProxy
                      ? `当前检测到：${detectedProxy}`
                      : '未检测到系统 SOCKS 代理'}
                  </p>
                </div>
              </section>
            )}

            {error ? <p className="settings-error">{error}</p> : null}

            <div className="modal-actions settings-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeWithoutSave}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
