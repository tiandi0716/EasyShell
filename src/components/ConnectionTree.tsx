import { useMemo, useState } from 'react'
import type { ConnectionConfig } from '../vite-env'
import ContextMenu, { type MenuItem } from './ContextMenu'

interface Props {
  connections: ConnectionConfig[]
  folders: string[]
  activeConnectionId?: string
  onConnect: (conn: ConnectionConfig) => void
  onConnectFolder: (folder: string) => void
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
  onExportBackup: () => void
  onImportBackup: () => void
  onConvertFinalShell: () => void
}

type MenuState =
  | { type: 'folder'; folder: string; x: number; y: number }
  | { type: 'conn'; conn: ConnectionConfig; x: number; y: number }
  | { type: 'tools'; x: number; y: number }
  | null

export default function ConnectionTree({
  connections,
  folders,
  activeConnectionId,
  onConnect,
  onConnectFolder,
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
  onExportBackup,
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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<MenuState>(null)
  const q = filter.trim().toLowerCase()

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return []
    if (menu.type === 'tools') {
      return [
        { key: 'export', label: '导出连接' },
        { key: 'import', label: '导入连接' },
        { key: 'sepTools', label: '', separator: true },
        { key: 'finalshell', label: 'FinalShell 转 EasyShell' },
      ]
    }
    if (menu.type === 'folder') {
      return [
        { key: 'connectAll', label: '连接全部 SSH' },
        { key: 'newSsh', label: '新建 SSH' },
        { key: 'sep1', label: '', separator: true },
        { key: 'rename', label: '重命名目录' },
        { key: 'delete', label: '删除目录', danger: true },
      ]
    }
    return [
      { key: 'connect', label: '连接' },
      { key: 'edit', label: '编辑' },
      { key: 'rename', label: '重命名' },
      { key: 'sep1', label: '', separator: true },
      { key: 'copyAddr', label: '复制地址' },
      { key: 'copyCmd', label: '复制 SSH 命令' },
      { key: 'duplicate', label: '克隆' },
      { key: 'move', label: '移动到目录…' },
      { key: 'sep2', label: '', separator: true },
      { key: 'delete', label: '删除', danger: true },
    ]
  }, [menu])

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

  return (
    <div className="conn-tree">
      <div className="conn-toolbar">
        <button className="btn btn-ghost btn-sm" title="新建目录" onClick={onCreateFolder}>
          +目录
        </button>
        <button className="btn btn-primary btn-sm" title="新建 SSH" onClick={() => onCreateSsh()}>
          +SSH
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
            <p>暂无连接，先新建目录或 SSH</p>
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
            return (
              <div className="folder-block" key={folder}>
                <button
                  className="folder-head"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [folder]: !prev[folder] }))
                  }
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMenu({ type: 'folder', folder, x: e.clientX, y: e.clientY })
                  }}
                  title="单击展开/折叠；右键可连接全部或新建 SSH"
                >
                  <span className="folder-arrow">{open ? '▼' : '▶'}</span>
                  <span className="folder-icon" />
                  <span className="folder-name">{folder}</span>
                  <span className="folder-count">{visible.length}</span>
                </button>
                {open ? (
                  <div className="folder-children">
                    {visible.length === 0 ? (
                      <div className="conn-empty">目录为空，右键可新建 SSH</div>
                    ) : (
                      visible.map((conn) => (
                        <div
                          key={conn.id}
                          className={`conn-row ${activeConnectionId === conn.id ? 'active' : ''}`}
                          onDoubleClick={() => onConnect(conn)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setMenu({ type: 'conn', conn, x: e.clientX, y: e.clientY })
                          }}
                          title={`${conn.username}@${conn.host}:${conn.port || 22}`}
                        >
                          <span className="conn-term-icon" />
                          <div className="conn-row-main">
                            <strong>{conn.name || conn.host}</strong>
                            <small>
                              {conn.host}:{conn.port || 22} · {conn.username}
                            </small>
                          </div>
                        </div>
                      ))
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
              if (key === 'export') onExportBackup()
              if (key === 'import') onImportBackup()
              if (key === 'finalshell') onConvertFinalShell()
              return
            }
            if (menu.type === 'folder') {
              if (key === 'connectAll') onConnectFolder(menu.folder)
              if (key === 'newSsh') onCreateSsh(menu.folder)
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
    </div>
  )
}
