import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { rdpScancodeFromEvent } from '../utils/rdpScancode'

interface Props {
  sessionId: string
  active: boolean
  width?: number
  height?: number
  /** 舞台尺寸相对远程分辨率变化较大时，请求按新尺寸重连 */
  onRequestResize?: (width: number, height: number) => void
}

interface Tile {
  destLeft: number
  destTop: number
  destRight: number
  destBottom: number
  width: number
  height: number
  data: ArrayBuffer | Uint8Array | number[] | { type?: string; data?: number[] }
}

function toUint8(
  data: ArrayBuffer | Uint8Array | number[] | { type?: string; data?: number[] },
): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(data)
  if (data && typeof data === 'object' && Array.isArray(data.data)) {
    return Uint8Array.from(data.data)
  }
  return new Uint8Array(0)
}

function snap8(n: number, min: number) {
  const v = Math.max(min, Math.floor(n))
  return v - (v % 8)
}

/** 铺满舞台（可轻微拉伸），避免放大窗口后两侧黑边 */
function fitCanvasToStage(stage: HTMLElement, canvas: HTMLCanvasElement) {
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  if (sw <= 0 || sh <= 0) return
  canvas.style.width = `${sw}px`
  canvas.style.height = `${sh}px`
}

export default function RdpView({
  sessionId,
  active,
  width = 1024,
  height = 576,
  onRequestResize,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  /** 离屏帧缓冲：标签隐藏时也持续合成，切回时整帧 blit，避免只剩增量图块 */
  const bufferRef = useRef<HTMLCanvasElement | null>(null)
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const displayCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const queueRef = useRef<Tile[]>([])
  const paintScheduledRef = useRef(false)
  const lastMoveAtRef = useRef(0)
  const remoteSizeRef = useRef({ w: width, h: height })
  const activeRef = useRef(active)
  const onResizeRef = useRef(onRequestResize)
  const resizeTimerRef = useRef(0)
  const lastRequestedRef = useRef({ w: width, h: height })

  activeRef.current = active
  onResizeRef.current = onRequestResize
  lastRequestedRef.current = { w: width, h: height }

  function ensureBuffer(w: number, h: number) {
    let buffer = bufferRef.current
    if (!buffer) {
      buffer = document.createElement('canvas')
      bufferRef.current = buffer
    }
    if (buffer.width !== w || buffer.height !== h) {
      buffer.width = w
      buffer.height = h
      const ctx = buffer.getContext('2d', { alpha: false })
      bufferCtxRef.current = ctx
      if (ctx) {
        ctx.imageSmoothingEnabled = false
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
      }
    } else if (!bufferCtxRef.current) {
      bufferCtxRef.current = buffer.getContext('2d', { alpha: false })
    }
    return buffer
  }

  function blitToDisplay() {
    const canvas = canvasRef.current
    const buffer = bufferRef.current
    if (!canvas || !buffer) return
    const ctx =
      displayCtxRef.current ||
      canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    displayCtxRef.current = ctx
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(buffer, 0, 0)
  }

  useEffect(() => {
    remoteSizeRef.current = { w: width, h: height }
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas) return

    ensureBuffer(width, height)

    // 仅在尺寸变化时重置显示画布；不要在每次 active 切换时清空
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      displayCtxRef.current = canvas.getContext('2d', { alpha: false })
    } else if (!displayCtxRef.current) {
      displayCtxRef.current = canvas.getContext('2d', { alpha: false })
    }

    blitToDisplay()
    if (stage) fitCanvasToStage(stage, canvas)
  }, [width, height, sessionId])

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return

    const sync = () => {
      fitCanvasToStage(stage, canvas)

      // 仅当前激活标签：窗口放大/缩小后按新舞台尺寸重连，去掉黑边并恢复清晰度
      if (!activeRef.current || !onResizeRef.current) return
      const sw = snap8(stage.clientWidth, 640)
      const sh = snap8(stage.clientHeight, 400)
      const cur = lastRequestedRef.current
      if (Math.abs(sw - cur.w) < 48 && Math.abs(sh - cur.h) < 48) return

      window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = window.setTimeout(() => {
        if (!activeRef.current || !onResizeRef.current) return
        const stageNow = stageRef.current
        if (!stageNow) return
        const nw = snap8(stageNow.clientWidth, 640)
        const nh = snap8(stageNow.clientHeight, 400)
        const latest = lastRequestedRef.current
        if (Math.abs(nw - latest.w) < 48 && Math.abs(nh - latest.h) < 48) return
        lastRequestedRef.current = { w: nw, h: nh }
        onResizeRef.current(nw, nh)
      }, 750)
    }
    sync()

    const ro = new ResizeObserver(sync)
    ro.observe(stage)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
      window.clearTimeout(resizeTimerRef.current)
    }
  }, [sessionId])

  useEffect(() => {
    function paintTiles(tiles: Tile[]) {
      const { w, h } = remoteSizeRef.current
      ensureBuffer(w, h)
      const ctx = bufferCtxRef.current
      if (!ctx) return

      for (const tile of tiles) {
        const raw = toUint8(tile.data)
        const need = tile.width * tile.height * 4
        if (raw.byteLength < need || tile.width <= 0 || tile.height <= 0) continue

        const image = ctx.createImageData(tile.width, tile.height)
        image.data.set(raw.subarray(0, need))
        ctx.putImageData(image, tile.destLeft, tile.destTop)
      }

      // 非激活标签也要更新缓冲；激活时再刷到可见画布
      if (activeRef.current) blitToDisplay()
    }

    function schedulePaint() {
      if (paintScheduledRef.current) return
      paintScheduledRef.current = true

      const run = () => {
        paintScheduledRef.current = false
        const batch = queueRef.current
        if (!batch.length) return
        queueRef.current = []
        paintTiles(batch)
      }

      // 隐藏标签上 rAF 可能被降频/暂停，用 timeout 保证帧缓冲持续更新
      if (activeRef.current) {
        requestAnimationFrame(run)
      } else {
        setTimeout(run, 0)
      }
    }

    const off = window.easyshell.onRdpBitmaps((payload) => {
      if (payload.sessionId !== sessionId || !payload.tiles?.length) return
      queueRef.current.push(...payload.tiles)
      schedulePaint()
    })

    return () => {
      off()
      paintScheduledRef.current = false
      queueRef.current = []
    }
  }, [sessionId])

  // 切回该标签：从主进程拉整帧快照（RDP 不会重发全屏）
  useEffect(() => {
    if (!active) return
    let cancelled = false

    ;(async () => {
      try {
        const fb = await window.easyshell.getRdpFramebuffer(sessionId)
        if (cancelled || !fb?.data || !fb.width || !fb.height) {
          blitToDisplay()
          return
        }
        ensureBuffer(fb.width, fb.height)
        const ctx = bufferCtxRef.current
        if (ctx) {
          const raw = toUint8(fb.data)
          const need = fb.width * fb.height * 4
          if (raw.byteLength >= need) {
            const image = ctx.createImageData(fb.width, fb.height)
            image.data.set(raw.subarray(0, need))
            ctx.putImageData(image, 0, 0)
          }
        }
        const canvas = canvasRef.current
        if (canvas && (canvas.width !== fb.width || canvas.height !== fb.height)) {
          canvas.width = fb.width
          canvas.height = fb.height
          displayCtxRef.current = canvas.getContext('2d', { alpha: false })
        }
        blitToDisplay()
        const stage = stageRef.current
        if (stage && canvas) fitCanvasToStage(stage, canvas)
      } catch {
        if (!cancelled) blitToDisplay()
      }
    })()

    wrapRef.current?.focus()

    // 切回标签时若窗口已放大/缩小，按当前舞台补一次分辨率适配
    const stageEl = stageRef.current
    if (stageEl && onResizeRef.current) {
      const sw = snap8(stageEl.clientWidth, 640)
      const sh = snap8(stageEl.clientHeight, 400)
      const cur = lastRequestedRef.current
      if (Math.abs(sw - cur.w) >= 48 || Math.abs(sh - cur.h) >= 48) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = window.setTimeout(() => {
          if (!activeRef.current || !onResizeRef.current) return
          lastRequestedRef.current = { w: sw, h: sh }
          onResizeRef.current(sw, sh)
        }, 400)
      }
    }

    return () => {
      cancelled = true
    }
  }, [active, sessionId])

  function mapPoint(e: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / Math.max(1, rect.width)
    const scaleY = canvas.height / Math.max(1, rect.height)
    return {
      x: Math.max(0, Math.min(canvas.width - 1, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height - 1, (e.clientY - rect.top) * scaleY)),
    }
  }

  return (
    <div
      className="rdp-view"
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if (!active) return
        e.preventDefault()
        const mapped = rdpScancodeFromEvent(e.nativeEvent)
        if (!mapped) return
        window.easyshell.rdpKey(sessionId, mapped.scancode, true, mapped.extended)
      }}
      onKeyUp={(e) => {
        if (!active) return
        e.preventDefault()
        const mapped = rdpScancodeFromEvent(e.nativeEvent)
        if (!mapped) return
        window.easyshell.rdpKey(sessionId, mapped.scancode, false, mapped.extended)
      }}
    >
      <div className="rdp-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="rdp-canvas"
          onContextMenu={(e) => e.preventDefault()}
          onMouseMove={(e) => {
            if (!active) return
            const now = performance.now()
            if (now - lastMoveAtRef.current < 33 && e.buttons === 0) return
            lastMoveAtRef.current = now
            const { x, y } = mapPoint(e)
            window.easyshell.rdpPointer(sessionId, x, y, 0, false)
          }}
          onMouseDown={(e) => {
            if (!active) return
            wrapRef.current?.focus()
            const { x, y } = mapPoint(e)
            const button = e.button === 0 ? 1 : e.button === 2 ? 2 : 3
            window.easyshell.rdpPointer(sessionId, x, y, button, true)
          }}
          onMouseUp={(e) => {
            if (!active) return
            const { x, y } = mapPoint(e)
            const button = e.button === 0 ? 1 : e.button === 2 ? 2 : 3
            window.easyshell.rdpPointer(sessionId, x, y, button, false)
          }}
          onWheel={(e) => {
            if (!active) return
            e.preventDefault()
            const { x, y } = mapPoint(e)
            const step = Math.min(127, Math.abs(Math.round(e.deltaY / 40)) || 1)
            window.easyshell.rdpWheel(sessionId, x, y, step, e.deltaY > 0, false)
          }}
        />
      </div>
    </div>
  )
}
