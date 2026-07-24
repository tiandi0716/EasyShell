const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { encryptPassword, decryptPassword } = require('./backup-crypto.cjs')

function safeName(name) {
  return String(name || 'unnamed')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'unnamed'
}

function shortId(seed) {
  if (seed && /^[a-z0-9]{8,24}$/i.test(String(seed))) return String(seed)
  return randomUUID().replace(/-/g, '').slice(0, 16)
}

function toFinalShellShape(conn) {
  const now = Date.now()
  const authType = conn.authType === 'key' ? 2 : 1
  const isRdp = conn.connType === 'rdp'
  return {
    id: shortId(conn.sourceId || conn.id),
    parent_id: shortId(`folder-${conn.folder || 'root'}`),
    name: conn.name || conn.host,
    host: conn.host,
    port: Number(conn.port) || (isRdp ? 3389 : 22),
    user_name: conn.username || (isRdp ? 'Administrator' : 'root'),
    password: encryptPassword(conn.password || ''),
    authentication_type: authType,
    secret_key_id: conn.privateKeyId || '',
    private_key_id: conn.privateKeyId || '',
    private_key_path: conn.privateKeyPath || '',
    passphrase: conn.passphrase ? encryptPassword(conn.passphrase) : '',
    proxy_id: '0',
    // 100=SSH，102=Windows RDP（EasyShell 扩展）
    conection_type: isRdp ? 102 : 100,
    conn_type: isRdp ? 'rdp' : 'ssh',
    description: conn.remark || '',
    terminal_encoding: 'UTF-8',
    create_time: now,
    modified_time: now,
    access_time: now,
    rename_time: now,
    delete_time: 0,
    sort_time: 0,
    parent_update_time: 0,
    order: 0,
    width: 0,
    height: 0,
    custom_size: false,
    fullscreen: false,
    accelerate: false,
    drivestoredirect: true,
    exec_channel_enable: true,
    forwarding_auto_reconnect: false,
    backspace_key_sequence: 2,
    delete_key_sequence: 0,
    port_forwarding_list: [],
    remote_port_forwarding: {},
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function uniqueFilePath(dir, baseName) {
  let file = path.join(dir, `${baseName}_connect_config.json`)
  if (!fs.existsSync(file)) return file
  let i = 2
  while (fs.existsSync(path.join(dir, `${baseName}_${i}_connect_config.json`))) i += 1
  return path.join(dir, `${baseName}_${i}_connect_config.json`)
}

const KEYS_FILE = 'easyshell_private_keys.json'

/** 按 FinalShell 目录结构导出；密码字段为 AES；私钥写入根目录清单 */
function exportConnectionsToDir(rootDir, connections, folders = [], privateKeys = []) {
  ensureDir(rootDir)
  const folderSet = new Set(
    [...folders, ...connections.map((c) => c.folder)].filter((f) => f && f !== '未分组'),
  )
  for (const folder of folderSet) {
    ensureDir(path.join(rootDir, ...String(folder).split('/').map(safeName)))
  }

  let written = 0
  for (const conn of connections) {
    if (!conn?.host) continue
    const folder = conn.folder && conn.folder !== '未分组' ? conn.folder : ''
    const dir = folder
      ? path.join(rootDir, ...String(folder).split('/').map(safeName))
      : rootDir
    ensureDir(dir)
    const base = safeName(conn.name || conn.host)
    const filePath = uniqueFilePath(dir, base)
    fs.writeFileSync(filePath, JSON.stringify(toFinalShellShape(conn), null, 2), 'utf8')
    written += 1
  }

  let keysWritten = 0
  if (Array.isArray(privateKeys) && privateKeys.length) {
    const keysPath = path.join(rootDir, KEYS_FILE)
    fs.writeFileSync(keysPath, JSON.stringify(privateKeys, null, 2), 'utf8')
    keysWritten = privateKeys.length
  }

  return {
    dir: rootDir,
    connections: written,
    folders: folderSet.size,
    keys: keysWritten,
  }
}

function readExportedKeys(rootDir) {
  const file = path.join(rootDir, KEYS_FILE)
  if (!fs.existsSync(file)) return []
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function walkConnectConfigs(rootDir) {
  const results = []
  if (!fs.existsSync(rootDir)) return results

  function walk(dir, folder) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, folder ? `${folder}/${entry.name}` : entry.name)
      } else if (entry.isFile() && entry.name.endsWith('_connect_config.json')) {
        results.push({ file: full, folder })
      }
    }
  }

  walk(rootDir, '')
  return results
}

function fromFinalShellShape(raw, folder) {
  let password = ''
  let passphrase = ''
  if (raw.password) password = decryptPassword(raw.password)
  if (raw.passphrase) {
    try {
      passphrase = decryptPassword(raw.passphrase)
    } catch {
      passphrase = ''
    }
  }

  const isRdp =
    raw.conn_type === 'rdp' ||
    Number(raw.conection_type) === 102 ||
    Number(raw.connection_type) === 102
  return {
    id: randomUUID(),
    connType: isRdp ? 'rdp' : 'ssh',
    name: raw.name || raw.host,
    host: String(raw.host || '').trim(),
    port: Number(raw.port) || (isRdp ? 3389 : 22),
    username: raw.user_name || raw.username || (isRdp ? 'Administrator' : 'root'),
    authType: Number(raw.authentication_type) === 2 ? 'key' : 'password',
    password,
    privateKeyId: raw.private_key_id || raw.secret_key_id || '',
    privateKeyPath: raw.private_key_path || '',
    passphrase,
    remark: raw.description || '',
    folder: folder || '',
    source: 'easyshell-export',
    sourceId: raw.id || '',
  }
}

function connKey(c) {
  return `${c.folder || ''}|${c.host}|${Number(c.port) || 22}|${c.username || ''}`
}

/** 从 EasyShell 分目录导出中导入（AES 密码） */
function importConnectionsFromDir(rootDir, existing = []) {
  const files = walkConnectConfigs(rootDir)
  const byId = new Map()
  const byKey = new Map()
  for (const item of existing) {
    if (item.id) byId.set(item.id, item)
    byKey.set(connKey(item), item)
  }

  let imported = 0
  let updated = 0
  let failed = 0
  const errors = []

  for (const { file, folder } of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!raw.host) {
        failed += 1
        errors.push(`${path.basename(file)}: 缺少 host`)
        continue
      }
      const next = fromFinalShellShape(raw, folder && folder !== '未分组' ? folder : '')
      if (next.folder === '未分组') next.folder = ''

      const old =
        (next.sourceId && [...byId.values()].find((c) => c.sourceId === next.sourceId)) ||
        byKey.get(connKey(next))
      if (old) {
        const merged = { ...old, ...next, id: old.id }
        byId.set(merged.id, merged)
        byKey.set(connKey(merged), merged)
        updated += 1
      } else {
        byId.set(next.id, next)
        byKey.set(connKey(next), next)
        imported += 1
      }
    } catch (err) {
      failed += 1
      errors.push(`${path.basename(file)}: ${err.message}`)
    }
  }

  const list = [...byId.values()].sort((a, b) => {
    const fa = a.folder || ''
    const fb = b.folder || ''
    if (fa !== fb) return fa.localeCompare(fb, 'zh-CN')
    return (a.name || a.host || '').localeCompare(b.name || b.host || '', 'zh-CN')
  })

  const folderSet = new Set(
    [...existing.map((c) => c.folder), ...list.map((c) => c.folder)].filter(
      (f) => f && f !== '未分组',
    ),
  )

  return {
    connections: list,
    folders: [...folderSet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    files: files.length,
    imported,
    updated,
    failed,
    total: list.length,
    errors: errors.slice(0, 20),
  }
}

module.exports = {
  encryptPassword,
  decryptPassword,
  exportConnectionsToDir,
  importConnectionsFromDir,
  walkConnectConfigs,
  readExportedKeys,
  KEYS_FILE,
}
