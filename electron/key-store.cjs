const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { encryptPassword, decryptPassword } = require('./backup-crypto.cjs')

function getKeysPath() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'private-keys.json')
}

function readKeysRaw() {
  try {
    const file = getKeysPath()
    if (!fs.existsSync(file)) return []
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeKeysRaw(list) {
  const file = getKeysPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8')
}

function detectKeyMeta(pem) {
  const text = String(pem || '')
  let keyType = 'KEY'
  let bits = 0
  if (/BEGIN OPENSSH PRIVATE KEY/i.test(text)) {
    if (/ssh-ed25519/i.test(text) || text.includes('ed25519')) keyType = 'ED25519'
    else if (/ecdsa/i.test(text)) keyType = 'ECDSA'
    else keyType = 'OPENSSH'
  } else if (/BEGIN RSA PRIVATE KEY/i.test(text) || /BEGIN PRIVATE KEY/i.test(text)) {
    keyType = 'RSA'
    // 粗略估算：PEM 体量越大位数越高
    const body = text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    if (body.length > 2200) bits = 4096
    else if (body.length > 1100) bits = 2048
    else if (body.length > 600) bits = 1024
  } else if (/BEGIN EC PRIVATE KEY/i.test(text)) {
    keyType = 'EC'
  }
  return { keyType, bits }
}

function toPublicView(item) {
  if (!item) return null
  return {
    id: item.id,
    name: item.name,
    keyType: item.keyType || 'KEY',
    bits: item.bits || 0,
    createdAt: item.createdAt || 0,
  }
}

function listKeys() {
  return readKeysRaw()
    .map(toPublicView)
    .filter(Boolean)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'))
}

function getKeyById(id) {
  return readKeysRaw().find((k) => k.id === id) || null
}

function getKeyPem(id) {
  const item = getKeyById(id)
  if (!item?.data) throw new Error('私钥不存在')
  return decryptPassword(item.data)
}

function importKeyFromFile(filePath, name) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('私钥文件不存在')
  const pem = fs.readFileSync(filePath, 'utf8')
  if (!/BEGIN [\w\s]+PRIVATE KEY/i.test(pem)) {
    throw new Error('不是有效的私钥文件')
  }
  const baseName = path.basename(filePath).replace(/\.(pem|key|rsa|ppk)$/i, '')
  const displayName = String(name || baseName || '未命名密钥').trim() || '未命名密钥'
  const meta = detectKeyMeta(pem)
  const list = readKeysRaw()
  // 同名覆盖内容
  const existing = list.find((k) => k.name === displayName)
  if (existing) {
    existing.data = encryptPassword(pem)
    existing.keyType = meta.keyType
    existing.bits = meta.bits
    existing.updatedAt = Date.now()
    writeKeysRaw(list)
    return toPublicView(existing)
  }
  const item = {
    id: randomUUID(),
    name: displayName,
    keyType: meta.keyType,
    bits: meta.bits,
    data: encryptPassword(pem),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  list.push(item)
  writeKeysRaw(list)
  return toPublicView(item)
}

function renameKey(id, name) {
  const list = readKeysRaw()
  const item = list.find((k) => k.id === id)
  if (!item) throw new Error('私钥不存在')
  const next = String(name || '').trim()
  if (!next) throw new Error('名称不能为空')
  if (list.some((k) => k.id !== id && k.name === next)) {
    throw new Error('已存在同名私钥')
  }
  item.name = next
  item.updatedAt = Date.now()
  writeKeysRaw(list)
  return toPublicView(item)
}

function deleteKey(id) {
  const list = readKeysRaw().filter((k) => k.id !== id)
  writeKeysRaw(list)
  return true
}

/** 导出用：返回含密文 data 的完整列表 */
function exportKeys() {
  return readKeysRaw().map((k) => ({
    id: k.id,
    name: k.name,
    keyType: k.keyType,
    bits: k.bits,
    data: k.data,
    createdAt: k.createdAt,
  }))
}

/** 导入密钥列表（合并：同 id 更新，同名更新，否则新增） */
function importKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) {
    return { imported: 0, updated: 0 }
  }
  const list = readKeysRaw()
  const byId = new Map(list.map((k) => [k.id, k]))
  const byName = new Map(list.map((k) => [k.name, k]))
  let imported = 0
  let updated = 0

  for (const item of keys) {
    if (!item?.data || !item?.name) continue
    // data 已是导出时的密文，直接保存；若是明文 PEM 则再加密
    let data = item.data
    if (/BEGIN [\w\s]+PRIVATE KEY/i.test(String(data))) {
      data = encryptPassword(String(data))
    }
    const old = (item.id && byId.get(item.id)) || byName.get(item.name)
    if (old) {
      old.name = item.name
      old.keyType = item.keyType || old.keyType
      old.bits = item.bits || old.bits
      old.data = data
      old.updatedAt = Date.now()
      updated += 1
    } else {
      const next = {
        id: item.id || randomUUID(),
        name: item.name,
        keyType: item.keyType || 'KEY',
        bits: item.bits || 0,
        data,
        createdAt: item.createdAt || Date.now(),
        updatedAt: Date.now(),
      }
      list.push(next)
      byId.set(next.id, next)
      byName.set(next.name, next)
      imported += 1
    }
  }
  writeKeysRaw(list)
  return { imported, updated, total: list.length }
}

module.exports = {
  listKeys,
  getKeyById,
  getKeyPem,
  importKeyFromFile,
  renameKey,
  deleteKey,
  exportKeys,
  importKeys,
  detectKeyMeta,
  toPublicView,
}
