const fs = require('fs')
const path = require('path')

let userDataOverride = null

function getUserDataDir() {
  if (userDataOverride) return userDataOverride
  const { app } = require('electron')
  return app.getPath('userData')
}

function __setUserDataForTest(dir) {
  userDataOverride = dir
}

function getStorePath() {
  return path.join(getUserDataDir(), 'connections.json')
}

function getFoldersPath() {
  return path.join(getUserDataDir(), 'folders.json')
}

function readConnections() {
  try {
    const file = getStorePath()
    if (!fs.existsSync(file)) return []
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

function writeConnections(list) {
  const file = getStorePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8')
}

function normalizeFolderName(name) {
  return String(name || '').trim()
}

function readFolders() {
  try {
    const file = getFoldersPath()
    const fromFile = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
    const fromConns = readConnections()
      .map((c) => normalizeFolderName(c.folder))
      .filter(Boolean)
    const set = new Set([...(Array.isArray(fromFile) ? fromFile : []), ...fromConns])
    // 不再强制保留「未分组」
    set.delete('未分组')
    set.delete('')
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  } catch {
    return []
  }
}

function writeFolders(list) {
  const file = getFoldersPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const uniq = [...new Set(list.map(normalizeFolderName).filter(Boolean))].filter(
    (f) => f !== '未分组',
  )
  uniq.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  fs.writeFileSync(file, JSON.stringify(uniq, null, 2), 'utf8')
  return uniq
}

function ensureFolder(name) {
  const folder = normalizeFolderName(name)
  if (!folder || folder === '未分组') {
    throw new Error('请使用有效目录名，不能使用「未分组」')
  }
  const list = readFolders()
  if (!list.includes(folder)) {
    list.push(folder)
    writeFolders(list)
  }
  return folder
}

function renameFolder(oldName, newName) {
  const from = normalizeFolderName(oldName)
  const to = normalizeFolderName(newName)
  if (!from || !to || from === to) return readFolders()
  if (to === '未分组') throw new Error('不能命名为「未分组」')

  const folders = readFolders().map((f) => (f === from ? to : f))
  writeFolders(folders)

  const conns = readConnections().map((c) =>
    normalizeFolderName(c.folder) === from ? { ...c, folder: to } : c,
  )
  writeConnections(conns)
  return readFolders()
}

function deleteFolder(name, mode = 'delete', moveTo = '') {
  const folder = normalizeFolderName(name)
  if (!folder) throw new Error('目录名无效')

  let conns = readConnections()
  const inFolder = conns.filter((c) => normalizeFolderName(c.folder) === folder)

  if (mode === 'move') {
    const target = ensureFolder(moveTo)
    if (target === folder) throw new Error('目标目录不能与当前目录相同')
    conns = conns.map((c) =>
      normalizeFolderName(c.folder) === folder ? { ...c, folder: target } : c,
    )
  } else {
    // 删除目录时一并删除其中的连接
    conns = conns.filter((c) => normalizeFolderName(c.folder) !== folder)
  }
  writeConnections(conns)

  const folders = readFolders().filter((f) => f !== folder)
  writeFolders(folders)
  return {
    folders: readFolders(),
    connections: readConnections(),
    removedConnections: mode === 'delete' ? inFolder.length : 0,
  }
}

module.exports = {
  readConnections,
  writeConnections,
  readFolders,
  writeFolders,
  ensureFolder,
  renameFolder,
  deleteFolder,
  __setUserDataForTest,
}
