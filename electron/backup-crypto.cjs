const CryptoJS = require('crypto-js')
const { randomUUID } = require('crypto')

const BACKUP_MAGIC = 'EASYSHELL_BACKUP_V1'

/**
 * 导出/导入共用口令（异或混淆，避免源码明文检索）。
 * 加解密算法仍为 CryptoJS AES（与之前一致）。
 */
function getSharedSecret() {
  const mask = 0x5a
  const enc = [
    0x31, 0x35, 0x3b, 0x1a, 0x68, 0x6a, 0x68, 0x6c, 0x6a, 0x6d, 0x68, 0x69, 0x1a, 0x29, 0x29,
    0x32,
  ]
  return Buffer.from(enc.map((b) => b ^ mask)).toString('utf8')
}

function encryptPassword(plain) {
  if (!plain) return ''
  return CryptoJS.AES.encrypt(String(plain), getSharedSecret()).toString()
}

function decryptPassword(cipherText) {
  if (!cipherText) return ''
  const raw = String(cipherText).trim().replace(/^EASYSHELL_AES:/, '')
  const bytes = CryptoJS.AES.decrypt(raw, getSharedSecret())
  const text = bytes.toString(CryptoJS.enc.Utf8)
  if (!text) throw new Error('密码解密失败')
  return text
}

function encryptBackup(payload) {
  const body = {
    magic: BACKUP_MAGIC,
    version: 1,
    exportedAt: new Date().toISOString(),
    ...payload,
  }
  return CryptoJS.AES.encrypt(JSON.stringify(body), getSharedSecret()).toString()
}

function decryptBackup(cipherText) {
  const raw = String(cipherText || '').trim()
  if (!raw) throw new Error('备份文件为空')
  let text = ''
  try {
    const bytes = CryptoJS.AES.decrypt(raw, getSharedSecret())
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
  BACKUP_MAGIC,
  encryptBackup,
  decryptBackup,
  encryptPassword,
  decryptPassword,
  mergeBackup,
  getSharedSecret,
}
