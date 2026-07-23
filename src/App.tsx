import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import CommandBar from './components/CommandBar'
import ConfirmDialog from './components/ConfirmDialog'
import ConnectionForm from './components/ConnectionForm'
import ConnectionTree from './components/ConnectionTree'
import ContextMenu from './components/ContextMenu'
import FileBrowser from './components/FileBrowser'
import FolderPickDialog from './components/FolderPickDialog'
import KoaIcon from './components/KoaIcon'
import MonitorPanel from './components/MonitorPanel'
import PromptDialog from './components/PromptDialog'
import RecentConnections from './components/RecentConnections'
import TerminalView from './components/TerminalView'
import { extractPwdPath } from './utils/pwdSync'
import {
  pushRecentConnection,
  readRecentEntries,
  type RecentEntry,
} from './utils/recentConnections'
import type { ConnectionConfig } from './vite-env'

interface CwdJump {
  path: string
  seq: number
}

interface SessionTab {
  id: string
  title: string
  connectionId?: string
  status: 'connecting' | 'ready' | 'closed' | 'error'
  error?: string
}

type DialogState =
  | { type: 'createFolder' }
  | { type: 'renameFolder'; folder: string }
  | { type: 'deleteFolder'; folder: string }
  | { type: 'renameConn'; conn: ConnectionConfig }
  | { type: 'deleteConn'; conn: ConnectionConfig }
  | { type: 'moveConn'; conn: ConnectionConfig }
  | { type: 'connectFolder'; folder: string; count: number }
  | { type: 'alert'; title: string; message: string }
  | null

const SIDEBAR_MIN = 260
const SIDEBAR_DEFAULT = 320
const SIDEBAR_WIDTH_KEY = 'easyshell.sidebarWidth'
const SIDEBAR_COLLAPSED_KEY = 'easyshell.sidebarCollapsed'

function readSidebarWidth() {
  const n = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  return Number.isFinite(n) && n >= SIDEBAR_MIN ? n : SIDEBAR_DEFAULT
}

export default function App() {
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [tabs, setTabs] = useState<SessionTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ConnectionConfig | null>(null)
  const [filesRatio, setFilesRatio] = useState(0.42)
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  )
  const [dialog, setDialog] = useState<DialogState>(null)
  const [tabMenu, setTabMenu] = useState<{ tab: SessionTab; x: number; y: number } | null>(null)
  const [cwdBySession, setCwdBySession] = useState<Record<string, CwdJump>>({})
  const [recent, setRecent] = useState<RecentEntry[]>(() => readRecentEntries())
  const pwdExpectRef = useRef<Map<string, { buf: string; timer: number }>>(new Map())
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth

  const markExpectPwd = useCallback((sessionId: string) => {
    const prev = pwdExpectRef.current.get(sessionId)
    if (prev) window.clearTimeout(prev.timer)
    const timer = window.setTimeout(() => {
      pwdExpectRef.current.delete(sessionId)
    }, 4000)
    pwdExpectRef.current.set(sessionId, { buf: '', timer })
  }, [])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) || null,
    [tabs, activeTabId],
  )

  const readySessionIds = useMemo(
    () => tabs.filter((t) => t.status === 'ready').map((t) => t.id),
    [tabs],
  )

  const loadConnections = useCallback(async () => {
    const list = await window.easyshell.listConnections()
    setConnections(list)
    const folderList = await window.easyshell.listFolders()
    setFolders(folderList)
  }, [])

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  // 页面刷新后，从主进程恢复仍存活的 SSH 会话标签
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const open = await window.easyshell.listOpenSessions()
        if (cancelled || !open.length) return
        const restored = open.map((item) => ({
          id: item.sessionId,
          title: item.title || item.host || item.sessionId,
          connectionId: item.connectionId,
          status: 'ready' as const,
        }))
        setTabs(restored)
        const savedActive = sessionStorage.getItem('easyshell.activeTabId')
        const active =
          restored.find((t) => t.id === savedActive)?.id || restored[restored.length - 1].id
        setActiveTabId(active)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (activeTabId) sessionStorage.setItem('easyshell.activeTabId', activeTabId)
  }, [activeTabId])

  // 渲染进程再拦一层 Cmd/Ctrl+R，避免误刷新
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault()
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    const offClose = window.easyshell.onSessionClose(({ sessionId }) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === sessionId ? { ...tab, status: 'closed', error: '连接已断开' } : tab,
        ),
      )
    })
    const offError = window.easyshell.onSessionError(({ sessionId, message }) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === sessionId ? { ...tab, status: 'error', error: message } : tab,
        ),
      )
    })
    const offData = window.easyshell.onSessionData(({ sessionId, data }) => {
      const expect = pwdExpectRef.current.get(sessionId)
      if (!expect) return
      expect.buf += data
      const path = extractPwdPath(expect.buf)
      if (!path) return
      window.clearTimeout(expect.timer)
      pwdExpectRef.current.delete(sessionId)
      setCwdBySession((prev) => ({
        ...prev,
        [sessionId]: { path, seq: Date.now() },
      }))
    })
    return () => {
      offClose()
      offError()
      offData()
      for (const item of pwdExpectRef.current.values()) {
        window.clearTimeout(item.timer)
      }
      pwdExpectRef.current.clear()
    }
  }, [])

  async function handleSave(conn: ConnectionConfig) {
    await window.easyshell.saveConnection(conn)
    await loadConnections()
  }

  function openCreateSsh(folder?: string) {
    const fallback = folders.find((f) => f && f !== '未分组') || ''
    setEditing({
      name: '',
      host: '',
      port: 22,
      username: 'root',
      authType: 'password',
      password: '',
      folder: folder && folder !== '未分组' ? folder : fallback,
    })
    setShowForm(true)
  }

  async function connectTo(conn: ConnectionConfig, replaceTabId?: string) {
    if (conn.id) setRecent(pushRecentConnection(conn))
    const tempId = replaceTabId || `pending-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
    const title = conn.name || `${conn.host}`
    if (replaceTabId) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === replaceTabId
            ? { ...tab, title, connectionId: conn.id, status: 'connecting', error: undefined }
            : tab,
        ),
      )
      setActiveTabId(replaceTabId)
    } else {
      setTabs((prev) => [
        ...prev,
        { id: tempId, title, connectionId: conn.id, status: 'connecting' },
      ])
      setActiveTabId(tempId)
    }

    try {
      const { sessionId } = await window.easyshell.openSession({
        config: { ...conn, cols: 120, rows: 36 },
      })
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tempId ? { ...tab, id: sessionId, status: 'ready', error: undefined } : tab,
        ),
      )
      setActiveTabId(sessionId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tempId ? { ...tab, status: 'error', error: message } : tab,
        ),
      )
    }
  }

  async function disconnectTab(tabId: string) {
    await window.easyshell.closeSession(tabId)
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId ? { ...tab, status: 'closed', error: '已断开' } : tab,
      ),
    )
  }

  async function reconnectTab(tab: SessionTab) {
    const conn = connections.find((c) => c.id === tab.connectionId)
    if (!conn) {
      setDialog({ type: 'alert', title: '无法重连', message: '找不到对应的主机配置' })
      return
    }
    if (tab.status === 'ready') {
      await window.easyshell.closeSession(tab.id)
    }
    await connectTo(conn, tab.id)
  }

  async function reconnectAllTabs() {
    const list = tabs.filter((t) => t.connectionId)
    await Promise.all(list.map((tab) => reconnectTab(tab)))
  }

  async function duplicateTab(tab: SessionTab) {
    const conn = connections.find((c) => c.id === tab.connectionId)
    if (!conn) {
      setDialog({ type: 'alert', title: '无法复制', message: '找不到对应的主机配置' })
      return
    }
    await connectTo(conn)
  }

  async function runConnectFolder(folder: string) {
    const list = connections.filter((c) => (c.folder || '') === folder)
    await Promise.all(list.map((conn) => connectTo(conn)))
  }

  async function handleDuplicate(conn: ConnectionConfig) {
    if (!conn.id) return
    await window.easyshell.duplicateConnection(conn.id)
    await loadConnections()
  }

  async function handleCopyAddress(conn: ConnectionConfig) {
    const text = `${conn.host}:${conn.port || 22}`
    await window.easyshell.writeClipboard(text)
  }

  async function handleCopySshCommand(conn: ConnectionConfig) {
    const port = conn.port || 22
    const text =
      port === 22
        ? `ssh ${conn.username}@${conn.host}`
        : `ssh -p ${port} ${conn.username}@${conn.host}`
    await window.easyshell.writeClipboard(text)
  }

  async function handleExportBackup() {
    try {
      const result = await window.easyshell.exportBackup()
      if (!result) return
      setDialog({
        type: 'alert',
        title: '导出成功',
        message: `已按目录导出 ${result.connections} 个连接、${result.folders} 个分组\n${result.path || result.filePath}`,
      })
    } catch (err) {
      setDialog({
        type: 'alert',
        title: '导出失败',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function handleImportBackup() {
    try {
      const result = await window.easyshell.importBackup()
      if (!result) return
      await loadConnections()
      const errHint = result.errors?.length
        ? `\n部分失败：${result.errors.slice(0, 3).join('；')}`
        : ''
      setDialog({
        type: 'alert',
        title: '导入成功',
        message: `新增 ${result.imported}，更新 ${result.updated}，当前共 ${result.total} 个连接${errHint}`,
      })
    } catch (err) {
      setDialog({
        type: 'alert',
        title: '导入失败',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function handleConvertFinalShell() {
    try {
      const result = await window.easyshell.convertFinalShell()
      if (!result) return
      const converted = result.converted ?? result.total ?? result.imported ?? 0
      const savePath = result.filePath || result.path || result.destDir || ''
      const scanned = result.files ?? 0
      const errHint = result.errors?.length
        ? `\n部分失败：${result.errors.slice(0, 3).join('；')}`
        : ''
      setDialog({
        type: 'alert',
        title: '转换完成',
        message: `已转换 ${converted} 个连接（扫描 ${scanned}）\n已按分组目录保存至：\n${savePath}${errHint}\n\n可用「导入连接」载入该目录`,
      })
    } catch (err) {
      setDialog({
        type: 'alert',
        title: '转换失败',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function closeTab(id: string) {
    await window.easyshell.closeSession(id)
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id)
      if (activeTabId === id) {
        setActiveTabId(next.length ? next[next.length - 1].id : null)
      }
      return next
    })
  }

  async function closeOtherTabs(keepId: string) {
    const others = tabs.filter((t) => t.id !== keepId)
    for (const tab of others) {
      // eslint-disable-next-line no-await-in-loop
      await window.easyshell.closeSession(tab.id)
    }
    setTabs((prev) => prev.filter((t) => t.id === keepId))
    setActiveTabId(keepId)
  }

  async function closeLeftTabs(keepId: string) {
    const idx = tabs.findIndex((t) => t.id === keepId)
    if (idx <= 0) return
    const toClose = tabs.slice(0, idx)
    for (const tab of toClose) {
      // eslint-disable-next-line no-await-in-loop
      await window.easyshell.closeSession(tab.id)
    }
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === keepId)
      return i <= 0 ? prev : prev.slice(i)
    })
    setActiveTabId(keepId)
  }

  async function closeRightTabs(keepId: string) {
    const idx = tabs.findIndex((t) => t.id === keepId)
    if (idx < 0 || idx >= tabs.length - 1) return
    const toClose = tabs.slice(idx + 1)
    for (const tab of toClose) {
      // eslint-disable-next-line no-await-in-loop
      await window.easyshell.closeSession(tab.id)
    }
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === keepId)
      return i < 0 ? prev : prev.slice(0, i + 1)
    })
    setActiveTabId(keepId)
  }

  async function closeAllTabs() {
    for (const tab of tabs) {
      // eslint-disable-next-line no-await-in-loop
      await window.easyshell.closeSession(tab.id)
    }
    setTabs([])
    setActiveTabId(null)
  }

  function startResize(e: ReactMouseEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startRatio = filesRatio
    const onMove = (ev: MouseEvent) => {
      const workspace = document.querySelector('.split-workspace') as HTMLElement | null
      if (!workspace) return
      const rect = workspace.getBoundingClientRect()
      const delta = (ev.clientY - startY) / rect.height
      setFilesRatio(Math.min(0.7, Math.max(0.22, startRatio - delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startSidebarResize(e: ReactMouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidthRef.current
    const onMove = (ev: MouseEvent) => {
      const max = Math.floor(window.innerWidth * 0.55)
      const next = Math.min(max, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)))
      setSidebarWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current))
      document.body.classList.remove('resizing-sidebar')
    }
    document.body.classList.add('resizing-sidebar')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function setCollapsed(next: boolean) {
    setSidebarCollapsed(next)
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
  }

  function resetSidebarWidth() {
    setSidebarWidth(SIDEBAR_DEFAULT)
    sidebarWidthRef.current = SIDEBAR_DEFAULT
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT))
  }

  return (
    <div className={`app ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      {!sidebarCollapsed ? (
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="brand">
            <div className="brand-text">
              <h1>EasyShell</h1>
              <KoaIcon size={34} />
            </div>
            <div className="brand-actions">
              {sidebarWidth !== SIDEBAR_DEFAULT ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm sidebar-toggle"
                  title="恢复左侧栏默认宽度"
                  onClick={resetSidebarWidth}
                >
                  恢复左侧栏
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm sidebar-toggle"
                title="收起左侧栏"
                onClick={() => setCollapsed(true)}
              >
                收起左侧栏
              </button>
            </div>
          </div>

        <div className="conn-panel">
          <div className="conn-panel-head">
            <strong>连接管理</strong>
          </div>
          <ConnectionTree
            connections={connections}
            folders={folders}
            activeConnectionId={activeTab?.connectionId}
            onConnect={(c) => void connectTo(c)}
            onConnectFolder={(folder) => {
              const count = connections.filter((c) => (c.folder || '') === folder).length
              if (!count) {
                setDialog({
                  type: 'alert',
                  title: '提示',
                  message: `目录「${folder}」下没有 SSH 连接`,
                })
                return
              }
              setDialog({ type: 'connectFolder', folder, count })
            }}
            onCreateSsh={(folder) => openCreateSsh(folder)}
            onCreateFolder={() => setDialog({ type: 'createFolder' })}
            onEdit={(c) => {
              setEditing(c)
              setShowForm(true)
            }}
            onRenameConn={(c) => setDialog({ type: 'renameConn', conn: c })}
            onDuplicate={(c) => void handleDuplicate(c)}
            onCopyAddress={(c) => void handleCopyAddress(c)}
            onCopySshCommand={(c) => void handleCopySshCommand(c)}
            onMove={(c) => setDialog({ type: 'moveConn', conn: c })}
            onDelete={(c) => setDialog({ type: 'deleteConn', conn: c })}
            onRenameFolder={(folder) => setDialog({ type: 'renameFolder', folder })}
            onDeleteFolder={(folder) => setDialog({ type: 'deleteFolder', folder })}
            onExportBackup={() => void handleExportBackup()}
            onImportBackup={() => void handleImportBackup()}
            onConvertFinalShell={() => void handleConvertFinalShell()}
          />
        </div>

        <div className="monitor-wrap">
          <div className="monitor-title">系统监控</div>
          <MonitorPanel sessionId={activeTab?.status === 'ready' ? activeTab.id : null} />
        </div>
        </aside>
      ) : null}

      {!sidebarCollapsed ? (
        <div
          className="sidebar-resizer"
          title="拖动调整宽度；双击恢复默认宽度"
          onMouseDown={startSidebarResize}
          onDoubleClick={(e) => {
            e.preventDefault()
            resetSidebarWidth()
          }}
        />
      ) : null}

      <section className="main">
        <div className="tabbar">
          {sidebarCollapsed ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm sidebar-open-btn"
              title="显示左侧栏"
              onClick={() => setCollapsed(false)}
            >
              展开侧栏
            </button>
          ) : null}
          {tabs.length === 0 ? (
            <span className="tab-placeholder">未连接</span>
          ) : (
            tabs.map((tab, index) => (
              <button
                key={tab.id}
                className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setActiveTabId(tab.id)
                  setTabMenu({ tab, x: e.clientX, y: e.clientY })
                }}
                title="右键打开标签菜单"
              >
                <span
                  className={`status-dot ${
                    tab.status === 'ready'
                      ? 'ok'
                      : tab.status === 'error' || tab.status === 'closed'
                        ? 'err'
                        : ''
                  }`}
                />
                <span className="tab-label">
                  {index + 1} {tab.title}
                </span>
                <span
                  className="close"
                  onClick={(e) => {
                    e.stopPropagation()
                    void closeTab(tab.id)
                  }}
                >
                  ×
                </span>
              </button>
            ))
          )}
        </div>

        {activeTab?.error ? <div className="error-banner">{activeTab.error}</div> : null}

        <div className="split-workspace">
          <div className="terminal-pane" style={{ flex: 1 - filesRatio }}>
            {!activeTab ? (
              <RecentConnections
                recent={recent}
                connections={connections}
                onConnect={(c) => void connectTo(c)}
                onClear={() => setRecent([])}
              />
            ) : activeTab.status === 'connecting' ? (
              <div className="empty">
                <h2>连接中…</h2>
                <p>正在建立 SSH 会话</p>
              </div>
            ) : activeTab.status === 'error' ? (
              <div className="empty">
                <h2>连接失败</h2>
                <p>{activeTab.error}</p>
              </div>
            ) : (
              <>
                <div className="terminal-stack">
                  {tabs
                    .filter((tab) => tab.status === 'ready')
                    .map((tab) => (
                      <div
                        key={tab.id}
                        className={`terminal-slot ${tab.id === activeTabId ? 'active' : ''}`}
                      >
                        <TerminalView
                          sessionId={tab.id}
                          active={tab.id === activeTabId}
                          syncSessionIds={readySessionIds}
                          onPwdCommand={markExpectPwd}
                        />
                      </div>
                    ))}
                </div>
                <CommandBar
                  activeSessionId={
                    activeTab?.status === 'ready' ? activeTab.id : readySessionIds[0] || null
                  }
                  readySessionIds={readySessionIds}
                  disabled={!readySessionIds.length}
                  onPwdCommand={(ids) => {
                    for (const id of ids) markExpectPwd(id)
                  }}
                />
              </>
            )}
          </div>

          <div className="split-bar" onMouseDown={startResize} />

          <div className="files-slot" style={{ flex: filesRatio }}>
            {activeTab?.status === 'ready' ? (
              <FileBrowser
                sessionId={activeTab.id}
                jumpPath={cwdBySession[activeTab.id] || null}
              />
            ) : (
              <div className="empty">
                <p>连接后显示远程文件管理</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {showForm ? (
        <ConnectionForm
          initial={editing}
          folders={folders}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
          }}
          onSave={handleSave}
        />
      ) : null}

      {dialog?.type === 'createFolder' ? (
        <PromptDialog
          title="新建目录"
          label="目录名称"
          placeholder="例如：平台服务器"
          onClose={() => setDialog(null)}
          onConfirm={async (name) => {
            await window.easyshell.createFolder(name)
            await loadConnections()
            setDialog(null)
          }}
        />
      ) : null}

      {dialog?.type === 'renameFolder' ? (
        <PromptDialog
          title="重命名目录"
          label="新名称"
          defaultValue={dialog.folder}
          onClose={() => setDialog(null)}
          onConfirm={async (name) => {
            try {
              await window.easyshell.renameFolder(dialog.folder, name)
              await loadConnections()
              setDialog(null)
            } catch (err) {
              setDialog({
                type: 'alert',
                title: '重命名失败',
                message: err instanceof Error ? err.message : String(err),
              })
            }
          }}
        />
      ) : null}

      {dialog?.type === 'renameConn' ? (
        <PromptDialog
          title="重命名连接"
          label="名称"
          defaultValue={dialog.conn.name || dialog.conn.host}
          onClose={() => setDialog(null)}
          onConfirm={async (name) => {
            if (!dialog.conn.id) return
            await window.easyshell.renameConnection(dialog.conn.id, name)
            await loadConnections()
            setDialog(null)
          }}
        />
      ) : null}

      {dialog?.type === 'moveConn' ? (
        <FolderPickDialog
          title={`移动「${dialog.conn.name || dialog.conn.host}」`}
          folders={folders}
          current={dialog.conn.folder || ''}
          exclude={[dialog.conn.folder || '']}
          onClose={() => setDialog(null)}
          onConfirm={async (folder) => {
            if (!dialog.conn.id) return
            await window.easyshell.moveConnection(dialog.conn.id, folder)
            await loadConnections()
            setDialog(null)
          }}
        />
      ) : null}

      {dialog?.type === 'deleteFolder' ? (
        <ConfirmDialog
          title="删除目录"
          message={`删除目录「${dialog.folder}」？\n其中的 SSH 连接也会一并删除，且不可恢复。`}
          danger
          confirmText="删除目录"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await window.easyshell.deleteFolder(dialog.folder, 'delete')
              await loadConnections()
              setDialog(null)
            } catch (err) {
              setDialog({
                type: 'alert',
                title: '删除失败',
                message: err instanceof Error ? err.message : String(err),
              })
            }
          }}
        />
      ) : null}

      {dialog?.type === 'deleteConn' ? (
        <ConfirmDialog
          title="删除连接"
          message={`确认删除连接「${dialog.conn.name || dialog.conn.host}」？`}
          danger
          confirmText="删除"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (!dialog.conn.id) return
            await window.easyshell.deleteConnection(dialog.conn.id)
            await loadConnections()
            setDialog(null)
          }}
        />
      ) : null}

      {dialog?.type === 'connectFolder' ? (
        <ConfirmDialog
          title="连接全部"
          message={`连接「${dialog.folder}」下全部 ${dialog.count} 台主机？`}
          confirmText="开始连接"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const folder = dialog.folder
            setDialog(null)
            await runConnectFolder(folder)
          }}
        />
      ) : null}

      {dialog?.type === 'alert' ? (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmText="知道了"
          onClose={() => setDialog(null)}
          onConfirm={() => setDialog(null)}
        />
      ) : null}

      {tabMenu ? (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={[
            { key: 'duplicate', label: '复制标签' },
            { key: 'sep1', label: '', separator: true },
            {
              key: 'connect',
              label: '连接',
              disabled: tabMenu.tab.status === 'ready' || !tabMenu.tab.connectionId,
            },
            { key: 'connectAll', label: '连接全部' },
            { key: 'sep2', label: '', separator: true },
            {
              key: 'disconnect',
              label: '断开',
              disabled: tabMenu.tab.status !== 'ready',
            },
            { key: 'sep3', label: '', separator: true },
            { key: 'close', label: '关闭' },
            {
              key: 'closeLeft',
              label: '关闭左边',
              disabled: tabs.findIndex((t) => t.id === tabMenu.tab.id) <= 0,
            },
            {
              key: 'closeRight',
              label: '关闭右边',
              disabled: (() => {
                const i = tabs.findIndex((t) => t.id === tabMenu.tab.id)
                return i < 0 || i >= tabs.length - 1
              })(),
            },
            { key: 'closeOthers', label: '关闭其他', disabled: tabs.length <= 1 },
            { key: 'closeAll', label: '关闭全部', danger: true },
          ]}
          onClose={() => setTabMenu(null)}
          onSelect={(key) => {
            const tab = tabMenu.tab
            if (key === 'duplicate') void duplicateTab(tab)
            if (key === 'connect') void reconnectTab(tab)
            if (key === 'connectAll') void reconnectAllTabs()
            if (key === 'disconnect') void disconnectTab(tab.id)
            if (key === 'close') void closeTab(tab.id)
            if (key === 'closeLeft') void closeLeftTabs(tab.id)
            if (key === 'closeRight') void closeRightTabs(tab.id)
            if (key === 'closeOthers') void closeOtherTabs(tab.id)
            if (key === 'closeAll') void closeAllTabs()
          }}
        />
      ) : null}
    </div>
  )
}
