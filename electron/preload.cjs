const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('easyshell', {
  listConnections: () => ipcRenderer.invoke('connections:list'),
  saveConnection: (conn) => ipcRenderer.invoke('connections:save', conn),
  deleteConnection: (id) => ipcRenderer.invoke('connections:delete', id),
  duplicateConnection: (id) => ipcRenderer.invoke('connections:duplicate', id),
  renameConnection: (id, name) => ipcRenderer.invoke('connections:rename', { id, name }),
  moveConnection: (id, folder) => ipcRenderer.invoke('connections:move', { id, folder }),
  listFolders: () => ipcRenderer.invoke('connections:folders'),
  createFolder: (name) => ipcRenderer.invoke('connections:createFolder', name),
  renameFolder: (oldName, newName) =>
    ipcRenderer.invoke('connections:renameFolder', { oldName, newName }),
  deleteFolder: (name, mode, moveTo) =>
    ipcRenderer.invoke('connections:deleteFolder', { name, mode, moveTo }),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  importFinalShell: (dir) => ipcRenderer.invoke('connections:importFinalShell', dir),
  pickImportDir: () => ipcRenderer.invoke('connections:pickImportDir'),
  exportBackup: () => ipcRenderer.invoke('connections:exportBackup'),
  importBackup: () => ipcRenderer.invoke('connections:importBackup'),
  convertFinalShell: () => ipcRenderer.invoke('connections:convertFinalShell'),

  openSession: (payload) => ipcRenderer.invoke('ssh:open', payload),
  closeSession: (sessionId) => ipcRenderer.invoke('ssh:close', sessionId),
  listOpenSessions: () => ipcRenderer.invoke('ssh:listOpen'),
  writeSession: (sessionId, data) => ipcRenderer.send('ssh:write', { sessionId, data }),
  resizeSession: (sessionId, cols, rows) =>
    ipcRenderer.send('ssh:resize', { sessionId, cols, rows }),
  getMonitor: (sessionId) => ipcRenderer.invoke('ssh:monitor', sessionId),
  getHome: (sessionId) => ipcRenderer.invoke('ssh:home', sessionId),

  listDir: (sessionId, remotePath) =>
    ipcRenderer.invoke('sftp:list', { sessionId, remotePath }),
  download: (sessionId, remotePath) =>
    ipcRenderer.invoke('sftp:download', { sessionId, remotePath }),
  downloadToDir: (sessionId, items, localDir) =>
    ipcRenderer.invoke('sftp:downloadToDir', { sessionId, items, localDir }),
  upload: (sessionId, remotePath) =>
    ipcRenderer.invoke('sftp:upload', { sessionId, remotePath }),
  uploadPaths: (sessionId, remotePath, localPaths) =>
    ipcRenderer.invoke('sftp:uploadPaths', { sessionId, remotePath, localPaths }),
  remove: (sessionId, remotePath, isDir) =>
    ipcRenderer.invoke('sftp:remove', { sessionId, remotePath, isDir }),
  removeRecursive: (sessionId, remotePath) =>
    ipcRenderer.invoke('sftp:removeRecursive', { sessionId, remotePath }),
  mkdir: (sessionId, remotePath) =>
    ipcRenderer.invoke('sftp:mkdir', { sessionId, remotePath }),
  rename: (sessionId, fromPath, toPath) =>
    ipcRenderer.invoke('sftp:rename', { sessionId, fromPath, toPath }),
  pickDirectory: (title) => ipcRenderer.invoke('dialog:pickDirectory', title),
  prepareDrag: (sessionId, remotePath, isDir, fileName, meta) =>
    ipcRenderer.invoke('sftp:prepareDrag', {
      sessionId,
      remotePath,
      isDir,
      fileName,
      mtime: meta?.mtime,
      size: meta?.size,
    }),
  startDrag: (filePath) => ipcRenderer.sendSync('drag:start', filePath),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return file?.path || ''
    }
  },

  onSessionData: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('ssh:data', listener)
    return () => ipcRenderer.removeListener('ssh:data', listener)
  },
  onSessionClose: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('ssh:closed', listener)
    return () => ipcRenderer.removeListener('ssh:closed', listener)
  },
  onSessionError: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('ssh:error', listener)
    return () => ipcRenderer.removeListener('ssh:error', listener)
  },
})
