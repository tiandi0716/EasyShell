import {
  type DragEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { FileItem } from '../vite-env'
import { formatBytes, formatTime, joinPath, parentPath } from '../utils/format'
import ContextMenu, { type MenuItem } from './ContextMenu'
import PromptDialog from './PromptDialog'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  sessionId: string
  jumpPath?: { path: string; seq: number } | null
}

interface CtxState {
  x: number
  y: number
  item: FileItem | null
}

type DialogState =
  | { type: 'mkdir' }
  | { type: 'rename'; item: FileItem }
  | { type: 'remove'; item: FileItem; force?: boolean }
  | null

const LAST_DIR_KEY = 'easyshell.lastDownloadDir'

export default function FileBrowser({ sessionId, jumpPath }: Props) {
  const [cwd, setCwd] = useState('/')
  const [files, setFiles] = useState<FileItem[]>([])
  const [rootDirs, setRootDirs] = useState<FileItem[]>([])
  const [history, setHistory] = useState<string[]>(['/'])
  const [histPos, setHistPos] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<FileItem | null>(null)
  const [ctx, setCtx] = useState<CtxState | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dragReadyPath, setDragReadyPath] = useState<string | null>(null)

  const dragDepth = useRef(0)
  const jumpAppliedRef = useRef(0)
  const jumpPathRef = useRef(jumpPath)
  jumpPathRef.current = jumpPath
  const dragCache = useRef<Map<string, string>>(new Map())
  const prepPromises = useRef<Map<string, Promise<string>>>(new Map())

  const loadRoot = useCallback(async () => {
    try {
      const list = await window.easyshell.listDir(sessionId, '/')
      setRootDirs(list.filter((f) => f.isDir))
    } catch {
      setRootDirs([])
    }
  }, [sessionId])

  const refresh = useCallback(
    async (path: string, pushHistory = false) => {
      setLoading(true)
      setError('')
      try {
        const list = await window.easyshell.listDir(sessionId, path)
        setFiles(list)
        setCwd(path)
        setSelected(null)
        if (pushHistory) {
          setHistory((prev) => {
            const clipped = prev.slice(0, histPos + 1)
            const next = [...clipped, path]
            setHistPos(next.length - 1)
            return next
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [histPos, sessionId],
  )

  useEffect(() => {
    let cancelled = false
    jumpAppliedRef.current = 0
    ;(async () => {
      await loadRoot()
      try {
        const pending = jumpPathRef.current
        if (pending?.path) {
          if (cancelled) return
          jumpAppliedRef.current = pending.seq
          setHistory([pending.path])
          setHistPos(0)
          await refresh(pending.path, false)
          return
        }
        const home = await window.easyshell.getHome(sessionId)
        if (cancelled) return
        const start = home || '/'
        setHistory([start])
        setHistPos(0)
        await refresh(start, false)
      } catch {
        if (!cancelled) await refresh('/', false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (!jumpPath?.path) return
    if (jumpPath.seq === jumpAppliedRef.current) return
    jumpAppliedRef.current = jumpPath.seq
    void refresh(jumpPath.path, true)
  }, [jumpPath?.path, jumpPath?.seq, refresh])

  async function openDir(path: string) {
    await refresh(path, true)
  }

  async function openItem(item: FileItem) {
    if (!item.isDir) {
      setSelected(item)
      return
    }
    await openDir(joinPath(cwd, item.name))
  }

  async function goBack() {
    if (histPos <= 0) return
    const next = histPos - 1
    setHistPos(next)
    await refresh(history[next], false)
  }

  async function goUp() {
    if (cwd === '/') return
    await openDir(parentPath(cwd))
  }

  function remoteOf(item: FileItem) {
    return joinPath(cwd, item.name)
  }

  function prepareItem(item: FileItem) {
    const remotePath = remoteOf(item)
    const cached = dragCache.current.get(remotePath)
    if (cached) {
      setDragReadyPath(remotePath)
      return Promise.resolve(cached)
    }
    let pending = prepPromises.current.get(remotePath)
    if (!pending) {
      setBusy(`正在准备拖出 ${item.name}…`)
      pending = window.easyshell
        .prepareDrag(sessionId, remotePath, item.isDir, item.name, {
          mtime: item.mtime,
          size: item.size,
        })
        .then((localPath) => {
          dragCache.current.set(remotePath, localPath)
          prepPromises.current.delete(remotePath)
          setDragReadyPath(remotePath)
          setBusy(`${item.name} 可拖到桌面/访达任意位置`)
          window.setTimeout(() => {
            setBusy((prev) => (prev.includes(item.name) ? '' : prev))
          }, 2000)
          return localPath
        })
        .catch((err) => {
          prepPromises.current.delete(remotePath)
          setError(err instanceof Error ? err.message : String(err))
          setBusy('')
          throw err
        })
      prepPromises.current.set(remotePath, pending)
    }
    return pending
  }

  function onRowMouseDown(item: FileItem) {
    setSelected(item)
    // 按下即预下载，提高一次拖到访达的成功率
    void prepareItem(item).catch(() => {})
  }

  function onNativeDragStart(e: DragEvent, item: FileItem) {
    setSelected(item)
    const remotePath = remoteOf(item)
    const cached = dragCache.current.get(remotePath)
    e.dataTransfer.effectAllowed = 'copy'

    if (cached) {
      // 交给 macOS 原生拖放：可拖到桌面、访达、其它 App
      e.preventDefault()
      const ok = window.easyshell.startDrag(cached)
      if (!ok) setError('拖出失败，请再试一次或点「下载」')
      return
    }

    // 尚未就绪：取消本次系统拖拽，后台继续准备
    e.preventDefault()
    setBusy(`正在准备 ${item.name}，就绪后即可拖到访达`)
    void prepareItem(item).catch(() => {})
  }

  async function handleUpload() {
    try {
      setBusy('正在上传…')
      await window.easyshell.upload(sessionId, cwd)
      await refresh(cwd, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function uploadLocalPaths(paths: string[]) {
    if (!paths.length) return
    try {
      setBusy(`正在上传 ${paths.length} 个文件…`)
      setError('')
      const uploaded = await window.easyshell.uploadPaths(sessionId, cwd, paths)
      if (!uploaded.length) {
        setError('未上传任何文件（暂不支持拖入文件夹，请选择普通文件）')
      }
      await refresh(cwd, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  /** 统一下载：文件走另存为，文件夹选目录；useLast 则直接进上次目录 */
  async function handleDownload(item?: FileItem | null, useLast = false) {
    const target = item || selected
    if (!target) return
    try {
      setBusy('正在下载…')
      setError('')
      const last = localStorage.getItem(LAST_DIR_KEY)

      if (useLast) {
        if (!last) {
          setError('还没有上次下载目录，请先用一次「下载」')
          return
        }
        const result = await window.easyshell.downloadToDir(
          sessionId,
          [{ remotePath: remoteOf(target), isDir: target.isDir }],
          last,
        )
        if (result?.dir) localStorage.setItem(LAST_DIR_KEY, result.dir)
        return
      }

      if (target.isDir) {
        const result = await window.easyshell.downloadToDir(
          sessionId,
          [{ remotePath: remoteOf(target), isDir: true }],
          null,
        )
        if (result?.dir) localStorage.setItem(LAST_DIR_KEY, result.dir)
        return
      }

      const saved = await window.easyshell.download(sessionId, remoteOf(target))
      if (saved) {
        const dir = saved.replace(/[/\\][^/\\]+$/, '')
        if (dir) localStorage.setItem(LAST_DIR_KEY, dir)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function handleMkdir(name: string) {
    try {
      await window.easyshell.mkdir(sessionId, joinPath(cwd, name))
      await refresh(cwd, false)
      if (cwd === '/') await loadRoot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRename(item: FileItem, name: string) {
    try {
      await window.easyshell.rename(sessionId, remoteOf(item), joinPath(cwd, name))
      await refresh(cwd, false)
      if (cwd === '/') await loadRoot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRemove(item: FileItem, force = false) {
    try {
      setBusy(force ? '正在快速删除…' : '正在删除…')
      if (force) {
        await window.easyshell.removeRecursive(sessionId, remoteOf(item))
      } else {
        await window.easyshell.remove(sessionId, remoteOf(item), item.isDir)
      }
      await refresh(cwd, false)
      if (cwd === '/') await loadRoot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function copyPath(item: FileItem | null) {
    const text = item ? remoteOf(item) : cwd
    await window.easyshell.writeClipboard(text)
  }

  function openContext(e: MouseEvent, item: FileItem | null) {
    e.preventDefault()
    e.stopPropagation()
    if (item) setSelected(item)
    setCtx({ x: e.clientX, y: e.clientY, item })
  }

  const menuItems: MenuItem[] = useMemo(() => {
    const item = ctx?.item
    const hasItem = !!item
    const lastDir = localStorage.getItem(LAST_DIR_KEY)
    return [
      { key: 'refresh', label: '刷新' },
      { key: 'open', label: '打开', disabled: !item?.isDir },
      { key: 'sep1', label: '', separator: true },
      { key: 'copy', label: '复制路径' },
      { key: 'download', label: '下载', disabled: !hasItem },
      {
        key: 'downloadLast',
        label: '下载到上次目录',
        disabled: !hasItem || !lastDir,
      },
      { key: 'upload', label: '上传…' },
      { key: 'sep2', label: '', separator: true },
      { key: 'mkdir', label: '新建文件夹' },
      { key: 'rename', label: '重命名', disabled: !hasItem },
      { key: 'sep3', label: '', separator: true },
      { key: 'remove', label: '删除', danger: true, disabled: !hasItem },
      {
        key: 'removeForce',
        label: '快速删除 (rm -rf)',
        danger: true,
        disabled: !hasItem,
      },
    ]
  }, [ctx])

  async function onMenuSelect(key: string) {
    const item = ctx?.item || null
    setCtx(null)
    switch (key) {
      case 'refresh':
        await refresh(cwd, false)
        break
      case 'open':
        if (item?.isDir) await openItem(item)
        break
      case 'copy':
        await copyPath(item)
        break
      case 'download':
        await handleDownload(item, false)
        break
      case 'downloadLast':
        await handleDownload(item, true)
        break
      case 'upload':
        await handleUpload()
        break
      case 'mkdir':
        setDialog({ type: 'mkdir' })
        break
      case 'rename':
        if (item) setDialog({ type: 'rename', item })
        break
      case 'remove':
        if (item) setDialog({ type: 'remove', item, force: false })
        break
      case 'removeForce':
        if (item) setDialog({ type: 'remove', item, force: true })
        break
      default:
        break
    }
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    if ([...e.dataTransfer.types].includes('Files')) {
      setDragOver(true)
    }
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if ([...e.dataTransfer.types].includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    const filesList = [...e.dataTransfer.files]
    const paths = filesList
      .map((f) => window.easyshell.getPathForFile(f))
      .filter(Boolean)
    await uploadLocalPaths(paths)
  }

  return (
    <div className="files-pane">
      <div className="files-toolbar">
        <button className="btn btn-ghost btn-sm" onClick={() => void goBack()} disabled={histPos <= 0}>
          后退
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void goUp()} disabled={cwd === '/'}>
          上级
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void refresh(cwd, false)} disabled={loading}>
          刷新
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void handleUpload()} disabled={!!busy}>
          上传
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void handleDownload()}
          disabled={!selected || !!busy}
          title="文件：另存为；文件夹：选择保存目录。也可直接拖到访达"
        >
          下载
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setDialog({ type: 'mkdir' })}>
          新建目录
        </button>
        <button
          className="btn btn-danger btn-sm"
          onClick={() => selected && setDialog({ type: 'remove', item: selected })}
          disabled={!selected || !!busy}
        >
          删除
        </button>
        <input
          className="path-bar"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void openDir(cwd || '/')
          }}
        />
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {busy ? <div className="busy-banner">{busy}</div> : null}
      <div className="files-body">
        <div className="dir-tree">
          <button className={`tree-item ${cwd === '/' ? 'active' : ''}`} onClick={() => void openDir('/')}>
            /
          </button>
          {rootDirs.map((d) => {
            const path = joinPath('/', d.name)
            const active = cwd === path || cwd.startsWith(`${path}/`)
            return (
              <button
                key={d.name}
                className={`tree-item ${active ? 'active' : ''}`}
                onClick={() => void openDir(path)}
              >
                {d.name}
              </button>
            )
          })}
        </div>
        <div
          className={`file-table-wrap ${dragOver ? 'drop-active' : ''}`}
          onContextMenu={(e) => openContext(e, null)}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={(e) => void onDrop(e)}
        >
          {dragOver ? <div className="drop-overlay">松开以上传到当前目录</div> : null}
          <div className="file-table-head">
            <span>文件名</span>
            <span>大小</span>
            <span>类型</span>
            <span>修改时间</span>
            <span>权限</span>
            <span>用户/组</span>
          </div>
          <div className="file-table-body">
            {loading && !files.length ? (
              <div className="empty">加载中…</div>
            ) : (
              files.map((item) => {
                const remotePath = joinPath(cwd, item.name)
                const ready = dragReadyPath === remotePath || dragCache.current.has(remotePath)
                return (
                  <div
                    key={`${item.name}-${item.isDir}`}
                    role="button"
                    tabIndex={0}
                    draggable
                    className={`file-table-row ${selected?.name === item.name ? 'active' : ''} ${
                      ready ? 'drag-ready' : ''
                    }`}
                    onClick={() => setSelected(item)}
                    onDoubleClick={() => void openItem(item)}
                    onContextMenu={(e) => openContext(e, item)}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return
                      onRowMouseDown(item)
                    }}
                    onDragStart={(e) => onNativeDragStart(e, item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void openItem(item)
                    }}
                  >
                    <span className="name-cell">
                      <i className={item.isDir ? 'icon-dir' : 'icon-file'} />
                      {item.name}
                    </span>
                    <span>{item.isDir ? '-' : formatBytes(item.size)}</span>
                    <span>{item.type || (item.isDir ? '文件夹' : '文件')}</span>
                    <span>{formatTime(item.mtime)}</span>
                    <span className="mono">{item.permissions || '-'}</span>
                    <span>
                      {item.owner || '-'}
                      {item.group ? `/${item.group}` : ''}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {ctx ? (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={menuItems}
          onSelect={(key) => void onMenuSelect(key)}
          onClose={() => setCtx(null)}
        />
      ) : null}

      {dialog?.type === 'mkdir' ? (
        <PromptDialog
          title="新建文件夹"
          label="名称"
          placeholder="例如 backup"
          onConfirm={(name) => {
            setDialog(null)
            void handleMkdir(name)
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.type === 'rename' ? (
        <PromptDialog
          title="重命名"
          label="新名称"
          defaultValue={dialog.item.name}
          onConfirm={(name) => {
            const item = dialog.item
            setDialog(null)
            void handleRename(item, name)
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.type === 'remove' ? (
        <ConfirmDialog
          title={dialog.force ? '快速删除' : '删除'}
          message={
            dialog.force
              ? `将用 rm -rf 删除「${dialog.item.name}」，不可恢复。确认继续？`
              : `确认删除「${dialog.item.name}」？`
          }
          confirmText={dialog.force ? '快速删除' : '删除'}
          danger
          onConfirm={() => {
            const item = dialog.item
            const force = !!dialog.force
            setDialog(null)
            void handleRemove(item, force)
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}
