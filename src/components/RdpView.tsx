import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { rdpScancodeFromEvent } from '../utils/rdpScancode'

interface Props {
  sessionId: string
  active: boolean
  width?: number
  height?: number
}

interface Tile {
  destLeft: number
  destTop: number
  destRight: number
  destBottom: number
  width: number
  height: number
  data: ArrayBuffer | Uint8Array | number[]
}

function toUint8(data: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data)
}

/** 始终铺满舞台，随侧栏折叠/窗口缩放自适应，避免左右大黑边 */
function fitCanvasToStage(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  _remoteW: number,
  _remoteH: number,
) {
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  if (sw <= 0 || sh <= 0) return
  canvas.style.width = `${sw}px`
  canvas.style.height = `${sh}px`
}

export default function RdpView({ sessionId, active, width = 1024, height = 576 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const queueRef = useRef<Tile[]>([])
  const rafRef = useRef(0)
  const lastMoveAtRef = useRef(0)
  const remoteSizeRef = useRef({ w: width, h: height })

  useEffect(() => {
    remoteSizeRef.current = { w: width, h: height }
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
    })
    ctxRef.current = ctx
    if (ctx) {
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
    }
    if (stage) fitCanvasToStage(stage, canvas, width, height)
  }, [width, height, sessionId])

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return

    const sync = () => {
      const { w, h } = remoteSizeRef.current
      fitCanvasToStage(stage, canvas, w, h)
    }
    sync()

    const ro = new ResizeObserver(sync)
    ro.observe(stage)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [sessionId])

  useEffect(() => {
    function paintTiles(tiles: Tile[]) {
      const ctx = ctxRef.current || canvasRef.current?.getContext('2d', { alpha: false })
      if (!ctx) return
      ctxRef.current = ctx

      for (const tile of tiles) {
        const raw = toUint8(tile.data)
        const need = tile.width * tile.height * 4
        if (raw.byteLength < need || tile.width <= 0 || tile.height <= 0) continue

        const image = ctx.createImageData(tile.width, tile.height)
        image.data.set(raw.subarray(0, need))
        ctx.putImageData(image, tile.destLeft, tile.destTop)
      }
    }

    function schedulePaint() {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const batch = queueRef.current
        if (!batch.length) return
        queueRef.current = []
        paintTiles(batch)
      })
    }

    const off = window.easyshell.onRdpBitmaps((payload) => {
      if (payload.sessionId !== sessionId || !payload.tiles?.length) return
      queueRef.current.push(...payload.tiles)
      schedulePaint()
    })

    return () => {
      off()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      queueRef.current = []
    }
  }, [sessionId])

  useEffect(() => {
    if (!active) return
    wrapRef.current?.focus()
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
