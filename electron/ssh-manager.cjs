const { Client } = require('ssh2')
const fs = require('fs')
const net = require('net')
const path = require('path')
const { EventEmitter } = require('events')
const { SocksClient } = require('socks')
const {
  modeToString,
  fileTypeLabel,
  parseMonitor,
  MONITOR_SCRIPT,
  IP_SCRIPT,
} = require('./monitor.cjs')
const { resolveProxyForSsh } = require('./proxy.cjs')

function friendlyError(err, config) {
  const raw = err && err.message ? err.message : String(err)
  const host = `${config.host}:${Number(config.port) || 22}`
  if (/timed out while waiting for handshake/i.test(raw)) {
    return new Error(
      `连接 ${host} 握手超时。请检查：1) 主机地址是否完整（如 192.168.213.10）2) 端口是否正确 3) 本机能否访问该网段 4) 远端 sshd 是否在运行`,
    )
  }
  if (/ECONNREFUSED/i.test(raw)) {
    return new Error(`连接被拒绝：${host}，请确认 SSH 服务已启动且端口正确`)
  }
  if (/EHOSTDOWN|EHOSTUNREACH|ENETUNREACH/i.test(raw)) {
    return new Error(
      `无法到达主机 ${host}（网络不通）。请先开启 Clash/VPN，并确认 EasyShell 已开启「系统代理」；或在终端执行：ping ${config.host}`,
    )
  }
  if (/Socks|SOCKS|proxy/i.test(raw) && /ECONNREFUSED|timeout|not available/i.test(raw)) {
    return new Error(`代理不可用：${raw}。请确认 Clash/VPN 已启动（常见端口 7890）`)
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    return new Error(`无法解析主机：${config.host}`)
  }
  if (/All configured authentication methods failed/i.test(raw)) {
    return new Error('认证失败：用户名/密码或私钥不正确')
  }
  if (/Cannot parse privateKey|Encrypted private OpenSSH key/i.test(raw)) {
    return new Error('私钥无效或需要填写私钥口令')
  }
  return new Error(raw)
}

async function buildAuth(config) {
  const host = String(config.host || '').trim()
  if (!host) throw friendlyError(new Error('主机地址不能为空'), config)
  const port = Number(config.port) || 22
  const username = String(config.username || '').trim()
  const auth = {
    host,
    port,
    username,
    readyTimeout: Number(config.readyTimeout) || 30000,
    keepaliveInterval: 10000,
    tryKeyboard: config.authType !== 'key',
    family: 4,
  }
  try {
    if (config.authType === 'key') {
      if (config.privateKeyId) {
        const { getKeyPem } = require('./key-store.cjs')
        auth.privateKey = getKeyPem(config.privateKeyId)
      } else if (config.privateKeyPath) {
        auth.privateKey = fs.readFileSync(config.privateKeyPath)
      } else {
        throw new Error('未选择私钥，请在连接配置中浏览并选择私钥')
      }
      if (config.passphrase) auth.passphrase = config.passphrase
    } else {
      auth.password = config.password || ''
    }
  } catch (err) {
    throw friendlyError(err, config)
  }
  return { auth, host, port, username }
}

function bindKeyboard(conn, config, username) {
  conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
    const answers = (Array.isArray(prompts) ? prompts : []).map((p) => {
      const text = String(p?.prompt || '').toLowerCase()
      if (/user|login|name|用户/.test(text) && !/password|passphrase|口令|密码/.test(text)) {
        return username
      }
      return config.password || ''
    })
    finish(answers)
  })
}

async function attachProxy(auth, config, destHost, destPort) {
  const proxy = await resolveProxyForSsh(config)
  if (!proxy) return { auth, proxyInfo: null }
  try {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: proxy.type === 4 ? 4 : 5,
      },
      command: 'connect',
      destination: { host: destHost, port: destPort },
      timeout: Number(config.readyTimeout) || 30000,
    })
    auth.sock = socket
    return { auth, proxyInfo: `${proxy.host}:${proxy.port}` }
  } catch {
    delete auth.sock
    return { auth, proxyInfo: null }
  }
}

function connectRawClient(auth, config, username) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let settled = false
    const done = (err, value) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(value)
    }
    bindKeyboard(conn, config, username)
    conn
      .on('ready', () => done(null, conn))
      .on('error', (err) => done(err))
      .on('close', () => {
        if (!settled) done(new Error('SSH 连接已关闭'))
      })
      .connect(auth)
  })
}

class Session extends EventEmitter {
  constructor(id, config) {
    super()
    this.id = id
    this.config = config
    this.conn = null
    this.stream = null
    this.sftp = null
    this.ready = false
    this.monitorPrev = null
    this.uidMap = new Map()
    this.gidMap = new Map()
    // 终端输出缓冲：避免复制标签/新建连接时，提示符在前端挂载前被丢掉
    this.outputBuffer = ''
    this.outputBase = 0
    this.maxOutputBuffer = 256 * 1024
    this.jumpConn = null
    this.forwardServers = []
    this._finished = false
    this._localClose = false
  }

  finish(reason) {
    if (this._finished) return
    this._finished = true
    this.ready = false
    this.safeEmit('close', reason || 'lost')
    this.cleanup()
  }

  cleanup() {
    for (const item of this.forwardServers) {
      try {
        item.server.close()
      } catch {}
    }
    this.forwardServers = []
    try {
      if (this.stream) this.stream.close()
    } catch {}
    try {
      if (this.conn) this.conn.end()
    } catch {}
    try {
      if (this.jumpConn) this.jumpConn.end()
    } catch {}
    this.stream = null
    this.sftp = null
    this.conn = null
    this.jumpConn = null
    this.ready = false
  }

  // 避免尚未挂 listener 时 emit('error') 变成主进程 Uncaught Exception
  safeEmit(event, payload) {
    if (this.listenerCount(event) > 0) {
      this.emit(event, payload)
    }
  }

  pushOutput(chunk) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    if (!text) return
    const offset = this.outputBase + this.outputBuffer.length
    this.outputBuffer += text
    if (this.outputBuffer.length > this.maxOutputBuffer) {
      const drop = this.outputBuffer.length - this.maxOutputBuffer
      this.outputBuffer = this.outputBuffer.slice(drop)
      this.outputBase += drop
    }
    // 缓冲始终保留；有监听时再推送（带绝对 offset，便于前端去重）
    this.safeEmit('data', { data: text, offset })
  }

  getOutputBuffer() {
    return {
      data: this.outputBuffer,
      length: this.outputBase + this.outputBuffer.length,
      base: this.outputBase,
    }
  }

  async connect() {
    const { auth, host, port, username } = await buildAuth(this.config)
    const jumpConfig = this.config.jump && this.config.jump.host ? this.config.jump : null

    if (jumpConfig) {
      const jump = await buildAuth(jumpConfig)
      const proxied = await attachProxy(jump.auth, jumpConfig, jump.host, jump.port)
      this.proxyInfo = proxied.proxyInfo
      try {
        this.jumpConn = await connectRawClient(proxied.auth, jumpConfig, jump.username)
      } catch (err) {
        throw friendlyError(err, { ...jumpConfig, host: `跳板 ${jump.host}` })
      }
      const channel = await new Promise((resolve, reject) => {
        this.jumpConn.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
          if (err) reject(err)
          else resolve(stream)
        })
      })
      auth.sock = channel
    } else {
      const proxied = await attachProxy(auth, this.config, host, port)
      this.proxyInfo = proxied.proxyInfo
    }

    const openWithAuth = (connectAuth) =>
      new Promise((resolve, reject) => {
        let settled = false
        const done = (err) => {
          if (settled) return
          settled = true
          if (err) reject(err)
          else resolve()
        }

        const conn = new Client()
        this.conn = conn
        bindKeyboard(conn, this.config, username)

        conn
          .on('ready', () => {
            this.ready = true
            conn.shell(
              {
                term: 'xterm-256color',
                cols: this.config.cols || 120,
                rows: this.config.rows || 36,
              },
              (err, stream) => {
                if (err) {
                  done(err)
                  return
                }
                this.stream = stream
                stream.on('data', (data) => {
                  this.pushOutput(data)
                })
                stream.on('exit', () => {
                  if (!this._localClose) this._exitSeen = true
                })
                stream.on('close', () => {
                  this.finish(this._localClose ? 'local' : this._exitSeen ? 'exit' : 'lost')
                })
                if (stream.stderr) {
                  stream.stderr.on('data', (data) => {
                    this.pushOutput(data)
                  })
                }

                conn.sftp((sftpErr, sftp) => {
                  if (!sftpErr) this.sftp = sftp
                  done()
                })
              },
            )
          })
          .on('error', (err) => {
            this.safeEmit('error', friendlyError(err, this.config))
            done(err)
          })
          .on('close', () => {
            this.ready = false
            if (!settled) {
              done(new Error('SSH 连接已关闭'))
              return
            }
            this.finish(this._localClose ? 'local' : this._exitSeen ? 'exit' : 'lost')
          })
          .connect(connectAuth)
      })

    try {
      await openWithAuth(auth)
      await this.applyForwards(this.config.forwards)
      return
    } catch (err) {
      const raw = String(err && err.message ? err.message : err)
      const unreachable = /EHOSTDOWN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNREFUSED/i.test(raw)
      // 直连失败且刚才没用上代理/跳板时，再自动探测一次代理重试
      if (!auth.sock && !jumpConfig && unreachable) {
        const again = await resolveProxyForSsh({ ...this.config, proxyMode: 'system' })
        if (again) {
          try {
            const { socket } = await SocksClient.createConnection({
              proxy: {
                host: again.host,
                port: again.port,
                type: again.type === 4 ? 4 : 5,
              },
              command: 'connect',
              destination: { host, port },
              timeout: Number(this.config.readyTimeout) || 30000,
            })
            const retryAuth = { ...auth, sock: socket }
            this.proxyInfo = `${again.host}:${again.port}`
            await openWithAuth(retryAuth)
            await this.applyForwards(this.config.forwards)
            return
          } catch (retryErr) {
            throw friendlyError(retryErr, this.config)
          }
        }
      }
      throw friendlyError(err, this.config)
    }
  }

  write(data) {
    if (this.stream) this.stream.write(data)
  }

  resize(cols, rows) {
    if (this.stream) this.stream.setWindow(rows, cols, 0, 0)
  }

  exec(command, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.conn || !this.ready) {
        reject(new Error('SSH 未连接'))
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('命令执行超时'))
        }
      }, timeoutMs)

      this.conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          reject(err)
          return
        }
        stream.on('data', (data) => {
          stdout += data.toString('utf8')
        })
        stream.stderr.on('data', (data) => {
          stderr += data.toString('utf8')
        })
        stream.on('close', (code) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (code && !stdout) reject(new Error(stderr || `命令退出码 ${code}`))
          else resolve(stdout)
        })
      })
    })
  }

  async ensureNameMaps() {
    if (this.uidMap.size) return
    try {
      const passwd = await this.exec('cut -d: -f1,3 /etc/passwd', 8000)
      for (const line of passwd.split('\n')) {
        const [name, uid] = line.split(':')
        if (name && uid) this.uidMap.set(Number(uid), name)
      }
    } catch {}
    try {
      const group = await this.exec('cut -d: -f1,3 /etc/group', 8000)
      for (const line of group.split('\n')) {
        const [name, gid] = line.split(':')
        if (name && gid) this.gidMap.set(Number(gid), name)
      }
    } catch {}
  }

  async getMonitor() {
    // Prevent concurrent monitor execs — high-latency links accumulate channels if polls overlap
    if (this._monitorRunning) {
      return this._lastMonitorData || null
    }
    this._monitorRunning = true
    try {
      // 网卡 IP 很少变，ESXi 上 esxcli 还要几百毫秒：首次采集后每分钟刷新一次
      const withIps = !this._ipsAt || Date.now() - this._ipsAt > 60000
      const raw = await this.exec(withIps ? `${MONITOR_SCRIPT}; ${IP_SCRIPT}` : MONITOR_SCRIPT, 12000)
      if (withIps) this._ipsAt = Date.now()
      const parsed = parseMonitor(raw, this.monitorPrev)
      this.monitorPrev = parsed._prev
      const { _prev, ...publicData } = parsed
      this._lastMonitorData = publicData
      return publicData
    } finally {
      this._monitorRunning = false
    }
  }

  async listDir(remotePath) {
    if (!this.sftp) throw new Error('SFTP 未就绪')
    await this.ensureNameMaps()
    return new Promise((resolve, reject) => {
      this.sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(err)
          return
        }
        const items = list
          .map((item) => {
            const mode = item.attrs.mode || 0
            const isDir = (mode & 0o40000) === 0o40000
            const uid = item.attrs.uid
            const gid = item.attrs.gid
            return {
              name: item.filename,
              isDir,
              size: item.attrs.size || 0,
              mtime: item.attrs.mtime || 0,
              mode,
              permissions: modeToString(mode),
              type: fileTypeLabel(mode, isDir),
              owner: this.uidMap.get(uid) || String(uid ?? ''),
              group: this.gidMap.get(gid) || String(gid ?? ''),
            }
          })
          .filter((item) => item.name !== '.')
          .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
            return a.name.localeCompare(b.name)
          })
        resolve(items)
      })
    })
  }

  download(remotePath, localPath, onProgress) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP 未就绪'))
        return
      }
      const opts = {}
      if (typeof onProgress === 'function') {
        opts.step = (transferred, _chunk, total) => {
          onProgress(transferred, total)
        }
      }
      this.sftp.fastGet(remotePath, localPath, opts, (err) => {
        if (err) reject(err)
        else resolve(localPath)
      })
    })
  }

  upload(localPath, remotePath, onProgress) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP 未就绪'))
        return
      }
      const opts = {}
      if (typeof onProgress === 'function') {
        opts.step = (transferred, _chunk, total) => {
          onProgress(transferred, total)
        }
      }
      this.sftp.fastPut(localPath, remotePath, opts, (err) => {
        if (err) reject(err)
        else resolve(remotePath)
      })
    })
  }

  remove(remotePath, isDir) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP 未就绪'))
        return
      }
      const fn = isDir ? this.sftp.rmdir.bind(this.sftp) : this.sftp.unlink.bind(this.sftp)
      fn(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  mkdir(remotePath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP 未就绪'))
        return
      }
      this.sftp.mkdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  rename(fromPath, toPath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP 未就绪'))
        return
      }
      this.sftp.rename(fromPath, toPath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async removeForce(remotePath) {
    const escaped = String(remotePath).replace(/'/g, `'\"'\"'`)
    await this.exec(`rm -rf -- '${escaped}'`, 60000)
  }

  async removeRecursive(remotePath) {
    return this.removeForce(remotePath)
  }

  async downloadRecursive(remotePath, localPath, isDir, onFile) {
    if (!isDir) {
      fs.mkdirSync(path.dirname(localPath), { recursive: true })
      const name = path.basename(localPath)
      const notify =
        typeof onFile === 'function'
          ? (transferred, total) => onFile({ name, localPath, remotePath, transferred, total, phase: 'progress' })
          : undefined
      if (typeof onFile === 'function') onFile({ name, localPath, remotePath, phase: 'start' })
      try {
        await this.download(remotePath, localPath, notify)
        if (typeof onFile === 'function') onFile({ name, localPath, remotePath, phase: 'done' })
      } catch (err) {
        if (typeof onFile === 'function') onFile({ name, localPath, remotePath, phase: 'error', error: err })
        throw err
      }
      return localPath
    }
    fs.mkdirSync(localPath, { recursive: true })
    const items = await this.listDir(remotePath)
    for (const item of items) {
      if (item.name === '..') continue
      const remoteChild = path.posix.join(remotePath, item.name)
      const localChild = path.join(localPath, item.name)
      await this.downloadRecursive(remoteChild, localChild, item.isDir, onFile)
    }
    return localPath
  }

  async ensureDir(remotePath) {
    if (!remotePath || remotePath === '/' || remotePath === '.') return
    try {
      await this.mkdir(remotePath)
    } catch (err) {
      // ssh2: 4=Failure, 11=File already exists；部分服务仅返回文案
      if (err && (err.code === 4 || err.code === 11)) return
      const msg = String(err?.message || err)
      if (/exist|EXIST|Failure|file exists/i.test(msg)) return
      throw err
    }
  }

  async uploadRecursive(localPath, remotePath, onFile) {
    const stat = fs.statSync(localPath)
    if (!stat.isDirectory()) {
      const name = path.basename(localPath)
      const notify =
        typeof onFile === 'function'
          ? (transferred, total) => onFile({ name, localPath, remotePath, transferred, total, phase: 'progress' })
          : undefined
      if (typeof onFile === 'function') onFile({ name, localPath, remotePath, phase: 'start', total: stat.size })
      try {
        await this.upload(localPath, remotePath, notify)
        if (typeof onFile === 'function') onFile({ name, localPath, remotePath, phase: 'done' })
      } catch (err) {
        if (typeof onFile === 'function') onFile({ name, localPath, remotePath, phase: 'error', error: err })
        throw err
      }
      return remotePath
    }
    await this.ensureDir(remotePath)
    const entries = fs.readdirSync(localPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue
      const localChild = path.join(localPath, entry.name)
      const remoteChild = path.posix.join(remotePath, entry.name)
      await this.uploadRecursive(localChild, remoteChild, onFile)
    }
    return remotePath
  }

  stat(remotePath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP 未就绪'))
        return
      }
      this.sftp.stat(remotePath, (err, attrs) => {
        if (err) reject(err)
        else resolve(attrs)
      })
    })
  }

  listForwards() {
    return this.forwardServers.map((item) => ({
      listenPort: item.listenPort,
      destHost: item.destHost,
      destPort: item.destPort,
      status: item.status,
      error: item.error || null,
    }))
  }

  async setForwards(rules) {
    this.config.forwards = Array.isArray(rules) ? rules : []
    if (this.ready) await this.applyForwards(this.config.forwards)
    return this.listForwards()
  }

  clearForwards() {
    for (const item of this.forwardServers) {
      try {
        item.server.close()
      } catch {}
    }
    this.forwardServers = []
  }

  startForward(rule) {
    const listenPort = Number(rule.listenPort)
    const destHost = String(rule.destHost || '127.0.0.1').trim() || '127.0.0.1'
    const destPort = Number(rule.destPort)
    if (!listenPort || listenPort < 1 || listenPort > 65535 || !destPort) {
      return Promise.resolve({
        listenPort,
        destHost,
        destPort,
        status: 'error',
        error: '端口无效',
      })
    }
    return new Promise((resolve) => {
      const server = net.createServer((sock) => {
        if (!this.conn || !this.ready) {
          sock.destroy()
          return
        }
        this.conn.forwardOut('127.0.0.1', 0, destHost, destPort, (err, stream) => {
          if (err) {
            sock.destroy()
            return
          }
          sock.pipe(stream)
          stream.pipe(sock)
          sock.on('close', () => {
            try {
              stream.end()
            } catch {}
          })
          stream.on('close', () => {
            try {
              sock.end()
            } catch {}
          })
        })
      })
      const entry = { listenPort, destHost, destPort, status: 'starting', error: null, server }
      this.forwardServers.push(entry)
      server.on('error', (err) => {
        entry.status = 'error'
        entry.error = err.message || String(err)
        resolve({
          listenPort,
          destHost,
          destPort,
          status: entry.status,
          error: entry.error,
        })
      })
      server.listen(listenPort, '127.0.0.1', () => {
        entry.status = 'listening'
        resolve({
          listenPort,
          destHost,
          destPort,
          status: 'listening',
          error: null,
        })
      })
    })
  }

  async applyForwards(rules) {
    this.clearForwards()
    const list = Array.isArray(rules) ? rules : []
    for (const rule of list) {
      await this.startForward(rule)
    }
    return this.listForwards()
  }

  dispose() {
    this._localClose = true
    this.finish('local')
  }
}

class SshManager {
  constructor() {
    this.sessions = new Map()
  }

  create(id, config) {
    this.close(id)
    const session = new Session(id, config)
    this.sessions.set(id, session)
    return session
  }

  async open(id, config) {
    const session = this.create(id, config)
    try {
      await session.connect()
      return session
    } catch (err) {
      this.close(id)
      throw err
    }
  }

  get(id) {
    return this.sessions.get(id)
  }

  listOpen() {
    return [...this.sessions.values()]
      .filter((session) => session.ready)
      .map((session) => {
        const cfg = session.config || {}
        return {
          sessionId: session.id,
          title: cfg.name || cfg.host || session.id,
          connectionId: cfg.id || undefined,
          host: cfg.host || '',
          username: cfg.username || '',
          status: 'ready',
        }
      })
  }

  close(id) {
    const session = this.sessions.get(id)
    if (session) {
      session.dispose()
      this.sessions.delete(id)
    }
  }

  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}

module.exports = { SshManager, pathJoin: path.posix.join }
