const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { randomUUID } = require('crypto')
const { SshManager } = require('./ssh-manager.cjs')
const {
  readConnections,
  writeConnections,
  readFolders,
  writeFolders,
  ensureFolder,
  renameFolder,
  deleteFolder,
} = require('./store.cjs')
const { importFinalShellDir, defaultExportDir } = require('./import-finalshell.cjs')
const {
  exportConnectionsToDir,
  importConnectionsFromDir,
} = require('./easyshell-dir-io.cjs')
const {
  readSettings,
  writeSettings,
  detectSystemSocksProxy,
} = require('./proxy.cjs')

const isDev = process.env.EASY_SHELL_DEV === '1'
const ssh = new SshManager()
let mainWindow = null

// SSH 超时等异常不应弹出 Electron 原生崩溃框
process.on('uncaughtException', (err) => {
  console.error('[easyshell] uncaughtException:', err)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ssh:error', {
      sessionId: '',
      message: err.message || String(err),
    })
  }
})

process.on('unhandledRejection', (err) => {
  console.error('[easyshell] unhandledRejection:', err)
})

function setupAppMenu() {
  const viewSubmenu = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ]
  // 不提供 Cmd+R 刷新（会清掉 SSH 会话）；开发模式可用强制刷新 / 开发者工具
  if (isDev) {
    viewSubmenu.unshift(
      { role: 'forceReload', accelerator: 'CmdOrCtrl+Shift+R' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
    )
  }

  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '显示',
      submenu: viewSubmenu,
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'EasyShell',
    backgroundColor: '#eceff3',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 拦截 Cmd/Ctrl+R、F5（开发模式可用 Cmd+Shift+R 强制刷新）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = String(input.key || '').toLowerCase()
    const mod = input.meta || input.control
    if (key === 'f5') {
      event.preventDefault()
      return
    }
    if (key === 'r' && mod && !input.alt && !input.shift) {
      event.preventDefault()
    }
  })

  // 刷新后 SSH 会话保留在主进程，由渲染进程 listOpenSessions 恢复标签

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  setupAppMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ssh.closeAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  ssh.closeAll()
})

ipcMain.handle('connections:list', () => readConnections())

ipcMain.handle('settings:get', async () => {
  const settings = readSettings()
  const proxy = await detectSystemSocksProxy()
  return {
    useSystemProxy: settings.useSystemProxy !== false,
    detectedProxy: proxy ? `${proxy.host}:${proxy.port}` : null,
  }
})

ipcMain.handle('settings:set', (_e, partial) => {
  const next = writeSettings(partial || {})
  return {
    useSystemProxy: next.useSystemProxy !== false,
  }
})

ipcMain.handle('connections:save', (_e, conn) => {
  const list = readConnections()
  conn.folder = ensureFolder(conn.folder || '未分组')
  if (conn.id) {
    const idx = list.findIndex((item) => item.id === conn.id)
    if (idx >= 0) list[idx] = conn
    else list.push(conn)
  } else {
    conn.id = randomUUID()
    list.push(conn)
  }
  writeConnections(list)
  return conn
})

ipcMain.handle('connections:delete', (_e, id) => {
  const list = readConnections().filter((item) => item.id !== id)
  writeConnections(list)
  return true
})

ipcMain.handle('connections:duplicate', (_e, id) => {
  const list = readConnections()
  const src = list.find((item) => item.id === id)
  if (!src) throw new Error('连接不存在')
  const copy = {
    ...src,
    id: randomUUID(),
    name: `${src.name || src.host}-副本`,
  }
  list.push(copy)
  writeConnections(list)
  return copy
})

ipcMain.handle('connections:rename', (_e, { id, name }) => {
  const list = readConnections()
  const idx = list.findIndex((item) => item.id === id)
  if (idx < 0) throw new Error('连接不存在')
  list[idx] = { ...list[idx], name: String(name || '').trim() || list[idx].name }
  writeConnections(list)
  return list[idx]
})

ipcMain.handle('connections:move', (_e, { id, folder }) => {
  const list = readConnections()
  const idx = list.findIndex((item) => item.id === id)
  if (idx < 0) throw new Error('连接不存在')
  list[idx] = { ...list[idx], folder: ensureFolder(folder) }
  writeConnections(list)
  return list[idx]
})

ipcMain.handle('connections:folders', () => readFolders())

ipcMain.handle('connections:createFolder', (_e, name) => {
  return ensureFolder(name)
})

ipcMain.handle('connections:renameFolder', (_e, { oldName, newName }) => {
  return renameFolder(oldName, newName)
})

ipcMain.handle('connections:deleteFolder', (_e, { name, mode, moveTo }) => {
  return deleteFolder(name, mode || 'delete', moveTo || '')
})

ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text || ''))
  return true
})

ipcMain.handle('connections:importFinalShell', (_e, customDir) => {
  const dir = customDir || defaultExportDir()
  const existing = readConnections()
  const result = importFinalShellDir(dir, existing)
  writeConnections(result.list)
  writeFolders(result.list.map((c) => c.folder || '未分组'))
  return {
    dir,
    ...result.stats,
    errors: result.errors,
  }
})

ipcMain.handle('connections:pickImportDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择 FinalShell 导出目录（含各分组文件夹）',
    defaultPath: defaultExportDir(),
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('connections:exportBackup', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: '选择导出目录（将按分组目录写出连接）',
    message: '导出为与 FinalShell 相同的分目录结构',
    buttonLabel: '保存',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: app.getPath('documents'),
  })
  if (picked.canceled || !picked.filePaths[0]) return null

  const destDir = picked.filePaths[0]
  const connections = readConnections()
  const folders = readFolders()
  const result = exportConnectionsToDir(destDir, connections, folders)
  return {
    path: result.dir,
    filePath: result.dir,
    connections: result.connections,
    folders: result.folders,
  }
})

ipcMain.handle('connections:importBackup', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: '选择 EasyShell 连接目录（分目录结构）',
    message: '选择包含分组子目录与 *_connect_config.json 的导出目录',
    properties: ['openDirectory'],
    defaultPath: app.getPath('documents'),
  })
  if (picked.canceled || !picked.filePaths[0]) return null

  const dir = picked.filePaths[0]
  const merged = importConnectionsFromDir(dir, readConnections())
  if (!merged.files) {
    throw new Error('该目录下未找到连接配置（*_connect_config.json）')
  }
  writeConnections(merged.connections)
  writeFolders(merged.folders)
  return {
    path: dir,
    filePath: dir,
    imported: merged.imported,
    updated: merged.updated,
    total: merged.total,
    folders: merged.folders.length,
    failed: merged.failed,
    errors: merged.errors,
  }
})

ipcMain.handle('connections:convertFinalShell', async () => {
  const source = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '① 选择 FinalShell 配置目录',
    message: '请选择 FinalShell 导出/配置根目录（内含分组子目录）',
    defaultPath: defaultExportDir(),
  })
  if (source.canceled || !source.filePaths[0]) return null
  const sourceDir = source.filePaths[0]

  const result = importFinalShellDir(sourceDir, [])
  if (!result.list.length) {
    throw new Error(
      result.errors?.length
        ? `未转换出有效连接：${result.errors.slice(0, 3).join('；')}`
        : '该目录下未找到 FinalShell 连接配置（*_connect_config.json）',
    )
  }

  const folders = [
    ...new Set(result.list.map((c) => c.folder).filter((f) => f && f !== '未分组')),
  ].sort((a, b) => a.localeCompare(b, 'zh-CN'))

  // 等源目录对话框完全关闭后再弹保存目录，避免 macOS 上连弹两个对话框错乱
  await new Promise((r) => setTimeout(r, 120))

  const dest = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: '② 选择 EasyShell 保存目录',
    message: '转换结果将按分组目录写入此文件夹',
    buttonLabel: '保存',
    defaultPath: app.getPath('documents'),
  })
  if (dest.canceled || !dest.filePaths[0]) return null
  const destDir = dest.filePaths[0]

  if (path.resolve(destDir) === path.resolve(sourceDir)) {
    throw new Error('保存目录不能与 FinalShell 源目录相同，请另选一个空目录')
  }

  const written = exportConnectionsToDir(destDir, result.list, folders)
  const converted = written.connections
  return {
    sourceDir,
    destDir,
    filePath: destDir,
    path: destDir,
    files: result.stats.files,
    converted,
    total: converted,
    imported: converted,
    folderCount: written.folders,
    failed: result.stats.failed,
    errors: result.errors,
  }
})

ipcMain.handle('ssh:open', async (_e, { sessionId, config }) => {
  const id = sessionId || randomUUID()
  try {
    const session = await ssh.open(id, config)
    session.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ssh:data', { sessionId: id, data })
      }
    })
    session.on('close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ssh:closed', { sessionId: id })
      }
      ssh.close(id)
    })
    session.on('error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ssh:error', {
          sessionId: id,
          message: err.message || String(err),
        })
      }
    })
    return { sessionId: id }
  } catch (err) {
    ssh.close(id)
    throw new Error(err.message || String(err))
  }
})

ipcMain.handle('ssh:close', (_e, sessionId) => {
  ssh.close(sessionId)
  return true
})

ipcMain.handle('ssh:listOpen', () => ssh.listOpen())

ipcMain.on('ssh:write', (_e, { sessionId, data }) => {
  const session = ssh.get(sessionId)
  if (session) session.write(data)
})

ipcMain.on('ssh:resize', (_e, { sessionId, cols, rows }) => {
  const session = ssh.get(sessionId)
  if (session) session.resize(cols, rows)
})

ipcMain.handle('sftp:list', async (_e, { sessionId, remotePath }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  return session.listDir(remotePath || '.')
})

ipcMain.handle('ssh:monitor', async (_e, sessionId) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  return session.getMonitor()
})

ipcMain.handle('ssh:home', async (_e, sessionId) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  try {
    const home = (await session.exec('echo $HOME', 5000)).trim()
    return home || '/'
  } catch {
    return '/'
  }
})

ipcMain.handle('sftp:download', async (_e, { sessionId, remotePath }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.basename(remotePath),
  })
  if (result.canceled || !result.filePath) return null
  await session.download(remotePath, result.filePath)
  return result.filePath
})

ipcMain.handle('sftp:downloadToDir', async (_e, { sessionId, items, localDir }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')

  let targetDir = localDir
  if (!targetDir) {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择本地下载目录',
    })
    if (result.canceled || !result.filePaths[0]) return null
    targetDir = result.filePaths[0]
  }

  fs.mkdirSync(targetDir, { recursive: true })
  const saved = []
  for (const item of items || []) {
    const remotePath = item.remotePath
    const localPath = path.join(targetDir, path.basename(remotePath))
    await session.downloadRecursive(remotePath, localPath, !!item.isDir)
    saved.push(localPath)
  }
  return { dir: targetDir, files: saved }
})

ipcMain.handle('sftp:upload', async (_e, { sessionId, remotePath }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled || !result.filePaths.length) return []
  const uploaded = []
  for (const localPath of result.filePaths) {
    const target = path.posix.join(remotePath || '.', path.basename(localPath))
    await session.upload(localPath, target)
    uploaded.push(target)
  }
  return uploaded
})

ipcMain.handle('sftp:uploadPaths', async (_e, { sessionId, remotePath, localPaths }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  const uploaded = []
  for (const localPath of localPaths || []) {
    if (!localPath || !fs.existsSync(localPath)) continue
    const stat = fs.statSync(localPath)
    if (stat.isDirectory()) continue
    const target = path.posix.join(remotePath || '.', path.basename(localPath))
    await session.upload(localPath, target)
    uploaded.push(target)
  }
  return uploaded
})

ipcMain.handle('sftp:remove', async (_e, { sessionId, remotePath, isDir }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  await session.remove(remotePath, isDir)
  return true
})

ipcMain.handle('sftp:removeRecursive', async (_e, { sessionId, remotePath }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  await session.removeRecursive(remotePath)
  return true
})

ipcMain.handle('sftp:mkdir', async (_e, { sessionId, remotePath }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  await session.mkdir(remotePath)
  return true
})

ipcMain.handle('sftp:rename', async (_e, { sessionId, fromPath, toPath }) => {
  const session = ssh.get(sessionId)
  if (!session) throw new Error('会话不存在')
  await session.rename(fromPath, toPath)
  return true
})

ipcMain.handle('dialog:pickDirectory', async (_e, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: title || '选择目录',
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

const dragFileCache = new Map()

function getDragIcon() {
  const iconPath = path.join(__dirname, 'drag-icon.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  if (icon.isEmpty()) return nativeImage.createEmpty()
  return icon.resize({ width: 32, height: 32 })
}

ipcMain.handle(
  'sftp:prepareDrag',
  async (_e, { sessionId, remotePath, isDir, fileName, mtime, size }) => {
    const session = ssh.get(sessionId)
    if (!session) throw new Error('会话不存在')
    const cacheKey = [sessionId, remotePath, mtime || 0, size || 0, isDir ? 1 : 0].join('\0')
    const cached = dragFileCache.get(cacheKey)
    if (cached && fs.existsSync(cached)) return cached

    const tempRoot = path.join(os.tmpdir(), 'easyshell-drag', randomUUID())
    fs.mkdirSync(tempRoot, { recursive: true })
    const localPath = path.join(tempRoot, fileName || path.basename(remotePath))
    await session.downloadRecursive(remotePath, localPath, !!isDir)
    dragFileCache.set(cacheKey, localPath)
    return localPath
  },
)

ipcMain.on('drag:start', (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    event.returnValue = false
    return
  }
  try {
    event.sender.startDrag({
      file: filePath,
      icon: getDragIcon(),
    })
    event.returnValue = true
  } catch (err) {
    console.error('startDrag failed', err)
    event.returnValue = false
  }
})
