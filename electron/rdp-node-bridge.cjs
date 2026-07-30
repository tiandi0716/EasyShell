const { EventEmitter } = require('events')
const { fork } = require('child_process')
const path = require('path')
const fs = require('fs')
const { findSystemNode } = require('./find-node.cjs')
const {
  allocFramebuffer,
  blitRgbaTile,
  snapshotFramebuffer,
} = require('./rdp-framebuffer.cjs')

function resolveWorkerScript() {
  let script = path.join(__dirname, 'rdp-session-worker.cjs')
  // 系统 Node 读不了 asar，必须走 unpacked
  if (script.includes(`${path.sep}app.asar${path.sep}`)) {
    const unpacked = script.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    if (fs.existsSync(unpacked)) script = unpacked
  }
  return script
}

function formatTlsHint(message) {
  const raw = String(message || '')
  if (/KEY_USAGE_BIT_INCORRECT/i.test(raw)) {
    return (
      '远程桌面 TLS 握手失败（Windows 证书 Key Usage 与 Electron BoringSSL 不兼容）。' +
      '请安装系统 Node.js 后重试，或改用「外部远程桌面」。'
    )
  }
  return raw
}

/** 把 worker IPC 过来的像素数据还原成 ArrayBuffer */
function restoreTileData(data) {
  if (!data) return new ArrayBuffer(0)
  if (data instanceof ArrayBuffer) return data
  if (Buffer.isBuffer(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }
  // 旧版 JSON 序列化残留：{ type:'Buffer', data:number[] }
  if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
    return Uint8Array.from(data.data).buffer
  }
  if (Array.isArray(data)) return Uint8Array.from(data).buffer
  if (typeof data === 'string') return Buffer.from(data, 'base64').buffer
  return new ArrayBuffer(0)
}

function normalizeTiles(tiles) {
  if (!Array.isArray(tiles)) return []
  return tiles.map((tile) => ({
    ...tile,
    data: restoreTileData(tile?.data),
  }))
}

class RdpWorkerHost {
  constructor() {
    this.child = null
    this.nodePath = null
    this.sessions = new Map()
    this.starting = null
  }

  async ensure() {
    if (this.child && !this.child.killed) return this.child
    if (this.starting) return this.starting

    this.starting = (async () => {
      const nodePath = findSystemNode()
      if (!nodePath) {
        throw new Error(
          '内嵌远程桌面需要系统 Node.js（Electron 自带 BoringSSL 无法连接部分 Windows 主机）。' +
            '请安装 Node.js（https://nodejs.org）或使用 Homebrew：brew install node',
        )
      }
      this.nodePath = nodePath
      const workerScript = resolveWorkerScript()
      if (!fs.existsSync(workerScript)) {
        throw new Error(`RDP worker 脚本不存在：${workerScript}`)
      }

      // 让 worker 能 require 到 unpacked 的 @electerm/rdpjs
      const moduleRoots = []
      const unpackedModules = workerScript.includes('app.asar.unpacked')
        ? path.join(path.dirname(path.dirname(workerScript)), 'node_modules')
        : path.join(path.dirname(__dirname), 'node_modules')
      if (fs.existsSync(unpackedModules)) moduleRoots.push(unpackedModules)

      const child = fork(workerScript, [], {
        execPath: nodePath,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        // 必须 advanced：默认 JSON 序列化会把 ArrayBuffer 弄成空对象，画面全黑
        serialization: 'advanced',
        env: {
          ...process.env,
          EASYSHELL_RDP_WORKER: '1',
          // 避免继承 Electron 相关变量干扰
          ELECTRON_RUN_AS_NODE: '',
          NODE_PATH: moduleRoots.join(path.delimiter),
        },
      })

      child.on('message', (msg) => this.onMessage(msg))
      child.on('exit', () => {
        this.child = null
        for (const session of this.sessions.values()) {
          session.handleWorkerExit()
        }
        this.sessions.clear()
      })
      child.stderr?.on('data', (buf) => {
        const text = String(buf || '').trim()
        if (text) console.error('[rdp-worker]', text)
      })

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          try {
            child.kill()
          } catch {
            /* ignore */
          }
          reject(new Error('RDP worker 启动超时'))
        }, 8000)

        const onMsg = (msg) => {
          if (msg?.evt === 'worker-ready') {
            cleanup()
            resolve()
          }
        }
        const onExit = (code) => {
          cleanup()
          reject(new Error(`RDP worker 异常退出（code=${code}）`))
        }
        const cleanup = () => {
          clearTimeout(timer)
          child.off('message', onMsg)
          child.off('exit', onExit)
        }
        child.on('message', onMsg)
        child.on('exit', onExit)
      })

      this.child = child
      return child
    })()

    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  onMessage(msg) {
    if (!msg || typeof msg !== 'object') return
    const session = msg.sessionId ? this.sessions.get(msg.sessionId) : null
    if (!session) return

    if (msg.evt === 'opened') {
      session.onOpened(msg.screen)
    } else if (msg.evt === 'ready') {
      session.connectedAt = Date.now()
      session.emit('ready', { screen: msg.screen || session.screen })
    } else if (msg.evt === 'bitmaps') {
      const tiles = normalizeTiles(msg.tiles || [])
      session.noteBitmaps(tiles)
      session.emit('bitmaps', tiles)
    } else if (msg.evt === 'error') {
      session.emit('error', new Error(formatTlsHint(msg.message)))
    } else if (msg.evt === 'close') {
      session.handleRemoteClose()
    } else if (msg.evt === 'monitor') {
      session.resolveMonitor?.(msg.data)
    }
  }

  async open(sessionId, config, session) {
    const child = await this.ensure()
    this.sessions.set(sessionId, session)
    child.send({ cmd: 'open', sessionId, config })
  }

  send(sessionId, payload) {
    if (!this.child || this.child.killed) return
    this.child.send({ ...payload, sessionId })
  }

  unregister(sessionId) {
    this.sessions.delete(sessionId)
    if (!this.sessions.size && this.child && !this.child.killed) {
      // 保持 worker 热复用，不立刻杀；进程退出时自然清理
    }
  }
}

const sharedHost = new RdpWorkerHost()

/**
 * 外观与 RdpSession 一致，实际在系统 Node 子进程里跑 @electerm/rdpjs。
 */
class BridgedRdpSession extends EventEmitter {
  constructor(sessionId, config) {
    super()
    this.sessionId = sessionId
    this.config = config || {}
    this.closed = false
    this.screen = {
      width: Math.max(640, Number(config.width) || 1024),
      height: Math.max(480, Number(config.height) || 576),
    }
    this.connectedAt = 0
    this.startedAt = Date.now()
    this.frameCount = 0
    this.tileCount = 0
    this.bytesIn = 0
    this.lastFrameAt = 0
    this.fpsWindow = { t: Date.now(), frames: 0, fps: 0 }
    this.fb = allocFramebuffer(this.screen.width, this.screen.height)
    this._openedResolve = null
    this._openedReject = null
    this._openedPromise = new Promise((resolve, reject) => {
      this._openedResolve = resolve
      this._openedReject = reject
    })
    // 防止未 await 时 UnhandledRejection
    this._openedPromise.catch(() => {})
  }

  /** 供 main 在挂好监听后再等待 worker 接受会话 */
  waitUntilOpened() {
    return this._openedPromise
  }

  ensureFramebuffer() {
    if (
      !this.fb ||
      this.fb.width !== this.screen.width ||
      this.fb.height !== this.screen.height
    ) {
      this.fb = allocFramebuffer(this.screen.width, this.screen.height)
    }
    return this.fb
  }

  getFramebuffer() {
    return snapshotFramebuffer(this.ensureFramebuffer())
  }

  noteBitmaps(tiles) {
    const list = Array.isArray(tiles) ? tiles : []
    const fb = this.ensureFramebuffer()
    this.frameCount += 1
    this.tileCount += list.length
    this.lastFrameAt = Date.now()
    for (const tile of list) {
      blitRgbaTile(fb, tile)
      const d = tile?.data
      if (d instanceof ArrayBuffer) this.bytesIn += d.byteLength
      else if (Buffer.isBuffer(d)) this.bytesIn += d.length
      else if (d && typeof d.byteLength === 'number') this.bytesIn += d.byteLength
      else if (d && Array.isArray(d.data)) this.bytesIn += d.data.length
    }
    const win = this.fpsWindow
    win.frames += 1
    const elapsed = this.lastFrameAt - win.t
    if (elapsed >= 1000) {
      win.fps = (win.frames * 1000) / elapsed
      win.frames = 0
      win.t = this.lastFrameAt
    }
  }

  async connect() {
    // 让调用方有机会先挂上 ready/error/close 监听
    await new Promise((r) => setImmediate(r))
    try {
      await sharedHost.open(
        this.sessionId,
        {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          width: this.screen.width,
          height: this.screen.height,
          flushIntervalMs: this.config.flushIntervalMs,
        },
        this,
      )
    } catch (err) {
      this.closed = true
      sharedHost.unregister(this.sessionId)
      const error = err instanceof Error ? err : new Error(String(err))
      this._openedReject?.(error)
      throw error
    }
    return this
  }

  onOpened(screen) {
    if (screen?.width && screen?.height) {
      const changed =
        screen.width !== this.screen.width || screen.height !== this.screen.height
      this.screen = { ...screen }
      if (changed) this.fb = allocFramebuffer(this.screen.width, this.screen.height)
    }
    this._openedResolve?.(this.screen)
  }

  handleRemoteClose() {
    if (this.closed) return
    this.closed = true
    sharedHost.unregister(this.sessionId)
    this._openedReject?.(new Error('远程桌面已断开'))
    this.emit('close')
  }

  handleWorkerExit() {
    if (this.closed) return
    this.closed = true
    const err = new Error('RDP worker 进程已退出')
    this._openedReject?.(err)
    this.emit('error', err)
    this.emit('close')
  }

  sendPointer(x, y, button, isPressed) {
    if (this.closed) return
    sharedHost.send(this.sessionId, { cmd: 'pointer', x, y, button, isPressed })
  }

  sendWheel(x, y, step, isNegative, isHorizontal) {
    if (this.closed) return
    sharedHost.send(this.sessionId, {
      cmd: 'wheel',
      x,
      y,
      step,
      isNegative,
      isHorizontal,
    })
  }

  sendKey(scancode, isPressed, extended) {
    if (this.closed) return
    sharedHost.send(this.sessionId, { cmd: 'key', scancode, isPressed, extended })
  }

  getMonitor() {
    const user = String(this.config.username || '').trim() || 'Administrator'
    return {
      kind: 'rdp',
      host: String(this.config.host || '').trim(),
      port: Number(this.config.port) || 3389,
      username: user,
      screen: { ...this.screen },
      connectedMs: this.connectedAt
        ? Date.now() - this.connectedAt
        : Math.max(0, Date.now() - this.startedAt),
      frameCount: this.frameCount,
      tileCount: this.tileCount,
      bytesIn: this.bytesIn,
      fps: Math.round(this.fpsWindow.fps * 10) / 10,
      lastFrameAt: this.lastFrameAt || null,
      status: this.closed ? 'closed' : this.connectedAt ? 'connected' : 'connecting',
      runtime: 'node-worker',
      nodePath: sharedHost.nodePath || null,
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    sharedHost.send(this.sessionId, { cmd: 'close' })
    sharedHost.unregister(this.sessionId)
    this.emit('close')
  }
}

module.exports = {
  BridgedRdpSession,
  sharedHost,
  formatTlsHint,
  resolveWorkerScript,
}
