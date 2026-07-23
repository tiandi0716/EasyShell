const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { decryptFinalShellPassword } = require('./finalshell-crypto.cjs')

function walkConfigs(rootDir) {
  const results = []
  if (!fs.existsSync(rootDir)) return results

  function walk(dir, folder) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
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

function mapAuthType(type) {
  // FinalShell: 1=password, 2=key (常见约定)
  if (Number(type) === 2) return 'key'
  return 'password'
}

function importFinalShellDir(rootDir, existing = []) {
  const files = walkConfigs(rootDir)
  const byKey = new Map()
  for (const item of existing) {
    const key = `${item.folder || ''}::${item.host}:${item.port || 22}:${item.username}`
    byKey.set(key, item)
  }

  let imported = 0
  let updated = 0
  let failed = 0
  const errors = []

  for (const { file, folder } of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!raw.host) {
        failed++
        errors.push(`${file}: 缺少 host`)
        continue
      }

      let password = ''
      if (raw.password) {
        try {
          password = decryptFinalShellPassword(raw.password)
        } catch (err) {
          failed++
          errors.push(`${path.basename(file)}: 解密失败 ${err.message}`)
          continue
        }
      }

      const conn = {
        id: undefined,
        name: raw.name || raw.host,
        host: String(raw.host).trim(),
        port: Number(raw.port) || 22,
        username: raw.user_name || raw.username || 'root',
        authType: mapAuthType(raw.authentication_type),
        password,
        privateKeyPath: '',
        passphrase: '',
        remark: raw.description || '',
        folder: folder || '未分组',
        source: 'finalshell',
        sourceId: raw.id || '',
      }

      const key = `${conn.folder}::${conn.host}:${conn.port}:${conn.username}`
      const prev = byKey.get(key)
      if (prev) {
        conn.id = prev.id
        byKey.set(key, { ...prev, ...conn, id: prev.id })
        updated++
      } else {
        conn.id = randomUUID()
        byKey.set(key, conn)
        imported++
      }
    } catch (err) {
      failed++
      errors.push(`${path.basename(file)}: ${err.message}`)
    }
  }

  const list = [...byKey.values()].sort((a, b) => {
    const fa = a.folder || ''
    const fb = b.folder || ''
    if (fa !== fb) return fa.localeCompare(fb, 'zh-CN')
    return (a.name || '').localeCompare(b.name || '', 'zh-CN')
  })

  return {
    list,
    stats: {
      files: files.length,
      imported,
      updated,
      failed,
      total: list.length,
    },
    errors: errors.slice(0, 20),
  }
}

function defaultExportDir() {
  return path.join(__dirname, '../SSH')
}

module.exports = { importFinalShellDir, defaultExportDir, walkConfigs }
