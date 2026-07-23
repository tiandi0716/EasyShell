const CryptoJS = require('crypto-js')
const { randomUUID } = require('crypto')

/** EasyShell 导入导出共用密钥 */
const BACKUP_PASSWORD = 'koa@20260723@ssh'
const BACKUP_MAGIC = 'EASYSHELL_BACKUP_V1'

function encryptBackup(payload) {
  const body = {
    magic: BACKUP_MAGIC,
    version: 1,
    exportedAt: new Date().toISOString(),
    ...payload,
  }
  return CryptoJS.AES.encrypt(JSON.stringify(body), BACKUP_PASSWORD).toString()
}

function decryptBackup(cipherText) {
  const raw = String(cipherText || '').trim()
  if (!raw) throw new Error('备份文件为空')
  let text = ''
  try {
    const bytes = CryptoJS.AES.decrypt(raw, BACKUP_PASSWORD)
    text = bytes.toString(CryptoJS.enc.Utf8)
  } catch {
    throw new Error('解密失败，文件可能已损坏')
  }
  if (!text) throw new Error('解密失败，不是有效的 EasyShell 备份')
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('备份内容不是合法 JSON')
  }
  if (!data || data.magic !== BACKUP_MAGIC) {
    throw new Error('不是 EasyShell 备份文件')
  }
  return data
}

function connKey(c) {
  return `${c.host || ''}|${Number(c.port) || 22}|${c.username || ''}|${c.folder || ''}`
}

function mergeBackup(existingConnections, existingFolders, backup) {
  const connections = Array.isArray(backup.connections) ? backup.connections : []
  const folders = Array.isArray(backup.folders) ? backup.folders : []

  const byId = new Map()
  const byKey = new Map()
  for (const c of existingConnections) {
    if (c.id) byId.set(c.id, c)
    byKey.set(connKey(c), c)
  }

  let imported = 0
  let updated = 0
  for (const item of connections) {
    if (!item || !item.host) continue
    const next = {
      ...item,
      id: item.id || randomUUID(),
      port: Number(item.port) || 22,
      folder: item.folder && item.folder !== '未分组' ? item.folder : item.folder || '',
    }
    if (next.folder === '未分组') next.folder = ''

    const old = (next.id && byId.get(next.id)) || byKey.get(connKey(next))
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
  }

  const list = [...byId.values()].sort((a, b) => {
    const fa = a.folder || ''
    const fb = b.folder || ''
    if (fa !== fb) return fa.localeCompare(fb, 'zh-CN')
    return (a.name || a.host || '').localeCompare(b.name || b.host || '', 'zh-CN')
  })

  const folderSet = new Set(
    [...existingFolders, ...folders, ...list.map((c) => c.folder)].filter(
      (f) => f && f !== '未分组',
    ),
  )

  return {
    connections: list,
    folders: [...folderSet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    imported,
    updated,
    total: list.length,
  }
}

module.exports = {
  BACKUP_PASSWORD,
  BACKUP_MAGIC,
  encryptBackup,
  decryptBackup,
  mergeBackup,
}
