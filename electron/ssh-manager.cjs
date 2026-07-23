const { Client } = require('ssh2')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { modeToString, fileTypeLabel, parseMonitor, MONITOR_SCRIPT } = require('./monitor.cjs')

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
      `无法到达主机 ${host}（网络不通）。请确认 IP 是否正确、是否同一网段/已连 VPN，并在终端执行：ping ${config.host}`,
    )
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
  }

  // 避免尚未挂 listener 时 emit('error') 变成主进程 Uncaught Exception
  safeEmit(event, payload) {
    if (this.listenerCount(event) > 0) {
      this.emit(event, payload)
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false
      const done = (err) => {
        if (settled) return
        settled = true
        if (err) reject(friendlyError(err, this.config))
        else resolve()
      }

      const conn = new Client()
      this.conn = conn

      const host = String(this.config.host || '').trim()
      if (!host) {
        done(new Error('主机地址不能为空'))
        return
      }

      const auth = {
        host,
        port: Number(this.config.port) || 22,
        username: String(this.config.username || '').trim(),
        readyTimeout: Number(this.config.readyTimeout) || 30000,
        keepaliveInterval: 10000,
        tryKeyboard: false,
      }

      try {
        if (this.config.authType === 'key' && this.config.privateKeyPath) {
          auth.privateKey = fs.readFileSync(this.config.privateKeyPath)
          if (this.config.passphrase) auth.passphrase = this.config.passphrase
        } else {
          auth.password = this.config.password || ''
        }
      } catch (err) {
        done(err)
        return
      }

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
                this.safeEmit('data', data.toString('utf8'))
              })
              stream.on('close', () => {
                this.safeEmit('close')
                this.dispose()
              })
              if (stream.stderr) {
                stream.stderr.on('data', (data) => {
                  this.safeEmit('data', data.toString('utf8'))
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
          this.safeEmit('close')
        })
        .connect(auth)
    })
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
    const raw = await this.exec(MONITOR_SCRIPT, 12000)
    const parsed = parseMonitor(raw, this.monitorPrev)
    this.monitorPrev = parsed._prev
    const { _prev, ...publicData } = parsed
    return publicData
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

  download(remotePath, localPath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP 未就绪'))
        return
      }
      this.sftp.fastGet(remotePath, localPath, (err) => {
        if (err) reject(err)
        else resolve(localPath)
      })
    })
  }

  upload(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) {
        reject(new Error('SFTP 未就绪'))
        return
      }
      this.sftp.fastPut(localPath, remotePath, (err) => {
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

  async downloadRecursive(remotePath, localPath, isDir) {
    if (!isDir) {
      fs.mkdirSync(path.dirname(localPath), { recursive: true })
      return this.download(remotePath, localPath)
    }
    fs.mkdirSync(localPath, { recursive: true })
    const items = await this.listDir(remotePath)
    for (const item of items) {
      if (item.name === '..') continue
      const remoteChild = path.posix.join(remotePath, item.name)
      const localChild = path.join(localPath, item.name)
      await this.downloadRecursive(remoteChild, localChild, item.isDir)
    }
    return localPath
  }

  dispose() {
    try {
      if (this.stream) this.stream.close()
    } catch {}
    try {
      if (this.conn) this.conn.end()
    } catch {}
    this.stream = null
    this.sftp = null
    this.conn = null
    this.ready = false
  }
}

class SshManager {
  constructor() {
    this.sessions = new Map()
  }

  async open(id, config) {
    this.close(id)
    const session = new Session(id, config)
    this.sessions.set(id, session)
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
