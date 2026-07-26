const { randomUUID } = require('crypto')

/** 上传/下载进度中心：向渲染进程推送 transfer:update */
function createTransferHub(getWindow) {
  const transfers = new Map()

  function emit(item) {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('transfer:update', { ...item })
    }
  }

  function start({ name, direction, sessionId, localPath, remotePath }) {
    const id = randomUUID()
    const item = {
      id,
      name: name || 'file',
      direction, // 'upload' | 'download'
      sessionId: sessionId || '',
      localPath: localPath || '',
      remotePath: remotePath || '',
      transferred: 0,
      total: 0,
      percent: 0,
      status: 'active', // active | done | error
      error: null,
      updatedAt: Date.now(),
    }
    transfers.set(id, item)
    // 保留最近记录，避免无限增长
    if (transfers.size > 120) {
      const sorted = [...transfers.values()].sort((a, b) => a.updatedAt - b.updatedAt)
      for (const old of sorted) {
        if (transfers.size <= 100) break
        if (old.status !== 'active') transfers.delete(old.id)
      }
    }
    emit(item)
    return id
  }

  function progress(id, transferred, total) {
    const item = transfers.get(id)
    if (!item || item.status !== 'active') return
    item.transferred = transferred
    if (total > 0) item.total = total
    const nextPercent = item.total
      ? Math.min(100, Math.round((transferred / item.total) * 100))
      : item.percent
    const now = Date.now()
    // 节流：进度变化或间隔达到阈值再推送
    if (nextPercent === item.percent && now - item.updatedAt < 100 && transferred < (item.total || Infinity)) {
      return
    }
    item.percent = nextPercent
    item.updatedAt = now
    emit(item)
  }

  function done(id, error) {
    const item = transfers.get(id)
    if (!item) return
    item.status = error ? 'error' : 'done'
    item.error = error ? String(error) : null
    if (!error) {
      item.percent = 100
      if (item.total > 0) item.transferred = item.total
    }
    item.updatedAt = Date.now()
    emit(item)
  }

  function clear(id) {
    if (id) {
      transfers.delete(id)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('transfer:remove', { id })
      }
      return
    }
    transfers.clear()
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('transfer:clear')
    }
  }

  function clearFinished() {
    for (const [id, item] of transfers) {
      if (item.status === 'done' || item.status === 'error') {
        transfers.delete(id)
      }
    }
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('transfer:snapshot', list())
    }
  }

  function list() {
    return [...transfers.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  return { start, progress, done, clear, clearFinished, list }
}

module.exports = { createTransferHub }
