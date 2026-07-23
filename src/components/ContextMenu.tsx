import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onSelect: (key: string) => void
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onSelect, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }

    let onPointerDown: ((e: MouseEvent) => void) | null = null
    // 推迟绑定，避免「左键打开菜单」的同一次 click/mousedown 立刻把菜单关掉
    const timer = window.setTimeout(() => {
      onPointerDown = (e: MouseEvent) => {
        if (rootRef.current?.contains(e.target as Node)) return
        onCloseRef.current()
      }
      window.addEventListener('mousedown', onPointerDown, true)
      window.addEventListener('contextmenu', onPointerDown, true)
    }, 0)

    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      if (onPointerDown) {
        window.removeEventListener('mousedown', onPointerDown, true)
        window.removeEventListener('contextmenu', onPointerDown, true)
      }
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - items.length * 32 - 20)

  return createPortal(
    <div
      ref={rootRef}
      className="ctx-menu"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) =>
        item.separator ? (
          <div key={item.key} className="ctx-sep" />
        ) : (
          <button
            key={item.key}
            className={`ctx-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              onSelect(item.key)
              onClose()
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
