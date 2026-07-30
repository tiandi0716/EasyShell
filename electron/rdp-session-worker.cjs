/**
 * 在系统 Node（OpenSSL）中运行 RDP，规避 Electron BoringSSL 的
 * KEY_USAGE_BIT_INCORRECT（部分 Windows 自签 RDP 证书会触发）。
 *
 * 协议（IPC）：
 *   parent -> worker: { cmd, ... }
 *   worker -> parent: { evt, ... }
 */
process.env.EASYSHELL_RDP_WORKER = '1'

const { RdpManager } = require('./rdp-manager.cjs')

const manager = new RdpManager()
/** @type {Map<string, import('events').EventEmitter>} */
const wired = new Map()

function send(msg) {
  if (typeof process.send === 'function') process.send(msg)
}

function wireSession(sessionId, session) {
  if (wired.has(sessionId)) return
  wired.set(sessionId, session)

  session.on('ready', (payload) => {
    send({ evt: 'ready', sessionId, ...payload })
  })
  session.on('bitmaps', (tiles) => {
    send({ evt: 'bitmaps', sessionId, tiles })
  })
  session.on('error', (err) => {
    send({
      evt: 'error',
      sessionId,
      message: err instanceof Error ? err.message : String(err?.message || err),
    })
  })
  session.on('close', () => {
    wired.delete(sessionId)
    send({ evt: 'close', sessionId })
  })
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return
  const { cmd, sessionId } = msg

  try {
    if (cmd === 'open') {
      const id = sessionId || msg.id
      const { session } = manager.open(id, msg.config || {})
      wireSession(id, session)
      send({ evt: 'opened', sessionId: id, screen: session.screen })
      return
    }

    const session = manager.get(sessionId)
    if (!session) return

    if (cmd === 'pointer') {
      session.sendPointer(msg.x, msg.y, msg.button, msg.isPressed)
    } else if (cmd === 'wheel') {
      session.sendWheel(msg.x, msg.y, msg.step, msg.isNegative, msg.isHorizontal)
    } else if (cmd === 'key') {
      session.sendKey(msg.scancode, msg.isPressed, msg.extended)
    } else if (cmd === 'close') {
      manager.close(sessionId)
    } else if (cmd === 'monitor') {
      send({ evt: 'monitor', sessionId, data: session.getMonitor() })
    }
  } catch (err) {
    send({
      evt: 'error',
      sessionId: sessionId || null,
      message: err instanceof Error ? err.message : String(err),
    })
  }
})

process.on('disconnect', () => {
  for (const id of manager.listOpen()) manager.close(id)
  process.exit(0)
})

send({ evt: 'worker-ready' })
