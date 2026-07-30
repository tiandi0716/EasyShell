const { EventEmitter } = require('events')
const { randomUUID } = require('crypto')
const { allocFramebuffer, blitRgbaTile, snapshotFramebuffer } = require('./rdp-framebuffer.cjs')

let rdpLib = null
function getRdp() {
  if (!rdpLib) {
    // GPL：@electerm/rdpjs（node-rdpjs 分支，含 NLA）
    rdpLib = require('@electerm/rdpjs')
  }
  return rdpLib
}

function parseUser(username) {
  const s = String(username || '').trim()
  if (!s) return { domain: '', userName: 'Administrator' }
  if (s.includes('\\')) {
    const i = s.indexOf('\\')
    return { domain: s.slice(0, i), userName: s.slice(i + 1) || 'Administrator' }
  }
  if (s.includes('@')) {
    const i = s.indexOf('@')
    return { userName: s.slice(0, i) || 'Administrator', domain: s.slice(i + 1) }
  }
  return { domain: '', userName: s }
}

function asUint8(data) {
  if (!data) return new Uint8Array(0)
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return new Uint8Array(Buffer.from(data))
}

/**
 * RDP 解压后多为 BGRA，且 A 常为 0；Canvas 要 RGBA 且不透明，否则会出现黑块。
 * 同时按目标矩形裁剪（bitmap 宽高可能带对齐 padding）。
 */
function bgraToRgbaTile(data, width, height, destW, destH) {
  const src = asUint8(data)
  const outW = Math.max(1, Math.min(destW, width))
  const outH = Math.max(1, Math.min(destH, height))
  const need = width * height * 4
  if (src.byteLength < need) return null

  const out = new Uint8Array(outW * outH * 4)
  for (let y = 0; y < outH; y += 1) {
    const srcRow = y * width * 4
    const dstRow = y * outW * 4
    for (let x = 0; x < outW; x += 1) {
      const si = srcRow + x * 4
      const di = dstRow + x * 4
      out[di] = src[si + 2] // R
      out[di + 1] = src[si + 1] // G
      out[di + 2] = src[si] // B
      out[di + 3] = 255 // 强制不透明
    }
  }
  return { data: out.buffer, width: outW, height: outH }
}

class RdpSession extends EventEmitter {
  constructor(sessionId, config) {
    super()
    this.sessionId = sessionId
    this.config = config || {}
    this.client = null
    this.closed = false
    this.screen = {
      width: Math.max(640, Number(config.width) || 1024),
      height: Math.max(480, Number(config.height) || 576),
    }
    this.pendingTiles = []
    this.flushTimer = null
    this.flushIntervalMs = Math.max(8, Number(config.flushIntervalMs) || 16)
    this.startedAt = Date.now()
    this.connectedAt = 0
    this.frameCount = 0
    this.tileCount = 0
    this.bytesIn = 0
    this.lastFrameAt = 0
    this.fpsWindow = { t: Date.now(), frames: 0, fps: 0 }
    this.fb = allocFramebuffer(this.screen.width, this.screen.height)
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
    this.ensureFramebuffer()
    return snapshotFramebuffer(this.fb)
  }

  enqueueBitmap(bitmap) {
    if (this.closed) return
    // 仍压缩的帧无法画，跳过（decompress:true 下应很少见）
    if (bitmap.isCompress) return

    const destW = bitmap.destRight - bitmap.destLeft + 1
    const destH = bitmap.destBottom - bitmap.destTop + 1
    if (destW <= 0 || destH <= 0) return

    const converted = bgraToRgbaTile(
      bitmap.data,
      bitmap.width,
      bitmap.height,
      destW,
      destH,
    )
    if (!converted) return

    const tile = {
      destLeft: bitmap.destLeft,
      destTop: bitmap.destTop,
      destRight: bitmap.destLeft + converted.width - 1,
      destBottom: bitmap.destTop + converted.height - 1,
      width: converted.width,
      height: converted.height,
      data: converted.data,
    }

    // 主进程整帧缓存（切标签恢复用）
    blitRgbaTile(this.ensureFramebuffer(), tile)

    this.tileCount += 1
    this.bytesIn += converted.data.byteLength || 0
    this.lastFrameAt = Date.now()
    const win = this.fpsWindow
    win.frames += 1
    const elapsed = this.lastFrameAt - win.t
    if (elapsed >= 1000) {
      win.fps = (win.frames * 1000) / elapsed
      win.frames = 0
      win.t = this.lastFrameAt
    }

    this.pendingTiles.push(tile)

    // 积压时立刻冲刷，绝不丢帧（丢帧就会留下永久黑块）
    if (this.pendingTiles.length >= 48) {
      if (this.flushTimer != null) {
        clearTimeout(this.flushTimer)
        this.flushTimer = null
      }
      this.flushTiles()
      return
    }

    if (this.flushTimer != null) return
    this.flushTimer = setTimeout(() => this.flushTiles(), this.flushIntervalMs)
  }

  flushTiles() {
    this.flushTimer = null
    if (this.closed || !this.pendingTiles.length) return
    const tiles = this.pendingTiles
    this.pendingTiles = []
    this.frameCount += 1
    this.emit('bitmaps', tiles)
  }

  getMonitor() {
    const { domain, userName } = parseUser(this.config.username)
    const connectedMs = this.connectedAt
      ? Date.now() - this.connectedAt
      : Math.max(0, Date.now() - this.startedAt)
    return {
      kind: 'rdp',
      host: String(this.config.host || '').trim(),
      port: Number(this.config.port) || 3389,
      username: domain ? `${domain}\\${userName}` : userName,
      screen: { ...this.screen },
      connectedMs,
      frameCount: this.frameCount,
      tileCount: this.tileCount,
      bytesIn: this.bytesIn,
      fps: Math.round(this.fpsWindow.fps * 10) / 10,
      lastFrameAt: this.lastFrameAt || null,
      status: this.closed ? 'closed' : this.connectedAt ? 'connected' : 'connecting',
    }
  }

  connect() {
    const { createClient } = getRdp()
    const { domain, userName } = parseUser(this.config.username)
    const host = String(this.config.host || '').trim()
    const port = Number(this.config.port) || 3389
    if (!host) throw new Error('主机不能为空')

    const client = createClient({
      domain,
      userName,
      password: this.config.password || '',
      enablePerf: true,
      autoLogin: true,
      decompress: true,
      screen: this.screen,
      locale: 'en',
      logLevel: 'ERROR',
    })

    this.client = client

    client.on('connect', () => {
      if (this.closed) return
      this.connectedAt = Date.now()
      this.emit('ready', { screen: this.screen })
    })

    client.on('bitmap', (bitmap) => {
      if (this.closed) return
      try {
        this.enqueueBitmap({
          destLeft: bitmap.destLeft,
          destTop: bitmap.destTop,
          destRight: bitmap.destRight,
          destBottom: bitmap.destBottom,
          width: bitmap.width,
          height: bitmap.height,
          bitsPerPixel: bitmap.bitsPerPixel,
          isCompress: !!bitmap.isCompress,
          data: bitmap.data,
        })
      } catch (err) {
        this.emit('error', err)
      }
    })

    client.on('error', (err) => {
      if (this.closed) return
      this.emit('error', err instanceof Error ? err : new Error(String(err?.message || err)))
    })

    client.on('close', () => {
      if (this.closed) return
      this.closed = true
      this.emit('close')
    })

    try {
      client.connect(host, port)
    } catch (err) {
      this.closed = true
      throw err instanceof Error ? err : new Error(String(err))
    }

    return this
  }

  sendPointer(x, y, button, isPressed) {
    if (!this.client || this.closed) return
    this.client.sendPointerEvent(
      Math.max(0, Math.floor(x)),
      Math.max(0, Math.floor(y)),
      Number(button) || 0,
      !!isPressed,
    )
  }

  sendWheel(x, y, step, isNegative, isHorizontal) {
    if (!this.client || this.closed) return
    this.client.sendWheelEvent(
      Math.max(0, Math.floor(x)),
      Math.max(0, Math.floor(y)),
      Number(step) || 0,
      !!isNegative,
      !!isHorizontal,
    )
  }

  sendKey(scancode, isPressed, extended) {
    if (!this.client || this.closed) return
    this.client.sendKeyEventScancode(Number(scancode) || 0, !!isPressed, !!extended)
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pendingTiles = []
    try {
      this.client?.close()
    } catch {
      // ignore
    }
    this.client = null
    this.emit('close')
  }
}

class RdpManager {
  constructor() {
    this.sessions = new Map()
  }

  open(sessionId, config) {
    const id = sessionId || randomUUID()
    this.close(id)

    // Electron 主进程走系统 Node worker，避开 BoringSSL KEY_USAGE 问题
    const { needsExternalNode } = require('./find-node.cjs')
    let session
    if (needsExternalNode()) {
      const { BridgedRdpSession } = require('./rdp-node-bridge.cjs')
      session = new BridgedRdpSession(id, config)
    } else {
      session = new RdpSession(id, config)
    }

    this.sessions.set(id, session)
    session.on('close', () => {
      if (this.sessions.get(id) === session) this.sessions.delete(id)
    })

    const started = session.connect()
    // Bridged 的 connect 是 async；失败时抛出并清理
    if (started && typeof started.then === 'function') {
      started.catch((err) => {
        this.sessions.delete(id)
        session.emit('error', err instanceof Error ? err : new Error(String(err)))
        session.emit('close')
      })
    }
    return { sessionId: id, session }
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null
  }

  getMonitor(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('RDP 会话不存在')
    return session.getMonitor()
  }

  getFramebuffer(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('RDP 会话不存在')
    if (typeof session.getFramebuffer !== 'function') {
      throw new Error('当前会话不支持整帧快照')
    }
    return session.getFramebuffer()
  }

  close(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.close()
    this.sessions.delete(sessionId)
    return true
  }

  listOpen() {
    return [...this.sessions.keys()]
  }
}

module.exports = { RdpManager, parseUser }
