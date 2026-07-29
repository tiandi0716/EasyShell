import { useMemo, useState, type MouseEvent } from 'react'
import type { ConnectionConfig } from '../vite-env'
import ContextMenu, { type MenuItem } from './ContextMenu'
import FolderExportDialog from './FolderExportDialog'
import KeyPickDialog from './KeyPickDialog'

interface Props {
  connections: ConnectionConfig[]
  folders: string[]
  activeConnectionId?: string
  onConnect: (conn: ConnectionConfig) => void
  /** 连接一个或多个目录下的全部主机（无确认） */
  onConnectFolders: (folders: string[]) => void
  onCreateSsh: (folder?: string) => void
  onCreateFolder: () => void
  onEdit: (conn: ConnectionConfig) => void
  onRenameConn: (conn: ConnectionConfig) => void
  onDuplicate: (conn: ConnectionConfig) => void
  onCopyAddress: (conn: ConnectionConfig) => void
  onCopySshCommand: (conn: ConnectionConfig) => void
  onMove: (conn: ConnectionConfig) => void
  onDelete: (conn: ConnectionConfig) => void
  onRenameFolder: (folder: string) => void
  onDeleteFolder: (folder: string) => void
  onExport: (options?: { folders?: string[] }) => void
  onImportBackup: () => void
  onConvertFinalShell: () => void
}

type MenuState =
  | { type: 'folder'; folder: string; folders: string[]; x: number; y: number }
  | { type: 'conn'; conn: ConnectionConfig; x: number; y: number }
  | { type: 'tools'; x: number; y: number }
  | null

export default function ConnectionTree({
  connections,
  folders,
  activeConnectionId,
  onConnect,
  onConnectFolders,
  onCreateSsh,
  onCreateFolder,
  onEdit,
  onRenameConn,
  onDuplicate,
  onCopyAddress,
  onCopySshCommand,
  onMove,
  onDelete,
  onRenameFolder,
  onDeleteFolder,
  onExport,
  onImportBackup,
  onConvertFinalShell,
}: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, ConnectionConfig[]>()
    for (const folder of folders) {
      if (!folder || folder === '未分组') continue
      map.set(folder, [])
    }
    for (const conn of connections) {
      const folder = (conn.folder || '').trim()
      if (!folder || folder === '未分组') continue
      if (!map.has(folder)) map.set(folder, [])
      map.get(folder)!.push(conn)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host, 'zh-CN'))
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
  }, [connections, folders])

  const folderNames = useMemo(() => groups.map(([folder]) => folder), [groups])

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [anchorFolder, setAnchorFolder] = useState('')
  const [showExportPick, setShowExportPick] = useState(false)
  const [showKeyManage, setShowKeyManage] = useState(false)
  const [menu, setMenu] = useState<MenuState>(null)
  const q = filter.trim().toLowerCase()

  const folderCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const [folder, list] of groups) map[folder] = list.length
    return map
  }, [groups])

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return []
    if (menu.type === 'tools') {
      return [
        { key: 'exportPartial', label: '导出部分', disabled: !groups.length },
        { key: 'exportAll', label: '导出全部' },
        { key: 'import', label: '导入连接' },
        { key: 'sepTools', label: '', separator: true },
        { key: 'keys', label: '私钥管理' },
        { key: 'sepKeys', label: '', separator: true },
        { key: 'finalshell', label: 'FinalShell 转 EasyShell' },
      ]
    }
    if (menu.type === 'folder') {
      return [
        { key: 'connect', label: '连接' },
        { key: 'newConn', label: '新建连接' },
        { key: 'exportFolder', label: '导出' },
        { key: 'sep1', label: '', separator: true },
        { key: 'rename', label: '重命名目录' },
        { key: 'delete', label: '删除目录', danger: true },
      ]
    }
    const isRdp = (menu.conn.connType || 'ssh') === 'rdp'
    return [
      { key: 'connect', label: '连接' },
      { key: 'edit', label: '编辑' },
      { key: 'rename', label: '重命名' },
      { key: 'sep1', label: '', separator: true },
      { key: 'copyAddr', label: '复制地址' },
      {
        key: 'copyCmd',
        label: isRdp ? '复制 RDP 地址' : '复制 SSH 命令',
      },
      { key: 'duplicate', label: '克隆' },
      { key: 'move', label: '移动到目录…' },
      { key: 'sep2', label: '', separator: true },
      { key: 'delete', label: '删除', danger: true },
    ]
  }, [menu, groups.length])

  function expandAll(open: boolean) {
    const next: Record<string, boolean> = {}
    for (const [folder] of groups) next[folder] = open
    setExpanded(next)
  }

  const allExpanded =
    groups.length > 0 && groups.every(([folder]) => !!expanded[folder])

  function toggleExpandAll() {
    expandAll(!allExpanded)
  }

  /** FinalShell 风格：单击选中；⌘/Ctrl 多选；Shift 范围选 */
  function selectFolder(folder: string, e: MouseEvent) {
    if (e.shiftKey && anchorFolder) {
      const a = folderNames.indexOf(anchorFolder)
      const b = folderNames.indexOf(folder)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelectedFolders(folderNames.slice(lo, hi + 1))
        return
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedFolders((prev) =>
        prev.includes(folder) ? prev.filter((f) => f !== folder) : [...prev, folder],
      )
      setAnchorFolder(folder)
      return
    }
    setSelectedFolders([folder])
    setAnchorFolder(folder)
  }

  return (
    <div className="conn-tree">
      <div className="conn-toolbar">
        <button className="btn btn-ghost btn-sm" title="新建目录" onClick={onCreateFolder}>
          新建目录
        </button>
        <button className="btn btn-primary btn-sm" title="新建连接" onClick={() => onCreateSsh()}>
          新建连接
        </button>
        <button className="btn btn-ghost btn-sm" title="全部展开/折叠" onClick={toggleExpandAll}>
          {allExpanded ? '折叠' : '展开'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          title="导入导出 / FinalShell 转换"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            setMenu((prev) =>
              prev?.type === 'tools'
                ? null
                : { type: 'tools', x: rect.left, y: rect.bottom + 4 },
            )
          }}
        >
          辅助功能
        </button>
      </div>

      <input
        className="conn-search"
        placeholder="搜索主机 / 名称 / 目录"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <div className="conn-tree-body">
        {groups.length === 0 ? (
          <div className="monitor-empty">
            <p>暂无连接，先新建目录 / 新建连接</p>
          </div>
        ) : (
          groups.map(([folder, list]) => {
            const visible = q
              ? list.filter(
                  (c) =>
                    folder.toLowerCase().includes(q) ||
                    (c.name || '').toLowerCase().includes(q) ||
                    (c.host || '').toLowerCase().includes(q) ||
                    (c.username || '').toLowerCase().includes(q),
                )
              : list
            if (q && !visible.length && !folder.toLowerCase().includes(q)) return null

            const open = q ? true : !!expanded[folder]
            const folderSelected = selectedFolders.includes(folder)
            return (
              <div className="folder-block" key={folder}>
                <button
                  type="button"
                  className={`folder-head ${folderSelected ? 'selected' : ''}`}
                  onClick={(e) => selectFolder(folder, e)}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setExpanded((prev) => ({ ...prev, [folder]: !prev[folder] }))
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const targets =
                      selectedFolders.includes(folder) && selectedFolders.length > 0
                        ? selectedFolders
                        : [folder]
                    setSelectedFolders(targets)
                    setAnchorFolder(folder)
                    setMenu({
                      type: 'folder',
                      folder,
                      folders: targets,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }}
                  title="单击选中；⌘/Ctrl 多选；Shift 连选；双击展开/折叠；右键可连接"
                >
                  <span className="folder-arrow">{open ? '▼' : '▶'}</span>
                  <span className="folder-icon" />
                  <span className="folder-name">{folder}</span>
                  <span className="folder-count">{visible.length}</span>
                </button>
                {open ? (
                  <div className="folder-children">
                    {visible.length === 0 ? (
                      <div className="conn-empty">目录为空，右键可新建连接</div>
                    ) : (
                      visible.map((conn) => {
                        const isRdp = (conn.connType || 'ssh') === 'rdp'
                        const port = conn.port || (isRdp ? 3389 : 22)
                        return (
                          <div
                            key={conn.id}
                            className={`conn-row ${activeConnectionId === conn.id ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedFolders([folder])
                              setAnchorFolder(folder)
                            }}
                            onDoubleClick={() => onConnect(conn)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setSelectedFolders([folder])
                              setAnchorFolder(folder)
                              setMenu({ type: 'conn', conn, x: e.clientX, y: e.clientY })
                            }}
                            title={`${isRdp ? 'RDP' : 'SSH'} ${conn.username}@${conn.host}:${port}`}
                          >
                            <span className={isRdp ? 'conn-win-icon' : 'conn-term-icon'} />
                            <div className="conn-row-main">
                              <strong>
                                {conn.name || conn.host}
                                {isRdp ? <em className="conn-type-tag">Win</em> : null}
                              </strong>
                              <small>
                                {conn.host}:{port} · {conn.username}
                              </small>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
          onSelect={(key) => {
            if (menu.type === 'tools') {
              if (key === 'exportPartial') setShowExportPick(true)
              if (key === 'exportAll') onExport()
              if (key === 'import') onImportBackup()
              if (key === 'keys') setShowKeyManage(true)
              if (key === 'finalshell') onConvertFinalShell()
              return
            }
            if (menu.type === 'folder') {
              if (key === 'connect') onConnectFolders(menu.folders)
              if (key === 'newConn') onCreateSsh(menu.folder)
              if (key === 'exportFolder') onExport({ folders: menu.folders })
              if (key === 'rename') onRenameFolder(menu.folder)
              if (key === 'delete') onDeleteFolder(menu.folder)
              return
            }
            const { conn } = menu
            if (key === 'connect') onConnect(conn)
            if (key === 'edit') onEdit(conn)
            if (key === 'rename') onRenameConn(conn)
            if (key === 'copyAddr') onCopyAddress(conn)
            if (key === 'copyCmd') onCopySshCommand(conn)
            if (key === 'duplicate') onDuplicate(conn)
            if (key === 'move') onMove(conn)
            if (key === 'delete') onDelete(conn)
          }}
        />
      ) : null}

      {showExportPick ? (
        <FolderExportDialog
          folders={groups.map(([folder]) => folder)}
          counts={folderCounts}
          initialSelected={selectedFolders.length ? selectedFolders : []}
          onClose={() => setShowExportPick(false)}
          onConfirm={(picked) => {
            setShowExportPick(false)
            onExport({ folders: picked })
          }}
        />
      ) : null}

      {showKeyManage ? (
        <KeyPickDialog mode="manage" onClose={() => setShowKeyManage(false)} />
      ) : null}
    </div>
  )
}
