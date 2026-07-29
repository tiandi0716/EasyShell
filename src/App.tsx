import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { flushSync } from 'react-dom'
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
import RdpView from './components/RdpView'
import SettingsDialog from './components/SettingsDialog'
import TerminalView from './components/TerminalView'
import TransferMenu from './components/TransferMenu'
import { extractPwdPath } from './utils/pwdSync'
import { applyUiFontSize } from './utils/uiFontSize'
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
  kind?: 'ssh' | 'rdp'
  status: 'connecting' | 'ready' | 'closed' | 'error'
  error?: string
  screen?: { width: number; height: number }
}

type DialogState =
  | { type: 'createFolder' }
  | { type: 'renameFolder'; folder: string }
  | { type: 'deleteFolder'; folder: string }
  | { type: 'renameConn'; conn: ConnectionConfig }
  | { type: 'deleteConn'; conn: ConnectionConfig }
  | { type: 'moveConn'; conn: ConnectionConfig }
  | { type: 'alert'; title: string; message: string }
  | null

const SIDEBAR_MIN = 260
const SIDEBAR_DEFAULT = 320
const SIDEBAR_WIDTH_KEY = 'easyshell.sidebarWidth'
const SIDEBAR_COLLAPSED_KEY = 'easyshell.sidebarCollapsed'
const FILES_RATIO_KEY = 'easyshell.filesRatio'
const FILES_RATIO_DEFAULT = 0.42
const FILES_RATIO_MIN = 0.12
const FILES_RATIO_MAX = 0.75

function readSidebarWidth() {
  const n = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  return Number.isFinite(n) && n >= SIDEBAR_MIN ? n : SIDEBAR_DEFAULT
}

function readFilesRatio() {
  const n = Number(localStorage.getItem(FILES_RATIO_KEY))
  return Number.isFinite(n) && n >= FILES_RATIO_MIN && n <= FILES_RATIO_MAX
    ? n
    : FILES_RATIO_DEFAULT
}

function persistSidebarWidth(width: number) {
  if (width >= SIDEBAR_MIN) {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
  }
}

function persistFilesRatio(ratio: number) {
  if (ratio >= FILES_RATIO_MIN && ratio <= FILES_RATIO_MAX) {
    localStorage.setItem(FILES_RATIO_KEY, String(ratio))
  }
}

export default function App() {
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [tabs, setTabs] = useState<SessionTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editing, setEditing] = useState<ConnectionConfig | null>(null)
  const [createConnType, setCreateConnType] = useState<'ssh' | 'rdp'>('ssh')
  const [filesRatio, setFilesRatio] = useState(readFilesRatio)
  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const lastFilesRatioRef = useRef(readFilesRatio())
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  )
  const lastSidebarWidthRef = useRef(readSidebarWidth())
  /** FinalShell 风格：连接管理从标签栏左侧按钮展开（默认不弹出） */
  const [showConnManager, setShowConnManager] = useState(false)
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
    () => tabs.filter((t) => t.status === 'ready' && t.kind !== 'rdp').map((t) => t.id),
    [tabs],
  )

  /** 布局：RDP 标签占用全宽主区（连接中也要隐藏文件栏，便于按最终尺寸建会话） */
  const isRdpLayout = activeTab?.kind === 'rdp'
  const isActiveRdp = isRdpLayout && activeTab.status === 'ready'

  const loadConnections = useCallback(async () => {
    const list = await window.easyshell.listConnections()
    setConnections(list)
    const folderList = await window.easyshell.listFolders()
    setFolders(folderList)
  }, [])

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  useEffect(() => {
    if (!showConnManager) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConnManager(false)
    }
    const onPointerDown = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (!el || typeof el.closest !== 'function') return
      // 点在连接管理面板、打开按钮、右键菜单、弹窗上时不关
      if (el.closest('.conn-manager-float')) return
      if (el.closest('.conn-manager-btn')) return
      if (el.closest('.ctx-menu')) return
      if (el.closest('.modal-mask')) return
      if (el.closest('.modal')) return
      setShowConnManager(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [showConnManager])

  // 启动时恢复已保存的界面字体大小
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await window.easyshell.getSettings()
        if (alive) applyUiFontSize(s.uiFontSize)
      } catch {
        // ignore
      }
    })()
    return () => {
      alive = false
    }
  }, [])

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

  useEffect(() => {
    const offClose = window.easyshell.onRdpClose(({ sessionId }) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === sessionId ? { ...tab, status: 'closed', error: '远程桌面已断开' } : tab,
        ),
      )
    })
    const offError = window.easyshell.onRdpError(({ sessionId, message }) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === sessionId ? { ...tab, status: 'error', error: message } : tab,
        ),
      )
    })
    return () => {
      offClose()
      offError()
    }
  }, [])

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

  function openCreateSsh(folder?: string, connType: 'ssh' | 'rdp' = 'ssh') {
    const fallback = folders.find((f) => f && f !== '未分组') || ''
    const isRdp = connType === 'rdp'
    setCreateConnType(connType)
    setEditing({
      connType,
      name: '',
      host: '',
      port: isRdp ? 3389 : 22,
      username: isRdp ? 'Administrator' : 'root',
      authType: 'password',
      password: '',
      folder: folder && folder !== '未分组' ? folder : fallback,
    })
    setShowForm(true)
  }

  async function connectTo(conn: ConnectionConfig, replaceTabId?: string) {
    const isRdp = (conn.connType || 'ssh') === 'rdp'
    if (conn.id) setRecent(pushRecentConnection(conn))
    const tempId = replaceTabId || `pending-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
    const title = conn.name || `${conn.host}`
    const applyConnecting = () => {
      if (replaceTabId) {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === replaceTabId
              ? {
                  ...tab,
                  title,
                  connectionId: conn.id,
                  kind: isRdp ? 'rdp' : 'ssh',
                  status: 'connecting',
                  error: undefined,
                }
              : tab,
          ),
        )
        setActiveTabId(replaceTabId)
      } else {
        setTabs((prev) => [
          ...prev,
          {
            id: tempId,
            title,
            connectionId: conn.id,
            kind: isRdp ? 'rdp' : 'ssh',
            status: 'connecting',
          },
        ])
        setActiveTabId(tempId)
      }
    }
    // RDP 需立刻切到全宽测量舞台，再读尺寸；SSH 普通异步更新即可
    if (isRdp) flushSync(applyConnecting)
    else applyConnecting()
    setShowConnManager(false)

    try {
      if (isRdp) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
        const stage =
          (document.querySelector('.terminal-pane .rdp-stage') as HTMLElement | null) ||
          (document.querySelector('.terminal-pane') as HTMLElement | null)
        const pw = Math.max(640, Math.floor(stage?.clientWidth || window.innerWidth * 0.7))
        const ph = Math.max(400, Math.floor(stage?.clientHeight || window.innerHeight * 0.75))
        // 偶数尺寸，贴近舞台像素，几乎铺满
        const width = Math.max(640, pw - (pw % 2))
        const height = Math.max(400, ph - (ph % 2))
        const { sessionId, screen } = await window.easyshell.openRdpSession({
          config: { ...conn, width, height },
        })
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tempId
              ? {
                  ...tab,
                  id: sessionId,
                  kind: 'rdp',
                  status: 'ready',
                  error: undefined,
                  screen,
                }
              : tab,
          ),
        )
        setActiveTabId(sessionId)
        return
      }

      const { sessionId } = await window.easyshell.openSession({
        config: { ...conn, cols: 120, rows: 36 },
      })
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tempId
            ? { ...tab, id: sessionId, kind: 'ssh', status: 'ready', error: undefined }
            : tab,
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

  async function runConnectFolders(folderList: string[]) {
    const set = new Set(folderList)
    const list = connections.filter((c) => set.has(c.folder || ''))
    await Promise.all(list.map((conn) => connectTo(conn)))
  }

  async function handleDuplicate(conn: ConnectionConfig) {
    if (!conn.id) return
    await window.easyshell.duplicateConnection(conn.id)
    await loadConnections()
  }

  async function handleCopyAddress(conn: ConnectionConfig) {
    await window.easyshell.writeClipboard(conn.host)
  }

  async function handleCopySshCommand(conn: ConnectionConfig) {
    if ((conn.connType || 'ssh') === 'rdp') {
      const port = conn.port || 3389
      const text = port === 3389 ? conn.host : `${conn.host}:${port}`
      await window.easyshell.writeClipboard(text)
      return
    }
    const port = conn.port || 22
    const text =
      port === 22
        ? `ssh ${conn.username}@${conn.host}`
        : `ssh -p ${port} ${conn.username}@${conn.host}`
    await window.easyshell.writeClipboard(text)
  }

  async function handleExportBackup(options?: { folders?: string[] }) {
    try {
      const result = await window.easyshell.exportBackup(options)
      if (!result) return
      const scope =
        options?.folders?.length === 1
          ? `目录「${options.folders[0]}」`
          : options?.folders?.length
            ? `${options.folders.length} 个选中目录`
            : '全部'
      setDialog({
        type: 'alert',
        title: '导出成功',
        message: `已导出${scope}：${result.connections} 个连接、${result.folders} 个分组${
          result.keys ? `、${result.keys} 个私钥` : ''
        }\n${result.path || result.filePath}`,
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
      const keyHint =
        (result.keysImported || 0) + (result.keysUpdated || 0) > 0
          ? `\n私钥：新增 ${result.keysImported || 0}，更新 ${result.keysUpdated || 0}`
          : ''
      setDialog({
        type: 'alert',
        title: '导入成功',
        message: `新增 ${result.imported}，更新 ${result.updated}，当前共 ${result.total} 个连接${keyHint}${errHint}`,
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
    let collapsed = filesCollapsed
    // 本次拖动开始前的稳定位置：收起后只恢复到这里，不被拖动过程中的中间值覆盖
    const ratioAtStart =
      !collapsed && filesRatio >= FILES_RATIO_MIN
        ? filesRatio
        : lastFilesRatioRef.current >= FILES_RATIO_MIN
          ? lastFilesRatioRef.current
          : readFilesRatio()
    let currentRatio = collapsed ? ratioAtStart : filesRatio
    if (!collapsed && filesRatio >= FILES_RATIO_MIN) {
      lastFilesRatioRef.current = filesRatio
      persistFilesRatio(filesRatio)
    }

    const onMove = (ev: MouseEvent) => {
      const workspace = document.querySelector('.split-workspace') as HTMLElement | null
      if (!workspace) return
      const rect = workspace.getBoundingClientRect()
      if (rect.height < 1) return
      const fromBottom = rect.bottom - ev.clientY
      const nextRatio = fromBottom / rect.height
      if (fromBottom < 48 || nextRatio < 0.08) {
        if (!collapsed) {
          lastFilesRatioRef.current = ratioAtStart
          persistFilesRatio(ratioAtStart)
        }
        collapsed = true
        currentRatio = 0
        setFilesCollapsed(true)
        setFilesRatio(0)
        return
      }
      collapsed = false
      currentRatio = Math.min(FILES_RATIO_MAX, Math.max(FILES_RATIO_MIN, nextRatio))
      setFilesCollapsed(false)
      setFilesRatio(currentRatio)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing-rows')
      if (collapsed) {
        lastFilesRatioRef.current = ratioAtStart
        persistFilesRatio(ratioAtStart)
        return
      }
      if (currentRatio >= FILES_RATIO_MIN) {
        lastFilesRatioRef.current = currentRatio
        persistFilesRatio(currentRatio)
      }
    }
    document.body.classList.add('resizing-rows')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function restoreFilesPanel() {
    const ratio = readFilesRatio()
    lastFilesRatioRef.current = ratio
    setFilesCollapsed(false)
    setFilesRatio(ratio)
  }

  function startSidebarResize(e: ReactMouseEvent) {
    e.preventDefault()
    let collapsed = sidebarCollapsed
    const widthAtStart =
      !collapsed && sidebarWidthRef.current >= SIDEBAR_MIN
        ? sidebarWidthRef.current
        : lastSidebarWidthRef.current >= SIDEBAR_MIN
          ? lastSidebarWidthRef.current
          : readSidebarWidth()
    let currentWidth = collapsed ? widthAtStart : sidebarWidthRef.current
    if (!collapsed && sidebarWidthRef.current >= SIDEBAR_MIN) {
      lastSidebarWidthRef.current = sidebarWidthRef.current
      persistSidebarWidth(sidebarWidthRef.current)
    }

    const onMove = (ev: MouseEvent) => {
      const app = document.querySelector('.app') as HTMLElement | null
      if (!app) return
      const rect = app.getBoundingClientRect()
      const fromLeft = ev.clientX - rect.left
      const max = Math.floor(window.innerWidth * 0.55)
      if (fromLeft < 48) {
        if (!collapsed) {
          lastSidebarWidthRef.current = widthAtStart
          persistSidebarWidth(widthAtStart)
        }
        collapsed = true
        setSidebarCollapsed(true)
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
        return
      }
      collapsed = false
      currentWidth = Math.min(max, Math.max(SIDEBAR_MIN, fromLeft))
      setSidebarCollapsed(false)
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '0')
      setSidebarWidth(currentWidth)
      sidebarWidthRef.current = currentWidth
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing-sidebar')
      if (collapsed) {
        lastSidebarWidthRef.current = widthAtStart
        persistSidebarWidth(widthAtStart)
        // 收起后状态里可能残留拖动中的中间宽度，恢复时以记住的位置为准
        setSidebarWidth(widthAtStart)
        sidebarWidthRef.current = widthAtStart
        return
      }
      if (currentWidth >= SIDEBAR_MIN) {
        lastSidebarWidthRef.current = currentWidth
        persistSidebarWidth(currentWidth)
      }
    }
    document.body.classList.add('resizing-sidebar')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function restoreSidebar() {
    const width = readSidebarWidth()
    lastSidebarWidthRef.current = width
    setSidebarWidth(width)
    sidebarWidthRef.current = width
    setSidebarCollapsed(false)
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '0')
  }

  function resetSidebarWidth() {
    setSidebarWidth(SIDEBAR_DEFAULT)
    sidebarWidthRef.current = SIDEBAR_DEFAULT
    lastSidebarWidthRef.current = SIDEBAR_DEFAULT
    persistSidebarWidth(SIDEBAR_DEFAULT)
  }

  return (
    <div className={`app ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      {!sidebarCollapsed ? (
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="brand">
            <div className="brand-text">
              <div className="brand-title-row">
                <h1>EasyShell</h1>
              </div>
              <KoaIcon size={34} />
            </div>
          </div>

        <div className="monitor-wrap">
          <div className="monitor-title">系统监控</div>
          <MonitorPanel
            sessionId={
              activeTab?.status === 'ready' && activeTab.kind !== 'rdp' ? activeTab.id : null
            }
            rdpSessionId={isActiveRdp ? activeTab.id : null}
            unavailableReason={
              isRdpLayout && !isActiveRdp ? '正在建立 Windows 远程桌面…' : null
            }
          />
        </div>
        </aside>
      ) : (
        <div className="sidebar-restore-bar" onMouseDown={startSidebarResize}>
          <button
            type="button"
            className="sidebar-restore-btn"
            title="恢复左侧栏"
            onClick={(e) => {
              e.stopPropagation()
              restoreSidebar()
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            恢复左侧栏
          </button>
        </div>
      )}

      {!sidebarCollapsed ? (
        <div
          className="sidebar-resizer"
          title="向左拖动可收起；双击恢复默认宽度"
          onMouseDown={startSidebarResize}
          onDoubleClick={(e) => {
            e.preventDefault()
            resetSidebarWidth()
          }}
        />
      ) : null}

      <section className="main">
        <div
          className={`tabbar${showConnManager ? ' conn-manager-open' : ''}`}
          onMouseDown={(e) => {
            if (!showConnManager) return
            const t = e.target as Element
            // 文件夹按钮自己负责开关，这里不要抢
            if (t.closest?.('.conn-manager-btn')) return
            setShowConnManager(false)
          }}
        >
          <button
            type="button"
            className={`conn-manager-btn ${showConnManager ? 'active' : ''}`}
            title={showConnManager ? '收起连接管理' : '打开连接管理'}
            aria-label="连接管理"
            aria-expanded={showConnManager}
            onClick={() => setShowConnManager((v) => !v)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7.2A2.2 2.2 0 0 1 6.2 5h4.1l1.4 1.6H17.8A2.2 2.2 0 0 1 20 8.8v7A2.2 2.2 0 0 1 17.8 18H6.2A2.2 2.2 0 0 1 4 15.8V7.2Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M9.2 12.8h5.6M12 10v5.6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
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
                  <span className="tab-index">{index + 1}</span>
                  {tab.title}
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
          <div className="tabbar-spacer" />
          <TransferMenu />
          <button
            type="button"
            className="tabbar-settings-btn"
            title="设置"
            aria-label="设置"
            onClick={() => setShowSettings(true)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M19.4 13a7.8 7.8 0 0 0 .05-2l2.05-1.6-2-3.46-2.45.9a7.7 7.7 0 0 0-1.73-1L14.9 3h-5.8l-.42 2.84a7.7 7.7 0 0 0-1.73 1l-2.45-.9-2 3.46L4.55 11a7.8 7.8 0 0 0 0 2l-2.05 1.6 2 3.46 2.45-.9c.53.42 1.11.76 1.73 1L9.1 21h5.8l.42-2.84c.62-.24 1.2-.58 1.73-1l2.45.9 2-3.46L19.4 13Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {activeTab?.error ? <div className="error-banner">{activeTab.error}</div> : null}

        <div className="main-stage">
          {showConnManager ? (
            <div className="conn-manager-float" role="dialog" aria-label="连接管理">
              <div className="conn-panel">
                <ConnectionTree
                  connections={connections}
                  folders={folders}
                  activeConnectionId={activeTab?.connectionId}
                  onConnect={(c) => void connectTo(c)}
                  onConnectFolders={(folderList) => {
                    const set = new Set(folderList)
                    const count = connections.filter((c) => set.has(c.folder || '')).length
                    if (!count) {
                      const label =
                        folderList.length === 1
                          ? `目录「${folderList[0]}」`
                          : `选中的 ${folderList.length} 个目录`
                      setDialog({
                        type: 'alert',
                        title: '提示',
                        message: `${label}下没有连接`,
                      })
                      return
                    }
                    void runConnectFolders(folderList)
                  }}
                  onCreateSsh={(folder) => openCreateSsh(folder, 'ssh')}
                  onCreateFolder={() => setDialog({ type: 'createFolder' })}
                  onEdit={(c) => {
                    setCreateConnType((c.connType || 'ssh') as 'ssh' | 'rdp')
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
                  onExport={(options) => void handleExportBackup(options)}
                  onImportBackup={() => void handleImportBackup()}
                  onConvertFinalShell={() => void handleConvertFinalShell()}
                />
              </div>
            </div>
          ) : null}

        <div className="split-workspace">
          <div
            className="terminal-pane"
            style={{ flex: isRdpLayout || filesCollapsed ? 1 : 1 - filesRatio }}
          >
            {!activeTab ? (
              <RecentConnections
                recent={recent}
                connections={connections}
                onConnect={(c) => void connectTo(c)}
                onClear={() => setRecent([])}
              />
            ) : activeTab.status === 'connecting' ? (
              activeTab.kind === 'rdp' ? (
                <div className="rdp-view rdp-view-measuring">
                  <div className="rdp-stage" />
                  <div className="rdp-connecting-overlay">
                    <h2>连接中…</h2>
                    <p>正在建立 Windows 远程桌面会话</p>
                  </div>
                </div>
              ) : (
                <div className="empty">
                  <h2>连接中…</h2>
                  <p>正在建立 SSH 会话</p>
                </div>
              )
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
                        {tab.kind === 'rdp' ? (
                          <RdpView
                            sessionId={tab.id}
                            active={tab.id === activeTabId}
                            width={tab.screen?.width || 1280}
                            height={tab.screen?.height || 720}
                          />
                        ) : (
                          <TerminalView
                            sessionId={tab.id}
                            active={tab.id === activeTabId}
                            syncSessionIds={readySessionIds}
                            onPwdCommand={markExpectPwd}
                          />
                        )}
                      </div>
                    ))}
                </div>
                {!isActiveRdp ? (
                  <CommandBar
                    activeSessionId={
                      activeTab?.status === 'ready' && activeTab.kind !== 'rdp'
                        ? activeTab.id
                        : readySessionIds[0] || null
                    }
                    readySessionIds={readySessionIds}
                    disabled={!readySessionIds.length}
                    onPwdCommand={(ids) => {
                      for (const id of ids) markExpectPwd(id)
                    }}
                  />
                ) : null}
              </>
            )}
          </div>

          {!isRdpLayout && filesCollapsed ? (
            <div className="files-restore-bar" onMouseDown={startResize}>
              <button
                type="button"
                className="files-restore-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  restoreFilesPanel()
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                恢复下边栏
              </button>
            </div>
          ) : null}

          {!isRdpLayout && !filesCollapsed ? (
            <div className="split-bar" onMouseDown={startResize} />
          ) : null}

          {!isRdpLayout && !filesCollapsed ? (
            <div className="files-slot" style={{ flex: filesRatio }}>
              {activeTab?.status === 'ready' && activeTab.kind !== 'rdp' ? (
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
          ) : null}
        </div>
        </div>
      </section>

      {showForm ? (
        <ConnectionForm
          initial={editing}
          folders={folders}
          defaultConnType={createConnType}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
            setCreateConnType('ssh')
          }}
          onSave={handleSave}
        />
      ) : null}

      {showSettings ? <SettingsDialog onClose={() => setShowSettings(false)} /> : null}

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
            {
              key: 'copyAddress',
              label: '复制地址',
              disabled: !tabMenu.tab.connectionId,
            },
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
            if (key === 'copyAddress') {
              const conn = connections.find((c) => c.id === tab.connectionId)
              if (conn) void handleCopyAddress(conn)
              else
                setDialog({
                  type: 'alert',
                  title: '无法复制',
                  message: '找不到对应的主机配置',
                })
            }
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
