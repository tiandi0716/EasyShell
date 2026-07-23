const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const net = require('net')

function getSettingsPath() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettings() {
  try {
    const file = getSettingsPath()
    if (!fs.existsSync(file)) return {}
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch {
    return {}
  }
}

function writeSettings(partial) {
  const next = { ...readSettings(), ...partial }
  const file = getSettingsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}

function parseProxyUrl(env) {
  if (!env) return null
  try {
    const u = new URL(env.includes('://') ? env : `socks5://${env}`)
    const port = Number(u.port) || 1080
    if (!u.hostname || !port) return null
    return {
      type: u.protocol.startsWith('socks4') ? 4 : 5,
      host: u.hostname,
      port,
      source: 'env',
    }
  } catch {
    return null
  }
}

function portOpen(host, port, timeoutMs = 200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (ok) => {
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** 读取 macOS / 环境变量中的系统 SOCKS 代理（Clash 等） */
async function detectSystemSocksProxy() {
  const fromEnv = parseProxyUrl(
    process.env.ALL_PROXY ||
      process.env.all_proxy ||
      process.env.SOCKS_PROXY ||
      process.env.socks_proxy,
  )
  if (fromEnv) return fromEnv

  if (process.platform === 'darwin') {
    try {
      const out = execSync('scutil --proxy', { encoding: 'utf8', timeout: 2000 })
      const socksEnable = /SOCKSEnable\s*:\s*1/.test(out)
      const httpEnable = /HTTPEnable\s*:\s*1/.test(out)
      const socksHost = (out.match(/SOCKSProxy\s*:\s*(\S+)/) || [])[1]
      const socksPort = Number((out.match(/SOCKSPort\s*:\s*(\d+)/) || [])[1])
      const httpHost = (out.match(/HTTPProxy\s*:\s*(\S+)/) || [])[1]
      const httpPort = Number((out.match(/HTTPPort\s*:\s*(\d+)/) || [])[1])

      if (socksEnable && socksHost && socksPort) {
        return { type: 5, host: socksHost, port: socksPort, source: 'system-socks' }
      }
      // Clash 混合端口：HTTP 代理口通常也支持 SOCKS5
      if (httpEnable && httpHost && httpPort) {
        return { type: 5, host: httpHost, port: httpPort, source: 'system-http-as-socks' }
      }
    } catch {
      /* ignore */
    }
  }

  for (const c of [
    { host: '127.0.0.1', port: 7890 },
    { host: '127.0.0.1', port: 7891 },
    { host: '127.0.0.1', port: 1080 },
  ]) {
    if (await portOpen(c.host, c.port)) {
      return { type: 5, host: c.host, port: c.port, source: 'local-probe' }
    }
  }

  return null
}

async function resolveProxyForSsh(config = {}) {
  // 连接显式关闭代理 → 直连
  if (config.proxyMode === 'none') return null

  if (config.proxyMode === 'socks5' && config.proxyHost && config.proxyPort) {
    return {
      type: 5,
      host: String(config.proxyHost).trim(),
      port: Number(config.proxyPort) || 7890,
      source: 'connection',
    }
  }

  // 自动识别：有系统/本地 SOCKS（Clash 等）就走代理，没有则直连（无需开关）
  return detectSystemSocksProxy()
}

module.exports = {
  readSettings,
  writeSettings,
  detectSystemSocksProxy,
  resolveProxyForSsh,
}
