const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('easyshell', {
  platform: process.platform,
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
  exportBackup: (options) => ipcRenderer.invoke('connections:exportBackup', options || {}),
  importBackup: () => ipcRenderer.invoke('connections:importBackup'),
  convertFinalShell: () => ipcRenderer.invoke('connections:convertFinalShell'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  openRdpExternal: (config) => ipcRenderer.invoke('rdp:openExternal', config),
  openRdpSession: (payload) => ipcRenderer.invoke('rdp:open', payload),
  closeRdpSession: (sessionId) => ipcRenderer.invoke('rdp:close', sessionId),
  getRdpMonitor: (sessionId) => ipcRenderer.invoke('rdp:monitor', sessionId),
  getRdpFramebuffer: (sessionId) => ipcRenderer.invoke('rdp:framebuffer', sessionId),
  rdpPointer: (sessionId, x, y, button, isPressed) =>
    ipcRenderer.send('rdp:pointer', { sessionId, x, y, button, isPressed }),
  rdpWheel: (sessionId, x, y, step, isNegative, isHorizontal) =>
    ipcRenderer.send('rdp:wheel', {
      sessionId,
      x,
      y,
      step,
      isNegative,
      isHorizontal,
    }),
  rdpKey: (sessionId, scancode, isPressed, extended) =>
    ipcRenderer.send('rdp:key', { sessionId, scancode, isPressed, extended }),
  onRdpBitmaps: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('rdp:bitmaps', listener)
    return () => ipcRenderer.removeListener('rdp:bitmaps', listener)
  },
  /** @deprecated 兼容旧单帧接口 */
  onRdpBitmap: (cb) => {
    const listener = (_e, payload) => {
      if (payload?.tiles) {
        for (const tile of payload.tiles) cb({ sessionId: payload.sessionId, ...tile })
        return
      }
      cb(payload)
    }
    ipcRenderer.on('rdp:bitmaps', listener)
    ipcRenderer.on('rdp:bitmap', listener)
    return () => {
      ipcRenderer.removeListener('rdp:bitmaps', listener)
      ipcRenderer.removeListener('rdp:bitmap', listener)
    }
  },
  onRdpReady: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('rdp:ready', listener)
    return () => ipcRenderer.removeListener('rdp:ready', listener)
  },
  onRdpClose: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('rdp:closed', listener)
    return () => ipcRenderer.removeListener('rdp:closed', listener)
  },
  onRdpError: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('rdp:error', listener)
    return () => ipcRenderer.removeListener('rdp:error', listener)
  },

  listKeys: () => ipcRenderer.invoke('keys:list'),
  getKeyInfo: (id) => ipcRenderer.invoke('keys:get', id),
  importKey: () => ipcRenderer.invoke('keys:import'),
  renameKey: (id, name) => ipcRenderer.invoke('keys:rename', { id, name }),
  deleteKey: (id) => ipcRenderer.invoke('keys:delete', id),

  openSession: (payload) => ipcRenderer.invoke('ssh:open', payload),
  closeSession: (sessionId) => ipcRenderer.invoke('ssh:close', sessionId),
  listOpenSessions: () => ipcRenderer.invoke('ssh:listOpen'),
  getSessionOutput: (sessionId) => ipcRenderer.invoke('ssh:getOutput', sessionId),
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
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return file?.path || ''
    }
  },
  listTransfers: () => ipcRenderer.invoke('transfer:list'),
  clearFinishedTransfers: () => ipcRenderer.invoke('transfer:clearFinished'),
  clearTransfer: (id) => ipcRenderer.invoke('transfer:clear', id),
  listLocalDir: (dirPath) => ipcRenderer.invoke('fs:listLocal', dirPath),
  getSpecialDirs: () => ipcRenderer.invoke('fs:specialDirs'),
  getParentDir: (dirPath) => ipcRenderer.invoke('fs:parentDir', dirPath),
  onTransferUpdate: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('transfer:update', listener)
    return () => ipcRenderer.removeListener('transfer:update', listener)
  },
  onTransferRemove: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('transfer:remove', listener)
    return () => ipcRenderer.removeListener('transfer:remove', listener)
  },
  onTransferClear: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('transfer:clear', listener)
    return () => ipcRenderer.removeListener('transfer:clear', listener)
  },
  onTransferSnapshot: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('transfer:snapshot', listener)
    return () => ipcRenderer.removeListener('transfer:snapshot', listener)
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
