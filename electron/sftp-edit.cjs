const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const MAX_BYTES = 10 * 1024 * 1024
/** sessionId + '\\0' + remotePath -> watch */
const watches = new Map()

function sendStatus(getWindow, payload) {
  const win = typeof getWindow === 'function' ? getWindow() : getWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send('sftp:editStatus', payload)
  }
}

function safeLocalName(remotePath) {
  const trimmed = String(remotePath || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
  return trimmed || 'file'
}

function openInEditor(localPath) {
  if (process.platform === 'darwin') {
    spawn('open', ['-t', localPath], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.platform === 'win32') {
    spawn('notepad.exe', [localPath], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn('xdg-open', [localPath], { detached: true, stdio: 'ignore' }).unref()
}

function stopWatch(key) {
  const item = watches.get(key)
  if (!item) return
  try {
    fs.unwatchFile(item.localPath)
  } catch {}
  watches.delete(key)
}

function cleanupSession(sessionId) {
  for (const [key, item] of [...watches.entries()]) {
    if (item.sessionId === sessionId) stopWatch(key)
  }
}

function cleanupAll() {
  for (const key of [...watches.keys()]) stopWatch(key)
}

async function openForEdit({ session, sessionId, remotePath, bindFileTransfer, getWindow }) {
  if (!session) throw new Error('会话不存在')
  const remote = String(remotePath || '')
  if (!remote) throw new Error('缺少远程路径')

  let size = 0
  try {
    const attrs = await session.stat(remote)
    size = Number(attrs?.size || 0)
  } catch {
    size = 0
  }
  if (size > MAX_BYTES) {
    throw new Error('文件超过 10MB，请下载后编辑')
  }

  const dir = path.join(os.tmpdir(), 'easyshell-edit', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const base = path.basename(remote) || 'untitled'
  const localPath = path.join(dir, safeLocalName(remote))
  const onDown = bindFileTransfer(sessionId, 'download')

  onDown({ phase: 'start', name: base, localPath, remotePath: remote, total: size })
  try {
    await session.download(remote, localPath, (transferred, total) => {
      onDown({ phase: 'progress', name: base, localPath, remotePath: remote, transferred, total })
    })
    const st = fs.statSync(localPath)
    if (st.size > MAX_BYTES) {
      fs.unlinkSync(localPath)
      throw new Error('文件超过 10MB，请下载后编辑')
    }
    onDown({ phase: 'done', name: base, localPath, remotePath: remote })
  } catch (err) {
    onDown({ phase: 'error', name: base, localPath, remotePath: remote, error: err })
    throw err
  }

  openInEditor(localPath)

  const key = `${sessionId}\0${remote}`
  stopWatch(key)

  const state = {
    sessionId,
    remotePath: remote,
    localPath,
    uploading: false,
    dirty: false,
  }

  const upload = async () => {
    if (state.uploading) {
      state.dirty = true
      return
    }
    state.uploading = true
    sendStatus(getWindow, { sessionId, remotePath: remote, status: 'uploading', localPath })
    const onUp = bindFileTransfer(sessionId, 'upload')
    const total = fs.existsSync(localPath) ? fs.statSync(localPath).size : 0
    onUp({ phase: 'start', name: base, localPath, remotePath: remote, total })
    try {
      await session.upload(localPath, remote, (transferred, t) => {
        onUp({ phase: 'progress', name: base, localPath, remotePath: remote, transferred, total: t })
      })
      onUp({ phase: 'done', name: base, localPath, remotePath: remote })
      sendStatus(getWindow, { sessionId, remotePath: remote, status: 'saved', localPath })
    } catch (err) {
      onUp({ phase: 'error', name: base, localPath, remotePath: remote, error: err })
      sendStatus(getWindow, {
        sessionId,
        remotePath: remote,
        status: 'error',
        message: err.message || String(err),
        localPath,
      })
    } finally {
      state.uploading = false
      if (state.dirty) {
        state.dirty = false
        void upload()
      }
    }
  }

  fs.watchFile(localPath, { interval: 1000 }, (curr, prev) => {
    if (!watches.has(key)) return
    if (curr.mtimeMs <= prev.mtimeMs) return
    void upload()
  })
  watches.set(key, state)

  sendStatus(getWindow, { sessionId, remotePath: remote, status: 'opened', localPath })
  return { localPath }
}

module.exports = {
  openForEdit,
  cleanupSession,
  cleanupAll,
  MAX_BYTES,
}
