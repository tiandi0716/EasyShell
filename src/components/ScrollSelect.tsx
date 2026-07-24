import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  value: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export default function ScrollSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const maxHeight = 260
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow
    const height = Math.min(maxHeight, Math.max(140, openUp ? spaceAbove : spaceBelow))
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 200),
      zIndex: 240,
      maxHeight: height,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // 只在窗口/外层滚动时收起；菜单内部滚动不能关
    const onReposition = (e: Event) => {
      const t = e.target as Node | null
      if (t && listRef.current?.contains(t)) return
      if (t === listRef.current) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const active = listRef.current.querySelector<HTMLElement>('[data-active="1"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, value])

  // 滚轮落到菜单上时，阻止传到背后弹窗，避免“滚不动”
  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 避免滚轮事件冒泡到弹窗/页面，导致列表滚不动
      e.stopPropagation()
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open])

  const label = value || placeholder

  return (
    <div className={`scroll-select ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="scroll-select-trigger"
        disabled={disabled || !options.length}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`scroll-select-label ${value ? '' : 'scroll-select-placeholder'}`}>
          {label}
        </span>
        <span className="scroll-select-caret" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 4.25L6 7.75L9.5 4.25"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open
        ? createPortal(
            <ul
              className="scroll-select-menu"
              role="listbox"
              ref={listRef}
              style={menuStyle}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {options.map((opt) => {
                const active = opt === value
                return (
                  <li
                    key={opt}
                    role="option"
                    aria-selected={active}
                    data-active={active ? '1' : '0'}
                  >
                    <button
                      type="button"
                      className={`scroll-select-option ${active ? 'active' : ''}`}
                      onClick={() => {
                        onChange(opt)
                        setOpen(false)
                      }}
                    >
                      <span className="scroll-select-option-text">{opt}</span>
                      {active ? <span className="scroll-select-check" aria-hidden>✓</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
